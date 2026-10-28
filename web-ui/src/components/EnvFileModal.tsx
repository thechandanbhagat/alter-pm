// @group BusinessLogic : .env file viewer and editor — modal overlay variant
// Used by ProcessDetailPage. Supports multiple env file tabs, color coding, and key sync.

import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { EnvFileEntry } from '@/types'
import { EnvEditor } from '@/components/EnvEditor'

interface Props {
  processId: string
  processName: string
  onClose: () => void
  onRestart: () => void
}

// @group Utilities > EnvColor : Color coding for env file types
function envFileColor(name: string): string {
  if (name === '.env') return 'var(--color-success)'
  if (name === '.env.example') return 'var(--color-warning)'
  if (name === '.env.local') return 'var(--color-info)'
  if (name === '.env.production' || name === '.env.prod') return 'var(--color-destructive)'
  if (name === '.env.development' || name === '.env.dev') return 'var(--color-success)'
  if (name === '.env.test') return 'var(--color-notification)'
  if (name === '.env.staging') return 'var(--color-warning)'
  return 'var(--color-muted-foreground)'
}

function envFileBg(name: string): string {
  if (name === '.env') return 'rgba(74,222,128,0.13)'
  if (name === '.env.example') return 'rgba(251,191,36,0.13)'
  if (name === '.env.local') return 'rgba(96,165,250,0.13)'
  if (name === '.env.production' || name === '.env.prod') return 'rgba(248,113,113,0.13)'
  if (name === '.env.development' || name === '.env.dev') return 'rgba(52,211,153,0.13)'
  if (name === '.env.test') return 'rgba(167,139,250,0.13)'
  if (name === '.env.staging') return 'rgba(251,146,60,0.13)'
  return 'rgba(148,163,184,0.1)'
}

