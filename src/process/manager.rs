// @group BusinessLogic : Process manager — spawns, tracks, stops, and restarts all child processes

use crate::config::ecosystem::AppConfig;
use crate::logging::writer::LogWriter;
use crate::models::process_info::ProcessInfo;
use crate::models::process_status::ProcessStatus;
use crate::process::instance::{LogLine, ManagedProcess};
use crate::process::restarter::{watch_and_restart, RestartEvent};
use crate::process::runner::{spawn_process, wait_for_exit};
use crate::process::watcher::FileWatcher;
use anyhow::{anyhow, Result};
use chrono::Utc;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

pub type ProcessRegistry = DashMap<Uuid, Arc<RwLock<ManagedProcess>>>;

pub struct ProcessManager {
    pub registry: Arc<ProcessRegistry>,
    restart_tx: mpsc::Sender<RestartEvent>,
}

impl ProcessManager {
    pub fn new() -> Self {
        let registry = Arc::new(DashMap::new());
        let (restart_tx, restart_rx) = mpsc::channel::<RestartEvent>(256);

        let reg_clone = Arc::clone(&registry);
        let rtx_clone = restart_tx.clone();

        // @group BusinessLogic > Restarter : Background task that handles restart events
        tokio::spawn(async move {
            Self::restart_loop(reg_clone, restart_rx, rtx_clone).await;
        });

        Self { registry, restart_tx }
    }

    // @group BusinessLogic > Lifecycle : Start a new process from config
    pub async fn start(&self, config: AppConfig) -> Result<ProcessInfo> {
        let process = ManagedProcess::new(config);
        let id = process.id;

        let arc = Arc::new(RwLock::new(process));
        self.registry.insert(id, Arc::clone(&arc));

        self.do_spawn(id).await?;

        let guard = arc.read().await;
        Ok(guard.to_info())
    }

    // @group BusinessLogic > Lifecycle : Stop a running process
    pub async fn stop(&self, id: Uuid) -> Result<ProcessInfo> {
        let arc = self.get_arc(id)?;
        let mut proc = arc.write().await;

        if proc.status != ProcessStatus::Running && proc.status != ProcessStatus::Watching {
            return Err(anyhow!("process '{}' is not running", proc.config.name));
        }

        proc.status = ProcessStatus::Stopping;

        if let Some(pid) = proc.pid {
            kill_process(pid);
        }

        proc.status = ProcessStatus::Stopped;
        proc.pid = None;
        proc.stopped_at = Some(Utc::now());

        Ok(proc.to_info())
    }

    // @group BusinessLogic > Lifecycle : Restart a process (stop then start)
    pub async fn restart(&self, id: Uuid) -> Result<ProcessInfo> {
        {
            let arc = self.get_arc(id)?;
            let proc = arc.read().await;
            if proc.status == ProcessStatus::Running || proc.status == ProcessStatus::Watching {
                drop(proc);
                self.stop(id).await?;
            }
        }
        self.do_spawn(id).await?;
        let arc = self.get_arc(id)?;
        let guard = arc.read().await;
        Ok(guard.to_info())
    }

    // @group BusinessLogic > Lifecycle : Delete a process (stop + remove from registry)
    pub async fn delete(&self, id: Uuid) -> Result<()> {
        {
            let arc = self.get_arc(id)?;
            let proc = arc.read().await;
            if proc.status == ProcessStatus::Running || proc.status == ProcessStatus::Watching {
                drop(proc);
                self.stop(id).await?;
            }
        }
        self.registry.remove(&id);
        Ok(())
    }

    // @group BusinessLogic > Lifecycle : Update config for a process (stop → patch config → restart if was running)
    pub async fn update(&self, id: Uuid, patch: AppConfig) -> Result<ProcessInfo> {
        let was_running = {
            let arc = self.get_arc(id)?;
            let proc = arc.read().await;
            proc.status == ProcessStatus::Running || proc.status == ProcessStatus::Watching
        };

        if was_running {
            self.stop(id).await?;
        }

        {
            let arc = self.get_arc(id)?;
            let mut proc = arc.write().await;
            proc.config = patch;
        }

        if was_running {
            self.do_spawn(id).await?;
        }

        let arc = self.get_arc(id)?;
        let guard = arc.read().await;
        Ok(guard.to_info())
    }

