// @group APIEndpoints : System / daemon management endpoints

use crate::api::error::ApiError;
use crate::daemon::state::DaemonState;
use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/stats", get(system_stats))
        .route("/paths", get(paths))
        .route("/check-env", get(check_env))
        .route("/list-env", get(list_env_files))
        .route("/read-env", get(read_env_file))
        .route("/write-env", post(write_env_file))
        .route("/sync-env", post(sync_env_files))
        .route("/browse", get(browse_dir))
        .route("/save", post(save_state))
        .route("/resurrect", post(resurrect_state))
        .route("/shutdown", post(shutdown))
        .route("/restart", post(restart))
        .route("/open-folder", post(open_folder))
        .with_state(state)
}

// @group Utilities > EnvFiles : Returns true if a filename is an env-style file (.env, .env.*, *.env)
pub fn is_env_filename(name: &str) -> bool {
    name == ".env"
        || name.starts_with(".env.")
        || (name.ends_with(".env") && name.len() > 4)
}

// @group Utilities > EnvFiles : Lists all env-style files in a directory (sorted alphabetically)
pub fn list_env_files_in(dir: &str) -> Vec<(String, String)> {
    let path = std::path::Path::new(dir);
    match std::fs::read_dir(path) {
        Ok(entries) => {
            let mut files: Vec<(String, String)> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !is_env_filename(&name) {
                        return None;
                    }
                    let file_path = e.path().to_string_lossy().to_string();
                    Some((name, file_path))
                })
                .collect();
            // .env first, then alphabetical
            files.sort_by(|a, b| {
                if a.0 == ".env" {
                    std::cmp::Ordering::Less
                } else if b.0 == ".env" {
                    std::cmp::Ordering::Greater
                } else {
                    a.0.cmp(&b.0)
                }
            });
            files
        }
        Err(_) => vec![],
    }
}

// @group APIEndpoints > System : GET /system/paths
async fn paths() -> Json<Value> {
    Json(json!({
        "data_dir": crate::config::paths::data_dir().to_string_lossy(),
        "log_dir":  crate::config::paths::log_dir().to_string_lossy(),
    }))
}

// @group APIEndpoints > System : GET /system/health
async fn health(State(state): State<Arc<DaemonState>>) -> Json<Value> {
    let uptime = (Utc::now() - state.started_at).num_seconds().max(0) as u64;
    let count = state.manager.list().await.len();
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_secs": uptime,
        "process_count": count,
    }))
}

// @group APIEndpoints > System : POST /system/save
async fn save_state(State(state): State<Arc<DaemonState>>) -> Result<Json<Value>, ApiError> {
    state.save_to_disk().await.map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true, "message": "state saved" })))
}

// @group APIEndpoints > System : POST /system/resurrect
async fn resurrect_state(State(state): State<Arc<DaemonState>>) -> Result<Json<Value>, ApiError> {
    let saved = DaemonState::load_from_disk().await.map_err(ApiError::from)?;
    let count = saved.apps.len();
    state.restore(saved).await;
    Ok(Json(json!({ "success": true, "message": format!("restored {count} processes") })))
}

// @group APIEndpoints > System : GET /system/browse?path=<dir>
// Lists directory contents. Empty path → Windows drive list. Dirs sorted first, then alpha.
async fn browse_dir(Query(params): Query<HashMap<String, String>>) -> Json<Value> {
    let path_str = params.get("path").cloned().unwrap_or_default();

    // Windows: empty path → enumerate all present drive letters
    #[cfg(target_os = "windows")]
    if path_str.is_empty() {
        let drives: Vec<Value> = (b'A'..=b'Z')
            .filter_map(|c| {
                let drive = format!("{}:\\", c as char);
                if std::path::Path::new(&drive).exists() {
                    Some(json!({ "name": drive, "path": drive, "is_dir": true }))
                } else {
                    None
                }
            })
            .collect();
        return Json(json!({ "path": "", "parent": Value::Null, "entries": drives }));
    }

    // Unix: empty path → root
    #[cfg(not(target_os = "windows"))]
    let path_str = if path_str.is_empty() { "/".to_string() } else { path_str };

    let path = std::path::Path::new(&path_str);
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().to_string());

    match std::fs::read_dir(path) {
        Ok(entries) => {
            let mut items: Vec<Value> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let is_dir = e.file_type().ok()?.is_dir();
                    let entry_path = e.path().to_string_lossy().to_string();
                    Some(json!({ "name": name, "path": entry_path, "is_dir": is_dir }))
                })
                .collect();
            // Directories first, then alphabetical case-insensitive
            items.sort_by(|a, b| {
                let a_dir = a["is_dir"].as_bool().unwrap_or(false);
                let b_dir = b["is_dir"].as_bool().unwrap_or(false);
                b_dir.cmp(&a_dir).then_with(|| {
                    a["name"].as_str().unwrap_or("").to_lowercase()
                        .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
                })
            });
            Json(json!({ "path": path_str, "parent": parent, "entries": items }))
        }
        Err(e) => Json(json!({
            "path": path_str,
            "parent": parent,
            "entries": [],
            "error": e.to_string(),
        })),
    }
}

