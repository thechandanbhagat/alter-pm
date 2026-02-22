// @group DatabaseOperations : Daemon shared state — process registry with disk persistence

use crate::config::daemon_config::DaemonConfig;
use crate::config::ecosystem::AppConfig;
use crate::models::process_info::ProcessInfo;
use crate::process::manager::ProcessManager;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
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
}

/// Live daemon state — shared across all Axum handlers
pub struct DaemonState {
    pub manager: ProcessManager,
    pub config: DaemonConfig,
    pub started_at: DateTime<Utc>,
}

impl DaemonState {
    pub fn new(config: DaemonConfig) -> Self {
        Self {
            manager: ProcessManager::new(),
            config,
            started_at: Utc::now(),
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
            })
            .collect();

        let saved = SavedState {
            saved_at: Some(Utc::now()),
            apps,
        };

        let path = crate::config::paths::state_file();
        let tmp = path.with_extension("json.tmp");
        let content = serde_json::to_string_pretty(&saved)?;
        std::fs::write(&tmp, content)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    // @group DatabaseOperations : Load persisted state from disk
    pub async fn load_from_disk() -> Result<SavedState> {
        let path = crate::config::paths::state_file();
        let content = std::fs::read_to_string(path)?;
        let state: SavedState = serde_json::from_str(&content)?;
        Ok(state)
    }

    // @group DatabaseOperations : Restore previously saved processes
    // Processes with autorestart_on_restore=true are started immediately.
    // All others are registered as Stopped so they appear in the list and can be started manually.
    pub async fn restore(&self, saved: SavedState) {
        for app in saved.apps {
            if app.autorestart_on_restore {
                if let Err(e) = self.manager.start(app.config).await {
                    tracing::warn!("failed to restore process '{}': {e}", app.id);
                }
            } else {
                self.manager.register_stopped(app.config).await;
            }
        }
    }
}

fn build_app_config(info: &ProcessInfo) -> AppConfig {
    use crate::config::ecosystem::AppConfig;
    use std::collections::HashMap;
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
        env: HashMap::new(),
        log_file: None,
        error_file: None,
        max_log_size_mb: 10,
    }
}
