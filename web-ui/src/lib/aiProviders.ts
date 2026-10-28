import type { AiLocalProviderInfo } from '@/lib/api'

export const AI_PROVIDER_LABELS = {
  ollama: 'Ollama (local)',
  copilot: 'GitHub Copilot',
  github: 'GitHub Models',
  claude: 'Claude (Anthropic API)',
  openai: 'OpenAI-compatible API',
  'claude-cli': 'Claude Code CLI',
  'codex-cli': 'Codex CLI',
  'cursor-cli': 'Cursor CLI',
  'antigravity-cli': 'Google Antigravity (agy)',
  'devin-cli': 'Devin CLI',
  'apple-foundation': 'Apple Foundation Models',
} as const

export type AiProvider = keyof typeof AI_PROVIDER_LABELS
export const AI_PROVIDERS = Object.keys(AI_PROVIDER_LABELS) as AiProvider[]
export const LOCAL_AI_PROVIDERS = [
  'claude-cli', 'codex-cli', 'cursor-cli', 'antigravity-cli', 'devin-cli', 'apple-foundation',
] as const
export type LocalAiProvider = typeof LOCAL_AI_PROVIDERS[number]

export function asAiProvider(value: string): AiProvider {
  return Object.hasOwn(AI_PROVIDER_LABELS, value) ? value as AiProvider : 'ollama'
}

export function isLocalAiProvider(value: string | undefined): value is LocalAiProvider {
  return LOCAL_AI_PROVIDERS.some(provider => provider === value)
}

export function isCliProvider(value: string | undefined): boolean {
  return isLocalAiProvider(value) && value !== 'apple-foundation'
}

export function defaultAiModel(provider: AiProvider): string {
  return provider === 'apple-foundation' ? 'apple-system' : isCliProvider(provider) ? 'default' : ''
}

export function localProviderStatus(provider: AiLocalProviderInfo | undefined, loading = false): string {
  if (loading) return 'Checking…'
  if (!provider) return 'Not checked'
  if (provider.available) return 'Available'
  if (provider.installed || provider.id === 'apple-foundation') return 'Unavailable'
  return 'Not found'
}

export function localProviderDisclosure(provider: string): string {
  return provider === 'apple-foundation'
    ? 'Runs on the daemon host using Apple’s on-device model. Requires macOS 26+, Apple silicon, and Apple Intelligence.'
    : 'Uses the CLI login on the daemon host. Prompts, process details, and logs are sent to the provider’s cloud when you send a message.'
}

export function emptyCliPaths(): Record<string, string> {
  return Object.fromEntries(LOCAL_AI_PROVIDERS.filter(isCliProvider).map(provider => [provider, '']))
}

export function isAbsoluteExecutablePath(value: string): boolean {
  return value === '' || /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)
}
