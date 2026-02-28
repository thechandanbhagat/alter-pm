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
        .route("/paths", get(paths))
        .route("/check-env", get(check_env))
        .route("/browse", get(browse_dir))
        .route("/save", post(save_state))
        .route("/resurrect", post(resurrect_state))
        .route("/shutdown", post(shutdown))
        .with_state(state)
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
