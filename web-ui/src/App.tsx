// @group BusinessLogic : Root app — layout shell + React Router

import { useEffect, useRef, useState } from 'react'
import LoginPage from '@/pages/LoginPage'
import { isAuthenticated, setSessionToken } from '@/lib/auth'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { LayoutGrid, Plus, Clock, ScrollText, Settings, Bell, Bot, Network, type LucideIcon } from 'lucide-react'
import { useDaemonHealth } from '@/hooks/useDaemonHealth'
import { useProcesses } from '@/hooks/useProcesses'
import { useSettings } from '@/hooks/useSettings'
import { useDialog } from '@/hooks/useDialog'
import { useNotificationTray } from '@/hooks/useNotificationTray'
import { Dialog } from '@/components/Dialog'
import { NotificationTray } from '@/components/NotificationTray'
import { AiPanel } from '@/components/AiPanel'
import { formatUptime, statusColor } from '@/lib/utils'
import { api } from '@/lib/api'
import ProcessesPage from '@/pages/ProcessesPage'
import CronJobsPage from '@/pages/CronJobsPage'
import CreateCronJobPage from '@/pages/CreateCronJobPage'
import StartPage from '@/pages/StartPage'
import EditPage from '@/pages/EditPage'
import ProcessDetailPage from '@/pages/ProcessDetailPage'
import SettingsPage from '@/pages/SettingsPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import LogLibraryPage from '@/pages/LogLibraryPage'
import NotificationsPage from '@/pages/NotificationsPage'
import PortFinderPage from '@/pages/PortFinderPage'
import type { ProcessInfo } from '@/types'
import type { AppSettings } from '@/lib/settings'

// @group BusinessLogic > NamespaceRoute : Stable module-level wrapper — reads :name param and filters processes
function NamespaceRoute({ processes, reload, settings }: { processes: ProcessInfo[]; reload: () => void; settings: AppSettings }) {
  const { name } = useParams<{ name: string }>()
  return <ProcessesPage processes={processes} reload={reload} settings={settings} namespaceFilter={name} />
}

