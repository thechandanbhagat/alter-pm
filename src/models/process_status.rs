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

// @group UnitTests : ProcessStatus — Display, Default, serde round-trip, equality
#[cfg(test)]
mod tests {
    use super::*;

    // @group UnitTests > Display : Every variant serialises to the expected lowercase string
    #[test]
    fn test_display_all_variants() {
        let cases = [
            (ProcessStatus::Stopped,  "stopped"),
            (ProcessStatus::Starting, "starting"),
            (ProcessStatus::Running,  "running"),
            (ProcessStatus::Stopping, "stopping"),
            (ProcessStatus::Crashed,  "crashed"),
            (ProcessStatus::Errored,  "errored"),
            (ProcessStatus::Watching, "watching"),
            (ProcessStatus::Sleeping, "sleeping"),
        ];
        for (status, expected) in cases {
            assert_eq!(status.to_string(), expected);
        }
    }

    // @group UnitTests > Default : Zero-value is Stopped
    #[test]
    fn test_default_is_stopped() {
        assert_eq!(ProcessStatus::default(), ProcessStatus::Stopped);
    }

    // @group UnitTests > Serde : JSON round-trip preserves variant identity
    #[test]
    fn test_serde_round_trip() {
        let statuses = [
            ProcessStatus::Stopped,
            ProcessStatus::Running,
            ProcessStatus::Crashed,
            ProcessStatus::Sleeping,
        ];
        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let decoded: ProcessStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(decoded, status);
        }
    }

    // @group UnitTests > Serde : Deserialises from known lowercase strings
    #[test]
    fn test_serde_deserialize_from_str() {
        let decoded: ProcessStatus = serde_json::from_str("\"running\"").unwrap();
        assert_eq!(decoded, ProcessStatus::Running);

        let decoded: ProcessStatus = serde_json::from_str("\"sleeping\"").unwrap();
        assert_eq!(decoded, ProcessStatus::Sleeping);
    }

    // @group UnitTests > Equality : Clone + PartialEq work correctly
    #[test]
    fn test_clone_and_eq() {
        let a = ProcessStatus::Crashed;
        let b = a.clone();
        assert_eq!(a, b);
        assert_ne!(a, ProcessStatus::Running);
    }
}
