// @group BusinessLogic : Tunnel manager — spawn and track cloudflared / ngrok / custom tunnel subprocesses

use crate::models::tunnel::{
    CreateTunnelRequest, TunnelEntry, TunnelProvider, TunnelSettings, TunnelStatus,
};
use chrono::Utc;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use uuid::Uuid;

// @group BusinessLogic > TunnelManager : Shared handle — cheap to clone, backed by Arc
#[derive(Clone)]
pub struct TunnelManager {
    pub entries: Arc<DashMap<String, TunnelEntry>>,
    pids: Arc<DashMap<String, u32>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(DashMap::new()),
            pids: Arc::new(DashMap::new()),
        }
    }

    // @group BusinessLogic > TunnelManager : Spawn a new tunnel subprocess and track it
    pub async fn create(
        &self,
        req: CreateTunnelRequest,
        settings: &TunnelSettings,
    ) -> Result<TunnelEntry, String> {
        let id = Uuid::new_v4().to_string();
        let provider = req.provider.clone().unwrap_or_else(|| settings.provider.clone());

        let entry = TunnelEntry {
            id: id.clone(),
            port: req.port,
            process_name: req.process_name.clone(),
            process_id: req.process_id.clone(),
            provider: provider.clone(),
            public_url: None,
            status: TunnelStatus::Starting,
            error: None,
            created_at: Utc::now(),
        };

        self.entries.insert(id.clone(), entry.clone());

        // Build the tokio::process::Command for the selected provider
        let mut cmd = match build_command(&provider, req.port, settings) {
            Ok(c) => c,
            Err(e) => {
                if let Some(mut ent) = self.entries.get_mut(&id) {
                    ent.status = TunnelStatus::Failed;
                    ent.error = Some(e.clone());
                }
                return Err(e);
            }
        };

        // @group BusinessLogic > TunnelManager : Hide console window on Windows
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        let mut child = match cmd
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("Failed to spawn tunnel process: {e}");
                if let Some(mut ent) = self.entries.get_mut(&id) {
                    ent.status = TunnelStatus::Failed;
                    ent.error = Some(msg.clone());
                }
                return Err(msg);
            }
        };

        if let Some(pid) = child.id() {
            self.pids.insert(id.clone(), pid);
        }

        // Spawn background task: scan output for URL, then monitor process exit
        let entries = Arc::clone(&self.entries);
        let pids = Arc::clone(&self.pids);
        let tunnel_id = id.clone();
        let provider_for_task = provider.clone();

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        tokio::spawn(async move {
            let url = watch_output(stdout, stderr, &provider_for_task).await;

            match url {
                Some(found_url) => {
                    if let Some(mut e) = entries.get_mut(&tunnel_id) {
                        e.public_url = Some(found_url);
                        e.status = TunnelStatus::Active;
                    }
                }
                None => {
                    // Timed out or process exited before URL was found
                    if let Some(mut e) = entries.get_mut(&tunnel_id) {
                        if e.status == TunnelStatus::Starting {
                            e.status = TunnelStatus::Failed;
                            e.error = Some(
                                "Process exited or timed out before a public URL was found. \
                                 Check that the binary is installed and in PATH."
                                    .into(),
                            );
                        }
                    }
                    pids.remove(&tunnel_id);
                    return;
                }
            }

            // After URL found, wait for the process to exit and mark it failed
            let _ = child.wait().await;
            pids.remove(&tunnel_id);
            if let Some(mut e) = entries.get_mut(&tunnel_id) {
                if e.status == TunnelStatus::Active {
                    e.status = TunnelStatus::Failed;
                    e.error = Some("Tunnel process exited unexpectedly".into());
                }
            }
        });

        Ok(entry)
    }

    // @group BusinessLogic > TunnelManager : Return all tunnel entries (any status)
    pub fn list(&self) -> Vec<TunnelEntry> {
        let mut list: Vec<TunnelEntry> = self.entries.iter().map(|e| e.value().clone()).collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    // @group BusinessLogic > TunnelManager : Kill a tunnel by ID and mark it stopped
    pub fn stop(&self, id: &str) -> bool {
        if let Some((_, pid)) = self.pids.remove(id) {
            kill_pid(pid);
        }
        match self.entries.get_mut(id) {
            Some(mut e) => {
                e.status = TunnelStatus::Stopped;
                e.error = None;
                true
            }
            None => false,
        }
    }

    // @group BusinessLogic > TunnelManager : Remove a stopped/failed tunnel from the list
    pub fn remove(&self, id: &str) -> bool {
        self.pids.remove(id);
        self.entries.remove(id).is_some()
    }
}

