// @group APIEndpoints : Port scan endpoint — lists all open TCP/UDP ports with owning process names

use axum::{extract::Path, routing::{get, post}, Json, Router};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

pub fn router() -> Router {
    Router::new()
        .route("/", get(list_ports))
        .route("/kill/{pid}", post(kill_port_process))
}

// @group Types > Ports : A single network port entry
#[derive(Serialize)]
struct PortEntry {
    port: u16,
    protocol: String,
    local_address: String,
    remote_address: String,
    state: String,
    pid: Option<u32>,
    process_name: Option<String>,
    /// Ancestor PIDs walking upward from the socket-owning process (immediate parent first).
    /// Lets the frontend match a port to its managed root process even when the socket is
    /// owned by a grandchild (e.g. alter → cmd.exe → node npm → cmd.exe → node vite).
    ancestor_pids: Vec<u32>,
}

// @group APIEndpoints > Ports : GET /ports — list all open ports with owning process names
async fn list_ports() -> Json<Value> {
    let entries = tokio::task::spawn_blocking(collect_ports)
        .await
        .unwrap_or_default();
    Json(json!({ "ports": entries }))
}

// @group BusinessLogic > Ports : Collect port entries, resolve names, and annotate ancestor chains
fn collect_ports() -> Vec<PortEntry> {
    let raw = run_netstat();
    let mut entries = parse_netstat(&raw);

    // Refresh ALL processes so we can build a complete pid→parent_pid map.
    // ProcessRefreshKind::new() gives us the minimal info (name + parent) without
    // expensive fields like memory, CPU, or environment.
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        false,
        ProcessRefreshKind::new(),
    );

    // Build name and parent maps for every process visible to sysinfo.
    let mut name_map: HashMap<u32, String> = HashMap::new();
    let mut parent_map: HashMap<u32, u32> = HashMap::new();

    for (pid, proc) in sys.processes() {
        let pid_u32 = pid.as_u32();
        name_map.insert(pid_u32, proc.name().to_string_lossy().to_string());
        if let Some(ppid) = proc.parent() {
            let ppid_u32 = ppid.as_u32();
            // Ignore self-parented (PID 0 is the idle process and wraps around on some OSes)
            if ppid_u32 != 0 && ppid_u32 != pid_u32 {
                parent_map.insert(pid_u32, ppid_u32);
            }
        }
    }

    for entry in &mut entries {
        if let Some(pid) = entry.pid {
            entry.process_name = name_map.get(&pid).cloned();
            // Walk up to 12 levels — deep enough for npm → vite → actual server chains.
            entry.ancestor_pids = ancestor_chain(pid, &parent_map, 12);
        }
    }

    // Sort by port ascending, then by protocol
    entries.sort_by(|a, b| a.port.cmp(&b.port).then(a.protocol.cmp(&b.protocol)));
    entries
}

// @group Utilities > Ports : Walk the parent chain from `start_pid` upward (max `depth` hops),
// returning ancestor PIDs in order from immediate parent toward the system root.
fn ancestor_chain(start_pid: u32, parent_map: &HashMap<u32, u32>, max_depth: usize) -> Vec<u32> {
    let mut chain = Vec::new();
    let mut current = start_pid;
    for _ in 0..max_depth {
        match parent_map.get(&current) {
            Some(&parent) => {
                chain.push(parent);
                current = parent;
            }
            None => break,
        }
    }
    chain
}

