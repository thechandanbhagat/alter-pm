// @group Utilities : Shared primitives for settings tab components

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

// @group Utilities > Styles : Shared style tokens
export const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--color-muted-foreground)', textTransform: 'uppercase',
  marginBottom: 12, marginTop: 0,
}

export const card: React.CSSProperties = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '18px 20px',
  marginBottom: 16,
}

export const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid var(--color-border)',
}

export const lastRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderBottom: 'none',
  paddingBottom: 0,
}

export const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'var(--color-foreground)',
}

export const descStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2,
}

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', fontSize: 13,
  background: 'var(--color-input)', border: '1px solid var(--color-border)',
  borderRadius: 5, color: 'var(--color-foreground)', outline: 'none',
}

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 'auto',
  minWidth: 130,
  fontSize: 12,
  padding: '5px 10px',
  cursor: 'pointer',
}

// @group Utilities > Toggle : iOS-style toggle switch
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22,
        borderRadius: 11,
        border: 'none',
        cursor: 'pointer',
        background: checked ? 'var(--color-primary)' : 'var(--color-border)',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3, left: checked ? 20 : 3,
        width: 16, height: 16,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }} />
    </button>
  )
}

// @group Utilities > SettingRow : A single setting row with label, description, and control
export function SettingRow({
  label, description, control, isLast = false,
}: {
  label: string
  description?: React.ReactNode
  control: React.ReactNode
  isLast?: boolean
}) {
  return (
    <div style={isLast ? lastRowStyle : rowStyle}>
      <div style={{ flex: 1, paddingRight: 24 }}>
        <div style={labelStyle}>{label}</div>
        {description && <div style={descStyle}>{description}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  )
}

// @group Utilities > CopyPath : Path display field with one-click copy
export function CopyPath({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <code style={{
        fontSize: 11, fontFamily: 'monospace',
        background: 'var(--color-muted)', border: '1px solid var(--color-border)',
        borderRadius: 4, padding: '3px 8px',
        color: 'var(--color-foreground)', maxWidth: 340,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        display: 'block',
      }} title={value}>{value}</code>
      <button onClick={copy} title="Copy path" style={{
        padding: 4, background: 'transparent', border: 'none',
        cursor: 'pointer', color: copied ? 'var(--color-status-running)' : 'var(--color-muted-foreground)',
        display: 'flex', alignItems: 'center',
      }}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}
