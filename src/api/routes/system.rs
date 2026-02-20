// @group APIEndpoints : System / daemon management endpoints

use crate::api::error::ApiError;
use crate::daemon::state::DaemonState;
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/save", post(save_state))
        .route("/resurrect", post(resurrect_state))
        .route("/shutdown", post(shutdown))
        .with_state(state)
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
