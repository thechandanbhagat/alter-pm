// @group BusinessLogic : Fetch daemon health info at a configurable interval

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { DaemonHealth } from '@/types'

// @group BusinessLogic > useDaemonHealth : Polls /system/health; interval driven by settings
export function useDaemonHealth(intervalMs = 5000) {
  const [health, setHealth] = useState<DaemonHealth | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.getHealth()
      setHealth(data)
    } catch {
      setHealth(null)
    }
  }, [])

  useEffect(() => {
    load()
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(load, intervalMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load, intervalMs])

  return health
}
