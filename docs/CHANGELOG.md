# Changelog

All notable changes to alter are documented here.

Format: `[version] — YYYY-MM-DD` with sections: **Added**, **Changed**, **Fixed**, **Removed**.

---

## [1.1.0] — 2026-04-10

### Added

**Multi-Provider AI Assistant**
- AI chat panel now supports four providers: Ollama (local), GitHub Models, Anthropic Claude, and OpenAI-compatible APIs (Groq, Together, local vLLM, etc.)
- New `provider` field in AI settings selects active backend; each provider's credentials stored independently
- Ollama: configurable base URL (`http://localhost:11434` default); no API key required
- Claude: Anthropic API key stored in `ai-settings.json`; key hint masked in API responses
- OpenAI-compatible: configurable API key and base URL (`https://api.openai.com/v1` default)
- Optional `GH_OAUTH_CLIENT_ID` env var baked in at compile time via `build.rs` — removes need for users to supply their own OAuth App Client ID
- Updated `GET/PUT /api/v1/ai/settings` to expose per-provider fields

**Process Enable/Disable**
- New `enabled` boolean flag per process — disabled processes are excluded from Start All
- `PATCH /api/v1/processes/:id/enabled` — toggle enabled state; state persisted to disk
- Card and table views dim disabled processes with visual indicator (Power/PowerOff icons)
- `enabled` flag preserved by clone and update operations; defaults to `true` for backward compatibility

**Terminal Command History**
- `GET /api/v1/terminal-history/:key` and `PUT /api/v1/terminal-history/:key` — per-process terminal history API
- History persisted to `%APPDATA%\alter-pm2\terminal-history.json` across daemon restarts
- Deduplication and frequency tracking per command

**Daemon-side UI Settings**
- `GET /api/v1/ui-settings` and `PUT /api/v1/ui-settings` — store UI preferences on the daemon
- `GET/PUT /api/v1/ui-settings/view-mode` — view mode (table/card) now persisted server-side
- Settings stored in `%APPDATA%\alter-pm2\ui-settings.json`

**Sidebar Namespace Groups**
- Active process sidebar now groups processes by namespace with collapsible sections
- Bulk Stop All / Restart All actions available per namespace group in the sidebar
- Default namespace always shown first; count badge reflects total active processes

### Changed

- AI Panel revamped with provider-selector tabs and per-provider configuration forms
- Settings → AI tab updated for multi-provider layout
- `ProcessInfo` and `ProcessConfig` models gain `enabled` field
- View mode preference migrated from `localStorage` to daemon-side UI settings
- Terminal Panel resize and keyboard shortcut handling improved
- Sidebar process list refactored into `SidebarNsGroup` component

---

## [0.6.0] — 2026-03-11

### Added

**Dashboard Authentication**
- Password-protected web dashboard — Argon2id hashing, minimum 8-character password
- Session tokens (24 h expiry) accepted via `Authorization: Bearer` header or `?token=` query param (for SSE streams)
- PIN quick-unlock: set a 4 or 6-digit PIN from Settings → Security for faster re-authentication
- Auto-lock timeout configurable in minutes from Settings → Security
- Change-password flow (requires current password)
- Master CLI token — persistent token stored in `auth.json`, read by the CLI only, never returned to the browser
- Login / Setup page in the web UI — first launch shows a setup wizard; subsequent visits show the login form
- Auth middleware protecting all API routes when a password is configured
- Passkey / WebAuthn stubs (endpoints registered; return "not supported" until a full WebAuthn backend is wired up)
- New REST API: `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`, `POST /api/v1/auth/login`, `POST /api/v1/auth/pin/login`, `DELETE /api/v1/auth/session`, `POST /api/v1/auth/change-password`, `POST/DELETE /api/v1/auth/pin`, `PATCH /api/v1/auth/settings`
- Settings stored in `%APPDATA%\alter-pm2\auth.json`

