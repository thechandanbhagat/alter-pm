// @group Types : Point-in-time CPU + memory snapshot recorded by the metrics sampler

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// @group Types > MetricSample : Single sampled data point for a running process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricSample {
    /// When this sample was taken (UTC)
    pub timestamp: DateTime<Utc>,
    /// CPU usage percentage (0–100 per core)
    pub cpu_percent: f32,
    /// Resident memory in bytes
    pub memory_bytes: u64,
}
