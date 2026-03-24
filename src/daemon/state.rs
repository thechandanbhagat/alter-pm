// @group DatabaseOperations : Daemon shared state — process registry with disk persistence

use crate::config::auth_config::AuthConfig;
use crate::config::daemon_config::DaemonConfig;
use crate::config::ecosystem::AppConfig;
use crate::config::notification_store::NotificationsStore;
use crate::config::telegram_config::TelegramConfig;
use crate::models::cron_run::CronRun;
use crate::models::process_info::ProcessInfo;
use crate::process::manager::ProcessManager;
use anyhow::Result;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;


/// Persistent snapshot of process configs (saved to disk)
#[derive(Serialize, Deserialize, Default)]
pub struct SavedState {
    pub saved_at: Option<DateTime<Utc>>,
    pub apps: Vec<SavedApp>,
}

#[derive(Serialize, Deserialize)]
pub struct SavedApp {
    pub id: Uuid,
    pub config: AppConfig,
    pub restart_count: u32,
    pub autorestart_on_restore: bool,
    #[serde(default)]
    pub cron_run_history: Vec<CronRun>,
    /// PID of the process at the time state was last saved.
    /// Used on restore to detect and clean up orphaned OS processes.
    #[serde(default)]
    pub last_pid: Option<u32>,
    /// For cron jobs: true if the scheduler was active (Sleeping) at save time.
    /// false means the user had manually stopped it — do NOT re-arm the scheduler on restore.
    /// Defaults to true for backward compatibility with old state files.
    #[serde(default = "default_true")]
    pub cron_was_active: bool,
}

fn default_true() -> bool { true }

/// Live daemon state — shared across all Axum handlers
pub struct DaemonState {
    pub manager: ProcessManager,
    pub config: DaemonConfig,
    pub started_at: DateTime<Utc>,
    pub notifications: Arc<RwLock<NotificationsStore>>,
    /// Ephemeral GitHub Device Flow auth state — cleared after successful login or expiry
    pub ai_device_auth: Arc<tokio::sync::Mutex<Option<crate::models::ai::DeviceAuthState>>>,

    // @group Authentication : Session and auth state
    /// Active browser sessions: token → expiry timestamp
    pub sessions: Arc<DashMap<String, DateTime<Utc>>>,
    /// Auth config (password hash, master token, stored passkeys) — guarded for write access
    pub auth: Arc<RwLock<AuthConfig>>,

    // @group Configuration : Telegram bot config — guarded for hot reload
    pub telegram: Arc<RwLock<TelegramConfig>>,
}

impl DaemonState {
    pub fn new(config: DaemonConfig) -> Self {
        let notifications = Arc::new(RwLock::new(crate::config::notification_store::load()));

        let auth_cfg = crate::config::auth_config::load();

        let telegram_cfg = crate::config::telegram_config::load();

        Self {
            manager: ProcessManager::new(Arc::clone(&notifications)),
            config,
            started_at: Utc::now(),
            notifications,
            ai_device_auth: Arc::new(tokio::sync::Mutex::new(None)),
            sessions: Arc::new(DashMap::new()),
            auth: Arc::new(RwLock::new(auth_cfg)),
            telegram: Arc::new(RwLock::new(telegram_cfg)),
        }
    }

    // @group DatabaseOperations : Serialize current process list to JSON file
    pub async fn save_to_disk(&self) -> Result<()> {
        let processes = self.manager.list().await;
        let apps = processes
            .into_iter()
            .map(|p| SavedApp {
                id: p.id,
                config: build_app_config(&p),
                restart_count: p.restart_count,
                autorestart_on_restore: p.autorestart,
                cron_run_history: p.cron_run_history,
                last_pid: p.pid,
                // Cron scheduler was active if the job was Sleeping at save time.
                // Stopped = user manually stopped it; don't re-arm on next daemon start.
                cron_was_active: p.cron.is_some()
                    && !matches!(p.status, crate::models::process_status::ProcessStatus::Stopped),
            })
            .collect();

        let saved = SavedState {
            saved_at: Some(Utc::now()),
            apps,
        };

        let path = crate::config::paths::state_file();
        let content = serde_json::to_string_pretty(&saved)?;

        // Run blocking I/O on a dedicated thread to avoid stalling the async runtime.
        // Uses atomic tmp-then-rename pattern; falls back to a direct write on Windows
        // if MoveFileExW fails (e.g. due to antivirus locks on the destination).
        tokio::task::spawn_blocking(move || -> Result<()> {
            let tmp = path.with_extension("json.tmp");
            std::fs::write(&tmp, &content)?;
            if std::fs::rename(&tmp, &path).is_err() {
                let _ = std::fs::remove_file(&tmp);
                std::fs::write(&path, &content)?;
            }
            Ok(())
        })
        .await??;
        Ok(())
    }

