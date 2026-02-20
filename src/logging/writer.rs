// @group BusinessLogic : Rolling file writer — persists log lines to disk and subscribes to broadcast

use crate::logging::rotation::rotate_if_needed;
use crate::process::instance::{LogLine, LogStream};
use anyhow::Result;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

const MAX_LOG_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES: usize = 5;

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
        // Check rotation before writing
        if self.bytes_written >= MAX_LOG_SIZE_BYTES {
            if rotate_if_needed(&self.path, MAX_LOG_SIZE_BYTES, MAX_LOG_FILES)? {
                self.file = OpenOptions::new().create(true).append(true).open(&self.path)?;
                self.bytes_written = 0;
            }
        }
        let n = writeln!(self.file, "{}", line)?;
        self.bytes_written += (line.len() + 1) as u64;
        Ok(())
    }
}

/// Subscribes to the process's broadcast channel and writes every log line to disk.
pub struct LogWriter {
    _handle: tokio::task::JoinHandle<()>,
}

impl LogWriter {
    pub fn new(log_dir: &Path, log_tx: broadcast::Sender<LogLine>) -> Result<Self> {
        let out_path = log_dir.join("out.log");
        let err_path = log_dir.join("err.log");

        let out_handle = Arc::new(Mutex::new(FileHandle::open(&out_path)?));
        let err_handle = Arc::new(Mutex::new(FileHandle::open(&err_path)?));

        let mut rx = log_tx.subscribe();

        let handle = tokio::spawn(async move {
            while let Ok(line) = rx.recv().await {
                let formatted = format!("[{}] {}", line.timestamp.format("%Y-%m-%dT%H:%M:%S%.3fZ"), line.content);
                let target = match line.stream {
                    LogStream::Stdout => &out_handle,
                    LogStream::Stderr => &err_handle,
                };
                if let Ok(mut f) = target.lock() {
                    let _ = f.write_line(&formatted);
                }
            }
        });

        Ok(Self { _handle: handle })
    }
}
