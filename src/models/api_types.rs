// @group Types : REST API request and response structs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// @group Types > Request : Start a new process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartRequest {
    pub name: Option<String>,
    pub script: String,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub autorestart: Option<bool>,
    pub max_restarts: Option<u32>,
    pub restart_delay_ms: Option<u64>,
    pub namespace: Option<String>,
    pub watch: Option<bool>,
    pub watch_paths: Option<Vec<String>>,
    pub watch_ignore: Option<Vec<String>>,
    pub max_log_size_mb: Option<u64>,
    /// Cron expression for scheduled execution (e.g. "0 * * * *")
    pub cron: Option<String>,
    /// Process-level notification override
    pub notify: Option<crate::models::notification::NotificationConfig>,
    /// Process-level log alert override
    pub log_alert: Option<crate::config::log_alert_config::LogAlertOverride>,
    /// Number of instances to run (cluster mode)
    pub instances: Option<u32>,
    /// HTTP or TCP health check endpoint
    pub health_check_url: Option<String>,
    pub health_check_interval_secs: Option<u64>,
    pub health_check_timeout_secs: Option<u64>,
    pub health_check_retries: Option<u32>,
    /// Shell command run before the process starts
    pub pre_start: Option<String>,
    /// Shell command run after the process starts
    pub post_start: Option<String>,
    /// Shell command run before the process stops
    pub pre_stop: Option<String>,
}

// @group Types > Request : Load an ecosystem config file
#[derive(Debug, Deserialize)]
pub struct EcosystemRequest {
    pub path: String,
}

// @group Types > Response : Generic operation response
#[derive(Debug, Serialize)]
pub struct ActionResponse {
    pub success: bool,
    pub message: String,
}

// @group Types > Response : Daemon health check
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_secs: u64,
    pub process_count: usize,
}

// @group Types > Response : Log lines response
#[derive(Debug, Serialize, Deserialize)]
pub struct LogsResponse {
    pub lines: Vec<LogLineDto>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogLineDto {
    pub timestamp: String,
    pub stream: String,
    pub content: String,
}
