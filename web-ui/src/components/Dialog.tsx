// @group BusinessLogic : App-level modal dialog — confirm, alert, and custom variants

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// @group Types : Dialog variant
export type DialogVariant = 'confirm' | 'alert' | 'danger'

// @group Types : Dialog component props
export interface DialogProps {
  open: boolean
  title: string
  message?: string
  variant?: DialogVariant
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel?: () => void
}

// @group BusinessLogic > Dialog : Modal overlay with keyboard support (Esc, Enter)
export function Dialog({
  open,
  title,
  message,
  variant = 'confirm',
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: DialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  // @group Utilities > Focus : Auto-focus confirm button on open
  useEffect(() => {
    if (open) {
      // Slight delay so the portal has rendered
      const t = setTimeout(() => confirmBtnRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [open])

  // @group Utilities > Keyboard : Esc = cancel, Enter = confirm
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const isAlert = variant === 'alert'
  const isDanger = variant === 'danger'

  const confirmColor = isDanger
    ? 'var(--color-destructive)'
    : 'var(--color-primary)'

  const defaultConfirmLabel = isAlert ? 'OK' : isDanger ? 'Delete' : 'Confirm'
  const defaultCancelLabel = 'Cancel'

  return createPortal(
    // @group BusinessLogic > Overlay : Dark backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      onClick={e => { if (e.target === e.currentTarget) onCancel?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
        animation: 'dialogFadeIn 0.12s ease',
      }}
    >
      {/* Dialog box */}
      <div style={{
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '24px 28px 20px',
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        animation: 'dialogSlideIn 0.15s ease',
      }}>
        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: message ? 10 : 20 }}>
          {isDanger && (
            <span style={{
              fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 1,
              color: 'var(--color-destructive)',
            }}>⚠</span>
          )}
          {isAlert && (
            <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>ℹ</span>
          )}
          <h3
            id="dialog-title"
            style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}
          >
            {title}
          </h3>
        </div>

        {/* Message body */}
        {message && (
          <p style={{
            margin: '0 0 20px',
            fontSize: 13,
            color: 'var(--color-muted-foreground)',
            lineHeight: 1.55,
            paddingLeft: isDanger || isAlert ? 34 : 0,
          }}>
            {message}
          </p>
        )}

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--color-border)', marginBottom: 16 }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!isAlert && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 500,
                background: 'var(--color-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 6, cursor: 'pointer',
                color: 'var(--color-foreground)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-secondary)')}
            >
              {cancelLabel ?? defaultCancelLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: '7px 18px', fontSize: 13, fontWeight: 600,
              background: isDanger ? 'rgba(239,68,68,0.15)' : 'var(--color-primary)',
              border: `1px solid ${confirmColor}`,
              borderRadius: 6, cursor: 'pointer',
              color: isDanger ? 'var(--color-destructive)' : 'var(--color-primary-foreground)',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {confirmLabel ?? defaultConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
