// @group Types : Per-process log volume tracking — stdout/stderr counts in 5-minute buckets

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

// @group Constants : Bucket width in seconds (5 minutes)
pub const LOG_BUCKET_SECS: i64 = 300;
// @group Constants : Maximum completed buckets retained per process (288 × 5 min = 24 h)
pub const MAX_LOG_STAT_BUCKETS: usize = 288;

// @group Types > LogStatsBucket : Completed 5-minute window with stdout + stderr line counts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogStatsBucket {
    /// UTC start of this 5-minute window
    pub window_start: DateTime<Utc>,
    /// Lines written to stdout during this window
    pub stdout_count: u64,
    /// Lines written to stderr during this window
    pub stderr_count: u64,
}

// @group BusinessLogic > LogStatsState : Mutable accumulator for live log counting
pub struct LogStatsState {
    /// Start of the currently open bucket
    pub current_bucket_start: DateTime<Utc>,
    pub current_stdout: u64,
    pub current_stderr: u64,
    /// Completed historical buckets (oldest first)
    pub history: VecDeque<LogStatsBucket>,
}

impl LogStatsState {
    pub fn new() -> Self {
        Self {
            current_bucket_start: bucket_floor(Utc::now()),
            current_stdout: 0,
            current_stderr: 0,
            history: VecDeque::new(),
        }
    }

    // @group BusinessLogic > LogStatsState : Record one log line; flush bucket if the window has rolled over
    pub fn record(&mut self, is_stdout: bool) {
        let now = Utc::now();
        let expected_start = bucket_floor(now);

        if expected_start > self.current_bucket_start {
            // The 5-minute window has elapsed — push the completed bucket
            if self.current_stdout > 0 || self.current_stderr > 0 {
                self.history.push_back(LogStatsBucket {
                    window_start: self.current_bucket_start,
                    stdout_count: self.current_stdout,
                    stderr_count: self.current_stderr,
                });
                if self.history.len() > MAX_LOG_STAT_BUCKETS {
                    self.history.pop_front();
                }
            }
            self.current_bucket_start = expected_start;
            self.current_stdout = 0;
            self.current_stderr = 0;
        }

        if is_stdout {
            self.current_stdout += 1;
        } else {
            self.current_stderr += 1;
        }
    }

    // @group BusinessLogic > LogStatsState : Return all completed buckets plus the current open one
    pub fn snapshot(&self) -> Vec<LogStatsBucket> {
        let mut out: Vec<LogStatsBucket> = self.history.iter().cloned().collect();
        // Always append the current open bucket so callers see live data
        if self.current_stdout > 0 || self.current_stderr > 0 {
            out.push(LogStatsBucket {
                window_start: self.current_bucket_start,
                stdout_count: self.current_stdout,
                stderr_count: self.current_stderr,
            });
        }
        out
    }
}

// @group Utilities : Floor a timestamp down to the nearest 5-minute boundary
fn bucket_floor(ts: DateTime<Utc>) -> DateTime<Utc> {
    let secs = ts.timestamp();
    let floored = secs - (secs % LOG_BUCKET_SECS);
    DateTime::from_timestamp(floored, 0).unwrap_or(ts)
}
