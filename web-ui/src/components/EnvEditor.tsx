// @group BusinessLogic : Syntax-highlighted .env file editor
// Uses a transparent textarea over a highlighted <pre> layer.
// Supports: comments (#), keys, = separator, values, quoted strings, export keyword.

import { useEffect, useRef } from 'react'

// @group Utilities > Highlight : Parse one .env line into highlighted spans
function highlightLine(line: string, i: number): React.ReactNode {
  // Empty line
  if (line === '') return <br key={i} />

  // Comment line (optional leading whitespace + #)
  if (/^\s*#/.test(line)) {
    return (
      <div key={i} style={{ color: 'var(--color-muted-foreground)', fontStyle: 'italic' }}>
        {line}
      </div>
    )
  }

  // export keyword prefix (e.g. "export KEY=value")
  let rest = line
  let exportPrefix: React.ReactNode = null
  const exportMatch = rest.match(/^(export\s+)(.*)$/)
  if (exportMatch) {
    exportPrefix = <span style={{ color: 'var(--color-syntax-keyword)' }}>{exportMatch[1]}</span>
    rest = exportMatch[2]
  }

  // KEY=value
  const eqIdx = rest.indexOf('=')
  if (eqIdx > 0) {
    const key = rest.slice(0, eqIdx)
    const val = rest.slice(eqIdx + 1)

    // Only highlight if key looks like a valid env var
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key.trim())) {
      return (
        <div key={i}>
          {exportPrefix}
          <span style={{ color: 'var(--color-syntax-key)' }}>{key}</span>
          <span style={{ color: 'var(--color-muted-foreground)' }}>=</span>
          {highlightValue(val)}
        </div>
      )
    }
  }

  // Fallback — plain text
  return <div key={i}>{exportPrefix}{rest}</div>
}

// @group Utilities > HighlightValue : Color the value part of KEY=value
function highlightValue(val: string): React.ReactNode {
  if (val === '') return null

  // Quoted string — single or double
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    const q = val[0]
    const inner = val.slice(1, -1)
    return (
      <>
        <span style={{ color: 'var(--color-muted-foreground)' }}>{q}</span>
        <span style={{ color: 'var(--color-warning)' }}>{inner}</span>
        <span style={{ color: 'var(--color-muted-foreground)' }}>{q}</span>
      </>
    )
  }

  // Has inline comment after value (e.g. VALUE # comment)
  const commentIdx = val.search(/\s+#/)
  if (commentIdx > 0) {
    return (
      <>
        <span style={{ color: 'var(--color-syntax-value)' }}>{val.slice(0, commentIdx)}</span>
        <span style={{ color: 'var(--color-muted-foreground)', fontStyle: 'italic' }}>{val.slice(commentIdx)}</span>
      </>
    )
  }

  // Plain value
  return <span style={{ color: 'var(--color-syntax-value)' }}>{val}</span>
}

// @group BusinessLogic > EnvEditor : Highlighted editor component
interface EnvEditorProps {
  value: string
  onChange: (v: string) => void
  borderColor: string
  placeholder?: string
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
}

export function EnvEditor({ value, onChange, borderColor, placeholder, textareaRef: externalRef }: EnvEditorProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const preRef      = useRef<HTMLPreElement>(null)
  const taRef       = externalRef ?? internalRef

  // Sync scroll between textarea and highlight layer
  useEffect(() => {
    const ta = taRef.current
    const pre = preRef.current
    if (!ta || !pre) return
    const onScroll = () => {
      pre.scrollTop  = ta.scrollTop
      pre.scrollLeft = ta.scrollLeft
    }
    ta.addEventListener('scroll', onScroll)
    return () => ta.removeEventListener('scroll', onScroll)
  }, [])

  const lines = value.split('\n')
  // Add a trailing empty line so the pre height matches textarea height
  // when content ends with a newline
  const renderLines = value.endsWith('\n') ? [...lines.slice(0, -1), ''] : lines

  const sharedStyle: React.CSSProperties = {
    fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 12,
    lineHeight: '1.65',
    padding: '8px 10px',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    overflowWrap: 'break-word',
    tabSize: 2,
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      overflow: 'hidden',
      border: `1px solid ${borderColor}`,
      borderRadius: 4,
      background: 'var(--color-background)',
      position: 'relative',
    }}>

      {/* Line numbers */}
      <div style={{
        padding: '8px 6px',
        textAlign: 'right',
        userSelect: 'none',
        fontFamily: sharedStyle.fontFamily,
        fontSize: sharedStyle.fontSize,
        lineHeight: sharedStyle.lineHeight,
        color: 'var(--color-muted-foreground)',
        background: 'var(--color-muted)',
        borderRight: '1px solid var(--color-border)',
        minWidth: 32,
        flexShrink: 0,
        overflowY: 'hidden',
      }}>
        {renderLines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      {/* Highlight layer (behind textarea) */}
      <pre
        ref={preRef}
        aria-hidden
        style={{
          ...sharedStyle,
          position: 'absolute',
          // offset by the line-number column width (32px border + padding)
          left: 32,
          top: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          color: 'var(--color-foreground)',
          background: 'transparent',
        }}
      >
        {renderLines.map((line, i) => highlightLine(line, i))}
      </pre>

      {/* Editable textarea (transparent text, visible caret) */}
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        placeholder={placeholder}
        style={{
          ...sharedStyle,
          flex: 1,
          position: 'relative',
          background: 'transparent',
          color: 'transparent',
          caretColor: 'var(--color-foreground)',
          border: 'none',
          outline: 'none',
          resize: 'none',
          minHeight: 0,
          zIndex: 1,
        }}
      />
    </div>
  )
}
