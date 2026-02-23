// @group BusinessLogic : Process manager — spawns, tracks, stops, and restarts all child processes

use crate::config::ecosystem::AppConfig;
use crate::logging::writer::LogWriter;
use crate::models::cron_run::{CronRun, MAX_CRON_HISTORY};
use crate::models::process_info::ProcessInfo;
use crate::models::process_status::ProcessStatus;
use crate::process::instance::{LogLine, ManagedProcess};
use crate::process::restarter::{watch_and_restart, RestartEvent};
use crate::process::runner::{spawn_process, wait_for_exit};
use crate::process::scheduler::{next_run, CronScheduler};
use crate::process::watcher::FileWatcher;
use anyhow::{anyhow, Result};
use chrono::Utc;
use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::Arc;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tokio::sync::mpsc;
use tokio::sync::{broadcast, Mutex, RwLock};
use uuid::Uuid;

pub type ProcessRegistry = DashMap<Uuid, Arc<RwLock<ManagedProcess>>>;

pub struct ProcessManager {
    pub registry: Arc<ProcessRegistry>,
    restart_tx: mpsc::Sender<RestartEvent>,
    /// Cron trigger channel — scheduler sends process_id when the next tick fires
    cron_trigger_tx: mpsc::Sender<Uuid>,
    /// Active CronScheduler handles, keyed by process_id
    cron_schedulers: Arc<Mutex<HashMap<Uuid, CronScheduler>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        let registry = Arc::new(DashMap::new());
        let (restart_tx, restart_rx) = mpsc::channel::<RestartEvent>(256);
        let (cron_trigger_tx, cron_trigger_rx) = mpsc::channel::<Uuid>(256);
        let cron_schedulers: Arc<Mutex<HashMap<Uuid, CronScheduler>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let reg_clone = Arc::clone(&registry);
        let rtx_clone = restart_tx.clone();

        // @group BusinessLogic > Restarter : Background task that handles restart events
        tokio::spawn(async move {
            Self::restart_loop(reg_clone, restart_rx, rtx_clone).await;
        });

        let reg_cron = Arc::clone(&registry);
        let cron_sched_clone = Arc::clone(&cron_schedulers);
        let ctrigger_tx_clone = cron_trigger_tx.clone();

        // @group BusinessLogic > Cron : Background task that handles cron trigger events
        tokio::spawn(async move {
            Self::cron_trigger_loop(reg_cron, cron_trigger_rx, cron_sched_clone, ctrigger_tx_clone).await;
        });

        let reg_metrics = Arc::clone(&registry);

        // @group BusinessLogic > Metrics : Background task that polls CPU and memory per process
        tokio::spawn(async move {
            Self::metrics_loop(reg_metrics).await;
        });

        Self {
            registry,
            restart_tx,
            cron_trigger_tx,
            cron_schedulers,
        }
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

    // @group BusinessLogic > Lifecycle : Register a process as Stopped without spawning (used on restore)
    pub async fn register_stopped(&self, config: AppConfig) -> ProcessInfo {
        let process = ManagedProcess::new(config);
        let id = process.id;
        let info = process.to_info();
        let arc = Arc::new(RwLock::new(process));
        self.registry.insert(id, arc);
        info
    }

    // @group BusinessLogic > Lifecycle : Register a cron process as Sleeping without spawning (used on restore)
    pub async fn register_sleeping(&self, config: AppConfig, cron_run_history: Vec<CronRun>) -> Result<ProcessInfo> {
        let mut process = ManagedProcess::new(config.clone());
        process.status = ProcessStatus::Sleeping;
        process.cron_run_history = cron_run_history;
        if let Some(expr) = &config.cron {
            process.cron_next_run = next_run(expr);
        }
        let id = process.id;
        let info = process.to_info();
        let arc = Arc::new(RwLock::new(process));
        self.registry.insert(id, Arc::clone(&arc));

        // Start the scheduler so it fires at the right time
        if let Some(expr) = &config.cron {
            let scheduler = CronScheduler::start(id, expr, self.cron_trigger_tx.clone())?;
            self.cron_schedulers.lock().await.insert(id, scheduler);
        }

        Ok(info)
    }

    // @group BusinessLogic > Lifecycle : Stop a running process
    pub async fn stop(&self, id: Uuid) -> Result<ProcessInfo> {
        let arc = self.get_arc(id)?;
        let mut proc = arc.write().await;

        let stoppable = matches!(
            proc.status,
            ProcessStatus::Running | ProcessStatus::Watching | ProcessStatus::Sleeping
        );
        if !stoppable {
            return Err(anyhow!("process '{}' is not running or sleeping", proc.config.name));
        }

        // Kill the cron scheduler if one exists
        if proc.config.cron.is_some() {
            if let Some(sched) = self.cron_schedulers.lock().await.remove(&id) {
                sched.abort();
            }
        }

        proc.status = ProcessStatus::Stopping;

        if let Some(pid) = proc.pid {
            kill_process(pid);
        }

        proc.status = ProcessStatus::Stopped;
        proc.pid = None;
        proc.stopped_at = Some(Utc::now());
        proc.cron_next_run = None;

        Ok(proc.to_info())
    }