    // @group BusinessLogic > Lifecycle : Reset restart counter
    pub async fn reset(&self, id: Uuid) -> Result<ProcessInfo> {
        let arc = self.get_arc(id)?;
        let mut proc = arc.write().await;
        proc.restart_count = 0;
        Ok(proc.to_info())
    }

    // @group BusinessLogic > Query : List all process infos
    pub async fn list(&self) -> Vec<ProcessInfo> {
        let mut result = Vec::new();
        for entry in self.registry.iter() {
            let proc = entry.value().read().await;
            result.push(proc.to_info());
        }
        result.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        result
    }

    // @group BusinessLogic > Query : Get a single process info by id
    pub async fn get(&self, id: Uuid) -> Result<ProcessInfo> {
        let arc = self.get_arc(id)?;
        let proc = arc.read().await;
        Ok(proc.to_info())
    }

    // @group BusinessLogic > Query : Subscribe to a process's log broadcast channel
    pub async fn subscribe_logs(&self, id: Uuid) -> Result<broadcast::Receiver<LogLine>> {
        let arc = self.get_arc(id)?;
        let proc = arc.read().await;
        Ok(proc.log_tx.subscribe())
    }

    // @group BusinessLogic > Utilities : Resolve process ID from name or UUID string
    pub async fn resolve_id(&self, name_or_id: &str) -> Result<Uuid> {
        if let Ok(id) = name_or_id.parse::<Uuid>() {
            if self.registry.contains_key(&id) {
                return Ok(id);
            }
        }
        for entry in self.registry.iter() {
            let proc = entry.value().read().await;
            if proc.config.name == name_or_id {
                return Ok(proc.id);
            }
        }
        Err(anyhow!("no process found with name or id: {name_or_id}"))
    }

    // @group BusinessLogic > Internal : Core spawn logic shared by start/restart
    async fn do_spawn(&self, id: Uuid) -> Result<()> {
        let arc = self.get_arc(id)?;

        let (config, log_tx) = {
            let mut proc = arc.write().await;
            proc.status = ProcessStatus::Starting;
            proc.started_at = Some(Utc::now());
            proc.stopped_at = None;

            // Open / rotate log files
            let log_dir = crate::config::paths::process_log_dir(&proc.config.name);
            std::fs::create_dir_all(&log_dir)?;
            let writer = LogWriter::new(&log_dir, proc.log_tx.clone())?;
            proc.log_writer = Some(writer);

            (proc.config.clone(), proc.log_tx.clone())
        };

        let (exit_tx, exit_rx) = mpsc::channel::<crate::process::runner::RunResult>(1);

        let child = spawn_process(
            id,
            &config.script,
            &config.args,
            config.cwd.as_deref(),
            &config.env,
            log_tx,
            exit_tx.clone(),
        )
        .await?;

        let pid = child.id();

        {
            let mut proc = arc.write().await;
            proc.pid = pid;
            proc.status = if config.watch { ProcessStatus::Watching } else { ProcessStatus::Running };
        }

        // Spawn background task to wait for process exit
        let rtx = self.restart_tx.clone();
        let restart_count = {
            let proc = arc.read().await;
            proc.restart_count
        };

        tokio::spawn(async move {
            wait_for_exit(child, exit_tx).await;
        });

        tokio::spawn(watch_and_restart(
            id,
            config.autorestart,
            config.max_restarts,
            config.restart_delay_ms,
            restart_count,
            exit_rx,
            rtx,
        ));

        // Start file watcher if enabled
        if config.watch && !config.watch_paths.is_empty() {
            let watch_restart_tx = {
                let (tx, mut rx) = mpsc::channel::<Uuid>(8);
                let manager_rtx = self.restart_tx.clone();
                tokio::spawn(async move {
                    while let Some(pid_id) = rx.recv().await {
                        let _ = manager_rtx
                            .send(RestartEvent::Restart { process_id: pid_id })
                            .await;
                    }
                });
                tx
            };

            let _ = FileWatcher::start(id, &config.watch_paths, &config.watch_ignore, watch_restart_tx);
        }

        Ok(())
    }

