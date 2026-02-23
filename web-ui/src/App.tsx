// @group BusinessLogic : Root app — layout shell + React Router

import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useDaemonHealth } from '@/hooks/useDaemonHealth'
import { useProcesses } from '@/hooks/useProcesses'
import { useSettings } from '@/hooks/useSettings'
import { useDialog } from '@/hooks/useDialog'
import { Dialog } from '@/components/Dialog'
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
import type { ProcessInfo } from '@/types'

// @group BusinessLogic > Layout : Sidebar + content shell
function Layout() {
  const { settings, updateSettings, resetToDefaults } = useSettings()
  const { processes, error, reload } = useProcesses(settings.autoRefresh, settings.processRefreshInterval)
  const health = useDaemonHealth(settings.healthRefreshInterval)
  const navigate = useNavigate()
  const location = useLocation()
  const { dialogState, confirm, alert, handleConfirm, handleCancel } = useDialog()

  const active = processes.filter(p =>
    p.status === 'running' || p.status === 'sleeping' || p.status === 'watching'
  )
  const connected = error === null

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

      {/* Sidebar */}
      <aside style={{
        width: 220, minWidth: 220,
        background: 'var(--color-card)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column',
        height: '100vh', overflow: 'hidden',
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
               <>
                v{health.version} · {formatUptime(health.uptime_secs)}
               </> 
              )}
              </span>
            <span className='px-2' style={{
              fontSize: 16, fontWeight: 600,
              color: connected ? 'var(--color-status-running)' : 'var(--color-status-crashed)',
            }}>
              ●
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <NavBtn to="/processes" label="▦  Processes" active={location.pathname === '/processes' || location.pathname.startsWith('/processes/')} />
          <NavBtn to="/start" label="+  Start Process" active={location.pathname === '/start'} />
          <div style={{ height: 4 }} />
          <NavBtn to="/cron-jobs" label="⏱  Cron Jobs" active={location.pathname === '/cron-jobs'} />
          <NavBtn to="/cron-jobs/new" label="+  New Cron Job" active={location.pathname === '/cron-jobs/new'} />
          <div style={{ height: 4 }} />
        </nav>

        {/* Running processes list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)', padding: '4px 16px 6px', letterSpacing: '0.08em' }}>
            ACTIVE
          </div>
          {active.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--color-muted-foreground)', padding: '4px 16px' }}>No active processes</div>
            : active.map(p => <SidebarProc key={p.id} p={p} onNavigate={() => navigate(`/processes/${p.id}`)} />)
          }
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
         
          <NavBtn to="/settings" label="⚙  Settings" active={location.pathname === '/settings'} />
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
          <Route path="/settings" element={<SettingsPage settings={settings} onUpdate={updateSettings} onReset={resetToDefaults} />} />
        </Routes>
      </div>
    </div>
  )
}

// @group BusinessLogic > NavBtn : Sidebar navigation link with active highlight
function NavBtn({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link to={to} style={{
      display: 'block', padding: '7px 16px', fontSize: 13,
      color: active ? 'var(--color-primary)' : 'var(--color-foreground)',
      textDecoration: 'none', fontWeight: active ? 600 : 500,
      background: active ? 'var(--color-accent)' : 'transparent',
      borderLeft: active ? '2px solid var(--color-primary)' : '2px solid transparent',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-accent)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </Link>
  )
}

// @group BusinessLogic > SidebarProc : Active process pill in sidebar
function SidebarProc({ p, onNavigate }: { p: ProcessInfo; onNavigate: () => void }) {
  return (
    <button onClick={onNavigate} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      width: '100%', padding: '5px 16px', background: 'transparent',
      border: 'none', cursor: 'pointer', color: 'var(--color-foreground)',
      fontSize: 12, textAlign: 'left',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: statusColor(p.status), fontSize: 10 }}>●</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
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