// @group Utilities > Ports : Run platform-appropriate netstat command and return raw stdout
#[cfg(windows)]
fn run_netstat() -> String {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("netstat")
        .args(["-ano"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn run_netstat() -> String {
    // Try ss first (modern Linux), fall back to netstat
    if let Ok(out) = std::process::Command::new("ss").args(["-Hntlpu"]).output() {
        if out.status.success() {
            return String::from_utf8_lossy(&out.stdout).to_string();
        }
    }
    std::process::Command::new("netstat")
        .args(["-tlnpu"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

// @group Utilities > Ports : Parse netstat/ss stdout into PortEntry list (no process names yet)
fn parse_netstat(raw: &str) -> Vec<PortEntry> {
    raw.lines()
        .filter_map(parse_line)
        .collect()
}

// @group Utilities > Ports : Parse one line of netstat output into a PortEntry
#[cfg(windows)]
fn parse_line(line: &str) -> Option<PortEntry> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    match fields.as_slice() {
        // TCP  local  remote  STATE  pid
        [proto, local, remote, state, pid_str] if proto.eq_ignore_ascii_case("TCP") => {
            let port = extract_port(local)?;
            Some(PortEntry {
                port,
                protocol: "TCP".into(),
                local_address: local.to_string(),
                remote_address: remote.to_string(),
                state: state.to_string(),
                pid: pid_str.parse().ok(),
                process_name: None,
                ancestor_pids: Vec::new(),
            })
        }
        // UDP  local  remote  pid  (no state column on Windows)
        [proto, local, remote, pid_str] if proto.eq_ignore_ascii_case("UDP") => {
            let port = extract_port(local)?;
            Some(PortEntry {
                port,
                protocol: "UDP".into(),
                local_address: local.to_string(),
                remote_address: remote.to_string(),
                state: String::new(),
                pid: pid_str.parse().ok(),
                process_name: None,
                ancestor_pids: Vec::new(),
            })
        }
        _ => None,
    }
}

#[cfg(not(windows))]
fn parse_line(line: &str) -> Option<PortEntry> {
    let fields: Vec<&str> = line.split_whitespace().collect();

    // ss -Hntlpu output: Netid  State  RecvQ  SendQ  LocalAddr:Port  PeerAddr:Port  [users:...]
    // netstat -tlnpu:    Proto  RecvQ  SendQ  Local            Foreign          State  PID/Name
    if fields.len() < 5 {
        return None;
    }

    let first = fields[0].to_ascii_lowercase();
    if first.contains("tcp") || first.contains("udp") {
        // Could be netstat or ss netid column
        if fields.len() >= 7 && first.starts_with("tcp") || first.starts_with("udp") {
            // netstat format: proto recvq sendq local remote state pid/name
            if fields[0].starts_with("tcp") || fields[0].starts_with("udp") {
                let proto = if first.contains("tcp") { "TCP" } else { "UDP" };
                let local = fields[3];
                let remote = fields[4];
                let state = fields.get(5).copied().unwrap_or("").to_string();
                let pid = fields
                    .get(6)
                    .and_then(|s| s.split('/').next())
                    .and_then(|s| s.parse::<u32>().ok());
                let port = extract_port(local)?;
                return Some(PortEntry {
                    port,
                    protocol: proto.into(),
                    local_address: local.into(),
                    remote_address: remote.into(),
                    state,
                    pid,
                    process_name: None,
                    ancestor_pids: Vec::new(),
                });
            }
        }
        // ss format: netid state recvq sendq local peer [users]
        let proto = if first.contains("tcp") { "TCP" } else { "UDP" };
        let local = fields.get(4).copied().unwrap_or("");
        let remote = fields.get(5).copied().unwrap_or("");
        let state = fields.get(1).copied().unwrap_or("").to_string();
        let pid = fields.iter().find(|f| f.starts_with("users:")).and_then(|s| {
            let start = s.find("pid=")?;
            let rest = &s[start + 4..];
            let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            rest[..end].parse::<u32>().ok()
        });
        let port = extract_port(local)?;
        Some(PortEntry {
            port,
            protocol: proto.into(),
            local_address: local.into(),
            remote_address: remote.into(),
            state,
            pid,
            process_name: None,
            ancestor_pids: Vec::new(),
        })
    } else {
        None
    }
}

// @group Utilities > Ports : Extract port number from "addr:port" or "[::1]:port"
fn extract_port(addr: &str) -> Option<u16> {
    addr.rsplit(':').next()?.parse().ok()
}

// @group APIEndpoints > Ports : POST /ports/kill/:pid — forcefully terminate a process by PID
async fn kill_port_process(Path(pid): Path<u32>) -> Json<Value> {
    // Refuse to kill PID 0 (idle) or PID 4 (Windows System) — these can't be killed anyway
    // but we guard early to return a helpful message.
    if pid == 0 {
        return Json(json!({ "success": false, "error": "Cannot kill PID 0 (idle/system)" }));
    }

    let result = tokio::task::spawn_blocking(move || kill_pid(pid)).await;
    match result {
        Ok(Ok(())) => Json(json!({ "success": true })),
        Ok(Err(msg)) => Json(json!({ "success": false, "error": msg })),
        Err(_)       => Json(json!({ "success": false, "error": "internal task panicked" })),
    }
}

// @group Utilities > Ports : Cross-platform forceful process kill by PID
fn kill_pid(pid: u32) -> Result<(), String> {
    // Use sysinfo for a cross-platform kill — TerminateProcess on Windows, SIGKILL on Unix.
    let sysinfo_pid = Pid::from_u32(pid);
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[sysinfo_pid]),
        false,
        ProcessRefreshKind::new(),
    );
    match sys.process(sysinfo_pid) {
        Some(proc) => {
            if proc.kill() {
                Ok(())
            } else {
                Err(format!("kill signal sent but process {pid} did not terminate (permission denied?)"))
            }
        }
        None => Err(format!("process {pid} not found — it may have already exited")),
    }
}
