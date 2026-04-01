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
    /// Process-level log alert override (takes priority over namespace and global)
    #[serde(default)]
    pub log_alert: Option<crate::config::log_alert_config::LogAlertOverride>,

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

    // @group Utilities : Parse an EcosystemConfig directly from a JSON string (test helper)
    #[cfg(test)]
    fn from_json(s: &str) -> Result<Self> {
        serde_json::from_str(s).with_context(|| "failed to parse JSON")
    }

    // @group Utilities : Parse an EcosystemConfig directly from a TOML string (test helper)
    #[cfg(test)]
    fn from_toml(s: &str) -> Result<Self> {
        toml::from_str(s).with_context(|| "failed to parse TOML")
    }
}

// @group UnitTests : EcosystemConfig — JSON + TOML parsing and default field values
#[cfg(test)]
mod tests {
    use super::*;

    // @group UnitTests > JSON : Minimal valid JSON config round-trips correctly
    #[test]
    fn test_parse_json_minimal() {
        let cfg = EcosystemConfig::from_json(r#"{"apps":[{"name":"api","script":"node index.js"}]}"#).unwrap();
        assert_eq!(cfg.apps.len(), 1);
        assert_eq!(cfg.apps[0].name, "api");
        assert_eq!(cfg.apps[0].script, "node index.js");
    }

    // @group UnitTests > JSON : Default field values are applied when fields are absent
    #[test]
    fn test_json_defaults() {
        let cfg = EcosystemConfig::from_json(r#"{"apps":[{"name":"svc","script":"run.sh"}]}"#).unwrap();
        let app = &cfg.apps[0];
        assert_eq!(app.instances,          1);
        assert!(app.autorestart);
        assert_eq!(app.max_restarts,       10);
        assert_eq!(app.restart_delay_ms,   1000);
        assert!(!app.watch);
        assert_eq!(app.namespace,          "default");
        assert_eq!(app.max_log_size_mb,    10);
        assert!(app.args.is_empty());
        assert!(app.env.is_empty());
        assert!(app.cwd.is_none());
        assert!(app.cron.is_none());
    }

    // @group UnitTests > JSON : Explicit field values override defaults
    #[test]
    fn test_json_explicit_fields() {
        let json = r#"{
            "apps": [{
                "name": "worker",
                "script": "python worker.py",
                "instances": 4,
                "autorestart": false,
                "max_restarts": 3,
                "namespace": "jobs",
                "watch": true
            }]
        }"#;
        let app = &EcosystemConfig::from_json(json).unwrap().apps[0];
        assert_eq!(app.instances,  4);
        assert!(!app.autorestart);
        assert_eq!(app.max_restarts, 3);
        assert_eq!(app.namespace, "jobs");
        assert!(app.watch);
    }

    // @group UnitTests > JSON : Empty apps list is valid
    #[test]
    fn test_json_empty_apps() {
        let cfg = EcosystemConfig::from_json(r#"{"apps":[]}"#).unwrap();
        assert!(cfg.apps.is_empty());
        assert!(cfg.daemon.is_none());
    }

    // @group UnitTests > JSON : Multiple apps are all parsed
    #[test]
    fn test_json_multiple_apps() {
        let json = r#"{"apps":[{"name":"a","script":"a.js"},{"name":"b","script":"b.js"}]}"#;
        let cfg = EcosystemConfig::from_json(json).unwrap();
        assert_eq!(cfg.apps.len(), 2);
        assert_eq!(cfg.apps[0].name, "a");
        assert_eq!(cfg.apps[1].name, "b");
    }

    // @group UnitTests > TOML : Minimal valid TOML config round-trips correctly
    #[test]
    fn test_parse_toml_minimal() {
        let toml = r#"
[[apps]]
name   = "api"
script = "node index.js"
"#;
        let cfg = EcosystemConfig::from_toml(toml).unwrap();
        assert_eq!(cfg.apps.len(), 1);
        assert_eq!(cfg.apps[0].name, "api");
    }

    // @group UnitTests > TOML : Default field values are applied when fields are absent
    #[test]
    fn test_toml_defaults() {
        let toml = "[[apps]]\nname = \"svc\"\nscript = \"run.sh\"\n";
        let app = &EcosystemConfig::from_toml(toml).unwrap().apps[0];
        assert_eq!(app.instances, 1);
        assert!(app.autorestart);
        assert_eq!(app.namespace, "default");
    }

    // @group UnitTests > TOML : Env vars are captured as a map
    #[test]
    fn test_toml_env_vars() {
        let toml = r#"
[[apps]]
name   = "api"
script = "node server.js"
[apps.env]
PORT = "3000"
NODE_ENV = "production"
"#;
        let app = &EcosystemConfig::from_toml(toml).unwrap().apps[0];
        assert_eq!(app.env.get("PORT").map(|s| s.as_str()),     Some("3000"));
        assert_eq!(app.env.get("NODE_ENV").map(|s| s.as_str()), Some("production"));
    }

    // @group UnitTests > EdgeCases : Missing required field "script" returns an error
    #[test]
    fn test_json_missing_required_field() {
        let result = EcosystemConfig::from_json(r#"{"apps":[{"name":"oops"}]}"#);
        assert!(result.is_err());
    }

    // @group UnitTests > EdgeCases : Malformed JSON returns an error
    #[test]
    fn test_json_malformed() {
        assert!(EcosystemConfig::from_json("not json at all").is_err());
    }
}
