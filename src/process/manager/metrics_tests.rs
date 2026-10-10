use super::{refresh_process_tree, sum_process_tree};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use sysinfo::{Pid, System};

const FIXTURE_NAME: &str = "process::manager::metrics_tests::metrics_child_fixture";
const READY_MARKER: &str = "ALTER_METRICS_CHILD_READY";

/// Own the fixture throughout every assertion so a panic cannot leave it running.
struct MetricsChild(Child);

impl MetricsChild {
    fn spawn() -> Self {
        let mut child = Self(
            Command::new(std::env::current_exe().expect("locate test executable"))
                .args(["--exact", FIXTURE_NAME, "--ignored", "--nocapture"])
                .env("ALTER_METRICS_CHILD_FIXTURE", "1")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn metrics fixture"),
        );

        let stdout = child.0.stdout.take().expect("fixture stdout is piped");
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::spawn(move || {
            // libtest can prefix the test's first output with its test name.
            let ready = BufReader::new(stdout)
                .lines()
                .any(|line| line.is_ok_and(|line| line.contains(READY_MARKER)));
            let _ = ready_tx.send(ready);
        });
        assert_eq!(
            ready_rx.recv_timeout(Duration::from_secs(10)),
            Ok(true),
            "metrics fixture did not become ready"
        );
        child
    }

    fn pid(&self) -> Pid {
        Pid::from_u32(self.0.id())
    }

    fn kill_and_wait(&mut self) {
        self.0.kill().expect("terminate metrics fixture");
        self.0.wait().expect("reap metrics fixture");
    }
}

impl Drop for MetricsChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn refresh_removes_exited_child_from_process_tree() {
    let mut child = MetricsChild::spawn();
    let child_pid = child.pid();
    let parent_pid = Pid::from_u32(std::process::id());
    let mut sys = System::new();

    let children = refresh_process_tree(&mut sys);
    let process = sys.process(child_pid).expect("live child must be sampled");
    assert_eq!(process.parent(), Some(parent_pid));
    assert!(
        process.memory() > 0,
        "live child must contribute resident memory"
    );
    assert!(children[&parent_pid].contains(&child_pid));
    assert_eq!(
        sum_process_tree(&sys, &children, child_pid),
        (process.cpu_usage(), process.memory())
    );

    child.kill_and_wait();

    // Reuse the same System: a fresh snapshot would conceal the stale-process bug.
    let children = refresh_process_tree(&mut sys);
    assert!(
        sys.process(child_pid).is_none(),
        "exited child must be removed"
    );
    assert!(children.values().all(|pids| !pids.contains(&child_pid)));
    assert_eq!(sum_process_tree(&sys, &children, child_pid), (0.0, 0));

    // Even an old edge must not contribute the exited child's cached metrics.
    let parent = sys
        .process(parent_pid)
        .expect("test process must still be alive");
    let old_edge = HashMap::from([(parent_pid, vec![child_pid])]);
    assert_eq!(
        sum_process_tree(&sys, &old_edge, parent_pid),
        (parent.cpu_usage(), parent.memory())
    );
}

#[test]
fn process_tree_counts_repeated_and_cyclic_edges_once() {
    let pid = Pid::from_u32(std::process::id());
    let mut sys = System::new();
    refresh_process_tree(&mut sys);
    let process = sys.process(pid).expect("test process must be sampled");
    let children = HashMap::from([(pid, vec![pid, pid])]);

    assert_eq!(
        sum_process_tree(&sys, &children, pid),
        (process.cpu_usage(), process.memory())
    );
}

/// A portable, long-lived child without depending on an installed shell or runtime.
#[test]
#[ignore = "subprocess fixture launched by the metrics regression test"]
fn metrics_child_fixture() {
    // Running the repository's complete ignored suite must not block on stdin.
    if std::env::var("ALTER_METRICS_CHILD_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    let resident = std::hint::black_box(vec![1u8; 4 * 1024 * 1024]);
    println!("{READY_MARKER}");
    std::io::stdout().flush().expect("flush readiness marker");
    let _ = std::io::stdin().read(&mut [0u8]);
    std::hint::black_box(resident);
}
