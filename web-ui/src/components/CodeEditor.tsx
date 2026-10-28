// @group BusinessLogic : Lightweight textarea-based code editor with line numbers

import { useRef, useCallback } from 'react'

// @group Types : CodeEditor component props
interface Props {
  value: string
  onChange: (v: string) => void
  language?: string
  height?: number | string
  readOnly?: boolean
  placeholder?: string
}

// @group BusinessLogic > CodeEditor : Monospace editor with gutter, tab support, auto-scroll
export function CodeEditor({ value, onChange, language, height = 300, readOnly = false, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  // @group Utilities > LineNumbers : Sync gutter scroll with textarea scroll
  const handleScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  // @group BusinessLogic > Tab : Insert 2 spaces on Tab key press
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = value.substring(0, start) + '  ' + value.substring(end)
      onChange(next)
      // Restore cursor after state update
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [value, onChange])

  const lineCount = value ? value.split('\n').length : 1

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      overflow: 'hidden',
      background: 'var(--color-editor)',
      height,
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 12px',
        background: 'var(--color-editor-gutter)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)', fontFamily: 'monospace' }}>
          {language ?? 'text'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </div>

      {/* Editor area: gutter + textarea */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Line number gutter */}
        <div
          ref={gutterRef}
          style={{
            width: 44,
            background: 'var(--color-editor-gutter)',
            borderRight: '1px solid var(--color-border)',
            overflowY: 'hidden',
            flexShrink: 0,
            paddingTop: 8,
            paddingBottom: 8,
            userSelect: 'none',
            lineHeight: '20px',
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--color-muted-foreground)',
            textAlign: 'right',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={{ paddingRight: 8, paddingLeft: 4 }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            flex: 1,
            padding: '8px 12px',
            margin: 0,
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'var(--color-editor)',
            color: 'var(--color-foreground)',
            fontFamily: 'Consolas, "Cascadia Code", "Fira Code", monospace',
            fontSize: 13,
            lineHeight: '20px',
            tabSize: 2,
            overflowY: 'auto',
            whiteSpace: 'pre',
            overflowWrap: 'off' as React.CSSProperties['overflowWrap'],
            overflowX: 'auto',
          }}
        />
      </div>
    </div>
  )
}
