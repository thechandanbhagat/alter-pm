// @group APIEndpoints : Notification settings CRUD endpoints

use crate::api::error::ApiError;
use crate::config::notification_store;
use crate::daemon::state::DaemonState;
use crate::models::notification::NotificationConfig;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/", get(get_notifications))
        .route("/global", put(update_global))
        .route("/namespace/{ns}", put(update_namespace).delete(delete_namespace))
        .route("/test", post(test_notification))
        .with_state(state)
}

// @group APIEndpoints > Notifications : GET /notifications — return full NotificationsStore
async fn get_notifications(
    State(state): State<Arc<DaemonState>>,
) -> Json<Value> {
    let store = state.notifications.read().await;
    Json(json!(*store))
}

// @group APIEndpoints > Notifications : PUT /notifications/global — update global config and persist
async fn update_global(
    State(state): State<Arc<DaemonState>>,
    Json(config): Json<NotificationConfig>,
) -> Result<Json<Value>, ApiError> {
    {
        let mut store = state.notifications.write().await;
        store.global = config;
        notification_store::save(&store)
            .map_err(|e| ApiError::internal(format!("failed to save notifications: {e}")))?;
    }
    Ok(Json(json!({ "success": true, "message": "global notifications updated" })))
}

// @group APIEndpoints > Notifications : PUT /notifications/namespace/:ns — update namespace config and persist
async fn update_namespace(
    State(state): State<Arc<DaemonState>>,
    Path(ns): Path<String>,
    Json(config): Json<NotificationConfig>,
) -> Result<Json<Value>, ApiError> {
    {
        let mut store = state.notifications.write().await;
        store.namespaces.insert(ns.clone(), config);
        notification_store::save(&store)
            .map_err(|e| ApiError::internal(format!("failed to save notifications: {e}")))?;
    }
    Ok(Json(json!({ "success": true, "message": format!("namespace '{ns}' notifications updated") })))
}

// @group APIEndpoints > Notifications : DELETE /notifications/namespace/:ns — remove namespace override
async fn delete_namespace(
    State(state): State<Arc<DaemonState>>,
    Path(ns): Path<String>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    {
        let mut store = state.notifications.write().await;
        if store.namespaces.remove(&ns).is_none() {
            return Err(ApiError::not_found(format!("namespace '{ns}' not found")));
        }
        notification_store::save(&store)
            .map_err(|e| ApiError::internal(format!("failed to save notifications: {e}")))?;
    }
    Ok((StatusCode::OK, Json(json!({ "success": true, "message": format!("namespace '{ns}' removed") }))))
}

// @group APIEndpoints > Notifications : POST /notifications/test — fire a test notification using the supplied config
async fn test_notification(
    State(state): State<Arc<DaemonState>>,
    Json(config): Json<NotificationConfig>,
) -> Result<Json<Value>, ApiError> {
    use crate::config::notification_store::NotificationsStore;
    use crate::models::notification::NotificationConfig as NC;
    use crate::models::process_info::ProcessInfo;
    use crate::models::process_status::ProcessStatus;
    use crate::notifications::sender::{fire_event, ProcessEvent};
    use chrono::Utc;
    use std::collections::HashMap;
    use uuid::Uuid;

    // Build a minimal fake NotificationsStore where the provided config is the global config
    // so fire_event picks it up unconditionally
    let mut test_events = config.events.clone();
    // Force all events on for the test so it fires regardless of toggle state
    test_events.on_start = true;

    let effective_config = NC {
        events: test_events,
        ..config
    };

    let store = NotificationsStore {
        global: effective_config,
        namespaces: HashMap::new(),
    };

    // Minimal synthetic ProcessInfo for the test payload
    let proc = ProcessInfo {
        id: Uuid::new_v4(),
        name: "test-process".to_string(),
        script: "test.js".to_string(),
        args: vec![],
        cwd: None,
        status: ProcessStatus::Running,
        pid: None,
        restart_count: 0,
        uptime_secs: None,
        last_exit_code: None,
        autorestart: false,
        max_restarts: 0,
        watch: false,
        namespace: state.notifications.read().await.namespaces.keys().next()
            .cloned()
            .unwrap_or_else(|| "default".to_string()),
        created_at: Utc::now(),
        started_at: None,
        stopped_at: None,
        cron: None,
        cron_next_run: None,
        cron_run_history: vec![],
        cpu_percent: None,
        memory_bytes: None,
        env: HashMap::new(),
        notify: None,
        health_status: None,
    };

    fire_event(&store, &proc, ProcessEvent::Started).await;

    Ok(Json(json!({ "success": true, "message": "test notification dispatched" })))
}
