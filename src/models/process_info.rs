// @group Types : Serializable snapshot of a managed process (sent over API)

use crate::models::process_status::ProcessStatus;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub id: Uuid,
    pub name: String,
    pub script: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub uptime_secs: Option<u64>,
    pub last_exit_code: Option<i32>,
    pub autorestart: bool,
    pub max_restarts: u32,
    pub watch: bool,
    pub namespace: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub stopped_at: Option<DateTime<Utc>>,
}
