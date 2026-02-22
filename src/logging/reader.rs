// @group BusinessLogic : Read historical log lines from disk
// @group BusinessLogic > DatedLogs : Read lines from daily-rotated dated log files

use anyhow::Result;
use chrono::NaiveDate;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Read the last `n` lines from a single log file.
pub fn read_last_lines(path: &Path, n: usize) -> Result<Vec<String>> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines: Vec<String> = Vec::new();
    for line in reader.lines() {
        lines.push(line?);
    }
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].to_vec())
}

/// Read both out.log and err.log, merge, sort by timestamp, return the last `n` lines.
/// This is today's live logs (current files only).
pub fn read_merged_logs(log_dir: &Path, n: usize) -> Result<Vec<(String, String)>> {
    read_merged_logs_for_paths(
        &log_dir.join("out.log"),
        &log_dir.join("err.log"),
        n,
    )
}

/// Read logs for a specific date from the dated rotation files:
///   out.log.YYYY-MM-DD  /  err.log.YYYY-MM-DD
/// Returns merged lines sorted by timestamp.
pub fn read_merged_logs_for_date(
    log_dir: &Path,
    date: NaiveDate,
    n: usize,
) -> Result<Vec<(String, String)>> {
    let date_str = date.format("%Y-%m-%d").to_string();
    let out_path = log_dir.join(format!("out.log.{date_str}"));
    let err_path = log_dir.join(format!("err.log.{date_str}"));
    read_merged_logs_for_paths(&out_path, &err_path, n)
}

/// List all dates for which rotated log files exist, sorted newest-first.
pub fn list_log_dates(log_dir: &Path) -> Result<Vec<NaiveDate>> {
    let mut dates: Vec<NaiveDate> = Vec::new();

    if !log_dir.exists() {
        return Ok(dates);
    }

    for entry in std::fs::read_dir(log_dir)? {
        let entry = entry?;
        let fname = entry.file_name().to_string_lossy().to_string();
        // Match "out.log.YYYY-MM-DD" (avoid counting err.log dates twice)
        if let Some(date_str) = fname.strip_prefix("out.log.") {
            if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                dates.push(date);
            }
        }
    }

    // Newest first
    dates.sort_by(|a, b| b.cmp(a));
    Ok(dates)
}

// @group Utilities : Shared helper — merge stdout + stderr paths into sorted lines

fn read_merged_logs_for_paths(
    out_path: &Path,
    err_path: &Path,
    n: usize,
) -> Result<Vec<(String, String)>> {
    let mut entries: Vec<(String, String)> = Vec::new();

    for (path, stream) in [(out_path, "stdout"), (err_path, "stderr")] {
        for line in read_last_lines(path, n)? {
            entries.push((stream.to_string(), line));
        }
    }

    // Sort by the ISO timestamp prefix written by LogWriter: [YYYY-MM-DDTHH:MM:SS.sssZ]
    entries.sort_by(|a, b| a.1.cmp(&b.1));

    let start = entries.len().saturating_sub(n);
    Ok(entries[start..].to_vec())
}
