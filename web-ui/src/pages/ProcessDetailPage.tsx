// @group BusinessLogic : Process detail view — SSE log stream, date navigation, toolbar

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
import { statusColor } from '@/lib/utils'
import type { AppSettings } from '@/lib/settings'
import type { ProcessInfo } from '@/types'

interface Props {
  reload: () => void
  settings: AppSettings
}

export default function ProcessDetailPage({ reload, settings }: Props) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [process, setProcess] = useState<ProcessInfo | null>(null)
  const [logLines, setLogLines] = useState<Array<{ stream: string; content: string }>>([])
  const [logDates, setLogDates] = useState<string[]>([])
  const [dateIndex, setDateIndex] = useState(-1) // -1 = today (live)
  const logEndRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const { dialogState, confirm, danger, alert, handleConfirm, handleCancel } = useDialog()

  // Load process info + poll at configured interval
  useEffect(() => {
    if (!id) return
    function loadProc() {
      api.getProcess(id!).then(setProcess).catch(() => {})
    }
    loadProc()
    const timer = setInterval(loadProc, settings.processRefreshInterval)
    return () => clearInterval(timer)
  }, [id, settings.processRefreshInterval])

  // Load available log dates
  useEffect(() => {
    if (!id) return
    api.getLogDates(id).then(d => setLogDates(d.dates)).catch(() => {})
  }, [id])

  // Load historical logs + start SSE when dateIndex changes
  useEffect(() => {
    if (!id) return
    // Stop existing SSE
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setLogLines([])

    const isToday = dateIndex === -1
    const dateParam = isToday ? undefined : logDates[dateIndex]

    // Fetch historical
    api.getLogs(id, { lines: isToday ? settings.logTailLines : Math.max(settings.logTailLines, 500), date: dateParam })
      .then(d => setLogLines(d.lines.map(l => ({ stream: l.stream, content: l.content }))))
      .catch(() => {})

    // Live SSE for today only
    if (isToday) {
      const es = api.streamLogs(id)
      esRef.current = es
      es.onmessage = (e) => {
        try {
          const line = JSON.parse(e.data)
          setLogLines(prev => [...prev, { stream: line.stream, content: line.content }])
        } catch {}
      }
      es.onerror = () => { es.close(); esRef.current = null }
    }

    return () => { if (esRef.current) { esRef.current.close(); esRef.current = null } }
  }, [id, dateIndex, logDates, settings.logTailLines])

  // Auto-scroll to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines])

  if (!process) return <div style={{ padding: 24, color: 'var(--color-muted-foreground)' }}>Loading…</div>

  const isActive = process.status === 'running' || process.status === 'sleeping' || process.status === 'watching'
  const isToday = dateIndex === -1

  async function doStart() {
    await api.startStopped(process!.id).catch(() => {})
    setTimeout(reload, 300)
  }
  async function doRestart() {
    await api.restartProcess(process!.id).catch(() => {})
    reload()
  }
  async function doStop() {
    const ok = await confirm(`Stop "${process!.name}"?`, 'The process will be stopped. You can restart it later.')
    if (!ok) return
    await api.stopProcess(process!.id).catch(() => {})
    reload()
  }
  async function doDelete() {
    if (settings.confirmBeforeDelete) {
      const ok = await danger(`Delete "${process!.name}"?`, 'This will permanently remove the process and its configuration.', 'Delete')
      if (!ok) return
    }
    await api.deleteProcess(process!.id).catch(() => {})
    navigate('/')
    reload()
  }
  async function doTerminal() {
    await api.openTerminal(process!.id).catch(() => {})
  }
  async function doVSCode() {
    if (!process!.cwd) {
      await alert('No working directory', 'This process has no working directory configured.')
      return
    }
    window.open(`vscode://file/${process!.cwd.replace(/\\/g, '/')}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Dialog
        open={dialogState.open}
        title={dialogState.title}
        message={dialogState.message}
        variant={dialogState.variant}
        confirmLabel={dialogState.confirmLabel}
        cancelLabel={dialogState.cancelLabel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* Toolbar */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--color-card)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/')} style={ghostBtnStyle}>← Back</button>
          <span style={{ color: statusColor(process.status), fontSize: 12 }}>●</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{process.name}</span>
          <span style={{ fontSize: 12, color: statusColor(process.status) }}>{process.status}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isActive
            ? <>
                <ToolBtn label="↺ Restart" onClick={doRestart} />
                <ToolBtn label="■ Stop" onClick={doStop} />
              </>
            : <ToolBtn label="▶ Start" onClick={doStart} />
          }
          <ToolBtn label="✎ Edit" onClick={() => navigate(`/edit/${process.id}`)} />
          <ToolBtn label="✕ Delete" onClick={doDelete} danger />
          <ToolBtn label="⌨ Terminal" onClick={doTerminal} />
          <ToolBtn label="VS Code" onClick={doVSCode} />
        </div>
      </div>

      {/* Date navigation */}
      <div style={{
        padding: '6px 16px', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: 'var(--color-muted)', fontSize: 12,
      }}>
        <button disabled={dateIndex >= logDates.length - 1} onClick={() => setDateIndex(i => i + 1)} style={navBtnStyle}>
          ← Older
        </button>
        <span style={{ color: 'var(--color-muted-foreground)', minWidth: 100, textAlign: 'center' }}>
          {isToday ? '📡 Today (live)' : logDates[dateIndex]}
        </span>
        <button disabled={isToday} onClick={() => setDateIndex(i => i - 1)} style={navBtnStyle}>
          Newer →
        </button>
      </div>

      {/* Log output */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 16px', background: 'var(--color-background)' }}>
        <div className="log-output">
          {logLines.map((line, i) => (
            <div key={i} className={line.stream === 'stderr' ? 'log-line-err' : 'log-line-out'}>
              {line.content}
            </div>
          ))}
          {logLines.length === 0 && (
            <div style={{ color: 'var(--color-muted-foreground)' }}>No log output yet.</div>
          )}
        </div>
        <div ref={logEndRef} />
      </div>
    </div>
  )
}

function ToolBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', fontSize: 12, fontWeight: 500,
      background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
      borderRadius: 4, cursor: 'pointer',
      color: danger ? 'var(--color-destructive)' : 'var(--color-foreground)',
    }}>
      {label}
    </button>
  )
}

const ghostBtnStyle: React.CSSProperties = {
  padding: '3px 8px', fontSize: 12, background: 'transparent',
  border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)',
}

const navBtnStyle: React.CSSProperties = {
  padding: '3px 10px', fontSize: 11, background: 'var(--color-secondary)',
  border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer',
  color: 'var(--color-foreground)',
}