// @group Utilities > TunnelManager : Build the tokio Command for each provider
fn build_command(
    provider: &TunnelProvider,
    port: u16,
    settings: &TunnelSettings,
) -> Result<tokio::process::Command, String> {
    match provider {
        TunnelProvider::Cloudflare => {
            let mut cmd = tokio::process::Command::new("cloudflared");
            // Named tunnel when a token is configured; quick tunnel otherwise
            if let Some(token) = &settings.cloudflare.token {
                if !token.is_empty() {
                    cmd.args(["tunnel", "run", "--token", token]);
                    return Ok(cmd);
                }
            }
            cmd.args([
                "tunnel",
                "--url",
                &format!("http://localhost:{port}"),
                "--no-autoupdate",
            ]);
            Ok(cmd)
        }
        TunnelProvider::Ngrok => {
            let mut cmd = tokio::process::Command::new("ngrok");
            cmd.args(["http", &port.to_string(), "--log=stdout", "--log-format=json"]);
            if let Some(token) = &settings.ngrok.auth_token {
                if !token.is_empty() {
                    cmd.env("NGROK_AUTHTOKEN", token);
                }
            }
            Ok(cmd)
        }
        TunnelProvider::Custom => {
            let binary = &settings.custom.binary_path;
            if binary.is_empty() {
                return Err(
                    "Custom tunnel binary path is not configured. Go to Settings → Tunnels.".into(),
                );
            }
            let mut cmd = tokio::process::Command::new(binary);
            let args_raw = settings
                .custom
                .args_template
                .replace("{port}", &port.to_string());
            if !args_raw.is_empty() {
                let args: Vec<&str> = args_raw.split_whitespace().collect();
                cmd.args(&args);
            }
            Ok(cmd)
        }
    }
}

// @group Utilities > TunnelManager : Scan subprocess stdout+stderr for a public URL
async fn watch_output(
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    provider: &TunnelProvider,
) -> Option<String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(128);

    if let Some(out) = stdout {
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if tx2.send(line).await.is_err() {
                    break;
                }
            }
        });
    }

    if let Some(err) = stderr {
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if tx2.send(line).await.is_err() {
                    break;
                }
            }
        });
    }
    drop(tx); // close sender so channel closes when both readers finish

    let timeout = tokio::time::Duration::from_secs(45);
    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(line)) => {
                if let Some(url) = extract_url(&line, provider) {
                    return Some(url);
                }
            }
            Ok(None) => return None, // channel closed — process exited
            Err(_) => return None,   // 45-second timeout
        }
    }
}

// @group Utilities > TunnelManager : Provider-specific URL extraction from one output line
fn extract_url(line: &str, provider: &TunnelProvider) -> Option<String> {
    match provider {
        TunnelProvider::Cloudflare => {
            // Quick tunnel: "https://abc-def-123.trycloudflare.com"
            // Named tunnel: "https://your-domain.example.com"
            // The URL appears on a line containing the domain
            if let Some(start) = line.find("https://") {
                let rest = &line[start..];
                let end = rest
                    .find(|c: char| c.is_whitespace() || c == '"' || c == '|' || c == '\'' || c == '>')
                    .unwrap_or(rest.len());
                let url = rest[..end].trim_end_matches('/');
                if url.len() > 10 && url.contains('.') {
                    return Some(url.to_string());
                }
            }
            None
        }
        TunnelProvider::Ngrok => {
            // JSON log line: {...,"msg":"started tunnel",...,"url":"https://abc.ngrok-free.app"}
            if let Some(idx) = line.find("\"url\":\"") {
                let rest = &line[idx + 7..];
                if rest.starts_with("https://") {
                    let end = rest.find('"').unwrap_or(rest.len());
                    return Some(rest[..end].to_string());
                }
            }
            // Fallback: any https:// URL on a line mentioning ngrok or tunnel
            if line.contains("https://") && (line.contains("ngrok") || line.contains("tunnel")) {
                if let Some(start) = line.find("https://") {
                    let rest = &line[start..];
                    let end = rest
                        .find(|c: char| c.is_whitespace() || c == '"')
                        .unwrap_or(rest.len());
                    if end > 8 {
                        return Some(rest[..end].to_string());
                    }
                }
            }
            None
        }
        TunnelProvider::Custom => {
            // Generic: grab the first https:// URL found on the line
            if let Some(start) = line.find("https://") {
                let rest = &line[start..];
                let end = rest
                    .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                    .unwrap_or(rest.len());
                if end > 8 {
                    return Some(rest[..end].to_string());
                }
            }
            None
        }
    }
}

// @group Utilities > TunnelManager : Kill a process by PID cross-platform
fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // /T kills child processes too (e.g. cloudflared spawns its own children)
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .output();
    }
    #[cfg(not(windows))]
    {
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
    }
}

