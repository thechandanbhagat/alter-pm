// @group APIEndpoints : Tunnel routes — create, list, stop tunnels and manage tunnel settings

// @group Utilities > InstallStream : Strip CR-based spinner frames from winget/brew output lines.
// Winget uses \r to overwrite the current line (spinner animation); split on \r and take the last
// non-empty segment so the UI sees only the final visible text for each line.
pub(crate) fn clean_install_line(raw: &str) -> Option<String> {
    let s = raw.trim_end_matches(['\n', '\r']);
    let last = s.split('\r').filter(|p| !p.trim().is_empty()).last()?;
    let clean = last.trim().to_string();
    if clean.is_empty() { None } else { Some(clean) }
}

use crate::daemon::state::DaemonState;
use crate::models::tunnel::{CreateTunnelRequest, InstallProviderRequest, TestProviderRequest};
use axum::{
    extract::{Path, Query, State},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        // @group APIEndpoints > Tunnels : Active tunnel management
        .route("/", get(list_tunnels))
        .route("/", post(create_tunnel))
        .route("/{id}/stop", post(stop_tunnel))
        .route("/{id}", delete(remove_tunnel))
        // @group APIEndpoints > TunnelSettings : Provider configuration
        .route("/settings", get(get_settings))
        .route("/settings", put(update_settings))
        .route("/settings/test", post(test_provider))
        .route("/settings/install", post(install_provider))
        .route("/settings/install/stream", get(install_provider_stream))
        .with_state(state)
}

// @group APIEndpoints > Tunnels : GET /tunnels — list all tracked tunnels
async fn list_tunnels(State(state): State<Arc<DaemonState>>) -> Json<Value> {
    let tunnels = state.tunnel_manager.list();
    Json(json!({ "tunnels": tunnels }))
}

// @group APIEndpoints > Tunnels : POST /tunnels — create a new tunnel for a port
async fn create_tunnel(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<CreateTunnelRequest>,
) -> Json<Value> {
    let settings = state.tunnel_settings.read().await.clone();
    match state.tunnel_manager.create(req, &settings).await {
        Ok(entry) => Json(json!({ "tunnel": entry })),
        Err(e) => Json(json!({ "error": e })),
    }
}

