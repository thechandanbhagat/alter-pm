# REST API Reference

> The alter daemon exposes a full HTTP REST API on `http://127.0.0.1:2999/api/v1`.
> All request and response bodies use JSON. All endpoints return standard HTTP status codes.

---

## Base URL

```
http://127.0.0.1:2999/api/v1
```

The host and port can be changed when starting the daemon (`alter daemon start --port 3100`).

---

## Authentication

No authentication by default. The API binds to `127.0.0.1` (loopback only) and is not exposed to the network.

---

## Common Response Formats

**Success:**
```json
{ "success": true, "message": "..." }
```

**Error:**
```json
{ "error": "process not found: my-app" }
```

**Process object** (returned by most process endpoints):
```json
{
  "id": "3f2a1b4c-5d6e-7f8a-9b0c-1d2e3f4a5b6c",
  "name": "api",
  "script": "python",
  "args": ["-m", "uvicorn", "main:app"],
  "cwd": "C:\\projects\\api",
  "status": "running",
  "pid": 14820,
  "restart_count": 0,
  "uptime_secs": 7532,
  "last_exit_code": null,
  "autorestart": true,
  "max_restarts": 10,
  "watch": false,
  "namespace": "web",
  "cpu_percent": 1.4,
  "memory_bytes": 52428800,
  "env": { "PORT": "8000" },
  "notify": null,
  "created_at": "2026-02-22T09:00:00Z",
  "started_at": "2026-02-22T09:00:00Z",
  "stopped_at": null
}
```