// @group BusinessLogic > Layout : Sidebar + content shell
function Layout({ onLock }: { onLock: () => void }) {
  const { settings, updateSettings, resetToDefaults } = useSettings()
  const { processes, error, reload } = useProcesses(settings.autoRefresh, settings.processRefreshInterval)
  const health = useDaemonHealth(settings.healthRefreshInterval)
  const navigate = useNavigate()
  const location = useLocation()
  const { dialogState, confirm, alert, handleConfirm, handleCancel } = useDialog()

  // @group BusinessLogic > NotificationTray : In-app activity tray
  const { notifications, unreadCount, markAllRead, clearAll, dismiss } = useNotificationTray(processes)
  const [trayOpen, setTrayOpen] = useState(false)

  const openTray = () => { setTrayOpen(true); markAllRead() }
  const closeTray = () => setTrayOpen(false)

  // @group BusinessLogic > AiPanel : AI assistant panel state
  const [aiOpen, setAiOpen] = useState(false)
  const [aiProcessId, setAiProcessId] = useState<string | null>(null)
  const [aiProcessName, setAiProcessName] = useState<string | null>(null)

  const openAi = (processId?: string, processName?: string) => {
    setAiProcessId(processId ?? null)
    setAiProcessName(processName ?? null)
    setAiOpen(true)
  }
  const closeAi = () => setAiOpen(false)

  const connected = error === null

  // @group BusinessLogic > SidebarList : Active processes only (running/watching/sleeping/starting)
  const activeProcesses = processes.filter(p =>
    p.status === 'running' || p.status === 'watching' || p.status === 'sleeping' || p.status === 'starting'
  ).sort((a, b) => a.name.localeCompare(b.name))

  async function handleSave() {
    await api.saveState().catch(() => {})
    await alert('State saved', 'The process state has been persisted to disk.')
  }

  async function handleShutdown() {
    if (settings.confirmBeforeShutdown) {
      const ok = await confirm(
        'Shutdown daemon?',
        'The alter daemon will stop. Managed processes will keep running.'
      )
      if (!ok) return
    }
    await api.shutdownDaemon().catch(() => {})
  }

  const isProcessActive = location.pathname === '/processes' || location.pathname.startsWith('/processes/') || location.pathname.startsWith('/namespace/')
  const isCronActive    = location.pathname === '/cron-jobs' || location.pathname === '/cron-jobs/new'
  const isPortsActive   = location.pathname === '/ports'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Global dialog — rendered at root so it overlays everything */}
      <Dialog
        open={dialogState.open}
        title={dialogState.title}
        message={dialogState.message}
        variant={dialogState.variant}
        confirmLabel={dialogState.confirmLabel}
        cancelLabel={dialogState.cancelLabel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* Activity tray — slides in over main content */}
      <NotificationTray
        open={trayOpen}
        notifications={notifications}
        onClose={closeTray}
        onMarkAllRead={markAllRead}
        onClearAll={clearAll}
        onDismiss={dismiss}
      />

      {/* AI assistant panel — slides in from right */}
      <AiPanel
        open={aiOpen}
        processId={aiProcessId}
        processName={aiProcessName}
        onClose={closeAi}
      />

      {/* Sidebar */}
      <aside style={{
        width: 220, minWidth: 220,
        background: 'var(--color-card)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column',
        height: '100vh', overflow: 'hidden',
        position: 'relative', zIndex: 201,
      }}>
        {/* Logo */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'baseline', gap: 2, textDecoration: 'none' }}>
            <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.5px', color: 'var(--color-primary)' }}>alter</span>
            <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', fontWeight: 500 }}>pm</span>
          </Link>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>
              {health && (
                <>v{health.version} · {formatUptime(health.uptime_secs)}</>
              )}
            </span>
            <span className='px-2' style={{
              fontSize: 16, fontWeight: 600,
              color: connected ? 'var(--color-status-running)' : 'var(--color-status-crashed)',
            }}>●</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          {/* Processes row with inline + button */}
          <NavRowWithAdd
            to="/processes"
            icon={LayoutGrid}
            label="Processes"
            active={isProcessActive}
            onAdd={() => navigate('/start')}
            addTitle="Start new process"
          />

          {/* Cron Jobs row with inline + button */}
          <NavRowWithAdd
            to="/cron-jobs"
            icon={Clock}
            label="Cron Jobs"
            active={isCronActive}
            onAdd={() => navigate('/cron-jobs/new')}
            addTitle="New cron job"
          />

          <div style={{ height: 4 }} />
          <NavBtn to="/logs" icon={ScrollText} label="Log Library" active={location.pathname === '/logs'} />

          {/* Tools section */}
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            color: 'var(--color-muted-foreground)', padding: '8px 16px 2px',
            textTransform: 'uppercase', opacity: 0.6,
          }}>
            Tools
          </div>
          <NavBtn to="/ports" icon={Network} label="Port Finder" active={isPortsActive} />

          <div style={{ height: 4 }} />
          {/* @group BusinessLogic > BellBtn : Activity tray toggle — not a nav link */}
          <BellBtn unreadCount={unreadCount} onClick={openTray} />

          {/* @group BusinessLogic > AiBtn : AI assistant panel toggle */}
          <AiBtn onClick={() => {
            // Pass the current process id when on a process detail page
            const match = location.pathname.match(/^\/processes\/([^/]+)$/)
            if (match) {
              const proc = processes.find(p => p.id === match[1] || p.name === match[1])
              openAi(match[1], proc?.name)
            } else {
              openAi()
            }
          }} />
        </nav>

        {/* Active processes list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)', padding: '4px 16px 6px', letterSpacing: '0.08em' }}>
            ACTIVE {activeProcesses.length > 0 && <span style={{ fontWeight: 400, opacity: 0.7 }}>({activeProcesses.length})</span>}
          </div>
          {activeProcesses.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--color-muted-foreground)', padding: '4px 16px' }}>No active processes</div>
            : activeProcesses.map(p => <SidebarProc key={p.id} p={p} onNavigate={() => navigate(`/processes/${p.id}`)} />)
          }
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <NavBtn to="/settings" icon={Settings} label="Settings" active={location.pathname === '/settings'} />
          <div style={{ display: 'flex', gap: 6 }}>
            <SidebarBtn label="Save" onClick={handleSave} />
            <SidebarBtn label="Lock" onClick={onLock} />
            <SidebarBtn label="Shutdown" onClick={handleShutdown} danger />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<AnalyticsPage processes={processes} settings={settings} reload={reload} />} />
          <Route path="/processes" element={<ProcessesPage processes={processes} reload={reload} settings={settings} />} />
          <Route path="/namespace/:name" element={<NamespaceRoute processes={processes} reload={reload} settings={settings} />} />
          <Route path="/start" element={<StartPage onDone={() => { reload(); navigate('/processes') }} settings={settings} />} />
          <Route path="/edit/:id" element={<EditPage onDone={() => { reload(); navigate('/processes') }} />} />
          <Route path="/processes/:id" element={<ProcessDetailPage reload={reload} settings={settings} />} />
          <Route path="/cron-jobs" element={<CronJobsPage processes={processes} reload={reload} settings={settings} />} />
          <Route path="/cron-jobs/new" element={<CreateCronJobPage onDone={() => { reload(); navigate('/cron-jobs') }} settings={settings} />} />
          <Route path="/logs" element={<LogLibraryPage processes={processes} reload={reload} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/ports" element={<PortFinderPage />} />
          <Route path="/settings" element={<SettingsPage settings={settings} onUpdate={updateSettings} onReset={resetToDefaults} />} />
        </Routes>
      </div>
    </div>
  )
}

// @group BusinessLogic > NavRowWithAdd : Sidebar nav link with inline + button on the right
function NavRowWithAdd({
  to, icon: Icon, label, active, onAdd, addTitle,
}: { to: string; icon: LucideIcon; label: string; active: boolean; onAdd: () => void; addTitle: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <Link to={to} style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 9,
        padding: '7px 16px', fontSize: 13,
        color: active ? 'var(--color-primary)' : 'var(--color-foreground)',
        textDecoration: 'none', fontWeight: active ? 600 : 500,
        background: active ? 'var(--color-accent)' : 'transparent',
        borderLeft: active ? '2px solid var(--color-primary)' : '2px solid transparent',
      }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-accent)' }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
      >
        <Icon size={14} />
        {label}
      </Link>
      {/* Inline + button */}
      <button
        onClick={onAdd}
        title={addTitle}
        style={{
          width: 28, flexShrink: 0, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--color-muted-foreground)', paddingRight: 8,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'var(--color-primary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'var(--color-muted-foreground)'
        }}
      >
        <Plus size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

