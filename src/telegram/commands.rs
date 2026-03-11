// @group BusinessLogic : Telegram bot command handlers and message utilities

use crate::daemon::state::DaemonState;
use crate::logging::reader::read_merged_logs;
use crate::models::process_info::ProcessInfo;
use crate::models::process_status::ProcessStatus;
use crate::notifications::sender::ProcessEvent;
use anyhow::Result;
use std::sync::Arc;

const TG_API: &str = "https://api.telegram.org";

// @group Utilities : Send a plain text message to a Telegram chat
pub async fn send_message(bot_token: &str, chat_id: i64, text: &str) -> Result<()> {
    let url = format!("{TG_API}/bot{bot_token}/sendMessage");
    reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML"
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;
    Ok(())
}

// @group BusinessLogic > Commands : /ping — liveness check
pub async fn cmd_ping(bot_token: &str, chat_id: i64) -> Result<()> {
    send_message(bot_token, chat_id, "🏓 Pong! alter daemon is running.").await
}

// @group BusinessLogic > Commands : /help — list available commands
pub async fn cmd_help(bot_token: &str, chat_id: i64) -> Result<()> {
    let text = concat!(
        "🤖 <b>alter-pm2 Bot Commands</b>\n\n",
        "/list — list all processes\n",
        "/status &lt;name&gt; — detailed process info\n",
        "/start &lt;name&gt; — start a stopped process\n",
        "/stop &lt;name&gt; — stop a running process\n",
        "/restart &lt;name&gt; — restart a process\n",
        "/logs &lt;name&gt; [lines] — tail logs (default: 20)\n",
        "/ping — check if daemon is alive\n",
        "/help — show this message"
    );
    send_message(bot_token, chat_id, text).await
}

// @group BusinessLogic > Commands : /list — show all processes with status
pub async fn cmd_list(state: &Arc<DaemonState>, bot_token: &str, chat_id: i64) -> Result<()> {
    let processes = state.manager.list().await;

    if processes.is_empty() {
        return send_message(bot_token, chat_id, "No processes registered.").await;
    }

    let mut lines = vec!["<b>Processes:</b>".to_string()];
    for p in &processes {
        let emoji = status_emoji(&p.status);
        let uptime = p
            .uptime_secs
            .map(|s| format_uptime(s))
            .unwrap_or_else(|| "—".to_string());
        lines.push(format!(
            "{emoji} <b>{}</b> · {} · ↺{} · ⏱{}",
            p.name,
            p.status,
            p.restart_count,
            uptime
        ));
    }

    send_message(bot_token, chat_id, &lines.join("\n")).await
}

// @group BusinessLogic > Commands : /status <name> — detailed single-process info
pub async fn cmd_status(
    state: &Arc<DaemonState>,
    bot_token: &str,
    chat_id: i64,
    name: &str,
) -> Result<()> {
    let processes = state.manager.list().await;
    let Some(p) = processes.iter().find(|p| p.name == name) else {
        return send_message(
            bot_token,
            chat_id,
            &format!("❌ No process named <b>{}</b>", escape_html(name)),
        )
        .await;
    };

    let emoji = status_emoji(&p.status);
    let uptime = p
        .uptime_secs
        .map(|s| format_uptime(s))
        .unwrap_or_else(|| "—".to_string());
    let pid = p
        .pid
        .map(|pid| pid.to_string())
        .unwrap_or_else(|| "—".to_string());
    let cpu = p
        .cpu_percent
        .map(|c| format!("{:.1}%", c))
        .unwrap_or_else(|| "—".to_string());
    let mem = p
        .memory_bytes
        .map(|b| format_bytes(b))
        .unwrap_or_else(|| "—".to_string());

    let text = format!(
        "{emoji} <b>{}</b>\nStatus: {}\nPID: {}\nUptime: {}\nRestarts: {}\nCPU: {}\nRAM: {}",
        escape_html(&p.name),
        p.status,
        pid,
        uptime,
        p.restart_count,
        cpu,
        mem,
    );
    send_message(bot_token, chat_id, &text).await
}

