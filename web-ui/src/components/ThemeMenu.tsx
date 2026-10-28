import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { normalizeTheme, type ThemePreference } from '@/lib/theme'

interface Props {
  theme: ThemePreference
  onChange: (theme: ThemePreference) => void
  disabled?: boolean
}

const options = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export function ThemeMenu({ theme, onChange, disabled = false }: Props) {
  const selected = options.find(option => option.value === theme) ?? options[0]
  const Icon = selected.icon

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className="theme-menu-trigger"
          aria-label={`Theme: ${selected.label}`}
          title={`Theme: ${selected.label}`}
          disabled={disabled}
        >
          <Icon size={14} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="theme-menu-content"
          aria-label="Theme"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={value => onChange(normalizeTheme(value))}
          >
            {options.map(({ value, label, icon: OptionIcon }) => (
              <DropdownMenu.RadioItem key={value} value={value} className="theme-menu-item">
                <OptionIcon size={14} aria-hidden="true" />
                <span>{label}</span>
                <span className="theme-menu-check">
                  <DropdownMenu.ItemIndicator>
                    <Check size={13} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
