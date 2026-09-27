// @group BusinessLogic : `alter startup` / `alter unstartup` — register/remove OS-level autostart

use anyhow::{Context, Result};

#[cfg(target_os = "windows")]
const TASK_NAME: &str = "alter-daemon";

pub async fn run_startup() -> Result<()> {
    let exe_path = std::env::current_exe()
        .context("cannot resolve current executable path")?;

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let exe = exe_path.to_string_lossy().to_string();

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
        let exe = exe_path.to_string_lossy().to_string();

        // Prefer alter-gui if it lives next to alter; otherwise fall back to headless daemon.
        // `alter daemon start` forks the daemon and exits, so it needs Type=forking — with
        // Type=simple systemd treats that exit as the service ending and kills the daemon.
        let gui_exe = exe_path.with_file_name("alter-gui");
        let (service_type, exec_start, exec_stop) = if gui_exe.exists() {
            ("simple", format!("{}", gui_exe.display()), String::new())
        } else {
            ("forking", format!("{exe} daemon start"), format!("ExecStop={exe} daemon stop"))
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
Type={service_type}
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
        let label = install_launch_agent(&exe_path)?;
        println!("[alter] ✓ Registered launchd agent '{LAUNCHD_LABEL}' → {label}");
        println!("[alter]   alter will start automatically on next login.");
    }

    Ok(())
}

// @group Configuration > launchd : LaunchAgent label (macOS) — also the plist file stem
#[cfg(target_os = "macos")]
pub(crate) const LAUNCHD_LABEL: &str = "io.alter.daemon";

// @group Utilities > launchd : ~/Library/LaunchAgents/io.alter.daemon.plist
#[cfg(target_os = "macos")]
pub(crate) fn launch_agent_path() -> Result<std::path::PathBuf> {
    let home = dirs::home_dir().context("cannot find home directory")?;
    Ok(home.join("Library").join("LaunchAgents").join(format!("{LAUNCHD_LABEL}.plist")))
}

// @group BusinessLogic > launchd : Write the LaunchAgent plist and (re)load it.
// Shared by `alter startup` and POST /system/startup so both register the same agent.
// Returns a short description of what will run at login.
#[cfg(target_os = "macos")]
pub(crate) fn install_launch_agent(exe_path: &std::path::Path) -> Result<&'static str> {
    // Prefer alter-gui if it lives next to alter.
    let gui_exe = exe_path.with_file_name("alter-gui");
    let (program_args, label) = if gui_exe.exists() {
        (vec![gui_exe.display().to_string()], "alter-gui (desktop app)")
    } else {
        (
            vec![exe_path.display().to_string(), "daemon".into(), "start".into()],
            "alter daemon (headless)",
        )
    };

    let home = dirs::home_dir().context("cannot find home directory")?;
    // launchd starts agents with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so Homebrew / nvm tools
    // (node, npm, python3, …) would not be found by managed processes. Record the PATH of
    // the shell registering the agent instead — plus ALTER_PORT/ALTER_HOST so the login
    // daemon listens where this shell's `alter` commands will look for it.
    let env: Vec<(&str, String)> = ["PATH", "ALTER_PORT", "ALTER_HOST"]
        .into_iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k, v)))
        .collect();
    let plist = launchd_plist(&program_args, &home, &env);

    let plist_path = launch_agent_path()?;
    if let Some(dir) = plist_path.parent() {
        std::fs::create_dir_all(dir).context("cannot create LaunchAgents directory")?;
    }
    std::fs::write(&plist_path, plist).context("cannot write launchd plist")?;

    let plist_str = plist_path.to_string_lossy();
    // Unload first (ignoring "not loaded") so re-running replaces an already-loaded agent
    let _ = std::process::Command::new("launchctl").args(["unload", &plist_str]).output();
    run_cmd("launchctl", &["load", &plist_str])?;
    Ok(label)
}

// @group BusinessLogic > launchd : Unload and delete the LaunchAgent (no-op if absent)
#[cfg(target_os = "macos")]
pub(crate) fn uninstall_launch_agent() -> Result<bool> {
    let plist_path = launch_agent_path()?;
    if !plist_path.exists() {
        return Ok(false);
    }
    let _ = std::process::Command::new("launchctl")
        .args(["unload", &plist_path.to_string_lossy()])
        .output();
    std::fs::remove_file(&plist_path).context("cannot remove launchd plist")?;
    Ok(true)
}

// @group Utilities > launchd : Render the LaunchAgent plist
#[cfg(target_os = "macos")]
fn launchd_plist(program_args: &[String], home: &std::path::Path, env: &[(&str, String)]) -> String {
    let esc = |s: &str| {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    };
    let args_xml: String = program_args
        .iter()
        .map(|a| format!("        <string>{}</string>\n", esc(a)))
        .collect();
    let env_xml: String = env
        .iter()
        .map(|(k, v)| format!("        <key>{}</key>\n        <string>{}</string>\n", esc(k), esc(v)))
        .collect();
    let home = esc(&home.to_string_lossy());
    // AbandonProcessGroup: `alter daemon start` exits right after spawning the daemon; without
    // this launchd would kill the daemon along with the finished job's process group.
    format!(
r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
{args_xml}    </array>
    <key>EnvironmentVariables</key>
    <dict>
{env_xml}    </dict>
    <key>WorkingDirectory</key>
    <string>{home}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>AbandonProcessGroup</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{home}/Library/Logs/alter-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>{home}/Library/Logs/alter-daemon-error.log</string>
</dict>
</plist>
"#
    )
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
        if uninstall_launch_agent()? {
            println!("[alter] ✓ Removed launchd agent '{LAUNCHD_LABEL}'.");
        } else {
            println!("[alter] launchd agent '{LAUNCHD_LABEL}' was not registered.");
        }
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

// @group UnitTests : LaunchAgent plist rendering (macOS)
#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::launchd_plist;

    // @group UnitTests > launchd : Generated plist is valid and carries PATH + AbandonProcessGroup
    #[test]
    fn test_launchd_plist_is_valid() {
        let args = vec!["/Users/me/My Tools/alter".to_string(), "daemon".into(), "start".into()];
        let env = vec![("PATH", "/opt/homebrew/bin:/usr/bin&x".to_string()), ("ALTER_PORT", "3000".to_string())];
        let plist = launchd_plist(&args, std::path::Path::new("/Users/me"), &env);
        assert!(plist.contains("<key>AbandonProcessGroup</key>\n    <true/>"));
        assert!(plist.contains("<key>PATH</key>\n        <string>/opt/homebrew/bin:/usr/bin&amp;x</string>"));
        assert!(plist.contains("<key>ALTER_PORT</key>\n        <string>3000</string>"));
        assert!(plist.contains("<string>/Users/me/My Tools/alter</string>"));

        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.plist");
        std::fs::write(&file, &plist).unwrap();
        let lint = std::process::Command::new("plutil").arg("-lint").arg(&file).output().unwrap();
        assert!(lint.status.success(), "plutil: {}", String::from_utf8_lossy(&lint.stdout));
    }
}
