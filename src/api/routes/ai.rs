// @group APIEndpoints : AI assistant endpoints — settings CRUD, OAuth Device Flow, model listing, streaming chat

use crate::api::error::ApiError;
use copilot_client;
use crate::daemon::state::DaemonState;
use crate::models::ai::{AiSettings, ChatRequest, DeviceAuthState};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use bytes::Bytes;
use chrono::Utc;
use futures::StreamExt;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/settings", get(get_settings).put(save_settings))
        .route("/chat", post(chat))
        .route("/auth/start", post(auth_start))
        .route("/auth/status", get(auth_status))
        .route("/auth", delete(auth_logout))
        .route("/models", get(list_models))
        .with_state(state)
}

// @group Configuration : Path to ai-settings.json
fn settings_path() -> std::path::PathBuf {
    crate::config::paths::data_dir().join("ai-settings.json")
}

/// Client ID baked in at compile time via GH_OAUTH_CLIENT_ID env var (optional).
const BUILTIN_CLIENT_ID: Option<&str> = option_env!("GH_OAUTH_CLIENT_ID");

// @group Utilities > AI : Load AI settings from disk, return defaults if missing
fn load_settings() -> AiSettings {
    let path = settings_path();
    let mut settings: AiSettings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if settings.client_id.is_empty() {
        if let Some(id) = BUILTIN_CLIENT_ID {
            settings.client_id = id.to_string();
        }
    }
    settings
}

// @group Utilities > AI : Persist AI settings to disk
fn persist_settings(settings: &AiSettings) -> Result<(), ApiError> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ApiError::internal(format!("cannot create data dir: {e}")))?;
    }
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| ApiError::internal(format!("serialize error: {e}")))?;
    std::fs::write(&path, content)
        .map_err(|e| ApiError::internal(format!("write error: {e}")))?;
    Ok(())
}

// @group APIEndpoints > AI : GET /ai/settings — load persisted AI config
async fn get_settings() -> Json<Value> {
    let s = load_settings();

    let mask = |tok: &str| -> String {
        if tok.is_empty() { return String::new() }
        if tok.len() > 8 { format!("{}…{}", &tok[..4], &tok[tok.len()-4..]) }
        else { "****".to_string() }
    };

    Json(json!({
        "provider":          s.provider,
        "enabled":           s.enabled,
        "model":             s.model,
        // GitHub
        "github_token_set":  !s.github_token.is_empty(),
        "github_token_hint": mask(&s.github_token),
        "github_username":   s.github_username,
        "client_id_set":     !s.client_id.is_empty(),
        "client_id_builtin": BUILTIN_CLIENT_ID.is_some(),
        // Claude
        "anthropic_key_set": !s.anthropic_key.is_empty(),
        "anthropic_key_hint": mask(&s.anthropic_key),
        // OpenAI
        "openai_key_set":    !s.openai_key.is_empty(),
        "openai_key_hint":   mask(&s.openai_key),
        "openai_base_url":   s.openai_base_url,
        // Ollama
        "ollama_base_url":   s.ollama_base_url,
    }))
}

// @group APIEndpoints > AI : PUT /ai/settings — persist AI config (partial update, empty strings ignored for secrets)
async fn save_settings(Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let mut s = load_settings();

    if let Some(v) = body.get("provider").and_then(|v| v.as_str()) { s.provider = v.to_string() }
    if let Some(v) = body.get("model").and_then(|v| v.as_str())    { s.model    = v.to_string() }
    if let Some(v) = body.get("enabled").and_then(|v| v.as_bool()) { s.enabled  = v }

    // GitHub
    if let Some(v) = body.get("github_token").and_then(|v| v.as_str()) {
        if !v.is_empty() { s.github_token = v.to_string() }
    }
    if let Some(v) = body.get("client_id").and_then(|v| v.as_str()) {
        if !v.is_empty() { s.client_id = v.to_string() }
    }
    // Claude
    if let Some(v) = body.get("anthropic_key").and_then(|v| v.as_str()) {
        if !v.is_empty() { s.anthropic_key = v.to_string() }
    }
    // OpenAI
    if let Some(v) = body.get("openai_key").and_then(|v| v.as_str()) {
        if !v.is_empty() { s.openai_key = v.to_string() }
    }
    if let Some(v) = body.get("openai_base_url").and_then(|v| v.as_str()) {
        if !v.is_empty() { s.openai_base_url = v.to_string() }
    }
    // Ollama
    if let Some(v) = body.get("ollama_base_url").and_then(|v| v.as_str()) {
        if !v.is_empty() { s.ollama_base_url = v.to_string() }
    }

    persist_settings(&s)?;
    Ok(Json(json!({ "success": true })))
}

