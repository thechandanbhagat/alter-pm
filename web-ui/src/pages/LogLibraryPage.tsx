// @group BusinessLogic : Log Library — dual-panel log browser with live streaming and date navigation

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ExternalLink, RefreshCw, ScrollText, Search, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { statusColor } from '@/lib/utils'
import type { LogLine, ProcessInfo, ProcessStatus } from '@/types'

// @group Types > LogLibrary : Per-process log file metadata
interface LogMeta {
  dates: string[]
  hasCurrent: boolean
  loading: boolean
}

interface Props {
  processes: ProcessInfo[]
  reload: () => void
}

// @group BusinessLogic > LogLibraryPage : Root component — manages process list + log meta
export default function LogLibraryPage({ processes, reload }: Props) {
  const [filter, setFilter]         = useState('')
  const [logMeta, setLogMeta]       = useState<Record<string, LogMeta>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flushing, setFlushing]     = useState<string | null>(null)
  const fetchedIds = useRef<Set<string>>(new Set())

  // @group BusinessLogic > DataFetch : Only fetch log dates for new process IDs — never wipe already-loaded data
  useEffect(() => {
    if (!processes.length) return

    const currentIds = new Set(processes.map(p => p.id))
    const toFetch    = processes.filter(p => !fetchedIds.current.has(p.id))

    // Remove stale IDs from state (processes that were deleted)
    const removedIds = [...fetchedIds.current].filter(id => !currentIds.has(id))
    if (removedIds.length > 0) {
      fetchedIds.current = new Set([...fetchedIds.current].filter(id => currentIds.has(id)))
      setLogMeta(prev => {
        const next = { ...prev }
        for (const id of removedIds) delete next[id]
        return next
      })
    }

    if (toFetch.length === 0) return

    for (const p of toFetch) fetchedIds.current.add(p.id)
    setLogMeta(prev => {
      const next = { ...prev }
      for (const p of toFetch) next[p.id] = { dates: [], hasCurrent: false, loading: true }
      return next
    })

    Promise.all(
      toFetch.map(p =>
        api.getLogDates(p.id)
          .then(d => ({ id: p.id, dates: d.dates, hasCurrent: d.has_current, loading: false }))
          .catch(() => ({ id: p.id, dates: [], hasCurrent: false, loading: false }))
      )
    ).then(results => {
      setLogMeta(prev => {
        const next = { ...prev }
        for (const r of results) next[r.id] = { dates: r.dates, hasCurrent: r.hasCurrent, loading: r.loading }
        return next
      })
    })
  }, [processes])

  // @group BusinessLogic > AutoSelect : Pick first process on mount
  useEffect(() => {
    if (!selectedId && processes.length > 0) setSelectedId(processes[0].id)
  }, [processes])

  // @group BusinessLogic > FlushLogs : Delete all log files for a process
  // Stable: only depends on selectedId, which is a string
  const handleFlushSelected = useCallback(async (name: string) => {
    if (!selectedId) return
    if (!confirm(`Delete all log files for "${name}"?`)) return
    setFlushing(selectedId)
    try {
      await api.deleteLogs(selectedId)
      const d = await api.getLogDates(selectedId).catch(() => ({ dates: [], has_current: false }))
      setLogMeta(prev => ({ ...prev, [selectedId]: { dates: d.dates, hasCurrent: d.has_current, loading: false } }))
    } finally {
      setFlushing(null)
    }
  }, [selectedId])

  // @group BusinessLogic > MetaRefresh : Re-fetch log dates for the selected process
  const handleMetaRefresh = useCallback(async () => {
    if (!selectedId) return
    const d = await api.getLogDates(selectedId).catch(() => ({ dates: [], has_current: false }))
    setLogMeta(prev => ({ ...prev, [selectedId]: { dates: d.dates, hasCurrent: d.has_current, loading: false } }))
  }, [selectedId])

  // @group BusinessLogic > Filter : Namespace-grouped filtered process list
  const filtered = useMemo(() =>
    processes.filter(p =>
      filter === '' ||
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      (p.namespace ?? 'default').toLowerCase().includes(filter.toLowerCase())
    ),
    [processes, filter]
  )

  const groups = useMemo(() => {
    const g = new Map<string, ProcessInfo[]>()
    for (const p of filtered) {
      const ns = p.namespace || 'default'
      if (!g.has(ns)) g.set(ns, [])
      g.get(ns)!.push(p)
    }
    return [...g.entries()].sort(([a], [b]) =>
      a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)
    )
  }, [filtered])

  const totalLogFiles = useMemo(() =>
    Object.values(logMeta).reduce((s, m) => s + m.dates.length + (m.hasCurrent ? 1 : 0), 0),
    [logMeta]
  )

  const stillLoading    = useMemo(() => Object.values(logMeta).some(m => m.loading), [logMeta])
  const selectedProcess = useMemo(() => processes.find(p => p.id === selectedId) ?? null, [processes, selectedId])
  const selectedMeta    = selectedId ? logMeta[selectedId] : undefined

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel: process list ── */}
      <aside style={{
        width: 256, minWidth: 256, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-card)',
        overflow: 'hidden',
      }}>

        {/* Panel header */}
        <div style={{
          padding: '12px 14px 10px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', flexDirection: 'column', gap: 8,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <ScrollText size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>Log Library</span>
            </div>
            <button onClick={reload} title="Refresh process list" style={iconBtnStyle}>
              <RefreshCw size={12} />
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>
            {processes.length} process{processes.length !== 1 ? 'es' : ''}
            {' · '}
            {stillLoading ? 'counting…' : `${totalLogFiles} log file${totalLogFiles !== 1 ? 's' : ''}`}
          </div>

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={11} style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-muted-foreground)', pointerEvents: 'none',
            }} />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter processes…"
              style={{
                width: '100%', boxSizing: 'border-box',
                paddingLeft: 26, paddingRight: filter ? 26 : 8,
                paddingTop: 5, paddingBottom: 5,
                fontSize: 11, background: 'var(--color-secondary)',
                border: '1px solid var(--color-border)', borderRadius: 5,
                color: 'var(--color-foreground)', outline: 'none',
              }}
            />
            {filter && (
              <button
                onClick={() => setFilter('')}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)', padding: 0, display: 'flex', alignItems: 'center' }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Process list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {processes.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--color-muted-foreground)', fontSize: 12, textAlign: 'center' }}>
              No processes registered
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--color-muted-foreground)', fontSize: 12, textAlign: 'center' }}>
              No match for "{filter}"
            </div>
          ) : (
            groups.map(([ns, procs]) => (
              <div key={ns}>
                <div style={{
                  padding: '8px 14px 3px',
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                  color: 'var(--color-muted-foreground)', textTransform: 'uppercase',
                }}>
                  {ns}
                </div>
                {procs.map(p => (
                  <ProcessRow
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    status={p.status}
                    meta={logMeta[p.id]}
                    isSelected={p.id === selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Right panel: log viewer ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {selectedProcess ? (
          <LogViewer
            processId={selectedProcess.id}
            processName={selectedProcess.name}
            processStatus={selectedProcess.status}
            processScript={selectedProcess.script}
            meta={selectedMeta}
            isFlushing={flushing === selectedProcess.id}
            onFlush={handleFlushSelected}
            onMetaRefresh={handleMetaRefresh}
          />
        ) : (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-muted-foreground)', gap: 10,
          }}>
            <ScrollText size={32} style={{ opacity: 0.15 }} />
            <span style={{ fontSize: 13 }}>Select a process to browse its logs</span>
          </div>
        )}
      </div>
    </div>
  )
}

// @group BusinessLogic > ProcessRow : Memoized process list row — hover via state, not DOM mutation
const ProcessRow = memo(function ProcessRow({ id, name, status, meta, isSelected, onSelect }: {
  id: string
  name: string
  status: ProcessStatus
  meta: LogMeta | undefined
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const fileCount = (meta?.hasCurrent ? 1 : 0) + (meta?.dates.length ?? 0)

  return (
    <button
      onClick={() => onSelect(id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 14px', border: 'none', textAlign: 'left',
        background: isSelected || hovered ? 'var(--color-accent)' : 'transparent',
        borderLeft: isSelected ? '2px solid var(--color-primary)' : '2px solid transparent',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      <span style={{ color: statusColor(status), fontSize: 8, flexShrink: 0 }}>●</span>
      <span style={{
        flex: 1, fontSize: 12, fontWeight: isSelected ? 600 : 400,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: 'var(--color-foreground)',
      }}>
        {name}
      </span>
      {meta?.loading ? (
        <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', opacity: 0.4 }}>…</span>
      ) : fileCount > 0 ? (
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 8,
          background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
          color: 'var(--color-muted-foreground)',
        }}>
          {fileCount}
        </span>
      ) : (
        <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', opacity: 0.3 }}>—</span>
      )}
      {isSelected && <ChevronRight size={10} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />}
    </button>
  )
}, (prev, next) =>
  prev.id         === next.id &&
  prev.name       === next.name &&
  prev.status     === next.status &&
  prev.meta       === next.meta &&
  prev.isSelected === next.isSelected
  // onSelect is setSelectedId — stable React setState setter, safe to skip
)

// @group BusinessLogic > LogViewer : Right-panel viewer — live stream + archived date navigation
// Memoized: only re-renders when process identity, status, meta, or flushing state changes
const LogViewer = memo(function LogViewer({ processId, processName, processStatus, processScript, meta, isFlushing, onFlush, onMetaRefresh }: {
  processId: string
  processName: string
  processStatus: ProcessStatus
  processScript: string
  meta: LogMeta | undefined
  isFlushing: boolean
  onFlush: (name: string) => void
  onMetaRefresh: () => void
}) {
  const navigate = useNavigate()
  const [dateIndex, setDateIndex]       = useState(-1)
  const [logLines, setLogLines]         = useState<LogLine[]>([])
  const [loadingLogs, setLoadingLogs]   = useState(false)
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all')
  const [textFilter, setTextFilter]     = useState('')
  const esRef     = useRef<EventSource | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom  = useRef(true)

  // @group BusinessLogic > LogViewer : Reset state when selected process changes
  useEffect(() => {
    setDateIndex(-1)
    setLogLines([])
    setTextFilter('')
    setStreamFilter('all')
  }, [processId])

  // Sorted dates — most recent first
  const dates = useMemo(() =>
    [...(meta?.dates ?? [])].sort().reverse(),
    [meta]
  )

  // @group BusinessLogic > LogViewer : Load logs when process or date changes
  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }

    if (dateIndex === -1) {
      setLoadingLogs(true)
      api.getLogs(processId, { lines: 500 })
        .then(r => { setLogLines(r.lines); setLoadingLogs(false) })
        .catch(() => setLoadingLogs(false))

      const es = api.streamLogs(processId)
      esRef.current = es
      es.addEventListener('log', (e: MessageEvent) => {
        try {
          const line = JSON.parse(e.data) as LogLine
          setLogLines(prev => [...prev.slice(-2000), line])
        } catch { /* ignore malformed SSE */ }
      })
    } else {
      const date = dates[dateIndex]
      if (!date) return
      setLoadingLogs(true)
      api.getLogs(processId, { lines: 2000, date })
        .then(r => { setLogLines(r.lines); setLoadingLogs(false) })
        .catch(() => setLoadingLogs(false))
    }

    return () => { if (esRef.current) { esRef.current.close(); esRef.current = null } }
  }, [processId, dateIndex])

  // @group BusinessLogic > LogViewer : Auto-scroll when new lines arrive
  useEffect(() => {
    if (atBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logLines])

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  // @group BusinessLogic > LogViewer : Apply stream + text filters
  const filteredLines = useMemo(() => {
    let lines = logLines
    if (streamFilter !== 'all') lines = lines.filter(l => l.stream === streamFilter)
    if (textFilter) {
      const q = textFilter.toLowerCase()
      lines = lines.filter(l => l.content.toLowerCase().includes(q))
    }
    return lines
  }, [logLines, streamFilter, textFilter])

  // Memoize derived counts to avoid re-filtering on every render
  const stderrCount = useMemo(
    () => filteredLines.filter(l => l.stream === 'stderr').length,
    [filteredLines]
  )

  // Stable date-tab click handlers — one per tab, created only when dates changes
  const dateTabHandlers = useMemo(() => {
    const handlers: Array<() => void> = [() => setDateIndex(-1)]
    for (let i = 0; i < dates.length; i++) {
      const idx = i
      handlers.push(() => setDateIndex(idx))
    }
    return handlers
  }, [dates])

  const isLive     = dateIndex === -1
  const hasCurrent = meta?.hasCurrent ?? false

  return (
    <>
      {/* ── Viewer header ── */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-card)',
        display: 'flex', flexDirection: 'column', gap: 10,
        flexShrink: 0,
      }}>

        {/* Process info row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: statusColor(processStatus), fontSize: 9, flexShrink: 0 }}>●</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{processName}</span>
          <span style={{
            fontSize: 10, fontWeight: 500, padding: '1px 7px',
            background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
            borderRadius: 10, color: 'var(--color-muted-foreground)',
          }}>
            {processStatus}
          </span>
          <span style={{
            fontSize: 11, color: 'var(--color-muted-foreground)', fontFamily: 'monospace',
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={processScript}>
            {processScript}
          </span>
          <button onClick={() => navigate(`/processes/${processId}`)} style={actionBtnStyle}>
            <ExternalLink size={11} /> Full view
          </button>
          <button
            onClick={async () => { await onFlush(processName); onMetaRefresh() }}
            disabled={isFlushing}
            title="Delete all log files for this process"
            style={{ ...actionBtnStyle, color: isFlushing ? 'var(--color-muted-foreground)' : 'var(--color-destructive)', opacity: isFlushing ? 0.5 : 1 }}
          >
            <Trash2 size={11} /> Clear logs
          </button>
        </div>

        {/* Date tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)', flexShrink: 0 }}>
            Date:
          </span>
          <DateTab label="Today" isLive active={isLive} dimmed={!hasCurrent} onClick={dateTabHandlers[0]} />
          {dates.map((d, i) => (
            <DateTab key={d} label={d} active={dateIndex === i} onClick={dateTabHandlers[i + 1]} />
          ))}
          {!hasCurrent && dates.length === 0 && !meta?.loading && (
            <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', opacity: 0.6 }}>
              No log files found
            </span>
          )}
          {meta?.loading && (
            <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', opacity: 0.5 }}>Loading…</span>
          )}
        </div>

        {/* Filter toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Stream filter */}
          <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 5, overflow: 'hidden' }}>
            {(['all', 'stdout', 'stderr'] as const).map(s => (
              <button key={s} onClick={() => setStreamFilter(s)} style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 500,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: streamFilter === s ? 'var(--color-primary)' : 'var(--color-secondary)',
                color: streamFilter === s ? '#fff'
                  : s === 'stderr' ? 'var(--color-status-crashed)'
                  : s === 'stdout' ? 'var(--color-status-running)'
                  : 'var(--color-muted-foreground)',
              }}>
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>

          {/* Text search */}
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <Search size={11} style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-muted-foreground)', pointerEvents: 'none',
            }} />
            <input
              value={textFilter}
              onChange={e => setTextFilter(e.target.value)}
              placeholder="Search log content…"
              style={{
                width: '100%', boxSizing: 'border-box',
                paddingLeft: 26, paddingRight: textFilter ? 26 : 8,
                paddingTop: 4, paddingBottom: 4, fontSize: 11,
                background: 'var(--color-secondary)',
                border: '1px solid var(--color-border)', borderRadius: 5,
                color: 'var(--color-foreground)', outline: 'none',
              }}
            />
            {textFilter && (
              <button
                onClick={() => setTextFilter('')}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)', padding: 0, display: 'flex', alignItems: 'center' }}
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Stats */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--color-muted-foreground)', flexShrink: 0 }}>
            {stderrCount > 0 && (
              <span style={{ color: 'var(--color-status-crashed)' }}>{stderrCount} stderr</span>
            )}
            <span>{filteredLines.length} lines</span>
            {isLive && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-status-running)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-status-running)', flexShrink: 0 }} />
                live
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Log content ── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflow: 'auto',
          fontFamily: 'monospace', fontSize: 11.5, lineHeight: 1.55,
          background: 'var(--color-background)',
          padding: '6px 0',
        }}
      >
        {loadingLogs ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-muted-foreground)', fontSize: 12 }}>
            Loading logs…
          </div>
        ) : filteredLines.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-muted-foreground)', fontSize: 12 }}>
            {logLines.length > 0
              ? 'No lines match the current filter.'
              : isLive
                ? 'No log output yet — waiting for new lines.'
                : 'No log lines for this date.'
            }
          </div>
        ) : (
          filteredLines.map((line, i) => (
            <LogLineRow key={i} line={line} textFilter={textFilter} />
          ))
        )}
      </div>
    </>
  )
}, (prev, next) =>
  prev.processId     === next.processId     &&
  prev.processStatus === next.processStatus &&
  prev.processName   === next.processName   &&
  prev.processScript === next.processScript &&
  prev.meta          === next.meta          &&
  prev.isFlushing    === next.isFlushing
  // onFlush/onMetaRefresh intentionally excluded: they're useCallback-stable in the parent
)

