// @group ErrorHandling : API error type with automatic HTTP response conversion

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn not_found(msg: impl ToString) -> Self {
        Self { status: StatusCode::NOT_FOUND, message: msg.to_string() }
    }

    pub fn bad_request(msg: impl ToString) -> Self {
        Self { status: StatusCode::BAD_REQUEST, message: msg.to_string() }
    }

    pub fn internal(msg: impl ToString) -> Self {
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, message: msg.to_string() }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(json!({ "error": self.message }));
        (self.status, body).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        let msg = e.to_string();
        if msg.contains("not found") {
            ApiError::not_found(msg)
        } else {
            ApiError::internal(msg)
        }
    }
}
