# CLI Reference

> Complete reference for all `alter` commands, flags, and options.

---

## Global Options

These flags apply to every command:

```
alter [OPTIONS] <COMMAND>
```

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--host <HOST>` | `ALTER_HOST` | `127.0.0.1` | Daemon host address |
| `--port <PORT>` | `ALTER_PORT` | `2999` | Daemon port |
| `--json` | — | false | Output raw JSON (useful for scripting) |
| `--no-color` | — | false | Suppress ANSI color codes |

---

## Commands

### `alter start`

Start one or more processes. Accepts either a command to run or a path to an ecosystem config file.

```
alter start <SCRIPT> [OPTIONS] [-- <ARGS>...]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<SCRIPT>` | Command to run (e.g. `python`, `node`, `go`), or path to `.toml` / `.json` ecosystem config |
| `-- <ARGS>...` | Arguments to pass to the process (everything after `--`) |

**Options:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--name <NAME>` | `-n` | derived from script | Display name for the process |
| `--cwd <PATH>` | | current dir | Working directory to run the process in |
| `--env <KEY=VAL>` | `-e` | — | Environment variable (repeatable) |
| `--autorestart` | | `true` | Auto-restart on non-zero exit code |
| `--no-autorestart` | | — | Disable auto-restart |
| `--max-restarts <N>` | | `10` | Maximum number of restart attempts |
| `--restart-delay-ms <MS>` | | `1000` | Base delay before restart (exponential backoff applied) |
| `--watch` | `-w` | `false` | Enable watch mode (restart on file changes) |
| `--watch-paths <PATHS>...` | | `[]` | Directories to watch (used with `--watch`) |
| `--namespace <NS>` | | `default` | Logical group for the process |

**Examples:**

```powershell
# Basic process
alter start python -- -m http.server 8080

# Named process
alter start node -- server.js --name api

# With working directory and env vars
alter start python --name django --cwd C:\projects\api -e DJANGO_ENV=production -- manage.py runserver

# Enable auto-restart with custom limits
alter start node --name worker --max-restarts 5 --restart-delay-ms 2000 -- worker.js

# Watch mode (restart on source file changes)
alter start go --name backend --watch --watch-paths src/ -- run main.go

# Load ecosystem config
alter start alter.config.toml
alter start alter.config.json
```

**Notes:**
- If `<SCRIPT>` ends in `.toml` or `.json`, it is treated as an ecosystem config file and all apps inside are started
- On Windows, non-`.exe` scripts are automatically wrapped in `cmd /C` to resolve `.cmd` batch files (e.g. `npm`, `yarn`, `npx`)
- Processes run without a console window — output is captured to log files and streamed to the dashboard

---

### `alter stop`

Stop a running process.

```
alter stop <TARGET>
```

| Argument | Description |
|----------|-------------|
| `<TARGET>` | Process name, UUID, or `all` to stop every process |

**Examples:**

```powershell
alter stop api
alter stop 3f2a1b4c-...    # by UUID
alter stop all              # stop every running process
```

---

### `alter restart`

Stop and immediately restart a process.

```
alter restart <TARGET>
```

| Argument | Description |
|----------|-------------|
| `<TARGET>` | Process name, UUID, or `all` |

**Examples:**

```powershell
alter restart api
alter restart all
```

---

### `alter delete`

Stop a process and remove it from the process list entirely.

```
alter delete <TARGET>
```

| Argument | Description |
|----------|-------------|
| `<TARGET>` | Process name, UUID, or `all` |

**Examples:**

```powershell
alter delete old-worker
alter delete all            # removes every process
```

> **Note:** Log files are NOT deleted. Use `alter flush` to clear logs.

---

### `alter list`

Display all managed processes in a table.

```
alter list
alter ls      # alias
alter ps      # alias
```

**Output columns:**

| Column | Description |
|--------|-------------|
| ID | Short UUID prefix |
| Name | Process display name |
| Status | `running`, `stopped`, `crashed`, `errored`, `watching`, `starting`, `stopping` |
| PID | System process ID (blank if not running) |
| Uptime | How long the process has been running |
| Restarts | Number of auto-restart attempts |
| Watch | Whether watch mode is enabled |
| Last Run | When the process was last started or stopped |

**Example:**

```
ID        NAME       STATUS     PID    UPTIME    RESTARTS  WATCH  LAST RUN
a1b2c3d4  api        running    14820  2h 5m     0         no     2h ago
e5f6a7b8  worker     stopped    —      —         3         no     10m ago
c9d0e1f2  frontend   watching   8822   45m       0         yes    45m ago
```

