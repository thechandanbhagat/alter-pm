// @group Notifications > Slack : Block Kit webhook

use crate::notifications::events::NotificationEvent;
use anyhow::Result;

pub async fn send(webhook_url: &str, event: &NotificationEvent) -> Result<()> {
    let emoji = match event.severity() {
        "critical" => ":red_circle:",
        "warning" => ":warning:",
        _ => ":white_check_mark:",
    };

    let payload = serde_json::json!({
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": format!("{} {}", emoji, event.title()),
                    "emoji": true
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": event.body()
                }
            },
            {
                "type": "context",
                "elements": [{
                    "type": "mrkdwn",
                    "text": format!(
                        "_alter-pm2 · {}_",
                        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
                    )
                }]
            }
        ]
    });

    reqwest::Client::new()
        .post(webhook_url)
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    Ok(())
}