// @group APIEndpoints > AI : POST /ai/auth/start — begin GitHub Device Flow
async fn auth_start(
    State(state): State<Arc<DaemonState>>,
) -> Result<Json<Value>, ApiError> {
    let settings = load_settings();

    if settings.client_id.is_empty() {
        return Err(ApiError::bad_request(
            "No GitHub OAuth App Client ID configured. Add one in Settings → AI Assistant.",
        ));
    }

    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .json(&json!({
            "client_id": settings.client_id,
            "scope": "read:user",
        }))
        .send()
        .await
        .map_err(|e| ApiError::internal(format!("GitHub request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::internal(format!("GitHub Device Flow error {status}: {body}")));
    }

    let data: Value = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("Failed to parse GitHub response: {e}")))?;

    let device_code      = data["device_code"].as_str().unwrap_or_default().to_string();
    let user_code        = data["user_code"].as_str().unwrap_or_default().to_string();
    let verification_uri = data["verification_uri"].as_str().unwrap_or("https://github.com/login/device").to_string();
    let expires_in       = data["expires_in"].as_u64().unwrap_or(900);
    let interval         = data["interval"].as_u64().unwrap_or(5);

    if device_code.is_empty() || user_code.is_empty() {
        return Err(ApiError::internal("GitHub returned empty device_code or user_code"));
    }

    *state.ai_device_auth.lock().await = Some(DeviceAuthState {
        device_code,
        user_code: user_code.clone(),
        verification_uri: verification_uri.clone(),
        expires_at: Utc::now() + chrono::Duration::seconds(expires_in as i64),
        interval_secs: interval,
    });

    Ok(Json(json!({
        "user_code": user_code,
        "verification_uri": verification_uri,
        "expires_in": expires_in,
        "interval": interval,
    })))
}

// @group APIEndpoints > AI : GET /ai/auth/status — poll GitHub token exchange
async fn auth_status(
    State(state): State<Arc<DaemonState>>,
) -> Result<Json<Value>, ApiError> {
    let settings = load_settings();
    let mut guard = state.ai_device_auth.lock().await;

    let auth = match guard.as_mut() {
        None => return Ok(Json(json!({ "status": "idle" }))),
        Some(a) => a,
    };

    if Utc::now() >= auth.expires_at {
        *guard = None;
        return Ok(Json(json!({ "status": "expired" })));
    }

    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&json!({
            "client_id":   settings.client_id,
            "device_code": auth.device_code,
            "grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
        }))
        .send()
        .await
        .map_err(|e| ApiError::internal(format!("GitHub poll request failed: {e}")))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("Failed to parse GitHub poll response: {e}")))?;

    if let Some(error) = data["error"].as_str() {
        match error {
            "authorization_pending" => return Ok(Json(json!({ "status": "pending", "interval": auth.interval_secs }))),
            "slow_down" => {
                auth.interval_secs += 5;
                let i = auth.interval_secs;
                return Ok(Json(json!({ "status": "pending", "interval": i })));
            }
            "expired_token" => { *guard = None; return Ok(Json(json!({ "status": "expired" }))) }
            "access_denied"  => { *guard = None; return Ok(Json(json!({ "status": "denied"  }))) }
            other => { *guard = None; return Ok(Json(json!({ "status": "error", "message": other }))) }
        }
    }

    if let Some(token) = data["access_token"].as_str() {
        let token    = token.to_string();
        let username = fetch_github_username(&token).await.unwrap_or_default();
        let mut new_settings = load_settings();
        new_settings.github_token    = token;
        new_settings.github_username = username.clone();
        persist_settings(&new_settings)?;
        *guard = None;
        return Ok(Json(json!({ "status": "complete", "username": username })));
    }

    Ok(Json(json!({ "status": "pending", "interval": auth.interval_secs })))
}