// @group Utilities > TunnelManager : Check whether a provider binary is reachable
pub async fn check_provider(provider: &TunnelProvider, settings: &TunnelSettings) -> (bool, String) {
    let binary = match provider {
        TunnelProvider::Cloudflare => "cloudflared".to_string(),
        TunnelProvider::Ngrok => "ngrok".to_string(),
        TunnelProvider::Custom => settings.custom.binary_path.clone(),
    };

    if binary.is_empty() {
        return (false, "Binary path is not configured".into());
    }

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    match cmd.spawn() {
        Ok(mut child) => {
            let _ = child.wait().await;
            (true, format!("`{binary}` is installed and reachable"))
        }
        Err(_) => (
            false,
            format!(
                "`{binary}` not found — install it and make sure it is in your PATH"
            ),
        ),
    }
}

// @group UnitTests : extract_url — Cloudflare / ngrok / custom provider URL parsing
#[cfg(test)]
mod tests {
    use super::*;

    // @group UnitTests > Cloudflare : Quick-tunnel line yields the trycloudflare URL
    #[test]
    fn test_cloudflare_quick_tunnel_url() {
        let line = "2026-03-30T00:00:00Z INF | https://abc-def-123.trycloudflare.com |";
        let url = extract_url(line, &TunnelProvider::Cloudflare).unwrap();
        assert_eq!(url, "https://abc-def-123.trycloudflare.com");
    }

    // @group UnitTests > Cloudflare : Named tunnel line yields the custom domain URL
    #[test]
    fn test_cloudflare_named_tunnel_url() {
        let line = "Registered tunnel connection tunnelID=xxx url=https://my.example.com";
        let url = extract_url(line, &TunnelProvider::Cloudflare).unwrap();
        assert_eq!(url, "https://my.example.com");
    }

    // @group UnitTests > Cloudflare : Trailing slash is stripped from the URL
    #[test]
    fn test_cloudflare_strips_trailing_slash() {
        let line = "https://trailing.trycloudflare.com/";
        let url = extract_url(line, &TunnelProvider::Cloudflare).unwrap();
        assert_eq!(url, "https://trailing.trycloudflare.com");
    }

    // @group UnitTests > Cloudflare : Line with no URL returns None
    #[test]
    fn test_cloudflare_no_url_returns_none() {
        let url = extract_url("starting cloudflared process", &TunnelProvider::Cloudflare);
        assert!(url.is_none());
    }

    // @group UnitTests > Ngrok : JSON log line with "url" key yields the tunnel URL
    #[test]
    fn test_ngrok_json_url() {
        let line = r#"{"level":"info","msg":"started tunnel","url":"https://abc123.ngrok-free.app"}"#;
        let url = extract_url(line, &TunnelProvider::Ngrok).unwrap();
        assert_eq!(url, "https://abc123.ngrok-free.app");
    }

    // @group UnitTests > Ngrok : Fallback path — plain line mentioning ngrok + https URL
    #[test]
    fn test_ngrok_fallback_url() {
        let line = "started ngrok tunnel at https://abc.ngrok.io";
        let url = extract_url(line, &TunnelProvider::Ngrok).unwrap();
        assert_eq!(url, "https://abc.ngrok.io");
    }

    // @group UnitTests > Ngrok : Line with no URL returns None
    #[test]
    fn test_ngrok_no_url_returns_none() {
        let url = extract_url("ngrok connecting...", &TunnelProvider::Ngrok);
        assert!(url.is_none());
    }

    // @group UnitTests > Custom : Any line with an https:// URL returns it
    #[test]
    fn test_custom_picks_first_https_url() {
        let line = "tunnel ready at https://custom-tool.example.io/path";
        let url = extract_url(line, &TunnelProvider::Custom).unwrap();
        assert_eq!(url, "https://custom-tool.example.io/path");
    }

    // @group UnitTests > Custom : URL surrounded by quotes is extracted without them
    #[test]
    fn test_custom_quoted_url() {
        let line = r#"url="https://quoted.example.com" status=ok"#;
        let url = extract_url(line, &TunnelProvider::Custom).unwrap();
        assert_eq!(url, "https://quoted.example.com");
    }

    // @group UnitTests > Custom : Line without https returns None
    #[test]
    fn test_custom_no_url_returns_none() {
        let url = extract_url("starting custom tool...", &TunnelProvider::Custom);
        assert!(url.is_none());
    }

    // @group UnitTests > EdgeCases : Empty line returns None for all providers
    #[test]
    fn test_empty_line_all_providers() {
        for provider in [TunnelProvider::Cloudflare, TunnelProvider::Ngrok, TunnelProvider::Custom] {
            assert!(extract_url("", &provider).is_none());
        }
    }
}
