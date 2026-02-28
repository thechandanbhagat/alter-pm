// @group Notifications > Discord : Rich embed webhook

use crate::notifications::events::NotificationEvent;
use anyhow::Result;

pub async fn send(webhook_url: &str, event: &NotificationEvent) -> Result<()> {
    let color = match event.severity() {
        "critical" => 0xFF0000, // red
        "warning" => 0xFFD700,  // gold
        _ => 0x3DDC84,          // green
    };

    let payload = serde_json::json!({
        "embeds": [{
            "title": event.title(),
            "description": event.body(),
            "color": color,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "footer": {
                "text": "alter-pm2"
            }
        }]
    });

    reqwest::Client::new()
        .post(webhook_url)
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    Ok(())
}
