// @group BusinessLogic : Managed process instance — holds full lifecycle state

use crate::config::ecosystem::AppConfig;
use crate::logging::writer::LogWriter;
use crate::models::cron_run::CronRun;
use crate::models::log_stats::LogStatsState;
use crate::models::process_info::{HealthCheckStatus, ProcessInfo};
use crate::models::process_status::ProcessStatus;
use chrono::{DateTime, Utc};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

/// A single log line emitted by a child process
#[derive(Debug, Clone)]
pub struct LogLine {
    pub timestamp: DateTime<Utc>,
    pub process_id: Uuid,
    pub stream: LogStream,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogStream {
    Stdout,
    Stderr,
}

/// Live in-memory state for a managed process
pub struct ManagedProcess {
    pub id: Uuid,
    pub config: AppConfig,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub stopped_at: Option<DateTime<Utc>>,
    pub last_exit_code: Option<i32>,
    /// Broadcast channel: all subscribers receive new log lines in real-time
    pub log_tx: broadcast::Sender<LogLine>,
    /// Rolling file writer for this process
    pub log_writer: Option<LogWriter>,
    /// Next scheduled run time for cron processes
    pub cron_next_run: Option<DateTime<Utc>>,
    /// History of the last MAX_CRON_HISTORY cron runs (timestamp, exit code, duration)
    pub cron_run_history: Vec<CronRun>,
    /// Last measured CPU usage percentage — updated by the metrics loop
    pub cpu_percent: Option<f32>,
    /// Last measured resident memory in bytes — updated by the metrics loop
    pub memory_bytes: Option<u64>,
    /// Current health probe result — None if no health check is configured
    pub health_status: Option<HealthCheckStatus>,
    /// Handle to the running health check task — aborted on process stop
    pub health_check_handle: Option<tokio::task::JoinHandle<()>>,
    // @group BusinessLogic > LogStats : Rolling 5-minute log volume buckets (stdout + stderr counts)
    pub log_stats: Arc<Mutex<LogStatsState>>,
}

impl ManagedProcess {
    pub fn new(config: AppConfig) -> Self {
        Self::new_with_id(Uuid::new_v4(), config)
    }

    /// Restore a process with its persisted UUID so IDs remain stable across daemon restarts.
    pub fn new_with_id(id: Uuid, config: AppConfig) -> Self {
        let (log_tx, _) = broadcast::channel(1024);
        Self {
            id,
            config,
            status: ProcessStatus::Stopped,
            pid: None,
            restart_count: 0,
            created_at: Utc::now(),
            started_at: None,
            stopped_at: None,
            last_exit_code: None,
            log_tx,
            log_writer: None,
            cron_next_run: None,
            cron_run_history: vec![],
            cpu_percent: None,
            memory_bytes: None,
            health_status: None,
            health_check_handle: None,
            log_stats: Arc::new(Mutex::new(LogStatsState::new())),
        }
    }

    pub fn uptime_secs(&self) -> Option<u64> {
        self.started_at.map(|t| {
            let stopped = self.stopped_at.unwrap_or_else(Utc::now);
            (stopped - t).num_seconds().max(0) as u64
        })
    }

    pub fn to_info(&self) -> ProcessInfo {
        ProcessInfo {
            id: self.id,
            name: self.config.name.clone(),
            script: self.config.script.clone(),
            args: self.config.args.clone(),
            cwd: self.config.cwd.clone(),
            status: self.status.clone(),
            pid: self.pid,
            restart_count: self.restart_count,
            uptime_secs: self.uptime_secs(),
            last_exit_code: self.last_exit_code,
            autorestart: self.config.autorestart,
            max_restarts: self.config.max_restarts,
            watch: self.config.watch,
            namespace: self.config.namespace.clone(),
            created_at: self.created_at,
            started_at: self.started_at,
            stopped_at: self.stopped_at,
            cron: self.config.cron.clone(),
            cron_next_run: self.cron_next_run,
            cron_run_history: self.cron_run_history.clone(),
            cpu_percent: self.cpu_percent,
            memory_bytes: self.memory_bytes,
            env: self.config.env.clone(),
            notify: self.config.notify.clone(),
            log_alert: self.config.log_alert.clone(),
            health_status: self.health_status.clone(),
        }
    }
}
