// @group Types : Notification configuration — webhook, Slack, Teams targets and event flags

use serde::{Deserialize, Serialize};

// @group Types > NotificationEvents : Which process lifecycle events trigger notifications
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotificationEvents {
    // Process lifecycle events
    #[serde(default)]
    pub on_crash: bool,
    #[serde(default)]
    pub on_restart: bool,
    #[serde(default)]
    pub on_start: bool,
    #[serde(default)]
    pub on_stop: bool,
    // Cron job lifecycle events
    #[serde(default)]
    pub on_cron_run: bool,
    #[serde(default)]
    pub on_cron_fail: bool,
}

// @group Types > WebhookTarget : Generic HTTP webhook target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookTarget {
    pub url: String,
    #[serde(default)]
    pub enabled: bool,
}

// @group Types > SlackTarget : Slack incoming webhook target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackTarget {
    pub webhook_url: String,
    #[serde(default)]
    pub enabled: bool,
    pub channel: Option<String>,
}

// @group Types > TeamsTarget : Microsoft Teams incoming webhook target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamsTarget {
    pub webhook_url: String,
    #[serde(default)]
    pub enabled: bool,
}

// @group Types > DiscordTarget : Discord incoming webhook target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordTarget {
    pub webhook_url: String,
    #[serde(default)]
    pub enabled: bool,
}

// @group Types > NotificationConfig : Full notification configuration for one scope (global / namespace / process)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotificationConfig {
    pub webhook: Option<WebhookTarget>,
    pub slack:   Option<SlackTarget>,
    pub teams:   Option<TeamsTarget>,
    pub discord: Option<DiscordTarget>,
    #[serde(default)]
    pub events: NotificationEvents,
}
