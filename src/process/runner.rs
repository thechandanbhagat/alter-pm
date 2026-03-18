// @group BusinessLogic : Spawn child process and pipe stdout/stderr to log infrastructure

use crate::models::log_stats::LogStatsState;
use crate::process::instance::{LogLine, LogStream};
use anyhow::{Context, Result};
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use uuid::Uuid;

// @group BusinessLogic > Windows : Process creation flags
// CREATE_NO_WINDOW  — hides the console window for every spawned child.
// CREATE_BREAKAWAY_FROM_JOB — removes the child from the daemon's Windows Job Object so
//   managed processes survive a daemon restart without being killed by the OS.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

/// Result of a child process run: the exit code (or None on signal/kill)
pub struct RunResult {
    pub exit_code: Option<i32>,
}

/// Spawn a child process and begin streaming its output.
/// Returns the Child handle and a receiver for exit notification.
pub async fn spawn_process(
    process_id: Uuid,
    script: &str,
    args: &[String],
    cwd: Option<&str>,
    env_vars: &HashMap<String, String>,
    log_tx: broadcast::Sender<LogLine>,
    exit_tx: mpsc::Sender<RunResult>,
    log_stats: Arc<Mutex<LogStatsState>>,
) -> Result<Child> {
    // @group BusinessLogic > Windows : npm/node/python etc. are .cmd batch scripts on Windows.
    // Wrap with cmd.exe /C so the shell resolves them correctly.
    // If the script is already a full path or ends in .exe, spawn directly.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let is_native = script.to_lowercase().ends_with(".exe")
            || script.contains('\\')
            || script.contains('/');
        if is_native {
            let mut c = Command::new(script);
            c.args(args);
            c.creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB);
            c
        } else {
            let mut c = Command::new("cmd");
            c.arg("/C");
            c.arg(script);
            c.args(args);
            c.creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB);
            c
        }
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new(script);
        c.args(args);
        c
    };
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(false);

    if let Some(dir) = cwd {
        let path = PathBuf::from(dir);
        anyhow::ensure!(path.exists(), "cwd does not exist: {dir}");
        cmd.current_dir(path);
    }

    // Merge environment variables
    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().with_context(|| format!("failed to spawn: {script}"))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // @group BusinessLogic > Logging : Stream stdout to broadcast + disk + log stats counter
    let stdout_tx = log_tx.clone();
    let stats_out = Arc::clone(&log_stats);
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let entry = LogLine {
                timestamp: Utc::now(),
                process_id,
                stream: LogStream::Stdout,
                content: line,
            };
            let _ = stdout_tx.send(entry);
            stats_out.lock().await.record(true);
        }
    });

    // @group BusinessLogic > Logging : Stream stderr to broadcast + disk + log stats counter
    let stderr_tx = log_tx.clone();
    let stats_err = Arc::clone(&log_stats);
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let entry = LogLine {
                timestamp: Utc::now(),
                process_id,
                stream: LogStream::Stderr,
                content: line,
            };
            let _ = stderr_tx.send(entry);
            stats_err.lock().await.record(false);
        }
    });

    Ok(child)
}

/// Wait for the child to exit and send the result through the channel.
pub async fn wait_for_exit(mut child: Child, exit_tx: mpsc::Sender<RunResult>) {
    let exit_code = match child.wait().await {
        Ok(status) => status.code(),
        Err(_) => None,
    };
    let _ = exit_tx.send(RunResult { exit_code }).await;
}
