// Theme is daemon-persisted; the per-server cache also covers startup and the lock screen.
import { getActiveServerId } from '@/lib/servers'

export type ThemePreference = 'dark' | 'light' | 'system'

export function normalizeTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'system' ? value : 'dark'
}

function cacheKey(): string {
  return `alter_theme_${getActiveServerId()}`
}

export function readCachedTheme(): ThemePreference {
  try {
    return normalizeTheme(localStorage.getItem(cacheKey()))
  } catch {
    return 'dark'
  }
}

let removeSystemListener: (() => void) | undefined

// One application-wide listener survives layout unmounts when the screen locks.
export function applyTheme(preference: ThemePreference): void {
  removeSystemListener?.()
  removeSystemListener = undefined
  const theme = normalizeTheme(preference)
  const media = theme === 'system' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined

  const render = () => {
    const resolved = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme
    const root = document.documentElement
    root.dataset.theme = resolved
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
  }

  render()
  if (media) {
    media.addEventListener('change', render)
    removeSystemListener = () => media.removeEventListener('change', render)
  }

  try {
    localStorage.setItem(cacheKey(), theme)
  } catch { /* Storage may be unavailable; the selected theme still works. */ }
}

export function initializeTheme(): void {
  applyTheme(readCachedTheme())
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => removeSystemListener?.())
}
