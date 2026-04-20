// @group BusinessLogic : `alter startup` / `alter unstartup` — register/remove OS-level autostart

use anyhow::{Context, Result};

const TASK_NAME: &str = "alter-daemon";

pub async fn run_startup() -> Result<()> {
    let exe_path = std::env::current_exe()
        .context("cannot resolve current executable path")?;
    let exe = exe_path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        // Prefer alter-gui.exe (Tauri desktop app) when it lives next to alter.exe.
        // The GUI binary auto-starts the daemon internally — no extra args required.
        // Fall back to the headless daemon command if the GUI binary is absent.
        let gui_exe = exe_path.with_file_name("alter-gui.exe");
        let (tr_arg, label) = if gui_exe.exists() {
            (format!("\"{}\"", gui_exe.display()), "alter-gui (desktop app)")
        } else {
            (format!("\"{}\" daemon start", exe), "alter daemon (headless)")
        };

        // Use schtasks — available on every Windows version, no elevation required for /sc ONLOGON /ru ""
        let output = Command::new("schtasks")
            .args([
                "/create",
                "/tn",  TASK_NAME,
                "/tr",  &tr_arg,
                "/sc",  "ONLOGON",
                "/rl",  "HIGHEST",
                "/f",   // overwrite if already exists
            ])
            .output()
            .context("failed to run schtasks")?;

        if output.status.success() {
            println!("[alter] ✓ Registered startup task '{TASK_NAME}' → {label}");
            println!("[alter]   alter will start automatically on next login.");
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("schtasks failed: {stderr}");
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::Write;

        // Prefer alter-gui if it lives next to alter; otherwise fall back to headless daemon.
        let gui_exe = exe_path.with_file_name("alter-gui");
        let (exec_start, exec_stop) = if gui_exe.exists() {
            (format!("{}", gui_exe.display()), String::new())
        } else {
            (format!("{exe} daemon start"), format!("ExecStop={exe} daemon stop"))
        };

        // User-level systemd service — no root required
        let config_dir = dirs::config_dir()
            .context("cannot find config directory")?;
        let unit_dir = config_dir.join("systemd").join("user");
        std::fs::create_dir_all(&unit_dir)
            .context("cannot create systemd user unit directory")?;

        let unit_path = unit_dir.join("alter-daemon.service");
        let unit_content = format!(
r#"[Unit]
Description=alter process manager
After=default.target

[Service]
Type=simple
ExecStart={exec_start}
{exec_stop}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
"#);

        std::fs::File::create(&unit_path)
            .and_then(|mut f| f.write_all(unit_content.as_bytes()))
            .context("cannot write systemd unit file")?;

        run_cmd("systemctl", &["--user", "daemon-reload"])?;
        run_cmd("systemctl", &["--user", "enable", "alter-daemon"])?;
        println!("[alter] ✓ Enabled alter-daemon.service for current user.");
        println!("[alter]   Run `systemctl --user start alter-daemon` to start immediately.");
    }

    #[cfg(target_os = "macos")]
    {
        use std::io::Write;

        // Prefer alter-gui if it lives next to alter.
        let gui_exe = exe_path.with_file_name("alter-gui");
        let program_arguments = if gui_exe.exists() {
            format!("        <string>{}</string>", gui_exe.display())
        } else {
            format!(
                "        <string>{exe}</string>\n        <string>daemon</string>\n        <string>start</string>"
            )
        };

        let home = dirs::home_dir().context("cannot find home directory")?;
        let agents_dir = home.join("Library").join("LaunchAgents");
        std::fs::create_dir_all(&agents_dir)
            .context("cannot create LaunchAgents directory")?;

        let plist_path = agents_dir.join("io.alter.daemon.plist");
        let plist = format!(
r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.alter.daemon</string>
    <key>ProgramArguments</key>
    <array>
{program_arguments}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>{home}/Library/Logs/alter-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>{home}/Library/Logs/alter-daemon-error.log</string>
</dict>
</plist>
"#,
            home = home.display(),
        );

        std::fs::File::create(&plist_path)
            .and_then(|mut f| f.write_all(plist.as_bytes()))
            .context("cannot write launchd plist")?;

        run_cmd("launchctl", &["load", plist_path.to_str().unwrap()])?;
        println!("[alter] ✓ Registered launchd agent — alter will start on next login.");
    }

    Ok(())
}

pub async fn run_unstartup() -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let output = Command::new("schtasks")
            .args(["/delete", "/tn", TASK_NAME, "/f"])
            .output()
            .context("failed to run schtasks")?;

        if output.status.success() {
            println!("[alter] ✓ Removed startup task '{TASK_NAME}'.");
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Task not found is not a hard error
            if stderr.contains("cannot find") || stderr.contains("does not exist") {
                println!("[alter] Startup task '{TASK_NAME}' was not registered.");
            } else {
                anyhow::bail!("schtasks failed: {stderr}");
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        run_cmd("systemctl", &["--user", "disable", "--now", "alter-daemon"])?;
        let config_dir = dirs::config_dir().context("cannot find config directory")?;
        let unit_path = config_dir.join("systemd").join("user").join("alter-daemon.service");
        let _ = std::fs::remove_file(&unit_path);
        run_cmd("systemctl", &["--user", "daemon-reload"])?;
        println!("[alter] ✓ Disabled and removed alter-daemon.service.");
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().context("cannot find home directory")?;
        let plist_path = home.join("Library").join("LaunchAgents").join("io.alter.daemon.plist");
        let _ = run_cmd("launchctl", &["unload", plist_path.to_str().unwrap()]);
        let _ = std::fs::remove_file(&plist_path);
        println!("[alter] ✓ Removed launchd agent.");
    }

    Ok(())
}

// @group Utilities : Run a system command, returning an error if it exits non-zero
#[allow(dead_code)]
fn run_cmd(program: &str, args: &[&str]) -> Result<()> {
    let status = std::process::Command::new(program)
        .args(args)
        .status()
        .with_context(|| format!("failed to run {program}"))?;
    if !status.success() {
        anyhow::bail!("{program} exited with {status}");
    }
    Ok(())
}
