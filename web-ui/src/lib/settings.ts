// @group Configuration : User settings schema — persisted to daemon data directory via REST API

import { getSessionToken } from '@/lib/auth'
import { getActiveServer, serverBaseUrl } from '@/lib/servers'

// @group Types : Full settings schema with defaults
export interface AppSettings {
  // Polling
  autoRefresh: boolean
  processRefreshInterval: number   // ms — how often to poll /processes
  healthRefreshInterval: number    // ms — how often to poll /system/health

  // Behaviour
  confirmBeforeDelete: boolean
  confirmBeforeShutdown: boolean

  // Defaults for new processes/cron jobs
  defaultNamespace: string

  // Log viewer
  logTailLines: number             // default lines to fetch in log viewer

  // Connection
  daemonUrl: string                // base URL — default http://127.0.0.1:2999

  // UI
  visibleRowActions: string[]      // which secondary actions show inline in process rows; others go in ⋯

  // Developer
  showQueryDevtools: boolean       // show React Query devtools panel (dev mode only)

  // Terminal
  terminalShortcuts: {
    splitPane: string      // default: ctrl+shift+t
    duplicateTab: string   // default: alt+t
    newTab: string         // default: ctrl+t
  }
}

// @group Constants : Default settings values
export const DEFAULT_SETTINGS: AppSettings = {
  autoRefresh: true,
  processRefreshInterval: 3000,
  healthRefreshInterval: 5000,

  confirmBeforeDelete: true,
  confirmBeforeShutdown: true,

  defaultNamespace: 'default',

  logTailLines: 200,

  daemonUrl: 'http://127.0.0.1:2999',

  visibleRowActions: ['logs'],

  showQueryDevtools: false,

  terminalShortcuts: {
    splitPane: 'ctrl+shift+t',
    duplicateTab: 'alt+t',
    newTab: 'ctrl+t',
  },
}

// @group Utilities > API : Base fetch helper for settings (can't import api.ts — circular dep risk)
function settingsUrl(): string {
  return `${serverBaseUrl(getActiveServer())}/system/ui-settings`
}

function authHeader(): Record<string, string> {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// @group Utilities > Load : Fetch settings from daemon — merges with defaults for forward-compat
export async function loadSettings(): Promise<AppSettings> {
  try {
    const res = await fetch(settingsUrl(), { headers: authHeader() })
    if (!res.ok) return { ...DEFAULT_SETTINGS }
    const raw = await res.json() as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

// @group Utilities > Save : Write settings to daemon data directory
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await fetch(settingsUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(settings),
    })
  } catch { /* non-critical — UI still works */ }
}

// @group Utilities > Reset : Persist defaults, return them
export async function resetSettings(): Promise<AppSettings> {
  await saveSettings(DEFAULT_SETTINGS)
  return { ...DEFAULT_SETTINGS }
}

// @group Constants : Refresh interval options for the dropdown
export const REFRESH_INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: '1 second',   value: 1000  },
  { label: '2 seconds',  value: 2000  },
  { label: '3 seconds',  value: 3000  },
  { label: '5 seconds',  value: 5000  },
  { label: '10 seconds', value: 10000 },
  { label: '30 seconds', value: 30000 },
  { label: '1 minute',   value: 60000 },
]

// @group Constants : Log tail line count options
export const LOG_TAIL_OPTIONS: { label: string; value: number }[] = [
  { label: '50 lines',   value: 50   },
  { label: '100 lines',  value: 100  },
  { label: '200 lines',  value: 200  },
  { label: '500 lines',  value: 500  },
  { label: '1000 lines', value: 1000 },
]
