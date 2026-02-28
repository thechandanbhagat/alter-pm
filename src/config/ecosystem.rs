// @group Configuration : Ecosystem and app configuration types

use crate::config::daemon_config::DaemonConfig;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EcosystemConfig {
    pub daemon: Option<DaemonConfig>,
    pub apps: Vec<AppConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub name: String,
    pub script: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default = "default_instances")]
    pub instances: u32,
    #[serde(default = "default_true")]
    pub autorestart: bool,
    #[serde(default = "default_max_restarts")]
    pub max_restarts: u32,
    #[serde(default = "default_restart_delay_ms")]
    pub restart_delay_ms: u64,
    #[serde(default)]
    pub watch: bool,
    #[serde(default)]
    pub watch_paths: Vec<String>,
    #[serde(default)]
    pub watch_ignore: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_namespace")]
    pub namespace: String,
    pub log_file: Option<String>,
    pub error_file: Option<String>,
    #[serde(default = "default_max_log_size_mb")]
    pub max_log_size_mb: u64,
    /// Cron expression for scheduled execution (e.g. "0 * * * *")
    pub cron: Option<String>,
    pub cron_last_run: Option<DateTime<Utc>>,
    pub cron_next_run: Option<DateTime<Utc>>,
    /// Process-level notification override (takes priority over namespace and global)
    #[serde(default)]
    pub notify: Option<crate::models::notification::NotificationConfig>,

    // @group Configuration > EnvFile : Path to a .env file — vars merged with env (env wins on conflict)
    #[serde(default)]
    pub env_file: Option<String>,

    // @group Configuration > HealthCheck : HTTP or TCP probe URL (e.g. "http://localhost:8080/health" or "localhost:8080")
    #[serde(default)]
    pub health_check_url: Option<String>,
    #[serde(default = "default_health_interval")]
    pub health_check_interval_secs: u64,
    #[serde(default = "default_health_timeout")]
    pub health_check_timeout_secs: u64,
    #[serde(default = "default_health_retries")]
    pub health_check_retries: u32,

    // @group Configuration > Hooks : Shell commands run at process lifecycle events
    #[serde(default)]
    pub pre_start: Option<String>,
    #[serde(default)]
    pub post_start: Option<String>,
    #[serde(default)]
    pub pre_stop: Option<String>,
}

fn default_namespace() -> String { "default".to_string() }
fn default_instances() -> u32 { 1 }
fn default_true() -> bool { true }
fn default_max_restarts() -> u32 { 10 }
fn default_restart_delay_ms() -> u64 { 1000 }
fn default_max_log_size_mb() -> u64 { 10 }
fn default_health_interval() -> u64 { 30 }
fn default_health_timeout() -> u64 { 5 }
fn default_health_retries() -> u32 { 3 }

impl EcosystemConfig {
    pub fn from_file(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config file: {}", path.display()))?;

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        match ext {
            "json" => serde_json::from_str(&content)
                .with_context(|| "failed to parse JSON config"),
            _ => toml::from_str(&content)
                .with_context(|| "failed to parse TOML config"),
        }
    }
}