    // @group BusinessLogic > Internal : Background restart event loop
    async fn restart_loop(
        registry: Arc<ProcessRegistry>,
        mut rx: mpsc::Receiver<RestartEvent>,
        restart_tx: mpsc::Sender<RestartEvent>,
    ) {
        while let Some(event) = rx.recv().await {
            match event {
                RestartEvent::Restart { process_id } => {
                    if let Some(arc) = registry.get(&process_id) {
                        let arc = Arc::clone(arc.value());
                        let rtx = restart_tx.clone();
                        let registry2 = Arc::clone(&registry);

                        tokio::spawn(async move {
                            // Stop existing child if still alive
                            {
                                let mut proc = arc.write().await;
                                if let Some(pid) = proc.pid {
                                    kill_process(pid);
                                }
                                proc.pid = None;
                                proc.restart_count += 1;
                                proc.status = ProcessStatus::Starting;
                                proc.started_at = Some(Utc::now());
                            }

                            let (config, log_tx) = {
                                let mut proc = arc.write().await;
                                let log_dir = crate::config::paths::process_log_dir(&proc.config.name);
                                let _ = std::fs::create_dir_all(&log_dir);
                                if let Ok(writer) = LogWriter::new(&log_dir, proc.log_tx.clone()) {
                                    proc.log_writer = Some(writer);
                                }
                                (proc.config.clone(), proc.log_tx.clone())
                            };

                            let (exit_tx, exit_rx) = mpsc::channel::<crate::process::runner::RunResult>(1);

                            match spawn_process(
                                process_id,
                                &config.script,
                                &config.args,
                                config.cwd.as_deref(),
                                &config.env,
                                log_tx,
                                exit_tx.clone(),
                            ).await {
                                Ok(child) => {
                                    let pid = child.id();
                                    {
                                        let mut proc = arc.write().await;
                                        proc.pid = pid;
                                        proc.status = if config.watch {
                                            ProcessStatus::Watching
                                        } else {
                                            ProcessStatus::Running
                                        };
                                    }
                                    let restart_count = { arc.read().await.restart_count };
                                    tokio::spawn(async move {
                                        wait_for_exit(child, exit_tx).await;
                                    });
                                    tokio::spawn(watch_and_restart(
                                        process_id,
                                        config.autorestart,
                                        config.max_restarts,
                                        config.restart_delay_ms,
                                        restart_count,
                                        exit_rx,
                                        rtx,
                                    ));
                                }
                                Err(e) => {
                                    tracing::error!("failed to respawn process {process_id}: {e}");
                                    if let Some(arc_entry) = registry2.get(&process_id) {
                                        let mut proc = arc_entry.write().await;
                                        proc.status = ProcessStatus::Errored;
                                    }
                                }
                            }
                        });
                    }
                }

                RestartEvent::Exited { process_id, exit_code } => {
                    if let Some(arc) = registry.get(&process_id) {
                        let mut proc = arc.write().await;
                        proc.status = ProcessStatus::Stopped;
                        proc.pid = None;
                        proc.last_exit_code = exit_code;
                        proc.stopped_at = Some(Utc::now());
                    }
                }

                RestartEvent::MaxRestartsReached { process_id, exit_code } => {
                    if let Some(arc) = registry.get(&process_id) {
                        let mut proc = arc.write().await;
                        proc.status = ProcessStatus::Errored;
                        proc.pid = None;
                        proc.last_exit_code = exit_code;
                        proc.stopped_at = Some(Utc::now());
                        tracing::warn!(
                            "process '{}' reached max restarts ({})",
                            proc.config.name,
                            proc.config.max_restarts
                        );
                    }
                }
            }
        }
    }

    fn get_arc(&self, id: Uuid) -> Result<Arc<RwLock<ManagedProcess>>> {
        self.registry
            .get(&id)
            .map(|e| Arc::clone(e.value()))
            .ok_or_else(|| anyhow!("process not found: {id}"))
    }
}

// @group Utilities : Platform-aware process tree kill
// On Windows, /T kills the entire process tree (cmd.exe → node/vite children).
// On Linux/Mac, kill the process group so all children are also terminated.
fn kill_process(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe {
            // Send SIGTERM to the process group (negative pid = group)
            libc::kill(-(pid as i32), libc::SIGTERM);
            // Fallback: also send to the process itself
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
}

#[cfg(not(target_os = "windows"))]
extern crate libc;
