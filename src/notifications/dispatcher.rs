// @group Notifications > Dispatcher : Central dispatcher — receives events, fans out to configured channels

use crate::config::daemon_config::NotificationConfig;
use crate::notifications::channels;
use crate::notifications::events::NotificationEvent;
use tokio::sync::mpsc;

// @group Notifications > Dispatcher : Start the notification dispatcher loop
pub fn start_dispatcher(
    config: NotificationConfig,
    mut rx: mpsc::Receiver<NotificationEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            // Check if this event type should be dispatched based on config
            let should_send = match &event {
                NotificationEvent::ProcessCrashed { .. } => config.alert_on_crash,
                NotificationEvent::ProcessRestarted { .. } => config.alert_on_restart,
                NotificationEvent::ProcessStopped { .. } => config.alert_on_stop,
                // Health check failures and resource limits always notify
                NotificationEvent::HealthCheckFailed { .. } => true,
                NotificationEvent::ResourceLimitExceeded { .. } => true,
            };

            if !should_send {
                continue;
            }

            // Fan out to all configured channels in parallel (fire-and-forget)
            if let Some(ref url) = config.webhook_url {
                let url = url.clone();
                let e = event.clone();
                tokio::spawn(async move {
                    if let Err(err) = channels::webhook::send(&url, &e).await {
                        tracing::warn!("webhook notification failed: {err}");
                    }
                });
            }

            if config.email_to.is_some() {
                let cfg = config.clone();
                let e = event.clone();
                tokio::spawn(async move {
                    if let Err(err) = channels::email::send(&cfg, &e).await {
                        tracing::warn!("email notification failed: {err}");
                    }
                });
            }

            if let Some(ref url) = config.discord_webhook_url {
                let url = url.clone();
                let e = event.clone();
                tokio::spawn(async move {
                    if let Err(err) = channels::discord::send(&url, &e).await {
                        tracing::warn!("discord notification failed: {err}");
                    }
                });
            }

            if let Some(ref url) = config.slack_webhook_url {
                let url = url.clone();
                let e = event.clone();
                tokio::spawn(async move {
                    if let Err(err) = channels::slack::send(&url, &e).await {
                        tracing::warn!("slack notification failed: {err}");
                    }
                });
            }
        }
    })
}