    // @group BusinessLogic > Lifecycle : Restart a process (stop then start)
    pub async fn restart(&self, id: Uuid) -> Result<ProcessInfo> {
        {
            let arc = self.get_arc(id)?;
            let proc = arc.read().await;
            let is_active = matches!(
                proc.status,
                ProcessStatus::Running | ProcessStatus::Watching | ProcessStatus::Sleeping
            );
            if is_active {
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
            let is_active = matches!(
                proc.status,
                ProcessStatus::Running | ProcessStatus::Watching | ProcessStatus::Sleeping
            );
            if is_active {
                drop(proc);
                self.stop(id).await?;
            }
        }
        // Clean up scheduler if not already removed by stop()
        if let Some(sched) = self.cron_schedulers.lock().await.remove(&id) {
            sched.abort();
        }
        self.registry.remove(&id);
        Ok(())
    }

    // @group BusinessLogic > Lifecycle : Update config for a process (stop → patch config → restart if was running)
    pub async fn update(&self, id: Uuid, patch: AppConfig) -> Result<ProcessInfo> {
        let was_active = {
            let arc = self.get_arc(id)?;
            let proc = arc.read().await;
            matches!(
                proc.status,
                ProcessStatus::Running | ProcessStatus::Watching | ProcessStatus::Sleeping
            )
        };

        if was_active {
            self.stop(id).await?;
        }

        {
            let arc = self.get_arc(id)?;
            let mut proc = arc.write().await;
            proc.config = patch;
        }

        if was_active {
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
            proc.cron_next_run = None;

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
            // Cron jobs don't use autorestart — they're driven by the scheduler.
            // Watch mode and normal mode keep existing behaviour.
            proc.status = if config.watch {
                ProcessStatus::Watching
            } else {
                ProcessStatus::Running
            };
        }

        // For cron jobs we force autorestart=false so watch_and_restart just fires Exited.
        // The cron_trigger_loop handles re-spawning on the next tick.
        let effective_autorestart = if config.cron.is_some() {
            false
        } else {
            config.autorestart
        };

        let restart_count = {
            let proc = arc.read().await;
            proc.restart_count
        };

        tokio::spawn(async move {
            wait_for_exit(child, exit_tx).await;
        });

        // @group BusinessLogic > Restarter : Spawn the exit-watcher / auto-restart task
        let rtx = self.restart_tx.clone();
        tokio::spawn(watch_and_restart(
            id,
            effective_autorestart,
            config.max_restarts,
            config.restart_delay_ms,
            restart_count,
            exit_rx,
            rtx,
        ));

        // Start file watcher if watch mode is enabled
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

        // @group BusinessLogic > Cron : Start (or replace) the cron scheduler for this process
        if let Some(expr) = &config.cron {
            // Remove old scheduler if we're restarting
            if let Some(old) = self.cron_schedulers.lock().await.remove(&id) {
                old.abort();
            }
            let scheduler = CronScheduler::start(id, expr, self.cron_trigger_tx.clone())?;
            self.cron_schedulers.lock().await.insert(id, scheduler);
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
                        // Cron jobs transition to Sleeping instead of Stopped
                        proc.status = if proc.config.cron.is_some() {
                            ProcessStatus::Sleeping
                        } else {
                            ProcessStatus::Stopped
                        };
                        proc.pid = None;
                        proc.last_exit_code = exit_code;
                        proc.stopped_at = Some(Utc::now());
                        // Update next run time for display
                        if let Some(expr) = &proc.config.cron.clone() {
                            proc.cron_next_run = next_run(expr);
                        }
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

    // @group BusinessLogic > Cron : Background loop that re-spawns cron processes on each tick
    async fn cron_trigger_loop(
        registry: Arc<ProcessRegistry>,
        mut rx: mpsc::Receiver<Uuid>,
        cron_schedulers: Arc<Mutex<HashMap<Uuid, CronScheduler>>>,
        cron_trigger_tx: mpsc::Sender<Uuid>,
    ) {
        while let Some(process_id) = rx.recv().await {
            if let Some(arc) = registry.get(&process_id) {
                let arc = Arc::clone(arc.value());
                let cron_schedulers = Arc::clone(&cron_schedulers);
                let trigger_tx = cron_trigger_tx.clone();

                tokio::spawn(async move {
                    let config = {
                        let proc = arc.read().await;
                        // Only fire if still in Sleeping state (not manually stopped)
                        if proc.status != ProcessStatus::Sleeping {
                            return;
                        }
                        proc.config.clone()
                    };

                    // Capture start time before spawning for duration calculation
                    let run_started_at = Utc::now();

                    // Transition to Starting
                    {
                        let mut proc = arc.write().await;
                        proc.status = ProcessStatus::Starting;
                        proc.started_at = Some(run_started_at);
                        proc.stopped_at = None;
                        proc.cron_next_run = None;
                    }

                    let log_dir = crate::config::paths::process_log_dir(&config.name);
                    let _ = std::fs::create_dir_all(&log_dir);

                    let log_tx = {
                        let mut proc = arc.write().await;
                        if let Ok(writer) = LogWriter::new(&log_dir, proc.log_tx.clone()) {
                            proc.log_writer = Some(writer);
                        }
                        proc.log_tx.clone()
                    };

                    let (exit_tx, exit_rx) = mpsc::channel::<crate::process::runner::RunResult>(1);

                    // We need a local restart_tx to wire up watch_and_restart.
                    // Since cron jobs use autorestart=false, watch_and_restart will just send Exited
                    // which the restart_loop will catch and transition back to Sleeping.
                    // We create a one-shot dummy channel — the Exited event goes to restart_loop.
                    // But we don't have access to restart_tx here, so we use a side channel approach:
                    // Send a RestartEvent::Exited through a local mpsc that immediately updates state.
                    let (local_restart_tx, mut local_restart_rx) =
                        mpsc::channel::<crate::process::restarter::RestartEvent>(4);
                    let arc2 = Arc::clone(&arc);

                    // Handle the exit event inline — record run history and transition to Sleeping
                    tokio::spawn(async move {
                        if let Some(event) = local_restart_rx.recv().await {
                            if let crate::process::restarter::RestartEvent::Exited { exit_code, .. } = event {
                                let finished_at = Utc::now();
                                let duration_secs = (finished_at - run_started_at)
                                    .num_seconds()
                                    .max(0) as u64;
                                let run = CronRun {
                                    run_at: run_started_at,
                                    exit_code,
                                    duration_secs,
                                };
                                let mut proc = arc2.write().await;
                                proc.status = ProcessStatus::Sleeping;
                                proc.pid = None;
                                proc.last_exit_code = exit_code;
                                proc.stopped_at = Some(finished_at);
                                // Append to history, capped at MAX_CRON_HISTORY
                                proc.cron_run_history.push(run);
                                if proc.cron_run_history.len() > MAX_CRON_HISTORY {
                                    proc.cron_run_history.remove(0);
                                }
                                if let Some(expr) = &proc.config.cron.clone() {
                                    proc.cron_next_run = next_run(expr);
                                }
                            }
                        }
                    });

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
                                proc.status = ProcessStatus::Running;
                            }

                            let restart_count = { arc.read().await.restart_count };
                            tokio::spawn(async move {
                                wait_for_exit(child, exit_tx).await;
                            });
                            tokio::spawn(watch_and_restart(
                                process_id,
                                false, // cron jobs never auto-restart — scheduler drives re-runs
                                config.max_restarts,
                                config.restart_delay_ms,
                                restart_count,
                                exit_rx,
                                local_restart_tx,
                            ));

                            // Ensure the scheduler is still alive (it may have been dropped on stop)
                            let has_scheduler = cron_schedulers.lock().await.contains_key(&process_id);
                            if !has_scheduler {
                                if let Some(expr) = &config.cron {
                                    if let Ok(sched) = CronScheduler::start(process_id, expr, trigger_tx) {
                                        cron_schedulers.lock().await.insert(process_id, sched);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("cron: failed to spawn process {process_id}: {e}");
                            let mut proc = arc.write().await;
                            proc.status = ProcessStatus::Errored;
                        }
                    }
                });
            }
        }
    }

    // @group BusinessLogic > Metrics : Periodically collects CPU and memory for each running process
    async fn metrics_loop(registry: Arc<ProcessRegistry>) {
        let mut sys = System::new();
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

            // Collect process IDs that currently have a PID (i.e. are running)
            let pid_map: Vec<(Uuid, Pid)> = {
                let mut result = Vec::new();
                for entry in registry.iter() {
                    let proc = entry.value().read().await;
                    if let Some(pid) = proc.pid {
                        result.push((*entry.key(), Pid::from_u32(pid)));
                    }
                }
                result
            };

            if pid_map.is_empty() {
                continue;
            }

            // Refresh sysinfo for only the PIDs we care about
            let pids: Vec<Pid> = pid_map.iter().map(|(_, p)| *p).collect();
            sys.refresh_processes_specifics(
                ProcessesToUpdate::Some(&pids),
                false,
                ProcessRefreshKind::new().with_cpu().with_memory(),
            );

            // Write new metrics back into each process entry
            for (id, sysinfo_pid) in &pid_map {
                if let Some(arc) = registry.get(id) {
                    let mut proc = arc.write().await;
                    if let Some(sp) = sys.process(*sysinfo_pid) {
                        proc.cpu_percent = Some(sp.cpu_usage());
                        proc.memory_bytes = Some(sp.memory());
                    } else {
                        proc.cpu_percent = None;
                        proc.memory_bytes = None;
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
