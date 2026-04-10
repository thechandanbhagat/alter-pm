// @group APIEndpoints : UI / app settings — persisted to data dir, not the browser

use axum::{
    http::StatusCode,
    routing::{get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::paths::data_dir;

// @group Utilities > UiSettings : Path to the UI settings file
fn settings_file() -> std::path::PathBuf {
    data_dir().join("ui-settings.json")
}

// @group Utilities > UiSettings : Load raw JSON blob from disk (returns empty object on missing / corrupt)
fn load_raw() -> Value {
    match std::fs::read_to_string(settings_file()) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or(Value::Object(Default::default())),
        Err(_)  => Value::Object(Default::default()),
    }
}

// @group Utilities > UiSettings : Persist raw JSON blob to disk
fn save_raw(val: &Value) -> Result<(), String> {
    let path = settings_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(val).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

// @group Types : View-mode wrapper (table | card)
#[derive(Serialize, Deserialize)]
struct ViewModeBody { view_mode: String }

pub fn router() -> Router {
    Router::new()
        .route("/ui-settings", get(get_settings).put(put_settings))
        .route("/ui-settings/view-mode", put(put_view_mode))
}

// @group APIEndpoints > UiSettings : GET /system/ui-settings — returns full blob
async fn get_settings() -> Json<Value> {
    Json(load_raw())
}

// @group APIEndpoints > UiSettings : PUT /system/ui-settings — replace full blob
async fn put_settings(Json(body): Json<Value>) -> StatusCode {
    match save_raw(&body) {
        Ok(_)  => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// @group APIEndpoints > UiSettings : PUT /system/ui-settings/view-mode — quick updater for view-mode
async fn put_view_mode(Json(body): Json<ViewModeBody>) -> StatusCode {
    let mut val = load_raw();
    if let Value::Object(ref mut map) = val {
        map.insert("viewMode".to_string(), Value::String(body.view_mode));
    }
    match save_raw(&val) {
        Ok(_)  => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
