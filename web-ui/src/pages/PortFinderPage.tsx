// @group BusinessLogic : Port Finder page — lists all open TCP/UDP ports grouped by port number

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search, X, XCircle, Globe } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'

// @group Types > Ports : Port entry returned by GET /api/v1/ports
interface PortEntry {
  port: number
  protocol: string
  local_address: string
  remote_address: string
  state: string
  pid: number | null
  process_name: string | null
}

// @group Utilities > Ports : Fetch full port list from the daemon
async function fetchPorts(): Promise<PortEntry[]> {
  const data = await api.getPorts()
  return data.ports ?? []
}

// @group Utilities > Ports : Kill a process by PID
async function killPid(pid: number): Promise<{ success: boolean; error?: string }> {
  return api.killPort(pid)
}

// @group Utilities > Ports : Returns color for connection state label
function stateColor(state: string): string {
  switch (state.toUpperCase()) {
    case 'LISTENING':   return 'var(--color-status-running)'
    case 'ESTABLISHED': return 'var(--color-status-sleeping)'
    case 'TIME_WAIT':
    case 'CLOSE_WAIT':
    case 'FIN_WAIT_2':  return 'var(--color-status-crashed)'
    default:            return 'var(--color-muted-foreground)'
  }
}

// @group Utilities > Ports : Detect whether a local_address is IPv6
function isIPv6(addr: string): boolean {
  return addr.startsWith('[') || (addr.match(/:/g) ?? []).length >= 2
}

