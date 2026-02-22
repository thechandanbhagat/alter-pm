// @group BusinessLogic : Cron scheduler — fires a trigger for a process at each scheduled tick

use anyhow::{anyhow, Result};
use chrono::Utc;
use cron::Schedule;
use std::str::FromStr;
use tokio::sync::mpsc;
use tokio::time::{sleep_until, Instant};
use uuid::Uuid;

/// Holds the background task handle for a cron-scheduled process.
/// Dropping this struct does NOT stop the task — call `abort()` explicitly.
pub struct CronScheduler {
    task: tokio::task::JoinHandle<()>,
}

impl CronScheduler {
    /// Start a cron scheduler for the given process.
    /// Parses `cron_expr` (5-field POSIX cron, e.g. "0 * * * *") and fires
    /// `trigger_tx.send(process_id)` at each scheduled tick.
    pub fn start(
        process_id: Uuid,
        cron_expr: &str,
        trigger_tx: mpsc::Sender<Uuid>,
    ) -> Result<Self> {
        // The `cron` crate expects 6-field (sec min hour dom month dow) or 7-field expressions.
        // We accept standard 5-field POSIX (min hour dom month dow) and prepend "0 " for seconds.
        let normalized = if cron_expr.split_whitespace().count() == 5 {
            format!("0 {cron_expr}")
        } else {
            cron_expr.to_string()
        };

        let schedule = Schedule::from_str(&normalized)
            .map_err(|e| anyhow!("invalid cron expression '{}': {}", cron_expr, e))?;

        let task = tokio::spawn(async move {
            loop {
                let now = Utc::now();
                let next = match schedule.upcoming(Utc).next() {
                    Some(t) => t,
                    None => {
                        tracing::warn!("cron schedule for {process_id} has no upcoming ticks — stopping");
                        break;
                    }
                };

                let wait_secs = (next - now).num_milliseconds().max(0) as u64;
                let deadline = Instant::now() + tokio::time::Duration::from_millis(wait_secs);

                sleep_until(deadline).await;

                if trigger_tx.send(process_id).await.is_err() {
                    // Receiver dropped — manager is gone, stop scheduling
                    break;
                }
            }
        });

        Ok(Self { task })
    }

    /// Abort the background scheduling task immediately.
    pub fn abort(&self) {
        self.task.abort();
    }
}

impl Drop for CronScheduler {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Compute the next scheduled run time for a cron expression without starting a scheduler.
pub fn next_run(cron_expr: &str) -> Option<chrono::DateTime<Utc>> {
    let normalized = if cron_expr.split_whitespace().count() == 5 {
        format!("0 {cron_expr}")
    } else {
        cron_expr.to_string()
    };
    Schedule::from_str(&normalized).ok()?.upcoming(Utc).next()
}
