// @group APIEndpoints : Terminal WebSocket routes — PTY bridge for browser-based terminal

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use std::io::{Read, Write};
use std::sync::Arc;
use uuid::Uuid;

use crate::daemon::state::DaemonState;
use crate::terminal::TerminalInfo;

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/", get(list_sessions))
        .route("/ws", get(ws_handler))
        .with_state(state)
}

// @group APIEndpoints > Terminal : GET /terminals — list active sessions with count
async fn list_sessions(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let sessions: Vec<_> = state
        .terminal_manager
        .sessions
        .iter()
        .map(|e| e.value().clone())
        .collect();
    let count = sessions.len();
    Json(serde_json::json!({ "sessions": sessions, "count": count }))
}

// @group Types : WebSocket query parameters
#[derive(Deserialize)]
struct WsQuery {
    cwd:  Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

// @group Types : Messages the browser sends to the server
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMsg {
    Input  { data: String },
    Resize { cols: u16, rows: u16 },
}

// @group APIEndpoints > Terminal : GET /terminals/ws — upgrade to WebSocket, spawn PTY
async fn ws_handler(
    ws:                WebSocketUpgrade,
    Query(q):          Query<WsQuery>,
    State(state):      State<Arc<DaemonState>>,
) -> impl IntoResponse {
    let cwd = q.cwd.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });
    let cols = q.cols.unwrap_or(120);
    let rows = q.rows.unwrap_or(30);
    ws.on_upgrade(move |socket| handle_terminal(socket, state, cwd, cols, rows))
}

// @group BusinessLogic > Terminal : Bridge a WebSocket connection to a PTY subprocess
async fn handle_terminal(
    mut socket: WebSocket,
    state: Arc<DaemonState>,
    cwd: String,
    cols: u16,
    rows: u16,
) {
    let id = Uuid::new_v4().to_string();

    // Open a PTY pair
    let pty_system = portable_pty::native_pty_system();
    let pair = match pty_system.openpty(portable_pty::PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            let _ = socket
                .send(Message::Text(
                    serde_json::json!({"type":"error","message": e.to_string()})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    // Spawn the shell inside the PTY with a git-aware prompt
    //
    // Windows (PowerShell): pass -NoExit -Command to define a custom prompt() function
    //   before dropping into interactive mode. Uses [char]27 for ESC (works on PS 5.1+).
    //   Prompt format: cyan "PS" + blue path + yellow "(branch)" + "> "
    //
    // Unix: set PS1 env var with ANSI colours + $(__git_ps1 " (%s)") fallback.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // PowerShell prompt function — ESC via [char]27, works on PS 5.1 and PS 7+
        let prompt_fn = r#"function prompt {
  $loc = Get-Location
  $b = (git branch --show-current 2>$null)
  $esc = [char]27
  if ($b) {
    "$esc[36mPS$esc[0m $esc[34m$loc$esc[0m $esc[33m($b)$esc[0m`n> "
  } else {
    "$esc[36mPS$esc[0m $esc[34m$loc$esc[0m`n> "
  }
}"#;
        let mut c = portable_pty::CommandBuilder::new("powershell.exe");
        c.args(&["-NoExit", "-Command", prompt_fn]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut c = portable_pty::CommandBuilder::new(&shell);
        // Git-aware PS1: user@host:path (branch)$
        // Uses __git_ps1 if available (git-prompt.sh), otherwise falls back to `git branch`
        c.env(
            "PS1",
            r#"\[\e[36m\]\u@\h\[\e[0m\]:\[\e[34m\]\w\[\e[0m\]\[\e[33m\]$(git branch 2>/dev/null | sed -n 's/^\* /(/p' | tr -d '\n' | sed 's/$/)/')\[\e[0m\]\n\$ "#,
        );
        c
    };

    cmd.cwd(&cwd);

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            let _ = socket
                .send(Message::Text(
                    serde_json::json!({"type":"error","message": e.to_string()})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };
    drop(pair.slave);

    // Register the session so the status bar can show the count
    state.terminal_manager.sessions.insert(
        id.clone(),
        TerminalInfo {
            id: id.clone(),
            cwd: cwd.clone(),
            created_at: Utc::now(),
        },
    );

    let master = pair.master;

    let mut reader = match master.try_clone_reader() {
        Ok(r) => r,
        Err(_) => {
            state.terminal_manager.sessions.remove(&id);
            return;
        }
    };

    let mut writer = match master.take_writer() {
        Ok(w) => w,
        Err(_) => {
            state.terminal_manager.sessions.remove(&id);
            return;
        }
    };

    // Blocking thread: read PTY output → async channel
    let (output_tx, mut output_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(32);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if output_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Blocking thread: async channel → write PTY input
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    std::thread::spawn(move || {
        while let Some(data) = input_rx.blocking_recv() {
            if writer.write_all(&data).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });

    // Main bridge loop: select on PTY output or WebSocket messages
    loop {
        tokio::select! {
            Some(data) = output_rx.recv() => {
                if socket.send(Message::Binary(data.into())).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(cm) = serde_json::from_str::<ClientMsg>(&text) {
                            match cm {
                                ClientMsg::Input { data } => {
                                    let _ = input_tx.send(data.into_bytes()).await;
                                }
                                ClientMsg::Resize { cols, rows } => {
                                    tokio::task::block_in_place(|| {
                                        let _ = master.resize(portable_pty::PtySize {
                                            rows,
                                            cols,
                                            pixel_width: 0,
                                            pixel_height: 0,
                                        });
                                    });
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Binary(data))) => {
                        let _ = input_tx.send(data.to_vec()).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    // Cleanup: kill the shell process and remove session from registry
    let _ = child.kill();
    drop(child);
    drop(master);
    state.terminal_manager.sessions.remove(&id);
}