// @group BusinessLogic > PortFinderPage : Main page component
export default function PortFinderPage() {
  const [ports, setPorts]           = useState<PortEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const [protoFilter, setProto]     = useState<'ALL' | 'TCP' | 'UDP'>('ALL')
  const [stateFilter, setState]     = useState<'ALL' | 'LISTENING' | 'ESTABLISHED'>('ALL')
  const [procFilter, setProcFilter] = useState<string>('ALL')
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  // @group BusinessLogic > Kill : pid being confirmed for kill; pid being actively killed
  const [confirmingPid, setConfirmingPid] = useState<number | null>(null)
  const [killingPid, setKillingPid]       = useState<number | null>(null)
  const [killError, setKillError]         = useState<{ pid: number; msg: string } | null>(null)
  // @group BusinessLogic > Tunnel : port being tunnelled and brief success feedback
  const [tunnelingPort, setTunnelingPort]   = useState<number | null>(null)
  const [tunneledPort, setTunneledPort]     = useState<number | null>(null)
  const navigate = useNavigate()
  // @group BusinessLogic > Grouping : Set of port numbers whose groups are expanded
  const [openPorts, setOpenPorts] = useState<Set<number>>(new Set())
  const lastLoadRef = useRef<number>(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setConfirmingPid(null)
    setKillError(null)
    try {
      const data = await fetchPorts()
      setPorts(data)
      lastLoadRef.current = Date.now()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load ports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // @group BusinessLogic > Kill : Confirm → kill → refresh
  async function handleKill(pid: number) {
    setKillingPid(pid)
    setKillError(null)
    setConfirmingPid(null)
    try {
      const result = await killPid(pid)
      if (result.success) {
        await new Promise(r => setTimeout(r, 400))
        await load()
      } else {
        setKillError({ pid, msg: result.error ?? 'Kill failed' })
      }
    } catch {
      setKillError({ pid, msg: 'Network error' })
    } finally {
      setKillingPid(null)
    }
  }

  // @group BusinessLogic > Tunnel : Create a tunnel for a port and navigate to Tunnels page
  async function handleTunnel(port: number, processName: string | null) {
    setTunnelingPort(port)
    try {
      await api.createTunnel({ port, process_name: processName ?? null })
      setTunneledPort(port)
      setTimeout(() => setTunneledPort(null), 2000)
      navigate('/tunnels')
    } catch {
      // silently ignore — the Tunnels page will show the error
    } finally {
      setTunnelingPort(null)
    }
  }

  // @group BusinessLogic > Filtering : Sorted unique process names for the dropdown
  const processNames = useMemo(() => {
    const names = ports
      .map(p => p.process_name)
      .filter((n): n is string => n !== null && n.length > 0)
    return ['ALL', ...new Set(names)].sort((a, b) => a === 'ALL' ? -1 : a.localeCompare(b))
  }, [ports])

  // @group BusinessLogic > Filtering : Apply search + protocol + state + process filters
  const filtered = ports.filter(p => {
    if (protoFilter !== 'ALL' && p.protocol !== protoFilter) return false
    if (stateFilter !== 'ALL' && p.state.toUpperCase() !== stateFilter) return false
    if (procFilter !== 'ALL' && (p.process_name ?? '') !== procFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        String(p.port).includes(q) ||
        (p.process_name ?? '').toLowerCase().includes(q) ||
        p.local_address.toLowerCase().includes(q) ||
        p.state.toLowerCase().includes(q)
      )
    }
    return true
  })

  // @group BusinessLogic > Grouping : Group filtered ports by port number, split by IP version
  const grouped = useMemo(() => {
    const map = new Map<number, { ipv4: PortEntry[]; ipv6: PortEntry[] }>()
    for (const entry of filtered) {
      if (!map.has(entry.port)) map.set(entry.port, { ipv4: [], ipv6: [] })
      const g = map.get(entry.port)!
      if (isIPv6(entry.local_address)) g.ipv6.push(entry)
      else g.ipv4.push(entry)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [filtered])


  function togglePort(port: number) {
    setOpenPorts(prev => {
      const next = new Set(prev)
      if (next.has(port)) next.delete(port)
      else next.add(port)
      return next
    })
  }

  const isKillable = (pid: number | null): pid is number => pid !== null && pid > 0

  const lastLoad = lastLoadRef.current
    ? new Date(lastLoadRef.current).toLocaleTimeString()
    : '—'

  // @group Utilities > Styles : Shared sticky table header cell
  const Th = ({ children, right, width }: { children: React.ReactNode; right?: boolean; width?: number }) => (
    <th style={{
      padding: '8px 12px', textAlign: right ? 'right' : 'left',
      fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
      color: 'var(--color-muted-foreground)', textTransform: 'uppercase',
      borderBottom: '1px solid var(--color-border)',
      whiteSpace: 'nowrap', background: 'var(--color-card)',
      position: 'sticky', top: 0, zIndex: 1,
      width: width ? width : undefined,
    }}>
      {children}
    </th>
  )

  const Td = ({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) => (
    <td style={{
      padding: '7px 12px 7px 16px', fontSize: 12,
      textAlign: right ? 'right' : 'left',
      fontFamily: mono ? 'monospace' : undefined,
      color: 'var(--color-foreground)',
      borderBottom: '1px solid var(--color-border)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
    </td>
  )

  // @group BusinessLogic > PortRow : Single port entry row inside a group
  function PortRow({ entry, rowKey }: { entry: PortEntry; rowKey: string }) {
    const killable   = isKillable(entry.pid)
    const confirming = confirmingPid === entry.pid
    const killing    = killingPid === entry.pid
    const hasError   = killError?.pid === entry.pid

    return (
      <tr
        onMouseEnter={() => setHoveredRow(rowKey)}
        onMouseLeave={() => setHoveredRow(null)}
        style={{ background: hoveredRow === rowKey ? 'var(--color-accent)' : 'transparent' }}
      >
        <Td mono>
          <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{entry.port}</span>
        </Td>

        <Td>
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 3,
            fontSize: 10, fontWeight: 600,
            background: entry.protocol === 'TCP'
              ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)'
              : 'color-mix(in srgb, var(--color-status-sleeping) 15%, transparent)',
            color: entry.protocol === 'TCP'
              ? 'var(--color-primary)'
              : 'var(--color-status-sleeping)',
          }}>
            {entry.protocol}
          </span>
        </Td>

        <Td>
          {entry.state
            ? <span style={{ color: stateColor(entry.state), fontSize: 11, fontWeight: 500 }}>{entry.state}</span>
            : <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11 }}>—</span>
          }
        </Td>

        <Td mono><span style={{ opacity: 0.85 }}>{entry.local_address}</span></Td>

        <Td mono>
          <span style={{ color: 'var(--color-muted-foreground)' }}>
            {entry.remote_address || '—'}
          </span>
        </Td>

        <Td right mono>
          <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11 }}>
            {entry.pid ?? '—'}
          </span>
        </Td>

        <Td>
          {entry.process_name
            ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--color-status-running)', flexShrink: 0,
                }} />
                {entry.process_name}
              </span>
            )
            : <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11 }}>Idle</span>
          }
        </Td>

        {/* @group BusinessLogic > Kill : Actions cell */}
        <td style={{ padding: '5px 12px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
          {/* @group BusinessLogic > Tunnel : Quick-create tunnel button (LISTENING TCP only) */}
          {entry.state.toUpperCase() === 'LISTENING' && entry.protocol === 'TCP' && (
            <button
              onClick={() => handleTunnel(entry.port, entry.process_name)}
              disabled={tunnelingPort === entry.port}
              title={`Tunnel port ${entry.port} publicly`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', fontSize: 10, fontWeight: 500,
                background: tunneledPort === entry.port
                  ? 'color-mix(in srgb, var(--color-status-running) 15%, transparent)'
                  : 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                color: tunneledPort === entry.port ? 'var(--color-status-running)' : 'var(--color-primary)',
                border: `1px solid ${tunneledPort === entry.port ? 'color-mix(in srgb, var(--color-status-running) 30%, transparent)' : 'color-mix(in srgb, var(--color-primary) 25%, transparent)'}`,
                borderRadius: 4, cursor: 'pointer', marginRight: 6,
                opacity: tunnelingPort === entry.port ? 0.5 : 1,
              }}
            >
              <Globe size={10} />
              {tunnelingPort === entry.port ? '…' : tunneledPort === entry.port ? 'Done' : 'Tunnel'}
            </button>
          )}

          {hasError && (
            <span style={{ fontSize: 10, color: 'var(--color-destructive)', display: 'flex', alignItems: 'center', gap: 3 }}>
              ⚠ {killError!.msg}
              <button onClick={() => setKillError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', lineHeight: 1 }}>
                <X size={9} />
              </button>
            </span>
          )}

          {!hasError && killable && (
            confirming ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap' }}>Kill?</span>
                <button
                  onClick={() => handleKill(entry.pid!)}
                  disabled={killing}
                  style={{ padding: '2px 7px', fontSize: 10, fontWeight: 600, background: 'var(--color-destructive)', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', opacity: killing ? 0.5 : 1 }}
                >
                  {killing ? '…' : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirmingPid(null)}
                  disabled={killing}
                  style={{ padding: '2px 7px', fontSize: 10, fontWeight: 500, background: 'var(--color-secondary)', color: 'var(--color-foreground)', border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer' }}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setKillError(null); setConfirmingPid(entry.pid!) }}
                title={`Kill ${entry.process_name ?? 'process'} (PID ${entry.pid})`}
                style={{
                  width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'color-mix(in srgb, var(--color-destructive) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent)',
                  borderRadius: 4, cursor: 'pointer', color: 'var(--color-destructive)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-destructive)'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--color-destructive) 12%, transparent)'; e.currentTarget.style.color = 'var(--color-destructive)' }}
              >
                <XCircle size={13} />
              </button>
            )
          )}

          {!hasError && !killable && (
            <span style={{ color: 'var(--color-muted-foreground)', fontSize: 10, opacity: 0.4 }}>—</span>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px 12px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-foreground)' }}>
            Port Finder
          </h1>
          <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2 }}>
            {loading ? 'Loading…' : error ? error : `${filtered.length} entries · ${grouped.length} groups · updated ${lastLoad}`}
          </div>
        </div>

        {/* Expand / Collapse All */}
        {!loading && grouped.length > 0 && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setOpenPorts(new Set(grouped.map(([p]) => p)))}
              style={{
                padding: '4px 9px', fontSize: 11, fontWeight: 500,
                background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
                borderRadius: 4, cursor: 'pointer', color: 'var(--color-foreground)',
              }}
            >
              Expand All
            </button>
            <button
              onClick={() => setOpenPorts(new Set())}
              style={{
                padding: '4px 9px', fontSize: 11, fontWeight: 500,
                background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
                borderRadius: 4, cursor: 'pointer', color: 'var(--color-foreground)',
              }}
            >
              Collapse All
            </button>
          </div>
        )}

        <button
          onClick={load}
          disabled={loading}
          title="Refresh"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', fontSize: 12, fontWeight: 500,
            background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
            borderRadius: 5, cursor: loading ? 'not-allowed' : 'pointer',
            color: 'var(--color-foreground)', opacity: loading ? 0.5 : 1,
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{
        padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-card)',
      }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
          <Search size={12} style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--color-muted-foreground)', pointerEvents: 'none',
          }} />
          <input
            type="text"
            placeholder="Filter by port, process or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '5px 28px 5px 26px', fontSize: 12,
              background: 'var(--color-input)', border: '1px solid var(--color-border)',
              borderRadius: 5, color: 'var(--color-foreground)', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'var(--color-muted-foreground)', display: 'flex',
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 1, border: '1px solid var(--color-border)', borderRadius: 5, overflow: 'hidden' }}>
          {(['ALL', 'TCP', 'UDP'] as const).map(p => (
            <button key={p} onClick={() => setProto(p)} style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: protoFilter === p ? 'var(--color-primary)' : 'var(--color-secondary)',
              color: protoFilter === p ? '#fff' : 'var(--color-foreground)',
            }}>
              {p}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 1, border: '1px solid var(--color-border)', borderRadius: 5, overflow: 'hidden' }}>
          {(['ALL', 'LISTENING', 'ESTABLISHED'] as const).map(s => (
            <button key={s} onClick={() => setState(s)} style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: stateFilter === s ? 'var(--color-primary)' : 'var(--color-secondary)',
              color: stateFilter === s ? '#fff' : 'var(--color-foreground)',
            }}>
              {s === 'ALL' ? 'All States' : s === 'LISTENING' ? 'Listening' : 'Established'}
            </button>
          ))}
        </div>

        {/* Process name dropdown */}
        {processNames.length > 1 && (
          <select
            value={procFilter}
            onChange={e => setProcFilter(e.target.value)}
            style={{
              padding: '5px 8px', fontSize: 11, fontWeight: 500,
              background: procFilter !== 'ALL' ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-secondary))' : 'var(--color-secondary)',
              border: `1px solid ${procFilter !== 'ALL' ? 'var(--color-primary)' : 'var(--color-border)'}`,
              borderRadius: 5, cursor: 'pointer',
              color: procFilter !== 'ALL' ? 'var(--color-primary)' : 'var(--color-foreground)',
              outline: 'none', maxWidth: 160,
            }}
          >
            {processNames.map(n => (
              <option key={n} value={n}>{n === 'ALL' ? 'All Processes' : n}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {error && !loading && (
          <div style={{ padding: '24px 20px', color: 'var(--color-destructive)', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {!error && (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <Th width={64}>Port</Th>
                <Th width={64}>Protocol</Th>
                <Th width={108}>State</Th>
                <Th width={180}>Local Address</Th>
                <Th width={180}>Remote Address</Th>
                <Th width={64} right>PID</Th>
                <Th>Process</Th>
                <Th width={110}>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} style={{
                    padding: '32px 20px', textAlign: 'center',
                    fontSize: 13, color: 'var(--color-muted-foreground)',
                  }}>
                    {ports.length === 0 ? 'No ports found' : 'No matching ports'}
                  </td>
                </tr>
              )}

              {grouped.map(([port, { ipv4, ipv6 }]) => {
                const isOpen   = openPorts.has(port)
                const all      = [...ipv4, ...ipv6]
                const procName = all.find(e => e.process_name)?.process_name ?? null
                const protos   = [...new Set(all.map(e => e.protocol))].join(' · ')
                const states   = [...new Set(all.map(e => e.state))].filter(Boolean)
                const hasBoth  = ipv4.length > 0 && ipv6.length > 0

                return (
                  <Fragment key={port}>
                    {/* @group BusinessLogic > PortGroup : Collapsible port group header row */}
                    <tr
                      onClick={() => togglePort(port)}
                      style={{ cursor: 'pointer', background: 'color-mix(in srgb, var(--color-primary) 5%, var(--color-card))' }}
                    >
                      <td colSpan={8} style={{
                        padding: '7px 14px',
                        borderTop: '2px solid var(--color-border)',
                        borderBottom: '1px solid var(--color-border)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {/* Chevron */}
                          <span style={{
                            fontSize: 9, flexShrink: 0, color: 'var(--color-muted-foreground)',
                            display: 'inline-block',
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.15s',
                          }}>▸</span>

                          {/* Port number */}
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)', fontFamily: 'monospace', minWidth: 52 }}>
                            :{port}
                          </span>

                          {/* Protocol */}
                          <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', fontWeight: 500 }}>
                            {protos}
                          </span>

                          {/* IPv4 / IPv6 badges — only shown if both present */}
                          {hasBoth && (
                            <>
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                background: 'color-mix(in srgb, var(--color-status-sleeping) 15%, transparent)',
                                color: 'var(--color-status-sleeping)',
                              }}>IPv4</span>
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                background: 'color-mix(in srgb, var(--color-status-running) 15%, transparent)',
                                color: 'var(--color-status-running)',
                              }}>IPv6</span>
                            </>
                          )}
                          {!hasBoth && ipv6.length > 0 && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                              background: 'color-mix(in srgb, var(--color-status-running) 15%, transparent)',
                              color: 'var(--color-status-running)',
                            }}>IPv6</span>
                          )}

                          {/* States */}
                          {states.map(s => (
                            <span key={s} style={{ fontSize: 10, color: stateColor(s), fontWeight: 500 }}>{s}</span>
                          ))}

                          {/* Process name */}
                          {procName && (
                            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-foreground)', display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 2 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-status-running)', display: 'inline-block', flexShrink: 0 }} />
                              {procName}
                            </span>
                          )}

                          {/* Entry count */}
                          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-muted-foreground)', opacity: 0.6 }}>
                            {all.length} {all.length === 1 ? 'entry' : 'entries'}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* @group BusinessLogic > PortGroup > IPv4 : IPv4 sub-section */}
                    {isOpen && ipv4.length > 0 && (
                      <>
                        {hasBoth && (
                          <tr>
                            <td colSpan={8} style={{
                              padding: '3px 14px 3px 40px',
                              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                              color: 'var(--color-status-sleeping)',
                              background: 'color-mix(in srgb, var(--color-status-sleeping) 5%, transparent)',
                              borderBottom: '1px solid var(--color-border)',
                            }}>
                              IPv4 · {ipv4.length} {ipv4.length === 1 ? 'entry' : 'entries'}
                            </td>
                          </tr>
                        )}
                        {ipv4.map((entry, i) => (
                          <PortRow key={`${port}-v4-${i}`} entry={entry} rowKey={`${port}-v4-${i}`} />
                        ))}
                      </>
                    )}

                    {/* @group BusinessLogic > PortGroup > IPv6 : IPv6 sub-section */}
                    {isOpen && ipv6.length > 0 && (
                      <>
                        {hasBoth && (
                          <tr>
                            <td colSpan={8} style={{
                              padding: '3px 14px 3px 40px',
                              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                              color: 'var(--color-status-running)',
                              background: 'color-mix(in srgb, var(--color-status-running) 5%, transparent)',
                              borderBottom: '1px solid var(--color-border)',
                            }}>
                              IPv6 · {ipv6.length} {ipv6.length === 1 ? 'entry' : 'entries'}
                            </td>
                          </tr>
                        )}
                        {ipv6.map((entry, i) => (
                          <PortRow key={`${port}-v6-${i}`} entry={entry} rowKey={`${port}-v6-${i}`} />
                        ))}
                      </>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
