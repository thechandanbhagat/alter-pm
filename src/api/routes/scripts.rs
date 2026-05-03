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
pub(crate) fn interpreter_for_ext(ext: &str) -> &'static str {
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

// @group UnitTests : Tests for script helper functions
#[cfg(test)]
mod tests {
    use super::*;

    // @group UnitTests > Scripts > SanitizeName : Alphanumeric + dash + underscore pass through
    #[test]
    fn test_sanitize_alphanumeric_passthrough() {
        assert_eq!(sanitize_script_name("my-script_v2"), "my-script_v2");
        assert_eq!(sanitize_script_name("hello123"), "hello123");
    }

    // @group UnitTests > Scripts > SanitizeName : Spaces become underscores
    #[test]
    fn test_sanitize_spaces_to_underscore() {
        assert_eq!(sanitize_script_name("my script"), "my_script");
        assert_eq!(sanitize_script_name("a b c"), "a_b_c");
    }

    // @group UnitTests > Scripts > SanitizeName : Special chars become underscores
    #[test]
    fn test_sanitize_special_chars() {
        assert_eq!(sanitize_script_name("foo/bar"), "foo_bar");
        assert_eq!(sanitize_script_name("test.script"), "test_script");
        assert_eq!(sanitize_script_name("hello world!@#"), "hello_world___");
    }

    // @group UnitTests > Scripts > SanitizeName : Empty string stays empty
    #[test]
    fn test_sanitize_empty_string() {
        assert_eq!(sanitize_script_name(""), "");
    }

    // @group UnitTests > Scripts > ExtForLang : Common languages map to correct extensions
    #[test]
    fn test_ext_for_lang_common() {
        assert_eq!(ext_for_lang("python"),     "py");
        assert_eq!(ext_for_lang("python3"),    "py");
        assert_eq!(ext_for_lang("node"),       "js");
        assert_eq!(ext_for_lang("bun"),        "js");
        assert_eq!(ext_for_lang("bash"),       "sh");
        assert_eq!(ext_for_lang("sh"),         "sh");
        assert_eq!(ext_for_lang("powershell"), "ps1");
        assert_eq!(ext_for_lang("pwsh"),       "ps1");
        assert_eq!(ext_for_lang("ts-node"),    "ts");
        assert_eq!(ext_for_lang("cmd"),        "bat");
        assert_eq!(ext_for_lang("ruby"),       "rb");
        assert_eq!(ext_for_lang("go"),         "go");
    }

    // @group UnitTests > Scripts > ExtForLang : Unknown language falls back to txt
    #[test]
    fn test_ext_for_lang_unknown() {
        assert_eq!(ext_for_lang("fortran"), "txt");
        assert_eq!(ext_for_lang(""),        "txt");
    }

    // @group UnitTests > Scripts > ExtFromReverse : Extensions map back to language names
    #[test]
    fn test_ext_from_reverse_common() {
        assert_eq!(ext_from_reverse("py"),  "python");
        assert_eq!(ext_from_reverse("js"),  "node");
        assert_eq!(ext_from_reverse("ts"),  "ts-node");
        assert_eq!(ext_from_reverse("ps1"), "powershell");
        assert_eq!(ext_from_reverse("sh"),  "bash");
        assert_eq!(ext_from_reverse("bat"), "cmd");
        assert_eq!(ext_from_reverse("rb"),  "ruby");
        assert_eq!(ext_from_reverse("go"),  "go");
    }

    // @group UnitTests > Scripts > ExtFromReverse : Unknown extension maps to text
    #[test]
    fn test_ext_from_reverse_unknown() {
        assert_eq!(ext_from_reverse("xyz"), "text");
        assert_eq!(ext_from_reverse(""),    "text");
    }

    // @group UnitTests > Scripts > InterpreterForExt : Extensions map to correct interpreter
    #[test]
    fn test_interpreter_for_ext_common() {
        assert_eq!(interpreter_for_ext("py"),  "python");
        assert_eq!(interpreter_for_ext("js"),  "node");
        assert_eq!(interpreter_for_ext("ts"),  "ts-node");
        assert_eq!(interpreter_for_ext("ps1"), "powershell");
        assert_eq!(interpreter_for_ext("sh"),  "bash");
        assert_eq!(interpreter_for_ext("rb"),  "ruby");
        assert_eq!(interpreter_for_ext("go"),  "go");
        assert_eq!(interpreter_for_ext("php"), "php");
    }

    // @group UnitTests > Scripts > InterpreterForExt : Unknown extension falls back to bash
    #[test]
    fn test_interpreter_for_ext_fallback() {
        assert_eq!(interpreter_for_ext("xyz"), "bash");
        assert_eq!(interpreter_for_ext(""),    "bash");
    }

    // @group UnitTests > Scripts > Roundtrip : lang→ext→interpreter is consistent
    #[test]
    fn test_lang_ext_interpreter_roundtrip() {
        // python → py → python (interpreter)
        let ext = ext_for_lang("python");
        assert_eq!(interpreter_for_ext(ext), "python");

        // node → js → node
        let ext = ext_for_lang("node");
        assert_eq!(interpreter_for_ext(ext), "node");

        // powershell → ps1 → powershell
        let ext = ext_for_lang("powershell");
        assert_eq!(interpreter_for_ext(ext), "powershell");

        // ts-node → ts → ts-node
        let ext = ext_for_lang("ts-node");
        assert_eq!(interpreter_for_ext(ext), "ts-node");
    }
}
