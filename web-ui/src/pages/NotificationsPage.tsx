// @group BusinessLogic : Notification settings page — global + namespace overrides for webhook/Slack/Teams

import { useEffect, useState } from 'react'
import { Bell, Plus, Trash2, Send, Save, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { NotificationConfig, NotificationEvents, NotificationsStore } from '@/types'

// @group Utilities > Styles : Shared style tokens
const cardStyle: React.CSSProperties = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '16px 20px',
  marginBottom: 14,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  background: 'var(--color-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 5,
  color: 'var(--color-foreground)',
  outline: 'none',
}

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 14px', fontSize: 12, fontWeight: 500,
  background: 'var(--color-primary)', border: 'none',
  borderRadius: 5, cursor: 'pointer',
  color: 'var(--color-primary-foreground)',
}

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 12px', fontSize: 12, fontWeight: 500,
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-foreground)',
}

const btnDanger: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '4px 8px', fontSize: 11,
  background: 'transparent', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-destructive)',
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '10px 14px',
}

const legendStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--color-muted-foreground)', padding: '0 4px',
}

const labelTextStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--color-muted-foreground)', marginBottom: 4, display: 'block',
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--color-muted-foreground)', textTransform: 'uppercase',
  marginBottom: 12,
}

// @group Utilities > DefaultConfig : Returns a blank NotificationConfig
function defaultConfig(): NotificationConfig {
  return {
    events: { on_crash: true, on_restart: false, on_start: false, on_stop: false, on_cron_run: false, on_cron_fail: true },
  }
}

// @group BusinessLogic > NotifCard : Editable card for one NotificationConfig scope
interface NotifCardProps {
  title: string
  config: NotificationConfig
  onChange: (c: NotificationConfig) => void
  onSave: () => Promise<void>
  onTest: () => Promise<void>
  onDelete?: () => void
  saving: boolean
  testing: boolean
  saved: boolean
  error: string | null
}

