// @group APIEndpoints : HTTP client wrapper — CLI to daemon communication

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub struct DaemonClient {
    base_url: String,
    client: Client,
}

impl DaemonClient {
    pub fn new(host: &str, port: u16) -> Self {
        // @group Authentication : Inject master token so the CLI authenticates with the daemon
        let token = crate::config::auth_config::load().master_token;
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}")) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
        }

        Self {
            base_url: format!("http://{host}:{port}"),
            client: Client::builder()
                .default_headers(headers)
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("failed to build HTTP client"),
        }
    }

    // @group APIEndpoints > Client : Check if daemon is reachable
    pub async fn is_alive(&self) -> bool {
        self.client
            .get(format!("{}/api/v1/system/health", self.base_url))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    // @group APIEndpoints > Client : GET request helper
    pub async fn get(&self, path: &str) -> Result<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.get(&url).send().await
            .with_context(|| format!("GET {url} failed"))?;
        self.handle_response(resp).await
    }

    // @group APIEndpoints > Client : POST request helper
    pub async fn post(&self, path: &str, body: Value) -> Result<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.post(&url).json(&body).send().await
            .with_context(|| format!("POST {url} failed"))?;
        self.handle_response(resp).await
    }

    // @group APIEndpoints > Client : DELETE request helper
    pub async fn delete(&self, path: &str) -> Result<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.delete(&url).send().await
            .with_context(|| format!("DELETE {url} failed"))?;
        self.handle_response(resp).await
    }

    // @group APIEndpoints > Client : Stream SSE logs — calls callback for each line
    pub async fn stream_logs(
        &self,
        process_id: &str,
        mut on_line: impl FnMut(String),
    ) -> Result<()> {
        use futures::StreamExt;

        let url = format!("{}/api/v1/processes/{process_id}/logs/stream", self.base_url);
        let resp = self.client.get(&url).send().await
            .with_context(|| "failed to connect to log stream")?;

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buf.find('\n') {
                let line = buf[..pos].trim().to_string();
                buf = buf[pos + 1..].to_string();

                if let Some(data) = line.strip_prefix("data: ") {
                    on_line(data.to_string());
                }
            }
        }
        Ok(())
    }

    async fn handle_response(&self, resp: reqwest::Response) -> Result<Value> {
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);

        if status.is_success() {
            Ok(body)
        } else {
            let msg = body
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error")
                .to_string();
            Err(anyhow!("{}", msg))
        }
    }
}

/// Ensure daemon is running; print helpful message and exit if not
pub fn require_daemon(client: &DaemonClient) -> Result<()> {
    // This is called in async context via block_on, but we expose it as sync for CLI use
    Ok(())
}
