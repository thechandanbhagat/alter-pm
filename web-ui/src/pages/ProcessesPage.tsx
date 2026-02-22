// @group BusinessLogic : Processes list view — namespace-grouped table

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
import { formatLastRun, formatNextRun, formatUptime, statusColor } from '@/lib/utils'
import type { AppSettings } from '@/lib/settings'
import type { ProcessInfo } from '@/types'

interface Props {
  processes: ProcessInfo[]
  reload: () => void
  settings: AppSettings
}

export default function ProcessesPage({ processes, reload, settings }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const navigate = useNavigate()
  const { dialogState, confirm, danger, handleConfirm, handleCancel } = useDialog()

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

      <div style={{ padding: '16px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Processes</h2>
        <button onClick={reload} style={smallBtnStyle}>↻ Refresh</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>
              {['ID', 'Name', 'Status', 'PID', 'Uptime', 'Restarts', 'Mode', 'Next Run', 'Last Run', 'Actions'].map(h => (
                <Th key={h}>{h}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedNs.map(ns => {
              const procs = groups.get(ns)!
              const isCollapsed = collapsed.has(ns)
              const allActive = procs.every(p => p.status === 'running' || p.status === 'watching')
              const allInactive = procs.every(p => p.status !== 'running' && p.status !== 'watching')
              return [
                // Namespace header row
                <tr key={`ns-${ns}`}
                  onClick={() => toggleNs(ns)}
                  style={{ background: 'var(--color-muted)', cursor: 'pointer', userSelect: 'none' }}
                >
                  <td colSpan={10} style={{ padding: '6px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>{isCollapsed ? '▶' : '▼'}</span>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{ns}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>{procs.length} process{procs.length !== 1 ? 'es' : ''}</span>
                      <span onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        {!allActive && <NsBtn label="▶ Start All" onClick={() => startAll(ns)} />}
                        {!allInactive && <NsBtn label="■ Stop All" onClick={() => stopAll(ns)} danger />}
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
                  />
                )) : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// @group BusinessLogic > ProcessRow : Single process table row
function ProcessRow({ p, reload, confirmDelete, onConfirm, onDanger, onOpenDetail, onEdit }: {
  p: ProcessInfo
  reload: () => void
  confirmDelete: boolean
  onConfirm: (title: string, message?: string) => Promise<boolean>
  onDanger: (title: string, message?: string, confirmLabel?: string) => Promise<boolean>
  onOpenDetail: () => void
  onEdit: () => void
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
      <Td>{p.pid ?? '-'}</Td>
      <Td>{p.uptime_secs != null ? formatUptime(p.uptime_secs) : '-'}</Td>
      <Td>{p.restart_count}</Td>
      <Td>{modeCell}</Td>
      <Td style={{ color: 'var(--color-muted-foreground)' }}>{formatNextRun(p.cron_next_run)}</Td>
      <Td style={{ color: 'var(--color-muted-foreground)' }} title={p.stopped_at ?? p.started_at ?? ''}>{formatLastRun(p)}</Td>
      <Td>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
          {isActive
            ? <>
                <ActionBtn label="Restart" onClick={doRestart} />
                <ActionBtn label="Stop" onClick={doStop} />
              </>
            : <ActionBtn label="Start" onClick={doStart} />
          }
          <ActionBtn label="Logs" onClick={() => navigate(`/processes/${p.id}`)} />
          <ActionBtn label="Edit" onClick={onEdit} />
          <ActionBtn label="Delete" onClick={doDelete} danger />
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

function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: '2px 8px', fontSize: 11, fontWeight: 500,
      background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
      borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
      color: danger ? 'var(--color-destructive)' : 'var(--color-foreground)',
    }}>
      {label}
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
