// @group BusinessLogic : OS signal handling — graceful daemon shutdown on SIGTERM/SIGINT

use crate::daemon::state::DaemonState;
use std::sync::Arc;

pub async fn register_shutdown_handler(state: Arc<DaemonState>) {
    tokio::spawn(async move {
        wait_for_shutdown_signal().await;
        tracing::info!("shutdown signal received — saving state and stopping");
        if let Err(e) = state.save_to_disk().await {
            tracing::error!("failed to save state on shutdown: {e}");
        }
        crate::utils::pid::remove_pid_file();
        std::process::exit(0);
    });
}

#[cfg(target_os = "windows")]
async fn wait_for_shutdown_signal() {
    use tokio::signal::windows::{ctrl_c, ctrl_break, ctrl_close};
    // Listen on all three — ctrl_c, ctrl_break, and console close
    let mut cc  = ctrl_c().expect("failed to register Ctrl-C handler");
    let mut cb  = ctrl_break().expect("failed to register Ctrl-Break handler");
    let mut ccl = ctrl_close().expect("failed to register Ctrl-Close handler");
    tokio::select! {
        _ = cc.recv()  => {},
        _ = cb.recv()  => {},
        _ = ccl.recv() => {},
    }
}

#[cfg(not(target_os = "windows"))]
async fn wait_for_shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut sigterm = signal(SignalKind::terminate()).expect("failed to register SIGTERM");
    let mut sigint = signal(SignalKind::interrupt()).expect("failed to register SIGINT");
    tokio::select! {
        _ = sigterm.recv() => {},
        _ = sigint.recv() => {},
    }
}