// @group BusinessLogic > Commands : /start <name> — start a stopped process
pub async fn cmd_start(
    state: &Arc<DaemonState>,
    bot_token: &str,
    chat_id: i64,
    name: &str,
) -> Result<()> {
    let processes = state.manager.list().await;
    let Some(p) = processes.iter().find(|p| p.name == name) else {
        return send_message(
            bot_token,
            chat_id,
            &format!("❌ No process named <b>{}</b>", escape_html(name)),
        )
        .await;
    };

    match state.manager.restart(p.id).await {
        Ok(_) => {
            send_message(
                bot_token,
                chat_id,
                &format!("✅ Started <b>{}</b>", escape_html(name)),
            )
            .await
        }
        Err(e) => {
            send_message(
                bot_token,
                chat_id,
                &format!("❌ Failed to start <b>{}</b>: {}", escape_html(name), e),
            )
            .await
        }
    }
}

// @group BusinessLogic > Commands : /stop <name> — stop a running process
pub async fn cmd_stop(
    state: &Arc<DaemonState>,
    bot_token: &str,
    chat_id: i64,
    name: &str,
) -> Result<()> {
    let processes = state.manager.list().await;
    let Some(p) = processes.iter().find(|p| p.name == name) else {
        return send_message(
            bot_token,
            chat_id,
            &format!("❌ No process named <b>{}</b>", escape_html(name)),
        )
        .await;
    };

    match state.manager.stop(p.id).await {
        Ok(_) => {
            send_message(
                bot_token,
                chat_id,
                &format!("🛑 Stopped <b>{}</b>", escape_html(name)),
            )
            .await
        }
        Err(e) => {
            send_message(
                bot_token,
                chat_id,
                &format!("❌ Failed to stop <b>{}</b>: {}", escape_html(name), e),
            )
            .await
        }
    }
}

// @group BusinessLogic > Commands : /restart <name> — restart a process
pub async fn cmd_restart(
    state: &Arc<DaemonState>,
    bot_token: &str,
    chat_id: i64,
    name: &str,
) -> Result<()> {
    let processes = state.manager.list().await;
    let Some(p) = processes.iter().find(|p| p.name == name) else {
        return send_message(
            bot_token,
            chat_id,
            &format!("❌ No process named <b>{}</b>", escape_html(name)),
        )
        .await;
    };

    match state.manager.restart(p.id).await {
        Ok(_) => {
            send_message(
                bot_token,
                chat_id,
                &format!("🔄 Restarted <b>{}</b>", escape_html(name)),
            )
            .await
        }
        Err(e) => {
            send_message(
                bot_token,
                chat_id,
                &format!("❌ Failed to restart <b>{}</b>: {}", escape_html(name), e),
            )
            .await
        }
    }
}

// @group BusinessLogic > Commands : /logs <name> [N] — tail last N log lines
pub async fn cmd_logs(
    state: &Arc<DaemonState>,
    bot_token: &str,
    chat_id: i64,
    name: &str,
    lines: usize,
) -> Result<()> {
    let processes = state.manager.list().await;
    let Some(p) = processes.iter().find(|p| p.name == name) else {
        return send_message(
            bot_token,
            chat_id,
            &format!("❌ No process named <b>{}</b>", escape_html(name)),
        )
        .await;
    };

    let log_dir = crate::config::paths::process_log_dir(&p.name);
    let merged = match read_merged_logs(&log_dir, lines) {
        Ok(l) => l,
        Err(e) => {
            return send_message(
                bot_token,
                chat_id,
                &format!("❌ Could not read logs: {}", e),
            )
            .await;
        }
    };

    if merged.is_empty() {
        return send_message(
            bot_token,
            chat_id,
            &format!("📭 No logs yet for <b>{}</b>", escape_html(name)),
        )
        .await;
    }

    // Format: stream [timestamp] content — keep it concise for Telegram
    let log_text: Vec<String> = merged
        .iter()
        .map(|(stream, _ts, content)| {
            let prefix = if stream == "err" { "ERR" } else { "OUT" };
            format!("[{prefix}] {}", escape_html(content))
        })
        .collect();

    let header = format!("📋 <b>{}</b> — last {} lines:\n", escape_html(name), merged.len());
    let body = log_text.join("\n");
    // Telegram message limit is 4096 chars — truncate if needed
    let full = format!("{}<code>{}</code>", header, body);
    let truncated = if full.len() > 4000 {
        format!("{}...{}", &full[..3900], "\n<i>(truncated)</i>")
    } else {
        full
    };

    send_message(bot_token, chat_id, &truncated).await
}

