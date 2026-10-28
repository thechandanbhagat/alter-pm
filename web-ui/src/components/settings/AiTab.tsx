// @group BusinessLogic > AiTab : AI assistant settings — provider selector, per-provider config, GitHub OAuth

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Github, Loader, LogOut, RefreshCw } from 'lucide-react'
import type { AiLocalProviderInfo, AiModelInfo } from '@/lib/api'
import { api } from '@/lib/api'
import { AI_PROVIDERS, AI_PROVIDER_LABELS, LOCAL_AI_PROVIDERS, asAiProvider, defaultAiModel, emptyCliPaths, isAbsoluteExecutablePath, isCliProvider, isLocalAiProvider, localProviderDisclosure, localProviderStatus, type AiProvider } from '@/lib/aiProviders'
import { card, inputStyle, sectionTitle, selectStyle, SettingRow, Toggle } from './shared'

export default function AiTab() {
  const [aiEnabled,    setAiEnabled]    = useState(false)
  const [provider,     setProvider]     = useState<AiProvider>('ollama')
  const [aiModel,      setAiModel]      = useState('llama3.2')
  const [aiSaving,     setAiSaving]     = useState(false)
  const [aiSaved,      setAiSaved]      = useState(false)

  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [localProviders, setLocalProviders] = useState<AiLocalProviderInfo[]>([])
  const [localPaths, setLocalPaths] = useState<Record<string, string>>(emptyCliPaths)
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pathsSaving, setPathsSaving] = useState(false)
  const providerRef = useRef<AiProvider>('ollama')
  const modelRequestRef = useRef(0)

  // @group BusinessLogic > AiTab > GitHub : OAuth Device Flow state
  const [aiClientId,        setAiClientId]        = useState('')
  const [aiClientIdBuiltin, setAiClientIdBuiltin] = useState(false)
  const [authPhase,     setAuthPhase]     = useState<'idle' | 'in_progress' | 'connected'>('idle')
  const [authUsername,  setAuthUsername]  = useState('')
  const [deviceUserCode, setDeviceUserCode] = useState('')
  const [deviceUri,     setDeviceUri]     = useState('')
  const [pollInterval,  setPollInterval]  = useState(5)
  const [codeCopied,    setCodeCopied]    = useState(false)
  const [authError,     setAuthError]     = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // @group BusinessLogic > AiTab > Claude : Anthropic API key
  const [anthropicKey,     setAnthropicKey]     = useState('')
  const [anthropicKeyHint, setAnthropicKeyHint] = useState('')
  const [anthropicKeySet,  setAnthropicKeySet]  = useState(false)

  // @group BusinessLogic > AiTab > OpenAI : OpenAI API key + base URL
  const [openaiKey,     setOpenaiKey]     = useState('')
  const [openaiKeyHint, setOpenaiKeyHint] = useState('')
  const [openaiKeySet,  setOpenaiKeySet]  = useState(false)
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('https://api.openai.com/v1')

  // @group BusinessLogic > AiTab > Ollama : Base URL
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434')

  // @group BusinessLogic > AiTab : Dynamic model list
  const [modelOptions,   setModelOptions]   = useState<AiModelInfo[]>([])
  const [modelsLoading,  setModelsLoading]  = useState(false)

  const loadModels = useCallback(async (target: AiProvider) => {
    const request = ++modelRequestRef.current
    setModelsLoading(true)
    setModelsError(null)
    try {
      const data = await api.aiGetModels(target)
      if (request !== modelRequestRef.current || target !== providerRef.current) return
      setModelOptions(data.models)
      if (!isLocalAiProvider(target)) {
        setAiModel(previous => data.models.some(model => model.id === previous)
          ? previous : (data.models[0]?.id ?? previous))
      }
    } catch (error) {
      if (request === modelRequestRef.current) setModelsError((error as Error).message || 'Unable to load models.')
    } finally {
      if (request === modelRequestRef.current) setModelsLoading(false)
    }
  }, [])

  const rescanLocalProviders = useCallback(async () => {
    setLocalLoading(true)
    setLocalError(null)
    try {
      const data = await api.aiGetLocalProviders()
      setLocalProviders(data.providers)
    } catch (error) {
      setLocalProviders([])
      setLocalError((error as Error).message || 'Unable to check installed providers.')
    } finally {
      setLocalLoading(false)
    }
  }, [])

  const reloadSettings = useCallback(async () => {
    setSettingsError(null)
    try {
      const s = await api.aiGetSettings()
      const selected = asAiProvider(s.provider)
      providerRef.current = selected
      setAiEnabled(s.enabled)
      setProvider(selected)
      setAiModel(s.model || defaultAiModel(selected))
      setAiClientId('')
      setAiClientIdBuiltin(!!s.client_id_builtin)
      if (s.github_username) { setAuthUsername(s.github_username); setAuthPhase('connected') }
      else { setAuthPhase('idle') }
      setAnthropicKeySet(s.anthropic_key_set)
      setAnthropicKeyHint(s.anthropic_key_hint ?? '')
      setOpenaiKeySet(s.openai_key_set)
      setOpenaiKeyHint(s.openai_key_hint ?? '')
      setOpenaiBaseUrl(s.openai_base_url || 'https://api.openai.com/v1')
      setOllamaBaseUrl(s.ollama_base_url || 'http://localhost:11434')
      setLocalPaths({ ...emptyCliPaths(), ...s.local_cli_paths })
      setSettingsLoaded(true)
      const canLoad = isLocalAiProvider(selected) || selected === 'ollama' ||
        selected === 'claude' && s.anthropic_key_set ||
        selected === 'openai' && s.openai_key_set ||
        (selected === 'copilot' || selected === 'github') && s.github_token_set
      if (canLoad) void loadModels(selected)
    } catch (error) {
      setSettingsError((error as Error).message || 'Unable to load AI settings.')
    }
  }, [loadModels])

  useEffect(() => {
    void reloadSettings()
    void rescanLocalProviders()
    return () => { modelRequestRef.current += 1 }
  }, [reloadSettings, rescanLocalProviders])

  // @group BusinessLogic > AiTab > GitHub : Poll during Device Flow
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
          void loadModels(providerRef.current)
        } else if (status.status === 'expired') {
          setAuthPhase('idle'); setAuthError('Code expired — please try again.')
        } else if (status.status === 'denied') {
          setAuthPhase('idle'); setAuthError('Authorization denied by GitHub.')
        } else if (status.status === 'error') {
          setAuthPhase('idle'); setAuthError(status.message ?? 'Unknown error from GitHub.')
        } else if (status.interval) {
          setPollInterval(status.interval)
        }
      } catch { /* network hiccup — keep polling */ }
    }, pollInterval * 1000)
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [authPhase, pollInterval, loadModels])

  function handleProviderChange(newProvider: AiProvider) {
    providerRef.current = newProvider
    setProvider(newProvider)
    setModelOptions([])
    setAiModel(defaultAiModel(newProvider))
    setAiSaved(false)
    void loadModels(newProvider)
  }

  function normalizedPaths() {
    const paths = Object.fromEntries(Object.entries(localPaths).map(([id, path]) => [id, path.trim()]))
    const invalid = Object.entries(paths).find(([, path]) => !isAbsoluteExecutablePath(path))
    if (invalid) throw new Error(`${AI_PROVIDER_LABELS[asAiProvider(invalid[0])]} requires an absolute executable path, or leave it blank for automatic discovery.`)
    return paths
  }

  async function savePathsAndRescan() {
    setPathsSaving(true)
    setLocalError(null)
    try {
      const paths = normalizedPaths()
      await api.aiSaveSettings({ local_cli_paths: paths })
      setLocalPaths(paths)
      await rescanLocalProviders()
    } catch (error) {
      setLocalError((error as Error).message || 'Unable to save executable paths.')
    } finally {
      setPathsSaving(false)
    }
  }

  async function saveAiSettings() {
    setAiSaving(true)
    setSettingsError(null)
    setAiSaved(false)
    try {
      const body: Parameters<typeof api.aiSaveSettings>[0] = {
        provider,
        enabled: aiEnabled,
        model: aiModel.trim() || defaultAiModel(provider),
        local_cli_paths: normalizedPaths(),
      }
      if (provider === 'github' && aiClientId) body.client_id = aiClientId
      if (provider === 'claude'  && anthropicKey)  body.anthropic_key  = anthropicKey
      if (provider === 'openai'  && openaiKey)     body.openai_key     = openaiKey
      if (provider === 'openai')                   body.openai_base_url = openaiBaseUrl
      if (provider === 'ollama')                   body.ollama_base_url = ollamaBaseUrl

      await api.aiSaveSettings(body)
      setAiSaved(true)
      setTimeout(() => setAiSaved(false), 2000)
      // Clear secret inputs after save
      setAnthropicKey(''); setOpenaiKey('')
      const s = await api.aiGetSettings()
      setAnthropicKeySet(s.anthropic_key_set); setAnthropicKeyHint(s.anthropic_key_hint ?? '')
      setOpenaiKeySet(s.openai_key_set);       setOpenaiKeyHint(s.openai_key_hint ?? '')
      if (modelOptions.length === 0) void loadModels(provider)
      void rescanLocalProviders()
    } catch (error) {
      setSettingsError((error as Error).message || 'Unable to save AI settings.')
    } finally {
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
    setAuthPhase('idle'); setDeviceUserCode(''); setDeviceUri(''); setAuthError(null)
  }

  async function disconnect() {
    try {
      await api.aiAuthLogout()
      setAuthPhase('idle'); setAuthUsername(''); setModelOptions([]); setAuthError(null)
    } catch (error) { setAuthError((error as Error).message || 'Unable to disconnect GitHub.') }
  }

  function copyDeviceCode() {
    navigator.clipboard.writeText(deviceUserCode).then(() => {
      setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000)
    }).catch(() => {})
  }

  const saveButton = (label = 'Save') => (
    <button
      onClick={saveAiSettings}
      disabled={aiSaving || !settingsLoaded}
      style={{
        padding: '5px 14px', fontSize: 12, fontWeight: 500,
        background: aiSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
        color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
        opacity: aiSaving ? 0.6 : 1, transition: 'background 0.2s',
      }}
    >
      {aiSaved ? 'Saved!' : aiSaving ? 'Saving…' : label}
    </button>
  )

  const selectedLocal = localProviders.find(item => item.id === provider)

  return (
    <>
      <p style={sectionTitle}>AI Assistant</p>
      {settingsError && <div role="alert" style={{ color: 'var(--color-destructive)', marginBottom: 12 }}>
        {settingsError}
        {!settingsLoaded && <button type="button" onClick={() => void reloadSettings()} style={{ ...selectStyle, marginLeft: 8 }}>Retry loading settings</button>}
      </div>}
      <fieldset disabled={!settingsLoaded || aiSaving} style={{ ...card, minWidth: 0 }}>

        {/* Enable toggle */}
        <SettingRow
          label="Enable AI assistant"
          description="Show the AI panel button in the sidebar."
          control={<Toggle checked={aiEnabled} onChange={setAiEnabled} />}
        />

        {/* Provider selector */}
        <SettingRow
          label="Provider"
          description="Select which AI service to use for chat responses."
          control={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={provider}
                onChange={e => handleProviderChange(asAiProvider(e.target.value))}
                aria-label="AI provider"
                style={{ ...selectStyle, minWidth: 180 }}
              >
                {AI_PROVIDERS.map(p => (
                  <option key={p} value={p}>{AI_PROVIDER_LABELS[p]}{isLocalAiProvider(p) ? ` — ${localProviderStatus(localProviders.find(item => item.id === p), localLoading)}` : ''}</option>
                ))}
              </select>
              {saveButton()}
            </div>
          }
        />

        {isLocalAiProvider(provider) && <div style={{ padding: '12px 0', fontSize: 12, lineHeight: 1.5 }}>
          <p style={{ color: selectedLocal?.available ? 'var(--color-status-running)' : 'var(--color-muted-foreground)' }}>
            <strong>{localProviderStatus(selectedLocal, localLoading)}</strong> — {selectedLocal?.detail || 'Check the installed providers below for availability on the active daemon host.'}
          </p>
          <p style={{ color: 'var(--color-muted-foreground)', marginTop: 4 }}>{localProviderDisclosure(provider)}</p>
        </div>}

        {/* ── GitHub Copilot section ── */}
        {provider === 'copilot' && (
          <SettingRow
            label="GitHub Copilot"
            description={
              authPhase === 'connected'
                ? <>Uses your active Copilot subscription via <strong>@{authUsername}</strong>. No extra configuration needed.</>
                : <>Requires an active <a href="https://github.com/features/copilot" target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>GitHub Copilot</a> subscription. Sign in using the GitHub provider first to link your account.</>
            }
            control={
              authPhase === 'connected'
                ? <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: 'color-mix(in srgb, var(--color-status-running) 18%, transparent)', color: 'var(--color-status-running)' }}>✓ Ready</span>
                : <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: 'color-mix(in srgb, var(--color-destructive) 15%, transparent)', color: 'var(--color-destructive)' }}>Not connected</span>
            }
          />
        )}

        {/* ── GitHub Models section ── */}
        {provider === 'github' && (
          <>
            <SettingRow
              label="GitHub OAuth App Client ID"
              description={
                aiClientIdBuiltin
                  ? 'Client ID is built into this binary — no manual configuration needed.'
                  : <>
                      Create an OAuth App at{' '}
                      <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer"
                        style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                        github.com/settings/developers
                      </a>
                      {' '}and enable "Device Flow". Paste the Client ID here (no secret needed).
                    </>
              }
              control={
                aiClientIdBuiltin
                  ? (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                      background: 'color-mix(in srgb, var(--color-status-running) 18%, transparent)',
                      color: 'var(--color-status-running)',
                    }}>✓ Built-in</span>
                  ) : (
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
                      {saveButton()}
                    </div>
                  )
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
                      }}
                    >
                      <Github size={13} /> Sign in with GitHub
                    </button>
                  )}
                  {authPhase === 'in_progress' && (
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
                      padding: '10px 12px',
                      background: 'var(--color-accent)', borderRadius: 8, border: '1px solid var(--color-border)',
                      minWidth: 230,
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', alignSelf: 'flex-start' }}>
                        Enter this code at:
                      </div>
                      <div style={{ alignSelf: 'flex-start' }}>
                        <a href={deviceUri || 'https://github.com/login/device'} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none' }}>
                          {deviceUri || 'github.com/login/device'} ↗
                        </a>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                        <code style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.12em', color: 'var(--color-foreground)' }}>
                          {deviceUserCode}
                        </code>
                        <button
                          onClick={copyDeviceCode}
                          title="Copy code"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: codeCopied ? 'var(--color-status-running)' : 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center' }}
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
                        style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-muted-foreground)' }}
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
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-muted-foreground)' }}
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
          </>
        )}

        {/* ── Claude section ── */}
        {provider === 'claude' && (
          <SettingRow
            label="Anthropic API key"
            description={
              <>
                Get your key at{' '}
                <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer"
                  style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                  console.anthropic.com
                </a>
              </>
            }
            control={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  placeholder={anthropicKeySet ? anthropicKeyHint || '••••••••' : 'sk-ant-…'}
                  style={{ ...inputStyle, width: 200, fontSize: 12, padding: '5px 10px', fontFamily: 'monospace' }}
                  spellCheck={false}
                  autoComplete="off"
                />
                {saveButton()}
              </div>
            }
          />
        )}

        {/* ── OpenAI section ── */}
        {provider === 'openai' && (
          <>
            <SettingRow
              label="OpenAI API key"
              description="Your OpenAI secret key (sk-…). Leave blank to keep existing."
              control={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={e => setOpenaiKey(e.target.value)}
                    placeholder={openaiKeySet ? openaiKeyHint || '••••••••' : 'sk-…'}
                    style={{ ...inputStyle, width: 200, fontSize: 12, padding: '5px 10px', fontFamily: 'monospace' }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              }
            />
            <SettingRow
              label="API base URL"
              description="Override for OpenAI-compatible endpoints (e.g. Azure, LM Studio, Groq)."
              control={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="text"
                    value={openaiBaseUrl}
                    onChange={e => setOpenaiBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    style={{ ...inputStyle, width: 240, fontSize: 12, padding: '5px 10px', fontFamily: 'monospace' }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {saveButton()}
                </div>
              }
            />
          </>
        )}

        {/* ── Ollama section ── */}
        {provider === 'ollama' && (
          <SettingRow
            label="Ollama base URL"
            description="URL of your local Ollama instance."
            control={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="text"
                  value={ollamaBaseUrl}
                  onChange={e => setOllamaBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  style={{ ...inputStyle, width: 220, fontSize: 12, padding: '5px 10px', fontFamily: 'monospace' }}
                  spellCheck={false}
                  autoComplete="off"
                />
                {saveButton()}
              </div>
            }
          />
        )}

        {/* ── Model selector (all providers) ── */}
        <SettingRow
          label="Model"
          description={isCliProvider(provider) ? 'Optional model ID accepted by your installed CLI. Leave blank to use its configured default.' : `${AI_PROVIDER_LABELS[provider]} model to use for chat responses.`}
          isLast
          control={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isCliProvider(provider) ? <input
                aria-label="CLI model ID"
                value={aiModel === 'default' ? '' : aiModel}
                onChange={event => setAiModel(event.target.value)}
                placeholder="CLI default"
                style={{ ...inputStyle, width: 220 }}
                autoComplete="off"
                spellCheck={false}
              /> : <select
                aria-label="AI model"
                value={aiModel}
                onChange={e => setAiModel(e.target.value)}
                style={{ ...selectStyle, minWidth: 200 }}
              >
                {modelOptions.length > 0
                  ? modelOptions.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label}{m.publisher ? ` (${m.publisher})` : ''}
                    </option>
                  ))
                  : <option value={aiModel}>{aiModel}</option>
                }
              </select>}
              <button
                onClick={() => void loadModels(provider)}
                disabled={modelsLoading}
                title="Refresh model list"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 5,
                  background: 'transparent', border: '1px solid var(--color-border)',
                  cursor: 'pointer', color: 'var(--color-muted-foreground)',
                }}
              >
                <RefreshCw size={12} style={modelsLoading ? { animation: 'spin 1s linear infinite' } : {}} />
              </button>
              {saveButton()}
            </div>
          }
        />

        {modelsError && <p role="alert" style={{ marginTop: 12, fontSize: 12, color: 'var(--color-destructive)' }}>{modelsError}</p>}
      </fieldset>

      <p style={sectionTitle}>Installed providers</p>
      <div style={card}>
        <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginBottom: 16, lineHeight: 1.5 }}>
          Discovery runs on the active daemon host, including when you connect to a remote server. It checks installation and support without sending prompts or process data.
          CLI tools use their existing login and cloud models. Apple Foundation Models runs on-device.
        </p>
        {LOCAL_AI_PROVIDERS.map(id => {
          const info = localProviders.find(item => item.id === id)
          return <div key={id} style={{ padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', fontSize: 13 }}>
              <strong>{AI_PROVIDER_LABELS[id]}</strong>
              <span style={{ color: info?.available ? 'var(--color-status-running)' : 'var(--color-muted-foreground)' }}>{localProviderStatus(info, localLoading)}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginTop: 4, lineHeight: 1.5 }}>{info?.detail || (id === 'apple-foundation' ? localProviderDisclosure(id) : 'Install and sign in to the CLI on the daemon host, then rescan.')}</p>
            {(info?.path || info?.version) && <p style={{ fontSize: 11, fontFamily: 'monospace', overflowWrap: 'anywhere', marginTop: 4 }}>{[info.path, info.version].filter(Boolean).join(' · ')}</p>}
            {isCliProvider(id) && <label style={{ display: 'block', fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 8 }}>
              {AI_PROVIDER_LABELS[id]} executable path (optional)
              <input
                value={localPaths[id] ?? ''}
                onChange={event => setLocalPaths(previous => ({ ...previous, [id]: event.target.value }))}
                placeholder="Auto-detect on daemon host"
                disabled={!settingsLoaded || pathsSaving || aiSaving}
                style={{ ...inputStyle, display: 'block', marginTop: 4, maxWidth: 560, fontFamily: 'monospace' }}
                spellCheck={false}
                autoComplete="off"
              />
            </label>}
          </div>
        })}
        <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 8 }}>Use an absolute path to the executable. Clear a saved path to restore automatic discovery.</p>
        {localError && <p role="alert" style={{ fontSize: 12, color: 'var(--color-destructive)', marginTop: 12 }}>{localError}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => void savePathsAndRescan()} disabled={!settingsLoaded || pathsSaving || localLoading || aiSaving} style={selectStyle}>
            {pathsSaving ? 'Saving paths…' : 'Save paths & rescan'}
          </button>
          <button type="button" onClick={() => void rescanLocalProviders()} disabled={localLoading || pathsSaving} style={selectStyle}>
            {localLoading ? 'Checking…' : 'Rescan installed providers'}
          </button>
        </div>
      </div>
    </>
  )
}
