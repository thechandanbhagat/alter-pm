// @group BusinessLogic : Reactive settings hook — reads/writes AppSettings via daemon REST API

import { useCallback, useEffect, useRef, useState } from 'react'
import { type AppSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/lib/settings'
import { applyTheme, readCachedTheme } from '@/lib/theme'

// @group BusinessLogic > useSettings : Returns settings state + mutators
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => ({ ...DEFAULT_SETTINGS, theme: readCachedTheme() }))
  const settingsRef = useRef(settings)
  const edited = useRef(false)
  const [loaded, setLoaded] = useState(false)

  // @group BusinessLogic > Load : Fetch settings from daemon on mount
  useEffect(() => {
    let cancelled = false
    loadSettings().then(s => {
      if (cancelled) return
      if (!edited.current) {
        settingsRef.current = s
        setSettings(s)
      }
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  // @group BusinessLogic > Update : Merge partial update and persist immediately
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    edited.current = true
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    void saveSettings(next)
  }, [])

  // @group BusinessLogic > Reset : Restore all defaults
  const resetToDefaults = useCallback(async () => {
    edited.current = true
    const defaults = { ...DEFAULT_SETTINGS }
    settingsRef.current = defaults
    setSettings(defaults)
    await saveSettings(defaults)
  }, [])

  return { settings, updateSettings, resetToDefaults, loaded }
}
