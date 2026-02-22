// @group Types : Cron job run history entry

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const MAX_CRON_HISTORY: usize = 20;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CronRun {
    pub run_at: DateTime<Utc>,
    pub exit_code: Option<i32>,
    pub duration_secs: u64,
}
