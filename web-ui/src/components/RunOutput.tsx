// @group BusinessLogic : SSE-based script run output terminal display

import { useEffect, useRef } from 'react'

// @group Types : A single output line from a script run
export interface OutputLine {
  stream: 'stdout' | 'stderr'
  content: string
}

// @group Types : RunOutput component props
interface Props {
  lines: OutputLine[]
  exitCode: number | null | undefined
  isRunning: boolean
  onClear: () => void
  height?: number | string
}

// @group BusinessLogic > RunOutput : Terminal-style output panel with auto-scroll and exit pill
export function RunOutput({ lines, exitCode, isRunning, onClear, height = 200 }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // @group Utilities > AutoScroll : Scroll to bottom whenever new lines arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines.length])

  const isDone = !isRunning && exitCode !== undefined
  const exitSuccess = exitCode === 0

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      overflow: 'hidden',
      background: 'var(--color-background)',
      height,
    }}>
      {/* Terminal header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 12px',
        background: 'var(--color-editor-gutter)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>
            Output
          </span>
          {isRunning && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 600,
              color: 'var(--color-status-running)',
            }}>
              <span style={{ animation: 'pulse 1s infinite' }}>●</span> running
            </span>
          )}
          {isDone && (
            <span style={{
              display: 'inline-block', padding: '1px 7px', borderRadius: 4,
              fontSize: 10, fontWeight: 700,
              color: exitSuccess ? 'var(--color-status-running)' : 'var(--color-destructive)',
              background: exitSuccess ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            }}>
              exit {exitCode}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          style={{
            fontSize: 11, padding: '2px 8px',
            background: 'transparent', border: '1px solid var(--color-border)',
            borderRadius: 4, cursor: 'pointer', color: 'var(--color-muted-foreground)',
          }}
        >
          Clear
        </button>
      </div>

      {/* Output lines */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 12px',
        fontFamily: 'Consolas, "Cascadia Code", "Fira Code", monospace',
        fontSize: 12,
        lineHeight: '18px',
        color: 'var(--color-log-output)',
      }}>
        {lines.length === 0 && !isRunning && (
          <span style={{ color: 'var(--color-muted-foreground)', fontStyle: 'italic' }}>No output yet — click ▶ Run to execute the script</span>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.stream === 'stderr' ? 'var(--color-destructive)' : 'var(--color-log-output)',
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
            }}
          >
            {line.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