---

### `alter describe`

Show detailed information about a specific process.

```
alter describe <TARGET>
```

**Output includes:** name, UUID, status, PID, script, args, cwd, restarts, autorestart setting, max restarts, watch mode, namespace, created time, started time.

**Example:**

```powershell
alter describe api
```

---

### `alter logs`

View or stream log output for a process.

```
alter logs <TARGET> [OPTIONS]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--lines <N>` | `-l` | `50` | Number of lines to display |
| `--follow` | `-f` | false | Stream logs in real time (Ctrl+C to stop) |
| `--err` | | false | Show stderr instead of stdout |

**Examples:**

```powershell
# Last 50 lines of stdout
alter logs api

# Last 200 lines
alter logs api --lines 200

# Stream in real time
alter logs api --follow

# View stderr
alter logs api --err

# Combine
alter logs api --follow --err
```

---

### `alter flush`

Delete log files for one or all processes.

```
alter flush [TARGET]
```

| Argument | Description |
|----------|-------------|
| `[TARGET]` | Process name, UUID, or `all` (default: all) |

**Examples:**

```powershell
alter flush api       # delete logs for "api"
alter flush all       # delete logs for every process
alter flush           # same as "all"
```

> This only deletes log files on disk. The process itself is not affected.

---

### `alter reset`

Reset the restart counter for a process to zero.

```
alter reset <TARGET>
```

**Examples:**

```powershell
alter reset api
```

> Useful after fixing a crash — prevents the process from hitting `max_restarts` prematurely.

---

### `alter save`

Persist the current process list to disk.

```
alter save
```

Saves all processes (running and stopped) to `%APPDATA%\alter-pm2\state.json` (Windows) or `~/.alter-pm2/state.json` (Linux/macOS).

The saved state records:
- Process config (name, script, args, cwd, env, etc.)
- Restart count
- Whether the process was running at save time (for `resurrect`)

> State is also auto-saved after every process change (start, stop, restart, delete, edit).

---

### `alter resurrect`

Restore the process list from the last saved state.

```
alter resurrect
```

- Processes that were **running** when saved are automatically restarted
- Processes that were **stopped** are registered in the list but not started (you can start them manually or from the dashboard)

**Typical usage (after reboot):**

```powershell
alter daemon start
alter resurrect
```

---

### `alter daemon`

Manage the background daemon process.

```
alter daemon <ACTION>
```

| Action | Description |
|--------|-------------|
| `start [--port <P>]` | Start the daemon in the background |
| `stop` | Stop the running daemon |
| `status` | Check if the daemon is running |
| `logs` | View the daemon's own log output |

**Examples:**

```powershell
# Start daemon on default port (2999)
alter daemon start

# Start on a custom port
alter daemon start --port 3100

# Check if it's running
alter daemon status

# View daemon internal logs
alter daemon logs

# Stop the daemon (saves state first)
alter daemon stop
```

**How it works:**

On Windows, the daemon starts as a completely hidden background process (no taskbar entry, no console window). It binds to `127.0.0.1:2999` and serves both the REST API and the web dashboard.

---

### `alter web`

Open the web dashboard in the default browser.

```
alter web
```

Navigates to `http://127.0.0.1:2999/`. Requires the daemon to be running.

---

### `alter startup`

Generate instructions or commands to run the daemon automatically at system startup.

```
alter startup
alter unstartup
```

**Windows:**
Outputs a PowerShell command to register a Scheduled Task that starts the daemon at login. Run the printed command in an elevated PowerShell prompt.

**Linux:**
Outputs a systemd unit file template. Copy to `/etc/systemd/system/alter.service` and run `sudo systemctl enable --now alter`.

**macOS:**
Shows instructions for adding the daemon start command to your shell profile.

`alter unstartup` removes the registered startup task.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error (daemon not running, process not found, etc.) |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALTER_HOST` | `127.0.0.1` | Daemon host (overrides `--host`) |
| `ALTER_PORT` | `2999` | Daemon port (overrides `--port`) |

---

## Tips

**Target resolution:** Most commands accept a process name, a full UUID, or a UUID prefix (first 8 characters). For bulk operations, use `all`.

**Windows `.cmd` scripts:** Tools like `npm`, `yarn`, `npx`, `tsc`, and `nodemon` are batch scripts on Windows. alter automatically wraps them in `cmd /C`, so you can use them directly:

```powershell
alter start npm -- run start --name my-app
alter start npx -- nodemon index.js --name dev-server
```

**JSON output for scripting:**

```powershell
alter list --json | ConvertFrom-Json
alter logs api --json
```
