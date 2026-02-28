// @group BusinessLogic : Processes list view — namespace-grouped table

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, RotateCcw, ScrollText, Pencil, Trash2, FileKey, Bell, Save, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
import { EnvFilePanel } from '@/components/EnvFilePanel'
import { formatLastRun, formatNextRun, formatUptime, formatBytes, formatCpu, statusColor } from '@/lib/utils'
import type { AppSettings } from '@/lib/settings'
import type { NotificationConfig, ProcessInfo } from '@/types'

interface Props {
  processes: ProcessInfo[]
  reload: () => void
  settings: AppSettings
}

// @group Utilities > NotifDefaults
function defaultNotifConfig(): NotificationConfig {
  return { events: { on_crash: true, on_restart: false, on_start: false, on_stop: false } }
}

// @group BusinessLogic > ProcessNotifModal : Quick per-process notification config modal
function ProcessNotifModal({ process, onClose }: { process: ProcessInfo; onClose: () => void }) {
  const [config, setConfig] = useState<NotificationConfig>(process.notify ?? defaultNotifConfig())
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  const setEvents  = (patch: Partial<NotificationConfig['events']>) =>
    setConfig(c => ({ ...c, events: { ...c.events, ...patch } }))
  const setWebhook = (patch: Partial<NonNullable<NotificationConfig['webhook']>>) =>
    setConfig(c => ({ ...c, webhook: { url: '', enabled: false, ...c.webhook, ...patch } }))
  const setSlack   = (patch: Partial<NonNullable<NotificationConfig['slack']>>) =>
    setConfig(c => ({ ...c, slack: { webhook_url: '', enabled: false, ...c.slack, ...patch } }))
  const setTeams   = (patch: Partial<NonNullable<NotificationConfig['teams']>>) =>
    setConfig(c => ({ ...c, teams: { webhook_url: '', enabled: false, ...c.teams, ...patch } }))

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await api.getProcess(process.id).then(info =>
        api.updateProcess(process.id, {
          script: info.script, cwd: info.cwd ?? undefined,
          namespace: info.namespace, args: info.args, env: info.env,
          autorestart: info.autorestart, watch: info.watch,
          max_restarts: info.max_restarts, cron: info.cron ?? undefined,
          notify: config,
        })
      )
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally { setSaving(false) }
  }

  async function handleTest() {
    setTesting(true); setError('')
    try { await api.testNotification(config) }
    catch (e: any) { setError(String(e.message ?? e)) }
    finally { setTesting(false) }
  }

  const processEventKeys = ['on_crash', 'on_restart', 'on_start', 'on_stop'] as const
  const cronEventKeys    = ['on_cron_run', 'on_cron_fail'] as const

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, width: 460, maxWidth: '94vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} style={{ color: '#a78bfa' }} />
          <strong style={{ flex: 1, fontSize: 13 }}>Notify — {process.name}</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-muted-foreground)' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Separated event panels */}
          <div style={{ display: 'flex', gap: 8 }}>

            {/* Process events */}
            <div style={{
              flex: 1, borderRadius: 6,
              border: '1px solid rgba(99,102,241,0.35)',
              background: 'rgba(99,102,241,0.06)',
              padding: '8px 12px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#818cf8', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>⚙</span> Process
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {processEventKeys.map(key => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!config.events[key]} onChange={e => setEvents({ [key]: e.target.checked })}
                      style={{ accentColor: '#818cf8', width: 13, height: 13 }} />
                    {key.replace('on_', '')}
                  </label>
                ))}
              </div>
            </div>

            {/* Cron events — only shown for cron processes */}
            {process.cron && (
              <div style={{
                flex: 1, borderRadius: 6,
                border: '1px solid rgba(251,191,36,0.35)',
                background: 'rgba(251,191,36,0.06)',
                padding: '8px 12px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>⏰</span> Cron
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cronEventKeys.map(key => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!config.events[key]} onChange={e => setEvents({ [key]: e.target.checked })}
                        style={{ accentColor: '#fbbf24', width: 13, height: 13 }} />
                      {key.replace('on_cron_', '')}
                    </label>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Channel fields */}
          {(
            [
              {
                label: 'Webhook',
                enabled: config.webhook?.enabled ?? false,
                onToggle: (v: boolean) => setWebhook({ enabled: v }),
                fields: [
                  { label: 'URL', type: 'url', placeholder: 'https://hooks.example.com/…',
                    value: config.webhook?.url ?? '',
                    onChange: (v: string) => setWebhook({ url: v }) },
                ],
              },
              {
                label: 'Slack',
                enabled: config.slack?.enabled ?? false,
                onToggle: (v: boolean) => setSlack({ enabled: v }),
                fields: [
                  { label: 'Webhook URL', type: 'url', placeholder: 'https://hooks.slack.com/services/…',
                    value: config.slack?.webhook_url ?? '',
                    onChange: (v: string) => setSlack({ webhook_url: v }) },
                  { label: 'Channel (optional)', type: 'text', placeholder: '#alerts',
                    value: config.slack?.channel ?? '',
                    onChange: (v: string) => setSlack({ channel: v }) },
                ],
              },
              {
                label: 'Microsoft Teams',
                enabled: config.teams?.enabled ?? false,
                onToggle: (v: boolean) => setTeams({ enabled: v }),
                fields: [
                  { label: 'Webhook URL', type: 'url', placeholder: 'https://outlook.office.com/webhook/…',
                    value: config.teams?.webhook_url ?? '',
                    onChange: (v: string) => setTeams({ webhook_url: v }) },
                ],
              },
            ] as const
          ).map(ch => (
            <div key={ch.label} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: ch.enabled ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' }}>
                <input type="checkbox" checked={ch.enabled} onChange={e => ch.onToggle(e.target.checked)}
                  style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }} />
                {ch.label}
              </label>
              {ch.enabled && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ch.fields.map(f => (
                    <div key={f.label}>
                      <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginBottom: 3 }}>{f.label}</div>
                      <input style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12, background: 'var(--color-secondary)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-foreground)', outline: 'none' }}
                        type={f.type} placeholder={f.placeholder} value={f.value}
                        onChange={e => f.onChange(e.target.value)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {error && <div style={{ fontSize: 12, color: 'var(--color-destructive)' }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={handleSave} disabled={saving} style={modalPrimaryBtn}>
            <Save size={12} />{saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={handleTest} disabled={testing} style={modalSecBtn}>
            <Send size={12} />{testing ? '…' : 'Test'}
          </button>
          <button onClick={onClose} style={modalSecBtn}>Cancel</button>
          {saved && <span style={{ fontSize: 12, color: 'var(--color-status-running)' }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  )
}

// @group BusinessLogic > NsNotifModal : Quick namespace notification config modal
function NsNotifModal({ ns, onClose }: { ns: string; onClose: () => void }) {
  const [config, setConfig] = useState<NotificationConfig>(defaultNotifConfig())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  useState(() => {
    api.getNotifications().then(store => {
      if (store.namespaces[ns]) setConfig(store.namespaces[ns])
      setLoading(false)
    }).catch(() => setLoading(false))
  })

  const setEvents  = (patch: Partial<NotificationConfig['events']>) =>
    setConfig(c => ({ ...c, events: { ...c.events, ...patch } }))
  const setWebhook = (patch: Partial<NonNullable<NotificationConfig['webhook']>>) =>
    setConfig(c => ({ ...c, webhook: { url: '', enabled: false, ...c.webhook, ...patch } }))
  const setSlack   = (patch: Partial<NonNullable<NotificationConfig['slack']>>) =>
    setConfig(c => ({ ...c, slack: { webhook_url: '', enabled: false, ...c.slack, ...patch } }))
  const setTeams   = (patch: Partial<NonNullable<NotificationConfig['teams']>>) =>
    setConfig(c => ({ ...c, teams: { webhook_url: '', enabled: false, ...c.teams, ...patch } }))

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await api.updateNamespaceNotifications(ns, config)
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    } catch (e: any) { setError(String(e.message ?? e)) }
    finally { setSaving(false) }
  }

  async function handleTest() {
    setTesting(true); setError('')
    try { await api.testNotification(config) }
    catch (e: any) { setError(String(e.message ?? e)) }
    finally { setTesting(false) }
  }

  const processEventKeys = ['on_crash', 'on_restart', 'on_start', 'on_stop'] as const
  const cronEventKeys    = ['on_cron_run', 'on_cron_fail'] as const

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, width: 460, maxWidth: '94vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} style={{ color: '#a78bfa' }} />
          <strong style={{ flex: 1, fontSize: 13 }}>Namespace Notify — {ns}</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-muted-foreground)' }}>×</button>
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-muted-foreground)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Separated event panels */}
              <div style={{ display: 'flex', gap: 8 }}>
                {/* Process events */}
                <div style={{ flex: 1, borderRadius: 6, border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.06)', padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#818cf8', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>⚙</span> Process
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {processEventKeys.map(key => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!config.events[key]} onChange={e => setEvents({ [key]: e.target.checked })}
                          style={{ accentColor: '#818cf8', width: 13, height: 13 }} />
                        {key.replace('on_', '')}
                      </label>
                    ))}
                  </div>
                </div>
                {/* Cron events */}
                <div style={{ flex: 1, borderRadius: 6, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.06)', padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>⏰</span> Cron
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {cronEventKeys.map(key => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!config.events[key]} onChange={e => setEvents({ [key]: e.target.checked })}
                          style={{ accentColor: '#fbbf24', width: 13, height: 13 }} />
                        {key.replace('on_cron_', '')}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              {/* Channel fields — Webhook / Slack / Teams */}
              {(
                [
                  {
                    label: 'Webhook',
                    enabled: config.webhook?.enabled ?? false,
                    onToggle: (v: boolean) => setWebhook({ enabled: v }),
                    fields: [
                      { label: 'URL', type: 'url', placeholder: 'https://hooks.example.com/…',
                        value: config.webhook?.url ?? '',
                        onChange: (v: string) => setWebhook({ url: v }) },
                    ],
                  },
                  {
                    label: 'Slack',
                    enabled: config.slack?.enabled ?? false,
                    onToggle: (v: boolean) => setSlack({ enabled: v }),
                    fields: [
                      { label: 'Webhook URL', type: 'url', placeholder: 'https://hooks.slack.com/services/…',
                        value: config.slack?.webhook_url ?? '',
                        onChange: (v: string) => setSlack({ webhook_url: v }) },
                      { label: 'Channel (optional)', type: 'text', placeholder: '#alerts',
                        value: config.slack?.channel ?? '',
                        onChange: (v: string) => setSlack({ channel: v }) },
                    ],
                  },
                  {
                    label: 'Microsoft Teams',
                    enabled: config.teams?.enabled ?? false,
                    onToggle: (v: boolean) => setTeams({ enabled: v }),
                    fields: [
                      { label: 'Webhook URL', type: 'url', placeholder: 'https://outlook.office.com/webhook/…',
                        value: config.teams?.webhook_url ?? '',
                        onChange: (v: string) => setTeams({ webhook_url: v }) },
                    ],
                  },
                ] as const
              ).map(ch => (
                <div key={ch.label} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: ch.enabled ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' }}>
                    <input type="checkbox" checked={ch.enabled} onChange={e => ch.onToggle(e.target.checked)}
                      style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }} />
                    {ch.label}
                  </label>
                  {ch.enabled && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {ch.fields.map(f => (
                        <div key={f.label}>
                          <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginBottom: 3 }}>{f.label}</div>
                          <input style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12, background: 'var(--color-secondary)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-foreground)', outline: 'none' }}
                            type={f.type} placeholder={f.placeholder} value={f.value}
                            onChange={e => f.onChange(e.target.value)} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {error && <div style={{ fontSize: 12, color: 'var(--color-destructive)' }}>{error}</div>}
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={handleSave} disabled={saving} style={modalPrimaryBtn}>
                <Save size={12} />{saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={handleTest} disabled={testing} style={modalSecBtn}>
                <Send size={12} />{testing ? '…' : 'Test'}
              </button>
              <button onClick={onClose} style={modalSecBtn}>Cancel</button>
              {saved && <span style={{ fontSize: 12, color: 'var(--color-status-running)' }}>✓ Saved</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function ProcessesPage({ processes, reload, settings }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [envModalProcess, setEnvModalProcess] = useState<ProcessInfo | null>(null)
  const [notifProcess, setNotifProcess]       = useState<ProcessInfo | null>(null)
  const [notifNs, setNotifNs]                 = useState<string | null>(null)
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
            <button onClick={reload} style={smallBtnStyle}>↻ Refresh</button>
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
function ProcessRow({ p, reload, confirmDelete, onConfirm, onDanger, onOpenDetail, onEdit, onOpenEnv, onOpenNotif }: {
  p: ProcessInfo
  reload: () => void
  confirmDelete: boolean
  onConfirm: (title: string, message?: string) => Promise<boolean>
  onDanger: (title: string, message?: string, confirmLabel?: string) => Promise<boolean>
  onOpenDetail: () => void
  onEdit: () => void
  onOpenEnv: () => void
  onOpenNotif: () => void
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
      <Td>{p.pid ?? '-'}</Td>
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

const modalPrimaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', fontSize: 12, fontWeight: 500,
  background: 'var(--color-primary)', border: 'none',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-primary-foreground)',
}

const modalSecBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', fontSize: 12,
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-foreground)',
}
