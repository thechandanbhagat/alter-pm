// @group BusinessLogic : Settings page — all user-configurable preferences

import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Github, Loader, Lock, LogOut, RefreshCw, RotateCcw, Shield } from 'lucide-react'
import type { UpdateInfo } from '@/types'
import type { AiModelInfo } from '@/lib/api'
import type { AppSettings } from '@/lib/settings'
import { DEFAULT_SETTINGS, LOG_TAIL_OPTIONS, REFRESH_INTERVAL_OPTIONS } from '@/lib/settings'
import { api } from '@/lib/api'
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
  description?: React.ReactNode
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

// @group Utilities > CopyPath : Path display field with one-click copy
function CopyPath({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <code style={{
        fontSize: 11, fontFamily: 'monospace',
        background: 'var(--color-muted)', border: '1px solid var(--color-border)',
        borderRadius: 4, padding: '3px 8px',
        color: 'var(--color-foreground)', maxWidth: 340,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        display: 'block',
      }} title={value}>{value}</code>
      <button onClick={copy} title="Copy path" style={{
        padding: 4, background: 'transparent', border: 'none',
        cursor: 'pointer', color: copied ? 'var(--color-status-running)' : 'var(--color-muted-foreground)',
        display: 'flex', alignItems: 'center',
      }}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

// @group BusinessLogic > SettingsPage : Main settings page component
export default function SettingsPage({ settings, onUpdate, onReset }: Props) {
  const isDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)
  const [sysPaths, setSysPaths] = useState<{ data_dir: string; log_dir: string } | null>(null)
  const [activeTab, setActiveTab] = useState<'general' | 'security' | 'ai' | 'telegram' | 'log-alerts'>('general')

  // @group BusinessLogic > AI : Core settings state
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiModel, setAiModel] = useState('gpt-4o-mini')
  const [aiClientId, setAiClientId] = useState('')
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)

  // @group BusinessLogic > AI : OAuth flow state machine
  const [authPhase, setAuthPhase] = useState<'idle' | 'in_progress' | 'connected'>('idle')
  const [authUsername, setAuthUsername] = useState('')
  const [deviceUserCode, setDeviceUserCode] = useState('')
  const [deviceUri, setDeviceUri] = useState('')
  const [pollInterval, setPollInterval] = useState(5)
  const [codeCopied, setCodeCopied] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // @group BusinessLogic > AI : Dynamic model list from GitHub catalog
  const [modelOptions, setModelOptions] = useState<AiModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  // @group BusinessLogic > Security : Change password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [pwChangeError, setPwChangeError] = useState<string | null>(null)
  const [pwChangeSaved, setPwChangeSaved] = useState(false)
  const [pwChangeSaving, setPwChangeSaving] = useState(false)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  // @group BusinessLogic > Security : PIN state
  const [pinConfigured, setPinConfigured] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSaved, setPinSaved] = useState(false)
  const [pinSaving, setPinSaving] = useState(false)

  // @group BusinessLogic > Security : Lock timeout state
  const [lockTimeoutMins, setLockTimeoutMins] = useState<string>('0')
  const [lockSaving, setLockSaving] = useState(false)
  const [lockSaved, setLockSaved] = useState(false)

  // @group BusinessLogic > Daemon : Restart state
  const [restarting, setRestarting] = useState(false)
  const [restartStatus, setRestartStatus] = useState<'idle' | 'restarting' | 'done' | 'error'>('idle')

  // @group BusinessLogic > Update : Self-update state
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'updating' | 'done' | 'error'>('idle')
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)

  // @group BusinessLogic > LogAlerts : Log spike alert settings state
  const [laEnabled, setLaEnabled] = useState(false)
  const [laThreshold, setLaThreshold] = useState(10)
  const [laCooldown, setLaCooldown] = useState(15)
  const [laCheckInterval, setLaCheckInterval] = useState(5)
  const [laNsOverrides, setLaNsOverrides] = useState<Record<string, { enabled?: boolean; stderr_threshold?: number; cooldown_mins?: number }>>({})
  const [laNsNew, setLaNsNew] = useState('')
  const [laSaving, setLaSaving] = useState(false)
  const [laSaved, setLaSaved] = useState(false)
  const [laError, setLaError] = useState<string | null>(null)

  // @group BusinessLogic > Telegram : Bot config state
  const [tgEnabled, setTgEnabled] = useState(false)
  const [tgToken, setTgToken] = useState('')
  const [tgTokenHint, setTgTokenHint] = useState<string | null>(null)
  const [tgTokenSet, setTgTokenSet] = useState(false)
  const [tgChatIds, setTgChatIds] = useState<string>('')
  const [tgNotifyCrash, setTgNotifyCrash] = useState(true)
  const [tgNotifyStart, setTgNotifyStart] = useState(false)
  const [tgNotifyStop, setTgNotifyStop] = useState(false)
  const [tgNotifyRestart, setTgNotifyRestart] = useState(true)
  const [tgSaving, setTgSaving] = useState(false)
  const [tgSaved, setTgSaved] = useState(false)
  const [tgError, setTgError] = useState<string | null>(null)
  const [tgBotInfo, setTgBotInfo] = useState<{ ok: boolean; username: string | null; first_name: string | null; error: string | null } | null>(null)
  const [tgValidating, setTgValidating] = useState(false)
  const [tgTesting, setTgTesting] = useState(false)
  const [tgTestResult, setTgTestResult] = useState<string | null>(null)
  const [tgChangingToken, setTgChangingToken] = useState(false)

  // @group BusinessLogic > LogAlerts : Load initial log alert settings
  useEffect(() => {
    api.getLogAlerts().then(store => {
      setLaEnabled(store.global.enabled)
      setLaThreshold(store.global.stderr_threshold)
      setLaCooldown(store.global.cooldown_mins)
      setLaCheckInterval(store.global.check_interval_mins ?? 5)
      setLaNsOverrides(store.namespaces ?? {})
    }).catch(() => {})
  }, [])

  // @group BusinessLogic > AI : Load initial settings + models on mount
  useEffect(() => {
    api.getSystemPaths().then(setSysPaths).catch(() => {})
  }, [])

  useEffect(() => {
    api.aiGetSettings().then(s => {
      setAiEnabled(s.enabled)
      setAiModel(s.model)
      setAiClientId('') // don't pre-fill client_id; show asterisks if set
      if (s.github_username) {
        setAuthUsername(s.github_username)
        setAuthPhase('connected')
      } else {
        setAuthPhase('idle')
      }
      // Load models if token is available
      if (s.github_token_set) loadModels()
    }).catch(() => {})
  }, [])

  // @group BusinessLogic > AI : Poll GitHub token exchange during Device Flow
  useEffect(() => {
    if (authPhase !== 'in_progress') {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
      return
    }
    pollTimerRef.current = setInterval(async () => {
      try {
        const status = await api.aiAuthStatus()
        if (status.status === 'complete' && status.username) {
          setAuthPhase('connected')
          setAuthUsername(status.username)
          setAuthError(null)
          loadModels()
        } else if (status.status === 'expired') {
          setAuthPhase('idle')
          setAuthError('Code expired — please try again.')
        } else if (status.status === 'denied') {
          setAuthPhase('idle')
          setAuthError('Authorization denied by GitHub.')
        } else if (status.status === 'error') {
          setAuthPhase('idle')
          setAuthError(status.message ?? 'Unknown error from GitHub.')
        } else if (status.interval) {
          // GitHub asked to slow down — update timer
          setPollInterval(status.interval)
        }
      } catch { /* network hiccup — keep polling */ }
    }, pollInterval * 1000)

    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [authPhase, pollInterval])

  // @group BusinessLogic > Security : Load security config on mount
  useEffect(() => {
    api.authStatus().then(s => {
      setPinConfigured(s.pin_configured ?? false)
      setLockTimeoutMins(String(s.lock_timeout_mins ?? 0))
    }).catch(() => {})
  }, [])

  // @group BusinessLogic > Telegram : Load Telegram config on mount
  useEffect(() => {
    api.getTelegramConfig().then(cfg => {
      setTgEnabled(cfg.enabled)
      setTgTokenHint(cfg.bot_token_hint)
      setTgTokenSet(cfg.bot_token_set)
      setTgChatIds(cfg.allowed_chat_ids.join('\n'))
      setTgNotifyCrash(cfg.notify_on_crash)
      setTgNotifyStart(cfg.notify_on_start)
      setTgNotifyStop(cfg.notify_on_stop)
      setTgNotifyRestart(cfg.notify_on_restart)
    }).catch(() => {})
  }, [])

  async function loadModels() {
    setModelsLoading(true)
    try {
      const data = await api.aiGetModels()
      if (data.models.length > 0) setModelOptions(data.models)
    } catch { /* use fallback hardcoded list */ } finally {
      setModelsLoading(false)
    }
  }

  // @group BusinessLogic > Security : Change password handler
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwChangeError(null)
    if (newPassword !== confirmNewPassword) { setPwChangeError('New passwords do not match'); return }
    if (newPassword.length < 8) { setPwChangeError('Password must be at least 8 characters'); return }
    setPwChangeSaving(true)
    try {
      await api.authChangePassword(currentPassword, newPassword)
      setPwChangeSaved(true)
      setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('')
      setTimeout(() => setPwChangeSaved(false), 2000)
    } catch (err: unknown) {
      setPwChangeError((err as Error)?.message ?? 'Failed to change password')
    } finally {
      setPwChangeSaving(false)
    }
  }

  // @group BusinessLogic > Security : Set PIN handler
  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault()
    setPinError(null)
    if (pinInput.length !== 4 && pinInput.length !== 6) {
      setPinError('PIN must be exactly 4 or 6 digits'); return
    }
    if (!/^\d+$/.test(pinInput)) { setPinError('PIN must contain only digits'); return }
    setPinSaving(true)
    try {
      await api.authSetPin(pinInput)
      setPinConfigured(true)
      setPinSaved(true)
      setPinInput('')
      setTimeout(() => setPinSaved(false), 2000)
    } catch (err: unknown) {
      setPinError((err as Error)?.message ?? 'Failed to set PIN')
    } finally {
      setPinSaving(false)
    }
  }

  // @group BusinessLogic > Security : Remove PIN handler
  async function handleRemovePin() {
    setPinError(null)
    setPinSaving(true)
    try {
      await api.authRemovePin()
      setPinConfigured(false)
      setPinInput('')
    } catch (err: unknown) {
      setPinError((err as Error)?.message ?? 'Failed to remove PIN')
    } finally {
      setPinSaving(false)
    }
  }

  // @group BusinessLogic > Security : Save lock timeout handler
  async function handleSaveLockTimeout() {
    setLockSaving(true)
    try {
      const mins = lockTimeoutMins === '0' ? null : Number(lockTimeoutMins)
      await api.authUpdateLockSettings(mins)
      setLockSaved(true)
      setTimeout(() => setLockSaved(false), 2000)
      // Notify AuthGuard to re-fetch lock config
      window.dispatchEvent(new CustomEvent('lock-config-updated'))
    } catch { /* ignore */ } finally {
      setLockSaving(false)
    }
  }

  // @group BusinessLogic > Daemon : Restart daemon and poll until it comes back
  async function handleRestartDaemon() {
    setRestarting(true)
    setRestartStatus('restarting')
    try {
      await api.restartDaemon().catch(() => {}) // fire and forget — daemon will exit
      // Poll every 600ms until daemon responds (up to ~15 s)
      let ok = false
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 600))
        try {
          await api.getHealth()
          ok = true
          break
        } catch { /* not up yet */ }
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
      await api.applyUpdate(updateInfo.download_url).catch(() => {}) // daemon exits — response may not arrive
      // Poll until new daemon is up (same pattern as restart)
      let ok = false
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 750))
        try {
          await api.getHealth()
          ok = true
          break
        } catch { /* not up yet */ }
      }
      setUpdateStatus(ok ? 'done' : 'error')
      if (ok) {
        // Reload so the new version's web UI is served
        setTimeout(() => window.location.reload(), 1500)
      }
    } catch {
      setUpdateStatus('error')
    }
  }

  async function saveAiSettings() {
    setAiSaving(true)
    try {
      await api.aiSaveSettings({
        enabled: aiEnabled,
        model: aiModel,
        client_id: aiClientId || undefined,
      })
      setAiSaved(true)
      setTimeout(() => setAiSaved(false), 2000)
      // Reload settings to reflect any server-side normalisation
      const s = await api.aiGetSettings()
      if (s.github_token_set && modelOptions.length === 0) loadModels()
    } catch { /* ignore */ } finally {
      setAiSaving(false)
    }
  }

  async function startDeviceFlow() {
    setAuthError(null)
    try {
      const data = await api.aiAuthStart()
      setDeviceUserCode(data.user_code)
      setDeviceUri(data.verification_uri)
      setPollInterval(data.interval)
      setAuthPhase('in_progress')
    } catch (e: unknown) {
      setAuthError((e as Error)?.message ?? 'Failed to start GitHub login.')
    }
  }

  function cancelDeviceFlow() {
    setAuthPhase('idle')
    setDeviceUserCode('')
    setDeviceUri('')
    setAuthError(null)
  }

  async function disconnect() {
    try {
      await api.aiAuthLogout()
      setAuthPhase('idle')
      setAuthUsername('')
      setModelOptions([])
      setAuthError(null)
    } catch { /* ignore */ }
  }

  function copyDeviceCode() {
    navigator.clipboard.writeText(deviceUserCode).then(() => {
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    }).catch(() => {})
  }

  // @group BusinessLogic > Telegram : Parse chat IDs from textarea (one per line)
  function parseChatIds(): number[] {
    return tgChatIds
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(n => !isNaN(n) && n !== 0)
  }

  // @group BusinessLogic > Telegram : Save config handler
  async function handleSaveTelegram(e: React.FormEvent) {
    e.preventDefault()
    setTgError(null)
    setTgSaving(true)
    try {
      const payload: Parameters<typeof api.updateTelegramConfig>[0] = {
        enabled: tgEnabled,
        allowed_chat_ids: parseChatIds(),
        notify_on_crash: tgNotifyCrash,
        notify_on_start: tgNotifyStart,
        notify_on_stop: tgNotifyStop,
        notify_on_restart: tgNotifyRestart,
      }
      if (tgToken) payload.bot_token = tgToken
      await api.updateTelegramConfig(payload)
      setTgSaved(true)
      setTgToken('')
      if (tgToken) {
        setTgTokenSet(true)
        setTgBotInfo(null)
      }
      setTimeout(() => setTgSaved(false), 2000)
    } catch (err: unknown) {
      setTgError((err as Error)?.message ?? 'Failed to save Telegram config')
    } finally {
      setTgSaving(false)
    }
  }

  // @group BusinessLogic > Telegram : Validate bot token
  async function handleValidateToken() {
    setTgValidating(true)
    setTgBotInfo(null)
    // Save token first if one is entered
    if (tgToken) {
      try { await api.updateTelegramConfig({ bot_token: tgToken }) } catch { /* ignore */ }
    }
    try {
      const info = await api.getTelegramBotInfo()
      setTgBotInfo(info)
      if (info.ok) {
        setTgTokenSet(true)
        setTgToken('')
        setTgChangingToken(false)
      }
    } catch (err: unknown) {
      setTgBotInfo({ ok: false, username: null, first_name: null, error: (err as Error)?.message ?? 'Request failed' })
    } finally {
      setTgValidating(false)
    }
  }

  // @group BusinessLogic > Telegram : Send test message
  async function handleTestTelegram() {
    setTgTesting(true)
    setTgTestResult(null)
    try {
      await api.testTelegram()
      setTgTestResult('✅ Test message sent!')
    } catch (err: unknown) {
      setTgTestResult(`❌ ${(err as Error)?.message ?? 'Failed to send test message'}`)
    } finally {
      setTgTesting(false)
      setTimeout(() => setTgTestResult(null), 4000)
    }
  }

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    width: 'auto',
    minWidth: 130,
    fontSize: 12,
    padding: '5px 10px',
    cursor: 'pointer',
  }

  // @group Utilities > Styles : Tab bar styles
  const tabBarStyle: React.CSSProperties = {
    display: 'flex',
    gap: 2,
    borderBottom: '1px solid var(--color-border)',
    marginBottom: 24,
  }

  function tabStyle(active: boolean): React.CSSProperties {
    return {
      padding: '8px 18px',
      fontSize: 13,
      fontWeight: active ? 600 : 400,
      color: active ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
      background: 'transparent',
      border: 'none',
      borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
      cursor: 'pointer',
      marginBottom: -1,
      transition: 'color 0.15s',
    }
  }

  return (
    <div style={{ padding: '20px 28px' }}>

      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Settings</h2>
        </div>
        {activeTab === 'general' && !isDefault && (
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

      {/* Tab bar */}
      <div style={tabBarStyle}>
        <button style={tabStyle(activeTab === 'general')} onClick={() => setActiveTab('general')}>General</button>
        <button style={tabStyle(activeTab === 'security')} onClick={() => setActiveTab('security')}>Security</button>
        <button style={tabStyle(activeTab === 'ai')} onClick={() => setActiveTab('ai')}>AI</button>
        <button style={tabStyle(activeTab === 'telegram')} onClick={() => setActiveTab('telegram')}>Telegram</button>
        <button style={tabStyle(activeTab === 'log-alerts')} onClick={() => setActiveTab('log-alerts')}>Log Alerts</button>
      </div>

      {/* ── Tab: General ── */}
      {activeTab === 'general' && (
        <>
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

            {/* Update available panel */}
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
                        No binary found for this platform — update manually from GitHub.
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
                        ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Updating…</>
                        : updateStatus === 'done' ? <><Check size={12} /> Reloading…</>
                        : updateStatus === 'error' ? 'Failed — retry?'
                        : <><ArrowDownToLine size={12} /> Update Now</>}
                    </button>
                  )}
                </div>

                {/* Release notes collapsible */}
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

          <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', textAlign: 'center', marginTop: 8 }}>
            Settings are stored in your browser's localStorage and apply to this machine only.
            {' '}Changes take effect immediately.
          </p>
        </>
      )}

      {/* ── Tab: Security ── */}
      {activeTab === 'security' && (
        <>
          <p style={sectionTitle}>Password</p>
          <div style={card}>
            <div style={{ marginBottom: 4 }}>
              <div style={labelStyle}>Change password</div>
              <div style={{ ...descStyle, marginBottom: 16 }}>Update your dashboard login password.</div>
            </div>
            <form onSubmit={handleChangePassword}>
              {/* Field helper */}
              {(() => {
                function PwField({
                  label, value, onChange, autoComplete, show, onToggle,
                }: {
                  label: string
                  value: string
                  onChange: (v: string) => void
                  autoComplete: string
                  show: boolean
                  onToggle: () => void
                }) {
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-muted-foreground)', marginBottom: 5, letterSpacing: '0.04em' }}>
                        {label}
                      </label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input
                          type={show ? 'text' : 'password'}
                          value={value}
                          onChange={e => onChange(e.target.value)}
                          autoComplete={autoComplete}
                          style={{
                            ...inputStyle,
                            width: '100%',
                            fontSize: 13,
                            padding: '8px 36px 8px 12px',
                            boxSizing: 'border-box',
                            borderRadius: 6,
                          }}
                        />
                        <button
                          type="button"
                          onClick={onToggle}
                          tabIndex={-1}
                          style={{
                            position: 'absolute', right: 10,
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-muted-foreground)',
                            display: 'flex', alignItems: 'center', padding: 0,
                          }}
                        >
                          {show ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  )
                }
                return (
                  <>
                    <PwField
                      label="Current password"
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      autoComplete="current-password"
                      show={showCurrentPw}
                      onToggle={() => setShowCurrentPw(p => !p)}
                    />
                    <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0 16px' }} />
                    <PwField
                      label="New password"
                      value={newPassword}
                      onChange={setNewPassword}
                      autoComplete="new-password"
                      show={showNewPw}
                      onToggle={() => setShowNewPw(p => !p)}
                    />
                    <PwField
                      label="Confirm new password"
                      value={confirmNewPassword}
                      onChange={setConfirmNewPassword}
                      autoComplete="new-password"
                      show={showConfirmPw}
                      onToggle={() => setShowConfirmPw(p => !p)}
                    />
                    {/* Strength hint */}
                    {newPassword.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                          {[1, 2, 3, 4].map(level => {
                            const strength = newPassword.length >= 12 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword) ? 4
                              : newPassword.length >= 10 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) ? 3
                              : newPassword.length >= 8 ? 2
                              : 1
                            const colors = ['var(--color-destructive)', 'orange', '#f0b429', 'var(--color-status-running)']
                            return (
                              <div key={level} style={{
                                flex: 1, height: 3, borderRadius: 2,
                                background: level <= strength ? colors[strength - 1] : 'var(--color-border)',
                                transition: 'background 0.2s',
                              }} />
                            )
                          })}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>
                          {newPassword.length < 8 ? 'Too short' : newPassword.length >= 12 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword) ? 'Strong' : newPassword.length >= 10 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) ? 'Good' : 'Fair — add uppercase, numbers, symbols'}
                        </span>
                      </div>
                    )}
                  </>
                )
              })()}

              {pwChangeError && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '8px 12px', borderRadius: 6, marginBottom: 12,
                  background: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent)',
                  fontSize: 12, color: 'var(--color-destructive)',
                }}>
                  {pwChangeError}
                </div>
              )}

              {pwChangeSaved && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '8px 12px', borderRadius: 6, marginBottom: 12,
                  background: 'color-mix(in srgb, var(--color-status-running) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-status-running) 30%, transparent)',
                  fontSize: 12, color: 'var(--color-status-running)',
                }}>
                  <Check size={13} /> Password changed successfully.
                </div>
              )}

              <button
                type="submit"
                disabled={pwChangeSaving || !currentPassword || !newPassword || !confirmNewPassword}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '8px 18px', fontSize: 13, fontWeight: 600,
                  background: pwChangeSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                  color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                  opacity: (pwChangeSaving || !currentPassword || !newPassword || !confirmNewPassword) ? 0.5 : 1,
                  transition: 'background 0.2s, opacity 0.15s',
                }}
              >
                <Shield size={13} />
                {pwChangeSaving ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </div>

          <p style={sectionTitle}>PIN</p>
          <div style={card}>
            <SettingRow
              label="Quick-unlock PIN"
              description={pinConfigured
                ? 'A PIN is set. Enter a new one to replace it, or remove it.'
                : 'Set a 4 or 6 digit PIN for the lock screen. Faster than typing the full password.'}
              isLast
              control={
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  {pinError && (
                    <div style={{ fontSize: 11, color: 'var(--color-destructive)', textAlign: 'right' }}>{pinError}</div>
                  )}
                  <form onSubmit={handleSetPin} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={pinInput}
                      onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={pinConfigured ? 'New PIN (4 or 6 digits)' : 'PIN (4 or 6 digits)'}
                      style={{ ...inputStyle, width: 160, fontSize: 12, padding: '5px 10px', letterSpacing: '0.15em', fontFamily: 'monospace' }}
                    />
                    <button
                      type="submit"
                      disabled={pinSaving || pinInput.length < 4}
                      style={{
                        padding: '5px 12px', fontSize: 12, fontWeight: 500,
                        background: pinSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                        color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
                        opacity: (pinSaving || pinInput.length < 4) ? 0.5 : 1, transition: 'background 0.2s',
                      }}
                    >
                      {pinSaved ? 'Saved!' : pinConfigured ? 'Update' : 'Set PIN'}
                    </button>
                    {pinConfigured && (
                      <button
                        type="button"
                        onClick={handleRemovePin}
                        disabled={pinSaving}
                        style={{
                          padding: '5px 10px', fontSize: 12,
                          background: 'transparent',
                          border: '1px solid var(--color-destructive)',
                          borderRadius: 5, cursor: 'pointer',
                          color: 'var(--color-destructive)',
                          opacity: pinSaving ? 0.5 : 1,
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </form>
                </div>
              }
            />
          </div>

          <p style={sectionTitle}>Session</p>
          <div style={card}>
            <SettingRow
              label="Auto-lock after inactivity"
              description="Automatically lock the dashboard after a period of inactivity. Uses PIN if set, otherwise password."
              isLast
              control={
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    value={lockTimeoutMins}
                    onChange={e => setLockTimeoutMins(e.target.value)}
                    style={{ ...selectStyle, minWidth: 120 }}
                  >
                    <option value="0">Disabled</option>
                    <option value="5">5 minutes</option>
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                  </select>
                  <button
                    onClick={handleSaveLockTimeout}
                    disabled={lockSaving}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 12px', fontSize: 12, fontWeight: 500,
                      background: lockSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                      color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
                      opacity: lockSaving ? 0.6 : 1, transition: 'background 0.2s',
                    }}
                  >
                    <Lock size={11} />
                    {lockSaved ? 'Saved!' : lockSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              }
            />
          </div>
        </>
      )}

      {/* ── Tab: AI ── */}
      {activeTab === 'ai' && (
        <>
          <p style={sectionTitle}>AI Assistant</p>
          <div style={card}>
            <SettingRow
              label="Enable AI assistant"
              description="Show the AI panel button in the sidebar."
              control={<Toggle checked={aiEnabled} onChange={setAiEnabled} />}
            />

            <SettingRow
              label="GitHub OAuth App Client ID"
              description={
                <>
                  Create an OAuth App at{' '}
                  <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer"
                    style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                    github.com/settings/developers
                  </a>
                  {' '}and enable "Device Flow". Paste the Client ID here (no secret needed).
                </>
              }
              control={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="text"
                    value={aiClientId}
                    onChange={e => setAiClientId(e.target.value)}
                    placeholder="Oauth_…"
                    style={{ ...inputStyle, width: 180, fontSize: 12, padding: '5px 10px', fontFamily: 'monospace' }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    onClick={saveAiSettings}
                    disabled={aiSaving}
                    style={{
                      padding: '5px 14px', fontSize: 12, fontWeight: 500,
                      background: aiSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                      color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
                      opacity: aiSaving ? 0.6 : 1, transition: 'background 0.2s',
                    }}
                  >
                    {aiSaved ? 'Saved!' : aiSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              }
            />

            <SettingRow
              label="GitHub account"
              description="Sign in to let alter fetch an access token automatically via GitHub OAuth."
              control={
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  {authPhase === 'idle' && (
                    <button
                      onClick={startDeviceFlow}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', fontSize: 12, fontWeight: 500,
                        background: 'var(--color-foreground)', color: 'var(--color-background)',
                        border: 'none', borderRadius: 5, cursor: 'pointer',
                        opacity: 1, transition: 'opacity 0.15s',
                      }}
                    >
                      <Github size={13} /> Sign in with GitHub
                    </button>
                  )}
                  {authPhase === 'in_progress' && (
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
                      padding: '10px 12px',
                      background: 'var(--color-accent)',
                      borderRadius: 8,
                      border: '1px solid var(--color-border)',
                      minWidth: 230,
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', alignSelf: 'flex-start' }}>
                        Enter this code at:
                      </div>
                      <div style={{ alignSelf: 'flex-start' }}>
                        <a
                          href={deviceUri || 'https://github.com/login/device'}
                          target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}
                        >
                          {deviceUri || 'github.com/login/device'} ↗
                        </a>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                        <code style={{
                          fontSize: 22, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.12em',
                          color: 'var(--color-foreground)',
                        }}>
                          {deviceUserCode}
                        </code>
                        <button
                          onClick={copyDeviceCode}
                          title="Copy code"
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: codeCopied ? 'var(--color-status-running)' : 'var(--color-muted-foreground)',
                            display: 'flex', alignItems: 'center',
                          }}
                        >
                          {codeCopied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                        <Loader size={12} style={{ animation: 'spin 1s linear infinite', color: 'var(--color-muted-foreground)' }} />
                        <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>Waiting for authorization…</span>
                      </div>
                      <button
                        onClick={cancelDeviceFlow}
                        style={{
                          alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11,
                          background: 'transparent', border: '1px solid var(--color-border)',
                          borderRadius: 4, cursor: 'pointer', color: 'var(--color-muted-foreground)',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {authPhase === 'connected' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-status-running)', fontWeight: 500 }}>
                        ✓ Connected as @{authUsername}
                      </span>
                      <button
                        onClick={disconnect}
                        title="Disconnect GitHub account"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', fontSize: 11,
                          background: 'transparent',
                          border: '1px solid var(--color-border)',
                          borderRadius: 4, cursor: 'pointer',
                          color: 'var(--color-muted-foreground)',
                        }}
                      >
                        <LogOut size={11} /> Disconnect
                      </button>
                    </div>
                  )}
                  {authError && (
                    <div style={{ fontSize: 11, color: 'var(--color-destructive)', maxWidth: 240, textAlign: 'right' }}>
                      {authError}
                    </div>
                  )}
                </div>
              }
            />

            <SettingRow
              label="Model"
              description="GitHub Models model to use for chat responses."
              isLast
              control={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                    style={{ ...selectStyle, minWidth: 180 }}
                  >
                    {modelOptions.length > 0
                      ? modelOptions.map(m => (
                        <option key={m.id} value={m.id} title={m.summary}>
                          {m.name}{m.publisher ? ` (${m.publisher})` : ''}
                        </option>
                      ))
                      : (
                        <>
                          <option value="gpt-4o-mini">gpt-4o-mini (fast)</option>
                          <option value="gpt-4o">gpt-4o</option>
                          <option value="o3-mini">o3-mini</option>
                          <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                        </>
                      )
                    }
                  </select>
                  <button
                    onClick={loadModels}
                    disabled={modelsLoading}
                    title="Refresh model list from GitHub"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 5,
                      background: 'transparent', border: '1px solid var(--color-border)',
                      cursor: 'pointer', color: 'var(--color-muted-foreground)',
                    }}
                  >
                    <RefreshCw size={12} style={modelsLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                  </button>
                  <button
                    onClick={saveAiSettings}
                    disabled={aiSaving}
                    style={{
                      padding: '5px 14px', fontSize: 12, fontWeight: 500,
                      background: aiSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                      color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
                      opacity: aiSaving ? 0.6 : 1, transition: 'background 0.2s',
                    }}
                  >
                    {aiSaved ? 'Saved!' : aiSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              }
            />
          </div>
        </>
      )}

      {/* ── Tab: Telegram ── */}
      {activeTab === 'telegram' && (
        <>
          <p style={sectionTitle}>Telegram Bot</p>
          <div style={card}>
            <SettingRow
              label="Enable Telegram Bot"
              description="Allow controlling processes and receiving alerts via Telegram"
              isLast
              control={<Toggle checked={tgEnabled} onChange={v => setTgEnabled(v)} />}
            />
          </div>

          <p style={sectionTitle}>Bot Token</p>
          <div style={card}>
            <SettingRow
              label="Bot Token"
              description={
                tgTokenSet && !tgChangingToken
                  ? 'Token is saved — click Change to replace it'
                  : 'Get your token from @BotFather on Telegram'
              }
              isLast
              control={
                tgTokenSet && !tgChangingToken ? (
                  // @group BusinessLogic > Telegram > Token : Locked state — token already saved
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{
                      ...inputStyle, width: 240, fontSize: 12,
                      display: 'flex', alignItems: 'center', gap: 6,
                      color: 'var(--color-muted-foreground)',
                      background: 'var(--color-secondary)',
                    }}>
                      <span style={{ color: 'var(--color-status-running)', fontSize: 13 }}>✓</span>
                      <span style={{ fontFamily: 'monospace' }}>{tgTokenHint ?? '••••••••'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setTgChangingToken(true); setTgBotInfo(null) }}
                      style={{
                        padding: '5px 12px', fontSize: 12, fontWeight: 500,
                        background: 'var(--color-card)', color: 'var(--color-foreground)',
                        border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer',
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  // @group BusinessLogic > Telegram > Token : Edit state — enter new token
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="password"
                      placeholder="Paste new bot token…"
                      value={tgToken}
                      onChange={e => { setTgToken(e.target.value); setTgBotInfo(null) }}
                      style={{ ...inputStyle, width: 240, fontSize: 12 }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleValidateToken}
                      disabled={tgValidating || !tgToken}
                      style={{
                        padding: '5px 12px', fontSize: 12, fontWeight: 500,
                        background: 'var(--color-card)', color: 'var(--color-foreground)',
                        border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer',
                        opacity: (tgValidating || !tgToken) ? 0.5 : 1,
                      }}
                    >
                      {tgValidating ? 'Checking…' : 'Validate'}
                    </button>
                    {tgTokenSet && (
                      <button
                        type="button"
                        onClick={() => { setTgChangingToken(false); setTgToken(''); setTgBotInfo(null) }}
                        style={{
                          padding: '5px 10px', fontSize: 12,
                          background: 'none', color: 'var(--color-muted-foreground)',
                          border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )
              }
            />
            {tgBotInfo && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12,
                background: tgBotInfo.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: tgBotInfo.ok ? 'var(--color-status-running)' : 'var(--color-status-errored)',
                border: `1px solid ${tgBotInfo.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              }}>
                {tgBotInfo.ok
                  ? `✅ Connected as @${tgBotInfo.username ?? tgBotInfo.first_name}`
                  : `❌ ${tgBotInfo.error ?? 'Invalid token'}`}
              </div>
            )}
          </div>

          <p style={sectionTitle}>Allowed Chat IDs</p>
          <div style={card}>
            <SettingRow
              label="Allowed Chat IDs"
              description="Only these Telegram user/group IDs can send commands. One ID per line. Find your ID by messaging @userinfobot."
              isLast
              control={
                <textarea
                  placeholder={'123456789\n-987654321'}
                  value={tgChatIds}
                  onChange={e => setTgChatIds(e.target.value)}
                  rows={4}
                  style={{
                    ...inputStyle,
                    width: 200,
                    resize: 'vertical',
                    fontFamily: 'monospace',
                    fontSize: 12,
                  }}
                />
              }
            />
          </div>

          <p style={sectionTitle}>Notifications</p>
          <div style={card}>
            <SettingRow label="Notify on crash" description="Send a message when a process crashes" control={<Toggle checked={tgNotifyCrash} onChange={setTgNotifyCrash} />} />
            <SettingRow label="Notify on start" description="Send a message when a process starts" control={<Toggle checked={tgNotifyStart} onChange={setTgNotifyStart} />} />
            <SettingRow label="Notify on stop" description="Send a message when a process is stopped" control={<Toggle checked={tgNotifyStop} onChange={setTgNotifyStop} />} />
            <SettingRow
              label="Notify on restart"
              description="Send a message when a process is automatically restarted"
              isLast
              control={<Toggle checked={tgNotifyRestart} onChange={setTgNotifyRestart} />}
            />
          </div>

          {/* Save and test buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <button
              onClick={handleSaveTelegram}
              disabled={tgSaving}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 500,
                background: tgSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                opacity: tgSaving ? 0.6 : 1, transition: 'background 0.2s',
              }}
            >
              {tgSaved ? 'Saved!' : tgSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleTestTelegram}
              disabled={tgTesting || !tgTokenSet || parseChatIds().length === 0}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 500,
                background: 'var(--color-card)', color: 'var(--color-foreground)',
                border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer',
                opacity: (tgTesting || !tgTokenSet || parseChatIds().length === 0) ? 0.5 : 1,
              }}
            >
              {tgTesting ? 'Sending…' : 'Send Test Message'}
            </button>
            {tgTestResult && (
              <span style={{ fontSize: 12, color: tgTestResult.startsWith('✅') ? 'var(--color-status-running)' : 'var(--color-status-errored)' }}>
                {tgTestResult}
              </span>
            )}
          </div>
          {tgError && (
            <p style={{ fontSize: 12, color: 'var(--color-status-errored)', marginTop: 8 }}>{tgError}</p>
          )}

          {/* Setup guide */}
          <div style={{ ...card, marginTop: 20, background: 'rgba(var(--color-primary-rgb, 99,102,241),0.05)', borderColor: 'rgba(var(--color-primary-rgb, 99,102,241),0.2)' }}>
            <p style={{ ...sectionTitle, color: 'var(--color-primary)', marginBottom: 8 }}>Setup Guide</p>
            <ol style={{ fontSize: 12, color: 'var(--color-muted-foreground)', paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
              <li>Message <strong>@BotFather</strong> on Telegram → <code>/newbot</code> → copy the token above</li>
              <li>Click <strong>Validate</strong> to confirm the token works</li>
              <li>Message your bot, then message <strong>@userinfobot</strong> to get your Chat ID</li>
              <li>Add your Chat ID to the Allowed Chat IDs list</li>
              <li>Enable the bot and save</li>
              <li>Send <strong>/help</strong> to your bot to see available commands</li>
            </ol>
            <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginTop: 12, marginBottom: 0 }}>
              <strong>Commands:</strong> /list · /start &lt;name&gt; · /stop &lt;name&gt; · /restart &lt;name&gt; · /logs &lt;name&gt; [lines] · /status &lt;name&gt; · /ping · /help
            </p>
          </div>
        </>
      )}

      {/* ── Tab: Log Alerts ── */}
      {activeTab === 'log-alerts' && (
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
                  <button
                    onClick={() => setLaNsOverrides(prev => { const next = { ...prev }; delete next[ns]; return next })}
                    style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer', color: 'var(--color-status-crashed)' }}
                  >Remove</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <input
              placeholder="Namespace name"
              value={laNsNew}
              onChange={e => setLaNsNew(e.target.value)}
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
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
