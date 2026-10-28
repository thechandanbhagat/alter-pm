// @group BusinessLogic : AI assistant panel — slide-in chat with markdown rendering

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Bot, Send, Trash2, Loader, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '@/lib/api'
import type { AiChatMessage, AiLocalProviderInfo, AiModelInfo } from '@/lib/api'
import { AI_PROVIDERS, AI_PROVIDER_LABELS, asAiProvider, defaultAiModel, isCliProvider, isLocalAiProvider, localProviderDisclosure, localProviderStatus, type AiProvider } from '@/lib/aiProviders'

// @group Configuration > AiPanel : Starter prompt suggestions
const STARTER_PROMPTS_GENERIC = [
  'Which processes are currently running?',
  'What processes have crashed recently?',
  'How do I add a new process?',
  'Show me processes with high restart counts',
]
const STARTER_PROMPTS_PROCESS = [
  'Why did this process crash?',
  'Show me recent error logs',
  'Is the config for this process correct?',
  'How do I restart this process automatically?',
]

// @group BusinessLogic > AiPanel : Props
interface AiPanelProps {
  open: boolean
  processId?: string | null
  processName?: string | null
  onClose: () => void
}

const panelWidth = 360

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28,
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--color-muted-foreground)', borderRadius: 5,
}

// @group Utilities > Markdown : Lightweight markdown-to-JSX renderer for AI responses
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  function renderInline(raw: string): React.ReactNode[] {
    // Bold (**text** or __text__), italic (*text* or _text_), inline code (`code`)
    const parts: React.ReactNode[] = []
    const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)|_([^_]+)_)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      if (m.index > last) parts.push(raw.slice(last, m.index))
      const token = m[0]
      if (token.startsWith('`')) {
        parts.push(<code key={m.index} style={{ fontFamily: 'monospace', fontSize: '0.9em', background: 'var(--color-muted)', padding: '1px 4px', borderRadius: 3 }}>{token.slice(1, -1)}</code>)
      } else if (token.startsWith('**') || token.startsWith('__')) {
        parts.push(<strong key={m.index} style={{ fontWeight: 600 }}>{token.slice(2, -2)}</strong>)
      } else {
        parts.push(<em key={m.index}>{token.slice(1, -1)}</em>)
      }
      last = m.index + token.length
    }
    if (last < raw.length) parts.push(raw.slice(last))
    return parts
  }

  while (i < lines.length) {
    const line = lines[i]

    // Heading: ### / ## / #
    const hm = line.match(/^(#{1,3})\s+(.+)$/)
    if (hm) {
      const level = hm[1].length
      const sizes = [15, 13, 12]
      elements.push(
        <div key={i} style={{ fontWeight: 700, fontSize: sizes[level - 1], marginTop: level === 1 ? 10 : 7, marginBottom: 3, color: 'var(--color-foreground)' }}>
          {renderInline(hm[2])}
        </div>
      )
      i++; continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '8px 0' }} />)
      i++; continue
    }

    // Unordered list: - item or * item
    if (/^[\s]*[-*]\s/.test(line)) {
      const listItems: React.ReactNode[] = []
      while (i < lines.length && /^[\s]*[-*]\s/.test(lines[i])) {
        listItems.push(
          <li key={i} style={{ marginBottom: 2 }}>{renderInline(lines[i].replace(/^[\s]*[-*]\s/, ''))}</li>
        )
        i++
      }
      elements.push(<ul key={`ul-${i}`} style={{ margin: '4px 0', paddingLeft: 18, listStyle: 'disc' }}>{listItems}</ul>)
      continue
    }

    // Ordered list: 1. item
    if (/^\d+\.\s/.test(line)) {
      const listItems: React.ReactNode[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(
          <li key={i} style={{ marginBottom: 2 }}>{renderInline(lines[i].replace(/^\d+\.\s/, ''))}</li>
        )
        i++
      }
      elements.push(<ol key={`ol-${i}`} style={{ margin: '4px 0', paddingLeft: 18 }}>{listItems}</ol>)
      continue
    }

    // Code block: ```
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]); i++
      }
      i++ // consume closing ```
      elements.push(
        <pre key={i} style={{
          background: 'var(--color-background)', borderRadius: 5, padding: '8px 10px',
          fontSize: 11, fontFamily: 'monospace', overflowX: 'auto',
          margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{codeLines.join('\n')}</pre>
      )
      continue
    }

    // Blank line — small gap
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 6 }} />)
      i++; continue
    }

    // Regular paragraph
    elements.push(<div key={i} style={{ marginBottom: 1 }}>{renderInline(line)}</div>)
    i++
  }

  return <>{elements}</>
}

