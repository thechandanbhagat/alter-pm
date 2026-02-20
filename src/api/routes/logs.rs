// @group APIEndpoints : Standalone log management endpoints (flush)
// Note: per-process log streaming is in processes.rs

use crate::api::error::ApiError;
use crate::daemon::state::DaemonState;
use axum::{extract::{Path, State}, routing::delete, Json, Router};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/{id}/logs", delete(flush_logs))
        .with_state(state)
}

// @group APIEndpoints > Logs : DELETE /processes/:id/logs — delete log files
async fn flush_logs(
    State(state): State<Arc<DaemonState>>,
    Path(id_str): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = state.manager.resolve_id(&id_str).await
        .map_err(|_| ApiError::not_found(format!("process not found: {id_str}")))?;

    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let log_dir = crate::config::paths::process_log_dir(&info.name);

    for entry in ["out.log", "err.log"] {
        let path = log_dir.join(entry);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| ApiError::internal(format!("failed to delete {entry}: {e}")))?;
        }
    }

    Ok(Json(json!({ "success": true, "message": "logs flushed" })))
}
