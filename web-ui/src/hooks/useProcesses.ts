// @group BusinessLogic : Poll /api/v1/processes at a configurable interval

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { ProcessInfo } from '@/types'

// @group BusinessLogic > useProcesses : Polls the process list; interval and toggle driven by settings
export function useProcesses(autoRefresh = true, intervalMs = 3000) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.getProcesses()
      setProcesses(data.processes ?? [])
      setError(null)
    } catch {
      setError('disconnected')
    }
  }, [])

  useEffect(() => {
    load()
    if (timerRef.current) clearInterval(timerRef.current)
    if (autoRefresh) {
      timerRef.current = setInterval(load, intervalMs)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load, autoRefresh, intervalMs])

  return { processes, error, reload: load }
}
