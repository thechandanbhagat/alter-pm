// @group Configuration > EnvFile : .env file parser and merge logic

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// @group Configuration > EnvFile : Parse a .env file without setting process-level env vars
pub fn load_env_file(path: &Path) -> Result<HashMap<String, String>> {
    let mut result = HashMap::new();
    let iter = dotenvy::from_path_iter(path)
        .with_context(|| format!("failed to read .env file: {}", path.display()))?;
    for item in iter {
        let (key, value) = item.with_context(|| "failed to parse .env entry")?;
        result.insert(key, value);
    }
    Ok(result)
}

// @group Configuration > EnvFile : Merge .env file values with explicit env vars (explicit wins)
pub fn merge_env(
    env_file: Option<&str>,
    cwd: Option<&str>,
    explicit_env: &HashMap<String, String>,
) -> Result<HashMap<String, String>> {
    let mut merged = HashMap::new();

    // Load .env file if configured
    if let Some(env_path_str) = env_file {
        let env_path = PathBuf::from(env_path_str);
        let resolved = if env_path.is_absolute() {
            env_path
        } else if let Some(dir) = cwd {
            PathBuf::from(dir).join(env_path)
        } else {
            env_path
        };

        if resolved.exists() {
            let env_vars = load_env_file(&resolved)?;
            merged.extend(env_vars);
        } else {
            tracing::warn!("env_file not found: {}", resolved.display());
        }
    }

    // Explicit env vars override .env file values
    for (key, value) in explicit_env {
        merged.insert(key.clone(), value.clone());
    }

    Ok(merged)
}
