// @group Notifications > Webhook : POST JSON payload to configured URL

use crate::notifications::events::NotificationEvent;
use anyhow::Result;

pub async fn send(url: &str, event: &NotificationEvent) -> Result<()> {
    let payload = serde_json::json!({
        "event": event.title(),
        "message": event.body(),
        "severity": event.severity(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "source": "alter-pm2",
    });

    reqwest::Client::new()
        .post(url)
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    Ok(())
}
