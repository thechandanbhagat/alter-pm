// @group APIEndpoints : OS startup registration — enable/disable/status via REST

use axum::{http::StatusCode, routing::get, Json, Router};
use serde::Serialize;

const TASK_NAME: &str = "alter-daemon";

pub fn router() -> Router {
    Router::new()
        .route("/system/startup", get(get_status).post(enable).delete(disable))
}

// @group Types > Startup : Startup registration status
#[derive(Serialize)]
struct StartupStatus {
    enabled: bool,
    method: &'static str,  // "schtasks" | "systemd" | "launchd"
}

// @group APIEndpoints > Startup : GET /system/startup — is autostart enabled?
async fn get_status() -> Json<StartupStatus> {
    Json(StartupStatus { enabled: check_enabled(), method: platform_method() })
}

// @group APIEndpoints > Startup : POST /system/startup — enable autostart
async fn enable() -> StatusCode {
    match do_enable() {
        Ok(_)  => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// @group APIEndpoints > Startup : DELETE /system/startup — disable autostart
async fn disable() -> StatusCode {
    match do_disable() {
        Ok(_)  => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// @group Utilities > Startup : Detect platform registration method name
fn platform_method() -> &'static str {
    #[cfg(target_os = "windows")] { "schtasks" }
    #[cfg(target_os = "linux")]   { "systemd"  }
    #[cfg(target_os = "macos")]   { "launchd"  }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))] { "unknown" }
}

// @group Utilities > Startup : Check whether autostart is currently registered
fn check_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("schtasks")
            .args(["/query", "/tn", TASK_NAME])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("systemctl")
            .args(["--user", "is-enabled", "alter-daemon"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().unwrap_or_default();
        home.join("Library").join("LaunchAgents").join("io.alter.daemon.plist").exists()
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { false }
}

// @group Utilities > Startup : Register autostart (mirrors CLI run_startup)
fn do_enable() -> anyhow::Result<()> {
    let exe = std::env::current_exe()?.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("schtasks")
            .args(["/create", "/tn", TASK_NAME, "/tr",
                   &format!("\"{}\" daemon start", exe),
                   "/sc", "ONLOGON", "/rl", "HIGHEST", "/f"])
            .output()?;
        if !out.status.success() {
            anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr));
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::Write;
        let unit_dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("no config dir"))?
            .join("systemd").join("user");
        std::fs::create_dir_all(&unit_dir)?;
        let unit = format!(
"[Unit]\nDescription=alter process manager daemon\nAfter=default.target\n\n\
[Service]\nType=forking\nExecStart={exe} daemon start\nExecStop={exe} daemon stop\n\
Restart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n");
        std::fs::File::create(unit_dir.join("alter-daemon.service"))
            .and_then(|mut f| f.write_all(unit.as_bytes()))?;
        run_cmd("systemctl", &["--user", "daemon-reload"])?;
        run_cmd("systemctl", &["--user", "enable", "alter-daemon"])?;
    }

    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home dir"))?;
        let agents = home.join("Library").join("LaunchAgents");
        std::fs::create_dir_all(&agents)?;
        let plist_path = agents.join("io.alter.daemon.plist");
        let plist = format!(
"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \
\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\"><dict>\n\
<key>Label</key><string>io.alter.daemon</string>\n\
<key>ProgramArguments</key><array>\
<string>{exe}</string><string>daemon</string><string>start</string></array>\n\
<key>RunAtLoad</key><true/>\n\
</dict></plist>\n");
        std::fs::File::create(&plist_path)
            .and_then(|mut f| f.write_all(plist.as_bytes()))?;
        run_cmd("launchctl", &["load", plist_path.to_str().unwrap()])?;
    }

    Ok(())
}

// @group Utilities > Startup : Unregister autostart
fn do_disable() -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("schtasks")
            .args(["/delete", "/tn", TASK_NAME, "/f"])
            .output()?;
        if !out.status.success() {
            let s = String::from_utf8_lossy(&out.stderr);
            if !s.contains("cannot find") && !s.contains("does not exist") {
                anyhow::bail!("{s}");
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let _ = run_cmd("systemctl", &["--user", "disable", "--now", "alter-daemon"]);
        if let Some(d) = dirs::config_dir() {
            let _ = std::fs::remove_file(d.join("systemd").join("user").join("alter-daemon.service"));
        }
        let _ = run_cmd("systemctl", &["--user", "daemon-reload"]);
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home dir"))?;
        let plist = home.join("Library").join("LaunchAgents").join("io.alter.daemon.plist");
        let _ = run_cmd("launchctl", &["unload", plist.to_str().unwrap()]);
        let _ = std::fs::remove_file(&plist);
    }

    Ok(())
}

fn run_cmd(program: &str, args: &[&str]) -> anyhow::Result<()> {
    let s = std::process::Command::new(program).args(args).status()?;
    if !s.success() { anyhow::bail!("{program} exited with {s}") }
    Ok(())
}
