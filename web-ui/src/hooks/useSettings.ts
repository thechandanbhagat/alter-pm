// @group BusinessLogic : Reactive settings hook — reads/writes AppSettings via daemon REST API

import { useCallback, useEffect, useState } from 'react'
import { type AppSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, resetSettings } from '@/lib/settings'

// @group BusinessLogic > useSettings : Returns settings state + mutators
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS })
  const [loaded, setLoaded] = useState(false)

  // @group BusinessLogic > Load : Fetch settings from daemon on mount
  useEffect(() => {
    loadSettings().then(s => {
      setSettings(s)
      setLoaded(true)
    })
  }, [])

  // @group BusinessLogic > Update : Merge partial update and persist immediately
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  // @group BusinessLogic > Reset : Restore all defaults
  const resetToDefaults = useCallback(async () => {
    const defaults = await resetSettings()
    setSettings(defaults)
  }, [])

  return { settings, updateSettings, resetToDefaults, loaded }
}