> `cpu_percent` and `memory_bytes` are `null` when the process is not running. `notify` holds a per-process notification config override (see [Notification Endpoints](#notification-endpoints)).

---

## Process Endpoints

### `GET /processes`

List all managed processes.

**Response:**
```json
{
  "processes": [ /* array of process objects */ ]
}
```

---

### `POST /processes`

Start a new process.

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `script` | string | **yes** | — | Executable to run |
| `name` | string | no | derived from script | Display name |
| `args` | string[] | no | `[]` | Arguments |
| `cwd` | string | no | null | Working directory |
| `env` | object | no | `{}` | Environment variables |
| `autorestart` | bool | no | `true` | Restart on crash |
| `max_restarts` | number | no | `10` | Max restart attempts |
| `restart_delay_ms` | number | no | `1000` | Base restart delay (ms) |
| `namespace` | string | no | `"default"` | Process group |
| `watch` | bool | no | `false` | Enable watch mode |
| `watch_paths` | string[] | no | `[]` | Paths to watch |
| `watch_ignore` | string[] | no | `[]` | Patterns to ignore |
| `max_log_size_mb` | number | no | `10` | Log rotation threshold |

**Example:**
```json
POST /api/v1/processes
{
  "script": "python",
  "name": "api",
  "args": ["-m", "uvicorn", "main:app", "--port", "8000"],
  "cwd": "C:\\projects\\api",
  "env": { "PORT": "8000" },
  "autorestart": true,
  "namespace": "web"
}
```

**Response:** `201 Created` — the newly created process object.

---

### `GET /processes/{id}`

Get a single process by UUID or name.

```
GET /api/v1/processes/api
GET /api/v1/processes/3f2a1b4c-5d6e-7f8a-9b0c-1d2e3f4a5b6c
```

**Response:** process object.

---

### `PATCH /processes/{id}`

Update a process's configuration and apply immediately. The process is restarted with the new config.

**Request body:** same fields as `POST /processes` (all optional except `script`). Omitted fields preserve their current values.

**Example:**
```json
PATCH /api/v1/processes/api
{
  "script": "python",
  "args": ["-m", "uvicorn", "main:app", "--port", "9000"],
  "env": { "PORT": "9000" }
}
```

**Response:** updated process object.

---

### `DELETE /processes/{id}`

Stop and permanently remove a process from the registry.

```
DELETE /api/v1/processes/api
```

**Response:**
```json
{ "success": true, "message": "process deleted" }
```

> Log files are NOT deleted. Use `DELETE /processes/{id}/logs` to clear them.

---

### `POST /processes/{id}/start`

Start a stopped process.

```
POST /api/v1/processes/api/start
```

**Response:** process object (status will be `running` or `starting`).

---

### `POST /processes/{id}/stop`

Stop a running process.

```
POST /api/v1/processes/api/stop
```

**Response:** process object (status will be `stopped` or `stopping`).

---

### `POST /processes/{id}/restart`

Stop and immediately restart a process.

```
POST /api/v1/processes/api/restart
```

**Response:** process object.

---

### `POST /processes/{id}/reset`

Reset the restart counter to zero.

```
POST /api/v1/processes/api/reset
```

**Response:** process object with `restart_count: 0`.

---

### `POST /processes/{id}/terminal`

Open a terminal window in the process's working directory.

```
POST /api/v1/processes/api/terminal
```

**Behavior:**
- **Windows:** Tries Windows Terminal (`wt --startingDirectory <cwd>`), falls back to `start cmd.exe`
- **Linux/macOS:** Opens `xterm` in the working directory

**Response:**
```json
{ "success": true, "message": "terminal opened" }
```

---

## Log Endpoints

### `GET /processes/{id}/logs`

Retrieve historical log lines from disk.

**Query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `lines` | `100` | Number of lines to return |
| `type` | `all` | Stream filter: `all`, `stdout`, or `stderr` |
| `date` | latest | Historical date in `YYYY-MM-DD` format |

**Examples:**
```
GET /api/v1/processes/api/logs
GET /api/v1/processes/api/logs?lines=500
GET /api/v1/processes/api/logs?type=stderr
GET /api/v1/processes/api/logs?date=2026-02-20&lines=200
```

**Response:**
```json
{
  "lines": [
    { "stream": "stdout", "content": "Server started on port 8000" },
    { "stream": "stderr", "content": "WARNING: debug mode enabled" }
  ]
}
```

---

### `GET /processes/{id}/logs/dates`

List available historical log dates for a process.

```
GET /api/v1/processes/api/logs/dates
```

**Response:**
```json
{
  "dates": ["2026-02-20", "2026-02-21", "2026-02-22"]
}
```

Dates are returned in ascending order. Use a date from this list as the `date` query parameter in `GET /processes/{id}/logs`.

---

### `GET /processes/{id}/logs/stream`

Stream log lines in real time using **Server-Sent Events (SSE)**.

```
GET /api/v1/processes/api/logs/stream
```

**Connection:** Keep-alive, `text/event-stream`

**Event data format:**
```json
{
  "timestamp": "2026-02-22T10:30:00.123Z",
  "stream": "stdout",
  "content": "Handling GET /health"
}
```

**Keepalive:** A comment event (`: keepalive`) is sent every 15 seconds to detect dead connections.

**Client example (JavaScript):**
```javascript
const es = new EventSource('/api/v1/processes/api/logs/stream');
es.onmessage = (e) => {
  const line = JSON.parse(e.data);
  console.log(`[${line.stream}] ${line.content}`);
};
```

---

## System Endpoints

### `GET /system/health`

Check daemon status. Use this to detect if the daemon is running.

```
GET /api/v1/system/health
```

**Response:**
```json
{
  "status": "ok",
  "version": "0.3.0",
  "uptime_secs": 3600,
  "process_count": 5
}
```

---

### `POST /system/save`

Persist the current process list to disk.

```
POST /api/v1/system/save
```

**Response:**
```json
{ "success": true, "message": "state saved" }
```

---

### `POST /system/resurrect`

Restore processes from the last saved state file.

```
POST /api/v1/system/resurrect
```

**Response:**
```json
{ "success": true, "message": "restored 5 processes" }
```

---

### `POST /system/shutdown`

Gracefully shut down the daemon. Saves state before exiting.

```
POST /api/v1/system/shutdown
```

**Response:**
```json
{ "success": true, "message": "daemon shutting down" }
```

> The daemon saves state and exits after a 200ms delay. The response is returned before shutdown completes.

---

## Ecosystem Endpoint

### `POST /ecosystem`

Load an ecosystem config file and start all apps defined in it.

```
POST /api/v1/ecosystem
{
  "path": "C:\\projects\\alter.config.toml"
}
```

**Response:**
```json
{ "success": true, "message": "loaded 3 apps" }
```

---

## Notification Endpoints

Notification settings are stored at `%APPDATA%\alter-pm2\notifications.json` and survive daemon restarts.

**NotificationConfig object:**
```json
{
  "webhook": { "url": "https://example.com/hook", "enabled": true },
  "slack":   { "webhook_url": "https://hooks.slack.com/...", "enabled": true, "channel": "#alerts" },
  "teams":   { "webhook_url": "https://outlook.office.com/...", "enabled": false },
  "events":  { "on_crash": true, "on_restart": true, "on_start": false, "on_stop": false }
}
```

> All channel fields are optional — omit any you don't need. `channel` on Slack overrides the webhook's default channel.

---

### `GET /notifications`

Return the full notifications store (global config + all namespace overrides).

```
GET /api/v1/notifications
```

**Response:**
```json
{
  "global": { /* NotificationConfig */ },
  "namespaces": {
    "web": { /* NotificationConfig */ }
  }
}
```

---

### `PUT /notifications/global`

Update the global notification config. Applies to all processes not overridden at namespace or process level.

```
PUT /api/v1/notifications/global
{ /* NotificationConfig */ }
```

**Response:**
```json
{ "success": true, "message": "global notifications updated" }
```

---

### `PUT /notifications/namespace/{ns}`

Set a notification config override for a specific namespace. Takes priority over global for all processes in that namespace.

```
PUT /api/v1/notifications/namespace/web
{ /* NotificationConfig */ }
```

**Response:**
```json
{ "success": true, "message": "namespace 'web' notifications updated" }
```

---

### `DELETE /notifications/namespace/{ns}`

Remove the namespace notification override (falls back to global config).

```
DELETE /api/v1/notifications/namespace/web
```

**Response:**
```json
{ "success": true, "message": "namespace 'web' removed" }
```

---

### `POST /notifications/test`

Fire a test notification using the provided config without affecting any real process. Useful for verifying webhook URLs and credentials.

```
POST /api/v1/notifications/test
{ /* NotificationConfig */ }
```

**Response:**
```json
{ "success": true, "message": "test notification dispatched" }
```

**Config cascade priority:** process-level `notify` → namespace config → global config. The first non-null value per channel wins.

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200 OK` | Successful GET, POST (non-create) |
| `201 Created` | Process created (POST /processes) |
| `400 Bad Request` | Invalid request body or parameters |
| `404 Not Found` | Process not found |
| `500 Internal Server Error` | Unexpected server error |

---

## CORS

The API allows cross-origin requests from any origin. All HTTP methods and headers are permitted.

---

## Scripting Examples

**PowerShell:**
```powershell
# Start a process
Invoke-RestMethod -Uri "http://localhost:2999/api/v1/processes" `
  -Method POST -ContentType "application/json" `
  -Body '{"script":"python","name":"api","args":["-m","http.server","8080"]}'

# List processes
Invoke-RestMethod -Uri "http://localhost:2999/api/v1/processes"

# Stop a process
Invoke-RestMethod -Uri "http://localhost:2999/api/v1/processes/api/stop" -Method POST

# Health check
Invoke-RestMethod -Uri "http://localhost:2999/api/v1/system/health"
```

**curl:**
```bash
# List processes
curl http://localhost:2999/api/v1/processes

# Start a process
curl -X POST http://localhost:2999/api/v1/processes \
  -H "Content-Type: application/json" \
  -d '{"script":"python","name":"api","args":["-m","http.server","8080"]}'

# Stream logs
curl -N http://localhost:2999/api/v1/processes/api/logs/stream
```
