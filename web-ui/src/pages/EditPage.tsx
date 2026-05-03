// @group BusinessLogic : Edit process configuration form

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FolderOpen, Save, Bell, ChevronDown, ChevronRight, Cpu, Shield, Zap } from 'lucide-react'
import { NamespaceInput } from '@/components/NamespaceInput'
import { api } from '@/lib/api'
import { parseArgs, parseDotEnv, envToString } from '@/lib/utils'
import { FormCard, FormField, FormRow } from '@/components/FormLayout'
import { FolderBrowser } from '@/components/FolderBrowser'
import { inputStyle, primaryBtnStyle, browseBtnStyle } from './StartPage'
import type { NotificationConfig } from '@/types'

interface Props {
  onDone: () => void
}

export default function EditPage({ onDone }: Props) {
  const { id } = useParams<{ id: string }>()
  const [script, setScript]           = useState('')
  const [name, setName]               = useState('')
  const [cwd, setCwd]                 = useState('')
  const [namespace, setNamespace]     = useState('default')
  const [argsStr, setArgsStr]         = useState('')
  const [envStr, setEnvStr]           = useState('')
  const [autorestart, setAutorestart] = useState(true)
  const [watch, setWatch]             = useState(false)
  const [cron, setCron]               = useState('')
  const [maxRestarts, setMaxRestarts] = useState(10)
  const [notify, setNotify]           = useState<NotificationConfig | undefined>(undefined)
  const [notifyOpen, setNotifyOpen]   = useState(false)
  const [error, setError]             = useState('')

  // @group BusinessLogic > Advanced : Advanced config fields
  const [instances, setInstances]                           = useState(1)
  const [restartDelayMs, setRestartDelayMs]                 = useState(1000)
  const [healthCheckUrl, setHealthCheckUrl]                 = useState('')
  const [healthCheckInterval, setHealthCheckInterval]       = useState(30)
  const [healthCheckTimeout, setHealthCheckTimeout]         = useState(5)
  const [healthCheckRetries, setHealthCheckRetries]         = useState(3)
  const [preStart, setPreStart]                             = useState('')
  const [postStart, setPostStart]                           = useState('')
  const [preStop, setPreStop]                               = useState('')
  const [advancedOpen, setAdvancedOpen]                     = useState(false)
  const [loading, setLoading]         = useState(false)
  const [loaded, setLoaded]           = useState(false)

  // @group BusinessLogic > EnvFile : .env file load / save UI state
  const [loadingEnv, setLoadingEnv]       = useState(false)
  const [savingEnv, setSavingEnv]         = useState(false)
  const [saveToFile, setSaveToFile]       = useState(false)
  const [envFileStatus, setEnvFileStatus] = useState<{ msg: string; ok: boolean } | null>(null)

  // @group BusinessLogic > EnvCheck : Live .env existence badge for the cwd field
  const [envStatus, setEnvStatus]   = useState<{ exists: boolean } | null>(null)
  const [browseOpen, setBrowseOpen] = useState(false)
  const envCheckTimer               = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleCwdChange(val: string) {
    setCwd(val)
    setEnvStatus(null)
    if (envCheckTimer.current) clearTimeout(envCheckTimer.current)
    const trimmed = val.trim()
    if (!trimmed) return
    envCheckTimer.current = setTimeout(() => {
      api.checkEnvPath(trimmed)
        .then(r => setEnvStatus({ exists: r.exists }))
        .catch(() => {})
    }, 500)
  }

  // @group BusinessLogic > DataFetch : Load process config on mount
  useEffect(() => {
    if (!id) return
    api.getProcess(id).then(p => {
      setScript(p.script || '')
      setName(p.name || '')
      const cwdVal = p.cwd || ''
      setCwd(cwdVal)
      setNamespace(p.namespace || 'default')
      setArgsStr((p.args || []).join(' '))
      setEnvStr(envToString(p.env || {}))
      setAutorestart(!!p.autorestart)
      setWatch(!!p.watch)
      setCron(p.cron || '')
      setMaxRestarts(p.max_restarts ?? 10)
      setNotify(p.notify)
      setInstances(p.instances ?? 1)
      setRestartDelayMs(p.restart_delay_ms ?? 1000)
      setHealthCheckUrl(p.health_check_url ?? '')
      setHealthCheckInterval(p.health_check_interval_secs ?? 30)
      setHealthCheckTimeout(p.health_check_timeout_secs ?? 5)
      setHealthCheckRetries(p.health_check_retries ?? 3)
      setPreStart(p.pre_start ?? '')
      setPostStart(p.post_start ?? '')
      setPreStop(p.pre_stop ?? '')
      setLoaded(true)
      // Check .env existence for the loaded cwd immediately
      if (cwdVal.trim()) {
        api.checkEnvPath(cwdVal.trim())
          .then(r => setEnvStatus({ exists: r.exists }))
          .catch(() => {})
      }
    }).catch(() => setError('Failed to load process config'))
  }, [id])

  // @group BusinessLogic > EnvFile : Load .env file content from process working directory
  async function handleLoadEnvFile() {
    if (!id) return
    setLoadingEnv(true)
    setEnvFileStatus(null)
    try {
      const result = await api.getEnvFile(id)
      if (result.exists) {
        setEnvStr(result.content.trimEnd())
        setEnvFileStatus({ msg: 'Loaded from .env file', ok: true })
      } else {
        setEnvFileStatus({ msg: '.env file not found in working directory', ok: false })
      }
    } catch {
      setEnvFileStatus({ msg: 'Failed to read .env file', ok: false })
    } finally {
      setLoadingEnv(false)
    }
  }

  // @group BusinessLogic > EnvFile : Write current env textarea content to .env file immediately
  async function handleSaveEnvFile() {
    if (!id) return
    setSavingEnv(true)
    setEnvFileStatus(null)
    try {
      const result = await api.saveEnvFile(id, envStr)
      setEnvFileStatus({ msg: `Saved to ${result.path}`, ok: true })
    } catch {
      setEnvFileStatus({ msg: 'Failed to save .env file', ok: false })
    } finally {
      setSavingEnv(false)
    }
  }

  // @group BusinessLogic > Submit : Apply config update + optionally write .env file
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setError('')
    setLoading(true)
    try {
      const cronVal = cron.trim() || undefined
      await api.updateProcess(id, {
        script: script.trim(),
        ...(name.trim()    && { name: name.trim() }),
        ...(cwd.trim()     && { cwd: cwd.trim() }),
        namespace: namespace.trim() || 'default',
        ...(argsStr.trim() && { args: parseArgs(argsStr.trim()) }),
        env: parseDotEnv(envStr),
        autorestart,
        watch,
        max_restarts: maxRestarts,
        restart_delay_ms: restartDelayMs,
        ...(cronVal && { cron: cronVal }),
        ...(notify && { notify }),
        // Advanced
        instances,
        ...(healthCheckUrl.trim() && { health_check_url: healthCheckUrl.trim() }),
        health_check_interval_secs: healthCheckInterval,
        health_check_timeout_secs: healthCheckTimeout,
        health_check_retries: healthCheckRetries,
        ...(preStart.trim()  && { pre_start: preStart.trim() }),
        ...(postStart.trim() && { post_start: postStart.trim() }),
        ...(preStop.trim()   && { pre_stop: preStop.trim() }),
      })
      if (saveToFile && envStr.trim()) {
        await api.saveEnvFile(id, envStr).catch(() => {})
      }
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update process')
    } finally {
      setLoading(false)
    }
  }

  if (!loaded && !error) return <div style={{ padding: 24, color: 'var(--color-muted-foreground)' }}>Loading…</div>

  return (
    <div style={{ padding: '20px 24px' }}>
      {browseOpen && (
        <FolderBrowser
          initialPath={cwd.trim()}
          onSelect={path => handleCwdChange(path)}
          onClose={() => setBrowseOpen(false)}
        />
      )}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Edit Process</h2>
        <button onClick={onDone} style={{ fontSize: 12, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)' }}>
          ← Back
        </button>
      </div>

      <FormCard onSubmit={handleSubmit}>
        <FormRow>
          <FormField label="Command *">
            <input style={inputStyle} value={script} onChange={e => setScript(e.target.value)} required />
          </FormField>
          <FormField label="Name">
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Working Directory
              {envStatus !== null && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 500,
                  background: envStatus.exists ? 'rgba(100,200,100,0.15)' : 'rgba(128,128,128,0.1)',
                  color: envStatus.exists ? 'var(--color-status-running, #4ade80)' : 'var(--color-muted-foreground)',
                }}>
                  {envStatus.exists ? '● .env found' : '○ no .env'}
                </span>
              )}
            </span>
          }>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...inputStyle, flex: 1 }} value={cwd} onChange={e => handleCwdChange(e.target.value)} placeholder="C:\Users\me\app" />
              <button type="button" onClick={() => setBrowseOpen(true)} title="Browse folders" style={browseBtnStyle}>
                <FolderOpen size={14} strokeWidth={1.75} />
              </button>
            </div>
          </FormField>
          <FormField label="Args (space-separated)">
            <input style={inputStyle} value={argsStr} onChange={e => setArgsStr(e.target.value)} />
          </FormField>
        </FormRow>

        {/* ── Environment Variables — full-width .env textarea ── */}
        <div style={{ display: 'contents' }}>
          <FormField label="Environment Variables">
            <textarea
              value={envStr}
              onChange={e => setEnvStr(e.target.value)}
              placeholder={'KEY=value\nANOTHER_KEY=another_value\n# comments are ignored'}
              rows={5}
              spellCheck={false}
              style={{
                ...inputStyle,
                fontFamily: 'monospace',
                fontSize: 12,
                resize: 'vertical',
                lineHeight: 1.6,
                width: '100%',
              }}
            />
            {/* @group BusinessLogic > EnvFile : Action bar under textarea */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleLoadEnvFile}
                disabled={loadingEnv}
                title="Load content from .env file in the process working directory"
                style={envActionBtn}
              >
                <FolderOpen size={12} />
                {loadingEnv ? 'Loading…' : 'Load from .env'}
              </button>
              <button
                type="button"
                onClick={handleSaveEnvFile}
                disabled={savingEnv || !envStr.trim()}
                title="Write current content to .env file in the process working directory"
                style={envActionBtn}
              >
                <Save size={12} />
                {savingEnv ? 'Saving…' : 'Save to .env'}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--color-muted-foreground)' }}>
                <input
                  type="checkbox"
                  checked={saveToFile}
                  onChange={e => setSaveToFile(e.target.checked)}
                  style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
                />
                Also write .env on save
              </label>
              {envFileStatus && (
                <span style={{ fontSize: 11, color: envFileStatus.ok ? 'var(--color-status-running)' : 'var(--color-destructive)' }}>
                  {envFileStatus.msg}
                </span>
              )}
            </div>
          </FormField>
        </div>

        <FormRow>
          <FormField label="Namespace">
            <NamespaceInput style={inputStyle} value={namespace} onChange={setNamespace} />
          </FormField>
          <FormField label="Max Restarts">
            <input style={inputStyle} type="number" value={maxRestarts} onChange={e => setMaxRestarts(parseInt(e.target.value) || 10)} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label={<>Cron Schedule <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11 }}>(leave blank to disable)</span></>}>
            <input style={inputStyle} value={cron} onChange={e => setCron(e.target.value)} placeholder="0 * * * *" />
          </FormField>
          <FormField label="">
            <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
              <CheckboxField label="Auto-restart on crash" checked={autorestart} onChange={setAutorestart} />
              <CheckboxField label="Watch mode" checked={watch} onChange={setWatch} />
            </div>
          </FormField>
        </FormRow>

        {/* @group BusinessLogic > NotifyOverride : Collapsible process-level notification override */}
        <div style={{ display: 'contents' }}>
          <div style={{
            border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 14px',
          }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setNotifyOpen(o => !o)}
            >
              {notifyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Bell size={13} style={{ opacity: 0.6 }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Notification Override</span>
              <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginLeft: 4 }}>
                (overrides global/namespace defaults for this process)
              </span>
              {notify && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setNotify(undefined) }}
                  style={{ ...envActionBtn, marginLeft: 'auto', color: 'var(--color-destructive)' }}
                >
                  Clear
                </button>
              )}
            </div>

            {notifyOpen && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Events */}
                <div>
                  <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', display: 'block', marginBottom: 6 }}>Trigger Events</span>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {(['on_crash', 'on_restart', 'on_start', 'on_stop'] as const).map(key => {
                      const ensureNotify = (): NotificationConfig => notify ?? {
                        events: { on_crash: false, on_restart: false, on_start: false, on_stop: false },
                      }
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={notify?.events[key] ?? false}
                            onChange={e => {
                              const base = ensureNotify()
                              setNotify({ ...base, events: { ...base.events, [key]: e.target.checked } })
                            }}
                            style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
                          />
                          {key.replace('on_', '')}
                        </label>
                      )
                    })}
                  </div>
                </div>

                {/* Webhook URL */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      checked={notify?.webhook?.enabled ?? false}
                      onChange={e => {
                        const base = notify ?? { events: { on_crash: false, on_restart: false, on_start: false, on_stop: false } }
                        setNotify({ ...base, webhook: { url: base.webhook?.url ?? '', enabled: e.target.checked } })
                      }}
                      style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
                    />
                    <span style={{ color: 'var(--color-muted-foreground)' }}>Webhook URL</span>
                  </label>
                  <input
                    style={{ ...inputStyle, opacity: notify?.webhook?.enabled ? 1 : 0.5 }}
                    type="url"
                    placeholder="https://example.com/webhook"
                    value={notify?.webhook?.url ?? ''}
                    disabled={!notify?.webhook?.enabled}
                    onChange={e => {
                      const base = notify ?? { events: { on_crash: false, on_restart: false, on_start: false, on_stop: false } }
                      setNotify({ ...base, webhook: { url: e.target.value, enabled: base.webhook?.enabled ?? true } })
                    }}
                  />
                </div>

                {/* Slack */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      checked={notify?.slack?.enabled ?? false}
                      onChange={e => {
                        const base = notify ?? { events: { on_crash: false, on_restart: false, on_start: false, on_stop: false } }
                        setNotify({ ...base, slack: { webhook_url: base.slack?.webhook_url ?? '', enabled: e.target.checked } })
                      }}
                      style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
                    />
                    <span style={{ color: 'var(--color-muted-foreground)' }}>Slack Webhook URL</span>
                  </label>
                  <input
                    style={{ ...inputStyle, opacity: notify?.slack?.enabled ? 1 : 0.5 }}
                    type="url"
                    placeholder="https://hooks.slack.com/services/..."
                    value={notify?.slack?.webhook_url ?? ''}
                    disabled={!notify?.slack?.enabled}
                    onChange={e => {
                      const base = notify ?? { events: { on_crash: false, on_restart: false, on_start: false, on_stop: false } }
                      setNotify({ ...base, slack: { webhook_url: e.target.value, enabled: base.slack?.enabled ?? true, channel: base.slack?.channel } })
                    }}
                  />
                </div>

                {/* Teams */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      checked={notify?.teams?.enabled ?? false}
                      onChange={e => {
                        const base = notify ?? { events: { on_crash: false, on_restart: false, on_start: false, on_stop: false } }
                        setNotify({ ...base, teams: { webhook_url: base.teams?.webhook_url ?? '', enabled: e.target.checked } })
                      }}
                      style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }}
                    />
                    <span style={{ color: 'var(--color-muted-foreground)' }}>Teams Webhook URL</span>
                  </label>
                  <input
                    style={{ ...inputStyle, opacity: notify?.teams?.enabled ? 1 : 0.5 }}
                    type="url"
                    placeholder="https://outlook.office.com/webhook/..."
                    value={notify?.teams?.webhook_url ?? ''}
                    disabled={!notify?.teams?.enabled}
                    onChange={e => {
                      const base = notify ?? { events: { on_crash: false, on_restart: false, on_start: false, on_stop: false } }
                      setNotify({ ...base, teams: { webhook_url: e.target.value, enabled: base.teams?.enabled ?? true } })
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* @group BusinessLogic > Advanced : Collapsible advanced config — instances, health check, hooks */}
        <div style={{ display: 'contents' }}>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 14px' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setAdvancedOpen(o => !o)}
            >
              {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Zap size={13} style={{ opacity: 0.6 }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Advanced</span>
              <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginLeft: 4 }}>
                cluster mode, health checks, lifecycle hooks
              </span>
            </div>

            {advancedOpen && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Cluster + restart delay */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Cpu size={12} style={{ opacity: 0.5 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase' }}>Cluster</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <FormField label="Instances">
                      <input
                        style={{ ...inputStyle, width: 90 }}
                        type="number" min={1} max={32}
                        value={instances}
                        onChange={e => setInstances(Math.max(1, parseInt(e.target.value) || 1))}
                      />
                    </FormField>
                    <FormField label="Restart Delay (ms)">
                      <input
                        style={{ ...inputStyle, width: 120 }}
                        type="number" min={0}
                        value={restartDelayMs}
                        onChange={e => setRestartDelayMs(Math.max(0, parseInt(e.target.value) || 0))}
                      />
                    </FormField>
                  </div>
                  {instances > 1 && (
                    <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 4 }}>
                      {instances} separate processes will be started with names <code style={{ fontFamily: 'monospace' }}>{(name || 'app') + '-0'}</code> … <code style={{ fontFamily: 'monospace' }}>{(name || 'app') + '-' + (instances - 1)}</code>
                    </p>
                  )}
                </div>

                {/* Health check */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Shield size={12} style={{ opacity: 0.5 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase' }}>Health Check</span>
                  </div>
                  <FormField label={<>URL <span style={{ color: 'var(--color-muted-foreground)', fontSize: 10 }}>(http://… or host:port)</span></>}>
                    <input
                      style={inputStyle}
                      type="text"
                      placeholder="http://localhost:3000/health"
                      value={healthCheckUrl}
                      onChange={e => setHealthCheckUrl(e.target.value)}
                    />
                  </FormField>
                  {healthCheckUrl.trim() && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                      <FormField label="Interval (s)">
                        <input style={{ ...inputStyle, width: 90 }} type="number" min={5}
                          value={healthCheckInterval}
                          onChange={e => setHealthCheckInterval(Math.max(5, parseInt(e.target.value) || 30))} />
                      </FormField>
                      <FormField label="Timeout (s)">
                        <input style={{ ...inputStyle, width: 90 }} type="number" min={1}
                          value={healthCheckTimeout}
                          onChange={e => setHealthCheckTimeout(Math.max(1, parseInt(e.target.value) || 5))} />
                      </FormField>
                      <FormField label="Retries">
                        <input style={{ ...inputStyle, width: 90 }} type="number" min={1}
                          value={healthCheckRetries}
                          onChange={e => setHealthCheckRetries(Math.max(1, parseInt(e.target.value) || 3))} />
                      </FormField>
                    </div>
                  )}
                </div>

                {/* Lifecycle hooks */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Zap size={12} style={{ opacity: 0.5 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase' }}>Lifecycle Hooks</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <FormField label={<><code style={{ fontFamily: 'monospace', fontSize: 11 }}>pre_start</code> — runs before process starts</>}>
                      <input style={inputStyle} type="text" placeholder='echo "starting..."'
                        value={preStart} onChange={e => setPreStart(e.target.value)} />
                    </FormField>
                    <FormField label={<><code style={{ fontFamily: 'monospace', fontSize: 11 }}>post_start</code> — runs after process starts</>}>
                      <input style={inputStyle} type="text" placeholder='curl http://localhost/warmup'
                        value={postStart} onChange={e => setPostStart(e.target.value)} />
                    </FormField>
                    <FormField label={<><code style={{ fontFamily: 'monospace', fontSize: 11 }}>pre_stop</code> — runs before process stops</>}>
                      <input style={inputStyle} type="text" placeholder='curl -X POST http://localhost/drain'
                        value={preStop} onChange={e => setPreStop(e.target.value)} />
                    </FormField>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? 'Saving…' : '💾 Save & Apply'}
          </button>
          {error && <span style={{ fontSize: 12, color: 'var(--color-destructive)' }}>{error}</span>}
        </div>
      </FormCard>
    </div>
  )
}

// @group BusinessLogic > CheckboxField : Inline checkbox with label
function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-primary)', width: 14, height: 14 }} />
      {label}
    </label>
  )
}

// @group Utilities > Styles : Env file action button
const envActionBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '4px 10px', fontSize: 11, fontWeight: 500,
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 4, cursor: 'pointer', color: 'var(--color-foreground)',
  whiteSpace: 'nowrap',
}
