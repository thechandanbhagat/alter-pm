// @group BusinessLogic : Start new process form

import { useRef, useState } from 'react'
import { FolderOpen, ChevronDown, ChevronRight, Cpu, Shield, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { NamespaceInput } from '@/components/NamespaceInput'
import { parseArgs, parseEnvString } from '@/lib/utils'
import { FormCard, FormField, FormRow } from '@/components/FormLayout'
import { FolderBrowser } from '@/components/FolderBrowser'
import type { AppSettings } from '@/lib/settings'
import type { EnvFileEntry } from '@/types'

interface Props {
  onDone: () => void
  settings: AppSettings
}

// @group Utilities > EnvColor : Color tokens for env file tabs (same as EnvFilePanel)
function envFileColor(name: string): string {
  if (name === '.env') return '#4ade80'
  if (name === '.env.example') return '#fbbf24'
  if (name === '.env.local') return '#60a5fa'
  if (name === '.env.production' || name === '.env.prod') return '#f87171'
  if (name === '.env.development' || name === '.env.dev') return '#34d399'
  if (name === '.env.test') return '#a78bfa'
  if (name === '.env.staging') return '#fb923c'
  return '#94a3b8'
}
function envFileBg(name: string): string {
  if (name === '.env') return 'rgba(74,222,128,0.13)'
  if (name === '.env.example') return 'rgba(251,191,36,0.13)'
  if (name === '.env.local') return 'rgba(96,165,250,0.13)'
  if (name === '.env.production' || name === '.env.prod') return 'rgba(248,113,113,0.13)'
  if (name === '.env.development' || name === '.env.dev') return 'rgba(52,211,153,0.13)'
  if (name === '.env.test') return 'rgba(167,139,250,0.13)'
  if (name === '.env.staging') return 'rgba(251,146,60,0.13)'
  return 'rgba(148,163,184,0.1)'
}

export default function StartPage({ onDone, settings }: Props) {
  const [script, setScript]         = useState('')
  const [name, setName]             = useState('')
  const [cwd, setCwd]               = useState('')
  const [namespace, setNamespace]   = useState(settings.defaultNamespace || 'default')
  const [args, setArgs]             = useState('')
  const [env, setEnv]               = useState('')
  const [autorestart, setAutorestart] = useState(true)
  const [watch, setWatch]           = useState(false)
  const [cron, setCron]             = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)

  // @group BusinessLogic > Advanced : Advanced config fields
  const [instances, setInstances]                     = useState(1)
  const [restartDelayMs, setRestartDelayMs]           = useState(1000)
  const [healthCheckUrl, setHealthCheckUrl]           = useState('')
  const [healthCheckInterval, setHealthCheckInterval] = useState(30)
  const [healthCheckTimeout, setHealthCheckTimeout]   = useState(5)
  const [healthCheckRetries, setHealthCheckRetries]   = useState(3)
  const [preStart, setPreStart]                       = useState('')
  const [postStart, setPostStart]                     = useState('')
  const [preStop, setPreStop]                         = useState('')
  const [advancedOpen, setAdvancedOpen]               = useState(false)
  const [envStatus, setEnvStatus]   = useState<{ exists: boolean } | null>(null)
  const [envFiles, setEnvFiles]     = useState<EnvFileEntry[]>([])
  const [browseOpen, setBrowseOpen] = useState(false)

  // @group BusinessLogic > EnvSidebar : Env file viewer state
  const [activeEnvTab, setActiveEnvTab]   = useState<string>('.env')
  const [envContent, setEnvContent]       = useState<string>('')
  const [envDirty, setEnvDirty]           = useState(false)
  const [envSaved, setEnvSaved]           = useState(false)
  const [envSaving, setEnvSaving]         = useState(false)
  const [envLoadingFile, setEnvLoadingFile] = useState(false)

  const envCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // @group BusinessLogic > EnvCheck : Debounced env file list check when cwd changes
  function handleCwdChange(val: string) {
    setCwd(val)
    setEnvStatus(null)
    setEnvFiles([])
    setEnvContent('')
    setEnvDirty(false)
    if (envCheckTimer.current) clearTimeout(envCheckTimer.current)
    const trimmed = val.trim()
    if (!trimmed) return
    envCheckTimer.current = setTimeout(() => {
      api.listEnvPath(trimmed)
        .then(r => {
          setEnvFiles(r.files)
          setEnvStatus({ exists: r.files.some(f => f.name === '.env') })
          if (r.files.length > 0) {
            const first = r.files[0].name
            setActiveEnvTab(first)
            loadEnvFile(first, r.files)
          }
        })
        .catch(() => {
          api.checkEnvPath(trimmed)
            .then(r => setEnvStatus({ exists: r.exists }))
            .catch(() => {})
        })
    }, 500)
  }

  function loadEnvFile(filename: string, fileList?: EnvFileEntry[]) {
    const files = fileList ?? envFiles
    const entry = files.find(f => f.name === filename)
    if (!entry?.path) return
    setEnvLoadingFile(true)
    setEnvContent('')
    setEnvDirty(false)
    api.readEnvFile(entry.path)
      .then(r => { setEnvContent(r.content); setEnvLoadingFile(false) })
      .catch(() => setEnvLoadingFile(false))
  }

  function switchEnvTab(name: string) {
    if (envDirty && !window.confirm('Unsaved changes. Discard and switch?')) return
    setActiveEnvTab(name)
    loadEnvFile(name)
  }

  async function saveEnvFile() {
    const entry = envFiles.find(f => f.name === activeEnvTab)
    if (!entry?.path) return
    setEnvSaving(true)
    try {
      await api.writeEnvFile(entry.path, envContent)
      setEnvDirty(false)
      setEnvSaved(true)
      setTimeout(() => setEnvSaved(false), 2500)
    } catch { /* silent */ }
    finally { setEnvSaving(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const cronVal = cron.trim() || undefined
      await api.startProcess({
        script: script.trim(),
        ...(name.trim()      && { name: name.trim() }),
        ...(cwd.trim()       && { cwd: cwd.trim() }),
        ...(namespace.trim() && { namespace: namespace.trim() }),
        ...(args.trim()      && { args: parseArgs(args.trim()) }),
        ...(env.trim()       && { env: parseEnvString(env.trim()) }),
        autorestart,
        watch,
        ...(cronVal && { cron: cronVal }),
        // Advanced
        instances,
        restart_delay_ms: restartDelayMs,
        ...(healthCheckUrl.trim() && { health_check_url: healthCheckUrl.trim() }),
        health_check_interval_secs: healthCheckInterval,
        health_check_timeout_secs: healthCheckTimeout,
        health_check_retries: healthCheckRetries,
        ...(preStart.trim()  && { pre_start: preStart.trim() }),
        ...(postStart.trim() && { post_start: postStart.trim() }),
        ...(preStop.trim()   && { pre_stop: preStop.trim() }),
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start process')
    } finally {
      setLoading(false)
    }
  }

  const activeColor = envFileColor(activeEnvTab)
  const showEnvSidebar = envFiles.length > 0

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main form area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {browseOpen && (
          <FolderBrowser
            initialPath={cwd.trim()}
            onSelect={path => handleCwdChange(path)}
            onClose={() => setBrowseOpen(false)}
          />
        )}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Start New Process</h2>
        </div>

        <FormCard onSubmit={handleSubmit}>
          <FormRow>
            <FormField label="Command *">
              <input style={inputStyle} value={script} onChange={e => setScript(e.target.value)}
                placeholder="node app.js" required />
            </FormField>
            <FormField label="Name">
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
                placeholder="my-app" />
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
                    {envStatus.exists ? `● .env found` : '○ no .env'}
                  </span>
                )}
                {envFiles.length > 1 && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.13)', color: '#60a5fa', fontWeight: 500 }}>
                    {envFiles.length} env files
                  </span>
                )}
              </span>
            }>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ ...inputStyle, flex: 1 }} value={cwd} onChange={e => handleCwdChange(e.target.value)}
                  placeholder="C:\Users\me\app" />
                <button type="button" onClick={() => setBrowseOpen(true)} title="Browse folders" style={browseBtnStyle}>
                  <FolderOpen size={14} strokeWidth={1.75} />
                </button>
              </div>
            </FormField>
            <FormField label="Namespace">
              <NamespaceInput style={inputStyle} value={namespace} onChange={setNamespace} placeholder="default" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Args (space-separated)">
              <input style={inputStyle} value={args} onChange={e => setArgs(e.target.value)}
                placeholder="--port 3000 --env prod" />
            </FormField>
            <FormField label="Env Vars (KEY=VAL, comma-separated)">
              <input style={inputStyle} value={env} onChange={e => setEnv(e.target.value)}
                placeholder="NODE_ENV=production,PORT=3000" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="">
              <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
                <CheckboxField label="Auto-restart on crash" checked={autorestart} onChange={setAutorestart} />
                <CheckboxField label="Watch mode" checked={watch} onChange={setWatch} />
              </div>
            </FormField>
            <FormField label={<>Cron Schedule <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11 }}>(e.g. "0 * * * *" — leave blank for normal)</span></>}>
              <input style={inputStyle} value={cron} onChange={e => setCron(e.target.value)}
                placeholder="0 * * * *" />
            </FormField>
          </FormRow>
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
              {loading ? 'Starting…' : '▶ Start'}
            </button>
            {error && <span style={{ fontSize: 12, color: 'var(--color-destructive)' }}>{error}</span>}
          </div>
        </FormCard>
      </div>

      {/* @group BusinessLogic > EnvSidebar : Right sidebar showing env files when cwd has them */}
      {showEnvSidebar && (
        <div style={{
          width: 360, flexShrink: 0,
          borderLeft: '1px solid var(--color-border)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--color-card)',
        }}>
          {/* Sidebar header */}
          <div style={{ padding: '10px 14px 0', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
              <span style={{ fontSize: 13 }}>🔑</span>
              <span style={{ fontWeight: 600, fontSize: 12, flex: 1 }}>Env Files</span>
              <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>preview only</span>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
              {envFiles.map(f => {
                const isActive = f.name === activeEnvTab
                const color    = envFileColor(f.name)
                const bg       = envFileBg(f.name)
                return (
                  <button key={f.name} onClick={() => switchEnvTab(f.name)} style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: isActive ? 700 : 500,
                    background: isActive ? bg : 'transparent',
                    border: 'none', borderBottom: isActive ? `2px solid ${color}` : '2px solid transparent',
                    borderRadius: '3px 3px 0 0',
                    cursor: 'pointer', color: isActive ? color : 'var(--color-muted-foreground)',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {f.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Editor area */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '8px 12px', gap: 6 }}>
            {envLoadingFile ? (
              <div style={{ color: 'var(--color-muted-foreground)', fontSize: 13, padding: 20, textAlign: 'center' }}>Loading…</div>
            ) : (
              <>
                <div style={{
                  flex: 1, display: 'flex', gap: 0, overflow: 'hidden',
                  border: `1px solid ${envDirty ? activeColor : 'var(--color-border)'}`,
                  borderRadius: 4, background: 'var(--color-background)',
                }}>
                  {/* Line numbers */}
                  <div style={{
                    padding: '8px 6px', textAlign: 'right', userSelect: 'none',
                    fontFamily: 'monospace', fontSize: 11, lineHeight: '1.6',
                    color: 'var(--color-muted-foreground)', background: 'var(--color-muted)',
                    borderRight: '1px solid var(--color-border)', minWidth: 28, overflowY: 'hidden',
                  }}>
                    {envContent.split('\n').map((_, i) => <div key={i}>{i + 1}</div>)}
                  </div>
                  <textarea
                    value={envContent}
                    onChange={e => { setEnvContent(e.target.value); setEnvDirty(true); setEnvSaved(false) }}
                    spellCheck={false}
                    placeholder="KEY=value"
                    style={{
                      flex: 1, padding: '8px 10px', fontFamily: 'monospace', fontSize: 11, lineHeight: '1.6',
                      background: 'transparent', color: 'var(--color-foreground)',
                      border: 'none', outline: 'none', resize: 'none', minHeight: 0,
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>
              {envDirty ? <span style={{ color: activeColor }}>● Unsaved</span> : envSaved ? '✓ Saved' : `${activeEnvTab}`}
            </span>
            <button
              disabled={envSaving || envLoadingFile || !envDirty}
              onClick={saveEnvFile}
              style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: activeColor, border: 'none', borderRadius: 5, color: '#000',
                opacity: envSaving || envLoadingFile || !envDirty ? 0.5 : 1,
              }}
            >
              {envSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-primary)', width: 14, height: 14 }} />
      {label}
    </label>
  )
}

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', fontSize: 13,
  background: 'var(--color-input)', border: '1px solid var(--color-border)',
  borderRadius: 5, color: 'var(--color-foreground)', outline: 'none',
}

export const primaryBtnStyle: React.CSSProperties = {
  padding: '7px 20px', fontSize: 13, fontWeight: 600,
  background: 'var(--color-primary)', border: 'none',
  borderRadius: 5, cursor: 'pointer', color: '#fff',
}

export const browseBtnStyle: React.CSSProperties = {
  padding: '0 10px', flexShrink: 0, height: '100%', minHeight: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-muted-foreground)',
}
