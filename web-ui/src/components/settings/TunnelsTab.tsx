// @group BusinessLogic > TunnelsTab : Tunnel provider settings — Cloudflare, ngrok, custom binary

import { useEffect, useRef, useState } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'
import type { TunnelProvider, TunnelSettings } from '@/types'
import { api } from '@/lib/api'
import { card, inputStyle, sectionTitle, SettingRow } from './shared'

export default function TunnelsTab() {
  const [tnSettings, setTnSettings] = useState<TunnelSettings>({
    provider: 'cloudflare',
    cloudflare: { token: null },
    ngrok: { auth_token: null },
    custom: { binary_path: '', args_template: '' },
  })
  const [tnSaving, setTnSaving] = useState(false)
  const [tnSaved, setTnSaved] = useState(false)
  const [tnError, setTnError] = useState<string | null>(null)
  const [tnTestResult, setTnTestResult] = useState<Record<TunnelProvider, { ok: boolean; message: string } | null>>({
    cloudflare: null, ngrok: null, custom: null,
  })
  const [tnTesting, setTnTesting] = useState<TunnelProvider | null>(null)
  const [tnInstalling, setTnInstalling] = useState<TunnelProvider | null>(null)
  const [tnInstallLines, setTnInstallLines] = useState<Record<TunnelProvider, string[]>>({
    cloudflare: [], ngrok: [], custom: [],
  })
  const [tnInstallDone, setTnInstallDone] = useState<Record<TunnelProvider, boolean | null>>({
    cloudflare: null, ngrok: null, custom: null,
  })
  const installEsRef = useRef<{ es: EventSource; provider: TunnelProvider } | null>(null)
  const terminalRefs = useRef<Record<TunnelProvider, HTMLPreElement | null>>({
    cloudflare: null, ngrok: null, custom: null,
  })

  useEffect(() => {
    api.getTunnelSettings().then(s => setTnSettings(s)).catch(() => {})
  }, [])

  const btnStyle = (primary: boolean, active: boolean): React.CSSProperties => ({
    padding: '4px 12px', fontSize: 12,
    background: primary ? 'var(--color-primary)' : 'transparent',
    border: primary ? 'none' : '1px solid var(--color-border)',
    borderRadius: 5, cursor: 'pointer',
    color: primary ? '#fff' : 'var(--color-foreground)',
    opacity: active ? 0.6 : 1,
  })

  function startInstallStream(provider: TunnelProvider) {
    // Close any existing stream
    if (installEsRef.current) {
      installEsRef.current.es.close()
      installEsRef.current = null
    }
    setTnInstalling(provider)
    setTnInstallLines(prev => ({ ...prev, [provider]: [] }))
    setTnInstallDone(prev => ({ ...prev, [provider]: null }))

    const es = api.streamInstallProvider(provider)
    installEsRef.current = { es, provider }

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done !== undefined) {
          setTnInstallDone(prev => ({ ...prev, [provider]: data.ok }))
          setTnInstalling(null)
          es.close()
          installEsRef.current = null
          // Scroll terminal to bottom
          const el = terminalRefs.current[provider]
          if (el) el.scrollTop = el.scrollHeight
        } else if (data.line) {
          setTnInstallLines(prev => {
            const next = [...prev[provider], data.line as string]
            // Scroll terminal to bottom after update
            requestAnimationFrame(() => {
              const el = terminalRefs.current[provider]
              if (el) el.scrollTop = el.scrollHeight
            })
            return { ...prev, [provider]: next }
          })
        }
      } catch { /* ignore parse errors */ }
    }

    es.onerror = () => {
      setTnInstallLines(prev => ({ ...prev, [provider]: [...prev[provider], 'Connection error — install may still be running.'] }))
      setTnInstallDone(prev => ({ ...prev, [provider]: false }))
      setTnInstalling(null)
      es.close()
      installEsRef.current = null
    }
  }

  function ProviderTestInstall({ provider, hasInstall }: { provider: TunnelProvider; hasInstall: boolean }) {
    const lines = tnInstallLines[provider]
    const done  = tnInstallDone[provider]
    const hasOutput = lines.length > 0

    return (
      <>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={async () => {
              setTnTesting(provider)
              const r = await api.testTunnelProvider(provider).catch(e => ({ ok: false, message: e.message }))
              setTnTestResult(prev => ({ ...prev, [provider]: r }))
              setTnTesting(null)
            }}
            disabled={tnTesting === provider || tnInstalling === provider}
            style={btnStyle(false, tnTesting === provider)}
          >
            {tnTesting === provider ? 'Testing…' : 'Test'}
          </button>
          {hasInstall && (
            <button
              onClick={() => startInstallStream(provider)}
              disabled={tnInstalling === provider || tnTesting === provider}
              style={btnStyle(true, tnInstalling === provider)}
            >
              {tnInstalling === provider ? 'Installing…' : 'Install'}
            </button>
          )}
        </div>

        {tnTestResult[provider] && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: tnTestResult[provider]!.ok ? 'var(--color-status-running)' : 'var(--color-status-crashed)' }}>
            {tnTestResult[provider]!.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {tnTestResult[provider]!.message}
          </div>
        )}

        {(hasOutput || tnInstalling === provider) && (
          <div style={{ marginTop: 10 }}>
            {/* Terminal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1a1a1a', borderRadius: '6px 6px 0 0', padding: '5px 10px', borderBottom: '1px solid #333' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e', display: 'inline-block' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
              </div>
              <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
                {tnInstalling === provider ? 'Installing…' : done === true ? 'Done' : 'Failed'}
              </span>
            </div>
            {/* Terminal body */}
            <pre
              ref={el => { terminalRefs.current[provider] = el }}
              style={{
                fontSize: 11, fontFamily: 'monospace',
                background: '#0d0d0d',
                border: '1px solid #333', borderTop: 'none',
                borderRadius: '0 0 6px 6px',
                padding: '10px 12px', margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 220, overflow: 'auto',
                color: '#d4d4d4',
                lineHeight: 1.5,
              }}
            >
              {lines.length === 0 ? (
                <span style={{ color: '#555' }}>Waiting for output…</span>
              ) : (
                lines.map((line, i) => <div key={i}>{line}</div>)
              )}
              {tnInstalling === provider && (
                <span style={{ display: 'inline-block', width: 8, height: 14, background: '#d4d4d4', verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
              )}
            </pre>
            {/* Status line below terminal */}
            {done !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: done ? 'var(--color-status-running)' : 'var(--color-status-crashed)' }}>
                {done ? <CheckCircle size={13} /> : <XCircle size={13} />}
                {done ? 'Installed successfully' : 'Installation failed'}
              </div>
            )}
          </div>
        )}
        <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      </>
    )
  }

  return (
    <>
      <p style={sectionTitle}>Tunnel Provider</p>
      <div style={card}>
        <SettingRow
          label="Default provider"
          description="Which tool to use when creating tunnels from the Tunnels page or Port Finder."
          isLast
          control={
            <select
              value={tnSettings.provider}
              onChange={e => setTnSettings(prev => ({ ...prev, provider: e.target.value as TunnelProvider }))}
              style={{ ...inputStyle, width: 160, padding: '4px 8px' }}
            >
              <option value="cloudflare">Cloudflare</option>
              <option value="ngrok">ngrok</option>
              <option value="custom">Custom</option>
            </select>
          }
        />
      </div>

      <p style={sectionTitle}>Cloudflare</p>
      <div style={card}>
        <SettingRow
          label="Quick tunnels"
          description={<>No account needed. Uses <code>cloudflared tunnel --url</code> — generates a random <code>trycloudflare.com</code> URL each time.</>}
          control={null}
        />
        <SettingRow
          label="Named tunnel token"
          description="Optional. Paste a Cloudflare Tunnel token for a stable hostname on your own domain. Leave empty for quick tunnels."
          control={
            <input
              type="password"
              placeholder="eyJhIjoiL…"
              value={tnSettings.cloudflare.token ?? ''}
              onChange={e => setTnSettings(prev => ({ ...prev, cloudflare: { ...prev.cloudflare, token: e.target.value || null } }))}
              style={{ ...inputStyle, width: 240 }}
            />
          }
        />
        <SettingRow
          label="Binary"
          description={<>Auto-install via <code>winget</code> (Windows) or <code>brew</code> (macOS), or download from <code>developers.cloudflare.com/cloudflared</code></>}
          isLast
          control={<ProviderTestInstall provider="cloudflare" hasInstall />}
        />
      </div>

      <p style={sectionTitle}>ngrok</p>
      <div style={card}>
        <SettingRow
          label="Auth token"
          description={<>Optional for free URLs. Get yours at <code>dashboard.ngrok.com/get-started/your-authtoken</code></>}
          control={
            <input
              type="password"
              placeholder="2abc…"
              value={tnSettings.ngrok.auth_token ?? ''}
              onChange={e => setTnSettings(prev => ({ ...prev, ngrok: { ...prev.ngrok, auth_token: e.target.value || null } }))}
              style={{ ...inputStyle, width: 240 }}
            />
          }
        />
        <SettingRow
          label="Binary"
          description={<>Install: <code>winget install ngrok.ngrok</code> or download from <code>ngrok.com/download</code></>}
          isLast
          control={<ProviderTestInstall provider="ngrok" hasInstall />}
        />
      </div>

      <p style={sectionTitle}>Custom Provider</p>
      <div style={card}>
        <SettingRow
          label="Binary path"
          description='Full path to the tunnel binary (e.g. "bore", "lt", or "C:\\tools\\mytunnel.exe").'
          control={
            <input
              type="text"
              placeholder="bore"
              value={tnSettings.custom.binary_path}
              onChange={e => setTnSettings(prev => ({ ...prev, custom: { ...prev.custom, binary_path: e.target.value } }))}
              style={{ ...inputStyle, width: 200 }}
            />
          }
        />
        <SettingRow
          label="Args template"
          description='Command arguments with {port} as the port placeholder (e.g. "local {port}"). The binary is called as: binary [args].'
          control={
            <input
              type="text"
              placeholder="local {port}"
              value={tnSettings.custom.args_template}
              onChange={e => setTnSettings(prev => ({ ...prev, custom: { ...prev.custom, args_template: e.target.value } }))}
              style={{ ...inputStyle, width: 200 }}
            />
          }
        />
        <SettingRow
          label="Binary"
          description="The custom binary must print an https:// URL somewhere in its stdout or stderr output."
          isLast
          control={<ProviderTestInstall provider="custom" hasInstall={false} />}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={async () => {
            setTnSaving(true); setTnSaved(false); setTnError(null)
            try {
              await api.updateTunnelSettings(tnSettings)
              setTnSaved(true)
              setTimeout(() => setTnSaved(false), 2500)
            } catch (e: unknown) {
              setTnError(e instanceof Error ? e.message : 'Save failed')
            } finally {
              setTnSaving(false)
            }
          }}
          disabled={tnSaving}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 500,
            background: tnSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            opacity: tnSaving ? 0.6 : 1, transition: 'background 0.2s',
          }}
        >
          {tnSaved ? 'Saved!' : tnSaving ? 'Saving…' : 'Save'}
        </button>
        {tnError && <span style={{ fontSize: 12, color: 'var(--color-status-crashed)' }}>{tnError}</span>}
      </div>
    </>
  )
}