**Telegram Bot**
- Long-polling Telegram bot — create a bot with @BotFather, paste the token into Settings → Telegram, and the daemon starts polling automatically
- Bot commands: `/ping`, `/help`, `/list`, `/status <name>`, `/start <name>`, `/stop <name>`, `/restart <name>`, `/logs <name> [lines]`
- Allowed-chat-IDs whitelist — restrict which Telegram chats/users can issue commands; checks both `chat_id` and `sender_id`
- Push notifications: configurable per-event toggles (`on_crash`, `on_restart`, `on_start`, `on_stop`) sent as formatted Telegram messages
- New REST API: `GET/PUT /api/v1/telegram`, `POST /api/v1/telegram/test`, `GET /api/v1/telegram/botinfo`
- Settings stored in `%APPDATA%\alter-pm2\telegram.json`

**Daemon Self-Restart**
- `POST /api/v1/system/restart` — saves state, spawns a detached watcher that re-launches the daemon after 1 s, then exits cleanly; managed processes survive because they run outside the daemon job object

### Removed

- WinGet manifests for versions 0.1.0–0.4.0 removed from the repository (canonical source is the winget-pkgs catalogue)

---

## [0.5.0] — 2026-03-07

### Added

**AI Assistant**
- Built-in AI chat panel powered by [GitHub Models](https://github.com/marketplace/models) — slide-in panel accessible from the sidebar
- GitHub OAuth Device Flow sign-in — no API keys needed; authenticate with your GitHub account from the Settings page
- Dynamic model catalog fetched from GitHub Models API; fallback list when unauthenticated
- Streaming SSE responses (token-by-token) for low-latency chat
- Process-aware context: when opened from a process detail view, the AI receives the last 200 log lines and process metadata
- Global context: when no process is selected, a summary of all running / stopped processes is injected
- AI settings section in Settings page: toggle enable/disable, pick model, configure OAuth App Client ID, GitHub sign-in/disconnect
- New REST API: `GET/PUT /api/v1/ai/settings`, `POST /api/v1/ai/chat`, `POST /api/v1/ai/auth/start`, `GET /api/v1/ai/auth/status`, `DELETE /api/v1/ai/auth`, `GET /api/v1/ai/models`
- Settings stored in `%APPDATA%\alter-pm2\ai-settings.json`

**Port Finder**
- New **Port Finder** page listing all open TCP/UDP ports with owning process names, PIDs, connection state, and addresses
- Search/filter by port, process name, or address; toggle by protocol (TCP/UDP) and state (Listening/Established)
- Kill any process by PID directly from the page (inline confirmation)
- Deep process-tree resolution: ports owned by grandchild processes are traced back to their managed root via ancestor PID chains
- Process table now shows active listening ports inline under each process PID
- New REST API: `GET /api/v1/ports`, `POST /api/v1/ports/kill/{pid}`

**Shared Notification Modals**
- `NotifModal.tsx` extracted as a shared component — `ProcessNotifModal` and `NsNotifModal` are reusable from both `ProcessesPage` and `CronJobsPage`

### Changed

- Cron Jobs table uses namespace-grouped layout matching the Processes page; compact icon-only action buttons
- Status column moved before Next Run in the Cron Jobs table
- `vite.config.ts` dev-proxy target corrected from `:3999` → `:2999`

---

## [0.4.0] — 2026-03-02

### Added

- Multi-file `.env` editor in the web dashboard — view, create, and edit env files per process without leaving the UI
- Cron event notifications — `CronRun` and `CronFailed` events flow through the Slack/Discord/Teams/Webhook notification system
- Stable process UUIDs derived from process name — IDs persist across daemon restarts
- Log viewer: `--out` (stdout/stderr filter) and `--grep` CLI flags; per-stream dropdown, full-text search, and timestamp toggle in the web UI
- Per-process and per-namespace notification modals accessible via the bell icon in the process table
- Restart All button on the Processes page header
- Linux `.deb` packages for `amd64` and `arm64`; APT repository on GitHub Pages
- New REST API: `GET/PUT /api/v1/processes/:id/env-files/:name`, `GET /api/v1/system/browse`, `GET /api/v1/system/check-env`

### Changed

- Version bumped `0.3.0` → `0.4.0`

---

## [0.3.0] — 2026-02-28

### Added

**Notifications**
- Webhook, Slack, and Microsoft Teams notification channels
- Per-process, per-namespace, and global notification scopes (process → namespace → global cascade)
- Configurable event triggers: `on_start`, `on_stop`, `on_crash`, `on_restart`
- Discord rich-embed notification channel
- Test endpoint to fire a notification without a real process event
- Notifications config persisted to `%APPDATA%\alter-pm2\notifications.json`
- REST API: `GET /notifications`, `PUT /notifications/global`, `PUT/DELETE /notifications/namespace/{ns}`, `POST /notifications/test`

**Web Dashboard**
- Global keyboard shortcuts (fire only when not focused in a form field):
  - `r` — reload / refresh process list
  - `n` — navigate to Start New Process
  - `?` — open keyboard shortcut help
  - `g` chord: press `g` then a second key within 1s to navigate: `g p` → Processes, `g h` → Home, `g s` → Settings, `g n` → Start, `g c` → Cron Jobs
- In-app activity tray for live notification event feed

**Health checks**
- HTTP probe: GET to `health_check_url`, passes on 2xx response
- TCP probe: connect to `host:port`, passes on successful connection
- Configurable `health_check_interval_secs` (default 30), `health_check_timeout_secs` (default 5), `health_check_retries` (default 3)
- Fires a `Crashed` notification when consecutive failures exceed `health_check_retries`
- Health status recovers automatically when probes succeed again
- Probe loop is aborted cleanly when the process is stopped

**Lifecycle hooks**
- `pre_start`: shell command run before spawning — failure aborts the launch
- `post_start`: shell command run after process reaches running state — non-blocking, failures logged
- `pre_stop`: shell command run before killing the process — failures logged, kill proceeds anyway
- Windows: hooks run via `cmd /C`; Linux/macOS via `sh -c`

**`.env` file support**
- `env_file` field in ecosystem config and API — path to a `.env` file (relative to `cwd` or absolute)
- Variables merged with explicit `env` — explicit `env` wins on conflict
- Missing file logs a warning and continues without error
- Applied at every spawn (initial start, restart, cron trigger)

**Prometheus metrics**
- `GET /api/v1/metrics` — standard Prometheus text exposition format
- Metrics: `alter_process_cpu_percent`, `alter_process_memory_bytes`, `alter_process_restart_count`, `alter_process_uptime_seconds`, `alter_process_status`, `alter_daemon_uptime_seconds`, `alter_daemon_process_count`
- All process metrics labelled with `name` and `namespace`

**Coming in a future release** *(code committed, not yet active in the binary)*
- Dependency resolution: `depends_on` — wait for upstream processes to be running/healthy before starting
- Rolling restart: zero-downtime restart for multi-instance processes

### Changed

- Version bumped `0.2.0` → `0.3.0`
- Package description updated to "A process manager for your developers"

---

## [0.2.0] — 2026-02-24

### Added

**Analytics & resource monitoring**
- Real-time CPU and memory tracking per process via `sysinfo`
- `cpu_percent` and `memory_bytes` fields added to process API response object
- Analytics page is now the root (`/`) — process list moved to `/processes`
- Process and cron tables show live CPU % and memory usage columns

**Cron jobs**
- Dedicated Cron Jobs page at `/cron-jobs`
- Cron schedule display with next-run time and run history per job

**Web dashboard polish**
- Sidebar header status indicator and settings page layout improvements
- Navigation and auto-refresh refinements

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
