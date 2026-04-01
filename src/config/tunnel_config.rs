// @group Configuration : Tunnel settings — stored at %APPDATA%\alter-pm2\tunnel.json

use anyhow::Result;
use crate::models::tunnel::TunnelSettings;

// @group Configuration : Load tunnel settings from disk (returns default if missing or corrupt)
pub fn load() -> TunnelSettings {
    let path = crate::config::paths::data_dir().join("tunnel.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => TunnelSettings::default(),
    }
}

// @group Configuration : Persist tunnel settings to disk (atomic write)
pub fn save(settings: &TunnelSettings) -> Result<()> {
    let path = crate::config::paths::data_dir().join("tunnel.json");
    let content = serde_json::to_string_pretty(settings)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &content)?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(&path, &content)?;
    }
    Ok(())
}
