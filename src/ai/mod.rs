//! Local AI integrations run on the daemon host, using the provider's own login.
pub mod apple;
pub mod local;

pub const CLI_PROVIDERS: &[&str] = &[
    "claude-cli",
    "codex-cli",
    "cursor-cli",
    "antigravity-cli",
    "devin-cli",
];

pub fn is_local_provider(provider: &str) -> bool {
    CLI_PROVIDERS.contains(&provider) || provider == "apple-foundation"
}

pub fn is_known_provider(provider: &str) -> bool {
    is_local_provider(provider)
        || ["ollama", "copilot", "github", "claude", "openai"].contains(&provider)
}

pub fn default_model(provider: &str) -> &str {
    match provider {
        "apple-foundation" => "apple-system",
        provider if CLI_PROVIDERS.contains(&provider) => "default",
        // API providers must explicitly choose a model when switching providers.
        _ => "",
    }
}
