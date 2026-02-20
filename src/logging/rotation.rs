// @group BusinessLogic : Size-based log rotation — 10MB limit, keep 5 rotated files

use anyhow::Result;
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

fn rotated_path(base: &Path, n: usize) -> PathBuf {
    let name = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    base.with_file_name(format!("{name}.{n}"))
}
