// @group BusinessLogic : Dedicated log volume page — per-process 5-min bucket charts

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Search, TrendingUp, BarChart2 } from 'lucide-react'
import { api } from '@/lib/api'
import { statusColor } from '@/lib/utils'
import type { LogStatsBucket, ProcessInfo } from '@/types'

// @group Types > LogVolume : Props
interface Props {
  processes: ProcessInfo[]
}

// @group Utilities > LogVolume : Format ISO bucket start time as HH:MM
function fmtTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// @group Utilities > LogVolume : Format large numbers with K suffix
function fmtCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// @group BusinessLogic > Charts : SVG stacked bar chart — stdout (green) + stderr (red)
function LogBarChart({
  buckets,
  maxCount,
  height = 80,
}: {
  buckets: LogStatsBucket[]
  maxCount: number
  height?: number
}) {
  const W = 400
  const H = height
  const PAD_B = 2
  const chartH = H - PAD_B
  const n = buckets.length
  if (n === 0) return null

  const barW = Math.max(1, W / n - 0.5)
  const gap  = Math.max(0, W / n - barW)

  // Hour-boundary indices for time axis guides
  const hourMarks: number[] = []
  buckets.forEach((b, i) => {
    if (i > 0) {
      const prev = new Date(buckets[i - 1].window_start)
      const curr = new Date(b.window_start)
      if (curr.getMinutes() === 0 && prev.getMinutes() !== 0) hourMarks.push(i)
    }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      {/* 50% guide line */}
      <line x1={0} y1={chartH / 2} x2={W} y2={chartH / 2}
        stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="3 3" />

      {/* Hour boundary lines */}
      {hourMarks.map(i => {
        const x = i * (barW + gap)
        return <line key={i} x1={x} y1={0} x2={x} y2={chartH}
          stroke="var(--color-border)" strokeWidth={0.5} opacity={0.6} />
      })}

      {/* Bars */}
      {buckets.map((b, i) => {
        const x = i * (barW + gap)
        const total  = b.stdout_count + b.stderr_count
        const totalH = maxCount > 0 ? (total / maxCount) * chartH : 0
        const outH   = maxCount > 0 ? (b.stdout_count / maxCount) * chartH : 0
        const errH   = totalH - outH

        return (
          <g key={i}>
            {errH > 0 && (
              <rect x={x} y={chartH - totalH} width={barW} height={errH}
                fill="var(--color-status-crashed)" fillOpacity={0.8} rx={0.5} />
            )}
            {outH > 0 && (
              <rect x={x} y={chartH - outH} width={barW} height={outH}
                fill="var(--color-status-running)" fillOpacity={0.8} rx={0.5} />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// @group BusinessLogic > Aggregate : Merge buckets across all processes by time window
function mergeAllBuckets(statsMap: Record<string, LogStatsBucket[]>): LogStatsBucket[] {
  const byTime: Record<string, { stdout_count: number; stderr_count: number }> = {}
  for (const buckets of Object.values(statsMap)) {
    for (const b of buckets) {
      if (!byTime[b.window_start]) {
        byTime[b.window_start] = { stdout_count: 0, stderr_count: 0 }
      }
      byTime[b.window_start].stdout_count += b.stdout_count
      byTime[b.window_start].stderr_count += b.stderr_count
    }
  }
  return Object.entries(byTime)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([window_start, counts]) => ({ window_start, ...counts }))
}

// @group BusinessLogic > ProcessCard : Individual process log volume card
function ProcessCard({
  process,
  buckets,
  globalMax,
}: {
  process: ProcessInfo
  buckets: LogStatsBucket[]
  globalMax: number
}) {
  const navigate = useNavigate()
  const maxCount  = Math.max(...buckets.map(b => b.stdout_count + b.stderr_count), 1)
  const totalOut  = buckets.reduce((s, b) => s + b.stdout_count, 0)
  const totalErr  = buckets.reduce((s, b) => s + b.stderr_count, 0)
  const errRate   = totalOut + totalErr > 0
    ? Math.round((totalErr / (totalOut + totalErr)) * 100)
    : 0
  const peak      = Math.max(...buckets.map(b => b.stdout_count + b.stderr_count), 0)
  const peakBucket = buckets.find(b => b.stdout_count + b.stderr_count === peak)

  // Scale relative to global max for cross-process comparison, or self-scaled
  const chartMax = globalMax > 0 ? globalMax : maxCount

  return (
    <div
      onClick={() => navigate(`/processes/${process.id}`)}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '12px 14px',
        background: 'var(--color-card)',
        display: 'flex', flexDirection: 'column', gap: 10,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
    >
      {/* Process header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: statusColor(process.status), fontSize: 9, flexShrink: 0 }}>●</span>
        <span style={{
          fontWeight: 600, fontSize: 13, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {process.name}
        </span>
        {errRate > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px',
            background: errRate > 20 ? 'var(--color-destructive)' : '#f97316',
            color: '#fff', borderRadius: 10,
          }}>
            {errRate}% err
          </span>
        )}
      </div>

      {/* Chart */}
      <LogBarChart buckets={buckets} maxCount={chartMax} height={72} />

      {/* Time axis */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: -6 }}>
        <span>{fmtTime(buckets[0]?.window_start)}</span>
        <span>{fmtTime(buckets[buckets.length - 1]?.window_start)}</span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
        <span style={{ color: 'var(--color-status-running)', fontWeight: 600 }}>
          {fmtCount(totalOut)} stdout
        </span>
        <span style={{ color: 'var(--color-muted-foreground)' }}>·</span>
        <span style={{ color: totalErr > 0 ? 'var(--color-status-crashed)' : 'var(--color-muted-foreground)', fontWeight: totalErr > 0 ? 600 : 400 }}>
          {fmtCount(totalErr)} stderr
        </span>
        {peak > 0 && (
          <>
            <span style={{ color: 'var(--color-muted-foreground)' }}>·</span>
            <span style={{ color: 'var(--color-muted-foreground)' }}>
              peak {fmtCount(peak)} @ {fmtTime(peakBucket?.window_start)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// @group BusinessLogic > LogVolumePage : Main page component
export default function LogVolumePage({ processes }: Props) {
  const [statsMap, setStatsMap] = useState<Record<string, LogStatsBucket[]>>({})
  const [loading,  setLoading]  = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [nsFilter,    setNsFilter]    = useState('')
  const [nameFilter,  setNameFilter]  = useState('')
  const [scaleMode,   setScaleMode]   = useState<'global' | 'local'>('local')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // @group BusinessLogic > Fetch : Load log stats for all processes
  const ids = useMemo(() => processes.map(p => p.id).join(','), [processes])

  async function fetchAll(silent = false) {
    if (!silent) setLoading(true)
    const entries = await Promise.all(
      processes.map(p =>
        api.getLogStats(p.id)
          .then(r => [p.id, r.buckets] as const)
          .catch(() => [p.id, []] as const)
      )
    )
    setStatsMap(Object.fromEntries(entries))
    setLastRefresh(new Date())
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    if (processes.length === 0) { setLoading(false); return }
    fetchAll()
    timerRef.current = setInterval(() => fetchAll(true), 60_000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [ids])

  // @group BusinessLogic > Filter : Apply namespace and name filters
  const filtered = useMemo(() => {
    return processes.filter(p => {
      const ns   = (p.namespace ?? 'default').toLowerCase()
      const name = p.name.toLowerCase()
      if (nsFilter   && !ns.includes(nsFilter.toLowerCase()))   return false
      if (nameFilter && !name.includes(nameFilter.toLowerCase())) return false
      return (statsMap[p.id]?.length ?? 0) > 0
    })
  }, [processes, statsMap, nsFilter, nameFilter])

  // @group BusinessLogic > Aggregate : Compute merged buckets across all visible processes
  const aggregateBuckets = useMemo(() => {
    const relevant = Object.fromEntries(
      filtered.map(p => [p.id, statsMap[p.id] ?? []])
    )
    return mergeAllBuckets(relevant)
  }, [filtered, statsMap])

  const aggregateMax = useMemo(
    () => Math.max(...aggregateBuckets.map(b => b.stdout_count + b.stderr_count), 1),
    [aggregateBuckets]
  )

  // @group BusinessLogic > Scale : Global max for cross-process-comparable chart heights
  const globalMax = useMemo(() => {
    if (scaleMode === 'local') return 0
    return Math.max(
      ...filtered.map(p =>
        Math.max(...(statsMap[p.id] ?? []).map(b => b.stdout_count + b.stderr_count), 0)
      ),
      1
    )
  }, [filtered, statsMap, scaleMode])

  // @group BusinessLogic > Namespace : Group visible processes by namespace
  const byNamespace = useMemo(() => {
    const groups: Record<string, ProcessInfo[]> = {}
    for (const p of filtered) {
      const ns = p.namespace ?? 'default'
      ;(groups[ns] ??= []).push(p)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  // @group BusinessLogic > Summary : Global totals across all visible processes
  const totals = useMemo(() => {
    let stdout = 0, stderr = 0
    for (const p of filtered) {
      for (const b of (statsMap[p.id] ?? [])) {
        stdout += b.stdout_count
        stderr += b.stderr_count
      }
    }
    return { stdout, stderr }
  }, [filtered, statsMap])

  // @group BusinessLogic > Ranking : Top processes by total log lines
  const topProcesses = useMemo(() => {
    return [...filtered]
      .map(p => {
        const buckets = statsMap[p.id] ?? []
        const total = buckets.reduce((s, b) => s + b.stdout_count + b.stderr_count, 0)
        return { process: p, total }
      })
      .filter(x => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [filtered, statsMap])

  const totalProcesses = processes.length
  const withData = filtered.length

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Log Volume</h1>
          <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', margin: '4px 0 0' }}>
            5-minute stdout / stderr buckets — today · {withData} of {totalProcesses} processes
            {lastRefresh && (
              <span> · refreshed {fmtTime(lastRefresh.toISOString())}</span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-muted-foreground)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-status-running)', display: 'inline-block' }} />
              stdout
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-status-crashed)', display: 'inline-block' }} />
              stderr
            </span>
          </div>

          {/* Scale toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
            {(['local', 'global'] as const).map(mode => (
              <button key={mode} onClick={() => setScaleMode(mode)} style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 500,
                background: scaleMode === mode ? 'var(--color-primary)' : 'transparent',
                color: scaleMode === mode ? '#fff' : 'var(--color-foreground)',
                border: 'none', cursor: 'pointer',
              }}>
                {mode === 'local' ? 'Self-scaled' : 'Global scale'}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={() => fetchAll()}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', fontSize: 12, fontWeight: 500,
              background: 'var(--color-secondary)', color: 'var(--color-foreground)',
              border: '1px solid var(--color-border)', borderRadius: 6,
              cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Summary stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total stdout', value: fmtCount(totals.stdout), sub: 'lines today', color: 'var(--color-status-running)' },
          { label: 'Total stderr', value: fmtCount(totals.stderr), sub: 'lines today', color: 'var(--color-status-crashed)' },
          {
            label: 'Error rate', value: totals.stdout + totals.stderr > 0
              ? `${Math.round(totals.stderr / (totals.stdout + totals.stderr) * 100)}%`
              : '—',
            sub: 'of all log lines', color: 'var(--color-foreground)',
          },
          { label: 'Active loggers', value: String(withData), sub: `of ${totalProcesses} processes`, color: 'var(--color-foreground)' },
        ].map(card => (
          <div key={card.label} style={{
            border: '1px solid var(--color-border)', borderRadius: 8,
            padding: '12px 16px', background: 'var(--color-card)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: aggregateBuckets.length > 0 && topProcesses.length > 0 ? '1fr 260px' : '1fr', gap: 16, marginBottom: 20 }}>
        {/* ── Aggregate chart ── */}
        {aggregateBuckets.length > 0 && (
          <div style={{
            border: '1px solid var(--color-border)', borderRadius: 8,
            padding: '14px 16px', background: 'var(--color-card)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <BarChart2 size={14} style={{ color: 'var(--color-primary)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Aggregate — all processes</span>
              <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginLeft: 'auto' }}>
                {fmtCount(totals.stdout + totals.stderr)} total lines
              </span>
            </div>
            <LogBarChart buckets={aggregateBuckets} maxCount={aggregateMax} height={90} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: 4 }}>
              <span>{fmtTime(aggregateBuckets[0]?.window_start)}</span>
              <span>{fmtTime(aggregateBuckets[aggregateBuckets.length - 1]?.window_start)}</span>
            </div>
          </div>
        )}

        {/* ── Top processes by volume ── */}
        {topProcesses.length > 0 && (
          <div style={{
            border: '1px solid var(--color-border)', borderRadius: 8,
            padding: '14px 16px', background: 'var(--color-card)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <TrendingUp size={14} style={{ color: 'var(--color-primary)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Top by volume</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topProcesses.map(({ process, total }, rank) => {
                const pct = Math.round((total / (topProcesses[0]?.total || 1)) * 100)
                return (
                  <div key={process.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', width: 14 }}>#{rank + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {process.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', flexShrink: 0 }}>
                        {fmtCount(total)}
                      </span>
                    </div>
                    <div style={{ height: 4, background: 'var(--color-muted)', borderRadius: 2, overflow: 'hidden', marginLeft: 20 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: 2 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 240 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted-foreground)', pointerEvents: 'none' }} />
          <input
            value={nsFilter}
            onChange={e => setNsFilter(e.target.value)}
            placeholder="Filter namespace…"
            style={{
              width: '100%', padding: '6px 10px 6px 28px', fontSize: 12,
              background: 'var(--color-card)', border: '1px solid var(--color-border)',
              borderRadius: 6, color: 'var(--color-foreground)', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ position: 'relative', flex: 1, maxWidth: 240 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted-foreground)', pointerEvents: 'none' }} />
          <input
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="Filter process name…"
            style={{
              width: '100%', padding: '6px 10px 6px 28px', fontSize: 12,
              background: 'var(--color-card)', border: '1px solid var(--color-border)',
              borderRadius: 6, color: 'var(--color-foreground)', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {(nsFilter || nameFilter) && (
          <button onClick={() => { setNsFilter(''); setNameFilter('') }} style={{
            padding: '6px 12px', fontSize: 12, background: 'transparent',
            border: '1px solid var(--color-border)', borderRadius: 6,
            color: 'var(--color-muted-foreground)', cursor: 'pointer',
          }}>
            Clear
          </button>
        )}
      </div>

      {/* ── Loading / empty states ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-muted-foreground)', fontSize: 13 }}>
          Loading log stats…
        </div>
      )}

      {!loading && byNamespace.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-muted-foreground)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>No log data yet</div>
          <div style={{ fontSize: 12 }}>
            {nsFilter || nameFilter
              ? 'No processes match the current filter.'
              : 'Processes haven\'t written any logs today, or no processes are running.'}
          </div>
        </div>
      )}

      {/* ── Namespace groups ── */}
      {!loading && byNamespace.map(([ns, nsProcesses]) => (
        <div key={ns} style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--color-muted-foreground)',
            marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {ns}
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px',
              background: 'var(--color-muted)', borderRadius: 10,
              color: 'var(--color-muted-foreground)', textTransform: 'none', letterSpacing: 0,
            }}>
              {nsProcesses.length}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
            {nsProcesses.map(p => (
              <ProcessCard
                key={p.id}
                process={p}
                buckets={statsMap[p.id] ?? []}
                globalMax={globalMax}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
