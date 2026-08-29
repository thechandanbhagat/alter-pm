// @group Authentication : `alter token` command — show or rotate the master authentication token

use crate::cli::args::TokenAction;
use crate::client::daemon_client::DaemonClient;
use anyhow::Result;

pub async fn run(client: &DaemonClient, action: TokenAction) -> Result<()> {
    match action {
        // @group Authentication > Show : Print current master token to stdout
        TokenAction::Show => {
            let cfg = crate::config::auth_config::load();
            println!("{}", cfg.master_token);
        }

        // @group Authentication > Rotate : Regenerate master token (invalidates the old one)
        TokenAction::Rotate => {
            if client.is_alive().await {
                // Daemon is running — rotate via API so in-memory token is also updated
                let resp = client
                    .post("/api/v1/auth/rotate-token", serde_json::json!({}))
                    .await?;
                let new_token = resp
                    .get("token")
                    .and_then(|t| t.as_str())
                    .unwrap_or("(see auth.json)")
                    .to_string();
                println!("[alter] master token rotated");
                println!("new token: {new_token}");
            } else {
                // Daemon not running — rotate locally in auth.json
                let mut cfg = crate::config::auth_config::load();
                cfg.master_token = crate::config::auth_config::generate_token();
                crate::config::auth_config::save(&cfg)?;
                println!("[alter] master token rotated (daemon offline — auth.json updated)");
                println!("new token: {}", cfg.master_token);
            }
            println!();
            println!("Update remote connections: alter remote update <name> --token <new-token>");
        }
    }
    Ok(())
}
