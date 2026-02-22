// @group BusinessLogic : Settings page — all user-configurable preferences

import type { AppSettings } from '@/lib/settings'
import { DEFAULT_SETTINGS, LOG_TAIL_OPTIONS, REFRESH_INTERVAL_OPTIONS } from '@/lib/settings'
import { inputStyle } from './StartPage'

interface Props {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
  onReset: () => void
}

// @group Utilities > Styles : Shared style tokens
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--color-muted-foreground)', textTransform: 'uppercase',
  marginBottom: 12, marginTop: 0,
}

const card: React.CSSProperties = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '18px 20px',
  marginBottom: 16,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid var(--color-border)',
}

const lastRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderBottom: 'none',
  paddingBottom: 0,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'var(--color-foreground)',
}

const descStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2,
}

// @group BusinessLogic > Toggle : iOS-style toggle switch
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22,
        borderRadius: 11,
        border: 'none',
        cursor: 'pointer',
        background: checked ? 'var(--color-primary)' : 'var(--color-border)',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3, left: checked ? 20 : 3,
        width: 16, height: 16,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }} />
    </button>
  )
}

// @group BusinessLogic > SettingRow : A single setting row with label, description, and control
function SettingRow({
  label, description, control, isLast = false,
}: {
  label: string
  description?: string
  control: React.ReactNode
  isLast?: boolean
}) {
  return (
    <div style={isLast ? lastRowStyle : rowStyle}>
      <div style={{ flex: 1, paddingRight: 24 }}>
        <div style={labelStyle}>{label}</div>
        {description && <div style={descStyle}>{description}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  )
}

// @group BusinessLogic > SettingsPage : Main settings page component
export default function SettingsPage({ settings, onUpdate, onReset }: Props) {
  const isDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    width: 'auto',
    minWidth: 130,
    fontSize: 12,
    padding: '5px 10px',
    cursor: 'pointer',
  }

  return (
    <div style={{ padding: '20px 28px', maxWidth: 680, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Settings</h2>
          <p style={{ fontSize: 13, color: 'var(--color-muted-foreground)', marginTop: 4 }}>
            Preferences saved locally in your browser.
          </p>
        </div>
        {!isDefault && (
          <button
            type="button"
            onClick={onReset}
            style={{
              padding: '6px 14px', fontSize: 12,
              background: 'transparent',
              border: '1px solid var(--color-destructive)',
              borderRadius: 5, cursor: 'pointer',
              color: 'var(--color-destructive)',
            }}
          >
            Reset to defaults
          </button>
        )}
      </div>

      {/* ── Section: Polling ── */}
      <p style={sectionTitle}>Polling &amp; Refresh</p>
      <div style={card}>
        <SettingRow
          label="Auto-refresh"
          description="Automatically poll the daemon for process updates."
          control={
            <Toggle
              checked={settings.autoRefresh}
              onChange={v => onUpdate({ autoRefresh: v })}
            />
          }
        />
        <SettingRow
          label="Process refresh interval"
          description="How often the process list is refreshed."
          control={
            <select
              value={settings.processRefreshInterval}
              onChange={e => onUpdate({ processRefreshInterval: Number(e.target.value) })}
              disabled={!settings.autoRefresh}
              style={{ ...selectStyle, opacity: settings.autoRefresh ? 1 : 0.4 }}
            >
              {REFRESH_INTERVAL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          }
        />
        <SettingRow
          label="Health check interval"
          description="How often the daemon status in the sidebar is polled."
          isLast
          control={
            <select
              value={settings.healthRefreshInterval}
              onChange={e => onUpdate({ healthRefreshInterval: Number(e.target.value) })}
              style={selectStyle}
            >
              {REFRESH_INTERVAL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          }
        />
      </div>

      {/* ── Section: Behaviour ── */}
      <p style={sectionTitle}>Behaviour</p>
      <div style={card}>
        <SettingRow
          label="Confirm before delete"
          description="Show a confirmation dialog when deleting a process."
          control={
            <Toggle
              checked={settings.confirmBeforeDelete}
              onChange={v => onUpdate({ confirmBeforeDelete: v })}
            />
          }
        />
        <SettingRow
          label="Confirm before shutdown"
          description="Show a confirmation dialog when shutting down the daemon."
          isLast
          control={
            <Toggle
              checked={settings.confirmBeforeShutdown}
              onChange={v => onUpdate({ confirmBeforeShutdown: v })}
            />
          }
        />
      </div>

      {/* ── Section: Logs ── */}
      <p style={sectionTitle}>Log Viewer</p>
      <div style={card}>
        <SettingRow
          label="Default tail lines"
          description="Number of log lines to fetch when opening a process log view."
          isLast
          control={
            <select
              value={settings.logTailLines}
              onChange={e => onUpdate({ logTailLines: Number(e.target.value) })}
              style={selectStyle}
            >
              {LOG_TAIL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          }
        />
      </div>

      {/* ── Section: Defaults ── */}
      <p style={sectionTitle}>Process Defaults</p>
      <div style={card}>
        <SettingRow
          label="Default namespace"
          description="Pre-filled namespace when creating new processes or cron jobs."
          isLast
          control={
            <input
              style={{ ...inputStyle, width: 140, fontSize: 12, padding: '5px 10px' }}
              value={settings.defaultNamespace}
              onChange={e => onUpdate({ defaultNamespace: e.target.value })}
              placeholder="default"
              spellCheck={false}
            />
          }
        />
      </div>

      {/* ── Section: Connection ── */}
      <p style={sectionTitle}>Connection</p>
      <div style={card}>
        <SettingRow
          label="Daemon URL"
          description="Base URL of the alter daemon. Change if running remotely."
          isLast
          control={
            <input
              style={{ ...inputStyle, width: 200, fontSize: 12, padding: '5px 10px', fontFamily: 'monospace' }}
              value={settings.daemonUrl}
              onChange={e => onUpdate({ daemonUrl: e.target.value })}
              placeholder="http://127.0.0.1:2999"
              spellCheck={false}
            />
          }
        />
      </div>

      {/* Footer note */}
      <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', textAlign: 'center', marginTop: 8 }}>
        Settings are stored in your browser's localStorage and apply to this machine only.
        {' '}Changes take effect immediately.
      </p>
    </div>
  )
}
