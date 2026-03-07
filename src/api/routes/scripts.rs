// @group APIEndpoints : Script file management — save, list, read, delete, and run scripts

use crate::api::error::ApiError;
use crate::config::paths::scripts_dir;
use crate::daemon::state::DaemonState;
use crate::process::instance::{LogLine, LogStream};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::sse::Event,
    response::{IntoResponse, Sse},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::broadcast;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/", get(list_scripts).post(save_script))
        .route("/{name}", get(get_script).delete(delete_script))
        .route("/{name}/run", get(run_script))
        .with_state(state)
}

// @group Types : Script save request body
#[derive(Deserialize)]
struct SaveScriptRequest {
    name: String,
    language: String,
    content: String,
}

// @group Types : Script metadata returned by list/save
#[derive(Serialize)]
struct ScriptMeta {
    name: String,
    path: String,
    language: String,
    size_bytes: u64,
    modified_at: String,
}

// @group Configuration : Map language/interpreter name to file extension
fn ext_for_lang(lang: &str) -> &'static str {
    match lang {
        "python" | "python3" => "py",
        "node" | "bun" | "deno" => "js",
        "ts-node" => "ts",
        "powershell" | "pwsh" => "ps1",
        "bash" | "sh" | "zsh" | "fish" => "sh",
        "cmd" => "bat",
        "ruby" => "rb",
        "php" => "php",
        "perl" => "pl",
        "lua" => "lua",
        "java" => "java",
        "groovy" => "groovy",
        "kotlin" => "kts",
        "scala" => "sc",
        "clj" => "clj",
        "dotnet-script" => "csx",
        "dotnet" => "fsx",
        "go" => "go",
        "cargo-script" => "rs",
        "Rscript" => "r",
        "julia" => "jl",
        "swift" => "swift",
        "elixir" => "exs",
        "escript" => "erl",
        "runghc" => "hs",
        "ocaml" => "ml",
        "tclsh" => "tcl",
        "awk" => "awk",
        _ => "txt",
    }
}

// @group Utilities : Sanitize a script name to be filesystem-safe
fn sanitize_script_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

// @group APIEndpoints > Scripts : POST /scripts — save a script to disk
async fn save_script(
    State(_state): State<Arc<DaemonState>>,
    Json(req): Json<SaveScriptRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let dir = scripts_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| ApiError::internal(format!("failed to create scripts dir: {e}")))?;

    let safe_name = sanitize_script_name(&req.name);
    let ext = ext_for_lang(&req.language);
    let filename = format!("{safe_name}.{ext}");
    let path = dir.join(&filename);

    // Delete any existing file with the same stem but a different extension.
    // This prevents stale files from causing get_script to return the wrong path
    // when the user changes the interpreter and re-saves under the same name.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file()
                && p.file_stem().and_then(|s| s.to_str()) == Some(safe_name.as_str())
                && p.extension().and_then(|e| e.to_str()) != Some(ext)
            {
                let _ = std::fs::remove_file(&p);
            }
        }
    }

    std::fs::write(&path, &req.content)
        .map_err(|e| ApiError::internal(format!("failed to write script: {e}")))?;

    let path_str = path.to_string_lossy().to_string();
    Ok((StatusCode::CREATED, Json(json!({
        "name": safe_name,
        "filename": filename,
        "path": path_str,
        "language": req.language,
    }))))
}

// @group APIEndpoints > Scripts : GET /scripts — list all saved scripts
async fn list_scripts(
    State(_state): State<Arc<DaemonState>>,
) -> Json<Value> {
    let dir = scripts_dir();
    let mut scripts: Vec<ScriptMeta> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() { continue; }
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let name = path.file_stem().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let meta = entry.metadata().ok();
            let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_at = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| {
                    let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
                    let dt = chrono::DateTime::<Utc>::from_timestamp(secs as i64, 0)?;
                    Some(dt.to_rfc3339())
                })
                .unwrap_or_default();

            // Guess language from extension (reverse map)
            let language = ext_from_reverse(ext).to_string();

            scripts.push(ScriptMeta {
                name,
                path: path.to_string_lossy().to_string(),
                language,
                size_bytes,
                modified_at,
            });
        }
    }

    scripts.sort_by(|a, b| a.name.cmp(&b.name));
    Json(json!({ "scripts": scripts }))
}

