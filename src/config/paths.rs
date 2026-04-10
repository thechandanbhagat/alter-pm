// @group Configuration : Platform-aware path resolution

use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    // ALTER_DATA_DIR_SUFFIX lets alternate builds (e.g. alter-dev) use an isolated data directory.
    #[cfg(target_os = "windows")]
    let default_suffix = "alter-pm2";
    #[cfg(not(target_os = "windows"))]
    let default_suffix = ".alter-pm2";

    let suffix = std::env::var("ALTER_DATA_DIR_SUFFIX").unwrap_or_else(|_| default_suffix.to_string());

    #[cfg(target_os = "windows")]
    {
        let base = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("C:\\Users\\Default\\AppData\\Roaming"));
        base.join(suffix)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        base.join(suffix)
    }
}

pub fn log_dir() -> PathBuf {
    // ALTER_LOG_DIR fully overrides the log directory path.
    if let Ok(custom) = std::env::var("ALTER_LOG_DIR") {
        return PathBuf::from(custom);
    }
    data_dir().join("logs")
}

pub fn state_file() -> PathBuf {
    data_dir().join("state.json")
}

pub fn pid_file() -> PathBuf {
    data_dir().join("daemon.pid")
}

pub fn daemon_log_file() -> PathBuf {
    data_dir().join("daemon.log")
}

pub fn scripts_dir() -> PathBuf {
    data_dir().join("scripts")
}

pub fn terminal_history_file() -> PathBuf {
    data_dir().join("terminal-history.json")
}

pub fn process_log_dir(name: &str) -> PathBuf {
    log_dir().join(sanitize_name(name))
}

pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
