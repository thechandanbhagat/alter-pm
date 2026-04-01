// @group BusinessLogic > TerminalTab : Terminal keyboard shortcut settings

import type { AppSettings } from '@/lib/settings'
import { card, descStyle, inputStyle, labelStyle, lastRowStyle, rowStyle, sectionTitle } from './shared'

interface Props {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
}

// @group BusinessLogic > TerminalTab : Shortcut config rows
export default function TerminalTab({ settings, onUpdate }: Props) {
  const s = settings.terminalShortcuts

  function update(key: keyof AppSettings['terminalShortcuts'], value: string) {
    onUpdate({ terminalShortcuts: { ...s, [key]: value } })
  }

  return (
    <div>
      <p style={sectionTitle}>KEYBOARD SHORTCUTS</p>
      <div style={card}>

        <div style={rowStyle}>
          <div style={{ flex: 1, paddingRight: 24 }}>
            <div style={labelStyle}>Split Pane</div>
            <div style={descStyle}>Split the active terminal into two side-by-side panes</div>
          </div>
          <ShortcutInput value={s.splitPane} onChange={v => update('splitPane', v)} />
        </div>

        <div style={rowStyle}>
          <div style={{ flex: 1, paddingRight: 24 }}>
            <div style={labelStyle}>Duplicate Tab</div>
            <div style={descStyle}>Open a new tab using the same working directory as the active tab</div>
          </div>
          <ShortcutInput value={s.duplicateTab} onChange={v => update('duplicateTab', v)} />
        </div>

        <div style={lastRowStyle}>
          <div style={{ flex: 1, paddingRight: 24 }}>
            <div style={labelStyle}>New Terminal</div>
            <div style={descStyle}>Open a new empty terminal tab</div>
          </div>
          <ShortcutInput value={s.newTab} onChange={v => update('newTab', v)} />
        </div>

      </div>

      <p style={{ ...sectionTitle, marginTop: 8 }}>SHORTCUT FORMAT</p>
      <div style={card}>
        <div style={{ fontSize: 12, color: 'var(--color-muted-foreground)', lineHeight: 1.7 }}>
          Combine modifiers and a key with <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>+</code>
          <br />
          Modifiers: <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>ctrl</code>{' '}
          <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>shift</code>{' '}
          <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>alt</code>{' '}
          <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>meta</code>
          <br />
          Examples: <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>ctrl+shift+t</code>{' '}
          <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>alt+t</code>{' '}
          <code style={{ background: 'var(--color-muted)', padding: '1px 5px', borderRadius: 3 }}>ctrl+t</code>
        </div>
      </div>
    </div>
  )
}

// @group Utilities > ShortcutInput : Keyboard shortcut text input with monospace font
function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value.toLowerCase())}
      style={{
        ...inputStyle,
        width: 170,
        fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
        fontSize: 12,
      }}
      placeholder="e.g. ctrl+shift+t"
      spellCheck={false}
    />
  )
}
