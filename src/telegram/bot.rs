// @group BusinessLogic : Telegram long-polling bot loop

use crate::daemon::state::DaemonState;
use crate::telegram::commands;
use serde::Deserialize;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

const TG_API: &str = "https://api.telegram.org";

// @group Types : Telegram API response wrappers
#[derive(Deserialize)]
struct TgResponse<T> {
    ok: bool,
    result: Option<T>,
}

#[derive(Deserialize)]
struct Update {
    update_id: i64,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    chat: Chat,
    text: Option<String>,
    from: Option<From>,
}

#[derive(Deserialize)]
struct Chat {
    id: i64,
}

#[derive(Deserialize)]
struct From {
    id: i64,
}

// @group BusinessLogic : Register bot commands with Telegram for autocomplete (setMyCommands)
async fn register_commands(client: &reqwest::Client, token: &str) {
    let url = format!("{TG_API}/bot{token}/setMyCommands");
    let commands = serde_json::json!({
        "commands": [
            { "command": "list",      "description": "List all processes and their status" },
            { "command": "status",    "description": "Get status of a process: /status <name>" },
            { "command": "start",   "description": "Start process or namespace: /start <name> | /start ns <ns>" },
            { "command": "stop",    "description": "Stop process or namespace: /stop <name> | /stop ns <ns>" },
            { "command": "restart", "description": "Restart process or namespace: /restart <name> | /restart ns <ns>" },
            { "command": "logs",    "description": "Get recent logs: /logs <name> [lines]" },
            { "command": "ping",      "description": "Check if the daemon is responsive" },
            { "command": "help",      "description": "Show available commands" }
        ]
    });

    match client.post(&url).json(&commands).send().await {
        Ok(r) if r.status().is_success() => {
            tracing::info!("telegram: commands registered for autocomplete");
        }
        Ok(r) => {
            tracing::warn!("telegram: setMyCommands returned {}", r.status());
        }
        Err(e) => {
            tracing::warn!("telegram: setMyCommands failed: {e}");
        }
    }
}

// @group BusinessLogic : Entry point — run the polling loop as a background task
pub async fn run(state: Arc<DaemonState>) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .expect("failed to build reqwest client for telegram bot");

    let mut offset: i64 = 0;
    // @group BusinessLogic > State : Track which token we last registered commands for,
    // so we re-register automatically if the token changes at runtime.
    let mut registered_for_token: Option<String> = None;

    loop {
        // @group BusinessLogic > Config : Re-read config each cycle so hot changes take effect
        let (enabled, token, allowed_chat_ids) = {
            let cfg = state.telegram.read().await;
            (cfg.enabled, cfg.bot_token.clone(), cfg.allowed_chat_ids.clone())
        };

        if !enabled || token.is_none() {
            sleep(Duration::from_secs(5)).await;
            continue;
        }

        let token = token.unwrap();

        // @group BusinessLogic > Commands : Register autocomplete commands once per token
        if registered_for_token.as_deref() != Some(&token) {
            register_commands(&client, &token).await;
            registered_for_token = Some(token.clone());
        }

        // @group BusinessLogic > Polling : Fetch updates via long poll (timeout=30s)
        let url = format!(
            "{TG_API}/bot{token}/getUpdates?offset={offset}&timeout=30"
        );

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("telegram: getUpdates failed: {e}");
                sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        let updates: TgResponse<Vec<Update>> = match resp.json().await {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!("telegram: failed to parse getUpdates response: {e}");
                sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        if !updates.ok {
            // Log full response body so the user can diagnose token/auth issues
            tracing::warn!("telegram: getUpdates returned ok=false — check your bot token");
            sleep(Duration::from_secs(10)).await;
            continue;
        }

        // @group BusinessLogic > Updates : Process each update
        for update in updates.result.unwrap_or_default() {
            offset = update.update_id + 1;

            let message = match update.message {
                Some(m) => m,
                None => continue,
            };

            let chat_id = message.chat.id;
            let sender_id = message.from.as_ref().map(|f| f.id).unwrap_or(chat_id);

            // @group Authentication : Reject messages not from a whitelisted chat or user.
            // Check both chat_id (covers groups and private chats by chat) and sender_id
            // (covers private chats where the user whitelisted their personal user ID).
            if !allowed_chat_ids.is_empty()
                && !allowed_chat_ids.contains(&chat_id)
                && !allowed_chat_ids.contains(&sender_id)
            {
                tracing::debug!(
                    "telegram: ignoring message — chat_id={} sender_id={} not in whitelist",
                    chat_id, sender_id
                );
                continue;
            }

            let text = match message.text {
                Some(t) => t,
                None => continue,
            };

            // @group BusinessLogic > Commands : Dispatch to command handler
            let state_clone = Arc::clone(&state);
            let token_clone = token.clone();

            tokio::spawn(async move {
                if let Err(e) =
                    dispatch_command(&state_clone, &token_clone, chat_id, &text).await
                {
                    tracing::warn!("telegram: command error: {e}");
                }
            });
        }
    }
}

