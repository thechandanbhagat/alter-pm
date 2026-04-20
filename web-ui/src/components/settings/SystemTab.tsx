// @group BusinessLogic : Settings > System tab — OS startup, log rotation info
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Power, RotateCcw, HardDrive } from 'lucide-react'

// @group Types : Startup status from daemon
interface StartupStatus { enabled: boolean; method: string }

// @group BusinessLogic > SystemTab : OS startup + log rotation settings
export default function SystemTab() {
  const [startup, setStartup] = useState<StartupStatus | null>(null)
  const [startupLoading, setStartupLoading] = useState(true)
  const [startupBusy, setStartupBusy] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    api.getStartupStatus()
      .then(s => setStartup(s))
      .catch(() => setStartup(null))
      .finally(() => setStartupLoading(false))
  }, [])

  async function toggleStartup() {
    if (!startup) return
    setStartupBusy(true)
    setStartupError(null)
    try {
      if (startup.enabled) {
        await api.disableStartup()
      } else {
        await api.enableStartup()
      }
      setStartup(s => s ? { ...s, enabled: !s.enabled } : s)
    } catch (e: unknown) {
      setStartupError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setStartupBusy(false)
    }
  }

  const sectionStyle: React.CSSProperties = {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: '16px 18px',
    marginBottom: 16,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)',
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
  }

  const mutedStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--color-muted-foreground)', lineHeight: 1.5,
  }

  return (
    <div style={{ maxWidth: 560 }}>

      {/* OS Autostart */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={labelStyle}>
              <Power size={14} />
              Start on login
            </div>
            <p style={mutedStyle}>
              Automatically start the alter daemon when you log in.
              {startup && <> Uses <code style={{ fontSize: 10 }}>{startup.method}</code>.</>}
            </p>
            {startupError && (
              <p style={{ ...mutedStyle, color: 'var(--color-destructive)', marginTop: 4 }}>{startupError}</p>
            )}
          </div>

          {startupLoading ? (
            <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>…</div>
          ) : startup === null ? (
            <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>Unavailable</div>
          ) : (
            <button
              onClick={toggleStartup}
              disabled={startupBusy}
              style={{
                padding: '6px 16px', fontSize: 12, fontWeight: 600,
                borderRadius: 6, cursor: startupBusy ? 'wait' : 'pointer',
                border: '1px solid var(--color-border)',
                background: startup.enabled
                  ? 'color-mix(in srgb, var(--color-destructive) 12%, transparent)'
                  : 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                color: startup.enabled ? 'var(--color-destructive)' : 'var(--color-primary)',
                transition: 'background 0.15s',
                flexShrink: 0,
              }}
            >
              {startupBusy ? '…' : startup.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
        </div>
      </div>

      {/* Log Rotation */}
      <div style={sectionStyle}>
        <div style={labelStyle}>
          <RotateCcw size={14} />
          Log rotation
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {[
            ['Size limit', '10 MB per log file'],
            ['Retained files', '5 rotated copies per process'],
            ['Daily rotation', 'Logs rotated at midnight'],
            ['Retention period', '30 days of dated archives'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--color-muted-foreground)' }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>
        <p style={{ ...mutedStyle, marginTop: 10 }}>
          Log files are stored in <code style={{ fontSize: 10 }}>%APPDATA%\alter-pm2\logs\</code>.
          Rotation runs automatically in the background — no configuration needed.
        </p>
      </div>

      {/* Data directory */}
      <div style={sectionStyle}>
        <div style={labelStyle}>
          <HardDrive size={14} />
          Data directory
        </div>
        <p style={mutedStyle}>
          All alter data (processes, logs, settings, history) is stored in the daemon data directory.
          On Windows: <code style={{ fontSize: 10 }}>%APPDATA%\alter-pm2\</code>
          {' '}· Linux/macOS: <code style={{ fontSize: 10 }}>~/.alter-pm2/</code>
        </p>
      </div>

    </div>
  )
}
