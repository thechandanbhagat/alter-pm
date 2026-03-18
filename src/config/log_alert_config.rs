// @group Configuration : Log alert config — stored at %APPDATA%\alter-pm2\log_alerts.json

use anyhow::Result;
use serde::{Deserialize, Serialize};

// @group Types > LogAlertConfig : Threshold-based stderr spike notification settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogAlertConfig {
    /// Whether log-spike alerts are active
    pub enabled: bool,
    /// Fire an alert when stderr lines in a 5-minute bucket reach or exceed this count
    pub stderr_threshold: u64,
    /// Minimum minutes between repeated alerts for the same process (spam guard)
    pub cooldown_mins: u32,
}

impl Default for LogAlertConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            stderr_threshold: 10,
            cooldown_mins: 15,
        }
    }
}

// @group Configuration : Load log alert config from disk (returns default if missing)
pub fn load() -> LogAlertConfig {
    let path = crate::config::paths::data_dir().join("log_alerts.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => LogAlertConfig::default(),
    }
}

// @group Configuration : Persist log alert config to disk (atomic write)
pub fn save(config: &LogAlertConfig) -> Result<()> {
    let path = crate::config::paths::data_dir().join("log_alerts.json");
    let content = serde_json::to_string_pretty(config)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &content)?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(&path, &content)?;
    }
    Ok(())
}
