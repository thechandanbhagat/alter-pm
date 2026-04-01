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
        .route("/{id}/terminal", post(open_terminal))
        .route("/{id}/logs", get(get_logs).delete(delete_logs))
        .route("/{id}/logs/dates", get(get_log_dates))
        .route("/{id}/logs/stream", get(stream_logs))
        .route("/{id}/metrics/history", get(get_metrics_history))
        .route("/{id}/logs/stats", get(get_log_stats))
        .route("/{id}/cron/history", get(get_cron_history))
        .route("/{id}/clone", post(clone_process))
        .route("/{id}/envfiles", get(list_envfiles))
        .route("/{id}/envfile", get(get_envfile).put(put_envfile))
        // Namespace bulk operations
        .route("/namespace/{ns}/start", post(start_namespace_processes))
        .route("/namespace/{ns}/stop", post(stop_namespace_processes))
        .route("/namespace/{ns}/restart", post(restart_namespace_processes))
        .with_state(state)
}

// @group Utilities > EnvFiles : Env filename validator (mirrors system.rs)
fn is_env_filename(name: &str) -> bool {
    name == ".env"
        || name.starts_with(".env.")
        || (name.ends_with(".env") && name.len() > 4)
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

    let cron = req.cron.clone();
    // Cron jobs default to autorestart=false — the scheduler drives re-runs
    let autorestart = req.autorestart.unwrap_or(cron.is_none());

    let config = AppConfig {
        name,
        script: req.script,
        args: req.args.unwrap_or_default(),
        cwd: req.cwd,
        instances: 1,
        autorestart,
        max_restarts: req.max_restarts.unwrap_or(10),
        restart_delay_ms: req.restart_delay_ms.unwrap_or(1000),
        namespace: req.namespace.unwrap_or_else(|| "default".to_string()),
        watch: req.watch.unwrap_or(false),
        watch_paths: req.watch_paths.unwrap_or_default(),
        watch_ignore: req.watch_ignore.unwrap_or_default(),
        env: req.env.unwrap_or_default(),
        log_file: None,
        error_file: None,
        max_log_size_mb: req.max_log_size_mb.unwrap_or(10),
        cron,
        cron_last_run: None,
        cron_next_run: None,
        notify: req.notify,
        log_alert: req.log_alert,
        env_file: None,
        health_check_url: None,
        health_check_interval_secs: 30,
        health_check_timeout_secs: 5,
        health_check_retries: 3,
        pre_start: None,
        post_start: None,
        pre_stop: None,
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
        .filter(|(s, _, _)| stream_filter == "all" || s == stream_filter)
        .map(|(stream, ts, content)| json!({ "stream": stream, "timestamp": ts, "content": content }))
        .collect();

    Ok(Json(json!({ "lines": filtered })))
}

// @group APIEndpoints > Logs : GET /processes/:id/logs/dates — list available rotated log dates + current log presence
async fn get_log_dates(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let log_dir = crate::config::paths::process_log_dir(&info.name);
    let has_current = log_dir.join("out.log").exists() || log_dir.join("err.log").exists();
    let dates = crate::logging::reader::list_log_dates(&log_dir)
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .collect::<Vec<_>>();
    Ok(Json(json!({ "dates": dates, "has_current": has_current })))
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

    // Build updated config — preserve existing name/namespace if not provided
    let existing = state.manager.get(id).await.map_err(ApiError::from)?;
    let name = req.name.unwrap_or(existing.name);
    let namespace = req.namespace.unwrap_or(existing.namespace);

    let cron = req.cron.clone().or(existing.cron);
    let autorestart = req.autorestart.unwrap_or(cron.is_none());

    let config = AppConfig {
        name,
        script: req.script,
        args: req.args.unwrap_or_default(),
        cwd: req.cwd,
        instances: 1,
        autorestart,
        max_restarts: req.max_restarts.unwrap_or(10),
        restart_delay_ms: req.restart_delay_ms.unwrap_or(1000),
        namespace,
        watch: req.watch.unwrap_or(false),
        watch_paths: req.watch_paths.unwrap_or_default(),
        watch_ignore: req.watch_ignore.unwrap_or_default(),
        env: req.env.unwrap_or_default(),
        log_file: None,
        error_file: None,
        max_log_size_mb: req.max_log_size_mb.unwrap_or(10),
        cron,
        cron_last_run: None,
        cron_next_run: None,
        notify: req.notify,
        log_alert: req.log_alert,
        env_file: None,
        health_check_url: None,
        health_check_interval_secs: 30,
        health_check_timeout_secs: 5,
        health_check_retries: 3,
        pre_start: None,
        post_start: None,
        pre_stop: None,
    };

    let info = state.manager.update(id, config).await.map_err(ApiError::from)?;
    let s = state.clone(); tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok(Json(json!(info)))
}

// @group APIEndpoints > Process : POST /processes/:id/terminal
// Opens a new visible terminal window in the process's working directory.
// On Windows: spawns Windows Terminal (wt) falling back to cmd.exe.
// On Unix: spawns xterm as a fallback.
async fn open_terminal(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let cwd = info.cwd.unwrap_or_else(|| ".".to_string());

    #[cfg(target_os = "windows")]
    {
        // Try Windows Terminal first, fall back to cmd.exe
        let launched = std::process::Command::new("wt")
            .args(["--startingDirectory", &cwd])
            .spawn()
            .is_ok();
        if !launched {
            std::process::Command::new("cmd")
                .args(["/C", "start", "cmd.exe"])
                .current_dir(&cwd)
                .spawn()
                .map_err(|e| ApiError::internal(format!("failed to open terminal: {e}")))?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xterm")
            .current_dir(&cwd)
            .spawn()
            .map_err(|e| ApiError::internal(format!("failed to open terminal: {e}")))?;
    }

    Ok(Json(json!({ "success": true, "message": "terminal opened" })))
}

// @group APIEndpoints > Process : GET /processes/:id/cron/history
async fn get_cron_history(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    Ok(Json(json!({ "runs": info.cron_run_history })))
}

// @group APIEndpoints > LogStats : GET /processes/:id/logs/stats — full-day 5-minute log volume buckets read from disk
async fn get_log_stats(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let log_dir = crate::config::paths::process_log_dir(&info.name);
    let buckets = tokio::task::spawn_blocking(move || {
        crate::logging::reader::read_log_stats_today(&log_dir)
    })
    .await
    .map_err(|e| ApiError::from(anyhow::anyhow!("task join error: {e}")))?
    .map_err(ApiError::from)?;
    Ok(Json(json!({ "buckets": buckets })))
}

// @group APIEndpoints > Metrics : GET /processes/:id/metrics/history — rolling CPU + memory samples
async fn get_metrics_history(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let samples = state.manager.get_metrics_history(id).await;
    Ok(Json(json!({ "samples": samples })))
}

// @group APIEndpoints > Logs : DELETE /processes/:id/logs — remove all log files for a process
async fn delete_logs(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let log_dir = crate::config::paths::process_log_dir(&info.name);

    if log_dir.exists() {
        tokio::fs::remove_dir_all(&log_dir)
            .await
            .map_err(|e| ApiError::internal(format!("failed to delete logs: {e}")))?;
    }

    Ok(Json(json!({ "success": true, "message": "logs deleted" })))
}

// @group APIEndpoints > EnvFile : GET /processes/:id/envfiles — list all env files in process cwd
async fn list_envfiles(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let cwd = info.cwd.as_deref().unwrap_or(".");
    let files = crate::api::routes::system::list_env_files_in(cwd);
    let result: Vec<Value> = files
        .into_iter()
        .map(|(name, path)| json!({ "name": name, "path": path }))
        .collect();
    Ok(Json(json!({ "files": result })))
}

// @group APIEndpoints > EnvFile : GET /processes/:id/envfile?filename=.env — read env file from process cwd
async fn get_envfile(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let cwd = info.cwd.as_deref().unwrap_or(".");
    let filename = params.get("filename").map(|s| s.as_str()).unwrap_or(".env");
    if !is_env_filename(filename) {
        return Err(ApiError::bad_request("invalid env filename"));
    }
    let env_path = std::path::Path::new(cwd).join(filename);

    if !env_path.exists() {
        return Ok(Json(json!({ "content": "", "exists": false, "filename": filename })));
    }

    let content = tokio::fs::read_to_string(&env_path)
        .await
        .map_err(|e| ApiError::internal(format!("failed to read env file: {e}")))?;

    Ok(Json(json!({ "content": content, "exists": true, "filename": filename })))
}

// @group APIEndpoints > EnvFile : PUT /processes/:id/envfile — write env file to process cwd
// Body: { content, filename? } — filename defaults to ".env"
async fn put_envfile(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let cwd = info.cwd.as_deref().unwrap_or(".");
    let filename = body["filename"].as_str().unwrap_or(".env");
    if !is_env_filename(filename) {
        return Err(ApiError::bad_request("invalid env filename"));
    }
    let env_path = std::path::Path::new(cwd).join(filename);

    let content = body["content"].as_str().unwrap_or("").to_string();

    tokio::fs::write(&env_path, content)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write env file: {e}")))?;

    Ok(Json(json!({ "success": true, "path": env_path.to_string_lossy(), "filename": filename })))
}

// @group APIEndpoints > Namespace : POST /processes/namespace/:ns/start — start all stopped processes in namespace
async fn start_namespace_processes(
    State(state): State<Arc<DaemonState>>,
    Path(ns): Path<String>,
) -> Json<Value> {
    use crate::notifications::sender::ProcessEvent;
    let infos = state.manager.start_namespace(&ns).await;
    let s = state.clone();
    tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    if !infos.is_empty() {
        let infos_clone = infos.clone();
        let ns_clone = ns.clone();
        let notif = Arc::clone(&state.notifications);
        tokio::spawn(async move {
            crate::telegram::commands::fire_telegram_namespace_notification(&ns_clone, ProcessEvent::Started, &infos_clone).await;
            let store = notif.read().await;
            crate::notifications::sender::fire_namespace_event(&store, &ns_clone, &infos_clone, ProcessEvent::Started).await;
        });
    }
    Json(json!({ "namespace": ns, "started": infos.len(), "processes": infos }))
}

// @group APIEndpoints > Namespace : POST /processes/namespace/:ns/stop — stop all running processes in namespace
async fn stop_namespace_processes(
    State(state): State<Arc<DaemonState>>,
    Path(ns): Path<String>,
) -> Json<Value> {
    use crate::notifications::sender::ProcessEvent;
    let infos = state.manager.stop_namespace(&ns).await;
    let s = state.clone();
    tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    if !infos.is_empty() {
        let infos_clone = infos.clone();
        let ns_clone = ns.clone();
        let notif = Arc::clone(&state.notifications);
        tokio::spawn(async move {
            crate::telegram::commands::fire_telegram_namespace_notification(&ns_clone, ProcessEvent::Stopped, &infos_clone).await;
            let store = notif.read().await;
            crate::notifications::sender::fire_namespace_event(&store, &ns_clone, &infos_clone, ProcessEvent::Stopped).await;
        });
    }
    Json(json!({ "namespace": ns, "stopped": infos.len(), "processes": infos }))
}

// @group APIEndpoints > Namespace : POST /processes/namespace/:ns/restart — restart all processes in namespace
async fn restart_namespace_processes(
    State(state): State<Arc<DaemonState>>,
    Path(ns): Path<String>,
) -> Json<Value> {
    use crate::notifications::sender::ProcessEvent;
    let infos = state.manager.restart_namespace(&ns).await;
    let s = state.clone();
    tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    if !infos.is_empty() {
        let infos_clone = infos.clone();
        let ns_clone = ns.clone();
        let notif = Arc::clone(&state.notifications);
        tokio::spawn(async move {
            crate::telegram::commands::fire_telegram_namespace_notification(&ns_clone, ProcessEvent::Restarted, &infos_clone).await;
            let store = notif.read().await;
            crate::notifications::sender::fire_namespace_event(&store, &ns_clone, &infos_clone, ProcessEvent::Restarted).await;
        });
    }
    Json(json!({ "namespace": ns, "restarted": infos.len(), "processes": infos }))
}

// @group APIEndpoints > Process : POST /processes/:id/clone
// Duplicates an existing process config under a new name. Body: { name?: string }
// If name is omitted, appends "-copy" (or "-copy-2", "-copy-3", ...) to the original name.
async fn clone_process(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let id = resolve(&state, &id_str).await?;
    let entry = state
        .manager
        .registry
        .get(&id)
        .ok_or_else(|| ApiError::not_found("process not found"))?;
    let src_config = entry.read().await.config.clone();
    drop(entry);

    // Determine a unique clone name
    let base_name = body
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}-copy", src_config.name));

    let existing_names: std::collections::HashSet<String> = state
        .manager
        .list()
        .await
        .into_iter()
        .map(|p| p.name)
        .collect();

    let clone_name = if !existing_names.contains(&base_name) {
        base_name.clone()
    } else {
        let mut n = 2u32;
        loop {
            let candidate = format!("{base_name}-{n}");
            if !existing_names.contains(&candidate) {
                break candidate;
            }
            n += 1;
        }
    };

    let clone_config = AppConfig {
        name: clone_name,
        script: src_config.script,
        args: src_config.args,
        cwd: src_config.cwd,
        instances: 1,
        autorestart: src_config.autorestart,
        max_restarts: src_config.max_restarts,
        restart_delay_ms: src_config.restart_delay_ms,
        namespace: src_config.namespace,
        watch: src_config.watch,
        watch_paths: src_config.watch_paths,
        watch_ignore: src_config.watch_ignore,
        env: src_config.env,
        log_file: None,
        error_file: None,
        max_log_size_mb: src_config.max_log_size_mb,
        cron: src_config.cron,
        cron_last_run: None,
        cron_next_run: None,
        notify: src_config.notify,
        log_alert: src_config.log_alert,
        env_file: None,
        health_check_url: src_config.health_check_url,
        health_check_interval_secs: src_config.health_check_interval_secs,
        health_check_timeout_secs: src_config.health_check_timeout_secs,
        health_check_retries: src_config.health_check_retries,
        pre_start: src_config.pre_start,
        post_start: src_config.post_start,
        pre_stop: src_config.pre_stop,
    };

    let info = state.manager.start(clone_config).await.map_err(ApiError::from)?;
    let s = state.clone();
    tokio::spawn(async move { if let Err(e) = s.save_to_disk().await { tracing::warn!("auto-save failed: {e}"); } });
    Ok((StatusCode::CREATED, Json(json!(info))))
}

async fn resolve(state: &DaemonState, id_str: &str) -> Result<Uuid, ApiError> {
    state
        .manager
        .resolve_id(id_str)
        .await
        .map_err(|_| ApiError::not_found(format!("process not found: {id_str}")))
}
