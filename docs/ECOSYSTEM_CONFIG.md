# Ecosystem Config Reference

> Define multiple processes in a single file and start them all with one command.

---

## Overview

An ecosystem config file lets you define all your application processes in one place — their scripts, arguments, environment variables, restart policies, and more. Both **TOML** and **JSON** formats are supported.

```powershell
# Start all apps defined in the config
alter start alter.config.toml
alter start alter.config.json
```

---

## TOML Format

```toml
# alter.config.toml

[[apps]]
name             = "api"
script           = "python"
args             = ["-m", "uvicorn", "main:app", "--port", "8000"]
cwd              = "C:\\projects\\api"
autorestart      = true
max_restarts     = 10
restart_delay_ms = 2000
namespace        = "web"
max_log_size_mb  = 25

[apps.env]
PORT         = "8000"
DATABASE_URL = "postgres://localhost/mydb"
DEBUG        = "false"

[[apps]]
name             = "worker"
script           = "node"
args             = ["dist/worker.js"]
cwd              = "C:\\projects\\worker"
autorestart      = true
max_restarts     = 5
restart_delay_ms = 5000
namespace        = "workers"
watch            = true
watch_paths      = ["dist/"]
watch_ignore     = ["node_modules", "*.log", "*.map"]

[apps.env]
NODE_ENV = "production"
QUEUE    = "default"

[[apps]]
name   = "scheduler"
script = "go"
args   = ["run", "cmd/scheduler/main.go"]
cwd    = "C:\\projects\\scheduler"
namespace = "workers"
autorestart = true

[apps.env]
TZ = "UTC"
```

---

## JSON Format

```json
{
  "apps": [
    {
      "name": "api",
      "script": "python",
      "args": ["-m", "uvicorn", "main:app", "--port", "8000"],
      "cwd": "C:\\projects\\api",
      "autorestart": true,
      "max_restarts": 10,
      "namespace": "web",
      "env": {
        "PORT": "8000",
        "DATABASE_URL": "postgres://localhost/mydb"
      }
    },
    {
      "name": "worker",
      "script": "node",
      "args": ["dist/worker.js"],
      "watch": true,
      "watch_paths": ["dist/"],
      "namespace": "workers",
      "env": {
        "NODE_ENV": "production"
      }
    }
  ]
}
```

---

## Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **yes** | — | Display name. Used as process identifier in CLI commands |
| `script` | string | **yes** | — | Executable to run (`python`, `node`, `go`, `dotnet`, etc.) |
| `args` | string[] | no | `[]` | Arguments passed to the script |
| `cwd` | string | no | current dir | Working directory. Use absolute paths. On Windows, use double backslashes or forward slashes |
| `env` | object | no | `{}` | Environment variables as key-value string pairs |
| `autorestart` | bool | no | `true` | Automatically restart if the process exits with a non-zero code |
| `max_restarts` | integer | no | `10` | Maximum number of restart attempts before marking as `errored` |
| `restart_delay_ms` | integer | no | `1000` | Base delay in milliseconds before the first restart. Doubles on each attempt (capped at 60s) |
| `namespace` | string | no | `"default"` | Logical group for organizing processes in the dashboard |
| `watch` | bool | no | `false` | Enable watch mode — restart the process when files change |
| `watch_paths` | string[] | no | `[]` | Directories or files to watch. Relative paths resolved from `cwd` |
| `watch_ignore` | string[] | no | `[]` | Glob patterns to exclude from watching |
| `max_log_size_mb` | integer | no | `10` | Rotate log file when it exceeds this size (in megabytes) |
| `instances` | integer | no | `1` | Reserved — parsed but not yet active |
| `log_file` | string | no | auto | Custom path for stdout log. Defaults to `%APPDATA%\alter-pm2\logs\<name>\out.log` |
| `error_file` | string | no | auto | Custom path for stderr log. Defaults to `%APPDATA%\alter-pm2\logs\<name>\err.log` |
| `notify` | object | no | null | Per-process notification config override (see [Notifications](#notifications)) |

---

## Field Details

### `script`

The executable to run. alter handles the following automatically:

- **Python:** `python`, `python3`, `py`
- **Node.js:** `node`
- **Go:** `go` (e.g. `args = ["run", "main.go"]`)
- **Rust:** `cargo` (e.g. `args = ["run", "--release"]`)
- **.NET:** `dotnet`
- **PHP:** `php`
- **Ruby:** `ruby`
- **Any `.exe`** on Windows — spawned directly
- **Batch scripts** (`.cmd`) — automatically wrapped in `cmd /C`

> **Windows note:** Tools like `npm`, `yarn`, `npx`, `tsc`, `nodemon` are `.cmd` batch files. alter wraps them in `cmd /C` automatically, so you can use them directly as the `script` value.

```toml
# These all work on Windows:
script = "npm"
args   = ["run", "start"]

script = "npx"
args   = ["nodemon", "index.js"]

script = "dotnet"
args   = ["MyApp.dll"]
```

### `cwd`

Working directory for the process. If not specified, the daemon's working directory is used.

```toml
# Windows (double backslash)
cwd = "C:\\Users\\me\\projects\\api"

# Windows (forward slash also works)
cwd = "C:/Users/me/projects/api"
```

### `env`

Environment variables are merged with the system environment. The process inherits all existing environment variables, plus any you define here.

```toml
[apps.env]
NODE_ENV     = "production"
PORT         = "3000"
DATABASE_URL = "postgres://localhost/mydb"
API_KEY      = "secret"
```

### `autorestart` and `max_restarts`

```toml
autorestart  = true    # restart on crash
max_restarts = 10      # give up after 10 attempts
```

A **clean exit** (code 0) is **not** treated as a crash — the process stays in `stopped` state and is not restarted.

### `restart_delay_ms`

Exponential backoff delay:

```
attempt 0: 1000ms  (base)
attempt 1: 2000ms
attempt 2: 4000ms
attempt 3: 8000ms
...
attempt 8+: 60000ms  (capped)
```

Setting a higher base (e.g. `5000`) extends all delays proportionally.

### `watch` and `watch_paths`

```toml
watch        = true
watch_paths  = ["src/", "config/"]
watch_ignore = ["node_modules", "__pycache__", "*.log", "*.pyc"]
```

Watch mode is ideal for development. The process restarts automatically after a 500ms debounce whenever watched files change.

### `namespace`

Namespaces appear as collapsible groups in the web dashboard. They have no effect on process behavior.

```toml
namespace = "web"       # dashboard shows under "WEB" group
namespace = "workers"   # dashboard shows under "WORKERS" group
namespace = "default"   # (default if omitted)
```

---

## Windows Path Examples

```toml
# API server
[[apps]]
name   = "api"
script = "python"
args   = ["-m", "uvicorn", "app.main:app", "--reload"]
cwd    = "C:/Users/me/projects/api"
namespace = "web"

[apps.env]
PYTHONPATH = "."

# Node backend
[[apps]]
name   = "node-api"
script = "node"
args   = ["dist/index.js"]
cwd    = "C:/Users/me/projects/node-api"
namespace = "web"

[apps.env]
NODE_ENV = "production"
PORT     = "3001"

# .NET service
[[apps]]
name   = "grpc-service"
script = "dotnet"
args   = ["MyService.dll"]
cwd    = "C:/Users/me/projects/service/bin/Release/net8.0"
namespace = "services"

# Background worker (npm script)
[[apps]]
name   = "queue-worker"
script = "npm"
args   = ["run", "worker"]
cwd    = "C:/Users/me/projects/worker"
namespace = "workers"
autorestart      = true
max_restarts     = 20
restart_delay_ms = 3000

[apps.env]
NODE_ENV   = "production"
REDIS_URL  = "redis://localhost:6379"
```

---

## Loading the Config

```powershell
# Start all apps
alter start alter.config.toml

# Also works
alter start C:\projects\alter.config.toml
alter start ./alter.config.json
```

> alter detects config files by their extension (`.toml` or `.json`). Any other value is treated as a script to run directly.

After loading, each app appears as a separate process in `alter list` and the web dashboard, with its own logs, restart counter, and controls.

---

## Notifications

Use the `notify` field to override notification settings for a specific process. It takes priority over namespace-level and global notification configs.

```toml
[[apps]]
name   = "api"
script = "python"
args   = ["-m", "uvicorn", "main:app"]
namespace = "web"

[apps.notify.slack]
webhook_url = "https://hooks.slack.com/services/..."
enabled     = true
channel     = "#api-alerts"

[apps.notify.events]
on_crash   = true
on_restart = true
on_start   = false
on_stop    = false
```

You can also use a generic webhook:

```toml
[apps.notify.webhook]
url     = "https://your-service.example.com/alter-hook"
enabled = true

[apps.notify.events]
on_crash = true
```

> **Note:** If `notify` is omitted on a process, the namespace config applies. If the namespace has no config, the global config applies. Configure global and namespace defaults via the REST API — see [Notification Endpoints](./API.md#notification-endpoints).

---

## Tips

**Naming conventions:**
- Keep names short and lowercase: `api`, `web`, `worker`, `scheduler`
- Names must be unique — duplicate names will overwrite each other

**Iterating quickly:**
- Edit the config file, then `alter start alter.config.toml` again
- Already-running processes with the same name will be updated and restarted

**Organizing large projects:**
```toml
# Group everything by role using namespaces
[[apps]]
namespace = "web"      # api, frontend, proxy

[[apps]]
namespace = "workers"  # queue consumers, schedulers

[[apps]]
namespace = "infra"    # redis proxy, health checks
```
