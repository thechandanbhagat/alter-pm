// @group BusinessLogic : Shared notification config modals — per-process and per-namespace

import { useState } from 'react'
import { Bell, Save, Send } from 'lucide-react'
import { api } from '@/lib/api'
import type { NotificationConfig, ProcessInfo } from '@/types'

// @group Utilities > NotifDefaults
export function defaultNotifConfig(): NotificationConfig {
  return { events: { on_crash: true, on_restart: false, on_start: false, on_stop: false } }
}

// @group Utilities > Styles : Shared modal button styles
export const modalPrimaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', fontSize: 12, fontWeight: 500,
  background: 'var(--color-primary)', border: 'none',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-primary-foreground)',
}

export const modalSecBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', fontSize: 12,
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-foreground)',
}

// @group BusinessLogic > ChannelFields : Shared channel config rows (Webhook / Slack / Teams)
function ChannelFields({
  config,
  setWebhook,
  setSlack,
  setTeams,
  setDiscord,
}: {
  config: NotificationConfig
  setWebhook: (p: Partial<NonNullable<NotificationConfig['webhook']>>) => void
  setSlack:   (p: Partial<NonNullable<NotificationConfig['slack']>>)   => void
  setTeams:   (p: Partial<NonNullable<NotificationConfig['teams']>>)   => void
  setDiscord: (p: Partial<NonNullable<NotificationConfig['discord']>>) => void
}) {
  const channels = [
    {
      label: 'Webhook',
      enabled: config.webhook?.enabled ?? false,
      onToggle: (v: boolean) => setWebhook({ enabled: v }),
      fields: [
        { label: 'URL', type: 'url' as const, placeholder: 'https://hooks.example.com/…',
          value: config.webhook?.url ?? '',
          onChange: (v: string) => setWebhook({ url: v }) },
      ],
    },
    {
      label: 'Slack',
      enabled: config.slack?.enabled ?? false,
      onToggle: (v: boolean) => setSlack({ enabled: v }),
      fields: [
        { label: 'Webhook URL', type: 'url' as const, placeholder: 'https://hooks.slack.com/services/…',
          value: config.slack?.webhook_url ?? '',
          onChange: (v: string) => setSlack({ webhook_url: v }) },
        { label: 'Channel (optional)', type: 'text' as const, placeholder: '#alerts',
          value: config.slack?.channel ?? '',
          onChange: (v: string) => setSlack({ channel: v }) },
      ],
    },
    {
      label: 'Microsoft Teams',
      enabled: config.teams?.enabled ?? false,
      onToggle: (v: boolean) => setTeams({ enabled: v }),
      fields: [
        { label: 'Webhook URL', type: 'url' as const, placeholder: 'https://outlook.office.com/webhook/…',
          value: config.teams?.webhook_url ?? '',
          onChange: (v: string) => setTeams({ webhook_url: v }) },
      ],
    },
    {
      label: 'Discord',
      enabled: config.discord?.enabled ?? false,
      onToggle: (v: boolean) => setDiscord({ enabled: v }),
      fields: [
        { label: 'Webhook URL', type: 'url' as const, placeholder: 'https://discord.com/api/webhooks/…',
          value: config.discord?.webhook_url ?? '',
          onChange: (v: string) => setDiscord({ webhook_url: v }) },
      ],
    },
  ]

  return (
    <>
      {channels.map(ch => (
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
                  <input
                    style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12, background: 'var(--color-secondary)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-foreground)', outline: 'none' }}
                    type={f.type} placeholder={f.placeholder} value={f.value}
                    onChange={e => f.onChange(e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

// @group BusinessLogic > EventPanels : Process and cron event checkbox panels
function EventPanels({
  config,
  setEvents,
  showCronEvents,
}: {
  config: NotificationConfig
  setEvents: (p: Partial<NotificationConfig['events']>) => void
  showCronEvents: boolean
}) {
  const processEventKeys = ['on_crash', 'on_restart', 'on_start', 'on_stop'] as const
  const cronEventKeys    = ['on_cron_run', 'on_cron_fail'] as const

  return (
    <div style={{ display: 'flex', gap: 8 }}>
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

      {showCronEvents && (
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
      )}
    </div>
  )
}

// @group BusinessLogic > ProcessNotifModal : Per-process notification config modal
export function ProcessNotifModal({ process, onClose }: { process: ProcessInfo; onClose: () => void }) {
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
  const setDiscord = (patch: Partial<NonNullable<NotificationConfig['discord']>>) =>
    setConfig(c => ({ ...c, discord: { webhook_url: '', enabled: false, ...c.discord, ...patch } }))

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

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, width: 460, maxWidth: '94vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} style={{ color: '#a78bfa' }} />
          <strong style={{ flex: 1, fontSize: 13 }}>Notify — {process.name}</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-muted-foreground)' }}>×</button>
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <EventPanels config={config} setEvents={setEvents} showCronEvents={!!process.cron} />
          <ChannelFields config={config} setWebhook={setWebhook} setSlack={setSlack} setTeams={setTeams} setDiscord={setDiscord} />
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
      </div>
    </div>
  )
}

// @group BusinessLogic > NsNotifModal : Per-namespace notification config modal
export function NsNotifModal({ ns, onClose }: { ns: string; onClose: () => void }) {
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
  const setDiscord = (patch: Partial<NonNullable<NotificationConfig['discord']>>) =>
    setConfig(c => ({ ...c, discord: { webhook_url: '', enabled: false, ...c.discord, ...patch } }))

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
              <EventPanels config={config} setEvents={setEvents} showCronEvents />
              <ChannelFields config={config} setWebhook={setWebhook} setSlack={setSlack} setTeams={setTeams} setDiscord={setDiscord} />
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
