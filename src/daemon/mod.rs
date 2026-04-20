// @group Exports : Daemon module re-exports

pub mod server;
pub mod signals;
pub mod state;

use crate::config::daemon_config::DaemonConfig;
use crate::daemon::state::DaemonState;
use anyhow::Result;
use std::sync::Arc;

/// Entry point for the daemon process.
/// Called when the binary is invoked with the internal --daemon flag.
pub async fn run(config: DaemonConfig) -> Result<()> {
    // Ensure data directories exist
    let data_dir = crate::config::paths::data_dir();
    let log_dir = crate::config::paths::log_dir();
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&log_dir)?;

    // Write PID file
    crate::utils::pid::write_pid_file()?;

    // @group BusinessLogic > Update : Clean up leftover .exe.old from a previous self-update (Windows only)
    #[cfg(windows)]
    if let Ok(exe) = std::env::current_exe() {
        let stem = exe.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let old_path = exe.with_file_name(format!("{stem}.exe.old"));
        if old_path.exists() {
            let _ = std::fs::remove_file(&old_path);
        }
    }

    // @group Configuration > Tracing : tokio-console mode (feature-gated, requires --cfg tokio_unstable)
    // Enable with: RUSTFLAGS="--cfg tokio_unstable" cargo run --features tokio-console
    // Then run `tokio-console` in a separate terminal to inspect async tasks live.
    #[cfg(feature = "tokio-console")]
    {
        console_subscriber::init();
        tracing::info!("tokio-console subscriber active — connect with `tokio-console`");
    }

    // @group Configuration > Tracing : Standard file-based tracing (production default)
    #[cfg(not(feature = "tokio-console"))]
    let _guard = {
        let daemon_log = crate::config::paths::daemon_log_file();
        let file_appender = tracing_appender::rolling::never(
            daemon_log.parent().unwrap_or(std::path::Path::new(".")),
            daemon_log.file_name().unwrap_or(std::ffi::OsStr::new("daemon.log")),
        );
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        // try_init instead of init — when daemon::run() is called from within the
        // Tauri GUI binary a subscriber may already be set; init() would panic and
        // silently kill the spawned task, leaving the HTTP server never started.
        let _ = tracing_subscriber::fmt()
            .with_writer(non_blocking)
            .with_ansi(false)
            .try_init();
        guard
    };

    tracing::info!("alter daemon starting on {}:{}", config.host, config.port);

    let state = Arc::new(DaemonState::new(config.clone()));

    // Restore previously saved processes
    if let Ok(saved) = DaemonState::load_from_disk().await {
        state.restore(saved).await;
    }

    // Register OS signal handlers
    signals::register_shutdown_handler(Arc::clone(&state)).await;

    // @group BusinessLogic > Telegram : Start Telegram bot polling loop (non-blocking background task)
    {
        let tg_state = Arc::clone(&state);
        tokio::spawn(async move {
            crate::telegram::bot::run(tg_state).await;
        });
    }

    // Start HTTP server (blocks until shutdown)
    server::run(state, config).await?;

    // Cleanup PID file on exit
    crate::utils::pid::remove_pid_file();

    tracing::info!("alter daemon stopped");
    Ok(())
}
