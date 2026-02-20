// @group APIEndpoints : Ecosystem config file loading endpoint

use crate::api::error::ApiError;
use crate::daemon::state::DaemonState;
use crate::models::api_types::EcosystemRequest;
use axum::{extract::State, routing::post, Json, Router};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/", post(load_ecosystem))
        .with_state(state)
}

// @group APIEndpoints > Ecosystem : POST /ecosystem
async fn load_ecosystem(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<EcosystemRequest>,
) -> Result<Json<Value>, ApiError> {
    let path = Path::new(&req.path);
    let config = crate::config::ecosystem::EcosystemConfig::from_file(path)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let total = config.apps.len();
    let mut started = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for app in config.apps {
        match state.manager.start(app).await {
            Ok(_) => started += 1,
            Err(e) => errors.push(e.to_string()),
        }
    }

    Ok(Json(json!({
        "total": total,
        "started": started,
        "errors": errors,
    })))
}
