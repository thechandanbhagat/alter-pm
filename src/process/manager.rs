// @group BusinessLogic : Process manager — spawns, tracks, stops, and restarts all child processes

use crate::config::ecosystem::AppConfig;
use crate::config::notification_store::NotificationsStore;
use crate::logging::writer::LogWriter;
use crate::models::cron_run::{CronRun, MAX_CRON_HISTORY};
use crate::models::metric_sample::MetricSample;
use crate::models::process_info::ProcessInfo;
use crate::models::process_status::ProcessStatus;
use crate::notifications::sender::{fire_event, ProcessEvent};
use crate::process::instance::{LogLine, ManagedProcess};
use crate::process::restarter::{watch_and_restart, RestartEvent};
use crate::process::runner::{spawn_process, wait_for_exit};
use crate::process::scheduler::{next_run, CronScheduler};
use crate::process::watcher::FileWatcher;
use anyhow::{anyhow, Result};
use chrono::Utc;
use dashmap::DashMap;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tokio::sync::mpsc;
use tokio::sync::{broadcast, Mutex, RwLock};
use uuid::Uuid;

// @group Constants : Maximum number of metric samples retained per process (288 × 30 s ≈ 2.4 h)
const MAX_METRIC_SAMPLES: usize = 288;
// @group Constants : Collect one metric sample every N metric-loop ticks (tick = 3 s → 10 × 3 s = 30 s)
const METRIC_SAMPLE_INTERVAL_TICKS: u32 = 10;

pub type ProcessRegistry = DashMap<Uuid, Arc<RwLock<ManagedProcess>>>;

pub struct ProcessManager {
    pub registry: Arc<ProcessRegistry>,
    restart_tx: mpsc::Sender<RestartEvent>,
    /// Cron trigger channel — scheduler sends process_id when the next tick fires
    cron_trigger_tx: mpsc::Sender<Uuid>,
    /// Active CronScheduler handles, keyed by process_id
    cron_schedulers: Arc<Mutex<HashMap<Uuid, CronScheduler>>>,
    /// Shared notification store for firing alerts on process events
    notifications: Arc<RwLock<NotificationsStore>>,
    /// Suppress per-process Telegram notifications during bulk namespace ops.
    /// Value = remaining events to suppress (2 for restart = stop+start, 1 otherwise).
    pub bulk_suppress: Arc<DashMap<Uuid, u32>>,
    // @group BusinessLogic > Metrics : Rolling per-process metric history (CPU + mem samples)
    pub metrics_history: Arc<DashMap<Uuid, Mutex<VecDeque<MetricSample>>>>,
}

impl ProcessManager {
    pub fn new(notifications: Arc<RwLock<NotificationsStore>>) -> Self {
        let registry = Arc::new(DashMap::new());
        let (restart_tx, restart_rx) = mpsc::channel::<RestartEvent>(256);
        let (cron_trigger_tx, cron_trigger_rx) = mpsc::channel::<Uuid>(256);
        let cron_schedulers: Arc<Mutex<HashMap<Uuid, CronScheduler>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let reg_clone = Arc::clone(&registry);
        let rtx_clone = restart_tx.clone();
        let notif_restart = Arc::clone(&notifications);

        // @group BusinessLogic > Restarter : Background task that handles restart events
        tokio::spawn(async move {
            Self::restart_loop(reg_clone, restart_rx, rtx_clone, notif_restart).await;
        });

        let reg_cron = Arc::clone(&registry);
        let cron_sched_clone = Arc::clone(&cron_schedulers);
        let ctrigger_tx_clone = cron_trigger_tx.clone();
        let notif_cron = Arc::clone(&notifications);

        // @group BusinessLogic > Cron : Background task that handles cron trigger events
        tokio::spawn(async move {
            Self::cron_trigger_loop(reg_cron, cron_trigger_rx, cron_sched_clone, ctrigger_tx_clone, notif_cron).await;
        });

        let reg_metrics = Arc::clone(&registry);
        let metrics_history: Arc<DashMap<Uuid, Mutex<VecDeque<MetricSample>>>> =
            Arc::new(DashMap::new());
        let hist_metrics = Arc::clone(&metrics_history);

        // @group BusinessLogic > Metrics : Background task that polls CPU and memory per process
        tokio::spawn(async move {
            Self::metrics_loop(reg_metrics, hist_metrics).await;
        });

        let reg_alert = Arc::clone(&registry);
        let notif_alert = Arc::clone(&notifications);

        // @group BusinessLogic > LogAlerts : Background task that checks stderr spikes every 5 minutes
        tokio::spawn(async move {
            Self::log_alert_loop(reg_alert, notif_alert).await;
        });

        Self {
            registry,
            restart_tx,
            cron_trigger_tx,
            cron_schedulers,
            notifications,
            bulk_suppress: Arc::new(DashMap::new()),
            metrics_history,
        }
    }

