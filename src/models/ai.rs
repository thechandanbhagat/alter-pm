// @group Types : AI assistant settings and chat request/response types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// @group Types > AiSettings : Persisted AI configuration — supports multiple providers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettings {
    /// Active provider: "ollama" | "github" | "claude" | "openai"
    #[serde(default = "default_provider")]
    pub provider: String,

    #[serde(default)]
    pub enabled: bool,

    /// Last-used model (per-provider; frontend keeps per-provider state)
    #[serde(default = "default_model")]
    pub model: String,

    // @group Types > AiSettings > GitHub : GitHub Models OAuth Device Flow
    #[serde(default)]
    pub github_token: String,
    /// GitHub OAuth App Client ID — required for Device Flow login
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub github_username: String,

    // @group Types > AiSettings > Claude : Anthropic API key
    #[serde(default)]
    pub anthropic_key: String,

    // @group Types > AiSettings > OpenAI : OpenAI-compatible API
    #[serde(default)]
    pub openai_key: String,
    #[serde(default = "default_openai_base")]
    pub openai_base_url: String,

    // @group Types > AiSettings > Ollama : Local Ollama instance
    #[serde(default = "default_ollama_base")]
    pub ollama_base_url: String,
}

fn default_provider()    -> String { "ollama".to_string() }
fn default_model()       -> String { "llama3.2".to_string() }
fn default_openai_base() -> String { "https://api.openai.com/v1".to_string() }
fn default_ollama_base() -> String { "http://localhost:11434".to_string() }

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider:        default_provider(),
            enabled:         false,
            model:           default_model(),
            github_token:    String::new(),
            client_id:       String::new(),
            github_username: String::new(),
            anthropic_key:   String::new(),
            openai_key:      String::new(),
            openai_base_url: default_openai_base(),
            ollama_base_url: default_ollama_base(),
        }
    }
}

// @group Types > DeviceAuthState : Ephemeral in-memory state during GitHub Device Flow
pub struct DeviceAuthState {
    pub device_code:      String,
    pub user_code:        String,
    pub verification_uri: String,
    pub expires_at:       DateTime<Utc>,
    pub interval_secs:    u64,
}

// @group Types > ChatMessage : A single turn in a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role:    String,
    pub content: String,
}

// @group Types > ChatRequest : Incoming request body for POST /ai/chat
#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub message:    String,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub history:    Vec<ChatMessage>,
    /// Override the saved model — uses persisted value if omitted
    #[serde(default)]
    pub model:      Option<String>,
    /// Override the saved provider — uses persisted value if omitted
    #[serde(default)]
    pub provider:   Option<String>,
}
