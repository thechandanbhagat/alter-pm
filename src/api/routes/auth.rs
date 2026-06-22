// @group Authentication : Auth endpoints -- login, logout, PIN, change-password, lock settings

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    api::error::ApiError,
    config::auth_config::{self, generate_token},
    daemon::state::DaemonState,
};

pub fn router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/status", get(get_status))
        .route("/setup", post(setup_password))
        .route("/login", post(login))
        .route("/pin/login", post(pin_login))
        .route("/session", delete(logout))
        .route("/change-password", post(change_password))
        .route("/pin", post(set_pin).delete(remove_pin))
        .route("/settings", patch(update_settings))
        .route("/rotate-token", post(rotate_token))
        // Passkey endpoints -- stubs until a ring-based WebAuthn backend is added
        .route("/passkey/register/start", post(passkey_not_supported))
        .route("/passkey/register/finish", post(passkey_not_supported))
        .route("/passkey/login/start", post(passkey_not_supported))
        .route("/passkey/login/finish", post(passkey_not_supported))
        .with_state(state)
}

// @group Authentication > Status : Report whether a password / PIN is configured
#[derive(Serialize)]
struct AuthStatus {
    password_configured: bool,
    passkeys_count: usize,
    passkeys_supported: bool,
    pin_configured: bool,
    lock_timeout_mins: Option<u32>,
}

async fn get_status(State(state): State<Arc<DaemonState>>) -> Json<AuthStatus> {
    let auth = state.auth.read().await;
    Json(AuthStatus {
        password_configured: auth.password_hash.is_some(),
        passkeys_count: auth.passkeys.len(),
        passkeys_supported: false, // requires OpenSSL -- future feature
        pin_configured: auth.pin_hash.is_some(),
        lock_timeout_mins: auth.lock_timeout_mins,
    })
}

// @group Authentication > Setup : First-time password setup (only works once)
#[derive(Deserialize)]
struct SetupRequest {
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    session_token: String,
    expires_at: String,
}

async fn setup_password(
    State(state): State<Arc<DaemonState>>,
    Json(body): Json<SetupRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let mut auth = state.auth.write().await;
    if auth.password_hash.is_some() {
        return Err(ApiError {
            status: StatusCode::CONFLICT,
            message: "Password already configured".into(),
        });
    }
    if body.password.len() < 8 {
        return Err(ApiError::bad_request("Password must be at least 8 characters"));
    }
    auth.set_password(&body.password)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    auth_config::save(&auth).map_err(|e| ApiError::internal(e.to_string()))?;

    let (token, expires_at) = create_session(&state).await;
    Ok(Json(LoginResponse { session_token: token, expires_at: expires_at.to_rfc3339() }))
}

// @group Authentication > Login : Password-based login -- returns session token
#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

async fn login(
    State(state): State<Arc<DaemonState>>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let auth = state.auth.read().await;
    if !auth.verify_password(&body.password) {
        return Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "Invalid password".into(),
        });
    }
    drop(auth);

    let (token, expires_at) = create_session(&state).await;
    Ok(Json(LoginResponse { session_token: token, expires_at: expires_at.to_rfc3339() }))
}

// @group Authentication > PIN Login : PIN-based login (quick unlock / lock screen)
#[derive(Deserialize)]
struct PinLoginRequest {
    pin: String,
}

async fn pin_login(
    State(state): State<Arc<DaemonState>>,
    Json(body): Json<PinLoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let auth = state.auth.read().await;
    if !auth.verify_pin(&body.pin) {
        return Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "Invalid PIN".into(),
        });
    }
    drop(auth);

    let (token, expires_at) = create_session(&state).await;
    Ok(Json(LoginResponse { session_token: token, expires_at: expires_at.to_rfc3339() }))
}

// @group Authentication > Logout : Invalidate the current session token
async fn logout(State(state): State<Arc<DaemonState>>, headers: HeaderMap) -> Json<serde_json::Value> {
    if let Some(token) = extract_bearer(&headers) {
        state.sessions.remove(&token);
    }
    Json(serde_json::json!({ "success": true }))
}

// @group Authentication > ChangePassword : Update password (requires current password)
#[derive(Deserialize)]
struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

async fn change_password(
    State(state): State<Arc<DaemonState>>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_session_valid(&state, &headers).await {
        return Err(ApiError::unauthorized("Not authenticated"));
    }
    let mut auth = state.auth.write().await;
    if !auth.verify_password(&body.current_password) {
        return Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "Current password is incorrect".into(),
        });
    }
    if body.new_password.len() < 8 {
        return Err(ApiError::bad_request("Password must be at least 8 characters"));
    }
    auth.set_password(&body.new_password)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    auth_config::save(&auth).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// @group Authentication > PIN : Set or update the dashboard PIN (4 or 6 digits)
#[derive(Deserialize)]
struct SetPinRequest {
    pin: String,
}

async fn set_pin(
    State(state): State<Arc<DaemonState>>,
    headers: HeaderMap,
    Json(body): Json<SetPinRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_session_valid(&state, &headers).await {
        return Err(ApiError::unauthorized("Not authenticated"));
    }
    let mut auth = state.auth.write().await;
    auth.set_pin(&body.pin).map_err(|e| ApiError::bad_request(e.to_string()))?;
    auth_config::save(&auth).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// @group Authentication > PIN : Remove the configured PIN
async fn remove_pin(
    State(state): State<Arc<DaemonState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_session_valid(&state, &headers).await {
        return Err(ApiError::unauthorized("Not authenticated"));
    }
    let mut auth = state.auth.write().await;
    auth.clear_pin();
    auth_config::save(&auth).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// @group Authentication > Settings : Update auto-lock timeout
#[derive(Deserialize)]
struct UpdateSettingsRequest {
    lock_timeout_mins: Option<u32>,
}

async fn update_settings(
    State(state): State<Arc<DaemonState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_session_valid(&state, &headers).await {
        return Err(ApiError::unauthorized("Not authenticated"));
    }
    let mut auth = state.auth.write().await;
    auth.lock_timeout_mins = body.lock_timeout_mins;
    auth_config::save(&auth).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// @group Authentication > RotateToken : Regenerate master token (invalidates old one, updates in-memory state)
async fn rotate_token(
    State(state): State<Arc<DaemonState>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let new_token = generate_token();
    let mut auth = state.auth.write().await;
    auth.master_token = new_token.clone();
    auth_config::save(&auth).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "token": new_token })))
}

// @group Authentication > Passkey : Stub -- returns 501 until WebAuthn backend is added
async fn passkey_not_supported() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({ "error": "Passkey support requires OpenSSL -- not yet available on this build" })),
    )
}

// @group Utilities : Create a 24-hour browser session and register it in the session store
async fn create_session(state: &DaemonState) -> (String, chrono::DateTime<chrono::Utc>) {
    let token = generate_token();
    let expires_at = Utc::now() + Duration::hours(24);
    state.sessions.insert(token.clone(), expires_at);
    (token, expires_at)
}

// @group Utilities : Check if the request carries a valid session or master token
async fn is_session_valid(state: &DaemonState, headers: &HeaderMap) -> bool {
    let Some(token) = extract_bearer(headers) else { return false };
    let auth = state.auth.read().await;
    if auth.master_token == token { return true; }
    drop(auth);
    if let Some(exp) = state.sessions.get(&token) {
        return *exp > Utc::now();
    }
    false
}

// @group Utilities : Extract Bearer token from Authorization header
fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}
