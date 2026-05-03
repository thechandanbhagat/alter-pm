// @group BusinessLogic : Script manager page — create, edit, run, and delete scripts

import { useEffect, useRef, useState } from 'react'
import { FileCode, Play, Plus, Trash2, Save, Square, ChevronLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { CodeEditor } from '@/components/CodeEditor'
import { RunOutput, type OutputLine } from '@/components/RunOutput'
import type { ScriptInfo } from '@/types'

// @group Constants : Supported languages for the script editor
const LANGUAGES = [
  { value: 'python',     label: 'Python',      color: '#3b82f6' },
  { value: 'node',       label: 'Node.js',     color: '#84cc16' },
  { value: 'bash',       label: 'Bash',        color: '#f59e0b' },
  { value: 'powershell', label: 'PowerShell',  color: '#818cf8' },
  { value: 'ts-node',    label: 'TypeScript',  color: '#60a5fa' },
  { value: 'cmd',        label: 'CMD',         color: '#94a3b8' },
  { value: 'ruby',       label: 'Ruby',        color: '#ef4444' },
  { value: 'php',        label: 'PHP',         color: '#a78bfa' },
  { value: 'go',         label: 'Go',          color: '#34d399' },
  { value: 'rust',       label: 'Rust',        color: '#fb923c' },
  { value: 'julia',      label: 'Julia',       color: '#e879f9' },
  { value: 'Rscript',    label: 'R',           color: '#2dd4bf' },
]

// @group Utilities : Format bytes into human-readable size
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

// @group Utilities : Format ISO date to relative string
function fmtDate(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

// @group Utilities : Return color for language badge
function langColor(lang: string): string {
  return LANGUAGES.find(l => l.value === lang)?.color ?? '#94a3b8'
}

// @group Utilities : Default starter content per language
function defaultContent(lang: string): string {
  switch (lang) {
    case 'python':     return '# Python script\nprint("Hello from alter!")\n'
    case 'node':       return '// Node.js script\nconsole.log("Hello from alter!");\n'
    case 'bash':       return '#!/usr/bin/env bash\necho "Hello from alter!"\n'
    case 'powershell': return '# PowerShell script\nWrite-Host "Hello from alter!"\n'
    case 'ts-node':    return '// TypeScript script\nconsole.log("Hello from alter!");\n'
    case 'cmd':        return '@echo off\necho Hello from alter!\n'
    case 'ruby':       return '# Ruby script\nputs "Hello from alter!"\n'
    case 'php':        return '<?php\necho "Hello from alter!\\n";\n'
    case 'go':         return 'package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("Hello from alter!")\n}\n'
    default:           return ''
  }
}

// @group Types : Editor state for a script being created or edited
interface EditorState {
  isNew: boolean
  name: string
  language: string
  content: string
  originalName?: string  // set when editing an existing script
}

// @group Utilities : Style tokens
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13,
  background: 'var(--color-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 5, color: 'var(--color-foreground)',
  outline: 'none', width: '100%',
}

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 14px', fontSize: 12, fontWeight: 500,
  background: 'var(--color-primary)', border: 'none',
  borderRadius: 5, cursor: 'pointer',
  color: 'var(--color-primary-foreground)',
}

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 12px', fontSize: 12, fontWeight: 500,
  background: 'var(--color-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 5, cursor: 'pointer', color: 'var(--color-foreground)',
}

const btnDanger: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 8px', fontSize: 11,
  background: 'transparent', border: '1px solid var(--color-border)',
  borderRadius: 4, cursor: 'pointer', color: 'var(--color-destructive)',
}

