// @group BusinessLogic : Process detail view — SSE log stream, date navigation, toolbar

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
import { EnvFileModal } from '@/components/EnvFileModal'
import { statusColor } from '@/lib/utils'
import type { AppSettings } from '@/lib/settings'
import type { LogLine, ProcessInfo } from '@/types'

interface Props {
  reload: () => void
  settings: AppSettings
}

export default function ProcessDetailPage({ reload, settings }: Props) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [process, setProcess] = useState<ProcessInfo | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [logDates, setLogDates] = useState<string[]>([])
  const [dateIndex, setDateIndex] = useState(-1) // -1 = today (live)
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all')
  const [textFilter, setTextFilter] = useState('')
  const [envOpen, setEnvOpen] = useState(false)
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
      .then(d => setLogLines(d.lines.map(l => ({ stream: l.stream, timestamp: l.timestamp ?? '', content: l.content }))))
      .catch(() => {})

    // Live SSE for today only
    if (isToday) {
      const es = api.streamLogs(id)
      esRef.current = es
      es.onmessage = (e) => {
        try {
          const line = JSON.parse(e.data)
          setLogLines(prev => [...prev, { stream: line.stream, timestamp: line.timestamp ?? '', content: line.content }])
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

  // @group BusinessLogic > LogFilter : Client-side stream + text filter applied at render time
  const needle = textFilter.toLowerCase()
  const visibleLines = logLines.filter(l =>
    (streamFilter === 'all' || l.stream === streamFilter) &&
    (needle === '' || l.content.toLowerCase().includes(needle))
  )

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
    navigate('/processes')
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
      {envOpen && (
        <EnvFileModal
          processId={process.id}
          processName={process.name}
          onClose={() => setEnvOpen(false)}
          onRestart={doRestart}
        />
      )}

      {/* Toolbar */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--color-card)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/processes')} style={ghostBtnStyle}>← Back</button>
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
          <ToolBtn label="🔑 .env" onClick={() => setEnvOpen(true)} />
          <ToolBtn label="✕ Delete" onClick={doDelete} danger />
          <ToolBtn label="⌨ Terminal" onClick={doTerminal} />
          <ToolBtn label="VS Code" onClick={doVSCode} />
        </div>
      </div>

      {/* Date navigation + stream filter */}
      <div style={{
        padding: '6px 16px', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        background: 'var(--color-muted)', fontSize: 12,
      }}>
        {/* Date pager */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

        {/* Stream filter toggle */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--color-background)', borderRadius: 6, padding: 2, border: '1px solid var(--color-border)' }}>
          {(['all', 'stdout', 'stderr'] as const).map(f => (
            <button key={f} onClick={() => setStreamFilter(f)} style={{
              padding: '2px 10px', fontSize: 11, fontWeight: 500, borderRadius: 4,
              border: 'none', cursor: 'pointer', transition: 'background 0.15s',
              background: streamFilter === f ? 'var(--color-primary)' : 'transparent',
              color: streamFilter === f ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
            }}>
              {f === 'all' ? 'All' : f === 'stdout' ? 'Out' : 'Err'}
            </button>
          ))}
        </div>
      </div>

      {/* Text search bar */}
      <div style={{
        padding: '5px 16px', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'var(--color-card)',
      }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', userSelect: 'none' }}>🔍</span>
        <input
          type="text"
          placeholder="Filter logs…"
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
          style={{
            flex: 1, fontSize: 12, padding: '3px 6px',
            background: 'var(--color-background)', color: 'var(--color-foreground)',
            border: '1px solid var(--color-border)', borderRadius: 4, outline: 'none',
          }}
        />
        {textFilter && (
          <>
            <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap' }}>
              {visibleLines.length} match{visibleLines.length !== 1 ? 'es' : ''}
            </span>
            <button
              onClick={() => setTextFilter('')}
              style={{ fontSize: 11, padding: '1px 6px', cursor: 'pointer', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-secondary)', color: 'var(--color-foreground)' }}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Log output */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 16px', background: 'var(--color-background)' }}>
        <div className="log-output">
          {visibleLines.map((line, i) => (
            <div key={i} className={line.stream === 'stderr' ? 'log-line-err' : 'log-line-out'}>
              {line.timestamp && (
                <span style={{ opacity: 0.45, marginRight: 8, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  {line.timestamp.slice(11, 19)}
                </span>
              )}
              {needle ? <HighlightedText content={line.content} needle={needle} /> : line.content}
            </div>
          ))}
          {visibleLines.length === 0 && (
            <div style={{ color: 'var(--color-muted-foreground)' }}>
              {logLines.length === 0
                ? 'No log output yet.'
                : textFilter
                  ? `No lines match "${textFilter}".`
                  : `No ${streamFilter === 'stderr' ? 'error' : 'stdout'} lines found.`}
            </div>
          )}
        </div>
        <div ref={logEndRef} />
      </div>
    </div>
  )
}

// @group Utilities : Highlight matched search text within a log line
function HighlightedText({ content, needle }: { content: string; needle: string }) {
  const parts = content.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === needle.toLowerCase()
          ? <mark key={i} style={{ background: 'rgba(255,200,0,0.35)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
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