// @group BusinessLogic > NavBtn : Sidebar navigation link with active highlight
function NavBtn({ to, icon: Icon, label, active }: { to: string; icon: LucideIcon; label: string; active: boolean }) {
  return (
    <Link to={to} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '7px 16px', fontSize: 13,
      color: active ? 'var(--color-primary)' : 'var(--color-foreground)',
      textDecoration: 'none', fontWeight: active ? 600 : 500,
      background: active ? 'var(--color-accent)' : 'transparent',
      borderLeft: active ? '2px solid var(--color-primary)' : '2px solid transparent',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-accent)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <Icon size={14} />
      {label}
    </Link>
  )
}

// @group BusinessLogic > BellBtn : Activity bell button with unread badge
function BellBtn({ unreadCount, onClick }: { unreadCount: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '7px 16px', fontSize: 13,
        color: 'var(--color-foreground)',
        background: 'transparent', border: 'none',
        borderLeft: '2px solid transparent',
        cursor: 'pointer', fontWeight: 500,
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Bell icon + unread badge */}
      <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
        <Bell size={14} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -5, right: -5,
            minWidth: 14, height: 14,
            borderRadius: 7,
            background: 'var(--color-destructive)',
            color: '#fff',
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px',
            lineHeight: 1,
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </span>
      Activity
    </button>
  )
}

