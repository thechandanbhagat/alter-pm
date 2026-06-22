// @group Configuration : `alter remote` command — manage named remote daemon connections

use crate::cli::args::RemoteAction;
use crate::config::connections_config::{self, RemoteConnection};
use anyhow::Result;

pub fn run(action: RemoteAction) -> Result<()> {
    match action {
        // @group Configuration > Add : Register a new named remote connection
        RemoteAction::Add { name, host, port, token, label } => {
            let mut cfg = connections_config::load();
            cfg.connections.insert(
                name.clone(),
                RemoteConnection { host: host.clone(), port, token, label },
            );
            connections_config::save(&cfg)?;
            println!("[alter] added connection '{name}'  →  {host}:{port}");
            println!("use it:  alter --remote {name} list");
        }

        // @group Configuration > Update : Patch an existing connection's fields
        RemoteAction::Update { name, host, port, token, label } => {
            let mut cfg = connections_config::load();
            let Some(conn) = cfg.connections.get_mut(&name) else {
                eprintln!("[alter] no connection named '{name}'");
                std::process::exit(1);
            };
            if let Some(h) = host { conn.host = h; }
            if let Some(p) = port { conn.port = p; }
            if let Some(t) = token { conn.token = t; }
            if label.is_some() { conn.label = label; }
            connections_config::save(&cfg)?;
            println!("[alter] updated connection '{name}'");
        }

        // @group Configuration > Remove : Delete a named connection
        RemoteAction::Remove { name } => {
            let mut cfg = connections_config::load();
            if cfg.connections.remove(&name).is_none() {
                eprintln!("[alter] no connection named '{name}'");
                std::process::exit(1);
            }
            if cfg.default.as_deref() == Some(&name) {
                cfg.default = None;
            }
            connections_config::save(&cfg)?;
            println!("[alter] removed connection '{name}'");
        }

        // @group Configuration > List : Print all saved connections
        RemoteAction::List => {
            let cfg = connections_config::load();
            if cfg.connections.is_empty() {
                println!("[alter] no remote connections configured");
                println!();
                println!("add one:");
                println!("  1. on the remote server: alter token show");
                println!("  2. alter --host 0.0.0.0 daemon start   (or restart)");
                println!("  3. alter remote add <name> --host <ip> --token <token>");
                return Ok(());
            }

            let mut names: Vec<_> = cfg.connections.keys().collect();
            names.sort();

            println!("{:<18} {:<28} {:<10} {}", "NAME", "HOST:PORT", "DEFAULT", "LABEL");
            println!("{}", "-".repeat(70));
            for n in names {
                let conn = &cfg.connections[n];
                let is_default = if cfg.default.as_deref() == Some(n) { "✓" } else { "" };
                let label = conn.label.as_deref().unwrap_or("");
                println!(
                    "{:<18} {:<28} {:<10} {}",
                    n,
                    format!("{}:{}", conn.host, conn.port),
                    is_default,
                    label
                );
            }

            if let Some(d) = &cfg.default {
                println!();
                println!("default: {d}  (override with --remote <name>)");
            }
        }

        // @group Configuration > Use : Set (or clear) the default connection
        RemoteAction::Use { name } => {
            let mut cfg = connections_config::load();
            if name == "local" {
                cfg.default = None;
                connections_config::save(&cfg)?;
                println!("[alter] default connection reset to local daemon");
            } else if cfg.connections.contains_key(&name) {
                cfg.default = Some(name.clone());
                connections_config::save(&cfg)?;
                println!("[alter] default connection set to '{name}'");
                println!("commands now target '{name}' unless --remote or --host is given");
            } else {
                eprintln!("[alter] no connection named '{name}'");
                std::process::exit(1);
            }
        }
    }
    Ok(())
}
