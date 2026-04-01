// @group BusinessLogic : `alter daemon` command handler — start/stop/status daemon

use crate::cli::args::DaemonAction;
use crate::client::daemon_client::DaemonClient;
use anyhow::Result;

pub async fn run(client: &DaemonClient, action: DaemonAction, host: &str, port: u16) -> Result<()> {
    match action {
        DaemonAction::Start { port: p } => start_daemon(host, p),
        DaemonAction::Stop => stop_daemon(client).await,
        DaemonAction::Restart => restart_daemon(client, host, port).await,
        DaemonAction::Status => status(client).await,
        DaemonAction::Logs => show_logs(),
    }
}

// @group BusinessLogic > Daemon : Spawn daemon as detached background process and wait for it to bind
fn start_daemon(host: &str, port: u16) -> Result<()> {
    // Check if a real daemon is running — TCP connect + HTTP health check.
    // A zombie socket will accept TCP but won't respond to HTTP, so we treat that as dead.
    if is_daemon_alive(host, port) {
        println!("[alter] daemon is already running on {host}:{port}");
        return Ok(());
    }

    let exe = std::env::current_exe()?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;

        std::process::Command::new(&exe)
            .arg("--internal-daemon")
            .arg("--host").arg(host)
            .arg("--port").arg(port.to_string())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn()?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(&exe)
            .arg("--internal-daemon")
            .arg("--host").arg(host)
            .arg("--port").arg(port.to_string())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
    }

    // Poll via blocking TCP — avoids any async runtime issues
    let bind_addr = format!("{host}:{port}");
    let display_host = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    for _ in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if std::net::TcpStream::connect(&bind_addr).is_ok() {
            println!("[alter] daemon started  →  http://{display_host}:{port}");
            return Ok(());
        }
    }

    eprintln!("[alter] daemon did not start within 5s. Check: {}", crate::config::paths::daemon_log_file().display());
    std::process::exit(1);
}

async fn stop_daemon(client: &DaemonClient) -> Result<()> {
    if !client.is_alive().await {
        println!("[alter] daemon is not running");
        return Ok(());
    }
    let _ = client.post("/api/v1/system/shutdown", serde_json::json!({})).await;
    println!("[alter] daemon stopped");
    Ok(())
}

// @group BusinessLogic > Daemon : Stop daemon then start it again; managed processes survive
// because runner.rs uses CREATE_BREAKAWAY_FROM_JOB on Windows.
async fn restart_daemon(client: &DaemonClient, host: &str, port: u16) -> Result<()> {
    if client.is_alive().await {
        let _ = client.post("/api/v1/system/shutdown", serde_json::json!({})).await;
        // Wait for the daemon to release the port (up to 3 s)
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if !is_daemon_alive(host, port) {
                break;
            }
        }
        println!("[alter] daemon stopped");
    }
    start_daemon(host, port)?;
    println!("[alter] daemon restarted");
    Ok(())
}

async fn status(client: &DaemonClient) -> Result<()> {
    if client.is_alive().await {
        let health = client.get("/api/v1/system/health").await?;
        println!("[alter] daemon is running");
        println!("  version:    {}", health["version"].as_str().unwrap_or("?"));
        println!("  uptime:     {}s", health["uptime_secs"].as_u64().unwrap_or(0));
        println!("  processes:  {}", health["process_count"].as_u64().unwrap_or(0));
    } else {
        println!("[alter] daemon is NOT running");
    }
    Ok(())
}

// @group Utilities : Returns true only if daemon is TCP-connectable AND responds to HTTP
fn is_daemon_alive(host: &str, port: u16) -> bool {
    use std::io::Read;
    use std::net::TcpStream;
    use std::time::Duration;

    let connect_host = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    let addr = format!("{connect_host}:{port}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_millis(300),
    ) else {
        return false; // nothing on that port
    };

    // Send a minimal HTTP GET and check for a valid response
    let req = format!("GET /api/v1/system/health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
    stream.set_read_timeout(Some(Duration::from_millis(800))).ok();
    stream.set_write_timeout(Some(Duration::from_millis(300))).ok();
    if std::io::Write::write_all(&mut stream, req.as_bytes()).is_err() {
        return false; // zombie: accepts connect but won't take data
    }
    let mut buf = [0u8; 12];
    matches!(stream.read(&mut buf), Ok(n) if n > 0 && buf.starts_with(b"HTTP/"))
}

fn show_logs() -> Result<()> {
    let path = crate::config::paths::daemon_log_file();
    if !path.exists() {
        println!("[alter] no daemon log file found at {}", path.display());
        return Ok(());
    }
    let lines = crate::logging::reader::read_last_lines(&path, 100).unwrap_or_default();
    for line in lines {
        println!("{line}");
    }
    Ok(())
}
