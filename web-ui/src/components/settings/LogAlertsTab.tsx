// @group BusinessLogic > LogAlertsTab : Log alert settings — global thresholds and namespace overrides

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { NamespaceInput } from '@/components/NamespaceInput'
import { card, inputStyle, sectionTitle, SettingRow, Toggle } from './shared'

export default function LogAlertsTab() {
  const [laEnabled, setLaEnabled] = useState(false)
  const [laThreshold, setLaThreshold] = useState(10)
  const [laCooldown, setLaCooldown] = useState(15)
  const [laCheckInterval, setLaCheckInterval] = useState(5)
  const [laNsOverrides, setLaNsOverrides] = useState<Record<string, { enabled?: boolean; stderr_threshold?: number; cooldown_mins?: number; check_interval_mins?: number }>>({})
  const [laNsNew, setLaNsNew] = useState('')
  const [laSaving, setLaSaving] = useState(false)
  const [laSaved, setLaSaved] = useState(false)
  const [laError, setLaError] = useState<string | null>(null)

  useEffect(() => {
    api.getLogAlerts().then(store => {
      setLaEnabled(store.global.enabled)
      setLaThreshold(store.global.stderr_threshold)
      setLaCooldown(store.global.cooldown_mins)
      setLaCheckInterval(store.global.check_interval_mins ?? 5)
      setLaNsOverrides(store.namespaces ?? {})
    }).catch(() => {})
  }, [])

  return (
    <>
      <p style={sectionTitle}>Global Settings</p>
      <div style={card}>
        <SettingRow
          label="Enable log alerts"
          description="Fire a notification when stderr lines in a check interval exceed the threshold"
          control={<Toggle checked={laEnabled} onChange={setLaEnabled} />}
        />
        <SettingRow
          label="Check interval"
          description="How often the daemon scans for log spikes"
          control={
            <select value={laCheckInterval} onChange={e => setLaCheckInterval(Number(e.target.value))} style={{ ...inputStyle, width: 140 }}>
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          }
        />
        <SettingRow
          label="Stderr threshold"
          description="Alert when this many stderr lines appear within one check interval"
          control={
            <input
              type="number" min={1} max={10000} value={laThreshold}
              onChange={e => setLaThreshold(Math.max(1, Number(e.target.value)))}
              style={{ ...inputStyle, width: 80, textAlign: 'right' }}
            />
          }
        />
        <SettingRow
          label="Cooldown"
          description="Minimum time between repeated alerts for the same process"
          isLast
          control={
            <select value={laCooldown} onChange={e => setLaCooldown(Number(e.target.value))} style={{ ...inputStyle, width: 140 }}>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          }
        />
      </div>

      <p style={sectionTitle}>Namespace Overrides</p>
      <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginTop: -8, marginBottom: 12 }}>
        Override global settings for specific namespaces. Leave a field blank to inherit the global value.
      </p>

      {Object.keys(laNsOverrides).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {Object.entries(laNsOverrides).map(([ns, ov]) => (
            <div key={ns} style={{ ...card, padding: '12px 16px', marginBottom: 0, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120, color: 'var(--color-foreground)' }}>📁 {ns}</span>
              <label style={{ fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Enabled
                <select
                  value={ov.enabled === true ? 'yes' : ov.enabled === false ? 'no' : 'inherit'}
                  onChange={e => {
                    const v = e.target.value
                    setLaNsOverrides(prev => ({ ...prev, [ns]: { ...prev[ns], enabled: v === 'inherit' ? undefined : v === 'yes' } }))
                  }}
                  style={{ ...inputStyle, width: 100, padding: '3px 6px' }}
                >
                  <option value="inherit">Inherit</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Threshold
                <input
                  type="number" min={1} max={10000}
                  placeholder="Inherit"
                  value={ov.stderr_threshold ?? ''}
                  onChange={e => {
                    const v = e.target.value === '' ? undefined : Math.max(1, Number(e.target.value))
                    setLaNsOverrides(prev => ({ ...prev, [ns]: { ...prev[ns], stderr_threshold: v } }))
                  }}
                  style={{ ...inputStyle, width: 80, textAlign: 'right', padding: '3px 6px' }}
                />
              </label>
              <label style={{ fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Cooldown
                <select
                  value={ov.cooldown_mins ?? ''}
                  onChange={e => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value)
                    setLaNsOverrides(prev => ({ ...prev, [ns]: { ...prev[ns], cooldown_mins: v } }))
                  }}
                  style={{ ...inputStyle, width: 120, padding: '3px 6px' }}
                >
                  <option value="">Inherit</option>
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Check interval
                <select
                  value={ov.check_interval_mins ?? ''}
                  onChange={e => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value)
                    setLaNsOverrides(prev => ({ ...prev, [ns]: { ...prev[ns], check_interval_mins: v } }))
                  }}
                  style={{ ...inputStyle, width: 120, padding: '3px 6px' }}
                >
                  <option value="">Inherit</option>
                  <option value={1}>1 minute</option>
                  <option value={2}>2 minutes</option>
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes</option>
                </select>
              </label>
              <button
                onClick={() => setLaNsOverrides(prev => { const next = { ...prev }; delete next[ns]; return next })}
                style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', color: 'var(--color-status-crashed)' }}
              >Remove</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <NamespaceInput
          placeholder="Namespace name"
          value={laNsNew}
          onChange={setLaNsNew}
          style={{ ...inputStyle, width: 180 }}
        />
        <button
          disabled={!laNsNew.trim() || laNsNew.trim() in laNsOverrides}
          onClick={() => {
            const ns = laNsNew.trim()
            if (!ns || ns in laNsOverrides) return
            setLaNsOverrides(prev => ({ ...prev, [ns]: {} }))
            setLaNsNew('')
          }}
          style={{ padding: '6px 14px', fontSize: 13, background: 'var(--color-secondary)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', color: 'var(--color-foreground)' }}
        >+ Add namespace</button>
      </div>

      <div style={{ ...card, background: 'rgba(var(--color-primary-rgb,99,102,241),0.05)', borderColor: 'rgba(var(--color-primary-rgb,99,102,241),0.2)', marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', margin: 0, lineHeight: 1.7 }}>
          Alerts are sent through your configured <strong>Webhook / Slack / Teams</strong> and <strong>Telegram</strong> channels.
          Process-level overrides can be set via the API (<code>log_alert</code> field on a process).
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={async () => {
            setLaSaving(true); setLaSaved(false); setLaError(null)
            try {
              await api.updateLogAlerts({
                global: { enabled: laEnabled, stderr_threshold: laThreshold, cooldown_mins: laCooldown, check_interval_mins: laCheckInterval },
                namespaces: laNsOverrides,
              })
              setLaSaved(true)
              setTimeout(() => setLaSaved(false), 2500)
            } catch (e: unknown) {
              setLaError(e instanceof Error ? e.message : 'Save failed')
            } finally {
              setLaSaving(false)
            }
          }}
          disabled={laSaving}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 500,
            background: laSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            opacity: laSaving ? 0.6 : 1, transition: 'background 0.2s',
          }}
        >
          {laSaved ? 'Saved!' : laSaving ? 'Saving…' : 'Save'}
        </button>
        {laError && <span style={{ fontSize: 12, color: 'var(--color-status-crashed)' }}>{laError}</span>}
      </div>
    </>
  )
}