// @group BusinessLogic > AiBtn : AI assistant sidebar button
function AiBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="AI Assistant (GitHub Copilot)"
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '7px 16px', fontSize: 13,
        color: 'var(--color-foreground)',
        background: 'transparent', border: 'none',
        borderLeft: '2px solid transparent',
        cursor: 'pointer', fontWeight: 500,
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <Bot size={14} style={{ flexShrink: 0 }} />
      AI Assistant
    </button>
  )
}

// @group BusinessLogic > SidebarProc : Process pill in sidebar — all processes, status-colored
function SidebarProc({ p, onNavigate }: { p: ProcessInfo; onNavigate: () => void }) {
  const isActive = p.status === 'running' || p.status === 'watching' || p.status === 'sleeping'
  const isCron   = !!p.cron
  return (
    <button
      onClick={onNavigate}
      title={`${p.name} — ${p.status}${isCron ? ' (cron)' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        width: '100%', padding: '4px 16px', background: 'transparent',
        border: 'none', cursor: 'pointer',
        color: isActive ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
        fontSize: 12, textAlign: 'left',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: statusColor(p.status), fontSize: 9, flexShrink: 0 }}>●</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {p.name}
      </span>
      {isCron && (
        <span style={{ fontSize: 9, color: 'var(--color-status-sleeping)', flexShrink: 0, opacity: 0.7 }}>⏰</span>
      )}
      {!isActive && (
        <span style={{ fontSize: 9, color: 'var(--color-muted-foreground)', flexShrink: 0, opacity: 0.6 }}>
          {p.status === 'crashed' ? '!' : p.status === 'stopped' ? '■' : ''}
        </span>
      )}
    </button>
  )
}

// @group BusinessLogic > SidebarBtn : Footer action buttons
function SidebarBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '5px 8px', fontSize: 11, fontWeight: 500,
      background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
      borderRadius: 5, cursor: 'pointer',
      color: danger ? 'var(--color-destructive)' : 'var(--color-foreground)',
    }}>
      {label}
    </button>
  )
}

// @group Authentication > LockScreen : Fullscreen lock overlay — PIN numpad or password field
function LockScreen({ pinConfigured, onUnlocked }: { pinConfigured: boolean; onUnlocked: () => void }) {
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // @group Authentication > LockScreen : Keyboard input for PIN numpad
  useEffect(() => {
    if (!pinConfigured) return
    function handleKey(e: KeyboardEvent) {
      if (loading) return
      if (e.key >= '0' && e.key <= '9') {
        pressDigit(e.key)
      } else if (e.key === 'Backspace') {
        setPin(p => p.slice(0, -1))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [pinConfigured, loading, pin]) // re-bind when pin/loading change so pressDigit has fresh closure

  async function unlockWithPin(digits: string) {
    setLoading(true)
    setError(null)
    try {
      const { session_token } = await api.authPinLogin(digits)
      setSessionToken(session_token)
      onUnlocked()
    } catch {
      setError('Incorrect PIN')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  async function unlockWithPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { session_token } = await api.authLogin(password)
      setSessionToken(session_token)
      onUnlocked()
    } catch {
      setError('Incorrect password')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  function pressDigit(d: string) {
    if (loading || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    if (next.length === 4 || next.length === 6) {
      // slight delay so user sees the dot filled before submit
      setTimeout(() => unlockWithPin(next), 80)
    }
  }

  const lockOverlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'var(--color-background)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 24,
  }

  return (
    <div style={lockOverlay}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 24, color: 'var(--color-primary)' }}>alter</span>
        <span style={{ fontSize: 13, color: 'var(--color-muted-foreground)', fontWeight: 500 }}>pm</span>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-muted-foreground)' }}>
          Screen locked
        </p>
      </div>

      {error && (
        <div style={{
          background: 'color-mix(in srgb, var(--color-destructive) 15%, transparent)',
          border: '1px solid var(--color-destructive)',
          borderRadius: 6, padding: '6px 14px',
          fontSize: 13, color: 'var(--color-destructive)',
        }}>
          {error}
        </div>
      )}

      {pinConfigured ? (
        /* PIN numpad */
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          {/* Dots */}
          <div style={{ display: 'flex', gap: 12 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{
                width: 12, height: 12, borderRadius: '50%',
                background: i < pin.length ? 'var(--color-primary)' : 'var(--color-border)',
                transition: 'background 0.15s',
                display: pin.length <= 4 && i >= 4 ? 'none' : 'block',
              }} />
            ))}
          </div>
          {/* Numpad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, idx) => (
              d === '' ? <div key={idx} /> :
              <button
                key={idx}
                onClick={() => d === '⌫' ? setPin(p => p.slice(0, -1)) : pressDigit(d)}
                disabled={loading}
                style={{
                  width: 64, height: 64, borderRadius: 32,
                  fontSize: d === '⌫' ? 20 : 22, fontWeight: 500,
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer', color: 'var(--color-foreground)',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>
            Enter your PIN to unlock
          </p>
        </div>
      ) : (
        /* Password field */
        <form onSubmit={unlockWithPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 300 }}>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              required
              style={{
                width: '100%', padding: '9px 36px 9px 12px',
                fontSize: 14, borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-card)',
                color: 'var(--color-foreground)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-muted-foreground)', padding: 0, display: 'flex',
              }}
              tabIndex={-1}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              padding: '9px 16px', fontSize: 13, fontWeight: 600,
              background: 'var(--color-primary)', color: 'var(--color-primary-foreground)',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            {loading ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      )}
    </div>
  )
}

// @group Authentication > AuthGuard : Login gate + lock screen + inactivity timer
function AuthGuard() {
  const [authed, setAuthed] = useState(isAuthenticated)
  const [locked, setLocked] = useState(false)
  const [lockConfig, setLockConfig] = useState<{ pinConfigured: boolean; lockTimeoutMins: number | null }>({
    pinConfigured: false,
    lockTimeoutMins: null,
  })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // @group Authentication > AuthGuard : Fetch lock config after authentication
  useEffect(() => {
    if (!authed) return
    function fetchConfig() {
      api.authStatus().then(s => {
        setLockConfig({
          pinConfigured: s.pin_configured ?? false,
          lockTimeoutMins: s.lock_timeout_mins ?? null,
        })
      }).catch(() => {})
    }
    fetchConfig()
    // Re-fetch when SettingsPage signals a change
    window.addEventListener('lock-config-updated', fetchConfig)
    return () => window.removeEventListener('lock-config-updated', fetchConfig)
  }, [authed])

  // @group Authentication > AuthGuard : Inactivity timer — lock after N minutes idle
  useEffect(() => {
    if (!authed || locked || !lockConfig.lockTimeoutMins) return
    const ms = lockConfig.lockTimeoutMins * 60 * 1000

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setLocked(true), ms)
    }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    resetTimer()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      events.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [authed, locked, lockConfig])

  if (!authed) {
    return <LoginPage onAuthenticated={() => setAuthed(true)} />
  }
  if (locked) {
    return (
      <LockScreen
        pinConfigured={lockConfig.pinConfigured}
        onUnlocked={() => setLocked(false)}
      />
    )
  }
  return <Layout onLock={() => setLocked(true)} />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGuard />
    </BrowserRouter>
  )
}
