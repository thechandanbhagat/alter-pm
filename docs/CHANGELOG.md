# Changelog

All notable changes to alter are documented here.

Format: `[version] — YYYY-MM-DD` with sections: **Added**, **Changed**, **Fixed**, **Removed**.

---

## [0.1.0] — 2026-02-22

Initial public release.

### Added

**Core daemon**
- Background daemon with HTTP API on `127.0.0.1:2999` (configurable port)
- `SO_REUSEADDR` for instant port reclaim after restart
- CORS enabled for all origins (localhost-bound, safe by default)
- Graceful shutdown via `POST /system/shutdown` — saves state before exit
- Daemon auto-save: state persisted after every process change (atomic write)

**Process management**
- Start any executable: Python, Node.js, Go, Rust, .NET, PHP, Ruby, or any `.exe`
- On Windows: `.cmd` scripts (npm, yarn, npx, tsc) automatically wrapped in `cmd /C`
- On Windows: `CREATE_NO_WINDOW` flag — no console popup for any spawned process
- Process states: `stopped`, `starting`, `running`, `stopping`, `crashed`, `errored`, `watching`
- Stop, restart, delete processes by name or UUID
- Bulk operations: `stop all`, `restart all`, `delete all`
- Reset restart counter per process

**Auto-restart**
- Configurable auto-restart on crash (non-zero exit code)
- Exponential backoff: base delay × 2^attempt, capped at 60 seconds
- Configurable `max_restarts` limit (default: 10)
- Clean exits (code 0) do not trigger restart

**Watch mode**
- File system watching via `notify` crate
- 500ms debounce to handle burst file changes
- Configurable `watch_paths` and `watch_ignore` patterns
- Status shows as `watching` (distinct from `running`)

**Namespaces**
- Every process belongs to a namespace (default: `"default"`)
- Set via CLI `--namespace` or ecosystem config
- Used for grouping in web dashboard

**Logging**
- Per-process stdout/stderr captured to separate log files
- Size-based rotation: rotate when file exceeds `max_log_size_mb`
- Rotated copies kept: up to 5 (`.1` through `.5`)
- Date-based rotation: daily files named `out.log.YYYY-MM-DD`
- 30-day historical log retention
- `alter flush` to delete log files

**State persistence**
- `alter save` / `POST /system/save` — snapshot current process list
- `alter resurrect` / `POST /system/resurrect` — restore from snapshot
- Running processes flagged as `autorestart_on_restore = true` — restarted on resurrect
- Stopped processes registered but not auto-started

**Ecosystem config**
- TOML and JSON config files supported
- All AppConfig fields available: script, args, cwd, env, autorestart, watch, namespace, etc.
- Load via `alter start <file>.toml`

**CLI commands**
- `alter start` — start process or load ecosystem config
- `alter stop` — stop process(es)
- `alter restart` — restart process(es)
- `alter delete` — remove process(es)
- `alter list` (aliases: `ls`, `ps`) — table view of all processes
- `alter describe` — detailed process info
- `alter logs` — view or stream logs (`--follow` for real-time)
- `alter flush` — delete log files
- `alter reset` — reset restart counter
- `alter save` / `alter resurrect` — persistence
- `alter daemon start|stop|status|logs` — daemon lifecycle
- `alter web` — open dashboard in browser
- `alter startup` / `alter unstartup` — OS startup registration

**REST API**
- Full CRUD for processes: `GET/POST /processes`, `GET/PATCH/DELETE /processes/{id}`
- Process actions: `/start`, `/stop`, `/restart`, `/reset`
- Terminal launcher: `POST /processes/{id}/terminal`
- Log retrieval: `GET /processes/{id}/logs` (with `lines`, `type`, `date` query params)
- Log dates: `GET /processes/{id}/logs/dates`
- Real-time SSE log streaming: `GET /processes/{id}/logs/stream`
- System: `/health`, `/save`, `/resurrect`, `/shutdown`
- Ecosystem loader: `POST /ecosystem`

**Web dashboard**
- Embedded HTML/CSS/JS (compiled into binary, no external files)
- Process table grouped by namespace with collapse/expand
- Start All / Stop All bulk actions per namespace
- Real-time auto-refresh (3s interval, toggleable)
- "Processes" view: table with ID, name, status, PID, uptime, restarts, watch, last run
- "Start Process" view: form to launch new processes
- "Process Detail" view: full-height live log viewer with SSE streaming
- "Edit Process" view: update config and apply immediately
- Historical log date navigation (browse past days)
- Action buttons: Start, Restart, Stop, Edit, Delete, Terminal, Open in VS Code
- Sidebar: running processes list, daemon status, uptime
- Footer: Save, Shutdown, Auto-refresh toggle (SVG icons)
- Status indicators: color-coded dots per process state
- Dark theme with CSS custom properties

**Windows-specific**
- Daemon spawned with `CREATE_NO_WINDOW | DETACHED_PROCESS` — no visible process
- Terminal button: tries Windows Terminal (`wt.exe`), falls back to `cmd.exe`
- Data stored in `%APPDATA%\alter-pm2\`
- Startup: PowerShell Scheduled Task generation via `alter startup`

**Platform support**
- Windows: primary target, fully tested
- Linux/macOS: supported (terminal opens `xterm`, data in `~/.alter-pm2/`)