// @group APIEndpoints > System : GET /system/check-env?path=<dir>
// Checks whether a .env file exists in the given directory. No auth — path is read-only stat.
async fn check_env(Query(params): Query<HashMap<String, String>>) -> Json<Value> {
    let dir = params.get("path").cloned().unwrap_or_default();
    let env_path = std::path::Path::new(&dir).join(".env");
    let exists = env_path.exists();
    Json(json!({
        "exists": exists,
        "path": env_path.to_string_lossy(),
    }))
}

// @group APIEndpoints > System : GET /system/list-env?path=<dir>
// Returns all env-style files (.env, .env.*, *.env) in the given directory.
async fn list_env_files(Query(params): Query<HashMap<String, String>>) -> Json<Value> {
    let dir = params.get("path").cloned().unwrap_or_default();
    let files = list_env_files_in(&dir);
    let result: Vec<Value> = files
        .into_iter()
        .map(|(name, path)| json!({ "name": name, "path": path }))
        .collect();
    Json(json!({ "files": result }))
}

// @group APIEndpoints > System : GET /system/read-env?path=<filepath>
// Reads the content of a specific env file by absolute path.
async fn read_env_file(Query(params): Query<HashMap<String, String>>) -> Json<Value> {
    let file_path = params.get("path").cloned().unwrap_or_default();
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Json(json!({ "content": "", "exists": false }));
    }
    match tokio::fs::read_to_string(path).await {
        Ok(content) => Json(json!({ "content": content, "exists": true })),
        Err(e) => Json(json!({ "content": "", "exists": false, "error": e.to_string() })),
    }
}

// @group APIEndpoints > System : POST /system/write-env
// Writes content to a specific env file by absolute path. Body: { path, content }.
async fn write_env_file(Json(body): Json<Value>) -> Json<Value> {
    let file_path = body["path"].as_str().unwrap_or("");
    let content = body["content"].as_str().unwrap_or("");

    if file_path.is_empty() {
        return Json(json!({ "success": false, "error": "path is required" }));
    }

    let path = std::path::Path::new(file_path);
    match tokio::fs::write(path, content).await {
        Ok(()) => Json(json!({ "success": true, "path": file_path })),
        Err(e) => Json(json!({ "success": false, "error": e.to_string() })),
    }
}

// @group APIEndpoints > System : POST /system/sync-env
// Syncs keys from a source env file to all other env files in the same directory.
// Keys present in source but missing from target are added with empty values.
// Existing values in targets are never overwritten.
// Body: { source_path: string } — directory is derived from source_path.
async fn sync_env_files(Json(body): Json<Value>) -> Json<Value> {
    let source_path_str = match body["source_path"].as_str() {
        Some(p) if !p.is_empty() => p,
        _ => return Json(json!({ "success": false, "error": "source_path is required" })),
    };

    let source_path = std::path::Path::new(source_path_str);
    let dir = match source_path.parent() {
        Some(d) => d,
        None => return Json(json!({ "success": false, "error": "cannot determine directory" })),
    };

    // Parse source file into (key, value) pairs preserving comments
    let source_content = match std::fs::read_to_string(source_path) {
        Ok(c) => c,
        Err(e) => return Json(json!({ "success": false, "error": format!("cannot read source: {e}") })),
    };

    let source_keys: Vec<String> = source_content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') { return None; }
            trimmed.split_once('=').map(|(k, _)| k.trim().to_string())
        })
        .collect();

    let dir_str = dir.to_string_lossy().to_string();
    let all_files = list_env_files_in(&dir_str);
    let source_name = source_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    let mut synced = 0usize;
    let mut errors: Vec<String> = vec![];

    for (name, path_str) in &all_files {
        if name == source_name { continue; }
        let target_path = std::path::Path::new(path_str);

        // Read existing target, gather its existing keys
        let existing_content = std::fs::read_to_string(target_path).unwrap_or_default();
        let existing_keys: std::collections::HashSet<String> = existing_content
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') { return None; }
                trimmed.split_once('=').map(|(k, _)| k.trim().to_string())
            })
            .collect();

        // Append missing keys with empty values
        let mut additions = String::new();
        for key in &source_keys {
            if !existing_keys.contains(key) {
                additions.push_str(&format!("{key}=\n"));
            }
        }

        if !additions.is_empty() {
            let sep = if existing_content.ends_with('\n') || existing_content.is_empty() { "" } else { "\n" };
            let new_content = format!("{existing_content}{sep}{additions}");
            if let Err(e) = std::fs::write(target_path, new_content) {
                errors.push(format!("{name}: {e}"));
            } else {
                synced += 1;
            }
        }
    }

    if errors.is_empty() {
        Json(json!({ "success": true, "synced_files": synced }))
    } else {
        Json(json!({ "success": false, "synced_files": synced, "errors": errors }))
    }
}

