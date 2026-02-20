// @group APIEndpoints : REST API router assembly

pub mod error;
pub mod middleware;
pub mod routes;

use crate::daemon::state::DaemonState;
use axum::{routing::get, Router};
use std::sync::Arc;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .nest("/processes", routes::processes::router(Arc::clone(&state)))
        .nest("/system", routes::system::router(Arc::clone(&state)))
        .nest("/ecosystem", routes::ecosystem::router(Arc::clone(&state)))
}
