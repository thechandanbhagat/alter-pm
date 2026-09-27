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
    let mut entries = list_sockets();

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

// @group Utilities > Ports : Run the platform's socket-listing tool and parse its output
#[cfg(windows)]
fn list_sockets() -> Vec<PortEntry> {
    use std::os::windows::process::CommandExt;
    let raw = std::process::Command::new("netstat")
        .args(["-ano"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    parse_windows_netstat(&raw)
}

#[cfg(target_os = "linux")]
fn list_sockets() -> Vec<PortEntry> {
    // ss (iproute2) ships with every modern distro; net-tools netstat is the fallback
    if let Ok(out) = std::process::Command::new("ss").args(["-Hntlpu"]).output() {
        if out.status.success() {
            return parse_ss(&String::from_utf8_lossy(&out.stdout));
        }
    }
    let raw = std::process::Command::new("netstat")
        .args(["-tlnpu"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    parse_linux_netstat(&raw)
}

#[cfg(all(unix, not(target_os = "linux")))]
fn list_sockets() -> Vec<PortEntry> {
    // macOS/BSD netstat rejects the GNU flags and has no PID column — lsof reports owners.
    // -F emits one tagged field per line (p=pid, f=fd, t=IPv4/IPv6, P=proto, n=addr, T=TCP info).
    // lsof exits 1 when nothing matches, so parse stdout regardless of status.
    let raw = std::process::Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP", "-FpftPnT"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    parse_lsof(&raw)
}

// @group Utilities > Ports : Build a PortEntry (process name and ancestors are filled in later)
fn port_entry(protocol: &str, local: &str, remote: &str, state: &str, pid: Option<u32>) -> Option<PortEntry> {
    Some(PortEntry {
        port: extract_port(local)?,
        protocol: protocol.into(),
        local_address: local.into(),
        remote_address: remote.into(),
        state: state.into(),
        pid,
        process_name: None,
        ancestor_pids: Vec::new(),
    })
}

// @group Utilities > Ports : Map a tcp/tcp6/udp/udp6 column to the protocol label
#[cfg(any(unix, test))]
fn protocol_of(field: &str) -> Option<&'static str> {
    let f = field.to_ascii_lowercase();
    if f.starts_with("tcp") {
        Some("TCP")
    } else if f.starts_with("udp") {
        Some("UDP")
    } else {
        None
    }
}

// @group Utilities > Ports : Parse Windows `netstat -ano`
//   TCP  local  remote  STATE  pid
//   UDP  local  remote  pid        (no state column)
#[cfg(any(windows, test))]
fn parse_windows_netstat(raw: &str) -> Vec<PortEntry> {
    raw.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            match fields.as_slice() {
                [proto, local, remote, state, pid] if proto.eq_ignore_ascii_case("TCP") => {
                    port_entry("TCP", local, remote, state, pid.parse().ok())
                }
                [proto, local, remote, pid] if proto.eq_ignore_ascii_case("UDP") => {
                    port_entry("UDP", local, remote, "", pid.parse().ok())
                }
                _ => None,
            }
        })
        .collect()
}

// @group Utilities > Ports : Parse Linux `ss -Hntlpu`
//   Netid State Recv-Q Send-Q Local:Port Peer:Port [users:(("name",pid=123,fd=4))]
#[cfg(any(target_os = "linux", test))]
fn parse_ss(raw: &str) -> Vec<PortEntry> {
    raw.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 6 {
                return None;
            }
            let proto = protocol_of(fields[0])?;
            // The process column may contain spaces (quoted names), so rejoin before searching
            let users = fields[6..].join(" ");
            let pid = users.find("pid=").and_then(|i| {
                let rest = &users[i + 4..];
                let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
                rest[..end].parse().ok()
            });
            port_entry(proto, fields[4], fields[5], fields[1], pid)
        })
        .collect()
}

// @group Utilities > Ports : Parse Linux net-tools `netstat -tlnpu`
//   tcp  RecvQ SendQ local remote STATE pid/name
//   udp  RecvQ SendQ local remote       pid/name   (listening UDP has no state)
#[cfg(any(target_os = "linux", test))]
fn parse_linux_netstat(raw: &str) -> Vec<PortEntry> {
    raw.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 6 {
                return None;
            }
            let proto = protocol_of(fields[0])?;
            // PID/Program is "123/name" or "-" when the socket belongs to another user
            let is_pid_col = |s: &str| s == "-" || s.contains('/');
            let (state, pid_col) = if is_pid_col(fields[5]) {
                ("", Some(fields[5]))
            } else {
                (fields[5], fields.get(6).copied())
            };
            let pid = pid_col
                .and_then(|s| s.split('/').next())
                .and_then(|s| s.parse().ok());
            port_entry(proto, fields[3], fields[4], state, pid)
        })
        .collect()
}

