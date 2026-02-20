// @group BusinessLogic : Read historical log lines from disk

use anyhow::Result;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

/// Read the last `n` lines from a log file efficiently.
pub fn read_last_lines(path: &Path, n: usize) -> Result<Vec<String>> {
    if !path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut lines: Vec<String> = Vec::new();

    for line in reader.lines() {
        lines.push(line?);
    }

    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].to_vec())
}

/// Read both out.log and err.log from the process log directory,
/// merge them, and return the last `n` lines sorted by timestamp prefix.
pub fn read_merged_logs(log_dir: &Path, n: usize) -> Result<Vec<(String, String)>> {
    let out_path = log_dir.join("out.log");
    let err_path = log_dir.join("err.log");

    let mut entries: Vec<(String, String)> = Vec::new();

    for (path, stream) in [(&out_path, "stdout"), (&err_path, "stderr")] {
        for line in read_last_lines(path, n)? {
            entries.push((stream.to_string(), line));
        }
    }

    // Sort by the timestamp prefix (format: [2024-01-01T...])
    entries.sort_by(|a, b| a.1.cmp(&b.1));

    let start = entries.len().saturating_sub(n);
    Ok(entries[start..].to_vec())
}
