// @group APIEndpoints : All fetch calls to the alter daemon REST API

import type { CronRun, DaemonHealth, EnvFileEntry, GitInfo, GitPullResult, LogAlertOverride, LogAlertStore, LogLine, LogStatsBucket, MetricSample, NotificationConfig, NotificationsStore, ProcessInfo, ScriptInfo, StartProcessBody, TunnelEntry, TunnelProvider, TunnelSettings, UpdateInfo } from '@/types'
import { clearSessionToken, getSessionToken } from '@/lib/auth'
import { getActiveServer, serverBaseUrl } from '@/lib/servers'

// @group Types > AI : Chat message and request types (mirrored from Rust models/ai.rs)
export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatRequest {
  message: string
  process_id?: string
  history: AiChatMessage[]
  model?: string
  provider?: string
}

export interface AiSettingsInfo {
  provider: string
  enabled: boolean
  model: string
  // GitHub
  github_token_set: boolean
  github_token_hint: string
  github_username: string
  client_id_set: boolean
  client_id_builtin: boolean
  // Claude
  anthropic_key_set: boolean
  anthropic_key_hint: string
  // OpenAI
  openai_key_set: boolean
  openai_key_hint: string
  openai_base_url: string
  // Ollama
  ollama_base_url: string
}

export interface AiAuthStartResponse {
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface AiAuthStatusResponse {
  status: 'idle' | 'pending' | 'expired' | 'denied' | 'complete' | 'error'
  username?: string
  interval?: number
  message?: string
}

export interface AiModelInfo {
  id: string
  label: string
  publisher: string
}

function getBase(): string { return serverBaseUrl(getActiveServer()) }

// @group Authentication : Attach Bearer token to every request; redirect to login on 401
function authHeaders(): Record<string, string> {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
  if (res.status === 401) {
    clearSessionToken()
    window.location.reload()
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// @group APIEndpoints > Processes
export const api = {
  getPorts: (): Promise<{ ports: { pid: number | null; port: number; protocol: string; local_address: string; remote_address: string; state: string; process_name: string | null; ancestor_pids?: number[] }[] }> =>
    request('/ports'),

  killPort: (pid: number): Promise<{ success: boolean; error?: string }> =>
    request(`/ports/kill/${pid}`, { method: 'POST' }),

  getProcesses: (): Promise<{ processes: ProcessInfo[] }> =>
    request('/processes'),

  getProcess: (id: string): Promise<ProcessInfo> =>
    request(`/processes/${id}`),

  startProcess: (body: StartProcessBody): Promise<ProcessInfo> =>
    request('/processes', { method: 'POST', body: JSON.stringify(body) }),

  stopProcess: (id: string): Promise<ProcessInfo> =>
    request(`/processes/${id}/stop`, { method: 'POST' }),

  startStopped: (id: string): Promise<ProcessInfo> =>
    request(`/processes/${id}/start`, { method: 'POST' }),

  restartProcess: (id: string): Promise<ProcessInfo> =>
    request(`/processes/${id}/restart`, { method: 'POST' }),

  // @group APIEndpoints > Namespace : Bulk namespace operations — one aggregated notification each
  startNamespace: (ns: string): Promise<{ namespace: string; started: number; processes: ProcessInfo[] }> =>
    request(`/processes/namespace/${encodeURIComponent(ns)}/start`, { method: 'POST' }),

  stopNamespace: (ns: string): Promise<{ namespace: string; stopped: number; processes: ProcessInfo[] }> =>
    request(`/processes/namespace/${encodeURIComponent(ns)}/stop`, { method: 'POST' }),

  restartNamespace: (ns: string): Promise<{ namespace: string; restarted: number; processes: ProcessInfo[] }> =>
    request(`/processes/namespace/${encodeURIComponent(ns)}/restart`, { method: 'POST' }),

  deleteProcess: (id: string): Promise<void> =>
    request(`/processes/${id}`, { method: 'DELETE' }),

  cloneProcess: (id: string, name?: string): Promise<ProcessInfo> =>
    request(`/processes/${id}/clone`, { method: 'POST', body: JSON.stringify(name ? { name } : {}) }),

  updateProcess: (id: string, body: StartProcessBody): Promise<ProcessInfo> =>
    request(`/processes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  setProcessEnabled: (id: string, enabled: boolean): Promise<ProcessInfo> =>
    request(`/processes/${id}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),

  resetProcess: (id: string): Promise<ProcessInfo> =>
    request(`/processes/${id}/reset`, { method: 'POST' }),

  openTerminal: (id: string): Promise<void> =>
    request(`/processes/${id}/terminal`, { method: 'POST' }),

  openFolder: (path: string): Promise<void> =>
    request(`/system/open-folder`, { method: 'POST', body: JSON.stringify({ path }) }),

  // @group APIEndpoints > Metrics : Rolling CPU + memory history for a process
  getMetricsHistory: (id: string): Promise<{ samples: MetricSample[] }> =>
    request(`/processes/${id}/metrics/history`),

  // @group APIEndpoints > LogStats : 5-minute stdout/stderr log count buckets for a process
  getLogStats: (id: string): Promise<{ buckets: LogStatsBucket[] }> =>
    request(`/processes/${id}/logs/stats`),

  // @group APIEndpoints > LogAlerts : Get / update the log-spike alert store (global + namespace overrides)
  getLogAlerts: (): Promise<LogAlertStore> =>
    request('/log-alerts'),

  updateLogAlerts: (store: LogAlertStore): Promise<LogAlertStore> =>
    request('/log-alerts', { method: 'PUT', body: JSON.stringify(store) }),

  putLogAlertNamespace: (ns: string, override_: LogAlertOverride): Promise<LogAlertOverride> =>
    request(`/log-alerts/namespace/${encodeURIComponent(ns)}`, { method: 'PUT', body: JSON.stringify(override_) }),

  deleteLogAlertNamespace: (ns: string): Promise<void> =>
    request(`/log-alerts/namespace/${encodeURIComponent(ns)}`, { method: 'DELETE' }),

  // @group APIEndpoints > Logs
  getLogs: (id: string, params?: { lines?: number; date?: string }): Promise<{ lines: LogLine[] }> => {
    const qs = new URLSearchParams()
    if (params?.lines) qs.set('lines', String(params.lines))
    if (params?.date)  qs.set('date', params.date)
    return request(`/processes/${id}/logs?${qs}`)
  },

  getLogDates: (id: string): Promise<{ dates: string[]; has_current: boolean }> =>
    request(`/processes/${id}/logs/dates`),

  deleteLogs: (id: string): Promise<{ success: boolean }> =>
    request(`/processes/${id}/logs`, { method: 'DELETE' }),

  // @group APIEndpoints > EnvFiles : Process-scoped env file operations
  listEnvFiles: (id: string): Promise<{ files: EnvFileEntry[] }> =>
    request(`/processes/${id}/envfiles`),

  getEnvFile: (id: string, filename = '.env'): Promise<{ content: string; exists: boolean; filename: string }> =>
    request(`/processes/${id}/envfile?filename=${encodeURIComponent(filename)}`),

  saveEnvFile: (id: string, content: string, filename = '.env'): Promise<{ success: boolean; path: string; filename: string }> =>
    request(`/processes/${id}/envfile`, { method: 'PUT', body: JSON.stringify({ content, filename }) }),

  // @group APIEndpoints > EnvFiles : Path-scoped env file operations (for StartPage/EditPage)
  listEnvPath: (dir: string): Promise<{ files: EnvFileEntry[] }> =>
    request(`/system/list-env?path=${encodeURIComponent(dir)}`),

  readEnvFile: (filePath: string): Promise<{ content: string; exists: boolean }> =>
    request(`/system/read-env?path=${encodeURIComponent(filePath)}`),

  writeEnvFile: (filePath: string, content: string): Promise<{ success: boolean; path: string }> =>
    request('/system/write-env', { method: 'POST', body: JSON.stringify({ path: filePath, content }) }),

  syncEnvFiles: (sourcePath: string): Promise<{ success: boolean; synced_files: number; errors?: string[] }> =>
    request('/system/sync-env', { method: 'POST', body: JSON.stringify({ source_path: sourcePath }) }),

  getCronHistory: (id: string): Promise<{ runs: CronRun[] }> =>
    request(`/processes/${id}/cron/history`),

  streamLogs: (id: string): EventSource => {
    const token = getSessionToken()
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    return new EventSource(`${getBase()}/processes/${id}/logs/stream${qs}`)
  },

  // @group APIEndpoints > Scripts
  saveScript: (body: { name: string; language: string; content: string }): Promise<{ path: string; name: string; filename: string; language: string }> =>
    request('/scripts', { method: 'POST', body: JSON.stringify(body) }),

  listScripts: (): Promise<{ scripts: ScriptInfo[] }> =>
    request('/scripts'),

  getScript: (name: string): Promise<{ name: string; path: string; content: string; language: string }> =>
    request(`/scripts/${name}`),

  deleteScript: (name: string): Promise<void> =>
    request(`/scripts/${name}`, { method: 'DELETE' }),

  runScript: (name: string): EventSource => {
    const token = getSessionToken()
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    return new EventSource(`${getBase()}/scripts/${name}/run${qs}`)
  },

  // @group APIEndpoints > Notifications
  getNotifications: (): Promise<NotificationsStore> =>
    request('/notifications'),

  updateGlobalNotifications: (config: NotificationConfig): Promise<{ success: boolean }> =>
    request('/notifications/global', { method: 'PUT', body: JSON.stringify(config) }),

  updateNamespaceNotifications: (ns: string, config: NotificationConfig): Promise<{ success: boolean }> =>
    request(`/notifications/namespace/${encodeURIComponent(ns)}`, { method: 'PUT', body: JSON.stringify(config) }),

  deleteNamespaceNotifications: (ns: string): Promise<{ success: boolean }> =>
    request(`/notifications/namespace/${encodeURIComponent(ns)}`, { method: 'DELETE' }),

  testNotification: (config: NotificationConfig): Promise<{ success: boolean; message: string }> =>
    request('/notifications/test', { method: 'POST', body: JSON.stringify(config) }),

  // @group APIEndpoints > System
  getHealth: (): Promise<DaemonHealth> =>
    request('/system/health'),

  getSystemStats: (): Promise<{
    cpu_percent: number
    ram_used_bytes: number
    ram_total_bytes: number
    gpu: { name: string; utilization_percent: number; vram_used_bytes: number; vram_total_bytes: number } | null
  }> => request('/system/stats'),

  getSystemPaths: (): Promise<{ data_dir: string; log_dir: string }> =>
    request('/system/paths'),

  checkEnvPath: (dir: string): Promise<{ exists: boolean; path: string }> =>
    request(`/system/check-env?path=${encodeURIComponent(dir)}`),

  browsePath: (dir: string): Promise<{
    path: string
    parent: string | null
    entries: { name: string; path: string; is_dir: boolean }[]
    error?: string
  }> => request(`/system/browse?path=${encodeURIComponent(dir)}`),

  saveState: (): Promise<void> =>
    request('/system/save', { method: 'POST' }),

  shutdownDaemon: (): Promise<void> =>
    request('/system/shutdown', { method: 'POST' }),

  restartDaemon: (): Promise<void> =>
    request('/system/restart', { method: 'POST' }),

  // @group APIEndpoints > AI : Get stored AI settings (token is masked server-side)
  aiGetSettings: (): Promise<AiSettingsInfo> =>
    request('/ai/settings'),

  // @group APIEndpoints > AI : Persist AI settings (send empty string to keep existing secrets)
  aiSaveSettings: (body: {
    provider?: string
    enabled?: boolean
    model?: string
    client_id?: string
    github_token?: string
    anthropic_key?: string
    openai_key?: string
    openai_base_url?: string
    ollama_base_url?: string
  }): Promise<{ success: boolean }> =>
    request('/ai/settings', { method: 'PUT', body: JSON.stringify(body) }),

  // @group APIEndpoints > AI : Begin GitHub OAuth Device Flow — returns user_code to display
  aiAuthStart: (): Promise<AiAuthStartResponse> =>
    request('/ai/auth/start', { method: 'POST' }),

  // @group APIEndpoints > AI : Poll GitHub token exchange — returns current auth status
  aiAuthStatus: (): Promise<AiAuthStatusResponse> =>
    request('/ai/auth/status'),

  // @group APIEndpoints > AI : Disconnect GitHub account — clears stored token and username
  aiAuthLogout: (): Promise<{ success: boolean }> =>
    request('/ai/auth', { method: 'DELETE' }),

  // @group APIEndpoints > AI : List GitHub Models catalog (chat-completion models only)
  aiGetModels: (): Promise<{ models: AiModelInfo[] }> =>
    request('/ai/models'),

  // @group APIEndpoints > AI : Stream a chat response — returns AbortController to cancel
  aiChat(
    req: AiChatRequest,
    onDelta: (token: string) => void,
    onDone: () => void,
    onError: (msg: string) => void,
  ): AbortController {
    const abort = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`${getBase()}/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(req),
          signal: abort.signal,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          onError((data as { error?: string }).error ?? `HTTP ${res.status}`)
          return
        }
        const reader = res.body?.getReader()
        if (!reader) { onDone(); return }
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const payload = trimmed.slice(6)
            try {
              const parsed = JSON.parse(payload) as { delta?: string; done?: boolean; error?: string }
              if (parsed.error) { onError(parsed.error); return }
              if (parsed.done)  { onDone(); return }
              if (parsed.delta) onDelta(parsed.delta)
            } catch { /* ignore malformed lines */ }
          }
        }
        onDone()
      } catch (e: unknown) {
        if ((e as Error)?.name !== 'AbortError') {
          onError((e as Error)?.message ?? 'Connection error')
        }
      }
    })()
    return abort
  },

  // @group APIEndpoints > Auth : Auth status — check if password / PIN are configured
  authStatus: (): Promise<{
    password_configured: boolean
    passkeys_count: number
    pin_configured: boolean
    lock_timeout_mins: number | null
  }> => fetch(`${getBase()}/auth/status`).then(r => r.json()),

  // @group APIEndpoints > Auth : First-time password setup
  authSetup: (password: string): Promise<{ session_token: string; expires_at: string }> =>
    request('/auth/setup', { method: 'POST', body: JSON.stringify({ password }) }),

  // @group APIEndpoints > Auth : Password login
  authLogin: (password: string): Promise<{ session_token: string; expires_at: string }> =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),

  // @group APIEndpoints > Auth : PIN login (lock screen quick-unlock)
  authPinLogin: (pin: string): Promise<{ session_token: string; expires_at: string }> =>
    request('/auth/pin/login', { method: 'POST', body: JSON.stringify({ pin }) }),

  // @group APIEndpoints > Auth : Logout — invalidate session
  authLogout: (): Promise<{ success: boolean }> =>
    request('/auth/session', { method: 'DELETE' }),

  // @group APIEndpoints > Auth : Change password (requires current password)
  authChangePassword: (currentPassword: string, newPassword: string): Promise<{ success: boolean }> =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }),

  // @group APIEndpoints > Auth : Set or update PIN (4 or 6 digits)
  authSetPin: (pin: string): Promise<{ success: boolean }> =>
    request('/auth/pin', { method: 'POST', body: JSON.stringify({ pin }) }),

  // @group APIEndpoints > Auth : Remove PIN
  authRemovePin: (): Promise<{ success: boolean }> =>
    request('/auth/pin', { method: 'DELETE' }),

  // @group APIEndpoints > Auth : Update auto-lock timeout
  authUpdateLockSettings: (lockTimeoutMins: number | null): Promise<{ success: boolean }> =>
    request('/auth/settings', { method: 'PATCH', body: JSON.stringify({ lock_timeout_mins: lockTimeoutMins }) }),

  // @group APIEndpoints > Auth : Begin passkey registration
  passkeyRegisterStart: (): Promise<object> =>
    request('/auth/passkey/register/start', { method: 'POST' }),

  // @group APIEndpoints > Auth : Finish passkey registration
  passkeyRegisterFinish: (credential: object, name: string): Promise<{ success: boolean }> =>
    request('/auth/passkey/register/finish', { method: 'POST', body: JSON.stringify({ credential, name }) }),

  // @group APIEndpoints > Auth : Begin passkey login assertion
  passkeyLoginStart: (): Promise<object> =>
    request('/auth/passkey/login/start', { method: 'POST' }),

  // @group APIEndpoints > Auth : Finish passkey login assertion
  passkeyLoginFinish: (credential: object): Promise<{ session_token: string; expires_at: string }> =>
    request('/auth/passkey/login/finish', { method: 'POST', body: JSON.stringify(credential) }),

  // @group APIEndpoints > Auth : Delete a registered passkey
  passkeyDelete: (name: string): Promise<{ success: boolean }> =>
    request(`/auth/passkey/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // @group APIEndpoints > Telegram : Get Telegram bot config (token is masked)
  getTelegramConfig: (): Promise<{
    enabled: boolean
    bot_token_hint: string | null
    bot_token_set: boolean
    allowed_chat_ids: number[]
    notify_on_crash: boolean
    notify_on_start: boolean
    notify_on_stop: boolean
    notify_on_restart: boolean
  }> => request('/telegram'),

  // @group APIEndpoints > Telegram : Update Telegram bot config
  updateTelegramConfig: (cfg: {
    enabled?: boolean
    bot_token?: string
    allowed_chat_ids?: number[]
    notify_on_crash?: boolean
    notify_on_start?: boolean
    notify_on_stop?: boolean
    notify_on_restart?: boolean
  }): Promise<{ success: boolean }> =>
    request('/telegram', { method: 'PUT', body: JSON.stringify(cfg) }),

  // @group APIEndpoints > Telegram : Send a test message to the first allowed chat
  testTelegram: (): Promise<{ success: boolean; message: string }> =>
    request('/telegram/test', { method: 'POST' }),

  // @group APIEndpoints > Telegram : Validate the bot token and return bot username
  getTelegramBotInfo: (): Promise<{
    ok: boolean
    username: string | null
    first_name: string | null
    error: string | null
  }> => request('/telegram/botinfo'),

  // @group APIEndpoints > Update : Check GitHub for the latest release
  checkUpdate: (): Promise<UpdateInfo> =>
    request('/system/update/check'),

  // @group APIEndpoints > Update : Download and apply the update, then restart daemon
  applyUpdate: (downloadUrl: string): Promise<{ success: boolean; message: string }> =>
    request('/system/update/apply', { method: 'POST', body: JSON.stringify({ download_url: downloadUrl }) }),

  // @group APIEndpoints > Git : Get git repo info (branch, SHA, dirty, ahead/behind) for a process
  getProcessGit: (id: string): Promise<GitInfo> =>
    request(`/processes/${id}/git`),

  // @group APIEndpoints > Git : git pull + install deps + restart for a process
  gitPull: (id: string): Promise<GitPullResult> =>
    request(`/processes/${id}/git/pull`, { method: 'POST' }),

  // @group APIEndpoints > Tunnels : List all active tunnels
  getTunnels: (): Promise<{ tunnels: TunnelEntry[] }> =>
    request('/tunnels'),

  // @group APIEndpoints > Tunnels : Create a tunnel for a port
  createTunnel: (body: {
    port: number
    process_name?: string | null
    process_id?: string | null
    provider?: TunnelProvider | null
  }): Promise<{ tunnel?: TunnelEntry; error?: string }> =>
    request('/tunnels', { method: 'POST', body: JSON.stringify(body) }),

  // @group APIEndpoints > Tunnels : Stop a running tunnel (keeps it in the list as stopped)
  stopTunnel: (id: string): Promise<{ success: boolean; error?: string }> =>
    request(`/tunnels/${id}/stop`, { method: 'POST' }),

  // @group APIEndpoints > Tunnels : Remove a tunnel entry from the list entirely (stops first if running)
  removeTunnel: (id: string): Promise<{ success: boolean; error?: string }> =>
    request(`/tunnels/${id}`, { method: 'DELETE' }),

  // @group APIEndpoints > TunnelSettings : Get tunnel provider configuration
  getTunnelSettings: (): Promise<TunnelSettings> =>
    request('/tunnels/settings'),

  // @group APIEndpoints > TunnelSettings : Save tunnel provider configuration
  updateTunnelSettings: (settings: TunnelSettings): Promise<{ success: boolean; error?: string }> =>
    request('/tunnels/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  // @group APIEndpoints > TunnelSettings : Test whether a provider binary is installed
  testTunnelProvider: (provider: TunnelProvider): Promise<{ ok: boolean; message: string }> =>
    request('/tunnels/settings/test', { method: 'POST', body: JSON.stringify({ provider }) }),

  // @group APIEndpoints > TunnelSettings : Install a provider binary via system package manager
  installTunnelProvider: (provider: TunnelProvider): Promise<{ ok: boolean; output: string }> =>
    request('/tunnels/settings/install', { method: 'POST', body: JSON.stringify({ provider }) }),

  // @group APIEndpoints > TunnelSettings : Stream install output as SSE
  streamInstallProvider: (provider: TunnelProvider): EventSource => {
    const token = getSessionToken()
    const qs = new URLSearchParams({ provider, ...(token ? { token } : {}) })
    return new EventSource(`${getBase()}/tunnels/settings/install/stream?${qs}`)
  },

  // @group APIEndpoints > Startup : Get OS autostart registration status
  getStartupStatus: (): Promise<{ enabled: boolean; method: string }> =>
    request('/system/startup'),

  // @group APIEndpoints > Startup : Register daemon as OS autostart entry
  enableStartup: (): Promise<void> =>
    request('/system/startup', { method: 'POST' }),

  // @group APIEndpoints > Startup : Remove daemon OS autostart entry
  disableStartup: (): Promise<void> =>
    request('/system/startup', { method: 'DELETE' }),

  // @group APIEndpoints > UiSettings : Load persisted UI settings blob from daemon
  getUiSettings: (): Promise<Record<string, unknown>> =>
    request('/system/ui-settings'),

  // @group APIEndpoints > UiSettings : Persist a partial UI settings blob to daemon
  saveUiSettings: (patch: Record<string, unknown>): Promise<void> =>
    request('/system/ui-settings', { method: 'PUT', body: JSON.stringify(patch) }),

  // @group APIEndpoints > TerminalHistory : Load saved command history for a key (e.g. "proc:api-server")
  getTerminalHistory: (key: string): Promise<CmdEntry[]> =>
    request(`/terminals/history/${encodeURIComponent(key)}`),

  // @group APIEndpoints > TerminalHistory : Persist command history for a key
  saveTerminalHistory: (key: string, entries: CmdEntry[]): Promise<void> =>
    request(`/terminals/history/${encodeURIComponent(key)}`, {
      method: 'PUT', body: JSON.stringify(entries),
    }),
}

// @group Types > TerminalHistory : Mirrored from Rust CmdEntry
export interface CmdEntry { cmd: string; count: number }