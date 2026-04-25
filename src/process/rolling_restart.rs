// @group BusinessLogic > RollingRestart : Rolling restart for multi-instance process groups
//
// Algorithm:
//   For each instance i in 0..N (named "{group}-{i}"):
//     1. Stop instance i
//     2. Wait restart_delay_ms
//     3. Start a new instance i with the new config
//     4. Wait up to 10 s for it to reach Running status
//     5. Move on to i+1
//
// This ensures N-1 instances are always running during the restart cycle.

use crate::config::ecosystem::AppConfig;
use crate::models::process_status::ProcessStatus;
use crate::process::manager::ProcessManager;
use anyhow::Result;
use std::time::Duration;

/// Perform a rolling restart of all instances in a process group.
///
/// Instances are identified by the naming convention `{group_name}-0`, `{group_name}-1`, …
/// up to `instances` count (derived from `new_config.instances`).
pub async fn rolling_restart(
    manager: &ProcessManager,
    group_name: &str,
    new_config: AppConfig,
) -> Result<Vec<String>> {
    let n = new_config.instances.max(1) as usize;
    let delay = Duration::from_millis(new_config.restart_delay_ms);
    let mut restarted: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for i in 0..n {
        let inst_name = if new_config.instances <= 1 {
            group_name.to_string()
        } else {
            format!("{group_name}-{i}")
        };

        // @group BusinessLogic > RollingRestart > Stop : Find and stop the old instance
        let old_id = {
            let mut found = None;
            for entry in manager.registry.iter() {
                let p = entry.value().read().await;
                if p.config.name == inst_name {
                    found = Some(*entry.key());
                    break;
                }
            }
            found
        };

        if let Some(id) = old_id {
            if let Err(e) = manager.stop(id).await {
                errors.push(format!("{inst_name}: stop failed: {e}"));
                continue;
            }
        }

        // @group BusinessLogic > RollingRestart > Delay : Brief pause before restarting
        if !delay.is_zero() { tokio::time::sleep(delay).await; }

        // @group BusinessLogic > RollingRestart > Start : Launch new instance
        let mut inst_cfg = new_config.clone();
        inst_cfg.name = inst_name.clone();

        match manager.start(inst_cfg).await {
            Ok(_) => {
                // @group BusinessLogic > RollingRestart > Wait : Poll until Running or timeout
                wait_for_running(manager, &inst_name, Duration::from_secs(10)).await;
                restarted.push(inst_name);
            }
            Err(e) => {
                errors.push(format!("{inst_name}: start failed: {e}"));
            }
        }
    }

    if !errors.is_empty() {
        anyhow::bail!("rolling restart completed with errors: {}", errors.join("; "));
    }
    Ok(restarted)
}

// @group Utilities > RollingRestart : Poll every 200 ms until an instance is Running or timeout elapses
async fn wait_for_running(manager: &ProcessManager, name: &str, timeout: Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        for entry in manager.registry.iter() {
            let p = entry.value().read().await;
            if p.config.name == name && p.status == ProcessStatus::Running {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}
