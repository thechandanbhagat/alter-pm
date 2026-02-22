// @group BusinessLogic : Reactive settings hook — reads/writes AppSettings to localStorage

import { useCallback, useState } from 'react'
import { type AppSettings, loadSettings, saveSettings, resetSettings } from '@/lib/settings'

// @group BusinessLogic > useSettings : Returns settings state + mutators
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  // @group BusinessLogic > Update : Merge partial update and persist immediately
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  // @group BusinessLogic > Reset : Restore all defaults
  const resetToDefaults = useCallback(() => {
    const defaults = resetSettings()
    setSettings(defaults)
  }, [])

  return { settings, updateSettings, resetToDefaults }
}
