// @group BusinessLogic : `alter start` command handler

use crate::cli::args::StartArgs;
use crate::client::daemon_client::DaemonClient;
use crate::models::api_types::EcosystemRequest;
use anyhow::Result;
use serde_json::json;
use std::collections::HashMap;

pub async fn run(client: &DaemonClient, args: StartArgs, json_mode: bool) -> Result<()> {
    // Detect if it's an ecosystem config file
    if args.script.ends_with(".toml") || args.script.ends_with(".json") {
        return run_ecosystem(client, &args.script, json_mode).await;
    }

    ensure_daemon(client).await?;

    // Parse KEY=VALUE env pairs
    let mut env: HashMap<String, String> = HashMap::new();
    for kv in args.env.unwrap_or_default() {
        if let Some((k, v)) = kv.split_once('=') {
            env.insert(k.to_string(), v.to_string());
        }
    }

    let body = json!({
        "name": args.name,
        "script": args.script,
        "args": args.args.unwrap_or_default(),
        "cwd": args.cwd,
        "namespace": args.namespace,
        "env": env,
        "autorestart": args.autorestart,
        "max_restarts": args.max_restarts,
        "restart_delay_ms": args.restart_delay_ms,
        "watch": args.watch,
        "watch_paths": args.watch_paths.unwrap_or_default(),
        "cron": args.cron,
    });

    let result = client.post("/api/v1/processes", body).await?;

    if json_mode {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        let name = result["name"].as_str().unwrap_or("?");
        let id = result["id"].as_str().unwrap_or("?");
        let status = result["status"].as_str().unwrap_or("?");
        println!("[alter] started '{}' ({}): {}", name, &id[..8.min(id.len())], status);
    }
    Ok(())
}

async fn run_ecosystem(client: &DaemonClient, path: &str, json_mode: bool) -> Result<()> {
    ensure_daemon(client).await?;

    let abs_path = std::fs::canonicalize(path)
        .unwrap_or_else(|_| std::path::PathBuf::from(path))
        .to_string_lossy()
        .to_string();

    let body = json!({ "path": abs_path });
    let result = client.post("/api/v1/ecosystem", body).await?;

    if json_mode {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        let started = result["started"].as_u64().unwrap_or(0);
        let total = result["total"].as_u64().unwrap_or(0);
        println!("[alter] started {started}/{total} apps from ecosystem config");
        if let Some(errors) = result["errors"].as_array() {
            for e in errors {
                eprintln!("[alter] error: {}", e.as_str().unwrap_or("unknown"));
            }
        }
    }
    Ok(())
}

async fn ensure_daemon(client: &DaemonClient) -> Result<()> {
    if !client.is_alive().await {
        eprintln!("[alter] daemon is not running. Start it with: alter daemon start");
        std::process::exit(1);
    }
    Ok(())
}
