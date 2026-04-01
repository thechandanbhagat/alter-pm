// @group BusinessLogic : Process detail view — SSE log stream, date navigation, toolbar

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SquareTerminal, Copy, Check, FolderOpen } from 'lucide-react'
import { api } from '@/lib/api'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
import { EnvFileModal } from '@/components/EnvFileModal'
import { statusColor } from '@/lib/utils'
import type { AppSettings } from '@/lib/settings'
import type { GitInfo, LogLine, LogStatsBucket, MetricSample, ProcessInfo } from '@/types'

interface Props {
  reload: () => void
  settings: AppSettings
  onOpenTerminal?: (cwd: string, name?: string) => void
}

export default function ProcessDetailPage({ reload, settings, onOpenTerminal }: Props) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [process, setProcess] = useState<ProcessInfo | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [logDates, setLogDates] = useState<string[]>([])
  const [dateIndex, setDateIndex] = useState(-1) // -1 = today (live)
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all')
  const [textFilter, setTextFilter] = useState('')
  const [envOpen, setEnvOpen] = useState(false)
  const [logStats, setLogStats] = useState<LogStatsBucket[]>([])
  const [metricSamples, setMetricSamples] = useState<MetricSample[]>([])
  const [sliderPos, setSliderPos] = useState(1000) // 0–1000 = 0%–100% of scroll, starts pinned to bottom
  const logEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true) // tracks whether user is pinned to bottom
  const esRef = useRef<EventSource | null>(null)
  const { dialogState, confirm, danger, alert, handleConfirm, handleCancel } = useDialog()
  const [cwdCopied, setCwdCopied] = useState(false)

  // @group BusinessLogic > Git : Git repo info + pull state
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [gitStatus, setGitStatus] = useState<'idle' | 'pulling' | 'done' | 'error'>('idle')
  const [gitLog, setGitLog] = useState<string | null>(null)
  const [gitLogOpen, setGitLogOpen] = useState(false)

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

  // @group BusinessLogic > LogStats : Fetch today's log volume buckets; refresh every 5 minutes
  useEffect(() => {
    if (!id) return
    function fetchStats() {
      api.getLogStats(id!).then(r => setLogStats(r.buckets)).catch(() => {})
    }
    fetchStats()
    const t = setInterval(fetchStats, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [id])

  // @group BusinessLogic > Metrics : Fetch CPU/memory history; refresh every 60 seconds
  useEffect(() => {
    if (!id) return
    function fetchMetrics() {
      api.getMetricsHistory(id!).then(r => setMetricSamples(r.samples)).catch(() => {})
    }
    fetchMetrics()
    const t = setInterval(fetchMetrics, 60 * 1000)
    return () => clearInterval(t)
  }, [id])

  // @group BusinessLogic > Git : Fetch git info once on mount (and after pull)
  useEffect(() => {
    if (!id) return
    api.getProcessGit(id).then(setGitInfo).catch(() => {})
  }, [id])

  // Load historical logs + start SSE when dateIndex changes
  useEffect(() => {
    if (!id) return
    // Stop existing SSE
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setLogLines([])
    atBottomRef.current = true // re-pin on every fresh load

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

  // @group BusinessLogic > LogScroll : Track pin state + keep slider in sync with manual scrolling
  function handleLogScroll() {
    const el = scrollRef.current
    if (!el) return
    const maxScroll = el.scrollHeight - el.clientHeight
    atBottomRef.current = maxScroll - el.scrollTop < 60
    // Sync slider with manual scroll position (today only)
    if (dateIndex === -1 && maxScroll > 0) {
      setSliderPos(Math.round((el.scrollTop / maxScroll) * 1000))
    }
  }

  // @group BusinessLogic > LogScroll : Seek to slider position
  function handleSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value)
    setSliderPos(val)
    const el = scrollRef.current
    if (!el) return
    const atEnd = val >= 1000
    atBottomRef.current = atEnd
    el.scrollTop = (val / 1000) * (el.scrollHeight - el.clientHeight)
  }

  // Auto-scroll to bottom + pin slider to right when new lines arrive and already pinned
  useEffect(() => {
    if (atBottomRef.current) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      setSliderPos(1000)
    }
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

  // @group BusinessLogic > LogSlider : Timestamp label at current slider seek position
  const sliderLineIdx = Math.round((sliderPos / 1000) * Math.max(0, visibleLines.length - 1))
  const sliderTimestamp = visibleLines[sliderLineIdx]?.timestamp?.slice(11, 19) ?? ''

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
  function doTerminal() {
    if (onOpenTerminal && process?.cwd) {
      onOpenTerminal(process.cwd, process.name)
    }
  }
  async function doGitPull() {
    setGitStatus('pulling')
    setGitLog(null)
    setGitLogOpen(false)
    try {
      const result = await api.gitPull(process!.id)
      const log = [result.pull_output, result.deps_output].filter(Boolean).join('\n\n---\n\n')
      setGitLog(log)
      setGitStatus('done')
      setGitLogOpen(true)
      // Refresh git info + process after pull
      api.getProcessGit(process!.id).then(setGitInfo).catch(() => {})
      setTimeout(reload, 1000)
    } catch (e: unknown) {
      setGitLog((e as Error)?.message ?? 'Pull failed')
      setGitStatus('error')
      setGitLogOpen(true)
    }
  }

  async function doOpenFolder() {
    if (!process!.cwd) return
    await api.openFolder(process!.cwd).catch(() => {})
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

          {/* Terminal button group — terminal + copy path + open explorer */}
          <div style={{ display: 'flex', gap: 0 }}>
            {/* Open terminal — shows full cwd path on hover */}
            <button
              onClick={doTerminal}
              title={process.cwd ? `Open terminal at:\n${process.cwd}` : 'Open terminal'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', fontSize: 12, fontWeight: 500,
                background: 'var(--color-secondary)',
                border: '1px solid var(--color-border)',
                borderRight: 'none',
                borderRadius: '4px 0 0 4px',
                cursor: 'pointer', color: 'var(--color-foreground)', fontFamily: 'inherit',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-secondary)' }}
            >
              <SquareTerminal size={12} />
              Terminal
            </button>

            {/* Copy path to clipboard */}
            {process.cwd && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(process.cwd!).then(() => {
                    setCwdCopied(true)
                    setTimeout(() => setCwdCopied(false), 1500)
                  })
                }}
                title={`Copy path: ${process.cwd}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, padding: '4px 0',
                  background: 'var(--color-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRight: 'none',
                  borderRadius: 0,
                  cursor: 'pointer',
                  color: cwdCopied ? '#4ade80' : 'var(--color-muted-foreground)',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-secondary)' }}
              >
                {cwdCopied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            )}

            {/* Open in Explorer */}
            {process.cwd && (
              <button
                onClick={doOpenFolder}
                title={`Open in Explorer: ${process.cwd}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, padding: '4px 0',
                  background: 'var(--color-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '0 4px 4px 0',
                  cursor: 'pointer',
                  color: 'var(--color-muted-foreground)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-secondary)' }}
              >
                <FolderOpen size={11} />
              </button>
            )}
          </div>

          <ToolBtn label="VS Code" onClick={doVSCode} />
        </div>
      </div>

      {/* Git strip — shown only for git repos */}
      {gitInfo?.is_git_repo && (
        <div style={{
          padding: '6px 16px', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-card)', flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Branch */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
              color: 'var(--color-primary)', borderRadius: 4,
              padding: '1px 7px', fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
            }}>
              ⎇ {gitInfo.branch ?? 'HEAD'}
            </span>

            {/* Short SHA */}
            {gitInfo.sha_short && (
              <code style={{ fontSize: 10, color: 'var(--color-muted-foreground)', fontFamily: 'monospace' }}>
                {gitInfo.sha_short}
              </code>
            )}

            {/* Commit message */}
            {gitInfo.message && (
              <span style={{ fontSize: 11, color: 'var(--color-foreground)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {gitInfo.message}
              </span>
            )}

            {/* Dirty indicator */}
            {gitInfo.dirty && (
              <span style={{ fontSize: 10, color: '#f97316', fontWeight: 600 }} title="Uncommitted changes">✎ modified</span>
            )}

            {/* Ahead / behind */}
            {gitInfo.behind > 0 && (
              <span style={{ fontSize: 10, color: 'var(--color-destructive)', fontWeight: 600 }}>↓{gitInfo.behind} behind</span>
            )}
            {gitInfo.ahead > 0 && (
              <span style={{ fontSize: 10, color: 'var(--color-status-running)', fontWeight: 600 }}>↑{gitInfo.ahead} ahead</span>
            )}

            {/* Package manager badge */}
            {gitInfo.pkg_manager !== 'none' && (
              <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', background: 'var(--color-secondary)', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace' }}>
                {gitInfo.pkg_manager}
              </span>
            )}

            <div style={{ flex: 1 }} />

            {/* Pull & Restart button */}
            <button
              onClick={gitStatus === 'pulling' ? undefined : doGitPull}
              disabled={gitStatus === 'pulling'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                border: 'none', cursor: gitStatus === 'pulling' ? 'default' : 'pointer',
                background: gitStatus === 'done' ? 'var(--color-status-running)'
                  : gitStatus === 'error' ? 'var(--color-destructive)'
                  : 'var(--color-primary)',
                color: '#fff',
                opacity: gitStatus === 'pulling' ? 0.7 : 1,
                flexShrink: 0,
              }}
            >
              {gitStatus === 'pulling' ? '⟳ Pulling…'
                : gitStatus === 'done' ? '✓ Done'
                : gitStatus === 'error' ? '✕ Failed'
                : '↓ Pull & Restart'}
            </button>

            {/* Reset to idle after done/error */}
            {(gitStatus === 'done' || gitStatus === 'error') && (
              <button
                onClick={() => { setGitStatus('idle'); setGitLog(null); setGitLogOpen(false) }}
                style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)' }}
              >✕</button>
            )}
          </div>

          {/* Pull output log */}
          {gitLog && gitLogOpen && (
            <pre style={{
              marginTop: 6, fontSize: 10, fontFamily: 'monospace',
              background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
              borderRadius: 4, padding: '6px 8px', maxHeight: 140, overflow: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              color: gitStatus === 'error' ? 'var(--color-destructive)' : 'var(--color-foreground)',
            }}>
              {gitLog}
            </pre>
          )}
          {gitLog && !gitLogOpen && (
            <button
              onClick={() => setGitLogOpen(true)}
              style={{ fontSize: 10, marginTop: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)', textAlign: 'left', padding: 0 }}
            >
              ▸ Show output
            </button>
          )}
        </div>
      )}

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

      {/* Time scrubber — today only, shown when logs are loaded */}
      {isToday && visibleLines.length > 1 && (
        <div style={{
          padding: '5px 16px 6px', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-card)', flexShrink: 0,
        }}>
          <input
            type="range" min={0} max={1000} value={sliderPos}
            onChange={handleSlider}
            style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer', display: 'block', margin: 0 }}
          />
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: 3,
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span>{visibleLines[0]?.timestamp?.slice(11, 19) ?? ''}</span>
            <span style={{ color: sliderPos >= 990 ? 'var(--color-status-running)' : 'var(--color-primary)' }}>
              {sliderPos >= 990 ? '● live' : `▸ ${sliderTimestamp}`}
            </span>
            <span>{visibleLines[visibleLines.length - 1]?.timestamp?.slice(11, 19) ?? ''}</span>
          </div>
        </div>
      )}

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

      {/* Unified collapsible metrics panel */}
      <MetricsPanel buckets={logStats} samples={metricSamples} />

      {/* Log output */}
      <div ref={scrollRef} onScroll={handleLogScroll} style={{ flex: 1, overflow: 'auto', padding: '10px 16px', background: 'var(--color-background)' }}>
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

