// @group Configuration : Telegram bot configuration — stored at %APPDATA%\alter-pm2\telegram.json

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    /// Whether the Telegram bot is active
    pub enabled: bool,
    /// Bot token from @BotFather
    pub bot_token: Option<String>,
    /// Telegram chat IDs allowed to send commands (whitelist)
    pub allowed_chat_ids: Vec<i64>,
    /// Push notification toggles
    pub notify_on_crash: bool,
    pub notify_on_start: bool,
    pub notify_on_stop: bool,
    pub notify_on_restart: bool,
}

impl Default for TelegramConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bot_token: None,
            allowed_chat_ids: vec![],
            notify_on_crash: true,
            notify_on_start: false,
            notify_on_stop: false,
            notify_on_restart: true,
        }
    }
}

// @group Configuration : Load Telegram config from disk (returns default if missing)
pub fn load() -> TelegramConfig {
    let path = crate::config::paths::data_dir().join("telegram.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => TelegramConfig::default(),
    }
}

// @group Configuration : Persist Telegram config to disk (atomic write)
pub fn save(config: &TelegramConfig) -> Result<()> {
    let path = crate::config::paths::data_dir().join("telegram.json");
    let content = serde_json::to_string_pretty(config)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &content)?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(&path, &content)?;
    }
    Ok(())
}
