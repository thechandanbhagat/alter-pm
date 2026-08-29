// @group BusinessLogic : Terminal activity logger — appends one line per PTY session event

use chrono::Utc;
use std::io::Write;

// @group BusinessLogic > TerminalLog : Log a terminal session open event
pub fn log_open(session_id: &str, cwd: &str) {
    let ts = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    append(&format!("{ts} OPEN  id={session_id} cwd=\"{cwd}\"\n"));
}

// @group BusinessLogic > TerminalLog : Log a terminal session close event with duration
pub fn log_close(session_id: &str, cwd: &str, duration_secs: i64) {
    let ts = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    append(&format!("{ts} CLOSE id={session_id} cwd=\"{cwd}\" duration={duration_secs}s\n"));
}

fn append(line: &str) {
    let path = crate::config::paths::terminal_activity_log_file();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}
