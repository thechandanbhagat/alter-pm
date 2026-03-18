// @group Types : All API data structures mirroring Rust models

// @group Types > Notifications : Webhook / Slack / Teams notification config
export interface NotificationEvents {
  // Process lifecycle events
  on_crash: boolean
  on_restart: boolean
  on_start: boolean
  on_stop: boolean
  // Cron job events
  on_cron_run?: boolean
  on_cron_fail?: boolean
}

export interface WebhookTarget {
  url: string
  enabled: boolean
}

export interface SlackTarget {
  webhook_url: string
  enabled: boolean
  channel?: string
}

export interface TeamsTarget {
  webhook_url: string
  enabled: boolean
}

export interface NotificationConfig {
  webhook?: WebhookTarget
  slack?: SlackTarget
  teams?: TeamsTarget
  events: NotificationEvents
}

export interface NotificationsStore {
  global: NotificationConfig
  namespaces: Record<string, NotificationConfig>
}

export type ProcessStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'errored'
  | 'watching'
  | 'sleeping'

export interface CronRun {
  run_at: string        // ISO datetime
  exit_code: number | null
  duration_secs: number
}

export interface ProcessInfo {
  id: string
  name: string
  script: string
  args: string[]
  cwd: string | null
  status: ProcessStatus
  pid: number | null
  restart_count: number
  uptime_secs: number | null
  last_exit_code: number | null
  autorestart: boolean
  max_restarts: number
  watch: boolean
  namespace: string
  created_at: string
  started_at: string | null
  stopped_at: string | null
  cron: string | null
  cron_next_run: string | null
  cron_run_history: CronRun[]
  /** CPU usage percentage (0–100 per core), null when not running */
  cpu_percent: number | null
  /** Resident memory in bytes, null when not running */
  memory_bytes: number | null
  /** Environment variables passed to the process */
  env: Record<string, string>
  /** Process-level notification override */
  notify?: NotificationConfig
}

export interface DaemonHealth {
  status: string
  version: string
  uptime_secs: number
  process_count: number
}

export interface LogLine {
  timestamp: string
  stream: 'stdout' | 'stderr'
  content: string
}

export interface ScriptInfo {
  name: string
  path: string
  language: string
  size_bytes: number
  modified_at: string
}

export interface StartProcessBody {
  script: string
  name?: string
  cwd?: string
  args?: string[]
  env?: Record<string, string>
  namespace?: string
  autorestart?: boolean
  watch?: boolean
  max_restarts?: number
  restart_delay_ms?: number
  watch_paths?: string[]
  cron?: string
  notify?: NotificationConfig
}

// @group Types > EnvFiles : Env file descriptor from the API
export interface EnvFileEntry {
  name: string
  path: string
}

// @group Types > Metrics : Single CPU + memory sample returned by the metrics history endpoint
export interface MetricSample {
  timestamp: string    // ISO datetime
  cpu_percent: number
  memory_bytes: number
}

// @group Types > LogAlerts : Threshold-based stderr spike notification settings
export interface LogAlertConfig {
  enabled: boolean
  /** Alert when stderr lines in a 5-min bucket reach or exceed this count */
  stderr_threshold: number
  /** Minimum minutes between repeated alerts for the same process */
  cooldown_mins: number
}

// @group Types > LogStats : One 5-minute bucket of stdout + stderr line counts (from disk)
export interface LogStatsBucket {
  window_start: string  // RFC3339 UTC start of the 5-minute window
  stdout_count: number
  stderr_count: number
}