// @group APIEndpoints > AI : DELETE /ai/auth — disconnect GitHub account
async fn auth_logout(
    State(state): State<Arc<DaemonState>>,
) -> Result<Json<Value>, ApiError> {
    let mut settings = load_settings();
    settings.github_token    = String::new();
    settings.github_username = String::new();
    persist_settings(&settings)?;
    *state.ai_device_auth.lock().await = None;
    Ok(Json(json!({ "success": true })))
}

// @group APIEndpoints > AI : GET /ai/models — list models for the active provider
async fn list_models() -> Result<Json<Value>, ApiError> {
    let s = load_settings();
    let models = match s.provider.as_str() {
        "copilot" => list_copilot_models(&s).await?,
        "github"  => list_github_models(&s).await?,
        "claude"  => list_claude_models(),
        "openai"  => list_openai_models(&s).await?,
        "ollama"  => list_ollama_models(&s).await?,
        other     => return Err(ApiError::bad_request(format!("Unknown provider: {other}"))),
    };
    Ok(Json(json!({ "models": models })))
}

// @group Utilities > AI > Copilot : Exchange GitHub PAT for a short-lived Copilot API token
async fn get_copilot_api_token(github_token: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/copilot_internal/v2/token")
        .header("Authorization", format!("Token {github_token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "alter-pm2")
        .send().await
        .map_err(|e| anyhow::anyhow!("Copilot token request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            anyhow::bail!("GitHub Copilot is not active on this account, or your token has insufficient permissions.");
        }
        anyhow::bail!("Failed to get Copilot API token: HTTP {status}");
    }

    let data: Value = resp.json().await
        .map_err(|e| anyhow::anyhow!("Failed to parse Copilot token response: {e}"))?;
    data["token"].as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("Copilot token response missing 'token' field"))
}

// @group Utilities > AI > Copilot : Resolve GitHub token — stored token first, then gh CLI config
fn resolve_github_token(stored: &str) -> anyhow::Result<String> {
    if !stored.is_empty() {
        return Ok(stored.to_string());
    }
    copilot_client::get_github_token()
        .map_err(|_| anyhow::anyhow!(
            "No GitHub token found. Sign in via Settings → AI Assistant (GitHub provider) \
             or ensure GitHub CLI / VS Code Copilot is installed."
        ))
}

// @group Utilities > AI > Copilot : List models from GitHub Copilot API
async fn list_copilot_models(s: &AiSettings) -> Result<Vec<Value>, ApiError> {
    let github_token = resolve_github_token(&s.github_token)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let client = copilot_client::CopilotClient::new_with_models(github_token, "alter/1.0.0".to_string())
        .await
        .map_err(|e| ApiError::internal(format!("GitHub Copilot unavailable: {e}")))?;

    let models = client.get_models().await
        .map_err(|e| ApiError::internal(format!("Failed to fetch Copilot models: {e}")))?;

    Ok(models.iter().map(|m| {
        let label = if m.name.is_empty() { m.id.clone() } else { m.name.clone() };
        json!({ "id": m.id, "label": label, "publisher": "GitHub Copilot" })
    }).collect())
}

// @group BusinessLogic > AI > Copilot : Stream chat via GitHub Copilot API (OpenAI-compatible SSE)
async fn stream_copilot(
    github_token: String, model: String, messages: Vec<Value>,
    tx: mpsc::Sender<Result<Bytes, std::convert::Infallible>>,
) -> anyhow::Result<()> {
    let copilot_token = get_copilot_api_token(&github_token).await?;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.githubcopilot.com/chat/completions")
        .header("Authorization",         format!("Bearer {copilot_token}"))
        .header("Content-Type",          "application/json")
        .header("Accept",                "application/json")
        .header("Editor-Version",        "alter/1.0.0")
        .header("Editor-Plugin-Version", "alter/1.0.0")
        .header("Copilot-Integration-Id","vscode-chat")
        .header("User-Agent",            "alter-pm2")
        .json(&json!({ "model": model, "messages": messages, "stream": true, "max_tokens": 1024, "temperature": 0.7 }))
        .send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = if status.as_u16() == 401 || status.as_u16() == 403 {
            "GitHub Copilot subscription required or token expired. Re-authenticate in Settings → AI Assistant.".to_string()
        } else if status.as_u16() == 429 {
            "GitHub Copilot rate limit hit. Please wait a moment.".to_string()
        } else {
            format!("Copilot API error {status}: {body}")
        };
        anyhow::bail!("{msg}");
    }

    // Reuse the OpenAI-compat SSE parser — Copilot uses the same delta format
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { return Ok(()) }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                        if !delta.is_empty() {
                            let _ = tx.send(Ok(Bytes::from(format!("data: {}\n\n", json!({ "delta": delta }))))).await;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

// @group Utilities > AI > GitHub : Fetch GitHub Models catalog
async fn list_github_models(s: &AiSettings) -> Result<Vec<Value>, ApiError> {
    if s.github_token.is_empty() {
        return Err(ApiError::bad_request("No GitHub token. Sign in via Settings → AI Assistant."));
    }
    let client = reqwest::Client::new();
    let resp = client
        .get("https://models.github.ai/catalog/models")
        .header("Authorization", format!("Bearer {}", s.github_token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send().await
        .map_err(|e| ApiError::internal(format!("GitHub Models catalog request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::internal(format!("GitHub Models catalog error {status}: {body}")));
    }

    let catalog: Value = resp.json().await
        .map_err(|e| ApiError::internal(format!("Failed to parse catalog: {e}")))?;

    let models = catalog.as_array().unwrap_or(&vec![]).iter()
        .filter(|m| {
            m["task"].as_str().map(|t| t.contains("chat") || t.contains("completion")).unwrap_or(false)
            || m["capabilities"]["chat_completion"].as_bool().unwrap_or(false)
            || m["supported_languages"].is_array()
        })
        .map(|m| {
            let id = m["id"].as_str().or_else(|| m["name"].as_str()).unwrap_or("").to_string();
            let label = m["friendly_name"].as_str()
                .or_else(|| m["display_name"].as_str())
                .or_else(|| m["name"].as_str())
                .unwrap_or(&id).to_string();
            let publisher = m["publisher"].as_str().unwrap_or("").to_string();
            json!({ "id": id, "label": label, "publisher": publisher })
        })
        .filter(|m| !m["id"].as_str().unwrap_or("").is_empty())
        .collect();
    Ok(models)
}

// @group Utilities > AI > Claude : Hardcoded current Anthropic models
fn list_claude_models() -> Vec<Value> {
    vec![
        json!({ "id": "claude-opus-4-6",            "label": "Claude Opus 4.6",            "publisher": "Anthropic" }),
        json!({ "id": "claude-sonnet-4-6",           "label": "Claude Sonnet 4.6",           "publisher": "Anthropic" }),
        json!({ "id": "claude-haiku-4-5-20251001",   "label": "Claude Haiku 4.5",            "publisher": "Anthropic" }),
        json!({ "id": "claude-3-5-sonnet-20241022",  "label": "Claude 3.5 Sonnet",           "publisher": "Anthropic" }),
        json!({ "id": "claude-3-5-haiku-20241022",   "label": "Claude 3.5 Haiku",            "publisher": "Anthropic" }),
        json!({ "id": "claude-3-opus-20240229",      "label": "Claude 3 Opus",               "publisher": "Anthropic" }),
    ]
}

// @group Utilities > AI > OpenAI : Fetch available chat models from OpenAI-compatible endpoint
async fn list_openai_models(s: &AiSettings) -> Result<Vec<Value>, ApiError> {
    if s.openai_key.is_empty() {
        return Err(ApiError::bad_request("No OpenAI API key. Add one in Settings → AI Assistant."));
    }
    let base = s.openai_base_url.trim_end_matches('/');
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/models"))
        .header("Authorization", format!("Bearer {}", s.openai_key))
        .send().await
        .map_err(|e| ApiError::internal(format!("OpenAI models request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::internal(format!("OpenAI models error {status}: {body}")));
    }

    let data: Value = resp.json().await
        .map_err(|e| ApiError::internal(format!("Failed to parse OpenAI models response: {e}")))?;

    let chat_prefixes = ["gpt-", "o1", "o3", "chatgpt"];
    let models = data["data"].as_array().unwrap_or(&vec![]).iter()
        .filter(|m| {
            let id = m["id"].as_str().unwrap_or("");
            chat_prefixes.iter().any(|p| id.starts_with(p))
        })
        .map(|m| {
            let id = m["id"].as_str().unwrap_or("").to_string();
            json!({ "id": id.clone(), "label": id, "publisher": "OpenAI" })
        })
        .collect();
    Ok(models)
}

// @group Utilities > AI > Ollama : Fetch locally installed models from Ollama
async fn list_ollama_models(s: &AiSettings) -> Result<Vec<Value>, ApiError> {
    let base = s.ollama_base_url.trim_end_matches('/');
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/api/tags"))
        .send().await
        .map_err(|e| ApiError::internal(format!("Ollama request failed — is Ollama running? {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(ApiError::internal(format!("Ollama tags error {status}")));
    }

    let data: Value = resp.json().await
        .map_err(|e| ApiError::internal(format!("Failed to parse Ollama tags: {e}")))?;

    let models = data["models"].as_array().unwrap_or(&vec![]).iter()
        .map(|m| {
            let id = m["name"].as_str().unwrap_or("").to_string();
            json!({ "id": id.clone(), "label": id, "publisher": "Ollama" })
        })
        .collect();
    Ok(models)
}

// @group BusinessLogic > AI : POST /ai/chat — streaming SSE response, dispatches per provider
async fn chat(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<ChatRequest>,
) -> Result<Response, ApiError> {
    let settings = load_settings();

    if !settings.enabled {
        return Err(ApiError::bad_request("AI assistant is disabled. Enable it in Settings → AI Assistant."));
    }

    let system_content = build_system_prompt(&state, req.process_id.as_deref()).await;
    let mut messages: Vec<Value> = vec![json!({ "role": "system", "content": system_content })];
    for msg in &req.history { messages.push(json!({ "role": msg.role, "content": msg.content })) }
    messages.push(json!({ "role": "user", "content": req.message }));

    let (tx, rx) = mpsc::channel::<Result<Bytes, std::convert::Infallible>>(64);
    let provider      = req.provider.clone().unwrap_or(settings.provider.clone());
    let model         = req.model.clone().unwrap_or(settings.model.clone());

    // @group BusinessLogic > AI : Validate provider credentials before spawning stream task
    match provider.as_str() {
        "copilot" => {
            // Resolve token now so we can return a friendly error before spawning the stream
            resolve_github_token(&settings.github_token)
                .map_err(|e| ApiError::bad_request(e.to_string()))?;
        }
        "github" if settings.github_token.is_empty() =>
            return Err(ApiError::bad_request("No GitHub token. Sign in via Settings → AI Assistant.")),
        "claude" if settings.anthropic_key.is_empty() =>
            return Err(ApiError::bad_request("No Anthropic API key. Add one in Settings → AI Assistant.")),
        "openai" if settings.openai_key.is_empty() =>
            return Err(ApiError::bad_request("No OpenAI API key. Add one in Settings → AI Assistant.")),
        _ => {}
    }
    let github_token  = settings.github_token.clone();
    let anthropic_key = settings.anthropic_key.clone();
    let openai_key    = settings.openai_key.clone();
    let openai_base   = settings.openai_base_url.clone();
    let ollama_base   = settings.ollama_base_url.clone();

    tokio::spawn(async move {
        let result = match provider.as_str() {
            "copilot" => {
                match resolve_github_token(&github_token) {
                    Ok(tok) => stream_copilot(tok, model, messages, tx.clone()).await,
                    Err(e)  => Err(anyhow::anyhow!("{e}")),
                }
            }
            "github" => stream_openai_compat(github_token,  "https://models.github.ai/inference/chat/completions".to_string(), model, messages, tx.clone()).await,
            "claude" => stream_claude(anthropic_key, model, messages, tx.clone()).await,
            "openai" => {
                let base = openai_base.trim_end_matches('/').to_string();
                stream_openai_compat(openai_key, format!("{base}/chat/completions"), model, messages, tx.clone()).await
            }
            "ollama" => {
                let base = ollama_base.trim_end_matches('/').to_string();
                stream_ollama(base, model, messages, tx.clone()).await
            }
            other => Err(anyhow::anyhow!("Unknown provider: {other}")),
        };
        if let Err(e) = result {
            let _ = tx.send(Ok(Bytes::from(format!("data: {}\n\n", json!({ "error": e.to_string() }))))).await;
        }
        let _ = tx.send(Ok(Bytes::from(format!("data: {}\n\n", json!({ "done": true }))))).await;
    });

    let mut headers = HeaderMap::new();
    headers.insert("Content-Type",      "text/event-stream".parse().unwrap());
    headers.insert("Cache-Control",     "no-cache".parse().unwrap());
    headers.insert("X-Accel-Buffering", "no".parse().unwrap());
    Ok((StatusCode::OK, headers, axum::body::Body::from_stream(ReceiverStream::new(rx))).into_response())
}

// @group BusinessLogic > AI > OpenAI-compat : Stream deltas from GitHub Models or OpenAI (same SSE format)
async fn stream_openai_compat(
    token: String, endpoint: String, model: String, messages: Vec<Value>,
    tx: mpsc::Sender<Result<Bytes, std::convert::Infallible>>,
) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let resp = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&json!({ "model": model, "messages": messages, "stream": true, "max_tokens": 1024, "temperature": 0.7 }))
        .send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = if status == 403 && body.contains("budget limit") {
            "GitHub Models free tier budget exhausted. Wait for the monthly reset or subscribe to GitHub Copilot for higher limits.".to_string()
        } else if status.as_u16() == 429 {
            "Rate limit hit. Please wait a moment before sending another message.".to_string()
        } else if status.as_u16() == 401 {
            "API token rejected. Check your credentials in Settings → AI Assistant.".to_string()
        } else {
            format!("API error {status}: {body}")
        };
        anyhow::bail!("{msg}");
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { return Ok(()) }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                        if !delta.is_empty() {
                            let _ = tx.send(Ok(Bytes::from(format!("data: {}\n\n", json!({ "delta": delta }))))).await;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

// @group BusinessLogic > AI > Claude : Stream deltas from Anthropic Messages API
async fn stream_claude(
    api_key: String, model: String, messages: Vec<Value>,
    tx: mpsc::Sender<Result<Bytes, std::convert::Infallible>>,
) -> anyhow::Result<()> {
    // Separate system message from the rest
    let system_content = messages.first()
        .filter(|m| m["role"].as_str() == Some("system"))
        .and_then(|m| m["content"].as_str())
        .unwrap_or("")
        .to_string();
    let chat_messages: Vec<Value> = messages.iter().skip(1).cloned().collect();

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 1024,
            "system": system_content,
            "messages": chat_messages,
            "stream": true,
        }))
        .send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = if status.as_u16() == 401 {
            "Anthropic API key invalid. Check your key in Settings → AI Assistant.".to_string()
        } else if status.as_u16() == 429 {
            "Anthropic rate limit hit. Please wait before sending another message.".to_string()
        } else {
            format!("Anthropic API error {status}: {body}")
        };
        anyhow::bail!("{msg}");
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if v["type"].as_str() == Some("content_block_delta") {
                        if let Some(text) = v["delta"]["text"].as_str() {
                            if !text.is_empty() {
                                let _ = tx.send(Ok(Bytes::from(format!("data: {}\n\n", json!({ "delta": text }))))).await;
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

// @group BusinessLogic > AI > Ollama : Stream deltas from local Ollama instance (NDJSON)
async fn stream_ollama(
    base_url: String, model: String, messages: Vec<Value>,
    tx: mpsc::Sender<Result<Bytes, std::convert::Infallible>>,
) -> anyhow::Result<()> {
    // Many small local models (Gemma, Llama, Mistral) ignore both role:system in the messages array
    // and the top-level `system` field. The most reliable approach is to inject the system context
    // directly into the first user message so the model actually sees and uses it.
    let system_content = messages.first()
        .filter(|m| m["role"].as_str() == Some("system"))
        .and_then(|m| m["content"].as_str())
        .unwrap_or("")
        .to_string();

    // Build chat messages without the system entry, injecting context into the first user turn
    let mut chat_messages: Vec<Value> = messages.iter()
        .filter(|m| m["role"].as_str() != Some("system"))
        .cloned()
        .collect();

    // Inject context into the LAST user message so it's always in the model's immediate window
    if !system_content.is_empty() {
        if let Some(last_user) = chat_messages.iter_mut().rfind(|m| m["role"].as_str() == Some("user")) {
            let original = last_user["content"].as_str().unwrap_or("").to_string();
            last_user["content"] = serde_json::Value::String(
                format!("[Context]\n{system_content}\n\n[Question]\n{original}")
            );
        }
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base_url}/api/chat"))
        .json(&json!({ "model": model, "messages": chat_messages, "stream": true }))
        .send().await
        .map_err(|e| anyhow::anyhow!("Ollama request failed — is Ollama running at {base_url}? {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Ollama error {status}: {body}");
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if line.is_empty() { continue }
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if let Some(text) = v["message"]["content"].as_str() {
                    if !text.is_empty() {
                        let _ = tx.send(Ok(Bytes::from(format!("data: {}\n\n", json!({ "delta": text }))))).await;
                    }
                }
                if v["done"].as_bool().unwrap_or(false) { return Ok(()) }
            }
        }
    }
    Ok(())
}

// @group BusinessLogic > AI : Build system prompt with optional process context
async fn build_system_prompt(state: &DaemonState, process_id: Option<&str>) -> String {
    let base = "You are an expert DevOps assistant built into a process manager called alter. \
                Your ONLY job is to help with processes, logs, crashes, config, and infrastructure. \
                ALWAYS answer based on the process context and logs provided to you. \
                Use markdown: **bold**, ### headings, - bullets, `code`.";

    let Some(pid_str) = process_id else {
        let processes = state.manager.list().await;
        let running: Vec<_> = processes.iter()
            .filter(|p| matches!(p.status, crate::models::process_status::ProcessStatus::Running
                | crate::models::process_status::ProcessStatus::Watching
                | crate::models::process_status::ProcessStatus::Sleeping))
            .collect();
        let stopped: Vec<_> = processes.iter()
            .filter(|p| matches!(p.status, crate::models::process_status::ProcessStatus::Stopped
                | crate::models::process_status::ProcessStatus::Crashed))
            .collect();
        return format!(
            "{base}\n\nCurrent state: {total} processes total, {r} active, {s} stopped/crashed.\nActive: {active}\nStopped/crashed: {inactive}",
            total   = processes.len(),
            r       = running.len(),
            s       = stopped.len(),
            active   = running.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", "),
            inactive = stopped.iter().map(|p| format!("{} ({})", p.name, format!("{:?}", p.status).to_lowercase())).collect::<Vec<_>>().join(", "),
        );
    };

    let id = match state.manager.resolve_id(pid_str).await {
        Ok(id) => id,
        Err(_) => return base.to_string(),
    };
    let info = match state.manager.get(id).await {
        Ok(info) => info,
        Err(_) => return base.to_string(),
    };

    let log_dir  = crate::config::paths::process_log_dir(&info.name);
    let log_lines = crate::logging::reader::read_merged_logs(&log_dir, 50).unwrap_or_default();
    let log_text  = log_lines.iter()
        .map(|(stream, ts, content)| format!("[{stream}] {ts} {content}"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "{base}\n\nProcess context:\n\
         Name: {name} | Status: {status} | Restarts: {restarts}\n\
         Command: {script} {args}\n\
         Working dir: {cwd}\n\
         Namespace: {ns}\n\
         PID: {pid}\n\
         \nRecent logs (last 200 lines):\n{logs}",
        name     = info.name,
        status   = format!("{:?}", info.status).to_lowercase(),
        restarts = info.restart_count,
        script   = info.script,
        args     = info.args.join(" "),
        cwd      = info.cwd.as_deref().unwrap_or(""),
        ns       = info.namespace,
        pid      = info.pid.map(|p| p.to_string()).unwrap_or_else(|| "none".to_string()),
        logs     = if log_text.is_empty() { "(no logs)".to_string() } else { log_text },
    )
}

// @group Utilities > AI > GitHub : Fetch the authenticated user's GitHub username
async fn fetch_github_username(token: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "alter-pm2")
        .send().await?;
    let data: Value = resp.json().await?;
    Ok(data["login"].as_str().unwrap_or("").to_string())
}