// @group Utilities : Format bytes as human-readable string
function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

// @group BusinessLogic > MetricsPanel : Collapsible panel — shows live stats in header, expands to tabbed charts
function MetricsPanel({ buckets, samples }: {
  buckets: LogStatsBucket[]
  samples: MetricSample[]
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'logs' | 'cpu' | 'mem'>('logs')

  const totalOut = buckets.reduce((s, b) => s + b.stdout_count, 0)
  const totalErr = buckets.reduce((s, b) => s + b.stderr_count, 0)

  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
  const todaySamples = samples.filter(s => new Date(s.timestamp).getTime() >= todayMidnight.getTime())
  const latest = todaySamples[todaySamples.length - 1]

  const hasCpu = latest != null
  const hasMem = latest != null
  const hasLogs = buckets.length > 0

  const hasAny = hasCpu || hasMem || hasLogs
  if (!hasAny) return null

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-card)', flexShrink: 0 }}>
      {/* Collapsed header — always visible, click to toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)', letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>
          Metrics
        </span>
        {/* Live stats pills */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
          {hasCpu && (
            <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary)' }}>
              CPU {latest!.cpu_percent.toFixed(1)}%
            </span>
          )}
          {hasMem && (
            <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: '#a78bfa' }}>
              {fmtBytes(latest!.memory_bytes)}
            </span>
          )}
          {hasLogs && (
            <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--color-muted-foreground)' }}>
              <span style={{ color: 'var(--color-status-running)' }}>{totalOut}</span>
              {' / '}
              <span style={{ color: 'var(--color-status-crashed)' }}>{totalErr}</span>
              {' lines today'}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {/* Expanded charts area */}
      {open && (
        <div style={{ padding: '0 16px 10px' }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 8, background: 'var(--color-background)', borderRadius: 6, padding: 2, border: '1px solid var(--color-border)', width: 'fit-content' }}>
            {([['logs', 'Log Volume'], ['cpu', 'CPU'], ['mem', 'Memory']] as const).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '3px 12px', fontSize: 11, fontWeight: 500, borderRadius: 4,
                border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                background: tab === t ? 'var(--color-primary)' : 'transparent',
                color: tab === t ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
              }}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'logs' && hasLogs && <LogVolumeContent buckets={buckets} />}
          {tab === 'cpu' && hasCpu && <CpuContent samples={todaySamples} />}
          {tab === 'mem' && hasMem && <MemContent samples={todaySamples} />}
        </div>
      )}
    </div>
  )
}

