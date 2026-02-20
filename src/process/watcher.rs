// @group BusinessLogic : File system watcher — restarts process on file changes

use anyhow::Result;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tokio::sync::mpsc;
use uuid::Uuid;

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    /// Start watching the given paths. When a change is detected (debounced 500ms),
    /// sends the process_id to the provided channel so the manager can restart it.
    pub fn start(
        process_id: Uuid,
        watch_paths: &[String],
        ignore_patterns: &[String],
        restart_tx: mpsc::Sender<Uuid>,
    ) -> Result<Self> {
        let (std_tx, std_rx) = std_mpsc::channel::<notify::Result<Event>>();
        let ignore = ignore_patterns.to_vec();
        let rtx = restart_tx.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res| { let _ = std_tx.send(res); },
            Config::default().with_poll_interval(Duration::from_millis(500)),
        )?;

        for path_str in watch_paths {
            let path = Path::new(path_str);
            if path.exists() {
                watcher.watch(path, RecursiveMode::Recursive)?;
            }
        }

        // Spawn a blocking thread to relay events into the async world
        tokio::task::spawn_blocking(move || {
            let mut last_restart = std::time::Instant::now();
            let debounce = Duration::from_millis(500);

            for res in std_rx {
                if let Ok(event) = res {
                    if !event.kind.is_access() {
                        let path_match = event.paths.iter().any(|p| {
                            let name = p.to_string_lossy();
                            !ignore.iter().any(|ig| name.contains(ig.as_str()))
                        });

                        if path_match && last_restart.elapsed() >= debounce {
                            last_restart = std::time::Instant::now();
                            let _ = rtx.blocking_send(process_id);
                        }
                    }
                }
            }
        });

        Ok(Self { _watcher: watcher })
    }
}
