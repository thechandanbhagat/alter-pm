// @group BusinessLogic : Analytics — process manager monitoring dashboard

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CSSProperties, ElementType, ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Play, ExternalLink, MemoryStick, Clock, TrendingUp } from 'lucide-react'
import { useDaemonHealth } from '@/hooks/useDaemonHealth'
import { formatUptime, formatBytes, formatCpu, statusColor, STATUS_COLORS } from '@/lib/utils'
import { api } from '@/lib/api'
import type { AppSettings } from '@/lib/settings'
import type { LogStatsBucket, ProcessInfo, ProcessStatus } from '@/types'

// @group Types
interface StatusSegment { status: ProcessStatus; count: number; color: string; label: string }
interface NsRow {
  namespace: string; total: number; running: number; stopped: number; crashed: number; other: number
  totalCpu: number; totalMem: number
}
interface Props { processes: ProcessInfo[]; settings: AppSettings; reload: () => void }

// @group BusinessLogic : Main analytics page component
export default function AnalyticsPage({ processes, settings, reload }: Props) {
  const navigate = useNavigate()
  const health   = useDaemonHealth(settings.healthRefreshInterval)

  async function startNamespace(ns: string) {
    await api.startNamespace(ns).catch(() => {})
    setTimeout(reload, 300)
  }
  async function restartCrashed() {
    await Promise.all(
      processes.filter(p => p.status === 'crashed' || p.status === 'errored')
        .map(p => api.restartProcess(p.id).catch(() => {}))
    )
    setTimeout(reload, 500)
  }

  const stats = useMemo(() => {
    const byStatus: Partial<Record<ProcessStatus, number>> = {}
    for (const p of processes) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1
    const running  = byStatus['running']  ?? 0
    const stopped  = byStatus['stopped']  ?? 0
    const crashed  = byStatus['crashed']  ?? 0
    const errored  = byStatus['errored']  ?? 0
    const sleeping = byStatus['sleeping'] ?? 0
    const watching = byStatus['watching'] ?? 0
    const starting = byStatus['starting'] ?? 0
    const stopping = byStatus['stopping'] ?? 0

    const totalCpu      = processes.reduce((s, p) => s + (p.cpu_percent ?? 0), 0)
    const totalMem      = processes.reduce((s, p) => s + (p.memory_bytes ?? 0), 0)
    const totalRestarts = processes.reduce((s, p) => s + p.restart_count, 0)

    const nsMap = new Map<string, NsRow>()
    for (const p of processes) {
      const ns = p.namespace || 'default'
      if (!nsMap.has(ns)) nsMap.set(ns, { namespace: ns, total: 0, running: 0, stopped: 0, crashed: 0, other: 0, totalCpu: 0, totalMem: 0 })
      const r = nsMap.get(ns)!
      r.total++; r.totalCpu += p.cpu_percent ?? 0; r.totalMem += p.memory_bytes ?? 0
      if (p.status === 'running' || p.status === 'watching') r.running++
      else if (p.status === 'stopped' || p.status === 'stopping') r.stopped++
      else if (p.status === 'crashed' || p.status === 'errored') r.crashed++
      else r.other++
    }
    const namespaces = [...nsMap.values()].sort((a, b) =>
      a.namespace === 'default' ? -1 : b.namespace === 'default' ? 1 : a.namespace.localeCompare(b.namespace)
    )

    const topRestarters  = [...processes].filter(p => p.restart_count > 0 && !p.cron).sort((a, b) => b.restart_count - a.restart_count).slice(0, 5)
    const longestRunning = [...processes].filter(p => p.status === 'running' && p.uptime_secs != null).sort((a, b) => (b.uptime_secs ?? 0) - (a.uptime_secs ?? 0)).slice(0, 5)
    const topMemory      = [...processes].filter(p => (p.memory_bytes ?? 0) > 0).sort((a, b) => (b.memory_bytes ?? 0) - (a.memory_bytes ?? 0)).slice(0, 5)
    const crashedList    = processes.filter(p => p.status === 'crashed' || p.status === 'errored')
    const activeCount    = running + watching + sleeping

    const statusSegments: StatusSegment[] = ([
      { status: 'running'  as const, count: running + watching, color: STATUS_COLORS.running,  label: 'Running'  },
      { status: 'sleeping' as const, count: sleeping,           color: STATUS_COLORS.sleeping, label: 'Sleeping' },
      { status: 'stopped'  as const, count: stopped + stopping, color: STATUS_COLORS.stopped,  label: 'Stopped'  },
      { status: 'crashed'  as const, count: crashed + errored,  color: STATUS_COLORS.crashed,  label: 'Crashed'  },
      { status: 'starting' as const, count: starting,           color: STATUS_COLORS.starting, label: 'Starting' },
    ] as StatusSegment[]).filter(s => s.count > 0)

    return {
      total: processes.length, running, stopped, crashed, errored, sleeping, watching, starting, stopping,
      totalCpu, totalMem, totalRestarts, activeCount,
      namespaces, topRestarters, longestRunning, topMemory, crashedList, statusSegments,
    }
  }, [processes])

  const hasCrashed     = stats.crashedList.length > 0
  const hasLeaderData  = stats.longestRunning.length > 0 || stats.topMemory.length > 0 || stats.topRestarters.length > 0
  const autorestart    = processes.filter(p => p.autorestart).length
  const cronCount      = processes.filter(p => p.cron).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Sticky header ── */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>

        {/* Title row */}
        <div style={{ padding: '11px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.3px' }}>Overview</span>
          <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}>
            {processes.length} processes · {stats.namespaces.length} namespace{stats.namespaces.length !== 1 ? 's' : ''}
          </span>
          <div style={{ flex: 1 }} />
          {health && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-muted-foreground)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-status-running)', display: 'inline-block' }} />
              <span>v{health.version}</span>
              <span style={{ color: 'var(--color-border)' }}>·</span>
              <span>{formatUptime(health.uptime_secs)}</span>
            </div>
          )}
        </div>

        {/* Stat strip */}
        <div style={{ display: 'flex', borderTop: '1px solid var(--color-border)' }}>
          <StatCell n={stats.total}                             label="Total" />
          <StatCell n={stats.activeCount}                      label="Running"  c={stats.activeCount > 0 ? 'var(--color-status-running)' : undefined} />
          <StatCell n={stats.stopped + stats.stopping}         label="Stopped" />
          <StatCell n={stats.crashed + stats.errored}          label="Crashed"  c={hasCrashed ? '#ef4444' : undefined} />
          <div style={{ flex: 1 }} />
          <StatCell n={formatCpu(stats.totalCpu)}              label="CPU"      c="#60a5fa" />
          <StatCell n={formatBytes(stats.totalMem)}            label="Memory"   c="#a78bfa" />
          <StatCell n={String(stats.totalRestarts)}            label="Restarts" c={stats.totalRestarts > 0 ? '#f59e0b' : undefined} />
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '18px 24px', display: 'grid', gridTemplateColumns: '1fr 256px', gap: 18, alignItems: 'start' }}>

          {/* ── Left column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Crash alert */}
            {hasCrashed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444', borderRadius: '0 6px 6px 0' }}>
                <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, color: '#ef4444' }}>
                  <strong>{stats.crashedList.length} crashed</strong>
                  <span style={{ fontWeight: 400, marginLeft: 6, opacity: 0.8 }}>— {stats.crashedList.map(p => p.name).join(', ')}</span>
                </span>
                <button onClick={restartCrashed} style={dangerBtn}><RotateCcw size={10} />Restart all</button>
                <button onClick={() => navigate('/processes')} style={ghostBtn}>View</button>
              </div>
            )}

            {/* Namespace table */}
            <div>
              <ColHeader>Namespaces</ColHeader>
              {stats.namespaces.length === 0
                ? <Muted>No namespaces yet.</Muted>
                : (
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
                    {/* Table header */}
                    <div style={nsHeaderRow}>
                      <span />
                      <span style={thStyle}>Namespace</span>
                      <span style={thStyle}>Status</span>
                      <span style={{ ...thStyle, textAlign: 'right' }}>CPU</span>
                      <span style={{ ...thStyle, textAlign: 'right' }}>Memory</span>
                      <span />
                    </div>
                    {stats.namespaces.map((ns, i) => (
                      <NsListRow
                        key={ns.namespace} ns={ns} last={i === stats.namespaces.length - 1}
                        onNavigate={() => navigate(`/namespace/${encodeURIComponent(ns.namespace)}`)}
                        onStart={() => startNamespace(ns.namespace)}
                      />
                    ))}
                  </div>
                )
              }
            </div>

            {/* Leaderboards */}
            {hasLeaderData && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>

                {stats.longestRunning.length > 0 && (
                  <LeaderPanel icon={Clock} title="Longest Running">
                    {stats.longestRunning.map((p, i) => (
                      <LRow key={p.id} rank={i + 1} name={p.name} dot="var(--color-status-running)"
                        metric={formatUptime(p.uptime_secs ?? 0)} mc="var(--color-status-running)"
                        onClick={() => navigate(`/processes/${p.id}`)} />
                    ))}
                  </LeaderPanel>
                )}

                {stats.topMemory.length > 0 && (
                  <LeaderPanel icon={MemoryStick} title="Top Memory">
                    {stats.topMemory.map((p, i) => {
                      const pct = stats.totalMem > 0 ? ((p.memory_bytes ?? 0) / stats.totalMem) * 100 : 0
                      return (
                        <div key={p.id} onClick={() => navigate(`/processes/${p.id}`)} style={{ cursor: 'pointer', marginBottom: 7 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                            <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', minWidth: 14, textAlign: 'right' }}>{i + 1}</span>
                            <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa' }}>{formatBytes(p.memory_bytes ?? 0)}</span>
                          </div>
                          <div style={{ height: 2, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden', marginLeft: 19 }}>
                            <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: '#a78bfa' }} />
                          </div>
                        </div>
                      )
                    })}
                  </LeaderPanel>
                )}

                {stats.topRestarters.length > 0 && (
                  <LeaderPanel icon={TrendingUp} title="Restart Leaders">
                    {stats.topRestarters.map((p, i) => (
                      <LRow key={p.id} rank={i + 1} name={p.name} dot={statusColor(p.status)}
                        metric={`${p.restart_count}×`} mc="#ef4444"
                        onClick={() => navigate(`/processes/${p.id}`)} />
                    ))}
                  </LeaderPanel>
                )}
              </div>
            )}

          </div>

          {/* ── Right sidebar ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Distribution */}
            <div style={sidePanel}>
              <PanelLabel>Distribution</PanelLabel>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 16, gap: 14 }}>
                <Donut segments={stats.statusSegments} total={stats.total} />
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stats.statusSegments.length === 0
                    ? <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', textAlign: 'center' }}>No processes</span>
                    : stats.statusSegments.map(s => (
                        <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 12, color: 'var(--color-muted-foreground)' }}>{s.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{s.count}</span>
                          <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', minWidth: 30, textAlign: 'right' }}>
                            {stats.total > 0 ? `${Math.round((s.count / stats.total) * 100)}%` : '—'}
                          </span>
                        </div>
                      ))
                  }
                </div>
              </div>
            </div>

            {/* System */}
            {health && (
              <div style={sidePanel}>
                <PanelLabel>System</PanelLabel>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column' }}>
                  <KV k="Status"      v={health.status}             vc={health.status === 'running' ? 'var(--color-status-running)' : '#ef4444'} />
                  <KV k="Version"     v={`v${health.version}`} />
                  <KV k="Uptime"      v={formatUptime(health.uptime_secs)} />
                  <KV k="Processes"   v={String(health.process_count)} />
                  <KV k="Active"      v={String(stats.activeCount)} vc={stats.activeCount > 0 ? 'var(--color-status-running)' : undefined} />
                  <KV k="AutoRestart" v={String(autorestart)} />
                  <KV k="Cron jobs"   v={String(cronCount)} last />
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Log volume — full width */}
        <div style={{ padding: '0 24px 24px' }}>
          <LogStatsSection processes={processes} />
        </div>

        {/* Empty state */}
        {processes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--color-muted-foreground)', marginBottom: 14 }}>No processes registered yet</div>
            <button onClick={() => navigate('/start')} style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', background: 'var(--color-primary)', border: 'none', color: '#fff' }}>
              Start your first process
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// @group BusinessLogic > StatCell : Single stat in the top strip
function StatCell({ n, label, c }: { n: number | string; label: string; c?: string }) {
  return (
    <div style={{ padding: '8px 22px', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
      <span style={{ fontSize: 24, fontWeight: 700, color: c ?? 'var(--color-foreground)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.6px' }}>{n}</span>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginTop: 2 }}>{label}</span>
    </div>
  )
}

// @group BusinessLogic > NsListRow : One namespace row in the table
function NsListRow({ ns, last, onNavigate, onStart }: { ns: NsRow; last: boolean; onNavigate: () => void; onStart: () => void }) {
  const [hov, setHov] = useState(false)
  const dot = ns.crashed > 0 ? '#ef4444' : ns.running > 0 ? 'var(--color-status-running)' : 'var(--color-muted-foreground)'
  const pct = ns.total > 0 ? (ns.running / ns.total) * 100 : 0
  const statusLabel = ns.crashed > 0
    ? `${ns.crashed} crashed`
    : ns.running > 0 ? `${ns.running}/${ns.total} running`
    : 'all stopped'
  const statusColor2 = ns.crashed > 0 ? '#ef4444' : ns.running > 0 ? 'var(--color-status-running)' : 'var(--color-muted-foreground)'

  return (
    <div
      onClick={onNavigate}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        ...nsDataRow,
        borderBottom: last ? 'none' : '1px solid var(--color-border)',
        background: hov ? 'var(--color-accent)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      {/* Status dot */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0,
          boxShadow: ns.running > 0 ? `0 0 0 3px ${dot}28` : 'none',
        }} />
      </div>

      {/* Name */}
      <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ns.namespace}
      </span>

      {/* Progress + label */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: dot, transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontSize: 11, color: statusColor2 }}>{statusLabel}</span>
      </div>

      {/* CPU */}
      <span style={{ fontSize: 12, color: ns.totalCpu > 0 ? '#60a5fa' : 'var(--color-muted-foreground)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {ns.totalCpu > 0 ? formatCpu(ns.totalCpu) : '—'}
      </span>

      {/* MEM */}
      <span style={{ fontSize: 12, color: ns.totalMem > 0 ? '#a78bfa' : 'var(--color-muted-foreground)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {ns.totalMem > 0 ? formatBytes(ns.totalMem) : '—'}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
        {(ns.stopped > 0 || ns.crashed > 0) && (
          <button onClick={onStart} style={rowBtn}>
            <Play size={9} />Start
          </button>
        )}
        <button onClick={onNavigate} style={{ ...rowBtn, padding: '3px 8px' }}>
          <ExternalLink size={10} />
        </button>
      </div>
    </div>
  )
}

// @group BusinessLogic > Donut : SVG donut chart
function Donut({ segments, total }: { segments: StatusSegment[]; total: number }) {
  const s = 108; const r = s * 0.335; const cx = s / 2; const cy = s / 2; const sw = s * 0.12; const c = 2 * Math.PI * r
  if (total === 0) return (
    <svg width={s} height={s}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={sw} />
      <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--color-muted-foreground)" fontSize={12}>0</text>
    </svg>
  )
  let acc = 0
  return (
    <svg width={s} height={s}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={sw} />
      {segments.map((seg, i) => {
        const arcLen = (seg.count / total) * c; const angle = (acc / total) * 360 - 90; acc += seg.count
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={sw}
            strokeDasharray={`${arcLen} ${c - arcLen}`} transform={`rotate(${angle} ${cx} ${cy})`} />
        )
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--color-foreground)" fontSize={22} fontWeight="700">{total}</text>
      <text x={cx} y={cy + 13} textAnchor="middle" fill="var(--color-muted-foreground)" fontSize={9} fontWeight="600" letterSpacing="0.5">PROCS</text>
    </svg>
  )
}

// @group BusinessLogic > LeaderPanel : Leaderboard container card
function LeaderPanel({ icon: Icon, title, children }: { icon: ElementType; title: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', background: 'var(--color-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon size={12} color="var(--color-muted-foreground)" />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

// @group BusinessLogic > LRow : Single leaderboard row
function LRow({ rank, name, dot, metric, mc, onClick }: { rank: number; name: string; dot: string; metric: string; mc: string; onClick: () => void }) {
  return (
    <div onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px', borderRadius: 4, cursor: 'pointer' }}>
      <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', minWidth: 14, textAlign: 'right' }}>{rank}</span>
      <span style={{ color: dot, fontSize: 8 }}>●</span>
      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: mc, minWidth: 44, textAlign: 'right' }}>{metric}</span>
    </div>
  )
}

// @group BusinessLogic > KV : Key-value row in sidebar panels
function KV({ k, v, vc, last }: { k: string; v: string; vc?: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: last ? 'none' : '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' }}>
      <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}>{k}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: vc ?? 'var(--color-foreground)' }}>{v}</span>
    </div>
  )
}

