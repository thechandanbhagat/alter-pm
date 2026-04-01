// @group Configuration : User settings schema — persisted to localStorage

// @group Constants : Storage key for localStorage
const STORAGE_KEY = 'alter-pm2:settings'

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

// @group Utilities > Load : Read and merge settings from localStorage
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    // Merge with defaults so any new fields added in future versions are present
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

// @group Utilities > Save : Write settings to localStorage
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage full or blocked — silently ignore
  }
}

// @group Utilities > Reset : Clear settings and restore defaults
export function resetSettings(): AppSettings {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
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