// @group Utilities > Ports : Parse `lsof -F` output (macOS/BSD). A `p` line starts a process,
// an `f` line starts one of its sockets; the fields that follow describe that socket.
#[cfg(any(all(unix, not(target_os = "linux")), test))]
fn parse_lsof(raw: &str) -> Vec<PortEntry> {
    #[derive(Default)]
    struct Socket {
        ipv6: bool,
        proto: String,
        name: String,
        state: String,
    }

    fn flush(entries: &mut Vec<PortEntry>, sock: &mut Socket, pid: Option<u32>) {
        let s = std::mem::take(sock);
        let Some(proto) = protocol_of(&s.proto) else { return };
        // "local->remote" for connected sockets; lsof prints "*:port" for both wildcards
        let (local, remote) = s.name.split_once("->").unwrap_or((s.name.as_str(), "*:*"));
        let local = match local.strip_prefix("*:") {
            Some(port) if s.ipv6 => format!("[::]:{port}"),
            _ => local.to_string(),
        };
        if let Some(entry) = port_entry(proto, &local, remote, &s.state, pid) {
            entries.push(entry);
        }
    }

    let mut entries = Vec::new();
    let mut pid: Option<u32> = None;
    let mut sock = Socket::default();
    for line in raw.lines() {
        let Some(tag) = line.chars().next() else { continue };
        let val = &line[tag.len_utf8()..];
        match tag {
            'p' => {
                flush(&mut entries, &mut sock, pid);
                pid = val.parse().ok();
            }
            'f' => flush(&mut entries, &mut sock, pid),
            't' => sock.ipv6 = val == "IPv6",
            'P' => sock.proto = val.to_string(),
            'n' => sock.name = val.to_string(),
            'T' => {
                if let Some(st) = val.strip_prefix("ST=") {
                    sock.state = st.to_string();
                }
            }
            _ => {}
        }
    }
    flush(&mut entries, &mut sock, pid);
    entries
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

// @group UnitTests : Socket-listing parsers for every platform (pure functions — run anywhere)
#[cfg(test)]
mod tests {
    use super::*;

    fn summary(entries: &[PortEntry]) -> Vec<(u16, &str, &str, &str, Option<u32>)> {
        entries
            .iter()
            .map(|e| (e.port, e.protocol.as_str(), e.local_address.as_str(), e.state.as_str(), e.pid))
            .collect()
    }

    // @group UnitTests > Ports > Windows : TCP rows have a state column, UDP rows do not
    #[test]
    fn test_parse_windows_netstat() {
        let raw = "\r\nActive Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n  \
            TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100\r\n  \
            TCP    [::]:2999              [::]:0                 LISTENING       4242\r\n  \
            UDP    0.0.0.0:5353           *:*                                    2044\r\n";
        assert_eq!(
            summary(&parse_windows_netstat(raw)),
            vec![
                (135, "TCP", "0.0.0.0:135", "LISTENING", Some(1100)),
                (2999, "TCP", "[::]:2999", "LISTENING", Some(4242)),
                (5353, "UDP", "0.0.0.0:5353", "", Some(2044)),
            ]
        );
    }

    // @group UnitTests > Ports > Linux : ss rows with a users column must not be read as netstat
    #[test]
    fn test_parse_ss() {
        let raw = "tcp   LISTEN 0      4096   127.0.0.53%lo:53      0.0.0.0:*    users:((\"systemd-resolve\",pid=612,fd=14))\n\
                   tcp   LISTEN 0      511    [::]:3000             [::]:*       users:((\"node\",pid=9001,fd=21),(\"node\",pid=9002,fd=21))\n\
                   tcp   LISTEN 0      128    0.0.0.0:22            0.0.0.0:*\n\
                   udp   UNCONN 0      0      0.0.0.0:5353          0.0.0.0:*    users:((\"Web Content\",pid=777,fd=3))\n";
        assert_eq!(
            summary(&parse_ss(raw)),
            vec![
                (53, "TCP", "127.0.0.53%lo:53", "LISTEN", Some(612)),
                (3000, "TCP", "[::]:3000", "LISTEN", Some(9001)),
                (22, "TCP", "0.0.0.0:22", "LISTEN", None),
                (5353, "UDP", "0.0.0.0:5353", "UNCONN", Some(777)),
            ]
        );
    }

    // @group UnitTests > Ports > Linux : net-tools netstat — UDP rows have no state column
    #[test]
    fn test_parse_linux_netstat() {
        let raw = "Active Internet connections (only servers)\n\
                   Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\n\
                   tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      812/sshd: /usr/sbin\n\
                   tcp6       0      0 :::8080                 :::*                    LISTEN      -\n\
                   udp        0      0 0.0.0.0:68              0.0.0.0:*                           640/dhclient\n";
        assert_eq!(
            summary(&parse_linux_netstat(raw)),
            vec![
                (22, "TCP", "0.0.0.0:22", "LISTEN", Some(812)),
                (8080, "TCP", ":::8080", "LISTEN", None),
                (68, "UDP", "0.0.0.0:68", "", Some(640)),
            ]
        );
    }

    // @group UnitTests > Ports > macOS : lsof -F records, IPv6 wildcard rendered as [::]
    #[test]
    fn test_parse_lsof() {
        let raw = "p654\nf9\ntIPv4\nPTCP\nn*:7000\nTST=LISTEN\nTQR=0\nTQS=0\n\
                   f10\ntIPv6\nPTCP\nn*:7000\nTST=LISTEN\nTQR=0\nTQS=0\n\
                   p662\nf19\ntIPv6\nPUDP\nn*:3722\n\
                   p714\nf7\ntIPv4\nPUDP\nn*:*\n\
                   f8\ntIPv4\nPUDP\nn127.0.0.1:5353->127.0.0.1:53\n\
                   p900\nf12\ntIPv6\nPTCP\nn[::1]:5432\nTST=LISTEN\n";
        assert_eq!(
            summary(&parse_lsof(raw)),
            vec![
                (7000, "TCP", "*:7000", "LISTEN", Some(654)),
                (7000, "TCP", "[::]:7000", "LISTEN", Some(654)),
                (3722, "UDP", "[::]:3722", "", Some(662)),
                (5353, "UDP", "127.0.0.1:5353", "", Some(714)),
                (5432, "TCP", "[::1]:5432", "LISTEN", Some(900)),
            ]
        );
        assert_eq!(parse_lsof(raw)[3].remote_address, "127.0.0.1:53");
    }
}