// @group Utilities : Reverse ext→language lookup for display
fn ext_from_reverse(ext: &str) -> &'static str {
    match ext {
        "py" => "python",
        "js" => "node",
        "ts" => "ts-node",
        "ps1" => "powershell",
        "sh" => "bash",
        "bat" => "cmd",
        "rb" => "ruby",
        "php" => "php",
        "pl" => "perl",
        "lua" => "lua",
        "java" => "java",
        "groovy" => "groovy",
        "kts" => "kotlin",
        "sc" => "scala",
        "clj" => "clojure",
        "csx" => "dotnet-script",
        "fsx" => "dotnet",
        "go" => "go",
        "rs" => "rust",
        "r" => "Rscript",
        "jl" => "julia",
        "swift" => "swift",
        "exs" => "elixir",
        "erl" => "erlang",
        "hs" => "haskell",
        "ml" => "ocaml",
        "tcl" => "tcl",
        "awk" => "awk",
        _ => "text",
    }
}

// @group APIEndpoints > Scripts : GET /scripts/{name} — read script content
async fn get_script(
    State(_state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let dir = scripts_dir();
    // Find file matching the name (any extension)
    let entry = std::fs::read_dir(&dir)
        .map_err(|_| ApiError::not_found(format!("scripts dir not found")))?
        .flatten()
        .find(|e| {
            e.path().file_stem().and_then(|s| s.to_str()) == Some(name.as_str())
        })
        .ok_or_else(|| ApiError::not_found(format!("script '{name}' not found")))?;

    let path = entry.path();
    let content = std::fs::read_to_string(&path)
        .map_err(|e| ApiError::internal(format!("failed to read script: {e}")))?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    Ok(Json(json!({
        "name": name,
        "path": path.to_string_lossy(),
        "content": content,
        "language": ext_from_reverse(ext),
    })))
}

// @group APIEndpoints > Scripts : DELETE /scripts/{name} — remove script file
async fn delete_script(
    State(_state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let dir = scripts_dir();
    let entry = std::fs::read_dir(&dir)
        .map_err(|_| ApiError::not_found("scripts dir not found".to_string()))?
        .flatten()
        .find(|e| {
            e.path().file_stem().and_then(|s| s.to_str()) == Some(name.as_str())
        })
        .ok_or_else(|| ApiError::not_found(format!("script '{name}' not found")))?;

    std::fs::remove_file(entry.path())
        .map_err(|e| ApiError::internal(format!("failed to delete script: {e}")))?;

    Ok(Json(json!({ "success": true })))
}

// @group APIEndpoints > Scripts : GET /scripts/{name}/run — spawn script and stream output via SSE
async fn run_script(
    State(_state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let dir = scripts_dir();

    // Find the script file
    let entry = std::fs::read_dir(&dir)
        .map_err(|_| ApiError::not_found("scripts dir not found".to_string()))?
        .flatten()
        .find(|e| {
            e.path().file_stem().and_then(|s| s.to_str()) == Some(name.as_str())
        })
        .ok_or_else(|| ApiError::not_found(format!("script '{name}' not found")))?;

    let script_path = entry.path();
    let ext = script_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();

    // Determine interpreter from extension
    let interpreter = interpreter_for_ext(&ext);
    let script_str = script_path.to_string_lossy().to_string();

    // @group BusinessLogic > Run : Spawn the script process directly (not via process manager)
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let is_native = interpreter.ends_with(".exe") || interpreter.contains('\\');
        // .bat/.cmd files must be run via "cmd /C <script>" — not "cmd /C cmd <script>"
        let is_batch = ext == "bat" || ext == "cmd";
        if is_batch {
            let mut c = Command::new("cmd");
            c.args(["/C", &script_str]);
            c
        } else if is_native {
            let mut c = Command::new(interpreter);
            c.arg(&script_str);
            c
        } else {
            let mut c = Command::new("cmd");
            c.args(["/C", interpreter, &script_str]);
            c
        }
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new(interpreter);
        c.arg(&script_str);
        c
    };

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    // Set working directory to scripts dir
    cmd.current_dir(&dir);

    let mut child = cmd.spawn()
        .map_err(|e| ApiError::internal(format!("failed to spawn script: {e}")))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // @group BusinessLogic > Run : Broadcast channel for merging stdout + stderr
    let (tx, _) = broadcast::channel::<LogLine>(512);
    let tx_out = tx.clone();
    let tx_err = tx.clone();
    let mut rx = tx.subscribe();

    let dummy_id = uuid::Uuid::new_v4();

    // Stream stdout
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = tx_out.send(LogLine {
                timestamp: Utc::now(),
                process_id: dummy_id,
                stream: LogStream::Stdout,
                content: line,
            });
        }
    });

    // Stream stderr
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = tx_err.send(LogLine {
                timestamp: Utc::now(),
                process_id: dummy_id,
                stream: LogStream::Stderr,
                content: line,
            });
        }
    });

    // Wait for process exit and signal done via a separate channel
    let (done_tx, mut done_rx) = tokio::sync::mpsc::channel::<Option<i32>>(1);
    let notify_tx = tx.clone();

    tokio::spawn(async move {
        let exit_code = match child.wait().await {
            Ok(status) => status.code(),
            Err(_) => None,
        };
        // Small delay so final output lines flush through the broadcast channel
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        let _ = done_tx.send(exit_code).await;
        // Send a sentinel line to unblock the rx.recv() loop
        let _ = notify_tx.send(LogLine {
            timestamp: Utc::now(),
            process_id: dummy_id,
            stream: LogStream::Stdout,
            content: "\x00__done__\x00".to_string(), // internal sentinel
        });
    });

    // @group BusinessLogic > Run : SSE event stream — yields log lines then a done event
    let event_stream = async_stream::stream! {
        let mut exit_code: Option<i32> = None;
        loop {
            tokio::select! {
                // Check for process completion
                code = done_rx.recv() => {
                    exit_code = code.flatten();
                    // Drain remaining messages briefly
                    loop {
                        match rx.try_recv() {
                            Ok(line) if line.content != "\x00__done__\x00" => {
                                let data = serde_json::json!({
                                    "stream": if line.stream == LogStream::Stderr { "stderr" } else { "stdout" },
                                    "content": line.content,
                                });
                                yield Ok(Event::default().data(data.to_string()));
                            }
                            _ => break,
                        }
                    }
                    break;
                }
                // New log line
                msg = rx.recv() => {
                    match msg {
                        Ok(line) => {
                            if line.content == "\x00__done__\x00" { continue; }
                            let data = serde_json::json!({
                                "stream": if line.stream == LogStream::Stderr { "stderr" } else { "stdout" },
                                "content": line.content,
                            });
                            yield Ok(Event::default().data(data.to_string()));
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    }
                }
            }
        }
        // Send final done event with exit code
        let done_data = serde_json::json!({ "done": true, "exit_code": exit_code });
        yield Ok(Event::default().data(done_data.to_string()));
    };

    Ok(Sse::new(event_stream))
}

// @group Configuration : Map file extension back to interpreter command
fn interpreter_for_ext(ext: &str) -> &'static str {
    match ext {
        "py" => "python",
        "js" => "node",
        "ts" => "ts-node",
        "ps1" => "powershell",
        "sh" | "bash" => "bash",
        "bat" => "cmd",
        "rb" => "ruby",
        "php" => "php",
        "pl" => "perl",
        "lua" => "lua",
        "groovy" => "groovy",
        "kts" => "kotlin",
        "sc" => "scala",
        "clj" => "clj",
        "csx" => "dotnet-script",
        "fsx" => "dotnet",
        "go" => "go",
        "r" => "Rscript",
        "jl" => "julia",
        "swift" => "swift",
        "exs" => "elixir",
        "erl" => "escript",
        "hs" => "runghc",
        "ml" => "ocaml",
        "tcl" => "tclsh",
        "awk" => "awk",
        _ => "bash",
    }
}