// @group Utilities : Map ProcessStatus to an emoji indicator
fn status_emoji(status: &ProcessStatus) -> &'static str {
    match status {
        ProcessStatus::Running => "🟢",
        ProcessStatus::Watching => "👁",
        ProcessStatus::Sleeping => "😴",
        ProcessStatus::Stopped => "🔴",
        ProcessStatus::Crashed => "💥",
        ProcessStatus::Errored => "❌",
        ProcessStatus::Starting => "🔵",
        ProcessStatus::Stopping => "🟡",
    }
}

// @group Utilities : Format uptime in seconds to human-readable string
fn format_uptime(secs: u64) -> String {
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m{}s", secs / 60, secs % 60)
    } else {
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        format!("{}h{}m", h, m)
    }
}

// @group Utilities : Format bytes to human-readable string
fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

// @group Utilities : Escape HTML special characters for Telegram HTML parse mode
pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

// @group BusinessLogic > Notifications : Fire a Telegram push notification for a process event.
// Reads config from disk on each call — cheap for infrequent events.
pub async fn fire_telegram_notification(proc: &ProcessInfo, event: ProcessEvent) {
    let cfg = crate::config::telegram_config::load();

    if !cfg.enabled {
        return;
    }

    let token = match cfg.bot_token {
        Some(ref t) => t.clone(),
        None => return,
    };

    let should_send = match event {
        ProcessEvent::Crashed | ProcessEvent::CronFailed => cfg.notify_on_crash,
        ProcessEvent::Started | ProcessEvent::CronRun => cfg.notify_on_start,
        ProcessEvent::Stopped => cfg.notify_on_stop,
        ProcessEvent::Restarted => cfg.notify_on_restart,
    };

    if !should_send || cfg.allowed_chat_ids.is_empty() {
        return;
    }

    let name = escape_html(&proc.name);
    let msg = match event {
        ProcessEvent::Crashed => format!(
            "🔴 <b>{name}</b> crashed\nRestarts: {}\nExit code: {}",
            proc.restart_count,
            proc.last_exit_code.map(|c| c.to_string()).unwrap_or_else(|| "—".to_string())
        ),
        ProcessEvent::Started => format!(
            "🟢 <b>{name}</b> started\nPID: {}",
            proc.pid.map(|p| p.to_string()).unwrap_or_else(|| "—".to_string())
        ),
        ProcessEvent::Stopped => format!("⚪ <b>{name}</b> stopped"),
        ProcessEvent::Restarted => format!(
            "🔄 <b>{name}</b> restarted (#{} restart)",
            proc.restart_count
        ),
        ProcessEvent::CronRun => format!("⏰ <b>{name}</b> cron job started"),
        ProcessEvent::CronFailed => format!(
            "❌ <b>{name}</b> cron job failed\nExit code: {}",
            proc.last_exit_code.map(|c| c.to_string()).unwrap_or_else(|| "—".to_string())
        ),
    };

    for &chat_id in &cfg.allowed_chat_ids {
        if let Err(e) = send_message(&token, chat_id, &msg).await {
            tracing::warn!("telegram: failed to send notification to {chat_id}: {e}");
        }
    }
}
