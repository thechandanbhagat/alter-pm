// @group Notifications > Events : Event types that trigger notifications

use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotificationEvent {
    ProcessCrashed {
        process_name: String,
        exit_code: Option<i32>,
        timestamp: DateTime<Utc>,
    },
    ProcessRestarted {
        process_name: String,
        restart_count: u32,
        timestamp: DateTime<Utc>,
    },
    ProcessStopped {
        process_name: String,
        timestamp: DateTime<Utc>,
    },
    HealthCheckFailed {
        process_name: String,
        url: String,
        timestamp: DateTime<Utc>,
    },
    ResourceLimitExceeded {
        process_name: String,
        resource: String,
        current_value: String,
        limit_value: String,
        timestamp: DateTime<Utc>,
    },
}

impl NotificationEvent {
    pub fn title(&self) -> String {
        match self {
            Self::ProcessCrashed { process_name, .. } => {
                format!("Process '{}' crashed", process_name)
            }
            Self::ProcessRestarted {
                process_name,
                restart_count,
                ..
            } => format!("Process '{}' restarted (#{restart_count})", process_name),
            Self::ProcessStopped { process_name, .. } => {
                format!("Process '{}' stopped", process_name)
            }
            Self::HealthCheckFailed { process_name, .. } => {
                format!("Health check failed for '{}'", process_name)
            }
            Self::ResourceLimitExceeded {
                process_name,
                resource,
                ..
            } => format!("Process '{}' exceeded {} limit", process_name, resource),
        }
    }

    pub fn body(&self) -> String {
        match self {
            Self::ProcessCrashed {
                process_name,
                exit_code,
                timestamp,
            } => format!(
                "Process '{}' crashed with exit code {:?} at {}",
                process_name,
                exit_code,
                timestamp.format("%Y-%m-%d %H:%M:%S UTC")
            ),
            Self::ProcessRestarted {
                process_name,
                restart_count,
                timestamp,
            } => format!(
                "Process '{}' was restarted (attempt #{}) at {}",
                process_name,
                restart_count,
                timestamp.format("%Y-%m-%d %H:%M:%S UTC")
            ),
            Self::ProcessStopped {
                process_name,
                timestamp,
            } => format!(
                "Process '{}' was stopped at {}",
                process_name,
                timestamp.format("%Y-%m-%d %H:%M:%S UTC")
            ),
            Self::HealthCheckFailed {
                process_name,
                url,
                timestamp,
            } => format!(
                "Health check for '{}' failed at {} (probe: {})",
                process_name,
                timestamp.format("%Y-%m-%d %H:%M:%S UTC"),
                url
            ),
            Self::ResourceLimitExceeded {
                process_name,
                resource,
                current_value,
                limit_value,
                timestamp,
            } => format!(
                "Process '{}' exceeded {} limit: {} > {} at {}",
                process_name,
                resource,
                current_value,
                limit_value,
                timestamp.format("%Y-%m-%d %H:%M:%S UTC")
            ),
        }
    }

    pub fn severity(&self) -> &str {
        match self {
            Self::ProcessCrashed { .. } => "critical",
            Self::ProcessRestarted { .. } => "warning",
            Self::ProcessStopped { .. } => "info",
            Self::HealthCheckFailed { .. } => "critical",
            Self::ResourceLimitExceeded { .. } => "warning",
        }
    }
}
