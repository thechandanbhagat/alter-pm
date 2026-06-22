// @group Configuration : Library crate root — exposes all modules and shared CLI entry logic

pub mod api;
pub mod cli;
pub mod client;
pub mod config;
pub mod daemon;
pub mod logging;
pub mod models;
pub mod notifications;
pub mod process;
pub mod telegram;
pub mod terminal;
pub mod tunnel;
pub mod utils;
pub mod web;

use crate::cli::args::{Cli, Commands};
use crate::client::daemon_client::DaemonClient;

// @group BusinessLogic : Shared CLI dispatch logic — used by both alter and alter-dev binaries
pub async fn run_cli(cli: Cli) -> anyhow::Result<()> {
    // @group BusinessLogic > Daemon : Hidden internal entry point for daemon process
    if cli.internal_daemon {
        let config = crate::config::daemon_config::DaemonConfig {
            host: cli.host.clone(),
            port: cli.port,
            ..Default::default()
        };
        return daemon::run(config).await;
    }

    // @group Configuration > Remote : Resolve connection — explicit --remote > default connection > local
    let (eff_host, eff_port, client) = resolve_connection(&cli);
    let json = cli.json;

    match cli.command.unwrap_or_else(|| {
        // No command: show list if daemon is alive, else show help
        Commands::List
    }) {
        Commands::Start(args) => cli::commands::start::run(&client, args, json).await?,

        Commands::Stop(r) => cli::commands::stop::run(&client, &r.target, json).await?,

        Commands::Restart(r) => cli::commands::restart::run(&client, &r.target, json).await?,

        Commands::Delete(r) => cli::commands::delete::run(&client, &r.target, json).await?,

        Commands::List => cli::commands::list::run(&client, json).await?,

        Commands::Describe(r) => cli::commands::describe::run(&client, &r.target, json).await?,

        Commands::Logs(args) => cli::commands::logs::run(&client, args, json).await?,

        Commands::Flush(r) => {
            cli::commands::flush::run(&client, r.target.as_deref(), json).await?
        }

        Commands::Reset(r) => cli::commands::reset::run(&client, &r.target, json).await?,

        Commands::Save => cli::commands::save::run(&client, json).await?,

        Commands::Resurrect => cli::commands::resurrect::run(&client, json).await?,

        Commands::Daemon(d) => {
            cli::commands::daemon::run(&client, d.action, &eff_host, eff_port).await?
        }

        Commands::Startup => cli::commands::startup::run_startup().await?,

        Commands::Unstartup => cli::commands::startup::run_unstartup().await?,

        Commands::Web => {
            let display_host = if eff_host == "0.0.0.0" { "127.0.0.1" } else { &eff_host };
            let url = format!("http://{display_host}:{eff_port}/");
            println!("[alter] dashboard: {url}");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let _ = std::process::Command::new("cmd")
                    .args(["/c", "start", &url])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn();
            }
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("open").arg(&url).spawn();
            #[cfg(target_os = "linux")]
            let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
        }

        Commands::Token(t) => cli::commands::token::run(&client, t.action).await?,

        Commands::Remote(r) => cli::commands::remote::run(r.action)?,
    }

    Ok(())
}

// @group Configuration > Remote : Resolve which daemon to connect to and build the client
fn resolve_connection(cli: &Cli) -> (String, u16, DaemonClient) {
    use crate::config::connections_config;

    // Explicit --remote <name> takes priority
    if let Some(ref remote_name) = cli.remote {
        let cfg = connections_config::load();
        if let Some(conn) = cfg.connections.get(remote_name) {
            let client = DaemonClient::with_token(&conn.host, conn.port, &conn.token);
            return (conn.host.clone(), conn.port, client);
        }
        eprintln!("[alter] unknown remote connection '{remote_name}' — check `alter remote list`");
        std::process::exit(1);
    }

    // If the user has not overridden --host (it's still the default 127.0.0.1)
    // and there's a default connection configured, use it.
    if cli.host == "127.0.0.1" {
        let cfg = connections_config::load();
        if let Some(ref default_name) = cfg.default {
            if let Some(conn) = cfg.connections.get(default_name) {
                let client = DaemonClient::with_token(&conn.host, conn.port, &conn.token);
                return (conn.host.clone(), conn.port, client);
            }
        }
    }

    // Fall back to local daemon
    let client = DaemonClient::new(&cli.host, cli.port);
    (cli.host.clone(), cli.port, client)
}
