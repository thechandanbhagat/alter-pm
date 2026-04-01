// @group BusinessLogic : Notification tray — slide-in activity feed panel

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Settings, CheckCheck, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AppNotification } from '@/hooks/useNotificationTray'
import { eventConfig, relativeTime } from '@/hooks/useNotificationTray'

// @group BusinessLogic > NotificationTray : Props
interface NotificationTrayProps {
  open: boolean
  notifications: AppNotification[]
  onClose: () => void
  onMarkAllRead: () => void
  onClearAll: () => void
  onDismiss: (id: string) => void
}

// @group Utilities > Styles : Tray style tokens
const trayWidth = 320

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28,
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--color-muted-foreground)', borderRadius: 5,
}

const actionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 8px', fontSize: 11, fontWeight: 500,
  background: 'transparent', border: '1px solid var(--color-border)',
  borderRadius: 4, cursor: 'pointer', color: 'var(--color-muted-foreground)',
}

// @group BusinessLogic > NotificationTray : Main overlay component
export function NotificationTray({
  open,
  notifications,
  onClose,
  onMarkAllRead,
  onClearAll,
  onDismiss,
}: NotificationTrayProps) {
  const navigate = useNavigate()

  // @group BusinessLogic > Keyboard : Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const tray = (
    <>
      {/* Transparent backdrop — click outside to close */}
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 199 }}
        />
      )}

      {/* Tray panel — slides in from right, same as AI panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: trayWidth,
        height: '100vh',
        zIndex: 200,
        background: 'var(--color-card)',
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        transform: open ? 'translateX(0)' : `translateX(${trayWidth + 4}px)`,
        transition: 'transform 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        pointerEvents: open ? 'auto' : 'none',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Activity</span>
          <button
            onClick={() => { navigate('/notifications'); onClose() }}
            title="Notification settings"
            style={iconBtn}
          >
            <Settings size={14} />
          </button>
          <button onClick={onClose} title="Close" style={iconBtn}>
            <X size={14} />
          </button>
        </div>

        {/* Toolbar — only when there are items */}
        {notifications.length > 0 && (
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', gap: 8,
          }}>
            <button onClick={onMarkAllRead} style={actionBtn} title="Mark all as read">
              <CheckCheck size={12} />
              Mark all read
            </button>
            <button onClick={onClearAll} style={{ ...actionBtn, color: 'var(--color-destructive)' }} title="Clear all">
              <Trash2 size={12} />
              Clear all
            </button>
          </div>
        )}

        {/* Notification list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', gap: 10,
              color: 'var(--color-muted-foreground)',
            }}>
              <span style={{ fontSize: 32, opacity: 0.5 }}>🔔</span>
              <span style={{ fontSize: 13 }}>No activity yet</span>
              <span style={{ fontSize: 11, textAlign: 'center', maxWidth: 200, lineHeight: 1.5 }}>
                Process events (crash, restart, start, stop) will appear here.
              </span>
            </div>
          ) : (
            notifications.map(n => (
              <NotifRow
                key={n.id}
                n={n}
                onNavigate={() => { navigate(`/processes/${n.processId}`); onClose() }}
                onDismiss={() => onDismiss(n.id)}
              />
            ))
          )}
        </div>
      </div>
    </>
  )

  return createPortal(tray, document.body)
}

// @group BusinessLogic > NotifRow : Single notification row
function NotifRow({
  n,
  onNavigate,
  onDismiss,
}: {
  n: AppNotification
  onNavigate: () => void
  onDismiss: () => void
}) {
  const cfg = eventConfig[n.event]

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        borderLeft: n.read ? '2px solid transparent' : `2px solid ${cfg.color}`,
        cursor: 'pointer',
        background: n.read ? 'transparent' : 'rgba(255,255,255,0.03)',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-muted)')}
      onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(255,255,255,0.03)')}
      onClick={onNavigate}
    >
      {/* Status dot */}
      <span style={{ color: cfg.color, fontSize: 10, marginTop: 4, flexShrink: 0 }}>●</span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{
            fontSize: 13, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150,
          }}>
            {n.processName}
          </span>
          <span style={{ fontSize: 11, color: cfg.color, fontWeight: 500, flexShrink: 0 }}>
            {cfg.label}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2 }}>
          {n.detail}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: 3, opacity: 0.65 }}>
          {n.namespace !== 'default' && <span style={{ marginRight: 5 }}>[{n.namespace}]</span>}
          <RelativeTime date={n.timestamp} />
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={e => { e.stopPropagation(); onDismiss() }}
        title="Dismiss"
        style={{ ...iconBtn, opacity: 0.4, flexShrink: 0, marginTop: 0, width: 20, height: 20 }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.4' }}
      >
        <X size={11} />
      </button>
    </div>
  )
}

// @group BusinessLogic > RelativeTime : Live-updating relative timestamp (re-renders every 30s)
function RelativeTime({ date }: { date: Date }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  return <>{relativeTime(date)}</>
}
