// @group APIEndpoints : Terminal command history — persist per-process history to disk

use axum::{
    extract::Path,
    http::StatusCode,
    routing::{get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::config::paths::terminal_history_file;

// @group Types : One command history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmdEntry {
    pub cmd:   String,
    pub count: u32,
}

// @group Types : Full history file — map of key → entries
type HistoryMap = HashMap<String, Vec<CmdEntry>>;

// @group Utilities > TerminalHistory : Read the full history map from disk
fn load_map() -> HistoryMap {
    let path = terminal_history_file();
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_)  => HashMap::new(),
    }
}

// @group Utilities > TerminalHistory : Persist the full history map to disk
fn save_map(map: &HistoryMap) -> Result<(), String> {
    let path = terminal_history_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn router() -> Router {
    Router::new()
        .route("/history/{key}", get(get_history).put(put_history))
}

// @group APIEndpoints > TerminalHistory : GET /terminals/history/:key
async fn get_history(Path(key): Path<String>) -> Json<Vec<CmdEntry>> {
    let map = load_map();
    Json(map.get(&key).cloned().unwrap_or_default())
}

// @group APIEndpoints > TerminalHistory : PUT /terminals/history/:key
async fn put_history(
    Path(key):    Path<String>,
    Json(entries): Json<Vec<CmdEntry>>,
) -> StatusCode {
    let mut map = load_map();
    // Cap at 150 entries per key
    map.insert(key, entries.into_iter().take(150).collect());
    match save_map(&map) {
        Ok(_)  => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
