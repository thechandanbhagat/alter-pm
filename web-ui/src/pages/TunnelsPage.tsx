// @group BusinessLogic : Tunnels page — create and manage cloudflared / ngrok / custom tunnels

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check, ExternalLink, RefreshCw, Plus, Square, Trash2, Globe } from 'lucide-react'
import { api } from '@/lib/api'
import type { TunnelEntry, TunnelProvider, TunnelStatus } from '@/types'

// @group Utilities > Styles : Shared style tokens
const card: React.CSSProperties = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '16px 20px',
  marginBottom: 12,
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  background: 'var(--color-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-foreground)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
}

const btnPrimary: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}

// @group Utilities > TunnelsPage : Status badge colour
function statusColor(s: TunnelStatus): string {
  switch (s) {
    case 'active':   return 'var(--color-status-running)'
    case 'starting': return 'var(--color-status-sleeping)'
    case 'failed':   return 'var(--color-status-crashed)'
    case 'stopped':  return 'var(--color-muted-foreground)'
  }
}

// @group Utilities > TunnelsPage : Provider display name + colour
function providerLabel(p: TunnelProvider): { name: string; color: string } {
  switch (p) {
    case 'cloudflare': return { name: 'Cloudflare', color: '#f48120' }
    case 'ngrok':      return { name: 'ngrok',      color: '#1f2d3d' }
    case 'custom':     return { name: 'Custom',     color: 'var(--color-muted-foreground)' }
  }
}

// @group Utilities > TunnelsPage : Copy-to-clipboard button
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
      title="Copy URL"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, color: copied ? 'var(--color-status-running)' : 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center' }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

// @group BusinessLogic > TunnelsPage : Single tunnel row
function TunnelRow({ tunnel, onStop, onRemove }: { tunnel: TunnelEntry; onStop: () => void; onRemove: () => void }) {
  const prov = providerLabel(tunnel.provider)
  const isLive = tunnel.status === 'active' || tunnel.status === 'starting'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0',
      borderBottom: '1px solid var(--color-border)',
    }}>
      {/* Provider badge */}
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        padding: '2px 7px', borderRadius: 10,
        background: prov.color + '22', color: prov.color,
        flexShrink: 0,
      }}>{prov.name}</span>

      {/* Port */}
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', flexShrink: 0, minWidth: 48 }}>
        :{tunnel.port}
      </span>

      {/* Process name */}
      {tunnel.process_name && (
        <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tunnel.process_name}
        </span>
      )}

      {/* Public URL or status */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {tunnel.public_url ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <a
              href={tunnel.public_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: 'var(--color-primary)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}
            >
              {tunnel.public_url}
            </a>
            <CopyBtn text={tunnel.public_url} />
            <a href={tunnel.public_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center' }}>
              <ExternalLink size={12} />
            </a>
          </div>
        ) : tunnel.error ? (
          <span style={{ fontSize: 12, color: 'var(--color-status-crashed)' }}>{tunnel.error}</span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', fontStyle: 'italic' }}>
            {tunnel.status === 'starting' ? 'Waiting for URL…' : '—'}
          </span>
        )}
      </div>

      {/* Status dot */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, color: statusColor(tunnel.status), flexShrink: 0,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(tunnel.status), display: 'inline-block' }} />
        {tunnel.status}
      </span>

      {/* Actions */}
      {isLive ? (
        <button
          onClick={onStop}
          title="Stop tunnel"
          style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, flexShrink: 0 }}
        >
          <Square size={11} /> Stop
        </button>
      ) : (
        <button
          onClick={onRemove}
          title="Remove"
          style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', color: 'var(--color-status-crashed)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, flexShrink: 0 }}
        >
          <Trash2 size={11} /> Remove
        </button>
      )}
    </div>
  )
}