// @group BusinessLogic > PanelLabel : Uppercase section label
function PanelLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>{children}</span>
}

// @group BusinessLogic > ColHeader : Section heading for left column
function ColHeader({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>{children}</span>
}

// @group BusinessLogic > Muted : Muted placeholder text
function Muted({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', margin: '8px 0 0' }}>{children}</p>
}

// @group BusinessLogic > LogStatsSection : Log volume chart section
function LogStatsSection({ processes }: { processes: ProcessInfo[] }) {
  const [statsMap, setStatsMap] = useState<Record<string, LogStatsBucket[]>>({})
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ids = useMemo(() => processes.map(p => p.id).join(','), [processes])

  useEffect(() => {
    if (!processes.length) return
    async function fetchAll() {
      const entries = await Promise.all(
        processes.map(p => api.getLogStats(p.id).then(r => [p.id, r.buckets] as const).catch(() => [p.id, []] as const))
      )
      setStatsMap(Object.fromEntries(entries))
    }
    fetchAll()
    timerRef.current = setInterval(fetchAll, 60_000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [ids])

  const withData = processes.filter(p => (statsMap[p.id]?.length ?? 0) > 0)
  if (!withData.length) return null

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '14px 16px', background: 'var(--color-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <PanelLabel>Log Volume · 5-min intervals</PanelLabel>
        <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-muted-foreground)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 1, background: 'var(--color-status-running)', display: 'inline-block' }} />stdout
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-muted-foreground)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 1, background: '#ef4444', display: 'inline-block' }} />stderr
          </span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {withData.map(p => <LogCard key={p.id} process={p} buckets={statsMap[p.id] ?? []} />)}
      </div>
    </div>
  )
}