    // @group Utilities > BulkSuppress : Decrement suppress counter; return true if the event should be suppressed
    fn suppress_consume(suppress: &DashMap<Uuid, u32>, id: &Uuid) -> bool {
        if let Some(mut entry) = suppress.get_mut(id) {
            if *entry > 1 {
                *entry -= 1;
            } else {
                drop(entry);
                suppress.remove(id);
            }
            return true;
        }
        false
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
    // Takes the persisted UUID so IDs remain stable across daemon restarts.
    pub async fn register_stopped(&self, id: Uuid, config: AppConfig) -> ProcessInfo {
        let process = ManagedProcess::new_with_id(id, config);
        let info = process.to_info();
        let arc = Arc::new(RwLock::new(process));
        self.registry.insert(id, arc);
        info
    }

    // @group BusinessLogic > Lifecycle : Re-adopt an already-running OS process after a daemon crash.
    // We cannot re-attach stdout/stderr — logs resume on the next natural restart.
    // A polling watcher detects when the PID exits and fires a RestartEvent so the
    // normal restart_loop handles autorestart from that point forward.
    pub async fn register_running_adopted(&self, saved_id: Uuid, config: AppConfig, pid: u32) -> ProcessInfo {
        let mut process = ManagedProcess::new_with_id(saved_id, config.clone());
        process.status = ProcessStatus::Running;
        process.pid = Some(pid);
        process.started_at = Some(Utc::now()); // approximate — original start time is unknown

        let id = process.id;
        let info = process.to_info();
        let arc = Arc::new(RwLock::new(process));
        self.registry.insert(id, Arc::clone(&arc));

        // @group BusinessLogic > AdoptedWatcher : Poll every 2s until the adopted PID exits
        let registry = Arc::clone(&self.registry);
        let restart_tx = self.restart_tx.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                if !is_pid_alive(pid) {
                    break;
                }
            }

            // PID exited — update state and decide whether to restart
            let (autorestart, restart_count, max_restarts, restart_delay_ms) = {
                match registry.get(&id) {
                    Some(entry) => {
                        let mut proc = entry.write().await;
                        proc.status = ProcessStatus::Stopped;
                        proc.pid = None;
                        proc.stopped_at = Some(Utc::now());
                        (
                            proc.config.autorestart,
                            proc.restart_count,
                            proc.config.max_restarts,
                            proc.config.restart_delay_ms,
                        )
                    }
                    None => return,
                }
            };

            if autorestart && restart_count < max_restarts {
                tokio::time::sleep(tokio::time::Duration::from_millis(restart_delay_ms)).await;
                let _ = restart_tx
                    .send(RestartEvent::Restart { process_id: id })
                    .await;
            } else {
                let _ = restart_tx
                    .send(RestartEvent::Exited { process_id: id, exit_code: None })
                    .await;
            }
        });

        info
    }

    // @group BusinessLogic > Lifecycle : Register a cron process as Sleeping without spawning (used on restore)
    pub async fn register_sleeping(&self, id: Uuid, config: AppConfig, cron_run_history: Vec<CronRun>) -> Result<ProcessInfo> {
        let mut process = ManagedProcess::new_with_id(id, config.clone());
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

        // @group BusinessLogic > HealthCheck : Abort health check loop before killing the process
        if let Some(handle) = proc.health_check_handle.take() {
            handle.abort();
        }

        // @group BusinessLogic > Hooks : Run pre_stop hook before killing the process
        if let Some(cmd) = &proc.config.pre_stop.clone() {
            let cwd = proc.config.cwd.clone();
            let env = proc.config.env.clone();
            if let Err(e) = crate::process::hooks::run_hook(cmd, cwd.as_deref(), &env).await {
                tracing::warn!("pre_stop hook failed: {e}");
            }
        }

        if let Some(pid) = proc.pid {
            kill_process(pid);
        }

        proc.status = ProcessStatus::Stopped;
        proc.pid = None;
        proc.stopped_at = Some(Utc::now());
        proc.cron_next_run = None;

        let info_for_notif = proc.to_info();
        let notif = Arc::clone(&self.notifications);
        let suppress = Arc::clone(&self.bulk_suppress);
        let info_clone = info_for_notif.clone();
        tokio::spawn(async move {
            if !Self::suppress_consume(&suppress, &info_clone.id) {
                let store = notif.read().await;
                fire_event(&store, &info_clone, ProcessEvent::Stopped).await;
                crate::telegram::commands::fire_telegram_notification(&info_clone, ProcessEvent::Stopped).await;
            }
        });

        Ok(info_for_notif)
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

    // @group BusinessLogic > Namespace : Start all stopped/crashed processes in a namespace (bulk — one Telegram notification)
    pub async fn start_namespace(&self, namespace: &str) -> Vec<ProcessInfo> {
        let ids: Vec<Uuid> = {
            let mut result = vec![];
            for entry in self.registry.iter() {
                let proc = entry.value().read().await;
                if proc.config.namespace == namespace
                    && matches!(proc.status, ProcessStatus::Stopped | ProcessStatus::Crashed | ProcessStatus::Errored)
                {
                    result.push(proc.id);
                }
            }
            result
        };
        for &id in &ids {
            self.bulk_suppress.insert(id, 1);
        }
        let mut infos = vec![];
        for id in ids {
            if self.do_spawn(id).await.is_ok() {
                if let Ok(info) = self.get(id).await {
                    infos.push(info);
                }
            }
        }
        infos
    }

    // @group BusinessLogic > Namespace : Stop all running processes in a namespace (bulk — one Telegram notification)
    pub async fn stop_namespace(&self, namespace: &str) -> Vec<ProcessInfo> {
        let ids: Vec<Uuid> = {
            let mut result = vec![];
            for entry in self.registry.iter() {
                let proc = entry.value().read().await;
                if proc.config.namespace == namespace
                    && matches!(proc.status, ProcessStatus::Running | ProcessStatus::Watching | ProcessStatus::Sleeping)
                {
                    result.push(proc.id);
                }
            }
            result
        };
        for &id in &ids {
            self.bulk_suppress.insert(id, 1);
        }
        let mut infos = vec![];
        for id in ids {
            if let Ok(info) = self.stop(id).await {
                infos.push(info);
            }
        }
        infos
    }

    // @group BusinessLogic > Namespace : Restart all processes in a namespace (bulk — one Telegram notification)
    pub async fn restart_namespace(&self, namespace: &str) -> Vec<ProcessInfo> {
        // Collect ids paired with whether the process is currently active.
        // Active processes will emit stop + start (2 events); inactive ones only start (1 event).
        // Setting the wrong count leaves a stale suppress entry that silently eats a future
        // individual notification (e.g. the next manual stop).
        let ids: Vec<(Uuid, bool)> = {
            let mut result = vec![];
            for entry in self.registry.iter() {
                let proc = entry.value().read().await;
                if proc.config.namespace == namespace {
                    let is_active = matches!(
                        proc.status,
                        ProcessStatus::Running | ProcessStatus::Watching | ProcessStatus::Sleeping
                    );
                    result.push((proc.id, is_active));
                }
            }
            result
        };
        for &(id, is_active) in &ids {
            self.bulk_suppress.insert(id, if is_active { 2 } else { 1 });
        }
        let mut infos = vec![];
        for (id, _) in ids {
            if let Ok(info) = self.restart(id).await {
                infos.push(info);
            }
        }
        infos
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

    // @group BusinessLogic > LogStats : Return bucketed stdout/stderr log counts for a process
    pub async fn get_log_stats(&self, id: Uuid) -> Vec<crate::models::log_stats::LogStatsBucket> {
        match self.registry.get(&id) {
            Some(arc) => {
                // Clone the Arc out before dropping the read guard to avoid lifetime issues
                let stats_arc = {
                    let proc = arc.read().await;
                    Arc::clone(&proc.log_stats)
                };
                let snapshot = stats_arc.lock().await.snapshot();
                snapshot
            }
            None => Vec::new(),
        }
    }

    // @group BusinessLogic > Metrics : Return a snapshot of all recorded samples for a process
    pub async fn get_metrics_history(&self, id: Uuid) -> Vec<MetricSample> {
        match self.metrics_history.get(&id) {
            Some(entry) => entry.lock().await.iter().cloned().collect(),
            None => Vec::new(),
        }
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

        let (config, log_tx, log_stats) = {
            let mut proc = arc.write().await;
            proc.status = ProcessStatus::Starting;
            proc.started_at = Some(Utc::now());
            proc.stopped_at = None;
            proc.cron_next_run = None;
            // Reset health status on each (re)spawn
            proc.health_status = None;

            // Open / rotate log files
            let log_dir = crate::config::paths::process_log_dir(&proc.config.name);
            std::fs::create_dir_all(&log_dir)?;
            let writer = LogWriter::new(&log_dir, proc.log_tx.clone())?;
            proc.log_writer = Some(writer);

            (proc.config.clone(), proc.log_tx.clone(), Arc::clone(&proc.log_stats))
        };

        // @group BusinessLogic > Hooks : Run pre_start hook before spawning
        if let Some(cmd) = &config.pre_start {
            if let Err(e) = crate::process::hooks::run_hook(cmd, config.cwd.as_deref(), &config.env).await {
                arc.write().await.status = ProcessStatus::Errored;
                return Err(anyhow::anyhow!("pre_start hook failed: {e}"));
            }
        }

        // @group BusinessLogic > EnvFile : Merge .env file vars with explicit env (explicit wins)
        let merged_env = crate::config::env_file::merge_env(
            config.env_file.as_deref(),
            config.cwd.as_deref(),
            &config.env,
        ).unwrap_or_else(|_| config.env.clone());

        let (exit_tx, exit_rx) = mpsc::channel::<crate::process::runner::RunResult>(1);

        let child = match spawn_process(
            id,
            &config.script,
            &config.args,
            config.cwd.as_deref(),
            &merged_env,
            log_tx,
            exit_tx.clone(),
            log_stats,
        )
        .await {
            Ok(c) => c,
            Err(e) => {
                arc.write().await.status = ProcessStatus::Errored;
                return Err(e);
            }
        };

        let pid = child.id();

        let info_for_notif = {
            let mut proc = arc.write().await;
            proc.pid = pid;
            // Cron jobs don't use autorestart — they're driven by the scheduler.
            // Watch mode and normal mode keep existing behaviour.
            proc.status = if config.watch {
                ProcessStatus::Watching
            } else {
                ProcessStatus::Running
            };
            proc.to_info()
        };

        // Fire Started notification (non-blocking)
        let notif = Arc::clone(&self.notifications);
        let suppress = Arc::clone(&self.bulk_suppress);
        let info_for_tg = info_for_notif.clone();
        tokio::spawn(async move {
            if !Self::suppress_consume(&suppress, &info_for_tg.id) {
                let store = notif.read().await;
                fire_event(&store, &info_for_notif, ProcessEvent::Started).await;
                crate::telegram::commands::fire_telegram_notification(&info_for_tg, ProcessEvent::Started).await;
            }
        });

        // @group BusinessLogic > Hooks : Run post_start hook after process is running (non-blocking)
        if let Some(cmd) = config.post_start.clone() {
            let cwd = config.cwd.clone();
            let env = config.env.clone();
            tokio::spawn(async move {
                if let Err(e) = crate::process::hooks::run_hook(&cmd, cwd.as_deref(), &env).await {
                    tracing::warn!("post_start hook failed: {e}");
                }
            });
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

        // @group BusinessLogic > HealthCheck : Start health probe loop if configured
        if let Some(url) = &config.health_check_url {
            let handle = crate::process::health::start_health_check(
                id,
                Arc::clone(&arc),
                url.clone(),
                config.health_check_interval_secs,
                config.health_check_timeout_secs,
                config.health_check_retries,
                Arc::clone(&self.notifications),
            );
            arc.write().await.health_check_handle = Some(handle);
        }

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
        notifications: Arc<RwLock<NotificationsStore>>,
    ) {
        while let Some(event) = rx.recv().await {
            match event {
                RestartEvent::Restart { process_id } => {
                    if let Some(arc) = registry.get(&process_id) {
                        let arc = Arc::clone(arc.value());
                        let rtx = restart_tx.clone();
                        let registry2 = Arc::clone(&registry);
                        let notifications = Arc::clone(&notifications);

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

                            let (config, log_tx, log_stats) = {
                                let mut proc = arc.write().await;
                                let log_dir = crate::config::paths::process_log_dir(&proc.config.name);
                                let _ = std::fs::create_dir_all(&log_dir);
                                if let Ok(writer) = LogWriter::new(&log_dir, proc.log_tx.clone()) {
                                    proc.log_writer = Some(writer);
                                }
                                (proc.config.clone(), proc.log_tx.clone(), Arc::clone(&proc.log_stats))
                            };

                            let (exit_tx, exit_rx) = mpsc::channel::<crate::process::runner::RunResult>(1);

                            // @group BusinessLogic > EnvFile : Merge .env on each restart
                            let merged_env = crate::config::env_file::merge_env(
                                config.env_file.as_deref(),
                                config.cwd.as_deref(),
                                &config.env,
                            ).unwrap_or_else(|_| config.env.clone());

                            match spawn_process(
                                process_id,
                                &config.script,
                                &config.args,
                                config.cwd.as_deref(),
                                &merged_env,
                                log_tx,
                                exit_tx.clone(),
                                log_stats,
                            ).await {
                                Ok(child) => {
                                    let pid = child.id();
                                    let info_for_notif = {
                                        let mut proc = arc.write().await;
                                        proc.pid = pid;
                                        proc.health_status = None;
                                        proc.status = if config.watch {
                                            ProcessStatus::Watching
                                        } else {
                                            ProcessStatus::Running
                                        };
                                        proc.to_info()
                                    };
                                    // Fire Restarted notification (non-blocking)
                                    let notif2 = Arc::clone(&notifications);
                                    let info_for_tg = info_for_notif.clone();
                                    tokio::spawn(async move {
                                        let store = notif2.read().await;
                                        fire_event(&store, &info_for_notif, ProcessEvent::Restarted).await;
                                        crate::telegram::commands::fire_telegram_notification(&info_for_tg, ProcessEvent::Restarted).await;
                                    });
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
                                        let info_for_notif = proc.to_info();
                                        let notif2 = Arc::clone(&notifications);
                                        let info_for_tg = info_for_notif.clone();
                                        tokio::spawn(async move {
                                            let store = notif2.read().await;
                                            fire_event(&store, &info_for_notif, ProcessEvent::Crashed).await;
                                            crate::telegram::commands::fire_telegram_notification(&info_for_tg, ProcessEvent::Crashed).await;
                                        });
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
                    let notifications = Arc::clone(&notifications);
                    if let Some(arc) = registry.get(&process_id) {
                        let info_for_notif = {
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
                            proc.to_info()
                        };
                        let notif2 = Arc::clone(&notifications);
                        let info_for_tg = info_for_notif.clone();
                        tokio::spawn(async move {
                            let store = notif2.read().await;
                            fire_event(&store, &info_for_notif, ProcessEvent::Crashed).await;
                            crate::telegram::commands::fire_telegram_notification(&info_for_tg, ProcessEvent::Crashed).await;
                        });
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
        notifications: Arc<RwLock<NotificationsStore>>,
    ) {
        while let Some(process_id) = rx.recv().await {
            if let Some(arc) = registry.get(&process_id) {
                let arc = Arc::clone(arc.value());
                let cron_schedulers = Arc::clone(&cron_schedulers);
                let trigger_tx = cron_trigger_tx.clone();

                let notif_cron = Arc::clone(&notifications);
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

                    let (log_tx, log_stats) = {
                        let mut proc = arc.write().await;
                        if let Ok(writer) = LogWriter::new(&log_dir, proc.log_tx.clone()) {
                            proc.log_writer = Some(writer);
                        }
                        (proc.log_tx.clone(), Arc::clone(&proc.log_stats))
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
                    let notif_exit = Arc::clone(&notif_cron);

                    // Handle the exit event inline — record run history, transition to Sleeping, fire CronFailed if needed
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
                                let info_for_fail = {
                                    let mut proc = arc2.write().await;
                                    // Only transition back to Sleeping if the job wasn't manually stopped.
                                    // If status is Stopped, the user explicitly stopped it while it was
                                    // running — don't override that decision.
                                    if proc.status != ProcessStatus::Stopped {
                                        proc.status = ProcessStatus::Sleeping;
                                        if let Some(expr) = &proc.config.cron.clone() {
                                            proc.cron_next_run = next_run(expr);
                                        }
                                    }
                                    proc.pid = None;
                                    proc.last_exit_code = exit_code;
                                    proc.stopped_at = Some(finished_at);
                                    // Append to history, capped at MAX_CRON_HISTORY
                                    proc.cron_run_history.push(run);
                                    if proc.cron_run_history.len() > MAX_CRON_HISTORY {
                                        proc.cron_run_history.remove(0);
                                    }
                                    // Capture info for notification (only needed if failed)
                                    exit_code.map(|_| proc.to_info())
                                };
                                // Fire CronFailed notification on non-zero exit
                                if let Some(false) = exit_code.map(|c| c == 0) {
                                    if let Some(info) = info_for_fail {
                                        let store = notif_exit.read().await;
                                        fire_event(&store, &info, ProcessEvent::CronFailed).await;
                                        crate::telegram::commands::fire_telegram_notification(&info, ProcessEvent::CronFailed).await;
                                    }
                                }
                            }
                        }
                    });

                    // @group BusinessLogic > EnvFile : Merge .env for cron spawn
                    let merged_env = crate::config::env_file::merge_env(
                        config.env_file.as_deref(),
                        config.cwd.as_deref(),
                        &config.env,
                    ).unwrap_or_else(|_| config.env.clone());

                    match spawn_process(
                        process_id,
                        &config.script,
                        &config.args,
                        config.cwd.as_deref(),
                        &merged_env,
                        log_tx,
                        exit_tx.clone(),
                        log_stats,
                    ).await {
                        Ok(child) => {
                            let pid = child.id();
                            let info_for_notif = {
                                let mut proc = arc.write().await;
                                proc.pid = pid;
                                proc.status = ProcessStatus::Running;
                                proc.to_info()
                            };
                            // Fire CronRun notification when cron job starts (non-blocking)
                            let notif3 = Arc::clone(&notif_cron);
                            let info_for_tg = info_for_notif.clone();
                            tokio::spawn(async move {
                                let store = notif3.read().await;
                                fire_event(&store, &info_for_notif, ProcessEvent::CronRun).await;
                                crate::telegram::commands::fire_telegram_notification(&info_for_tg, ProcessEvent::CronRun).await;
                            });

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
                            let info_for_notif = {
                                let mut proc = arc.write().await;
                                proc.status = ProcessStatus::Errored;
                                proc.to_info()
                            };
                            let notif3 = Arc::clone(&notif_cron);
                            let info_for_tg = info_for_notif.clone();
                            tokio::spawn(async move {
                                let store = notif3.read().await;
                                fire_event(&store, &info_for_notif, ProcessEvent::CronFailed).await;
                                crate::telegram::commands::fire_telegram_notification(&info_for_tg, ProcessEvent::CronFailed).await;
                            });
                        }
                    }
                });
            }
        }
    }

    // @group BusinessLogic > Metrics : Periodically collects CPU and memory for each running process
    async fn metrics_loop(
        registry: Arc<ProcessRegistry>,
        hist: Arc<DashMap<Uuid, Mutex<VecDeque<MetricSample>>>>,
    ) {
        let mut sys = System::new();
        let mut tick: u32 = 0;

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            tick = tick.wrapping_add(1);

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

            // @group BusinessLogic > Metrics : Decide whether this tick records a history sample
            let record_sample = tick % METRIC_SAMPLE_INTERVAL_TICKS == 0;
            let now = Utc::now();

            // Write new metrics back into each process entry
            for (id, sysinfo_pid) in &pid_map {
                if let Some(arc) = registry.get(id) {
                    let mut proc = arc.write().await;
                    if let Some(sp) = sys.process(*sysinfo_pid) {
                        let cpu = sp.cpu_usage();
                        let mem = sp.memory();
                        proc.cpu_percent = Some(cpu);
                        proc.memory_bytes = Some(mem);

                        // @group BusinessLogic > Metrics : Push sample into the per-process ring buffer
                        if record_sample {
                            let entry = hist.entry(*id).or_insert_with(|| {
                                Mutex::new(VecDeque::with_capacity(MAX_METRIC_SAMPLES + 1))
                            });
                            let mut buf = entry.lock().await;
                            buf.push_back(MetricSample {
                                timestamp: now,
                                cpu_percent: cpu,
                                memory_bytes: mem,
                            });
                            if buf.len() > MAX_METRIC_SAMPLES {
                                buf.pop_front();
                            }
                        }
                    } else {
                        proc.cpu_percent = None;
                        proc.memory_bytes = None;
                    }
                }
            }
        }
    }

    // @group BusinessLogic > LogAlerts : Wake every 5 min, check last closed bucket per process, fire alerts
    async fn log_alert_loop(
        registry: Arc<ProcessRegistry>,
        notifications: Arc<RwLock<NotificationsStore>>,
    ) {
        // Per-process cooldown tracker — stores the last time an alert was fired
        let mut last_alerted: HashMap<Uuid, chrono::DateTime<Utc>> = HashMap::new();

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;

            // Read config fresh from disk each cycle so changes take effect immediately
            let cfg = crate::config::log_alert_config::load();
            if !cfg.enabled {
                continue;
            }

            let threshold = cfg.stderr_threshold;
            let cooldown_secs = cfg.cooldown_mins as i64 * 60;
            let now = Utc::now();

            for entry in registry.iter() {
                let id = *entry.key();

                // Check cooldown before taking any locks
                if let Some(&last) = last_alerted.get(&id) {
                    if (now - last).num_seconds() < cooldown_secs {
                        continue;
                    }
                }

                // Clone the Arc<Mutex<LogStatsState>> without holding the RwLock guard
                let (stats_arc, proc_info) = {
                    let proc = entry.value().read().await;
                    (Arc::clone(&proc.log_stats), proc.to_info())
                };

                let stderr_count = {
                    let stats = stats_arc.lock().await;
                    // Use the most recently completed bucket
                    stats.history.back().map(|b| b.stderr_count).unwrap_or(0)
                };

                if stderr_count < threshold {
                    continue;
                }

                // Threshold exceeded — record cooldown and fire
                last_alerted.insert(id, now);

                let notif = Arc::clone(&notifications);
                let name = proc_info.name.clone();

                tokio::spawn(async move {
                    let store = notif.read().await;
                    crate::notifications::sender::fire_log_alert(
                        &store, &proc_info, stderr_count, threshold,
                    ).await;
                    crate::telegram::commands::fire_log_alert_telegram(
                        &name, stderr_count, threshold,
                    ).await;
                });
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

// @group Utilities : Check whether a PID is still alive in the OS process table
pub fn is_pid_alive(pid: u32) -> bool {
    use sysinfo::{Pid, System};
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), false);
    sys.process(Pid::from_u32(pid)).is_some()
}

// @group Utilities : Kill a single orphaned process by PID (used when re-adopting on daemon restart)
pub fn kill_orphan_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
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
