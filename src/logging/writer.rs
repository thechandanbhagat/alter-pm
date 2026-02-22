// @group BusinessLogic : Rolling file writer — persists log lines to disk and subscribes to broadcast
// @group BusinessLogic > DailyRotation : Midnight timer that rotates logs by date while processes run

use crate::logging::rotation::{rotate_by_date, rotate_if_needed, seconds_until_midnight};
use crate::process::instance::{LogLine, LogStream};
use anyhow::Result;
use chrono::Local;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tokio::time::{sleep, Duration};

const MAX_LOG_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES: usize = 5;
const DAILY_KEEP_DAYS: u32 = 30;

// @group BusinessLogic : File handle with size tracking and re-open after rotation

struct FileHandle {
    path: PathBuf,
    file: File,
    bytes_written: u64,
}

impl FileHandle {
    fn open(path: &Path) -> Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let bytes_written = file.metadata()?.len();
        Ok(Self { path: path.to_path_buf(), file, bytes_written })
    }

    fn write_line(&mut self, line: &str) -> Result<()> {
        // Check size-based rotation before writing
        if self.bytes_written >= MAX_LOG_SIZE_BYTES {
            if rotate_if_needed(&self.path, MAX_LOG_SIZE_BYTES, MAX_LOG_FILES)? {
                self.file = OpenOptions::new().create(true).append(true).open(&self.path)?;
                self.bytes_written = 0;
            }
        }
        writeln!(self.file, "{}", line)?;
        self.bytes_written += (line.len() + 1) as u64;
        Ok(())
    }

    /// Re-open the file (called after a daily rotation renames the current file away).
    fn reopen(&mut self) -> Result<()> {
        self.file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        self.bytes_written = self.file.metadata()?.len();
        Ok(())
    }
}

/// Subscribes to the process's broadcast channel and writes every log line to disk.
/// Also spawns a background task that rotates logs at local midnight every day.
pub struct LogWriter {
    _write_handle: tokio::task::JoinHandle<()>,
    _rotate_handle: tokio::task::JoinHandle<()>,
}

impl LogWriter {
    pub fn new(log_dir: &Path, log_tx: broadcast::Sender<LogLine>) -> Result<Self> {
        let out_path = log_dir.join("out.log");
        let err_path = log_dir.join("err.log");

        let out_handle = Arc::new(Mutex::new(FileHandle::open(&out_path)?));
        let err_handle = Arc::new(Mutex::new(FileHandle::open(&err_path)?));

        // @group BusinessLogic : Log-line writer task
        let out_clone = Arc::clone(&out_handle);
        let err_clone = Arc::clone(&err_handle);
        let mut rx = log_tx.subscribe();

        let write_handle = tokio::spawn(async move {
            while let Ok(line) = rx.recv().await {
                let formatted = format!(
                    "[{}] {}",
                    line.timestamp.format("%Y-%m-%dT%H:%M:%S%.3fZ"),
                    line.content
                );
                let target = match line.stream {
                    LogStream::Stdout => &out_clone,
                    LogStream::Stderr => &err_clone,
                };
                if let Ok(mut f) = target.lock() {
                    let _ = f.write_line(&formatted);
                }
            }
        });

        // @group BusinessLogic > DailyRotation : Midnight rotation task — runs independently of process state
        let out_rot = Arc::clone(&out_handle);
        let err_rot = Arc::clone(&err_handle);

        let rotate_handle = tokio::spawn(async move {
            loop {
                // Sleep until the next local midnight
                let secs = seconds_until_midnight();
                sleep(Duration::from_secs(secs + 1)).await; // +1 to land just past midnight

                let yesterday = (Local::now() - chrono::Duration::days(1)).date_naive();

                // Rotate stdout log
                if let Ok(mut f) = out_rot.lock() {
                    let _ = rotate_by_date(&f.path, yesterday, DAILY_KEEP_DAYS);
                    let _ = f.reopen();
                }
                // Rotate stderr log
                if let Ok(mut f) = err_rot.lock() {
                    let _ = rotate_by_date(&f.path, yesterday, DAILY_KEEP_DAYS);
                    let _ = f.reopen();
                }
            }
        });

        Ok(Self { _write_handle: write_handle, _rotate_handle: rotate_handle })
    }
}