// @group BusinessLogic > LogCard : Per-process log volume mini chart
function LogCard({ process, buckets }: { process: ProcessInfo; buckets: LogStatsBucket[] }) {
  const maxCount = Math.max(...buckets.map(b => b.stdout_count + b.stderr_count), 1)
  const totalOut = buckets.reduce((s, b) => s + b.stdout_count, 0)
  const totalErr = buckets.reduce((s, b) => s + b.stderr_count, 0)
  const W = 300; const H = 44; const n = buckets.length; const bW = Math.max(1, W / n - 1); const gap = Math.max(0, W / n - bW)
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 11px', background: 'var(--color-background)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <span style={{ color: statusColor(process.status), fontSize: 8 }}>●</span>
        <span style={{ fontWeight: 600, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{process.name}</span>
        <span style={{ fontSize: 11, color: 'var(--color-status-running)', fontWeight: 600 }}>{totalOut} out</span>
        <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', margin: '0 2px' }}>·</span>
        <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{totalErr} err</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="3 3" />
        {buckets.map((b, i) => {
          const x = i * (bW + gap); const t = b.stdout_count + b.stderr_count
          const tH = (t / maxCount) * H; const oH = (b.stdout_count / maxCount) * H; const eH = tH - oH
          return (
            <g key={i}>
              {eH > 0 && <rect x={x} y={H - tH} width={bW} height={eH} fill="#ef4444" fillOpacity={0.8} rx={1} />}
              {oH > 0 && <rect x={x} y={H - oH} width={bW} height={oH} fill="var(--color-status-running)" fillOpacity={0.8} rx={1} />}
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: 3 }}>
        <span>{fmtTime(buckets[0]?.window_start)}</span>
        <span>{fmtTime(buckets[buckets.length - 1]?.window_start)}</span>
      </div>
    </div>
  )
}

// @group Utilities
function fmtTime(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// @group Constants : Shared style objects
const sidePanel: CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', background: 'var(--color-card)',
}
const dangerBtn: CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444',
  display: 'flex', alignItems: 'center', gap: 4,
}
const ghostBtn: CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
  background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-muted-foreground)',
}
const rowBtn: CSSProperties = {
  padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-foreground)',
  display: 'flex', alignItems: 'center', gap: 4,
}
const nsHeaderRow: CSSProperties = {
  display: 'grid', gridTemplateColumns: '28px 1fr 160px 70px 80px 90px',
  alignItems: 'center', gap: 12, padding: '6px 16px',
  borderBottom: '1px solid var(--color-border)', background: 'var(--color-accent)',
}
const nsDataRow: CSSProperties = {
  display: 'grid', gridTemplateColumns: '28px 1fr 160px 70px 80px 90px',
  alignItems: 'center', gap: 12, padding: '10px 16px', transition: 'background 0.1s',
}
const thStyle: CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
  color: 'var(--color-muted-foreground)',
}
