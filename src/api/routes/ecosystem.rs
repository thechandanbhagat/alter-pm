// @group APIEndpoints : Ecosystem config file loading endpoint

use crate::api::error::ApiError;
use crate::config::ecosystem::AppConfig;
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

// @group APIEndpoints > Ecosystem : POST /ecosystem — parse config file and start all apps
async fn load_ecosystem(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<EcosystemRequest>,
) -> Result<Json<Value>, ApiError> {
    let path = Path::new(&req.path);
    let config = crate::config::ecosystem::EcosystemConfig::from_file(path)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let total_apps = config.apps.len();
    let mut started = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for app in config.apps {
        let instances = app.instances.max(1);

        if instances == 1 {
            match state.manager.start(app).await {
                Ok(_)  => started += 1,
                Err(e) => errors.push(e.to_string()),
            }
        } else {
            // @group BusinessLogic > MultiInstance : Spawn N copies named {name}-0 … {name}-N-1
            for i in 0..instances {
                let mut inst = app.clone();
                inst.name = format!("{}-{}", app.name, i);
                match state.manager.start(inst).await {
                    Ok(_)  => started += 1,
                    Err(e) => errors.push(format!("{}-{}: {}", app.name, i, e)),
                }
            }
        }
    }

    Ok(Json(json!({
        "total":   total_apps,
        "started": started,
        "errors":  errors,
    })))
}

// @group Utilities > Ecosystem : Expand an AppConfig with instances > 1 into N named configs
pub fn expand_instances(app: AppConfig) -> Vec<AppConfig> {
    let n = app.instances.max(1);
    if n == 1 { return vec![app]; }
    (0..n).map(|i| {
        let mut inst = app.clone();
        inst.name = format!("{}-{}", app.name, i);
        inst
    }).collect()
}