function NotifCard({
  title, config, onChange, onSave, onTest, onDelete,
  saving, testing, saved, error,
}: NotifCardProps) {
  const [open, setOpen] = useState(true)

  const setEvents = (patch: Partial<NotificationEvents>) =>
    onChange({ ...config, events: { ...config.events, ...patch } })

  const setWebhook = (patch: Partial<NonNullable<NotificationConfig['webhook']>>) =>
    onChange({ ...config, webhook: { url: '', enabled: false, ...config.webhook, ...patch } })

  const setSlack = (patch: Partial<NonNullable<NotificationConfig['slack']>>) =>
    onChange({ ...config, slack: { webhook_url: '', enabled: false, ...config.slack, ...patch } })

  const setTeams = (patch: Partial<NonNullable<NotificationConfig['teams']>>) =>
    onChange({ ...config, teams: { webhook_url: '', enabled: false, ...config.teams, ...patch } })

  // @group Utilities > EventCheckbox : Single event toggle checkbox
  function EventCheckbox({ eventKey, label }: { eventKey: keyof NotificationEvents; label: string }) {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!config.events[eventKey]}
          onChange={e => setEvents({ [eventKey]: e.target.checked })}
          style={{ accentColor: 'var(--color-primary)', width: 14, height: 14 }}
        />
        {label}
      </label>
    )
  }

  return (
    <div style={cardStyle}>
      {/* Card header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Bell size={14} style={{ opacity: 0.5 }} />
        <strong style={{ flex: 1, fontSize: 13 }}>{title}</strong>
        {onDelete && (
          <button
            style={btnDanger}
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Remove namespace override"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* @group BusinessLogic > EventToggles : Separated process vs cron event panels */}
          <div style={{ display: 'flex', gap: 10 }}>

            {/* Process events panel */}
            <div style={{
              flex: 1,
              borderRadius: 7,
              border: '1px solid rgba(99,102,241,0.35)',
              background: 'rgba(99,102,241,0.06)',
              padding: '10px 14px',
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                color: '#818cf8', textTransform: 'uppercase', marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontSize: 13 }}>⚙</span> Process Events
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <EventCheckbox eventKey="on_crash"   label="Crash" />
                <EventCheckbox eventKey="on_restart" label="Restart" />
                <EventCheckbox eventKey="on_start"   label="Start" />
                <EventCheckbox eventKey="on_stop"    label="Stop" />
              </div>
            </div>

            {/* Cron job events panel */}
            <div style={{
              flex: 1,
              borderRadius: 7,
              border: '1px solid rgba(251,191,36,0.35)',
              background: 'rgba(251,191,36,0.06)',
              padding: '10px 14px',
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                color: '#fbbf24', textTransform: 'uppercase', marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontSize: 13 }}>⏰</span> Cron Events
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <EventCheckbox eventKey="on_cron_run"  label="Run" />
                <EventCheckbox eventKey="on_cron_fail" label="Fail" />
              </div>
            </div>

          </div>

          {/* Webhook */}
          <div style={fieldsetStyle}>
            <label style={{ ...legendStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.webhook?.enabled ?? false}
                onChange={e => setWebhook({ enabled: e.target.checked })}
                style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
              />
              Generic Webhook
            </label>
            <div style={{ marginTop: 10, opacity: config.webhook?.enabled ? 1 : 0.5 }}>
              <span style={labelTextStyle}>URL</span>
              <input
                style={inputStyle}
                type="url"
                placeholder="https://example.com/webhook"
                value={config.webhook?.url ?? ''}
                onChange={e => setWebhook({ url: e.target.value })}
                disabled={!config.webhook?.enabled}
              />
            </div>
          </div>

          {/* Slack */}
          <div style={fieldsetStyle}>
            <label style={{ ...legendStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.slack?.enabled ?? false}
                onChange={e => setSlack({ enabled: e.target.checked })}
                style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
              />
              Slack
            </label>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, opacity: config.slack?.enabled ? 1 : 0.5 }}>
              <div>
                <span style={labelTextStyle}>Webhook URL</span>
                <input
                  style={inputStyle}
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={config.slack?.webhook_url ?? ''}
                  onChange={e => setSlack({ webhook_url: e.target.value })}
                  disabled={!config.slack?.enabled}
                />
              </div>
              <div>
                <span style={labelTextStyle}>Channel (optional)</span>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="#alerts"
                  value={config.slack?.channel ?? ''}
                  onChange={e => setSlack({ channel: e.target.value })}
                  disabled={!config.slack?.enabled}
                />
              </div>
            </div>
          </div>

          {/* Teams */}
          <div style={fieldsetStyle}>
            <label style={{ ...legendStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.teams?.enabled ?? false}
                onChange={e => setTeams({ enabled: e.target.checked })}
                style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
              />
              Microsoft Teams
            </label>
            <div style={{ marginTop: 10, opacity: config.teams?.enabled ? 1 : 0.5 }}>
              <span style={labelTextStyle}>Webhook URL</span>
              <input
                style={inputStyle}
                type="url"
                placeholder="https://outlook.office.com/webhook/..."
                value={config.teams?.webhook_url ?? ''}
                onChange={e => setTeams({ webhook_url: e.target.value })}
                disabled={!config.teams?.enabled}
              />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }} onClick={onSave} disabled={saving}>
              <Save size={13} />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button style={{ ...btnSecondary, opacity: testing ? 0.7 : 1 }} onClick={onTest} disabled={testing}>
              <Send size={13} />
              {testing ? 'Sending…' : 'Test'}
            </button>
            {saved && <span style={{ fontSize: 12, color: 'var(--color-status-running)' }}>✓ Saved</span>}
            {error && <span style={{ fontSize: 12, color: 'var(--color-destructive)' }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// @group BusinessLogic > NotificationsPage : Main page component
export default function NotificationsPage() {
  const [store, setStore] = useState<NotificationsStore | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Per-scope save/test state
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalTesting, setGlobalTesting] = useState(false)
  const [globalSaved, setGlobalSaved] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const [nsSaving, setNsSaving] = useState<Record<string, boolean>>({})
  const [nsTesting, setNsTesting] = useState<Record<string, boolean>>({})
  const [nsSaved, setNsSaved] = useState<Record<string, boolean>>({})
  const [nsError, setNsError] = useState<Record<string, string | null>>({})

  const [newNsName, setNewNsName] = useState('')
  const [addingNs, setAddingNs] = useState(false)

  useEffect(() => {
    api.getNotifications()
      .then(s => setStore(s))
      .catch(e => setFetchError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--color-muted-foreground)' }}>Loading…</div>
    )
  }
  if (fetchError || !store) {
    return (
      <div style={{ padding: 24, color: 'var(--color-destructive)' }}>
        Failed to load notifications: {fetchError}
      </div>
    )
  }

  const updateGlobalConfig = (c: NotificationConfig) =>
    setStore(s => s ? { ...s, global: c } : s)

  const saveGlobal = async () => {
    setGlobalSaving(true)
    setGlobalError(null)
    setGlobalSaved(false)
    try {
      await api.updateGlobalNotifications(store.global)
      setGlobalSaved(true)
      setTimeout(() => setGlobalSaved(false), 3000)
    } catch (e) {
      setGlobalError(String(e))
    } finally {
      setGlobalSaving(false)
    }
  }

  const testGlobal = async () => {
    setGlobalTesting(true)
    setGlobalError(null)
    try {
      await api.testNotification(store.global)
    } catch (e) {
      setGlobalError(String(e))
    } finally {
      setGlobalTesting(false)
    }
  }

  const updateNsConfig = (ns: string, c: NotificationConfig) =>
    setStore(s => s ? { ...s, namespaces: { ...s.namespaces, [ns]: c } } : s)

  const saveNs = async (ns: string) => {
    setNsSaving(p => ({ ...p, [ns]: true }))
    setNsError(p => ({ ...p, [ns]: null }))
    setNsSaved(p => ({ ...p, [ns]: false }))
    try {
      await api.updateNamespaceNotifications(ns, store.namespaces[ns])
      setNsSaved(p => ({ ...p, [ns]: true }))
      setTimeout(() => setNsSaved(p => ({ ...p, [ns]: false })), 3000)
    } catch (e) {
      setNsError(p => ({ ...p, [ns]: String(e) }))
    } finally {
      setNsSaving(p => ({ ...p, [ns]: false }))
    }
  }

  const testNs = async (ns: string) => {
    setNsTesting(p => ({ ...p, [ns]: true }))
    setNsError(p => ({ ...p, [ns]: null }))
    try {
      await api.testNotification(store.namespaces[ns])
    } catch (e) {
      setNsError(p => ({ ...p, [ns]: String(e) }))
    } finally {
      setNsTesting(p => ({ ...p, [ns]: false }))
    }
  }

  const deleteNs = async (ns: string) => {
    try {
      await api.deleteNamespaceNotifications(ns)
      setStore(s => {
        if (!s) return s
        const namespaces = { ...s.namespaces }
        delete namespaces[ns]
        return { ...s, namespaces }
      })
    } catch (e) {
      alert(`Failed to remove namespace: ${e}`)
    }
  }

  const addNamespace = async () => {
    const name = newNsName.trim()
    if (!name) return
    setAddingNs(true)
    try {
      const cfg = defaultConfig()
      await api.updateNamespaceNotifications(name, cfg)
      setStore(s => s ? { ...s, namespaces: { ...s.namespaces, [name]: cfg } } : s)
      setNewNsName('')
    } catch (e) {
      alert(`Failed to add namespace: ${e}`)
    } finally {
      setAddingNs(false)
    }
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 780, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Bell size={18} />
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Notifications</h1>
      </div>
      <p style={{ color: 'var(--color-muted-foreground)', marginBottom: 28, fontSize: 13 }}>
        Configure webhook, Slack, and Teams alerts for process and cron lifecycle events.
        Settings cascade: <strong>process override → namespace → global</strong>.
      </p>

      {/* Global config */}
      <p style={sectionTitleStyle}>Global Default</p>
      <NotifCard
        title="Global"
        config={store.global}
        onChange={updateGlobalConfig}
        onSave={saveGlobal}
        onTest={testGlobal}
        saving={globalSaving}
        testing={globalTesting}
        saved={globalSaved}
        error={globalError}
      />

      {/* Namespace overrides */}
      <p style={{ ...sectionTitleStyle, marginTop: 28 }}>Namespace Overrides</p>

      {Object.entries(store.namespaces).map(([ns, cfg]) => (
        <NotifCard
          key={ns}
          title={`Namespace: ${ns}`}
          config={cfg}
          onChange={c => updateNsConfig(ns, c)}
          onSave={() => saveNs(ns)}
          onTest={() => testNs(ns)}
          onDelete={() => deleteNs(ns)}
          saving={nsSaving[ns] ?? false}
          testing={nsTesting[ns] ?? false}
          saved={nsSaved[ns] ?? false}
          error={nsError[ns] ?? null}
        />
      ))}

      {/* Add namespace */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input
          style={{ ...inputStyle, width: 220 }}
          placeholder="Namespace name (e.g. production)"
          value={newNsName}
          onChange={e => setNewNsName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addNamespace()}
        />
        <button
          style={{ ...btnSecondary, opacity: addingNs || !newNsName.trim() ? 0.5 : 1 }}
          onClick={addNamespace}
          disabled={addingNs || !newNsName.trim()}
        >
          <Plus size={13} />
          Add Namespace
        </button>
      </div>
    </div>
  )
}