    // @group DatabaseOperations : Load persisted state from disk
    pub async fn load_from_disk() -> Result<SavedState> {
        let path = crate::config::paths::state_file();
        let content = std::fs::read_to_string(path)?;
        let state: SavedState = serde_json::from_str(&content)?;
        Ok(state)
    }

    // @group DatabaseOperations : Restore previously saved processes on daemon startup.
    //
    // Strategy (PID-first):
    //   • Cron jobs     → always restore as Sleeping (kill any stale PID first to avoid duplicates)
    //   • last_pid alive  → re-adopt the running process; a watcher fires autorestart when it exits
    //   • last_pid dead   → mark Stopped; user decides when to restart
    //   • no last_pid     → mark Stopped (daemon crashed before the process was ever saved with a PID)
    //
    // This prevents both duplicate spawns and silent orphan accumulation.
    pub async fn restore(&self, saved: SavedState) {
        use crate::process::manager::{is_pid_alive, kill_orphan_pid};

        for app in saved.apps {
            if app.config.cron.is_some() {
                // Kill any stale PID first (cron jobs are idempotent)
                if let Some(pid) = app.last_pid {
                    if is_pid_alive(pid) {
                        tracing::info!(
                            "killing stale cron process '{}' (PID {}) before re-registering",
                            app.config.name, pid
                        );
                        kill_orphan_pid(pid);
                    }
                }
                if app.cron_was_active {
                    // Cron scheduler was running at shutdown — restore as Sleeping (re-arm scheduler)
                    if let Err(e) = self.manager.register_sleeping(app.id, app.config, app.cron_run_history).await {
                        tracing::warn!("failed to restore cron process '{}': {e}", app.id);
                    }
                } else {
                    // User had manually stopped this cron job — restore as Stopped, don't re-arm
                    tracing::info!(
                        "cron process '{}' was stopped at shutdown — restoring as stopped",
                        app.config.name
                    );
                    self.manager.register_stopped(app.id, app.config).await;
                }
                continue;
            }

            match app.last_pid {
                Some(pid) if is_pid_alive(pid) => {
                    // Process survived the daemon restart — re-adopt it with its saved ID
                    tracing::info!(
                        "re-adopting running process '{}' (PID {})",
                        app.config.name, pid
                    );
                    self.manager.register_running_adopted(app.id, app.config, pid).await;
                }
                Some(pid) => {
                    // Process died while daemon was down — mark stopped, let user restart
                    tracing::info!(
                        "process '{}' (PID {}) exited while daemon was down — marking stopped",
                        app.config.name, pid
                    );
                    self.manager.register_stopped(app.id, app.config).await;
                }
                None => {
                    // No PID was ever saved — mark stopped
                    self.manager.register_stopped(app.id, app.config).await;
                }
            }
        }
    }
}

fn build_app_config(info: &ProcessInfo) -> AppConfig {
    use crate::config::ecosystem::AppConfig;
    AppConfig {
        name: info.name.clone(),
        script: info.script.clone(),
        args: info.args.clone(),
        cwd: info.cwd.clone(),
        instances: 1,
        autorestart: info.autorestart,
        max_restarts: info.max_restarts,
        restart_delay_ms: 1000,
        namespace: info.namespace.clone(),
        watch: info.watch,
        watch_paths: vec![],
        watch_ignore: vec![],
        env: info.env.clone(),
        log_file: None,
        error_file: None,
        max_log_size_mb: 10,
        cron: info.cron.clone(),
        cron_last_run: None,
        cron_next_run: info.cron_next_run,
        notify: info.notify.clone(),
        log_alert: info.log_alert.clone(),
        env_file: None,
        health_check_url: None,
        health_check_interval_secs: 30,
        health_check_timeout_secs: 5,
        health_check_retries: 3,
        pre_start: None,
        post_start: None,
        pre_stop: None,
    }
}