// @group BusinessLogic > Dispatch : Parse command text and call the appropriate handler
async fn dispatch_command(
    state: &Arc<DaemonState>,
    token: &str,
    chat_id: i64,
    text: &str,
) -> anyhow::Result<()> {
    // Strip @BotName suffix from commands (e.g. "/list@MyBot" → "/list")
    let text = if let Some(at) = text.find('@') {
        &text[..at]
    } else {
        text
    };

    let parts: Vec<&str> = text.splitn(3, ' ').collect();
    let cmd = parts[0].to_lowercase();

    match cmd.as_str() {
        "/ping" => commands::cmd_ping(token, chat_id).await,
        "/help" | "/start" if parts.len() == 1 => commands::cmd_help(token, chat_id).await,
        "/list" => commands::cmd_list(state, token, chat_id).await,
        "/status" => {
            if parts.len() < 2 {
                commands::send_message(token, chat_id, "Usage: /status &lt;name&gt;").await
            } else {
                commands::cmd_status(state, token, chat_id, parts[1]).await
            }
        }
        "/start" => {
            // /start with an argument — "ns <namespace>" targets a namespace, otherwise a process name
            match parts.get(1) {
                Some(&"ns") => match parts.get(2) {
                    Some(ns) => commands::cmd_start_namespace(state, token, chat_id, ns).await,
                    None => commands::send_message(token, chat_id, "Usage: /start ns &lt;namespace&gt;").await,
                },
                Some(name) => commands::cmd_start(state, token, chat_id, name).await,
                None => commands::cmd_help(token, chat_id).await,
            }
        }
        "/stop" => match parts.get(1) {
            Some(&"ns") => match parts.get(2) {
                Some(ns) => commands::cmd_stop_namespace(state, token, chat_id, ns).await,
                None => commands::send_message(token, chat_id, "Usage: /stop ns &lt;namespace&gt;").await,
            },
            Some(name) => commands::cmd_stop(state, token, chat_id, name).await,
            None => commands::send_message(token, chat_id, "Usage: /stop &lt;name&gt; | /stop ns &lt;namespace&gt;").await,
        },
        "/restart" => match parts.get(1) {
            Some(&"ns") => match parts.get(2) {
                Some(ns) => commands::cmd_restart_namespace(state, token, chat_id, ns).await,
                None => commands::send_message(token, chat_id, "Usage: /restart ns &lt;namespace&gt;").await,
            },
            Some(name) => commands::cmd_restart(state, token, chat_id, name).await,
            None => commands::send_message(token, chat_id, "Usage: /restart &lt;name&gt; | /restart ns &lt;namespace&gt;").await,
        },
        "/logs" => {
            if parts.len() < 2 {
                commands::send_message(token, chat_id, "Usage: /logs &lt;name&gt; [lines]").await
            } else {
                let name = parts[1];
                let lines: usize = parts
                    .get(2)
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(20);
                commands::cmd_logs(state, token, chat_id, name, lines).await
            }
        }
        _ => {
            // Unknown command — send help
            commands::cmd_help(token, chat_id).await
        }
    }
}
