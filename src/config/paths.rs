// @group Configuration : Platform-aware path resolution

use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("C:\\Users\\Default\\AppData\\Roaming"));
        base.join("alter-pm2")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        base.join(".alter-pm2")
    }
}

pub fn log_dir() -> PathBuf {
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

pub fn process_log_dir(name: &str) -> PathBuf {
    log_dir().join(sanitize_name(name))
}

pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
