// @group Types : Process lifecycle state machine

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    #[default]
    Stopped,
    Starting,
    Running,
    Stopping,
    Crashed,
    Errored,
    Watching,
    Sleeping,  // cron job waiting for next scheduled run
}

impl fmt::Display for ProcessStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProcessStatus::Stopped  => write!(f, "stopped"),
            ProcessStatus::Starting => write!(f, "starting"),
            ProcessStatus::Running  => write!(f, "running"),
            ProcessStatus::Stopping => write!(f, "stopping"),
            ProcessStatus::Crashed  => write!(f, "crashed"),
            ProcessStatus::Errored  => write!(f, "errored"),
            ProcessStatus::Watching => write!(f, "watching"),
            ProcessStatus::Sleeping => write!(f, "sleeping"),
        }
    }
}
