// @group Configuration : Log alert store — stored at %APPDATA%\alter-pm2\log_alerts.json

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// @group Types > LogAlertOverride : Partial override applied at namespace or process scope
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LogAlertOverride {
    /// None = inherit from parent scope
    pub enabled: Option<bool>,
    /// None = inherit from parent scope
    pub stderr_threshold: Option<u64>,
    /// None = inherit from parent scope
    pub cooldown_mins: Option<u32>,
}

// @group Types > LogAlertConfig : Global log alert settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogAlertConfig {
    /// Whether log-spike alerts are active globally
    pub enabled: bool,
    /// Fire an alert when stderr lines in a bucket reach or exceed this count
    pub stderr_threshold: u64,
    /// Minimum minutes between repeated alerts for the same process (spam guard)
    pub cooldown_mins: u32,
    /// How often the alert check loop runs (in minutes)
    #[serde(default = "default_check_interval")]
    pub check_interval_mins: u32,
}

fn default_check_interval() -> u32 { 5 }

impl Default for LogAlertConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            stderr_threshold: 10,
            cooldown_mins: 15,
            check_interval_mins: 5,
        }
    }
}

// @group Types > LogAlertStore : Global config + per-namespace overrides
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LogAlertStore {
    #[serde(default)]
    pub global: LogAlertConfig,
    /// Per-namespace threshold / cooldown / enabled overrides
    #[serde(default)]
    pub namespaces: HashMap<String, LogAlertOverride>,
}

impl LogAlertStore {
    // @group BusinessLogic > LogAlerts : Resolve effective (enabled, threshold, cooldown) for a process
    // Priority: process override → namespace override → global
    pub fn resolve(
        &self,
        namespace: &str,
        proc_override: Option<&LogAlertOverride>,
    ) -> (bool, u64, u32) {
        let g = &self.global;
        let ns = self.namespaces.get(namespace);

        let enabled = proc_override.and_then(|o| o.enabled)
            .or_else(|| ns.and_then(|o| o.enabled))
            .unwrap_or(g.enabled);

        let threshold = proc_override.and_then(|o| o.stderr_threshold)
            .or_else(|| ns.and_then(|o| o.stderr_threshold))
            .unwrap_or(g.stderr_threshold);

        let cooldown = proc_override.and_then(|o| o.cooldown_mins)
            .or_else(|| ns.and_then(|o| o.cooldown_mins))
            .unwrap_or(g.cooldown_mins);

        (enabled, threshold, cooldown)
    }
}

// @group Configuration : Load log alert store from disk (returns default if missing or unreadable)
pub fn load() -> LogAlertStore {
    let path = crate::config::paths::data_dir().join("log_alerts.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => LogAlertStore::default(),
    }
}

// @group Configuration : Atomically persist log alert store to disk
pub fn save(store: &LogAlertStore) -> Result<()> {
    let path = crate::config::paths::data_dir().join("log_alerts.json");
    let content = serde_json::to_string_pretty(store)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &content)?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(&path, &content)?;
    }
    Ok(())
}