// @group BusinessLogic > MetricsPanel : Log volume bar chart content
function LogVolumeContent({ buckets }: { buckets: LogStatsBucket[] }) {
  const [filter, setFilter] = useState<'both' | 'stdout' | 'stderr'>('both')
  const totalOut = buckets.reduce((s, b) => s + b.stdout_count, 0)
  const totalErr = buckets.reduce((s, b) => s + b.stderr_count, 0)
  const maxCount = Math.max(...buckets.map(b => {
    if (filter === 'stdout') return b.stdout_count
    if (filter === 'stderr') return b.stderr_count
    return b.stdout_count + b.stderr_count
  }), 1)
  const slots = buildDaySlots(buckets)
  const W = 800, H = 48
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
  const nowX = ((Date.now() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000)) * W
  const n = slots.length
  const barW = Math.max(1, (W / n) - 0.5)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>5 min intervals · today</span>
        <div style={{ display: 'flex', gap: 2, background: 'var(--color-background)', borderRadius: 6, padding: 2, border: '1px solid var(--color-border)' }}>
          {(['both', 'stdout', 'stderr'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '2px 8px', fontSize: 11, fontWeight: 500, borderRadius: 4,
              border: 'none', cursor: 'pointer', transition: 'background 0.15s',
              background: filter === f ? 'var(--color-primary)' : 'transparent',
              color: filter === f ? 'var(--color-primary-foreground)'
                : f === 'stdout' ? 'var(--color-status-running)'
                : f === 'stderr' ? 'var(--color-status-crashed)'
                : 'var(--color-muted-foreground)',
            }}>
              {f === 'both' ? 'Both' : f === 'stdout' ? `Out ${totalOut}` : `Err ${totalErr}`}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2 4" />
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="var(--color-muted-foreground)" strokeWidth={0.75} strokeOpacity={0.35} />
        {slots.map((s, i) => {
          if (s.isFuture) return null
          const x = i * (W / n)
          const showOut = filter === 'both' || filter === 'stdout'
          const showErr = filter === 'both' || filter === 'stderr'
          const outH = showOut ? (s.stdout_count / maxCount) * H : 0
          const errH = showErr ? (s.stderr_count / maxCount) * H : 0
          const totalH = outH + errH
          if (totalH < 0.5) return null
          return (
            <g key={i}>
              {errH > 0.5 && <rect x={x} y={H - totalH} width={barW} height={errH} fill="var(--color-status-crashed)" fillOpacity={0.8} />}
              {outH > 0.5 && <rect x={x} y={H - outH} width={barW} height={outH} fill="var(--color-status-running)" fillOpacity={0.8} />}
            </g>
          )
        })}
      </svg>
      <TimeAxis nowX={nowX} W={W} />
    </>
  )
}

