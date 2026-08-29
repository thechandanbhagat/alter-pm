// @group Configuration : Named remote connection profiles

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// @group Types : A single named remote connection
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RemoteConnection {
    pub host: String,
    pub port: u16,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

// @group Types : Persisted connections file
#[derive(Serialize, Deserialize, Default, Debug)]
pub struct ConnectionsConfig {
    #[serde(default)]
    pub connections: HashMap<String, RemoteConnection>,
    /// Name of the default connection; None = use local daemon
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

// @group Configuration : Load connections from disk (returns empty config if not yet created)
pub fn load() -> ConnectionsConfig {
    let path = connections_file();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<ConnectionsConfig>(&content) {
                return cfg;
            }
        }
    }
    ConnectionsConfig::default()
}

// @group Configuration : Atomically persist connections to disk
pub fn save(config: &ConnectionsConfig) -> Result<()> {
    let path = connections_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &content)?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(&path, &content)?;
    }
    Ok(())
}

pub fn connections_file() -> std::path::PathBuf {
    crate::config::paths::data_dir().join("connections.json")
}
