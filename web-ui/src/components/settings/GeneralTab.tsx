// @group BusinessLogic > GeneralTab : General settings — polling, behaviour, storage, daemon, updates

import { useEffect, useState } from 'react'
import { ArrowDownToLine, Check, ChevronDown, ChevronUp, Loader, RefreshCw, RotateCcw } from 'lucide-react'
import type { UpdateInfo } from '@/types'
import type { AppSettings } from '@/lib/settings'
import { LOG_TAIL_OPTIONS, REFRESH_INTERVAL_OPTIONS } from '@/lib/settings'
import { api } from '@/lib/api'
import { NamespaceInput } from '@/components/NamespaceInput'
import { card, CopyPath, descStyle, inputStyle, labelStyle, rowStyle, sectionTitle, selectStyle, SettingRow, Toggle } from './shared'

interface Props {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
}

export default function GeneralTab({ settings, onUpdate }: Props) {
  const [sysPaths, setSysPaths] = useState<{ data_dir: string; log_dir: string } | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [restartStatus, setRestartStatus] = useState<'idle' | 'restarting' | 'done' | 'error'>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'updating' | 'done' | 'error'>('idle')
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)

  useEffect(() => {
    api.getSystemPaths().then(setSysPaths).catch(() => {})
  }, [])

  // @group BusinessLogic > Daemon : Restart daemon and poll until it comes back
  async function handleRestartDaemon() {
    setRestarting(true)
    setRestartStatus('restarting')
    try {
      await api.restartDaemon().catch(() => {})
      let ok = false
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 600))
        try { await api.getHealth(); ok = true; break } catch { /* not up yet */ }
      }
      setRestartStatus(ok ? 'done' : 'error')
    } catch {
      setRestartStatus('error')
    } finally {
      setRestarting(false)
      setTimeout(() => setRestartStatus('idle'), 3000)
    }
  }

  // @group BusinessLogic > Update : Check for a newer version on GitHub
  async function handleCheckUpdate() {
    setUpdateChecking(true)
    setUpdateError(null)
    try {
      const info = await api.checkUpdate()
      setUpdateInfo(info)
      if (info.error) setUpdateError(info.error)
    } catch (e: unknown) {
      setUpdateError(e instanceof Error ? e.message : 'Check failed')
    } finally {
      setUpdateChecking(false)
    }
  }

  // @group BusinessLogic > Update : Download and apply the update, then reconnect
  async function handleApplyUpdate() {
    if (!updateInfo?.download_url) return
    setUpdateStatus('updating')
    setUpdateError(null)
    try {
      await api.applyUpdate(updateInfo.download_url).catch(() => {})
      let ok = false
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 750))
        try { await api.getHealth(); ok = true; break } catch { /* not up yet */ }
      }
      setUpdateStatus(ok ? 'done' : 'error')
      if (ok) setTimeout(() => window.location.reload(), 1500)
    } catch {
      setUpdateStatus('error')
    }
  }

  return (
    <>
      <p style={sectionTitle}>Polling &amp; Refresh</p>
      <div style={card}>
        <SettingRow
          label="Auto-refresh"
          description="Automatically poll the daemon for process updates."
          control={
            <Toggle checked={settings.autoRefresh} onChange={v => onUpdate({ autoRefresh: v })} />
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

      <p style={sectionTitle}>Behaviour</p>
      <div style={card}>
        <SettingRow
          label="Confirm before delete"
          description="Show a confirmation dialog when deleting a process."
          control={
            <Toggle checked={settings.confirmBeforeDelete} onChange={v => onUpdate({ confirmBeforeDelete: v })} />
          }
        />
        <SettingRow
          label="Confirm before shutdown"
          description="Show a confirmation dialog when shutting down the daemon."
          isLast
          control={
            <Toggle checked={settings.confirmBeforeShutdown} onChange={v => onUpdate({ confirmBeforeShutdown: v })} />
          }
        />
      </div>

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

      <p style={sectionTitle}>Process Defaults</p>
      <div style={card}>
        <SettingRow
          label="Default namespace"
          description="Pre-filled namespace when creating new processes or cron jobs."
          isLast
          control={
            <NamespaceInput
              style={{ ...inputStyle, width: 140, fontSize: 12, padding: '5px 10px' }}
              value={settings.defaultNamespace}
              onChange={v => onUpdate({ defaultNamespace: v })}
              placeholder="default"
            />
          }
        />
      </div>

      <p style={sectionTitle}>Storage</p>
      <div style={card}>
        <SettingRow
          label="Data directory"
          description="Root folder where alter stores state, PID, and daemon logs."
          control={sysPaths ? <CopyPath value={sysPaths.data_dir} /> : <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>loading…</span>}
        />
        <SettingRow
          label="Log directory"
          description={<>Where process stdout/stderr logs are written. Override with <code style={{ fontSize: 10, fontFamily: 'monospace' }}>ALTER_LOG_DIR</code> env var.</>}
          isLast
          control={sysPaths ? <CopyPath value={sysPaths.log_dir} /> : <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>loading…</span>}
        />
      </div>

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

      <p style={sectionTitle}>Daemon</p>
      <div style={card}>
        <SettingRow
          label="Restart daemon"
          description="Restarts the alter daemon. Your running processes keep running — only the HTTP server briefly restarts."
          isLast
          control={
            <button
              onClick={handleRestartDaemon}
              disabled={restarting}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                background: restartStatus === 'done' ? 'var(--color-status-running)'
                  : restartStatus === 'error' ? 'var(--color-destructive)'
                  : 'var(--color-secondary)',
                color: restartStatus === 'idle' ? 'var(--color-foreground)' : '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: 6, cursor: restarting ? 'default' : 'pointer',
                opacity: restarting ? 0.7 : 1, transition: 'background 0.2s',
              }}
            >
              {restarting
                ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Restarting…</>
                : restartStatus === 'done' ? <><Check size={12} /> Back online</>
                : restartStatus === 'error' ? 'Failed to connect'
                : <><RotateCcw size={12} /> Restart daemon</>}
            </button>
          }
        />
      </div>

      <p style={sectionTitle}>Updates</p>
      <div style={card}>
        <div style={{ ...rowStyle, borderBottom: updateInfo && !updateInfo.up_to_date ? '1px solid var(--color-border)' : 'none', paddingBottom: updateInfo && !updateInfo.up_to_date ? 10 : 0 }}>
          <div style={{ flex: 1, paddingRight: 24 }}>
            <div style={labelStyle}>Application version</div>
            <div style={descStyle}>
              Current: <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{updateInfo?.current ?? '…'}</code>
              {updateInfo && !updateInfo.up_to_date && (
                <span style={{ marginLeft: 8, color: '#f97316', fontWeight: 600 }}>
                  → v{updateInfo.latest} available
                </span>
              )}
              {updateInfo?.up_to_date && (
                <span style={{ marginLeft: 8, color: 'var(--color-status-running)' }}>✓ up to date</span>
              )}
            </div>
            {updateError && <div style={{ ...descStyle, color: 'var(--color-destructive)', marginTop: 4 }}>{updateError}</div>}
          </div>
          <button
            onClick={handleCheckUpdate}
            disabled={updateChecking || updateStatus === 'updating'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              background: 'var(--color-secondary)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-border)',
              borderRadius: 6, cursor: updateChecking ? 'default' : 'pointer',
              opacity: updateChecking ? 0.6 : 1, flexShrink: 0,
            }}
          >
            {updateChecking
              ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Checking…</>
              : <><RefreshCw size={12} /> Check for updates</>}
          </button>
        </div>

        {updateInfo && !updateInfo.up_to_date && (
          <div style={{ paddingTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f97316' }}>
                  v{updateInfo.latest} is available
                </div>
                {updateInfo.published_at && (
                  <div style={descStyle}>
                    Released {new Date(updateInfo.published_at).toLocaleDateString()}
                  </div>
                )}
                {!updateInfo.download_url && (
                  <div style={{ ...descStyle, color: 'var(--color-destructive)', marginTop: 2 }}>
                    No asset found for this platform — update manually from GitHub.
                  </div>
                )}
              </div>
              {updateInfo.download_url && (
                <button
                  onClick={handleApplyUpdate}
                  disabled={updateStatus === 'updating' || updateStatus === 'done'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '7px 16px', fontSize: 12, fontWeight: 600,
                    background: updateStatus === 'done' ? 'var(--color-status-running)'
                      : updateStatus === 'error' ? 'var(--color-destructive)'
                      : 'var(--color-primary)',
                    color: '#fff',
                    border: 'none', borderRadius: 6,
                    cursor: updateStatus === 'updating' || updateStatus === 'done' ? 'default' : 'pointer',
                    opacity: updateStatus === 'updating' ? 0.75 : 1,
                    flexShrink: 0,
                  }}
                >
                  {updateStatus === 'updating'
                    ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Downloading…</>
                    : updateStatus === 'done' ? <><Check size={12} /> {updateInfo.is_installer ? 'Installer launched' : 'Reloading…'}</>
                    : updateStatus === 'error' ? 'Failed — retry?'
                    : updateInfo.is_installer
                      ? <><ArrowDownToLine size={12} /> Download &amp; Install</>
                      : <><ArrowDownToLine size={12} /> Update Now</>}
                </button>
              )}
            </div>

            {updateInfo.release_notes && (
              <div>
                <button
                  onClick={() => setReleaseNotesOpen(o => !o)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: 'var(--color-muted-foreground)', padding: 0, marginBottom: 6,
                  }}
                >
                  {releaseNotesOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  Release notes
                </button>
                {releaseNotesOpen && (
                  <pre style={{
                    fontSize: 11, fontFamily: 'monospace',
                    background: 'var(--color-muted)', border: '1px solid var(--color-border)',
                    borderRadius: 4, padding: '8px 10px', margin: 0,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 200, overflow: 'auto',
                    color: 'var(--color-foreground)',
                  }}>
                    {updateInfo.release_notes}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {import.meta.env.DEV && (
        <>
          <p style={sectionTitle}>Developer</p>
          <div style={card}>
            <SettingRow
              label="React Query Devtools"
              description="Show the query inspector panel to debug API cache state."
              isLast
              control={
                <Toggle
                  checked={settings.showQueryDevtools}
                  onChange={v => onUpdate({ showQueryDevtools: v })}
                />
              }
            />
          </div>
        </>
      )}

      <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', textAlign: 'center', marginTop: 8 }}>
        Settings are stored in your browser's localStorage and apply to this machine only.
        {' '}Changes take effect immediately.
      </p>
    </>
  )
}