// @group BusinessLogic > AiPanel : Main chat panel component
export function AiPanel({ open, processId, processName, onClose }: AiPanelProps) {
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const activeRequestRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [aiModel, setAiModel] = useState<string | undefined>(undefined)
  const [aiProvider, setAiProvider] = useState<AiProvider | undefined>(undefined)
  const [models, setModels] = useState<AiModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [localProviders, setLocalProviders] = useState<AiLocalProviderInfo[]>([])
  const [localLoading, setLocalLoading] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState('')
  const providerRef = useRef<AiProvider | undefined>(undefined)
  const modelRequestRef = useRef(0)
  const selectedLocal = localProviders.find(item => item.id === aiProvider)
  const modelDirty = isCliProvider(aiProvider) && (modelDraft.trim() || 'default') !== aiModel
  const canChat = settingsLoaded && !configSaving && !modelDirty &&
    (!isLocalAiProvider(aiProvider) || (!localLoading && !!selectedLocal?.available))

  const cancelRequest = useCallback(() => {
    activeRequestRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }, [])

  const closePanel = useCallback(() => {
    cancelRequest()
    onClose()
  }, [cancelRequest, onClose])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Read-only discovery: opening the panel never changes the configured provider.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.aiGetSettings().then(s => {
      if (cancelled) return
      const selected = asAiProvider(s.provider)
      providerRef.current = selected
      setAiModel(s.model || defaultAiModel(selected))
      setModelDraft(s.model === 'default' ? '' : s.model)
      setAiProvider(selected)
      setModels([])
      setSettingsLoaded(true)
    }).catch(error => { if (!cancelled) setError((error as Error).message || 'Unable to load AI settings.') })
    api.aiGetLocalProviders().then(data => {
      if (!cancelled) { setLocalProviders(data.providers); setLocalError(null) }
    }).catch(error => {
      if (!cancelled) { setLocalProviders([]); setLocalError((error as Error).message || 'Unable to check installed providers.') }
    }).finally(() => { if (!cancelled) setLocalLoading(false) })
    const timer = setTimeout(() => inputRef.current?.focus(), 80)
    return () => {
      cancelled = true
      clearTimeout(timer)
      modelRequestRef.current += 1
      cancelRequest()
    }
  }, [open, cancelRequest])

  async function loadModels() {
    const target = providerRef.current
    if (!target) return
    const request = ++modelRequestRef.current
    setModelsLoading(true)
    try {
      const { models: list } = await api.aiGetModels(target)
      if (request === modelRequestRef.current && providerRef.current === target) setModels(list)
    } catch (error) {
      if (request === modelRequestRef.current) setError((error as Error).message || 'Unable to load models.')
    } finally {
      if (request === modelRequestRef.current) setModelsLoading(false)
    }
  }

  async function handleProviderChange(prov: AiProvider) {
    if (streaming || configSaving) return
    if (isLocalAiProvider(prov) && !localProviders.find(item => item.id === prov)?.available) {
      setError('This provider is unavailable on the daemon host. Check Settings → AI → Installed providers.')
      return
    }
    ++modelRequestRef.current
    setConfigSaving(true)
    setError(null)
    try {
      const { models: list } = await api.aiGetModels(prov)
      const next = defaultAiModel(prov) || list[0]?.id
      if (!next) throw new Error('No models are available for this provider. Configure it in Settings → AI first.')
      await api.aiSaveSettings({ provider: prov, model: next })
      providerRef.current = prov
      setAiProvider(prov)
      setAiModel(next)
      setModelDraft(next === 'default' ? '' : next)
      setModels(list)
    } catch (error) {
      setError((error as Error).message || 'Unable to change AI provider.')
    } finally {
      setConfigSaving(false)
      setModelsLoading(false)
    }
  }

  async function handleModelChange(modelId: string) {
    if (!aiProvider || streaming || configSaving) return
    setConfigSaving(true)
    setError(null)
    const next = modelId.trim() || defaultAiModel(aiProvider)
    try {
      await api.aiSaveSettings({ provider: aiProvider, model: next })
      setAiModel(next)
      setModelDraft(next === 'default' ? '' : next)
    } catch (error) {
      setError((error as Error).message || 'Unable to change AI model.')
    } finally {
      setConfigSaving(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, closePanel])

  function clearChat() {
    cancelRequest()
    setMessages([])
    setError(null)
  }

  function submitMessage(text: string, history: AiChatMessage[]) {
    if (!text || streaming || !canChat || !open) return
    const request = ++activeRequestRef.current
    setInput('')
    setError(null)

    const userMsg: AiChatMessage = { role: 'user', content: text }
    const assistantMsg: AiChatMessage = { role: 'assistant', content: '' }
    setMessages([...history, userMsg, assistantMsg])
    setStreaming(true)

    const abort = api.aiChat(
      { message: text, process_id: processId ?? undefined, history, model: aiModel, provider: aiProvider },
      (delta) => {
        if (request !== activeRequestRef.current) return
        setMessages(prev => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + delta }
          return copy
        })
      },
      () => {
        if (request !== activeRequestRef.current) return
        abortRef.current = null
        setStreaming(false)
      },
      (err) => {
        if (request !== activeRequestRef.current) return
        abortRef.current = null
        setError(err)
        setStreaming(false)
      },
    )
    abortRef.current = abort
  }

  function sendMessage() {
    submitMessage(input.trim(), messages)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function sendStarter(prompt: string) {
    submitMessage(prompt, [])
  }

  const providerLabel = aiProvider ? (AI_PROVIDER_LABELS[aiProvider] ?? aiProvider) : null

  const panel = (
    <>
      {open && <div onClick={closePanel} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />}

      <div style={{
        position: 'fixed', top: 0, right: 0, width: panelWidth, height: 'calc(100vh - 22px)', zIndex: 200,
        background: 'var(--color-card)', borderLeft: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.35)',
        transform: open ? 'translateX(0)' : `translateX(${panelWidth + 4}px)`,
        transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: configOpen ? 'none' : '1px solid var(--color-border)', flexShrink: 0 }}>
          <Bot size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)' }}>AI Assistant</div>
            <div style={{ fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {processName ? `Context: ${processName}` : (providerLabel ?? 'AI')}
              {providerLabel && processName ? ` · ${providerLabel}` : ''}
            </div>
          </div>
          <button title={configOpen ? 'Hide settings' : 'Provider & model'} onClick={() => {
            if (!configOpen && models.length === 0) loadModels()
            setConfigOpen(v => !v)
          }} style={iconBtn}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-foreground)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-muted-foreground)' }}>
            {configOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button title="Clear chat" onClick={clearChat} style={iconBtn}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-foreground)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-muted-foreground)' }}>
            <Trash2 size={13} />
          </button>
          <button title="Close" onClick={closePanel} style={iconBtn}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-foreground)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-muted-foreground)' }}>
            <X size={14} />
          </button>
        </div>

        {/* Provider / model selector — collapsible */}
        {configOpen && (
          <div style={{ padding: '8px 14px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 10, color: 'var(--color-muted-foreground)', width: 48, flexShrink: 0 }}>Provider</label>
              <select
                value={aiProvider ?? ''}
                onChange={e => void handleProviderChange(asAiProvider(e.target.value))}
                aria-label="Chat AI provider"
                disabled={!settingsLoaded || configSaving || streaming}
                style={{ flex: 1, fontSize: 11, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-foreground)', cursor: 'pointer' }}
              >
                {!aiProvider && <option value="">— select —</option>}
                {AI_PROVIDERS.map(p => (
                  <option key={p} value={p} disabled={isLocalAiProvider(p) && (localLoading || !localProviders.find(item => item.id === p)?.available)}>
                    {AI_PROVIDER_LABELS[p]}{isLocalAiProvider(p) ? ` — ${localProviderStatus(localProviders.find(item => item.id === p), localLoading)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 10, color: 'var(--color-muted-foreground)', width: 48, flexShrink: 0 }}>Model</label>
              {isCliProvider(aiProvider) ? <>
                <input
                  aria-label="Chat CLI model ID"
                  value={modelDraft}
                  onChange={event => setModelDraft(event.target.value)}
                  placeholder="CLI default"
                  disabled={configSaving || streaming}
                  style={{ minWidth: 0, flex: 1, width: 100, fontSize: 11, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-foreground)' }}
                />
                <button onClick={() => void handleModelChange(modelDraft)} disabled={!modelDirty || configSaving || streaming} style={{ ...iconBtn, width: 'auto', padding: '0 6px', fontSize: 11 }}>Save model</button>
              </> : <select
                aria-label="Chat AI model"
                value={aiModel ?? ''}
                onChange={e => handleModelChange(e.target.value)}
                disabled={modelsLoading || models.length === 0 || configSaving || streaming}
                style={{ flex: 1, fontSize: 11, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-background)', color: modelsLoading ? 'var(--color-muted-foreground)' : 'var(--color-foreground)', cursor: models.length > 0 ? 'pointer' : 'default' }}
              >
                {modelsLoading && <option value="">Loading…</option>}
                {!modelsLoading && models.length === 0 && <option value="">{aiModel || '—'}</option>}
                {aiModel && models.length > 0 && !models.some(model => model.id === aiModel) && <option value={aiModel}>{aiModel}</option>}
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.label}{m.publisher ? ` (${m.publisher})` : ''}</option>
                ))}
              </select>}
              <button title="Refresh models" onClick={() => void loadModels()} disabled={modelsLoading || configSaving || streaming} style={{ ...iconBtn, flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-foreground)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-muted-foreground)' }}>
                <RefreshCw size={11} style={modelsLoading ? { animation: 'spin 1s linear infinite' } : {}} />
              </button>
            </div>
          </div>
        )}

        {isLocalAiProvider(aiProvider) && <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 11, lineHeight: 1.5 }}>
          <p style={{ color: selectedLocal?.available ? 'var(--color-status-running)' : 'var(--color-muted-foreground)' }}>
            <strong>{localProviderStatus(selectedLocal, localLoading)}</strong> — {selectedLocal?.detail || localError || 'Check Settings → AI → Installed providers on the daemon host.'}
          </p>
          <p style={{ color: 'var(--color-muted-foreground)', marginTop: 4 }}>{localProviderDisclosure(aiProvider)}</p>
          {!selectedLocal?.available && <a href="/settings/ai" style={{ color: 'var(--color-primary)' }}>Configure installed providers</a>}
        </div>}
        {configOpen && localError && !isLocalAiProvider(aiProvider) && <p role="alert" style={{ fontSize: 11, padding: '0 14px 8px', color: 'var(--color-destructive)' }}>{localError}</p>}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 && !error && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted-foreground)', gap: 10, paddingBottom: 20 }}>
              <Bot size={28} style={{ opacity: 0.35 }} />
              <div style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.5 }}>
                Ask about your processes,<br />logs, crashes, or config.
              </div>
              {processName && (
                <div style={{ fontSize: 11, padding: '4px 10px', background: 'var(--color-accent)', borderRadius: 12, color: 'var(--color-primary)', fontWeight: 500 }}>
                  Process context: {processName}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 4 }}>
                {(processName ? STARTER_PROMPTS_PROCESS : STARTER_PROMPTS_GENERIC).map(p => (
                  <button key={p} onClick={() => sendStarter(p)} disabled={!canChat || streaming} style={{
                    width: '100%', textAlign: 'left', padding: '7px 11px',
                    fontSize: 11, lineHeight: 1.4, cursor: 'pointer',
                    background: 'var(--color-secondary)', color: 'var(--color-foreground)',
                    border: '1px solid var(--color-border)', borderRadius: 8,
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent)'; e.currentTarget.style.borderColor = 'var(--color-primary)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)' }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '88%',
                padding: '8px 11px',
                borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-secondary)',
                color: msg.role === 'user' ? '#fff' : 'var(--color-foreground)',
                fontSize: 12, lineHeight: 1.6, wordBreak: 'break-word',
              }}>
                {msg.role === 'assistant'
                  ? <>
                      <MarkdownBlock text={msg.content} />
                      {msg.content === '' && streaming && <span style={{ opacity: 0.5 }}>●</span>}
                    </>
                  : msg.content
                }
              </div>
            </div>
          ))}

          {error && (
            <div role="alert" style={{
              fontSize: 11, color: 'var(--color-destructive)', padding: '8px 10px',
              background: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
              borderRadius: 6, border: '1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent)',
            }}>
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Enter to send)"
            rows={1}
            disabled={streaming || !canChat}
            style={{
              flex: 1, resize: 'none', padding: '7px 10px', fontSize: 12,
              borderRadius: 6, border: '1px solid var(--color-border)',
              background: 'var(--color-background)', color: 'var(--color-foreground)',
              fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
              maxHeight: 100, overflowY: 'auto', opacity: streaming ? 0.6 : 1,
            }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 100) + 'px'
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming || !canChat}
            title="Send (Enter)"
            style={{
              width: 32, height: 32, flexShrink: 0, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: (!input.trim() || streaming || !canChat) ? 'var(--color-secondary)' : 'var(--color-primary)',
              color: (!input.trim() || streaming || !canChat) ? 'var(--color-muted-foreground)' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
            }}
          >
            {streaming ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )

  return createPortal(panel, document.body)
}
