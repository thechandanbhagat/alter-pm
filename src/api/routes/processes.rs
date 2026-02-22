// @group APIEndpoints : Process CRUD endpoints

use crate::api::error::ApiError;
use crate::config::ecosystem::AppConfig;
use crate::daemon::state::DaemonState;
use crate::models::api_types::StartRequest;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/", get(list_processes).post(start_process))
        .route("/{id}", get(get_process).delete(delete_process).patch(update_process))
        .route("/{id}/stop", post(stop_process))
        .route("/{id}/start", post(start_stopped_process))
        .route("/{id}/restart", post(restart_process))
        .route("/{id}/reset", post(reset_process))
        .route("/{id}/logs", get(get_logs))
        .route("/{id}/logs/dates", get(get_log_dates))
        .route("/{id}/logs/stream", get(stream_logs))
        .with_state(state)
}

// @group APIEndpoints > Process : GET /processes
async fn list_processes(State(state): State<Arc<DaemonState>>) -> Json<Value> {
    let processes = state.manager.list().await;
    Json(json!({ "processes": processes }))
}

// @group APIEndpoints > Process : POST /processes
async fn start_process(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<StartRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let name = req.name.unwrap_or_else(|| {
        std::path::Path::new(&req.script)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("app")
            .to_string()
    });

    let config = AppConfig {
        name,
        script: req.script,
        args: req.args.unwrap_or_default(),
        cwd: req.cwd,
        instances: 1,
        autorestart: req.autorestart.unwrap_or(true),
        max_restarts: req.max_restarts.unwrap_or(10),
        restart_delay_ms: req.restart_delay_ms.unwrap_or(1000),
        watch: req.watch.unwrap_or(false),
        watch_paths: req.watch_paths.unwrap_or_default(),
        watch_ignore: req.watch_ignore.unwrap_or_default(),
        env: req.env.unwrap_or_default(),
        log_file: None,
        error_file: None,
        max_log_size_mb: req.max_log_size_mb.unwrap_or(10),
    };

    let info = state.manager.start(config).await.map_err(ApiError::from)?;
    let s = state.clone(); tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok((StatusCode::CREATED, Json(json!(info))))
}

// @group APIEndpoints > Process : GET /processes/:id
async fn get_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    Ok(Json(json!(info)))
}

// @group APIEndpoints > Process : DELETE /processes/:id
async fn delete_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    state.manager.delete(id).await.map_err(ApiError::from)?;
    let s = state.clone(); tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok(Json(json!({ "success": true, "message": "process deleted" })))
}

// @group APIEndpoints > Process : POST /processes/:id/stop
async fn stop_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.stop(id).await.map_err(ApiError::from)?;
    let s = state.clone(); tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok(Json(json!(info)))
}

// @group APIEndpoints > Process : POST /processes/:id/start
async fn start_stopped_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.restart(id).await.map_err(ApiError::from)?;
    let s = state.clone(); tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok(Json(json!(info)))
}

// @group APIEndpoints > Process : POST /processes/:id/restart
async fn restart_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.restart(id).await.map_err(ApiError::from)?;
    let s = state.clone(); tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok(Json(json!(info)))
}

// @group APIEndpoints > Process : POST /processes/:id/reset
async fn reset_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.reset(id).await.map_err(ApiError::from)?;
    Ok(Json(json!(info)))
}

// @group APIEndpoints > Logs : GET /processes/:id/logs?lines=N&type=all|stdout|stderr&date=YYYY-MM-DD
async fn get_logs(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    use crate::logging::reader::{read_merged_logs, read_merged_logs_for_date};
    use chrono::NaiveDate;

    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let lines: usize = params.get("lines").and_then(|v| v.parse().ok()).unwrap_or(100);
    let stream_filter = params.get("type").map(|s| s.as_str()).unwrap_or("all");
    let date_param = params.get("date").and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

    let log_dir = crate::config::paths::process_log_dir(&info.name);

    let merged = match date_param {
        Some(date) => read_merged_logs_for_date(&log_dir, date, lines).unwrap_or_default(),
        None       => read_merged_logs(&log_dir, lines).unwrap_or_default(),
    };

    let filtered: Vec<_> = merged
        .into_iter()
        .filter(|(s, _)| stream_filter == "all" || s == stream_filter)
        .map(|(stream, line)| json!({ "stream": stream, "content": line }))
        .collect();

    Ok(Json(json!({ "lines": filtered })))
}

// @group APIEndpoints > Logs : GET /processes/:id/logs/dates — list available rotated log dates
async fn get_log_dates(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let log_dir = crate::config::paths::process_log_dir(&info.name);
    let dates = crate::logging::reader::list_log_dates(&log_dir)
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .collect::<Vec<_>>();
    Ok(Json(json!({ "dates": dates })))
}

// @group APIEndpoints > Logs : GET /processes/:id/logs/stream (SSE)
async fn stream_logs(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<axum::response::Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>, ApiError> {
    use axum::response::sse::Event;
    use axum::response::Sse;
    use futures::stream;
    use tokio::time::{timeout, Duration};

    let id = resolve(&state, &id_str).await?;
    let mut rx = state.manager.subscribe_logs(id).await.map_err(ApiError::from)?;

    let event_stream = async_stream::stream! {
        loop {
            match timeout(Duration::from_secs(15), rx.recv()).await {
                // Got a log line — send it
                Ok(Ok(line)) => {
                    let data = serde_json::json!({
                        "timestamp": line.timestamp.to_rfc3339(),
                        "stream": format!("{:?}", line.stream).to_lowercase(),
                        "content": line.content,
                    });
                    yield Ok(Event::default().data(data.to_string()));
                }
                // Broadcast channel closed (process deleted) — end stream
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                // Client is too slow — skip missed messages and continue
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                    tracing::warn!("SSE client lagged by {n} messages");
                }
                // 15s timeout — send a keepalive comment to detect dead connections
                // If the client is gone, the next yield will fail and axum drops the stream
                Err(_) => {
                    yield Ok(Event::default().comment("keepalive"));
                }
            }
        }
    };

    Ok(Sse::new(event_stream))
}

// @group APIEndpoints > Process : PATCH /processes/:id — update config and apply
async fn update_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
    Json(req): Json<StartRequest>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;

    // Build updated config — preserve existing name if not provided
    let existing = state.manager.get(id).await.map_err(ApiError::from)?;
    let name = req.name.unwrap_or(existing.name);

    let config = AppConfig {
        name,
        script: req.script,
        args: req.args.unwrap_or_default(),
        cwd: req.cwd,
        instances: 1,
        autorestart: req.autorestart.unwrap_or(true),
        max_restarts: req.max_restarts.unwrap_or(10),
        restart_delay_ms: req.restart_delay_ms.unwrap_or(1000),
        watch: req.watch.unwrap_or(false),
        watch_paths: req.watch_paths.unwrap_or_default(),
        watch_ignore: req.watch_ignore.unwrap_or_default(),
        env: req.env.unwrap_or_default(),
        log_file: None,
        error_file: None,
        max_log_size_mb: req.max_log_size_mb.unwrap_or(10),
    };

    let info = state.manager.update(id, config).await.map_err(ApiError::from)?;
    let s = state.clone(); tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok(Json(json!(info)))
}

async fn resolve(state: &DaemonState, id_str: &str) -> Result<Uuid, ApiError> {
    state
        .manager
        .resolve_id(id_str)
        .await
        .map_err(|_| ApiError::not_found(format!("process not found: {id_str}")))
}
