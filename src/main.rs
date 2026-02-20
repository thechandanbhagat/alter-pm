// @group Configuration : Binary entry point — routes to daemon mode or CLI dispatch

mod api;
mod cli;
mod client;
mod config;
mod daemon;
mod logging;
mod models;
mod process;
mod utils;
mod web;

use crate::cli::args::{Cli, Commands};
use crate::client::daemon_client::DaemonClient;
use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // @group BusinessLogic > Daemon : Hidden internal entry point for daemon process
    if cli.internal_daemon {
        let config = crate::config::daemon_config::DaemonConfig {
            host: cli.host.clone(),
            port: cli.port,
            ..Default::default()
        };
        return daemon::run(config).await;
    }

    let client = DaemonClient::new(&cli.host, cli.port);
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
            cli::commands::daemon::run(&client, d.action, cli.port).await?
        }

        Commands::Startup => cli::commands::startup::run_startup().await?,

        Commands::Unstartup => cli::commands::startup::run_unstartup().await?,

        Commands::Web => {
            let url = format!("http://{}:{}/", cli.host, cli.port);
            println!("[alter] dashboard: {url}");
            // Attempt to open browser
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("cmd").args(["/c", "start", &url]).spawn();
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("open").arg(&url).spawn();
            #[cfg(target_os = "linux")]
            let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
        }
    }

    Ok(())
}
