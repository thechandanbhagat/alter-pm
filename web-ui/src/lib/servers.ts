// @group Configuration : Remote server store — manages local + remote alter daemon connections

// @group Types > Server : Connection mode for a remote server
export type ConnectionType = 'direct' | 'ssh'

// @group Types > Server : A registered alter-pm2 server (local or remote)
export interface RemoteServer {
  id: string
  name: string
  /** For direct: daemon host. For ssh: always '127.0.0.1' (local tunnel endpoint). */
  host: string
  /** For direct: daemon port. For ssh: local forwarded port (e.g. 3001). */
  port: number
  connectionType: ConnectionType
  // SSH-specific fields (only when connectionType === 'ssh')
  sshHost?: string          // remote machine hostname/IP
  sshPort?: number          // SSH server port (default 22)
  sshUser?: string          // SSH username
  sshKeyPath?: string       // path to private key, e.g. ~/.ssh/id_rsa (optional)
  remoteDaemonPort?: number // daemon port on the remote machine (default 2999)
}

const LOCAL_ID   = 'local'
// Active server ID stays in localStorage — it's needed before any API call can be made
const ACTIVE_KEY = 'alter_active_server'

// @group Configuration > Server : Built-in local server — always present, cannot be removed
export const LOCAL_SERVER: RemoteServer = {
  id: LOCAL_ID,
  name: 'Local',
  host: '127.0.0.1',
  port: 2999,
  connectionType: 'direct',
}

// @group Configuration > Server : Get the active server ID (defaults to 'local')
export function getActiveServerId(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? LOCAL_ID
}

// @group Configuration > Server : Set the active server ID
export function setActiveServerId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id)
}

// @group Configuration > Server : Resolve the active server object
export function getActiveServer(): RemoteServer {
  const id = getActiveServerId()
  if (id === LOCAL_ID) return LOCAL_SERVER
  // Remote servers are loaded async via useRemoteServers — fall back to local if not yet loaded
  const cached = _remoteServerCache.find(s => s.id === id)
  return cached ?? LOCAL_SERVER
}

// @group Configuration > Server : In-memory cache populated by useRemoteServers hook
export let _remoteServerCache: RemoteServer[] = []
export function _setRemoteServerCache(servers: RemoteServer[]): void {
  _remoteServerCache = servers
}

// @group Configuration > Server : Build the API base URL for a server
export function serverBaseUrl(server: RemoteServer): string {
  if (server.id === LOCAL_ID) return '/api/v1'
  if (server.connectionType === 'ssh') {
    return `http://127.0.0.1:${server.port}/api/v1`
  }
  return `http://${server.host}:${server.port}/api/v1`
}

// @group Configuration > Server : localStorage key for a server's session token
export function serverTokenKey(server: RemoteServer): string {
  return server.id === LOCAL_ID ? 'alter_session_token' : `alter_session_${server.id}`
}

// @group Utilities > Server : Build the SSH tunnel command string for an SSH-type server
export function sshTunnelCommand(server: RemoteServer): string {
  const localPort = server.port
  const remotePort = server.remoteDaemonPort ?? 2999
  const sshHost = server.sshHost ?? ''
  const sshPort = server.sshPort ?? 22
  const user = server.sshUser ? `${server.sshUser}@` : ''
  const keyFlag = server.sshKeyPath ? ` -i "${server.sshKeyPath}"` : ''
  const portFlag = sshPort !== 22 ? ` -p ${sshPort}` : ''
  return `ssh -L ${localPort}:localhost:${remotePort}${keyFlag}${portFlag} -N ${user}${sshHost}`
}

// @group Utilities > Server : API helpers for remote-server persistence (called by useRemoteServers)
import { getSessionToken } from '@/lib/auth'

function localApiBase(): string { return '/api/v1' }
function authHdr(): Record<string, string> {
  const t = getSessionToken(); return t ? { Authorization: `Bearer ${t}` } : {}
}

export interface RemoteServerStore { servers: RemoteServer[]; active_id?: string }

export async function fetchRemoteServers(): Promise<RemoteServerStore> {
  try {
    const r = await fetch(`${localApiBase()}/system/remote-servers`, { headers: authHdr() })
    if (!r.ok) return { servers: [] }
    return await r.json() as RemoteServerStore
  } catch { return { servers: [] } }
}

export async function persistRemoteServers(store: RemoteServerStore): Promise<void> {
  try {
    await fetch(`${localApiBase()}/system/remote-servers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHdr() },
      body: JSON.stringify(store),
    })
  } catch { /* non-critical */ }
}