// @group BusinessLogic > TunnelsPage : Inline form to create a new tunnel
function CreateForm({ defaultProvider, onCreated, onCancel }: {
  defaultProvider: TunnelProvider
  onCreated: () => void
  onCancel: () => void
}) {
  const [port, setPort]     = useState('')
  const [procName, setProcName] = useState('')
  const [provider, setProvider] = useState<TunnelProvider>(defaultProvider)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const portNum = parseInt(port, 10)
    if (!portNum || portNum < 1 || portNum > 65535) { setError('Enter a valid port (1–65535)'); return }
    setBusy(true); setError(null)
    try {
      const res = await api.createTunnel({ port: portNum, process_name: procName || null, provider })
      if (res.error) { setError(res.error); return }
      onCreated()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create tunnel')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ ...card, marginBottom: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase', marginBottom: 14, marginTop: 0 }}>
        New Tunnel
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 120px' }}>
          <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>Port *</span>
          <input
            type="number" min={1} max={65535} placeholder="3000"
            value={port} onChange={e => setPort(e.target.value)}
            style={{ ...inputStyle, width: 120 }}
            autoFocus
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 160px' }}>
          <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>Process name (optional)</span>
          <input
            type="text" placeholder="my-app"
            value={procName} onChange={e => setProcName(e.target.value)}
            style={{ ...inputStyle, width: 160 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>Provider</span>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value as TunnelProvider)}
            style={{ ...inputStyle, width: 140 }}
          >
            <option value="cloudflare">Cloudflare</option>
            <option value="ngrok">ngrok</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <div style={{ display: 'flex', gap: 8, paddingBottom: 1 }}>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={onCancel} style={{ padding: '7px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', color: 'var(--color-foreground)' }}>
            Cancel
          </button>
        </div>
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--color-status-crashed)', marginTop: 10, marginBottom: 0 }}>{error}</p>}
    </form>
  )
}

// @group BusinessLogic > TunnelsPage : Main page component
export default function TunnelsPage() {
  const [tunnels, setTunnels] = useState<TunnelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [defaultProvider, setDefaultProvider] = useState<TunnelProvider>('cloudflare')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const data = await api.getTunnels()
      setTunnels(data.tunnels ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tunnels')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load default provider from settings
  useEffect(() => {
    api.getTunnelSettings().then(s => setDefaultProvider(s.provider)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Poll while any tunnel is in "starting" state
  useEffect(() => {
    const hasStarting = tunnels.some(t => t.status === 'starting')
    if (hasStarting && !pollRef.current) {
      pollRef.current = setInterval(() => load(true), 2000)
    } else if (!hasStarting && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [tunnels, load])

  async function handleStop(id: string) {
    await api.stopTunnel(id).catch(() => {})
    load(true)
  }

  async function handleRemove(id: string) {
    await api.removeTunnel(id).catch(() => {})
    load(true)
  }

  const activeTunnels  = tunnels.filter(t => t.status === 'active' || t.status === 'starting')
  const inactiveTunnels = tunnels.filter(t => t.status === 'stopped' || t.status === 'failed')

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860, fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Globe size={18} style={{ color: 'var(--color-primary)' }} />
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--color-foreground)' }}>Tunnels</h1>
          {activeTunnels.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--color-status-running)', color: '#fff', borderRadius: 10, padding: '1px 8px' }}>
              {activeTunnels.length} active
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => load()}
            title="Refresh"
            style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center' }}
          >
            <RefreshCw size={13} />
          </button>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              style={{ ...btnPrimary, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={14} /> New Tunnel
            </button>
          )}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginTop: 0, marginBottom: 20 }}>
        Expose any local port publicly via Cloudflare, ngrok, or a custom tool.
        Configure providers in <strong>Settings → Tunnels</strong>.
      </p>

      {/* Create form */}
      {showForm && (
        <CreateForm
          defaultProvider={defaultProvider}
          onCreated={() => { setShowForm(false); load(true) }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Error */}
      {error && (
        <div style={{ ...card, color: 'var(--color-status-crashed)', fontSize: 13 }}>{error}</div>
      )}

      {/* Loading skeleton */}
      {loading && !tunnels.length && (
        <div style={{ ...card, color: 'var(--color-muted-foreground)', fontSize: 13 }}>Loading…</div>
      )}

      {/* Active tunnels */}
      {activeTunnels.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase', marginBottom: 4 }}>Active</p>
          <div style={card}>
            {activeTunnels.map(t => (
              <TunnelRow
                key={t.id}
                tunnel={t}
                onStop={() => handleStop(t.id)}
                onRemove={() => handleRemove(t.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Inactive tunnels */}
      {inactiveTunnels.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase', marginBottom: 4 }}>Stopped / Failed</p>
          <div style={card}>
            {inactiveTunnels.map(t => (
              <TunnelRow
                key={t.id}
                tunnel={t}
                onStop={() => handleStop(t.id)}
                onRemove={() => handleRemove(t.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !error && tunnels.length === 0 && !showForm && (
        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
          <Globe size={28} style={{ color: 'var(--color-border)', marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: 'var(--color-muted-foreground)', margin: '0 0 16px' }}>
            No tunnels yet. Click <strong>New Tunnel</strong> to expose a local port publicly.
          </p>
          <button onClick={() => setShowForm(true)} style={btnPrimary}>
            New Tunnel
          </button>
        </div>
      )}
    </div>
  )
}
