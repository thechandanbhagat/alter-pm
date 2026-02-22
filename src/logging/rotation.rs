// @group BusinessLogic : Size-based log rotation — 10MB limit, keep 5 rotated files
// @group BusinessLogic > DailyRotation : Date-based log rotation — rotate at midnight, keep 30 days

use anyhow::Result;
use chrono::{Local, NaiveDate, Timelike};
use std::fs;
use std::path::{Path, PathBuf};

/// Rotate log files if the given file exceeds `max_size_bytes`.
/// Keeps up to `max_files` rotated copies: out.log.1, out.log.2, …
pub fn rotate_if_needed(log_path: &Path, max_size_bytes: u64, max_files: usize) -> Result<bool> {
    let meta = match fs::metadata(log_path) {
        Ok(m) => m,
        Err(_) => return Ok(false),
    };

    if meta.len() < max_size_bytes {
        return Ok(false);
    }

    // Shift existing rotated files: out.log.4 -> deleted, out.log.3 -> out.log.4, …
    for i in (1..max_files).rev() {
        let old = rotated_path(log_path, i);
        let new = rotated_path(log_path, i + 1);
        if old.exists() {
            if i + 1 > max_files {
                fs::remove_file(&old)?;
            } else {
                fs::rename(&old, &new)?;
            }
        }
    }

    // Rotate current file to .1
    let rotated = rotated_path(log_path, 1);
    fs::rename(log_path, rotated)?;

    Ok(true)
}

/// Rotate a log file by date: renames `out.log` → `out.log.YYYY-MM-DD`.
/// Skips if the file is empty or doesn't exist.
/// Purges dated rotations older than `keep_days` days.
pub fn rotate_by_date(log_path: &Path, date: NaiveDate, keep_days: u32) -> Result<bool> {
    // Skip if file is absent or empty
    match fs::metadata(log_path) {
        Ok(m) if m.len() == 0 => return Ok(false),
        Err(_) => return Ok(false),
        _ => {}
    }

    let dated = dated_path(log_path, date);
    // If a rotation for today already exists, append rather than overwrite
    if dated.exists() {
        let mut existing = fs::OpenOptions::new().append(true).open(&dated)?;
        let mut src = fs::File::open(log_path)?;
        std::io::copy(&mut src, &mut existing)?;
        fs::remove_file(log_path)?;
    } else {
        fs::rename(log_path, &dated)?;
    }

    // Purge rotations older than keep_days
    purge_old_dated_logs(log_path, date, keep_days)?;

    Ok(true)
}

/// Returns seconds until the next local midnight.
pub fn seconds_until_midnight() -> u64 {
    let now = Local::now();
    let secs_since_midnight =
        now.hour() as u64 * 3600 + now.minute() as u64 * 60 + now.second() as u64;
    86400u64.saturating_sub(secs_since_midnight)
}

// @group Utilities : Path helpers for numbered and dated rotation files

fn rotated_path(base: &Path, n: usize) -> PathBuf {
    let name = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    base.with_file_name(format!("{name}.{n}"))
}

fn dated_path(base: &Path, date: NaiveDate) -> PathBuf {
    let name = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    base.with_file_name(format!("{name}.{}", date.format("%Y-%m-%d")))
}

fn purge_old_dated_logs(base: &Path, today: NaiveDate, keep_days: u32) -> Result<()> {
    let dir = match base.parent() {
        Some(d) => d,
        None => return Ok(()),
    };
    let stem = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let cutoff = today - chrono::Duration::days(keep_days as i64);

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let fname = entry.file_name().to_string_lossy().to_string();
        // Match files like "out.log.2024-01-15"
        if let Some(date_str) = fname.strip_prefix(&format!("{stem}.")) {
            if let Ok(file_date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                if file_date < cutoff {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    Ok(())
}