// @group BusinessLogic > MetricsPanel : CPU line chart content
function CpuContent({ samples }: { samples: MetricSample[] }) {
  const W = 800, H = 60
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
  const startMs = todayMidnight.getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const nowX = ((Date.now() - startMs) / dayMs) * W
  function toX(ts: string) { return ((new Date(ts).getTime() - startMs) / dayMs) * W }
  const pts = samples.map(s => `${toX(s.timestamp).toFixed(1)},${(H - (Math.min(s.cpu_percent, 100) / 100) * H).toFixed(1)}`).join(' ')
  const fill = samples.length ? `${toX(samples[0].timestamp).toFixed(1)},${H} ${pts} ${toX(samples[samples.length-1].timestamp).toFixed(1)},${H}` : ''
  const peak = Math.max(...samples.map(s => s.cpu_percent), 0)
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted-foreground)', marginBottom: 4 }}>
        <span>1 min samples · today</span>
        <span>peak {peak.toFixed(1)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        <defs>
          <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2 4" />
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="var(--color-primary)" strokeWidth={0.75} strokeOpacity={0.35} />
        {fill && <polygon points={fill} fill="url(#cpuFill)" />}
        {pts && <polyline points={pts} fill="none" stroke="var(--color-primary)" strokeWidth={1.5} strokeLinejoin="round" />}
      </svg>
      <TimeAxis nowX={nowX} W={W} />
    </>
  )
}

