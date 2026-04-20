// @group BusinessLogic : Settings page — tab shell that delegates to individual tab components

import { useNavigate, useParams } from 'react-router-dom'
import type { AppSettings } from '@/lib/settings'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import GeneralTab from '@/components/settings/GeneralTab'
import UiTab from '@/components/settings/UiTab'
import SecurityTab from '@/components/settings/SecurityTab'
import AiTab from '@/components/settings/AiTab'
import TelegramTab from '@/components/settings/TelegramTab'
import LogAlertsTab from '@/components/settings/LogAlertsTab'
import TunnelsTab from '@/components/settings/TunnelsTab'
import TerminalTab from '@/components/settings/TerminalTab'
import SystemTab from '@/components/settings/SystemTab'

interface Props {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
  onReset: () => void
}

type TabId = 'general' | 'ui' | 'security' | 'ai' | 'telegram' | 'log-alerts' | 'tunnels' | 'terminal' | 'system'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general',    label: 'General'    },
  { id: 'ui',         label: 'UI'         },
  { id: 'security',   label: 'Security'   },
  { id: 'ai',         label: 'AI'         },
  { id: 'telegram',   label: 'Telegram'   },
  { id: 'log-alerts', label: 'Log Alerts' },
  { id: 'tunnels',    label: 'Tunnels'    },
  { id: 'terminal',   label: 'Terminal'   },
  { id: 'system',     label: 'System'     },
]

// @group BusinessLogic > SettingsPage : Main settings page — tab bar + active tab routing
export default function SettingsPage({ settings, onUpdate, onReset }: Props) {
  const isDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)
  const { tab } = useParams<{ tab?: string }>()
  const navigate = useNavigate()
  const activeTab: TabId = (TABS.some(t => t.id === tab) ? tab : 'general') as TabId

  function tabStyle(active: boolean): React.CSSProperties {
    return {
      padding: '8px 18px',
      fontSize: 13,
      fontWeight: active ? 600 : 400,
      color: active ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
      background: 'transparent',
      border: 'none',
      borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
      cursor: 'pointer',
      marginBottom: -1,
      transition: 'color 0.15s',
    }
  }

  return (
    <div style={{ padding: '20px 28px' }}>

      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Settings</h2>
        {activeTab === 'general' && !isDefault && (
          <button
            type="button"
            onClick={onReset}
            style={{
              padding: '6px 14px', fontSize: 12,
              background: 'transparent',
              border: '1px solid var(--color-destructive)',
              borderRadius: 5, cursor: 'pointer',
              color: 'var(--color-destructive)',
            }}
          >
            Reset to defaults
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-border)', marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.id} style={tabStyle(activeTab === t.id)} onClick={() => navigate(`/settings/${t.id}`)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Active tab */}
      {activeTab === 'general'    && <GeneralTab    settings={settings} onUpdate={onUpdate} />}
      {activeTab === 'ui'         && <UiTab         settings={settings} onUpdate={onUpdate} />}
      {activeTab === 'security'   && <SecurityTab   />}
      {activeTab === 'ai'         && <AiTab         />}
      {activeTab === 'telegram'   && <TelegramTab   />}
      {activeTab === 'log-alerts' && <LogAlertsTab  />}
      {activeTab === 'tunnels'    && <TunnelsTab    />}
      {activeTab === 'terminal'   && <TerminalTab   settings={settings} onUpdate={onUpdate} />}
      {activeTab === 'system'     && <SystemTab     />}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
