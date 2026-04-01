// @group BusinessLogic > AiTab : AI assistant settings — GitHub OAuth, model selection

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Github, Loader, LogOut, RefreshCw } from 'lucide-react'
import type { AiModelInfo } from '@/lib/api'
import { api } from '@/lib/api'
import { card, inputStyle, sectionTitle, selectStyle, SettingRow, Toggle } from './shared'

export default function AiTab() {
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

  useEffect(() => {
    api.aiGetSettings().then(s => {
      setAiEnabled(s.enabled)
      setAiModel(s.model)
      setAiClientId('')
      if (s.github_username) {
        setAuthUsername(s.github_username)
        setAuthPhase('connected')
      } else {
        setAuthPhase('idle')
      }
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
          setPollInterval(status.interval)
        }
      } catch { /* network hiccup — keep polling */ }
    }, pollInterval * 1000)

    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [authPhase, pollInterval])

  async function loadModels() {
    setModelsLoading(true)
    try {
      const data = await api.aiGetModels()
      if (data.models.length > 0) setModelOptions(data.models)
    } catch { /* use fallback list */ } finally {
      setModelsLoading(false)
    }
  }

  async function saveAiSettings() {
    setAiSaving(true)
    try {
      await api.aiSaveSettings({ enabled: aiEnabled, model: aiModel, client_id: aiClientId || undefined })
      setAiSaved(true)
      setTimeout(() => setAiSaved(false), 2000)
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

  return (
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
  )
}
