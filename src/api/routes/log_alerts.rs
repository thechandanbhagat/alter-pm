// @group APIEndpoints : Log alert store — GET/PUT /log-alerts, namespace overrides

use crate::config::log_alert_config::{self, LogAlertOverride, LogAlertStore};
use axum::{extract::Path, http::StatusCode, routing::get, Json, Router};
use serde_json::{json, Value};

pub fn router() -> Router {
    Router::new()
        .route("/log-alerts", get(get_store).put(put_store))
        .route(
            "/log-alerts/namespace/{ns}",
            axum::routing::put(put_namespace).delete(delete_namespace),
        )
}

// @group APIEndpoints > LogAlerts : GET /log-alerts — return full store (global + namespace overrides)
async fn get_store() -> Json<Value> {
    let store = log_alert_config::load();
    Json(json!(store))
}

// @group APIEndpoints > LogAlerts : PUT /log-alerts — replace the full store
async fn put_store(Json(body): Json<LogAlertStore>) -> (StatusCode, Json<Value>) {
    match log_alert_config::save(&body) {
        Ok(_) => (StatusCode::OK, Json(json!(body))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))),
    }
}

// @group APIEndpoints > LogAlerts : PUT /log-alerts/namespace/:ns — upsert a namespace override
async fn put_namespace(
    Path(ns): Path<String>,
    Json(body): Json<LogAlertOverride>,
) -> (StatusCode, Json<Value>) {
    let mut store = log_alert_config::load();
    store.namespaces.insert(ns, body.clone());
    match log_alert_config::save(&store) {
        Ok(_) => (StatusCode::OK, Json(json!(body))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))),
    }
}

// @group APIEndpoints > LogAlerts : DELETE /log-alerts/namespace/:ns — remove a namespace override
async fn delete_namespace(Path(ns): Path<String>) -> (StatusCode, Json<Value>) {
    let mut store = log_alert_config::load();
    store.namespaces.remove(&ns);
    match log_alert_config::save(&store) {
        Ok(_) => (StatusCode::OK, Json(json!({ "deleted": ns }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))),
    }
}
