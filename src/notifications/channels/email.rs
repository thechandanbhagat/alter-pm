// @group Notifications > Email : SMTP email via lettre

use crate::config::daemon_config::NotificationConfig;
use crate::notifications::events::NotificationEvent;
use anyhow::{Context, Result};
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

pub async fn send(config: &NotificationConfig, event: &NotificationEvent) -> Result<()> {
    let to = config
        .email_to
        .as_ref()
        .context("email_to not configured")?;
    let from = config
        .email_from
        .as_ref()
        .context("email_from not configured")?;
    let host = config
        .smtp_host
        .as_ref()
        .context("smtp_host not configured")?;

    let email = Message::builder()
        .from(from.parse().context("invalid from address")?)
        .to(to.parse().context("invalid to address")?)
        .subject(format!("[alter-pm2] {}", event.title()))
        .header(ContentType::TEXT_PLAIN)
        .body(format!(
            "{}\n\n---\nSeverity: {}\nSource: alter-pm2",
            event.body(),
            event.severity()
        ))
        .context("failed to build email")?;

    let creds = Credentials::new(
        config.smtp_user.clone().unwrap_or_default(),
        config.smtp_pass.clone().unwrap_or_default(),
    );

    let port = config.smtp_port.unwrap_or(587);

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
        .context("failed to create SMTP transport")?
        .port(port)
        .credentials(creds)
        .build();

    mailer.send(email).await.context("failed to send email")?;

    Ok(())
}
