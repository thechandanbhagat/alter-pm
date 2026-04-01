// @group APIEndpoints : Git integration — branch info, pull, dependency reinstall, restart

use crate::api::error::ApiError;
use crate::daemon::state::DaemonState;
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/{id}/git", get(git_info))
        .route("/{id}/git/pull", post(git_pull))
        .with_state(state)
}

// @group Utilities > Git : Resolve a string process ID to Uuid
async fn resolve(state: &DaemonState, id_str: &str) -> Result<Uuid, ApiError> {
    state
        .manager
        .resolve_id(id_str)
        .await
        .map_err(|_| ApiError::not_found(format!("process not found: {id_str}")))
}

// @group Utilities > Git : Run a git command silently, return trimmed stdout or None
fn git_out(dir: &FsPath, args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(args)
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// @group Utilities > Git : Run a command and capture combined stdout+stderr, with CREATE_NO_WINDOW
fn cmd_output(program: &str, args: &[&str], dir: &FsPath) -> anyhow::Result<String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).current_dir(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output()?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let combined = format!("{}{}", stdout, stderr).trim().to_string();
    if !out.status.success() && combined.is_empty() {
        return Err(anyhow::anyhow!("exited {:?}", out.status.code()));
    }
    Ok(combined)
}

// @group Utilities > Git : Detect package manager from working directory
fn detect_pkg_manager(dir: &FsPath) -> &'static str {
    if dir.join("package.json").exists() {
        if dir.join("pnpm-lock.yaml").exists() { return "pnpm" }
        if dir.join("yarn.lock").exists() { return "yarn" }
        return "npm"
    }
    if dir.join("Cargo.toml").exists() { return "cargo" }
    if dir.join("requirements.txt").exists() { return "pip" }
    if dir.join("pyproject.toml").exists() { return "pip" }
    if dir.join("Pipfile").exists() { return "pip" }
    if dir.join("go.mod").exists() { return "go" }
    "none"
}

// @group APIEndpoints > Git : GET /processes/:id/git — branch, SHA, dirty state, ahead/behind
async fn git_info(
    Path(id_str): Path<String>,
    State(state): State<Arc<DaemonState>>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let cwd = info.cwd.clone().unwrap_or_else(|| ".".to_string());

    let result = tokio::task::spawn_blocking(move || {
        let dir = PathBuf::from(&cwd);

        // Check if it's a git repo
        let is_git = dir.join(".git").exists()
            || git_out(&dir, &["rev-parse", "--git-dir"]).is_some();

        if !is_git {
            return json!({ "is_git_repo": false });
        }

        let branch = git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
        let sha = git_out(&dir, &["log", "-1", "--format=%H"]);
        let sha_short = sha.as_deref().map(|s| &s[..s.len().min(7)]).map(str::to_string);
        let message = git_out(&dir, &["log", "-1", "--format=%s"]);
        let author = git_out(&dir, &["log", "-1", "--format=%an"]);
        let date = git_out(&dir, &["log", "-1", "--format=%ci"]);
        let dirty = git_out(&dir, &["status", "--porcelain"])
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        // Ahead / behind counts (fails gracefully when no upstream)
        let (ahead, behind) = git_out(&dir, &["rev-list", "--left-right", "--count", "HEAD...@{u}"])
            .and_then(|s| {
                let mut parts = s.split_whitespace();
                let a = parts.next()?.parse::<i64>().ok()?;
                let b = parts.next()?.parse::<i64>().ok()?;
                Some((a, b))
            })
            .unwrap_or((0, 0));

        let pkg_manager = detect_pkg_manager(&dir);

        json!({
            "is_git_repo": true,
            "branch": branch,
            "sha": sha,
            "sha_short": sha_short,
            "message": message,
            "author": author,
            "date": date,
            "dirty": dirty,
            "ahead": ahead,
            "behind": behind,
            "pkg_manager": pkg_manager,
        })
    })
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(result))
}

// @group APIEndpoints > Git : POST /processes/:id/git/pull — git pull + install deps + restart
async fn git_pull(
    Path(id_str): Path<String>,
    State(state): State<Arc<DaemonState>>,
) -> Result<Json<Value>, ApiError> {
    let id = resolve(&state, &id_str).await?;
    let info = state.manager.get(id).await.map_err(ApiError::from)?;
    let cwd = info.cwd.clone().unwrap_or_else(|| ".".to_string());

    let (pull_output, deps_output, pkg_manager) =
        tokio::task::spawn_blocking(move || -> anyhow::Result<(String, Option<String>, &'static str)> {
            let dir = PathBuf::from(&cwd);

            // git pull
            let pull_out = cmd_output("git", &["pull"], &dir)?;

            // detect and install dependencies
            let pm = detect_pkg_manager(&dir);
            let deps_out = match pm {
                "npm"  => Some(cmd_output("npm",   &["install"],                  &dir)?),
                "yarn" => Some(cmd_output("yarn",  &["install", "--frozen-lockfile"], &dir)?),
                "pnpm" => Some(cmd_output("pnpm",  &["install", "--frozen-lockfile"], &dir)?),
                "pip"  => {
                    let args: Vec<&str> = if dir.join("requirements.txt").exists() {
                        vec!["install", "-r", "requirements.txt"]
                    } else {
                        vec!["install", "-e", "."]
                    };
                    Some(cmd_output("pip", &args, &dir)?)
                }
                "cargo" => Some(cmd_output("cargo", &["build"], &dir)?),
                "go"   => Some(cmd_output("go",    &["mod", "download"], &dir)?),
                _ => None,
            };

            Ok((pull_out, deps_out, pm))
        })
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
        .map_err(|e| ApiError::internal(e.to_string()))?;

    // Restart the process
    let _ = state.manager.restart(id).await;

    Ok(Json(json!({
        "success": true,
        "pull_output": pull_output,
        "deps_output": deps_output,
        "pkg_manager": pkg_manager,
    })))
}
