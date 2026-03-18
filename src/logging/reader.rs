// @group BusinessLogic : Read historical log lines from disk
// @group BusinessLogic > DatedLogs : Read lines from daily-rotated dated log files

use anyhow::Result;
use chrono::{Local, NaiveDate, TimeZone, Utc};
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
/// Returns tuples of (stream, timestamp, content).
/// This is today's live logs (current files only).
pub fn read_merged_logs(log_dir: &Path, n: usize) -> Result<Vec<(String, String, String)>> {
    read_merged_logs_for_paths(
        &log_dir.join("out.log"),
        &log_dir.join("err.log"),
        n,
    )
}

/// Read logs for a specific date from the dated rotation files:
///   out.log.YYYY-MM-DD  /  err.log.YYYY-MM-DD
/// Returns merged lines sorted by timestamp as (stream, timestamp, content).
pub fn read_merged_logs_for_date(
    log_dir: &Path,
    date: NaiveDate,
    n: usize,
) -> Result<Vec<(String, String, String)>> {
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

// @group BusinessLogic > LogStats : One 5-minute bucket of log line counts for today's chart
#[derive(Debug, Clone, serde::Serialize)]
pub struct DayLogBucket {
    /// UTC ISO-8601 start of this 5-minute window
    pub window_start: String,
    pub stdout_count: u64,
    pub stderr_count: u64,
}

// @group BusinessLogic > LogStats : Read today's out.log + err.log, bucket lines by 5-min intervals
/// Scans the full log files (no line limit) so the chart covers the entire day even
/// across daemon restarts. Lines whose timestamp does not match today are ignored.
pub fn read_log_stats_today(log_dir: &Path) -> Result<Vec<DayLogBucket>> {
    use std::collections::BTreeMap;

    let today_local = Local::now().date_naive();
    let bucket_secs: i64 = 300; // 5 minutes

    // BTreeMap keyed by bucket_start Unix timestamp — gives us sorted, gapless output
    let mut buckets: BTreeMap<i64, (u64, u64)> = BTreeMap::new();

    for (path, is_stdout) in [
        (log_dir.join("out.log"), true),
        (log_dir.join("err.log"), false),
    ] {
        if !path.exists() {
            continue;
        }
        let file = File::open(&path)?;
        let reader = BufReader::new(file);

        for raw in reader.lines().map_while(Result::ok) {
            let (ts_str, _) = parse_log_line(&raw);
            if ts_str.is_empty() {
                continue;
            }
            // Parse the ISO-8601 UTC timestamp written by the LogWriter
            let Ok(dt_utc) = ts_str.parse::<chrono::DateTime<Utc>>() else {
                continue;
            };
            // Only include lines from today (in local time)
            let dt_local = dt_utc.with_timezone(&Local);
            if dt_local.date_naive() != today_local {
                continue;
            }
            // Floor to the nearest 5-minute bucket
            let secs = dt_utc.timestamp();
            let bucket_key = secs - (secs % bucket_secs);
            let entry = buckets.entry(bucket_key).or_insert((0, 0));
            if is_stdout {
                entry.0 += 1;
            } else {
                entry.1 += 1;
            }
        }
    }

    // Convert to serialisable structs, preserving chronological order
    let result = buckets
        .into_iter()
        .map(|(key, (out, err))| {
            let window_start = Utc
                .timestamp_opt(key, 0)
                .single()
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();
            DayLogBucket {
                window_start,
                stdout_count: out,
                stderr_count: err,
            }
        })
        .collect();

    Ok(result)
}

// @group Utilities : Extract [ISO8601] timestamp prefix from a disk log line
fn parse_log_line(raw: &str) -> (String, String) {
    // Disk format: [2026-02-28T14:23:45.123Z] actual content
    if raw.starts_with('[') {
        if let Some(end) = raw.find("] ") {
            return (raw[1..end].to_string(), raw[end + 2..].to_string());
        }
    }
    (String::new(), raw.to_string())
}

// @group Utilities : Shared helper — merge stdout + stderr paths into sorted (stream, timestamp, content) tuples

fn read_merged_logs_for_paths(
    out_path: &Path,
    err_path: &Path,
    n: usize,
) -> Result<Vec<(String, String, String)>> {
    let mut entries: Vec<(String, String, String)> = Vec::new();

    for (path, stream) in [(out_path, "stdout"), (err_path, "stderr")] {
        for line in read_last_lines(path, n)? {
            let (ts, content) = parse_log_line(&line);
            entries.push((stream.to_string(), ts, content));
        }
    }

    // Sort by the ISO timestamp field (index 1)
    entries.sort_by(|a, b| a.1.cmp(&b.1));

    let start = entries.len().saturating_sub(n);
    Ok(entries[start..].to_vec())
}