// @group APIEndpoints > Tunnels : DELETE /tunnels/:id — stop a running tunnel
async fn stop_tunnel(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> Json<Value> {
    if state.tunnel_manager.stop(&id) {
        Json(json!({ "success": true }))
    } else {
        Json(json!({ "success": false, "error": "Tunnel not found" }))
    }
}

// @group APIEndpoints > Tunnels : DELETE /tunnels/:id/remove — remove a stopped/failed tunnel from the list
async fn remove_tunnel(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> Json<Value> {
    // Stop first (no-op if already stopped), then remove from list
    state.tunnel_manager.stop(&id);
    if state.tunnel_manager.remove(&id) {
        Json(json!({ "success": true }))
    } else {
        Json(json!({ "success": false, "error": "Tunnel not found" }))
    }
}

// @group APIEndpoints > TunnelSettings : GET /tunnels/settings
async fn get_settings(State(state): State<Arc<DaemonState>>) -> Json<Value> {
    let settings = state.tunnel_settings.read().await.clone();
    Json(json!(settings))
}

// @group APIEndpoints > TunnelSettings : PUT /tunnels/settings — persist provider config
async fn update_settings(
    State(state): State<Arc<DaemonState>>,
    Json(new_settings): Json<crate::models::tunnel::TunnelSettings>,
) -> Json<Value> {
    match crate::config::tunnel_config::save(&new_settings) {
        Ok(()) => {
            *state.tunnel_settings.write().await = new_settings;
            Json(json!({ "success": true }))
        }
        Err(e) => Json(json!({ "success": false, "error": e.to_string() })),
    }
}

// @group APIEndpoints > TunnelSettings : POST /tunnels/settings/test — check if provider binary is installed
async fn test_provider(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<TestProviderRequest>,
) -> Json<Value> {
    let settings = state.tunnel_settings.read().await.clone();
    let (ok, message) = crate::tunnel::check_provider(&req.provider, &settings).await;
    Json(json!({ "ok": ok, "message": message }))
}

// @group APIEndpoints > TunnelSettings : POST /tunnels/settings/install — install a provider binary via package manager
async fn install_provider(
    Json(req): Json<InstallProviderRequest>,
) -> Json<Value> {
    use crate::models::tunnel::TunnelProvider;

    let install_cmd: Option<(&str, Vec<&str>)> = match req.provider {
        TunnelProvider::Cloudflare => {
            #[cfg(windows)]
            { Some(("winget", vec!["install", "--id", "Cloudflare.cloudflared", "-e", "--accept-source-agreements", "--accept-package-agreements"])) }
            #[cfg(target_os = "macos")]
            { Some(("brew", vec!["install", "cloudflare/cloudflare/cloudflared"])) }
            #[cfg(target_os = "linux")]
            { Some(("sh", vec!["-c", "curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main' | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared"])) }
        }
        TunnelProvider::Ngrok => {
            #[cfg(windows)]
            { Some(("winget", vec!["install", "--id", "ngrok.ngrok", "-e", "--accept-source-agreements", "--accept-package-agreements"])) }
            #[cfg(target_os = "macos")]
            { Some(("brew", vec!["install", "ngrok/ngrok/ngrok"])) }
            #[cfg(target_os = "linux")]
            { Some(("sh", vec!["-c", "curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok"])) }
        }
        TunnelProvider::Custom => {
            return Json(json!({ "ok": false, "output": "Custom provider — install the binary yourself and set the binary path above." }));
        }
    };

    let Some((program, args)) = install_cmd else {
        return Json(json!({ "ok": false, "output": "Unsupported platform for auto-install." }));
    };

    let result = tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new(program)
                .args(&args)
                .creation_flags(0x0800_0000)
                .output()
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new(program)
                .args(&args)
                .output()
        }
    }).await;

    match result {
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let output = format!("{}{}", stdout, stderr).trim().to_string();
            let ok = out.status.success();
            Json(json!({ "ok": ok, "output": output }))
        }
        Ok(Err(e)) => Json(json!({ "ok": false, "output": format!("Failed to run installer: {e}") })),
        Err(_)     => Json(json!({ "ok": false, "output": "Install task panicked" })),
    }
}

// @group APIEndpoints > TunnelSettings : GET /tunnels/settings/install/stream?provider=... — SSE stream of install output
#[derive(Deserialize)]
struct InstallStreamQuery {
    provider: String,
}

