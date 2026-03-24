// @group APIEndpoints : Self-update check and apply endpoints

use crate::api::error::ApiError;
use crate::daemon::state::DaemonState;
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use futures::StreamExt;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/check", get(check_update))
        .route("/apply", post(apply_update))
        .with_state(state)
}

// @group Utilities > Semver : Returns true if version b is strictly greater than version a
fn semver_gt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> (u32, u32, u32) {
        let mut p = s.splitn(3, '.');
        let major = p.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let minor = p.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let patch = p.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        (major, minor, patch)
    };
    parse(b) > parse(a)
}

// @group Utilities > Platform : Returns the asset filename for the current OS/arch using Rust target triples
// Asset naming: alter-{version}-{target_triple}[.exe]
fn platform_asset_name(version: &str) -> Option<String> {
    let target = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("linux",   "x86_64") => "x86_64-unknown-linux-musl",
        ("linux",   "aarch64")=> "aarch64-unknown-linux-musl",
        ("macos",   "x86_64") => "x86_64-apple-darwin",
        ("macos",   "aarch64")=> "aarch64-apple-darwin",
        _ => return None,
    };
    let ext = if cfg!(windows) { ".exe" } else { "" };
    Some(format!("alter-{version}-{target}{ext}"))
}

// @group APIEndpoints > Update : GET /system/update/check
// Checks GitHub for the latest release. Returns current/latest versions, up_to_date flag,
// and a direct download_url for the current platform's binary (null if not found or up to date).
async fn check_update() -> Json<Value> {
    let current = env!("CARGO_PKG_VERSION");

    let client = match reqwest::Client::builder()
        .user_agent("alter-pm2")
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Json(json!({
                "current": current, "latest": current, "up_to_date": true,
                "download_url": null, "release_notes": null, "published_at": null,
                "error": format!("failed to build http client: {e}"),
            }))
        }
    };

    let resp = match client
        .get("https://api.github.com/repos/thechandanbhagat/alter-pm/releases/latest")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(json!({
                "current": current, "latest": current, "up_to_date": true,
                "download_url": null, "release_notes": null, "published_at": null,
                "error": format!("could not reach GitHub: {e}"),
            }))
        }
    };

    let release: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return Json(json!({
                "current": current, "latest": current, "up_to_date": true,
                "download_url": null, "release_notes": null, "published_at": null,
                "error": format!("failed to parse GitHub response: {e}"),
            }))
        }
    };

    let tag = release["tag_name"].as_str().unwrap_or(current);
    let latest = tag.trim_start_matches('v');
    let up_to_date = !semver_gt(current, latest);

    let download_url: Option<String> = if !up_to_date {
        platform_asset_name(latest).and_then(|asset_name| {
            release["assets"].as_array()?.iter().find_map(|a| {
                if a["name"].as_str() == Some(&asset_name) {
                    a["browser_download_url"].as_str().map(String::from)
                } else {
                    None
                }
            })
        })
    } else {
        None
    };

    Json(json!({
        "current": current,
        "latest": latest,
        "up_to_date": up_to_date,
        "download_url": download_url,
        "release_notes": release["body"].as_str(),
        "published_at": release["published_at"].as_str(),
    }))
}

// @group APIEndpoints > Update : POST /system/update/apply
// Body: { "download_url": "https://github.com/..." }
// Downloads the new binary, replaces the running binary, then spawns a new daemon and exits.
async fn apply_update(
    State(state): State<Arc<DaemonState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let download_url = body["download_url"]
        .as_str()
        .ok_or_else(|| ApiError::bad_request("download_url required"))?;

    // Security: only allow GitHub release URLs
    if !download_url.starts_with("https://github.com/") {
        return Err(ApiError::bad_request("download_url must be a github.com URL"));
    }

    let current_exe = std::env::current_exe()
        .map_err(|e| ApiError::internal(format!("cannot determine exe path: {e}")))?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| ApiError::internal("exe has no parent directory"))?;
    let tmp_path = exe_dir.join("alter_update.tmp");

    // Download binary to temp file
    if let Err(e) = download_binary(download_url, &tmp_path).await {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(ApiError::internal(format!("download failed: {e}")));
    }

    // Replace binary (OS-specific)
    if let Err(e) = replace_binary(&current_exe, &tmp_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(ApiError::internal(format!("binary replacement failed: {e}")));
    }

    // Spawn new daemon then exit — fire and forget
    let port = state.config.port;
    let respawn_exe = current_exe.clone();
    tokio::spawn(async move {
        let _ = state.save_to_disk().await;
        crate::utils::pid::remove_pid_file();
        spawn_new_daemon(&respawn_exe, port);
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        std::process::exit(0);
    });

    Ok(Json(json!({ "success": true, "message": "update applied, daemon restarting" })))
}

// @group Utilities > Update : Stream-download a URL to a local file
async fn download_binary(url: &str, dest: &std::path::Path) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .user_agent("alter-pm2")
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(anyhow::anyhow!("HTTP {}", resp.status()));
    }

    let mut file = tokio::fs::File::create(dest).await?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;
    Ok(())
}

// @group Utilities > Update : Replace the running binary with the downloaded temp file (OS-specific)
fn replace_binary(current_exe: &std::path::Path, tmp_path: &std::path::Path) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        // Windows: rename the running exe to .old (allowed on Windows even for running exes),
        // then rename the new binary into place.
        let old_path = {
            let mut p = current_exe.to_path_buf();
            let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            p.set_file_name(format!("{stem}.exe.old"));
            p
        };
        std::fs::rename(current_exe, &old_path)?;
        std::fs::rename(tmp_path, current_exe)?;
    }
    #[cfg(not(windows))]
    {
        // Unix/macOS: set executable bit, then atomically rename over the current binary.
        // The running process retains the old inode — only new invocations use the new binary.
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(tmp_path, std::fs::Permissions::from_mode(0o755))?;
        std::fs::rename(tmp_path, current_exe)?;
    }
    Ok(())
}

// @group Utilities > Update : Spawn a detached new daemon process after the update completes
fn spawn_new_daemon(exe: &std::path::Path, port: u16) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        let cmd = format!(
            "timeout /t 1 /nobreak >nul 2>&1 && \"{}\" --port {} daemon start",
            exe.display(),
            port
        );
        let _ = std::process::Command::new("cmd")
            .args(["/C", &cmd])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let cmd = format!(
            "sleep 1 && \"{}\" --port {} daemon start",
            exe.display(),
            port
        );
        let _ = std::process::Command::new("sh")
            .args(["-c", &cmd])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}
