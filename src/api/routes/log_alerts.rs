// @group APIEndpoints : Log alert config — GET/PUT /log-alerts

use crate::config::log_alert_config::{self, LogAlertConfig};
use axum::{http::StatusCode, routing::get, Json, Router};
use serde_json::{json, Value};

pub fn router() -> Router {
    Router::new().route("/log-alerts", get(get_config).put(put_config))
}

// @group APIEndpoints > LogAlerts : GET /log-alerts — return current log alert settings
async fn get_config() -> Json<Value> {
    let cfg = log_alert_config::load();
    Json(json!(cfg))
}

// @group APIEndpoints > LogAlerts : PUT /log-alerts — save updated log alert settings
async fn put_config(Json(body): Json<LogAlertConfig>) -> (StatusCode, Json<Value>) {
    match log_alert_config::save(&body) {
        Ok(_) => (StatusCode::OK, Json(json!(body))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}
