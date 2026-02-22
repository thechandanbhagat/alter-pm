// @group BusinessLogic : Cron Jobs list view — filtered processes with run history

import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
import { formatNextRun, statusColor } from '@/lib/utils'
import type { AppSettings } from '@/lib/settings'
import type { CronRun, ProcessInfo } from '@/types'

interface Props {
  processes: ProcessInfo[]
  reload: () => void
  settings: AppSettings
}

// @group Utilities > CronDescription : Human-readable schedule description (duplicated for tree-shaking)
function describeSchedule(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr
  const [min, hour, dom, month, dow] = parts
  if (expr === '* * * * *') return 'Every minute'
  if (min.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') return `Every ${min.slice(2)}m`
  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Hourly'
  if (min !== '*' && hour !== '*' && dom === '*' && month === '*' && dow === '*') return `Daily ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`
  if (min !== '*' && hour !== '*' && dom === '*' && month === '*' && dow !== '*') {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    return `${days[parseInt(dow)] ?? dow}s ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`
  }
  if (min !== '*' && hour !== '*' && dom !== '*' && month === '*' && dow === '*') return `Monthly day ${dom}`
  return expr
}

// @group Utilities > LastRun : Format last cron run entry
function LastRunCell({ history }: { history: CronRun[] }) {
  if (history.length === 0) return <span style={{ color: 'var(--color-muted-foreground)' }}>—</span>
  const last = history[history.length - 1]
  const d = new Date(last.run_at)
  const diffSecs = Math.floor((Date.now() - d.getTime()) / 1000)
  let ago: string
  if (diffSecs < 60)    ago = `${diffSecs}s ago`
  else if (diffSecs < 3600) ago = `${Math.floor(diffSecs / 60)}m ago`
  else if (diffSecs < 86400) ago = `${Math.floor(diffSecs / 3600)}h ago`
  else ago = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  const code = last.exit_code
  const pillColor = code === null ? '#888' : code === 0 ? 'var(--color-status-running)' : 'var(--color-destructive)'
  const pillBg   = code === null ? 'rgba(128,128,128,0.15)' : code === 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: 'var(--color-muted-foreground)' }}>{ago}</span>
      <span style={{
        display: 'inline-block', padding: '1px 6px', borderRadius: 4,
        fontSize: 10, fontWeight: 700, color: pillColor, background: pillBg,
      }}>
        {code === null ? '?' : `exit ${code}`}
      </span>
      {last.duration_secs > 0 && (
        <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>{last.duration_secs}s</span>
      )}
    </span>
  )
}