// @group APIEndpoints > System : POST /system/shutdown
async fn shutdown(State(state): State<Arc<DaemonState>>) -> Json<Value> {
    tokio::spawn(async move {
        let _ = state.save_to_disk().await;
        crate::utils::pid::remove_pid_file();
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        std::process::exit(0);
    });
    Json(json!({ "success": true, "message": "daemon shutting down" }))
}

// @group APIEndpoints > System : GET /system/stats — system-wide CPU %, RAM, and GPU (nvidia-smi)
async fn system_stats() -> Json<Value> {
    // sysinfo is sync and needs a sleep between CPU reads for an accurate %; use spawn_blocking
    let (cpu, ram_used, ram_total) = tokio::task::spawn_blocking(|| {
        use sysinfo::System;
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        std::thread::sleep(std::time::Duration::from_millis(500));
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        (sys.global_cpu_usage(), sys.used_memory(), sys.total_memory())
    })
    .await
    .unwrap_or((0.0, 0, 0));

    let gpu = gpu_stats();

    Json(json!({
        "cpu_percent": cpu,
        "ram_used_bytes": ram_used,
        "ram_total_bytes": ram_total,
        "gpu": gpu,
    }))
}

// @group Utilities > System : Parse nvidia-smi output for GPU utilization and VRAM — returns None if unavailable
fn gpu_stats() -> Option<Value> {
    let mut cmd = std::process::Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=name,utilization.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
    ]);
    // Suppress console window flash on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let line = stdout.lines().next()?.trim();
    let parts: Vec<&str> = line.splitn(4, ',').map(str::trim).collect();
    if parts.len() < 4 {
        return None;
    }
    let util: f32 = parts[1].parse().ok()?;
    let vram_used_mb: u64 = parts[2].parse().ok()?;
    let vram_total_mb: u64 = parts[3].parse().ok()?;
    Some(json!({
        "name": parts[0],
        "utilization_percent": util,
        "vram_used_bytes": vram_used_mb * 1024 * 1024,
        "vram_total_bytes": vram_total_mb * 1024 * 1024,
    }))
}

// @group APIEndpoints > System : POST /system/restart
// Saves state, spawns a delayed self-restart, then exits.
// Managed processes survive because runner uses CREATE_BREAKAWAY_FROM_JOB on Windows.
async fn restart(State(state): State<Arc<DaemonState>>) -> Json<Value> {
    let port = state.config.port;
    tokio::spawn(async move {
        let _ = state.save_to_disk().await;
        crate::utils::pid::remove_pid_file();

        // Spawn a detached process that waits for the port to free, then restarts the daemon.
        if let Ok(exe) = std::env::current_exe() {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                const DETACHED_PROCESS: u32 = 0x00000008;
                let cmd = format!(
                    "timeout /t 1 /nobreak >nul 2>&1 && \"{}\" --port {} daemon start",
                    exe.display(), port
                );
                let _ = std::process::Command::new("cmd")
                    .args(["/C", &cmd])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
                    .spawn();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let cmd = format!(
                    "sleep 1 && \"{}\" --port {} daemon start",
                    exe.display(), port
                );
                let _ = std::process::Command::new("sh")
                    .args(["-c", &cmd])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn();
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        std::process::exit(0);
    });
    Json(json!({ "success": true, "message": "daemon restarting" }))
}

// @group APIEndpoints > System : POST /system/open-folder — open a path in the OS file explorer
#[derive(serde::Deserialize)]
struct OpenFolderRequest {
    path: String,
}

async fn open_folder(Json(req): Json<OpenFolderRequest>) -> Json<Value> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer.exe")
            .arg(&req.path)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(&req.path)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&req.path)
            .spawn();
    }
    Json(json!({ "success": true }))
}