// @group BusinessLogic > MetricsPanel : Memory line chart content
function MemContent({ samples }: { samples: MetricSample[] }) {
  const W = 800, H = 60
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
  const startMs = todayMidnight.getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const nowX = ((Date.now() - startMs) / dayMs) * W
  function toX(ts: string) { return ((new Date(ts).getTime() - startMs) / dayMs) * W }
  const maxMem = Math.max(...samples.map(s => s.memory_bytes), 1)
  const pts = samples.map(s => `${toX(s.timestamp).toFixed(1)},${(H - (s.memory_bytes / maxMem) * H).toFixed(1)}`).join(' ')
  const fill = samples.length ? `${toX(samples[0].timestamp).toFixed(1)},${H} ${pts} ${toX(samples[samples.length-1].timestamp).toFixed(1)},${H}` : ''
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted-foreground)', marginBottom: 4 }}>
        <span>1 min samples · today</span>
        <span>peak {fmtBytes(maxMem)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        <defs>
          <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="2 4" />
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="#a78bfa" strokeWidth={0.75} strokeOpacity={0.35} />
        {fill && <polygon points={fill} fill="url(#memFill)" />}
        {pts && <polyline points={pts} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeLinejoin="round" />}
      </svg>
      <TimeAxis nowX={nowX} W={W} />
    </>
  )
}

// @group Utilities > MetricsPanel : Shared time axis — fixed 6-hr grid + floating local-time "now" label
function TimeAxis({ nowX, W = 800 }: { nowX: number; W?: number }) {
  const nowPct = (Math.min(Math.max(nowX, 0), W) / W) * 100
  const d = new Date()
  const nowLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return (
    <div style={{ position: 'relative', marginTop: 2 }}>
      {/* Floating current-time label pinned at the actual nowX position */}
      <div style={{ position: 'relative', height: 13 }}>
        <span style={{
          position: 'absolute',
          left: `${nowPct}%`,
          transform: 'translateX(-50%)',
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--color-primary)',
          whiteSpace: 'nowrap',
        }}>
          {nowLabel}
        </span>
      </div>
      {/* Static 6-hour grid ticks — right edge is 24:00, NOT "now" */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted-foreground)' }}>
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  )
}

// @group Utilities > MetricsPanel : Build a full 288-slot grid for today, merging actual bucket data
function buildDaySlots(buckets: LogStatsBucket[]) {
  const BUCKET_MS = 5 * 60 * 1000
  const now = Date.now()

  // Start of today in local time (midnight)
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)
  const startMs = todayMidnight.getTime()

  // How many 5-min slots have elapsed since midnight (up to 288)
  const slotsFilled = Math.min(288, Math.ceil((now - startMs) / BUCKET_MS))

  // Index bucket data by slot index
  const bySlot = new Map<number, { stdout_count: number; stderr_count: number }>()
  for (const b of buckets) {
    const bucketMs = new Date(b.window_start).getTime()
    const slotIdx  = Math.floor((bucketMs - startMs) / BUCKET_MS)
    if (slotIdx >= 0 && slotIdx < 288) {
      bySlot.set(slotIdx, { stdout_count: b.stdout_count, stderr_count: b.stderr_count })
    }
  }

  return Array.from({ length: 288 }, (_, i) => {
    const data = bySlot.get(i)
    return {
      stdout_count: data?.stdout_count ?? 0,
      stderr_count: data?.stderr_count ?? 0,
      isFuture: i >= slotsFilled,
    }
  })
}
