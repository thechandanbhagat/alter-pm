// @group BusinessLogic : Folder browser modal — navigable server-side filesystem tree

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

// @group Types
interface Entry {
  name: string
  path: string
  is_dir: boolean
}

interface BrowseResult {
  path: string
  parent: string | null
  entries: Entry[]
  error?: string
}

interface Props {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
}

// @group BusinessLogic > FolderBrowser : Main component
export function FolderBrowser({ initialPath = '', onSelect, onClose }: Props) {
  const [result, setResult]   = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const listRef               = useRef<HTMLDivElement>(null)

  // Navigate to a path on mount
  useEffect(() => { navigate(initialPath) }, [])

  // Escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // @group BusinessLogic > Navigation : Fetch directory listing from backend
  function navigate(path: string) {
    setLoading(true)
    setHovered(null)
    api.browsePath(path)
      .then(r => { setResult(r); if (listRef.current) listRef.current.scrollTop = 0 })
      .catch(e => setResult({ path, parent: null, entries: [], error: String(e.message ?? e) }))
      .finally(() => setLoading(false))
  }

  // @group Utilities > Breadcrumbs : Build clickable path segments from current path
  // macOS/Linux paths are absolute from "/" and keep "/" separators; Windows paths use "\"
  // and start at a drive letter.
  function buildCrumbs(): { label: string; path: string }[] {
    if (!result?.path) return []
    if (isPosix) {
      const parts = result.path.split('/').filter(Boolean)
      return parts.map((part, i) => ({ label: part, path: '/' + parts.slice(0, i + 1).join('/') }))
    }
    const parts = result.path.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts.map((part, i) => {
      const joined = parts.slice(0, i + 1).join('\\')
      // Windows drive root: "C:" → "C:\"
      const fullPath = (i === 0 && part.endsWith(':')) ? joined + '\\' : joined
      return { label: part, path: fullPath }
    })
  }

  const isPosix = !!result?.path.startsWith('/')
  const crumbs = buildCrumbs()
  const currentPath = result?.path ?? ''
  const canSelect = !!currentPath

  return (
    // @group BusinessLogic > Overlay : Fixed backdrop
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      {/* Dialog */}
      <div
        style={{ width: 580, maxHeight: '72vh', background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.45)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 18 }}>📁</span>
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Browse Folder</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1, color: 'var(--color-muted-foreground)', padding: '0 2px' }}>×</button>
        </div>

        {/* Breadcrumb / path bar */}
        <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', flexShrink: 0 }}>
          {/* Root button — drive list on Windows, "/" on macOS/Linux */}
          <button
            onClick={() => navigate('')}
            title={isPosix ? 'Filesystem root' : 'Show drives'}
            style={crumbBtnStyle}
          >
            {isPosix ? '/' : '⊞ Drives'}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11, padding: '0 1px' }}>›</span>
              <button onClick={() => navigate(c.path)} style={crumbBtnStyle}>{c.label}</button>
            </span>
          ))}
          {loading && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-muted-foreground)' }}>…</span>}
        </div>

        {/* Entry list */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>

          {/* Error state */}
          {result?.error && !loading && (
            <div style={{ padding: '10px 16px', color: 'var(--color-destructive)', fontSize: 12 }}>
              ⚠ {result.error}
            </div>
          )}

          {/* ".." up entry */}
          {!loading && result && result.parent !== null && (
            <EntryRow
              icon="📁"
              label=".."
              dim={false}
              hovered={hovered === '__parent__'}
              onHover={h => setHovered(h ? '__parent__' : null)}
              onClick={() => navigate(result.parent!)}
            />
          )}

          {/* Empty folder */}
          {!loading && result && !result.error && result.entries.length === 0 && result.parent === null && (
            <div style={{ padding: '20px 16px', color: 'var(--color-muted-foreground)', fontSize: 12, textAlign: 'center' }}>No items found</div>
          )}
          {!loading && result && !result.error && result.entries.length === 0 && result.parent !== null && (
            <div style={{ padding: '12px 16px', color: 'var(--color-muted-foreground)', fontSize: 12 }}>Empty folder</div>
          )}

          {/* Entries */}
          {result?.entries.map(e => (
            <EntryRow
              key={e.path}
              icon={e.is_dir ? '📁' : '📄'}
              label={e.name}
              dim={!e.is_dir}
              hovered={hovered === e.path}
              onHover={h => setHovered(h ? e.path : null)}
              onClick={e.is_dir ? () => navigate(e.path) : undefined}
            />
          ))}
        </div>

        {/* Footer: current path + actions */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <code style={{ flex: 1, fontSize: 11, color: 'var(--color-muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {currentPath || '— select a folder —'}
          </code>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button
              disabled={!canSelect}
              onClick={() => { onSelect(currentPath); onClose() }}
              style={{ ...selectBtnStyle, opacity: canSelect ? 1 : 0.45, cursor: canSelect ? 'pointer' : 'default' }}
            >
              Select Folder
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// @group Utilities > EntryRow : Single directory/file row with hover highlight
function EntryRow({ icon, label, dim, hovered, onHover, onClick }: {
  icon: string
  label: string
  dim: boolean
  hovered: boolean
  onHover: (h: boolean) => void
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        padding: '5px 16px',
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: onClick ? 'pointer' : 'default',
        background: hovered && onClick ? 'var(--color-accent)' : 'transparent',
        fontSize: 13,
        userSelect: 'none',
      }}
    >
      <span style={{ flexShrink: 0, fontSize: 14 }}>{icon}</span>
      <span style={{ color: dim ? 'var(--color-muted-foreground)' : 'var(--color-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  )
}

// @group Utilities > Styles
const crumbBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '2px 5px', fontSize: 12, borderRadius: 3,
  color: 'var(--color-foreground)',
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, color: 'var(--color-foreground)',
}

const selectBtnStyle: React.CSSProperties = {
  padding: '5px 14px', fontSize: 12, fontWeight: 600,
  background: 'var(--color-primary)', border: '1px solid var(--color-primary)',
  borderRadius: 5, color: 'var(--color-primary-foreground)',
}