async fn install_provider_stream(
    Query(q): Query<InstallStreamQuery>,
) -> axum::response::Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>> {
    use axum::response::sse::Event;
    use axum::response::Sse;
    use crate::models::tunnel::TunnelProvider;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use std::process::Stdio;

    let provider: TunnelProvider = match q.provider.as_str() {
        "cloudflare" => TunnelProvider::Cloudflare,
        "ngrok"      => TunnelProvider::Ngrok,
        _            => TunnelProvider::Custom,
    };

    // Resolve install command before entering the stream — keeps a single stream block
    let install_cmd: Result<(String, Vec<String>), String> = match provider {
        TunnelProvider::Custom => Err("Custom provider — install the binary yourself and set the binary path above.".into()),
        TunnelProvider::Cloudflare => {
            #[cfg(windows)]
            { Ok(("winget".into(), vec!["install".into(), "--id".into(), "Cloudflare.cloudflared".into(), "-e".into(), "--accept-source-agreements".into(), "--accept-package-agreements".into()])) }
            #[cfg(target_os = "macos")]
            { Ok(("brew".into(), vec!["install".into(), "cloudflare/cloudflare/cloudflared".into()])) }
            #[cfg(target_os = "linux")]
            { Ok(("sh".into(), vec!["-c".into(), "curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main' | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared".into()])) }
        }
        TunnelProvider::Ngrok => {
            #[cfg(windows)]
            { Ok(("winget".into(), vec!["install".into(), "--id".into(), "ngrok.ngrok".into(), "-e".into(), "--accept-source-agreements".into(), "--accept-package-agreements".into()])) }
            #[cfg(target_os = "macos")]
            { Ok(("brew".into(), vec!["install".into(), "ngrok/ngrok/ngrok".into()])) }
            #[cfg(target_os = "linux")]
            { Ok(("sh".into(), vec!["-c".into(), "curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok".into()])) }
        }
    };

    let stream = async_stream::stream! {
        let (program, args) = match install_cmd {
            Err(msg) => {
                yield Ok(Event::default().data(json!({"line": msg, "stream": "stderr"}).to_string()));
                yield Ok(Event::default().data(json!({"done": true, "ok": false}).to_string()));
                return;
            }
            Ok(cmd) => cmd,
        };

        let mut cmd = tokio::process::Command::new(&program);
        cmd.args(&args)
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                yield Ok(Event::default().data(json!({"line": format!("Failed to start installer: {e}"), "stream": "stderr"}).to_string()));
                yield Ok(Event::default().data(json!({"done": true, "ok": false}).to_string()));
                return;
            }
        };

        let stdout = child.stdout.take().map(BufReader::new);
        let stderr = child.stderr.take().map(BufReader::new);

        // Stream stdout lines
        if let Some(mut rdr) = stdout {
            let mut line = String::new();
            loop {
                line.clear();
                match rdr.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Some(clean) = clean_install_line(&line) {
                            yield Ok(Event::default().data(json!({"line": clean, "stream": "stdout"}).to_string()));
                        }
                    }
                    Err(_) => break,
                }
            }
        }

        // Stream stderr lines
        if let Some(mut rdr) = stderr {
            let mut line = String::new();
            loop {
                line.clear();
                match rdr.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Some(clean) = clean_install_line(&line) {
                            yield Ok(Event::default().data(json!({"line": clean, "stream": "stderr"}).to_string()));
                        }
                    }
                    Err(_) => break,
                }
            }
        }

        let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
        yield Ok(Event::default().data(json!({"done": true, "ok": ok}).to_string()));
    };

    Sse::new(stream)
}

// @group UnitTests : clean_install_line — CR spinner stripping
#[cfg(test)]
mod tests {
    use super::*;

    // @group UnitTests > CleanLine : Plain line with no CR passes through unchanged
    #[test]
    fn test_clean_plain_line() {
        let result = clean_install_line("Successfully installed cloudflared\n");
        assert_eq!(result.unwrap(), "Successfully installed cloudflared");
    }

    // @group UnitTests > CleanLine : Last non-empty CR segment is kept, spinner frames discarded
    #[test]
    fn test_clean_spinner_frames_discarded() {
        let raw = "\r   - \r   \\ \r   | \r   / \rFound cloudflared Version 2025.8.1\n";
        let result = clean_install_line(raw).unwrap();
        assert_eq!(result, "Found cloudflared Version 2025.8.1");
    }

    // @group UnitTests > CleanLine : Windows CRLF line endings are stripped
    #[test]
    fn test_clean_crlf_endings() {
        let result = clean_install_line("Downloading installer\r\n");
        assert_eq!(result.unwrap(), "Downloading installer");
    }

    // @group UnitTests > CleanLine : Line with only whitespace / CR returns None
    #[test]
    fn test_clean_whitespace_only_returns_none() {
        assert!(clean_install_line("   \r   \r   \n").is_none());
    }

    // @group UnitTests > CleanLine : Completely empty string returns None
    #[test]
    fn test_clean_empty_returns_none() {
        assert!(clean_install_line("").is_none());
    }

    // @group UnitTests > CleanLine : Leading and trailing spaces are trimmed from the result
    #[test]
    fn test_clean_trims_whitespace() {
        let result = clean_install_line("  padded content  \n");
        assert_eq!(result.unwrap(), "padded content");
    }

    // @group UnitTests > CleanLine : Multiple CR segments — only the last meaningful one is returned
    #[test]
    fn test_clean_multiple_cr_segments() {
        let raw = "\rfirst\rsecond\rthird\n";
        assert_eq!(clean_install_line(raw).unwrap(), "third");
    }
}
