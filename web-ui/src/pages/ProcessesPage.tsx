// @group BusinessLogic : Processes list view — namespace-grouped table

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, RotateCcw, ScrollText, Pencil, Trash2, FileKey, Bell } from 'lucide-react'
import { api } from '@/lib/api'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
import { EnvFilePanel } from '@/components/EnvFilePanel'
import { ProcessNotifModal, NsNotifModal } from '@/components/NotifModal'
import { formatLastRun, formatNextRun, formatUptime, formatBytes, formatCpu, statusColor } from '@/lib/utils'
import type { AppSettings } from '@/lib/settings'
import type { ProcessInfo } from '@/types'

interface Props {
  processes: ProcessInfo[]
  reload: () => void
  settings: AppSettings
}


export default function ProcessesPage({ processes, reload, settings }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [envModalProcess, setEnvModalProcess] = useState<ProcessInfo | null>(null)
  const [notifProcess, setNotifProcess]       = useState<ProcessInfo | null>(null)
  const [notifNs, setNotifNs]                 = useState<string | null>(null)
  const navigate = useNavigate()
  const { dialogState, confirm, danger, handleConfirm, handleCancel } = useDialog()

  // @group BusinessLogic > Ports : Raw port data from API — each entry includes ancestor_pids
  // so we can walk the process tree to match grandchild sockets back to their managed root PID.
  interface RawPortEntry {
    pid: number | null
    port: number
    state: string
    ancestor_pids?: number[]
  }
  const [portData, setPortData] = useState<RawPortEntry[]>([])

  const loadPorts = useCallback(async () => {
    try {
      const res  = await fetch('/api/v1/ports')
      const data = await res.json()
      setPortData(data.ports ?? [])
    } catch { /* port fetch is best-effort */ }
  }, [])

  useEffect(() => { loadPorts() }, [loadPorts])

  // @group BusinessLogic > Ports : Derive pid → sorted port numbers map.
  // For each LISTENING/UDP port, walk the ancestor_pids chain to find the managed root PID.
  // This handles deep npm/node spawn trees where the actual socket lives 3-4 levels deep.
  const portMap = useMemo(() => {
    const managedPids = new Set(
      processes.map(p => p.pid).filter((pid): pid is number => pid != null)
    )
    const map = new Map<number, number[]>()
    for (const entry of portData) {
      if (!entry.pid || entry.pid <= 0) continue
      if (entry.state !== 'LISTENING' && entry.state !== '') continue
      // Walk: socket owner → parent → grandparent → ... until we hit a managed PID
      const allPids = [entry.pid, ...(entry.ancestor_pids ?? [])]
      const rootPid = allPids.find(pid => managedPids.has(pid)) ?? entry.pid
      const arr = map.get(rootPid) ?? []
      if (!arr.includes(entry.port)) arr.push(entry.port)
      map.set(rootPid, arr)
    }
    map.forEach((v, k) => map.set(k, v.sort((a, b) => a - b)))
    return map
  }, [portData, processes])

  // Group by namespace
  const groups = new Map<string, ProcessInfo[]>()
  for (const p of processes) {
    const ns = p.namespace || 'default'
    if (!groups.has(ns)) groups.set(ns, [])
    groups.get(ns)!.push(p)
  }
  const sortedNs = [...groups.keys()].sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)
  )

  function toggleNs(ns: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(ns) ? next.delete(ns) : next.add(ns)
      return next
    })
  }

  async function startAll(ns: string) {
    const targets = (groups.get(ns) ?? []).filter(p => p.status === 'stopped' || p.status === 'crashed' || p.status === 'errored')
    await Promise.all(targets.map(p => api.startStopped(p.id).catch(() => {})))
    setTimeout(reload, 300)
  }

  async function stopAll(ns: string) {
    const targets = (groups.get(ns) ?? []).filter(p => p.status === 'running' || p.status === 'watching')
    const ok = await confirm(`Stop all in "${ns}"?`, `${targets.length} running process${targets.length !== 1 ? 'es' : ''} will be stopped.`)
    if (!ok) return
    await Promise.all(targets.map(p => api.stopProcess(p.id).catch(() => {})))
    setTimeout(reload, 400)
  }

  async function restartAll(ns: string) {
    const targets = (groups.get(ns) ?? []).filter(p => p.status === 'running' || p.status === 'watching' || p.status === 'sleeping')
    await Promise.all(targets.map(p => api.restartProcess(p.id).catch(() => {})))
    setTimeout(reload, 400)
  }

  if (!processes.length) {
    return (
      <div style={{ padding: 32, color: 'var(--color-muted-foreground)' }}>No processes registered.</div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      {/* Per-process notification modal */}
      {notifProcess && (
        <ProcessNotifModal process={notifProcess} onClose={() => setNotifProcess(null)} />
      )}

      {/* Namespace notification modal */}
      {notifNs && (
        <NsNotifModal ns={notifNs} onClose={() => setNotifNs(null)} />
      )}

      {/* @group BusinessLogic > Layout : Two-column flex — table left, .env panel right */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left column: header + scrollable process table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Processes</h2>
            <button onClick={() => { reload(); loadPorts() }} style={smallBtnStyle}>↻ Refresh</button>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>
                  {['ID', 'Name', 'Status', 'PID', 'Uptime', 'CPU', 'Mem', 'Restarts', 'Mode', 'Next Run', 'Last Run', 'Actions'].map(h => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedNs.map(ns => {
                  const procs = groups.get(ns)!
                  const isCollapsed = collapsed.has(ns)
                  const allActive   = procs.every(p => p.status === 'running' || p.status === 'watching')
                  const allInactive = procs.every(p => p.status !== 'running' && p.status !== 'watching')
                  const hasActive   = procs.some(p => p.status === 'running' || p.status === 'watching' || p.status === 'sleeping')
                  return [
                    // Namespace header row
                    <tr key={`ns-${ns}`}
                      onClick={() => toggleNs(ns)}
                      style={{ background: 'var(--color-muted)', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <td colSpan={12} style={{ padding: '6px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>{isCollapsed ? '▶' : '▼'}</span>
                          <span style={{ fontWeight: 600, fontSize: 12 }}>{ns}</span>
                          <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>{procs.length} process{procs.length !== 1 ? 'es' : ''}</span>
                          <span onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
                            {!allActive  && <NsBtn label="▶ Start All"   onClick={() => startAll(ns)} />}
                            {hasActive   && <NsBtn label="↺ Restart All" onClick={() => restartAll(ns)} />}
                            {!allInactive && <NsBtn label="■ Stop All"    onClick={() => stopAll(ns)} danger />}
                            <button
                              onClick={() => setNotifNs(ns)}
                              title="Namespace notifications"
                              style={{ padding: '2px 5px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            >
                              <Bell size={11} style={{ color: '#a78bfa' }} />
                            </button>
                          </span>
                        </div>
                      </td>
                    </tr>,
                    // Process rows
                    ...(!isCollapsed ? procs.map(p => (
                      <ProcessRow
                        key={p.id} p={p} reload={reload}
                        confirmDelete={settings.confirmBeforeDelete}
                        onConfirm={confirm} onDanger={danger}
                        onOpenDetail={() => navigate(`/processes/${p.id}`)}
                        onEdit={() => navigate(`/edit/${p.id}`)}
                        onOpenEnv={() => setEnvModalProcess(p)}
                        onOpenNotif={() => setNotifProcess(p)}
                        ports={p.pid != null ? (portMap.get(p.pid) ?? []) : []}
                      />
                    )) : []),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: .env editor panel — slides in when a row's .env button is clicked */}
        {envModalProcess && (
          <div style={{
            width: 400, flexShrink: 0,
            borderLeft: '1px solid var(--color-border)',
            display: 'flex', flexDirection: 'column',
          }}>
            <EnvFilePanel
              processId={envModalProcess.id}
              processName={envModalProcess.name}
              onClose={() => setEnvModalProcess(null)}
              onRestart={reload}
            />
          </div>
        )}

      </div>
    </div>
  )
}

// @group BusinessLogic > ProcessRow : Single process table row
function ProcessRow({ p, reload, confirmDelete, onConfirm, onDanger, onOpenDetail, onEdit, onOpenEnv, onOpenNotif, ports }: {
  p: ProcessInfo
  reload: () => void
  confirmDelete: boolean
  onConfirm: (title: string, message?: string) => Promise<boolean>
  onDanger: (title: string, message?: string, confirmLabel?: string) => Promise<boolean>
  onOpenDetail: () => void
  onEdit: () => void
  onOpenEnv: () => void
  onOpenNotif: () => void
  ports: number[]
}) {
  const navigate = useNavigate()
  const isActive = p.status === 'running' || p.status === 'sleeping' || p.status === 'watching'

  const modeCell = p.cron
    ? <span style={{
        display: 'inline-block', padding: '1px 7px', borderRadius: 4,
        fontSize: 11, fontWeight: 600,
        background: 'rgba(79,156,249,0.15)', color: 'var(--color-status-sleeping)',
        cursor: 'default',
      }} title={p.cron}>cron</span>
    : p.watch ? 'watch' : '-'

  async function doStop() {
    const ok = await onConfirm(`Stop "${p.name}"?`, 'The process will be stopped. You can restart it later.')
    if (!ok) return
    await api.stopProcess(p.id).catch(() => {})
    setTimeout(reload, 300)
  }
  async function doStart() {
    await api.startStopped(p.id).catch(() => {})
    setTimeout(reload, 300)
  }
  async function doRestart() {
    await api.restartProcess(p.id).catch(() => {})
    reload()
  }
  async function doDelete() {
    if (confirmDelete) {
      const ok = await onDanger(`Delete "${p.name}"?`, 'This will stop and permanently remove the process.', 'Delete')
      if (!ok) return
    }
    await api.deleteProcess(p.id).catch(() => {})
    setTimeout(reload, 300)
  }

  const hasNotify = !!p.notify?.webhook?.enabled || !!p.notify?.slack?.enabled || !!p.notify?.teams?.enabled

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <Td>
        <code style={{ fontSize: 11, color: 'var(--color-muted-foreground)', cursor: 'pointer' }}
          title={p.id} onClick={onOpenDetail}>{p.id.slice(0, 8)}</code>
      </Td>
      <Td><strong style={{ cursor: 'pointer' }} onClick={onOpenDetail}>{p.name}</strong></Td>
      <Td>
        <span style={{ color: statusColor(p.status), display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          ● {p.status}
        </span>
      </Td>
      <Td style={{ whiteSpace: 'normal', verticalAlign: 'top' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.pid ?? '-'}</span>
          {ports.length > 0 ? (
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {ports.slice(0, 5).map(port => (
                <span key={port} title={`Port ${port}`} style={{
                  fontSize: 9, fontWeight: 700, lineHeight: '14px',
                  padding: '1px 4px', borderRadius: 3,
                  background: 'color-mix(in srgb, var(--color-primary) 18%, transparent)',
                  color: 'var(--color-primary)',
                  cursor: 'default',
                }}>:{port}</span>
              ))}
              {ports.length > 5 && (
                <span title={ports.slice(5).map(port => `:${port}`).join(' ')} style={{
                  fontSize: 9, lineHeight: '14px', color: 'var(--color-muted-foreground)',
                  cursor: 'default',
                }}>+{ports.length - 5}</span>
              )}
            </div>
          ) : (isActive && p.pid != null) ? (
            <span title="No listening TCP/UDP ports found for this process" style={{
              fontSize: 9, color: 'var(--color-muted-foreground)', opacity: 0.5,
              cursor: 'default', fontStyle: 'italic',
            }}>no ports</span>
          ) : null}
        </div>
      </Td>
      <Td>{p.uptime_secs != null ? formatUptime(p.uptime_secs) : '-'}</Td>
      <Td style={{ color: 'var(--color-muted-foreground)' }}>
        {p.cpu_percent != null ? formatCpu(p.cpu_percent) : '-'}
      </Td>
      <Td style={{ color: 'var(--color-muted-foreground)' }}>
        {p.memory_bytes != null ? formatBytes(p.memory_bytes) : '-'}
      </Td>
      <Td>{p.restart_count}</Td>
      <Td>{modeCell}</Td>
      <Td style={{ color: 'var(--color-muted-foreground)' }}>{formatNextRun(p.cron_next_run)}</Td>
      <Td style={{ color: 'var(--color-muted-foreground)' }} title={p.stopped_at ?? p.started_at ?? ''}>{formatLastRun(p)}</Td>
      <Td>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap' }}>
          {isActive
            ? <>
                <ActionBtn label="Restart" icon={RotateCcw} onClick={doRestart} color="#fb923c" />
                <ActionBtn label="Stop"    icon={Square}    onClick={doStop}    color="#f87171" />
              </>
            : <ActionBtn label="Start" icon={Play} onClick={doStart} color="#4ade80" />
          }
          <ActionBtn label="Logs" icon={ScrollText} onClick={() => navigate(`/processes/${p.id}`)} color="#60a5fa" />
          <ActionBtn label="Edit" icon={Pencil}     onClick={onEdit}      color="#34d399" />
          <ActionBtn label=".env" icon={FileKey}    onClick={onOpenEnv}   color="#fbbf24" />
          <ActionBtn label="Notify" icon={Bell}     onClick={onOpenNotif} color="#a78bfa"
            badge={hasNotify ? '●' : undefined} />
          <ActionBtn label="Delete" icon={Trash2}   onClick={doDelete}    danger />
        </div>
      </Td>
    </tr>
  )
}

// @group Utilities > UI helpers
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--color-muted-foreground)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  )
}

function Td({ children, style, title }: { children?: React.ReactNode; style?: React.CSSProperties; title?: string }) {
  return (
    <td title={title} style={{ padding: '7px 12px', whiteSpace: 'nowrap', ...style }}>
      {children}
    </td>
  )
}

function ActionBtn({ label, icon: Icon, onClick, danger, color, badge }: {
  label: string
  icon: React.ElementType
  onClick: () => void
  danger?: boolean
  color?: string
  badge?: string
}) {
  const iconColor = danger ? 'var(--color-destructive)' : (color ?? 'var(--color-muted-foreground)')
  return (
    <button
      title={label}
      onClick={onClick}
      style={{
        position: 'relative',
        padding: 0, width: 26, height: 26,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
        borderRadius: 4, cursor: 'pointer', flexShrink: 0,
        color: iconColor,
      }}
    >
      <Icon size={13} strokeWidth={1.75} />
      {badge && (
        <span style={{
          position: 'absolute', top: -3, right: -3,
          fontSize: 8, color: iconColor, lineHeight: 1,
        }}>{badge}</span>
      )}
    </button>
  )
}

function NsBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: '2px 8px', fontSize: 11, fontWeight: 600,
      background: 'transparent', border: `1px solid ${danger ? 'var(--color-destructive)' : 'var(--color-border)'}`,
      borderRadius: 4, cursor: 'pointer',
      color: danger ? 'var(--color-destructive)' : 'var(--color-foreground)',
    }}>
      {label}
    </button>
  )
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, background: 'var(--color-secondary)',
  border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer',
  color: 'var(--color-foreground)',
}