// @group BusinessLogic > ScriptList : Left-side list of saved scripts
function ScriptList({
  scripts,
  selected,
  onSelect,
  onNew,
  onDelete,
}: {
  scripts: ScriptInfo[]
  selected: string | null
  onSelect: (s: ScriptInfo) => void
  onNew: () => void
  onDelete: (name: string) => void
}) {
  return (
    <div style={{
      width: 240, minWidth: 240, borderRight: '1px solid var(--color-border)',
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted-foreground)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Scripts
        </span>
        <button
          style={{ ...btnSecondary, padding: '4px 8px' }}
          onClick={onNew}
          title="New script"
        >
          <Plus size={13} /> New
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {scripts.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-muted-foreground)', fontSize: 12 }}>
            <FileCode size={28} style={{ opacity: 0.3, display: 'block', margin: '0 auto 8px' }} />
            No scripts yet.<br />Click <strong>New</strong> to create one.
          </div>
        ) : (
          scripts.map(s => {
            const isActive = s.name === selected
            const color = langColor(s.language)
            return (
              <div
                key={s.name}
                onClick={() => onSelect(s)}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--color-border)',
                  background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {s.name}
                  </span>
                  <button
                    style={{ ...btnDanger, padding: '2px 5px', flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); onDelete(s.name) }}
                    title="Delete script"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '1px 5px',
                    borderRadius: 3, color, background: `${color}22`,
                    border: `1px solid ${color}44`,
                  }}>
                    {s.language}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>
                    {fmtSize(s.size_bytes)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginLeft: 'auto' }}>
                    {fmtDate(s.modified_at)}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// @group BusinessLogic > ScriptsPage : Main page component
export default function ScriptsPage() {
  const [scripts, setScripts]   = useState<ScriptInfo[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor]     = useState<EditorState | null>(null)

  // @group BusinessLogic > Run : Script execution state
  const [isRunning, setIsRunning]   = useState(false)
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])
  const [exitCode, setExitCode]     = useState<number | null | undefined>(undefined)
  const esRef = useRef<EventSource | null>(null)

  // @group BusinessLogic > Save : Save / error state
  const [saving, setSaving]   = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  // @group BusinessLogic > DataFetch : Load scripts list
  function loadScripts() {
    setLoading(true)
    api.listScripts()
      .then(r => setScripts(r.scripts))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadScripts() }, [])

  // @group BusinessLogic > Select : Open a script in the editor
  function handleSelect(s: ScriptInfo) {
    setSelected(s.name)
    api.getScript(s.name)
      .then(r => setEditor({
        isNew: false,
        name: r.name,
        language: r.language,
        content: r.content,
        originalName: r.name,
      }))
      .catch(() => {})
  }

  // @group BusinessLogic > New : Open a blank editor for a new script
  function handleNew() {
    setSelected(null)
    setEditor({ isNew: true, name: '', language: 'python', content: defaultContent('python') })
    setOutputLines([])
    setExitCode(undefined)
  }

  // @group BusinessLogic > Delete : Remove a script from disk
  async function handleDelete(name: string) {
    if (!confirm(`Delete script "${name}"?`)) return
    await api.deleteScript(name).catch(() => {})
    if (selected === name) { setSelected(null); setEditor(null) }
    loadScripts()
  }

  // @group BusinessLogic > Save : Persist script to daemon storage
  async function handleSave() {
    if (!editor) return
    const name = editor.name.trim()
    if (!name) { setSaveErr('Name is required'); return }
    setSaving(true); setSaveErr(null); setSaved(false)
    try {
      await api.saveScript({ name, language: editor.language, content: editor.content })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      setEditor(e => e ? { ...e, isNew: false, originalName: name } : e)
      setSelected(name)
      loadScripts()
    } catch (e) {
      setSaveErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  // @group BusinessLogic > Run : Stream script output via SSE
  function handleRun() {
    if (!editor || !editor.name.trim()) return
    // Stop any existing run
    esRef.current?.close()
    setOutputLines([])
    setExitCode(undefined)
    setIsRunning(true)

    const es = api.runScript(editor.name.trim())
    esRef.current = es

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.done) {
          setExitCode(data.exit_code ?? null)
          setIsRunning(false)
          es.close()
        } else {
          setOutputLines(prev => [...prev, { stream: data.stream, content: data.content }])
        }
      } catch { /* ignore parse errors */ }
    }

    es.onerror = () => {
      setIsRunning(false)
      es.close()
    }
  }

  // @group BusinessLogic > Stop : Kill running script by closing the SSE (server kills process on disconnect)
  function handleStop() {
    esRef.current?.close()
    setIsRunning(false)
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: Script list */}
      <ScriptList
        scripts={scripts}
        selected={selected}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
      />

      {/* Right: Editor + output */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!editor ? (
          /* Empty state */
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-muted-foreground)', gap: 10,
          }}>
            <FileCode size={40} style={{ opacity: 0.2 }} />
            <p style={{ fontSize: 14, margin: 0 }}>Select a script or create a new one</p>
            <button style={btnSecondary} onClick={handleNew}>
              <Plus size={13} /> New script
            </button>
          </div>
        ) : (
          /* Editor pane */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 16, gap: 12 }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

              {/* Back button for narrow panels */}
              <button
                style={{ ...btnSecondary, padding: '5px 8px', display: 'flex' }}
                onClick={() => { setEditor(null); setSelected(null) }}
                title="Back to list"
              >
                <ChevronLeft size={14} />
              </button>

              {/* Name field */}
              <input
                style={{ ...inputStyle, width: 180 }}
                placeholder="Script name"
                value={editor.name}
                onChange={e => setEditor(ed => ed ? { ...ed, name: e.target.value } : ed)}
              />

              {/* Language picker */}
              <select
                value={editor.language}
                onChange={e => setEditor(ed => ed ? {
                  ...ed,
                  language: e.target.value,
                  content: ed.content || defaultContent(e.target.value),
                } : ed)}
                style={{ ...inputStyle, width: 130, cursor: 'pointer' }}
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>

              <div style={{ flex: 1 }} />

              {/* Save */}
              <button
                style={{ ...btnSecondary, opacity: saving ? 0.7 : 1 }}
                onClick={handleSave}
                disabled={saving}
              >
                <Save size={13} />
                {saving ? 'Saving…' : 'Save'}
              </button>

              {/* Run / Stop */}
              {isRunning ? (
                <button style={{ ...btnDanger, padding: '6px 14px', fontSize: 12 }} onClick={handleStop}>
                  <Square size={13} /> Stop
                </button>
              ) : (
                <button
                  style={{ ...btnPrimary, opacity: (!editor.name.trim() || editor.isNew) ? 0.5 : 1 }}
                  onClick={handleRun}
                  disabled={!editor.name.trim() || editor.isNew}
                  title={editor.isNew ? 'Save first to run' : 'Run script'}
                >
                  <Play size={13} /> Run
                </button>
              )}
            </div>

            {/* Status row */}
            {(saveErr || saved) && (
              <div style={{ fontSize: 12 }}>
                {saved && <span style={{ color: 'var(--color-status-running)' }}>✓ Saved</span>}
                {saveErr && <span style={{ color: 'var(--color-destructive)' }}>{saveErr}</span>}
              </div>
            )}
            {editor.isNew && (
              <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', margin: 0 }}>
                Save the script before running it.
              </p>
            )}

            {/* Code editor */}
            <CodeEditor
              value={editor.content}
              onChange={v => setEditor(ed => ed ? { ...ed, content: v } : ed)}
              language={editor.language}
              height="calc(50% - 20px)"
            />

            {/* Output */}
            <RunOutput
              lines={outputLines}
              exitCode={exitCode}
              isRunning={isRunning}
              onClear={() => { setOutputLines([]); setExitCode(undefined) }}
              height="calc(50% - 20px)"
            />
          </div>
        )}
      </div>

      {loading && scripts.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-muted-foreground)', pointerEvents: 'none',
        }}>
          Loading…
        </div>
      )}
    </div>
  )
}
