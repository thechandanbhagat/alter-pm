// @group APIEndpoints : Remote server bookmarks — persist to local daemon data dir

use axum::{
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::config::paths::data_dir;

// @group Types > RemoteServer : Mirrors web-ui RemoteServer interface
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteServer {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(rename = "connectionType")]
    pub connection_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_key_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_daemon_port: Option<u16>,
}

// @group Types > RemoteServerStore : Full stored blob
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ServerStore {
    servers: Vec<RemoteServer>,
    active_id: Option<String>,
}

// @group Utilities > RemoteServers : Path on disk
fn store_path() -> std::path::PathBuf {
    data_dir().join("remote-servers.json")
}

// @group Utilities > RemoteServers : Load from disk
fn load() -> ServerStore {
    match std::fs::read_to_string(store_path()) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_)  => ServerStore::default(),
    }
}

// @group Utilities > RemoteServers : Persist to disk
fn save(store: &ServerStore) -> anyhow::Result<()> {
    let path = store_path();
    if let Some(p) = path.parent() { std::fs::create_dir_all(p)?; }
    std::fs::write(&path, serde_json::to_string_pretty(store)?)?;
    Ok(())
}

pub fn router() -> Router {
    Router::new()
        .route("/system/remote-servers", get(get_store).put(put_store))
}

// @group APIEndpoints > RemoteServers : GET /system/remote-servers
async fn get_store() -> Json<ServerStore> {
    Json(load())
}

// @group APIEndpoints > RemoteServers : PUT /system/remote-servers
async fn put_store(Json(store): Json<ServerStore>) -> StatusCode {
    match save(&store) {
        Ok(_)  => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
