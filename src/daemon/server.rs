// @group APIEndpoints : Axum HTTP server — route registration and shared state injection

use crate::api;
use crate::config::daemon_config::DaemonConfig;
use crate::daemon::state::DaemonState;
use crate::web;
use anyhow::Result;
use axum::Router;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub async fn run(state: Arc<DaemonState>, config: DaemonConfig) -> Result<()> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .merge(web::router())
        .nest("/api/v1", api::router(Arc::clone(&state)))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid address: {e}"))?;

    tracing::info!("HTTP server listening on http://{addr}");

    // @group Configuration : Bind with SO_REUSEADDR so we can reclaim zombie/TIME_WAIT ports instantly
    let socket = socket2::Socket::new(socket2::Domain::IPV4, socket2::Type::STREAM, None)?;
    socket.set_reuse_address(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&addr.into())?;
    socket.listen(1024)?;
    let listener = tokio::net::TcpListener::from_std(std::net::TcpListener::from(socket))?;

    axum::serve(listener, app).await?;
    Ok(())
}