export default function CronJobsPage({ processes, reload, settings }: Props) {
  const navigate = useNavigate()
  const cronJobs = processes.filter(p => p.cron !== null)
  const { dialogState, confirm, danger, handleConfirm, handleCancel } = useDialog()

  if (cronJobs.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏱</div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>No cron jobs yet</div>
        <div style={{ color: 'var(--color-muted-foreground)', fontSize: 13, marginBottom: 20 }}>
          Schedule scripts to run automatically on a time-based schedule.
        </div>
        <button onClick={() => navigate('/cron-jobs/new')} style={{
          padding: '8px 20px', fontSize: 13, fontWeight: 600,
          background: 'var(--color-primary)', border: 'none', borderRadius: 5,
          cursor: 'pointer', color: '#fff',
        }}>
          ⏱ Create Cron Job
        </button>
      </div>
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

      {/* Header */}
      <div style={{
        padding: '16px 20px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Cron Jobs <span style={{ fontWeight: 400, color: 'var(--color-muted-foreground)', fontSize: 13 }}>({cronJobs.length})</span></h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reload} style={smallBtnStyle}>↻ Refresh</button>
          <button onClick={() => navigate('/cron-jobs/new')} style={{
            ...smallBtnStyle, background: 'var(--color-primary)', color: '#fff', border: 'none', fontWeight: 600,
          }}>⏱ New Cron Job</button>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>
              {['Name', 'Schedule', 'Next Run', 'Last Run', 'Status', 'Actions'].map(h => (
                <Th key={h}>{h}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cronJobs.map(p => (
              <CronJobRow key={p.id} p={p} reload={reload}
                confirmDelete={settings.confirmBeforeDelete}
                onConfirm={confirm} onDanger={danger}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CronJobRow({ p, reload, confirmDelete, onConfirm, onDanger }: {
  p: ProcessInfo
  reload: () => void
  confirmDelete: boolean
  onConfirm: (title: string, message?: string) => Promise<boolean>
  onDanger: (title: string, message?: string, confirmLabel?: string) => Promise<boolean>
}) {
  const navigate = useNavigate()
  const isActive = p.status === 'running' || p.status === 'sleeping'

  async function doRunNow() {
    await api.startStopped(p.id).catch(() => {})
    setTimeout(reload, 400)
  }
  async function doStop() {
    const ok = await onConfirm(`Stop "${p.name}"?`, 'The cron job will stop. The schedule will resume when you start it again.')
    if (!ok) return
    await api.stopProcess(p.id).catch(() => {})
    reload()
  }
  async function doDelete() {
    if (confirmDelete) {
      const ok = await onDanger(`Delete "${p.name}"?`, 'This will permanently remove the cron job and its configuration.', 'Delete')
      if (!ok) return
    }
    await api.deleteProcess(p.id).catch(() => {})
    setTimeout(reload, 300)
  }

  return (
    <tr
      style={{ borderBottom: '1px solid var(--color-border)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Name */}
      <Td>
        <div>
          <strong style={{ cursor: 'pointer' }} onClick={() => navigate(`/processes/${p.id}`)}>{p.name}</strong>
          {p.namespace !== 'default' && (
            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-muted-foreground)', background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>
              {p.namespace}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2, fontFamily: 'monospace' }}>
          {p.script} {p.args.join(' ')}
        </div>
      </Td>

      {/* Schedule */}
      <Td>
        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.cron}</div>
        <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2 }}>{describeSchedule(p.cron!)}</div>
      </Td>

      {/* Next Run */}
      <Td style={{ color: 'var(--color-status-sleeping)' }}>
        {p.status === 'stopped' || p.status === 'errored'
          ? <span style={{ color: 'var(--color-muted-foreground)' }}>paused</span>
          : formatNextRun(p.cron_next_run)
        }
      </Td>

      {/* Last Run */}
      <Td><LastRunCell history={p.cron_run_history} /></Td>

      {/* Status */}
      <Td>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: statusColor(p.status),
        }}>
          ● {p.status}
        </span>
      </Td>

      {/* Actions */}
      <Td>
        <div style={{ display: 'flex', gap: 4 }}>
          {isActive
            ? <ActionBtn label="Run Now" onClick={doRunNow} title="Trigger an immediate run" />
            : <ActionBtn label="▶ Start" onClick={doRunNow} />
          }
          {isActive && <ActionBtn label="■ Stop" onClick={doStop} />}
          <ActionBtn label="Logs" onClick={() => navigate(`/processes/${p.id}`)} />
          <ActionBtn label="Edit" onClick={() => navigate(`/edit/${p.id}`)} />
          <ActionBtn label="Delete" onClick={doDelete} danger />
        </div>
      </Td>
    </tr>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--color-muted-foreground)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  )
}

function Td({ children, style, title }: { children?: React.ReactNode; style?: React.CSSProperties; title?: string }) {
  return (
    <td title={title} style={{ padding: '10px 14px', verticalAlign: 'middle', ...style }}>
      {children}
    </td>
  )
}

function ActionBtn({ label, onClick, danger, title }: { label: string; onClick: () => void; danger?: boolean; title?: string }) {
  return (
    <button title={title} onClick={onClick} style={{
      padding: '3px 9px', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
      borderRadius: 4, cursor: 'pointer',
      color: danger ? 'var(--color-destructive)' : 'var(--color-foreground)',
    }}>
      {label}
    </button>
  )
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 12px', fontSize: 12,
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-foreground)',
}
