// @group BusinessLogic > UiTab : UI settings — process row action visibility

import type { AppSettings } from '@/lib/settings'
import { card, descStyle, sectionTitle, SettingRow, Toggle } from './shared'

interface Props {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
}

export default function UiTab({ settings, onUpdate }: Props) {
  return (
    <>
      <p style={sectionTitle}>Process Row Actions</p>
      <div style={{ ...card, marginBottom: 8 }}>
        <p style={{ ...descStyle, marginBottom: 12 }}>
          Start / Stop / Restart are always visible. Choose which additional actions appear inline — the rest go in the <strong>⋯</strong> menu.
        </p>
        {[
          { key: 'logs',     label: 'Logs',     description: 'Open the process log viewer.' },
          { key: 'edit',     label: 'Edit',     description: 'Edit the process configuration.' },
          { key: 'terminal', label: 'Terminal', description: 'Open a terminal in the process working directory.' },
          { key: 'env',      label: '.env',     description: 'View and edit environment variables.' },
          { key: 'enable',   label: 'Enable / Disable', description: 'Toggle whether the process is included in Start All.' },
          { key: 'notify',   label: 'Notify',   description: 'Configure process notifications.' },
          { key: 'clone',    label: 'Clone',    description: 'Duplicate this process.' },
          { key: 'delete',   label: 'Delete',   description: 'Delete the process.' },
        ].map(({ key, label, description }, i, arr) => (
          <SettingRow
            key={key}
            label={label}
            description={description}
            isLast={i === arr.length - 1}
            control={
              <Toggle
                checked={settings.visibleRowActions.includes(key)}
                onChange={v => {
                  const next = v
                    ? [...settings.visibleRowActions, key]
                    : settings.visibleRowActions.filter(k => k !== key)
                  onUpdate({ visibleRowActions: next })
                }}
              />
            }
          />
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', textAlign: 'center', marginTop: 8 }}>
        Changes take effect immediately.
      </p>
    </>
  )
}
