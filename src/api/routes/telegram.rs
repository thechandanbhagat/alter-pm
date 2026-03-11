// @group APIEndpoints : Telegram bot configuration endpoints

use crate::api::error::ApiError;
use crate::config::telegram_config;
use crate::daemon::state::DaemonState;
use crate::telegram::commands;
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// @group Types : Request/response structs

#[derive(Serialize)]
struct TelegramConfigResponse {
    enabled: bool,
    /// Token is masked — shows last 4 chars only
    bot_token_hint: Option<String>,
    bot_token_set: bool,
    allowed_chat_ids: Vec<i64>,
    notify_on_crash: bool,
    notify_on_start: bool,
    notify_on_stop: bool,
    notify_on_restart: bool,
}

#[derive(Deserialize)]
struct UpdateTelegramConfig {
    enabled: Option<bool>,
    /// Send empty string to clear; omit to keep existing token
    bot_token: Option<String>,
    allowed_chat_ids: Option<Vec<i64>>,
    notify_on_crash: Option<bool>,
    notify_on_start: Option<bool>,
    notify_on_stop: Option<bool>,
    notify_on_restart: Option<bool>,
}

#[derive(Serialize)]
struct BotInfoResponse {
    ok: bool,
    username: Option<String>,
    first_name: Option<String>,
    error: Option<String>,
}

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/", get(get_config).put(update_config))
        .route("/test", post(test_message))
        .route("/botinfo", get(get_bot_info))
        .with_state(state)
}

// @group APIEndpoints > Telegram : GET /telegram — return config with masked token
async fn get_config(State(state): State<Arc<DaemonState>>) -> Result<Json<TelegramConfigResponse>, ApiError> {
    let cfg = state.telegram.read().await;
    let hint = cfg.bot_token.as_deref().map(|t| {
        if t.len() > 4 {
            format!("****{}", &t[t.len() - 4..])
        } else {
            "****".to_string()
        }
    });
    Ok(Json(TelegramConfigResponse {
        enabled: cfg.enabled,
        bot_token_hint: hint,
        bot_token_set: cfg.bot_token.is_some(),
        allowed_chat_ids: cfg.allowed_chat_ids.clone(),
        notify_on_crash: cfg.notify_on_crash,
        notify_on_start: cfg.notify_on_start,
        notify_on_stop: cfg.notify_on_stop,
        notify_on_restart: cfg.notify_on_restart,
    }))
}

// @group APIEndpoints > Telegram : PUT /telegram — update config
async fn update_config(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<UpdateTelegramConfig>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut cfg = state.telegram.write().await;

    if let Some(enabled) = req.enabled {
        cfg.enabled = enabled;
    }
    if let Some(token) = req.bot_token {
        if token.is_empty() {
            cfg.bot_token = None;
        } else {
            cfg.bot_token = Some(token);
        }
    }
    if let Some(ids) = req.allowed_chat_ids {
        cfg.allowed_chat_ids = ids;
    }
    if let Some(v) = req.notify_on_crash   { cfg.notify_on_crash   = v; }
    if let Some(v) = req.notify_on_start   { cfg.notify_on_start   = v; }
    if let Some(v) = req.notify_on_stop    { cfg.notify_on_stop    = v; }
    if let Some(v) = req.notify_on_restart { cfg.notify_on_restart = v; }

    telegram_config::save(&cfg).map_err(ApiError::from)?;

    Ok(Json(serde_json::json!({ "success": true })))
}

// @group APIEndpoints > Telegram : POST /telegram/test — send a test message
async fn test_message(State(state): State<Arc<DaemonState>>) -> Result<Json<serde_json::Value>, ApiError> {
    let cfg = state.telegram.read().await;

    let token = cfg.bot_token.as_deref().ok_or_else(|| {
        ApiError::bad_request("Bot token is not configured")
    })?;

    let chat_id = *cfg.allowed_chat_ids.first().ok_or_else(|| {
        ApiError::bad_request("No allowed chat IDs configured — add at least one chat ID to send test messages")
    })?;

    let token = token.to_string();
    drop(cfg);

    commands::send_message(
        &token,
        chat_id,
        "✅ <b>alter-pm2</b> Telegram bot is configured and working!",
    )
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true, "message": "Test message sent" })))
}

// @group APIEndpoints > Telegram : GET /telegram/botinfo — validate token and return bot username
async fn get_bot_info(State(state): State<Arc<DaemonState>>) -> Json<BotInfoResponse> {
    let cfg = state.telegram.read().await;
    let token = match cfg.bot_token.as_deref() {
        Some(t) => t.to_string(),
        None => {
            return Json(BotInfoResponse {
                ok: false,
                username: None,
                first_name: None,
                error: Some("No bot token configured".to_string()),
            });
        }
    };
    drop(cfg);

    let url = format!("https://api.telegram.org/bot{token}/getMe");
    match reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) => {
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            if body["ok"].as_bool().unwrap_or(false) {
                Json(BotInfoResponse {
                    ok: true,
                    username: body["result"]["username"].as_str().map(String::from),
                    first_name: body["result"]["first_name"].as_str().map(String::from),
                    error: None,
                })
            } else {
                Json(BotInfoResponse {
                    ok: false,
                    username: None,
                    first_name: None,
                    error: body["description"]
                        .as_str()
                        .map(String::from)
                        .or_else(|| Some("Invalid token".to_string())),
                })
            }
        }
        Err(e) => Json(BotInfoResponse {
            ok: false,
            username: None,
            first_name: None,
            error: Some(format!("Request failed: {e}")),
        }),
    }
}
