// @group APIEndpoints : REST API router assembly

pub mod error;
pub mod middleware;
pub mod routes;

use crate::daemon::state::DaemonState;
use axum::{middleware as axum_middleware, Router};
use std::sync::Arc;

pub fn router(state: Arc<DaemonState>) -> Router {
    // @group Authentication : Protected routes — require valid bearer token
    let protected = Router::new()
        .nest("/processes", routes::processes::router(Arc::clone(&state)))
        .nest("/system", routes::system::router(Arc::clone(&state))
            .merge(routes::ui_settings::router()))
        .nest("/ecosystem", routes::ecosystem::router(Arc::clone(&state)))
        .nest("/scripts", routes::scripts::router(Arc::clone(&state)))
        .nest("/notifications", routes::notifications::router(Arc::clone(&state)))
        .nest("/ai", routes::ai::router(Arc::clone(&state)))
        .nest("/telegram", routes::telegram::router(Arc::clone(&state)))
        .nest("/ports", routes::ports::router())
        .nest("/tunnels", routes::tunnels::router(Arc::clone(&state)))
        .nest("/terminals", routes::terminal::router(Arc::clone(&state))
            .merge(routes::terminal_history::router()))
        .merge(routes::metrics::router(Arc::clone(&state)))
        .merge(routes::log_alerts::router())
        .merge(routes::startup::router())
        .merge(routes::remote_servers::router())
        .nest("/system/update", routes::update::router(Arc::clone(&state)))
        .merge(routes::git::router(Arc::clone(&state)))
        .route_layer(axum_middleware::from_fn_with_state(
            Arc::clone(&state),
            middleware::require_auth,
        ));

    // @group Authentication : Public routes — no auth required
    Router::new()
        .nest("/auth", routes::auth::router(Arc::clone(&state)))
        .merge(protected)
}