export function EnvFileModal({ processId, processName, onClose, onRestart }: Props) {
  // @group BusinessLogic > State : Tab and file management
  const [files, setFiles]             = useState<EnvFileEntry[]>([])
  const [activeTab, setActiveTab]     = useState<string>('.env')
  const [content, setContent]         = useState('')
  const [exists, setExists]           = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [syncing, setSyncing]         = useState(false)
  const [saved, setSaved]             = useState(false)
  const [dirty, setDirty]             = useState(false)
  const [error, setError]             = useState('')
  const [syncMsg, setSyncMsg]         = useState('')
  const textareaRef                   = useRef<HTMLTextAreaElement>(null)

  // @group BusinessLogic : Load file list when process changes
  useEffect(() => {
    setLoadingList(true)
    api.listEnvFiles(processId)
      .then(data => {
        setFiles(data.files)
        const first = data.files[0]?.name ?? '.env'
        setActiveTab(first)
        setLoadingList(false)
        loadFile(first)
      })
      .catch(() => {
        setFiles([{ name: '.env', path: '' }])
        setActiveTab('.env')
        setLoadingList(false)
        loadFile('.env')
      })
  }, [processId])

  // @group Utilities : Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function loadFile(filename: string) {
    setLoadingFile(true)
    setContent('')
    setDirty(false)
    setSaved(false)
    setError('')
    api.getEnvFile(processId, filename)
      .then(data => {
        setContent(data.content)
        setExists(data.exists)
        setLoadingFile(false)
        setTimeout(() => textareaRef.current?.focus(), 50)
      })
      .catch(e => { setError(String(e.message ?? e)); setLoadingFile(false) })
  }

  function switchTab(name: string) {
    if (dirty) {
      if (!window.confirm('You have unsaved changes. Discard and switch files?')) return
    }
    setActiveTab(name)
    loadFile(name)
  }

  async function handleSave(andRestart: boolean) {
    setSaving(true)
    setError('')
    try {
      await api.saveEnvFile(processId, content, activeTab)
      setExists(true)
      setDirty(false)
      setSaved(true)
      if (andRestart) {
        await api.restartProcess(processId).catch(() => {})
        onRestart()
        onClose()
      } else {
        setTimeout(() => setSaved(false), 2500)
      }
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  // @group BusinessLogic > Sync : Propagate keys from active file to all other env files
  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    setError('')
    try {
      await api.saveEnvFile(processId, content, activeTab)
      setExists(true)
      setDirty(false)
    } catch (e: any) {
      setError(String(e.message ?? e))
      setSyncing(false)
      return
    }

    const activeFile = files.find(f => f.name === activeTab)
    if (!activeFile?.path) {
      setError('Cannot sync: file path unknown')
      setSyncing(false)
      return
    }

    try {
      const result = await api.syncEnvFiles(activeFile.path)
      setSyncMsg(result.success
        ? `✓ Synced keys to ${result.synced_files} file${result.synced_files !== 1 ? 's' : ''}`
        : `Synced ${result.synced_files} file(s)${result.errors?.length ? ` — ${result.errors.length} error(s)` : ''}`
      )
      setTimeout(() => setSyncMsg(''), 4000)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setSyncing(false)
    }
  }

  const lineCount = content.split('\n').length
  const activeColor = envFileColor(activeTab)
  const hasMultipleFiles = files.length > 1

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        width: 700, maxWidth: '94vw', maxHeight: '84vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>

        {/* Header */}
        <div style={{
          padding: '12px 16px 0',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10 }}>
            <span style={{ fontSize: 16 }}>🔑</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Environment</span>
              <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--color-muted-foreground)' }}>— {processName}</span>
            </div>
            {!loadingFile && (
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                background: envFileBg(activeTab), color: activeColor,
              }}>
                {exists ? '● exists' : '○ not found'}
              </span>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'var(--color-muted-foreground)', padding: '0 2px' }}
            >×</button>
          </div>

          {/* Tabs */}
          {!loadingList && (
            <div style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
              {(files.length > 0 ? files : [{ name: '.env', path: '' }]).map(f => {
                const isActive = f.name === activeTab
                const color = envFileColor(f.name)
                const bg = envFileBg(f.name)
                return (
                  <button
                    key={f.name}
                    onClick={() => switchTab(f.name)}
                    style={{
                      padding: '5px 14px', fontSize: 12, fontWeight: isActive ? 700 : 500,
                      background: isActive ? bg : 'transparent',
                      border: 'none', borderBottom: isActive ? `2px solid ${color}` : '2px solid transparent',
                      borderRadius: '4px 4px 0 0',
                      cursor: 'pointer',
                      color: isActive ? color : 'var(--color-muted-foreground)',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    {f.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 8 }}>
          {loadingList || loadingFile ? (
            <div style={{ color: 'var(--color-muted-foreground)', padding: 24, textAlign: 'center', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {!exists && (
                <div style={{
                  fontSize: 12, padding: '7px 10px', borderRadius: 4,
                  background: 'var(--color-muted)', color: 'var(--color-muted-foreground)',
                  borderLeft: `3px solid ${activeColor}`,
                }}>
                  No <code>{activeTab}</code> file found in this process's working directory. Saving will create it.
                </div>
              )}

              {/* Editor */}
              <EnvEditor
                value={content}
                onChange={v => { setContent(v); setDirty(true); setSaved(false) }}
                borderColor={dirty ? activeColor : 'var(--color-border)'}
                placeholder={'KEY=value\nDATABASE_URL=postgres://...\nSECRET_KEY=...'}
                textareaRef={textareaRef}
              />

              {syncMsg && (
                <div style={{ fontSize: 12, color: activeColor }}>{syncMsg}</div>
              )}
              {error && (
                <div style={{ fontSize: 12, color: 'var(--color-destructive)', padding: '5px 8px', borderRadius: 4, background: 'rgba(255,100,100,0.1)' }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 8,
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>
            {dirty ? <span style={{ color: activeColor }}>● Unsaved changes</span> : saved ? '✓ Saved' : `${lineCount} line${lineCount !== 1 ? 's' : ''}`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            {hasMultipleFiles && (
              <button
                disabled={syncing || loadingFile}
                onClick={handleSync}
                title="Sync keys from this file to all other env files"
                style={{ ...cancelBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 5, opacity: syncing || loadingFile ? 0.6 : 1 }}
              >
                <RefreshCw size={12} strokeWidth={2} />
                {syncing ? 'Syncing…' : 'Sync Keys'}
              </button>
            )}
            <button
              disabled={saving || loadingFile}
              onClick={() => handleSave(false)}
              style={{ ...cancelBtnStyle, opacity: saving || loadingFile ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              disabled={saving || loadingFile}
              onClick={() => handleSave(true)}
              style={{ ...primaryBtnStyle(activeColor), opacity: saving || loadingFile ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save & Restart'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// @group Utilities > Styles
const cancelBtnStyle: React.CSSProperties = {
  padding: '5px 14px', fontSize: 13, cursor: 'pointer',
  background: 'var(--color-secondary)', border: '1px solid var(--color-border)',
  borderRadius: 5, color: 'var(--color-foreground)',
}

function primaryBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: color, border: `1px solid ${color}`,
    borderRadius: 5, color: 'var(--color-status-foreground)',
  }
}
