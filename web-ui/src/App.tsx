// @group BusinessLogic : Root app — layout shell + React Router

import { useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, Plus, Clock, ScrollText, Settings, Bell, type LucideIcon } from 'lucide-react'
import { useDaemonHealth } from '@/hooks/useDaemonHealth'
import { useProcesses } from '@/hooks/useProcesses'
import { useSettings } from '@/hooks/useSettings'
import { useDialog } from '@/hooks/useDialog'
import { useNotificationTray } from '@/hooks/useNotificationTray'
import { Dialog } from '@/components/Dialog'
import { NotificationTray } from '@/components/NotificationTray'
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
import type { ProcessInfo } from '@/types'

// @group BusinessLogic > Layout : Sidebar + content shell
function Layout() {
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

  const isProcessActive = location.pathname === '/processes' || location.pathname.startsWith('/processes/')
  const isCronActive    = location.pathname === '/cron-jobs' || location.pathname === '/cron-jobs/new'

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

          {/* @group BusinessLogic > BellBtn : Activity tray toggle — not a nav link */}
          <BellBtn unreadCount={unreadCount} onClick={openTray} />
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
            <SidebarBtn label="Shutdown" onClick={handleShutdown} danger />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<AnalyticsPage processes={processes} settings={settings} />} />
          <Route path="/processes" element={<ProcessesPage processes={processes} reload={reload} settings={settings} />} />
          <Route path="/start" element={<StartPage onDone={() => { reload(); navigate('/processes') }} settings={settings} />} />
          <Route path="/edit/:id" element={<EditPage onDone={() => { reload(); navigate('/processes') }} />} />
          <Route path="/processes/:id" element={<ProcessDetailPage reload={reload} settings={settings} />} />
          <Route path="/cron-jobs" element={<CronJobsPage processes={processes} reload={reload} settings={settings} />} />
          <Route path="/cron-jobs/new" element={<CreateCronJobPage onDone={() => { reload(); navigate('/cron-jobs') }} settings={settings} />} />
          <Route path="/logs" element={<LogLibraryPage processes={processes} reload={reload} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
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

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  )
}
