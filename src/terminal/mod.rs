// @group BusinessLogic : Terminal session manager — tracks active PTY sessions

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::Serialize;
use std::sync::Arc;

// @group Types : Metadata for one active terminal session (returned to the frontend)
#[derive(Clone, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub cwd: String,
    pub created_at: DateTime<Utc>,
}

// @group BusinessLogic : Shared handle — registry of all live PTY sessions
pub struct TerminalManager {
    pub sessions: Arc<DashMap<String, TerminalInfo>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }

    pub fn count(&self) -> usize {
        self.sessions.len()
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}