// @group BusinessLogic > DateTab : Memoized date pill — stable as long as label and active don't change
const DateTab = memo(function DateTab({ label, active, isLive, dimmed, onClick }: {
  label: string
  active: boolean
  isLive?: boolean
  dimmed?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 10px', fontSize: 10, fontWeight: active ? 600 : 400,
        border: `1px solid ${active ? (isLive ? 'rgba(34,197,94,0.5)' : 'var(--color-primary)') : 'var(--color-border)'}`,
        borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
        background: active
          ? (isLive ? 'rgba(34,197,94,0.1)' : 'var(--color-accent)')
          : 'var(--color-secondary)',
        color: active
          ? (isLive ? 'var(--color-status-running)' : 'var(--color-primary)')
          : 'var(--color-foreground)',
        opacity: dimmed && !active ? 0.45 : 1,
        display: 'flex', alignItems: 'center', gap: 5,
      }}
    >
      {isLive && active && (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-status-running)', flexShrink: 0 }} />
      )}
      {label}
    </button>
  )
})

// @group BusinessLogic > LogLineRow : Memoized log line — skips re-render when line and filter unchanged
const LogLineRow = memo(function LogLineRow({ line, textFilter }: { line: LogLine; textFilter: string }) {
  const isErr = line.stream === 'stderr'
  const ts    = new Date(line.timestamp)
  const timeStr = [
    String(ts.getHours()).padStart(2, '0'),
    String(ts.getMinutes()).padStart(2, '0'),
    String(ts.getSeconds()).padStart(2, '0'),
  ].join(':')

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start',
      padding: '1px 14px',
      background: isErr ? 'rgba(239,68,68,0.04)' : 'transparent',
      borderLeft: isErr ? '2px solid rgba(239,68,68,0.2)' : '2px solid transparent',
    }}>
      <span style={{
        color: 'var(--color-muted-foreground)', opacity: 0.45,
        minWidth: 58, flexShrink: 0, userSelect: 'none', fontSize: 10, paddingTop: 2,
      }}>
        {timeStr}
      </span>
      <span style={{
        minWidth: 32, flexShrink: 0, fontSize: 9, fontWeight: 700,
        color: isErr ? 'var(--color-status-crashed)' : 'var(--color-status-running)',
        opacity: 0.65, userSelect: 'none', paddingTop: 2, paddingRight: 10,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {isErr ? 'err' : 'out'}
      </span>
      <span style={{
        flex: 1, wordBreak: 'break-all',
        color: isErr ? 'var(--color-status-crashed)' : 'var(--color-foreground)',
      }}>
        <HighlightedText text={line.content} query={textFilter} />
      </span>
    </div>
  )
})

// @group BusinessLogic > HighlightedText : Highlight all occurrences of query in text
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>

  const lower  = text.toLowerCase()
  const qLower = query.toLowerCase()
  const parts: { str: string; match: boolean }[] = []
  let pos = 0

  while (pos < text.length) {
    const idx = lower.indexOf(qLower, pos)
    if (idx === -1) { parts.push({ str: text.slice(pos), match: false }); break }
    if (idx > pos) parts.push({ str: text.slice(pos, idx), match: false })
    parts.push({ str: text.slice(idx, idx + query.length), match: true })
    pos = idx + query.length
  }

  return (
    <>
      {parts.map((p, i) =>
        p.match
          ? <mark key={i} style={{ background: 'rgba(251,191,36,0.35)', color: 'inherit', borderRadius: 2 }}>{p.str}</mark>
          : <span key={i}>{p.str}</span>
      )}
    </>
  )
}

// @group Utilities > Styles : Shared style constants
const iconBtnStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, padding: 0,
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-foreground)',
} as const

const actionBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '4px 10px', fontSize: 11, fontWeight: 500,
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-foreground)',
  whiteSpace: 'nowrap', fontFamily: 'inherit',
} as const
