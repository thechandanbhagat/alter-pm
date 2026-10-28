import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '@/components/AiPanel'
import AiTab from '@/components/settings/AiTab'
import { api, type AiLocalProviderInfo, type AiSettingsInfo } from '@/lib/api'
import { AI_PROVIDER_LABELS, LOCAL_AI_PROVIDERS, isAbsoluteExecutablePath } from '@/lib/aiProviders'

const settings: AiSettingsInfo = {
  provider: 'ollama', enabled: true, model: 'old-ollama-model',
  github_token_set: false, github_token_hint: '', github_username: '', client_id_set: false, client_id_builtin: false,
  anthropic_key_set: false, anthropic_key_hint: '', openai_key_set: false, openai_key_hint: '',
  openai_base_url: 'https://api.openai.com/v1', ollama_base_url: 'http://localhost:11434',
  local_cli_paths: { 'codex-cli': '/opt/bin/codex' },
}

const localProviders: AiLocalProviderInfo[] = LOCAL_AI_PROVIDERS.map(id => ({
  id, name: AI_PROVIDER_LABELS[id], installed: id === 'codex-cli' || id === 'antigravity-cli',
  available: id === 'codex-cli', path: id === 'codex-cli' ? '/opt/bin/codex' : null,
  version: id === 'codex-cli' ? 'test-version' : null,
  detail: id === 'codex-cli' ? 'Installed; uses the CLI login.' : id === 'antigravity-cli'
    ? 'This CLI cannot isolate tools for a read-only analysis request.' : 'Unavailable on this daemon host.',
  inference: id === 'apple-foundation' ? 'on-device' : 'cloud',
}))

beforeEach(() => {
  vi.spyOn(api, 'aiGetSettings').mockResolvedValue(settings)
  vi.spyOn(api, 'aiGetLocalProviders').mockResolvedValue({ providers: localProviders })
  vi.spyOn(api, 'aiGetModels').mockImplementation(async provider => ({ models: [{
    id: provider?.endsWith('-cli') ? 'default' : provider === 'apple-foundation' ? 'apple-system' : 'old-ollama-model',
    label: provider?.endsWith('-cli') ? 'CLI default' : 'Test model', publisher: '',
  }] }))
  vi.spyOn(api, 'aiSaveSettings').mockResolvedValue({ success: true })
  vi.spyOn(api, 'aiChat').mockReturnValue(new AbortController())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('installed provider settings', () => {
  it('discovers all requested providers without saving or sending chat, and refreshes the selected provider read-only', async () => {
    const user = userEvent.setup()
    render(<AiTab />)
    const selector = screen.getByRole('combobox', { name: 'AI provider' })
    await waitFor(() => expect(selector).toBeEnabled())
    await waitFor(() => expect(api.aiGetLocalProviders).toHaveBeenCalled())
    for (const id of LOCAL_AI_PROVIDERS) {
      expect(screen.getByRole('option', { name: new RegExp(AI_PROVIDER_LABELS[id].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeInTheDocument()
    }
    await user.selectOptions(selector, 'codex-cli')
    await waitFor(() => expect(api.aiGetModels).toHaveBeenLastCalledWith('codex-cli'))
    await user.click(screen.getByTitle('Refresh model list'))
    expect(api.aiGetModels).toHaveBeenLastCalledWith('codex-cli')
    expect(api.aiSaveSettings).not.toHaveBeenCalled()
    expect(api.aiChat).not.toHaveBeenCalled()
    expect(screen.getByText(/Prompts, process details, and logs are sent to the provider’s cloud/)).toBeInTheDocument()
  })

  it('saves the new provider and CLI default together without carrying over an Ollama model', async () => {
    const user = userEvent.setup()
    render(<AiTab />)
    const selector = screen.getByRole('combobox', { name: 'AI provider' })
    await waitFor(() => expect(selector).toBeEnabled())
    await user.selectOptions(selector, 'codex-cli')
    expect(screen.getByRole('textbox', { name: 'CLI model ID' })).toHaveValue('')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(api.aiSaveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'codex-cli', model: 'default' }))
  })

  it('saves custom executable paths without changing the selected provider and clears overrides explicitly', async () => {
    const user = userEvent.setup()
    render(<AiTab />)
    const path = screen.getByRole('textbox', { name: 'Codex CLI executable path (optional)' })
    await waitFor(() => expect(path).toHaveValue('/opt/bin/codex'))
    await user.clear(path)
    await user.type(path, 'C:\\Tools\\Codex\\codex.exe')
    await user.click(screen.getByRole('button', { name: 'Save paths & rescan' }))
    await waitFor(() => expect(api.aiSaveSettings).toHaveBeenCalledWith({
      local_cli_paths: expect.objectContaining({ 'codex-cli': 'C:\\Tools\\Codex\\codex.exe' }),
    }))
    await waitFor(() => expect(path).toBeEnabled())
    await user.clear(path)
    await user.click(screen.getByRole('button', { name: 'Save paths & rescan' }))
    expect(api.aiSaveSettings).toHaveBeenLastCalledWith({ local_cli_paths: expect.objectContaining({ 'codex-cli': '' }) })
    expect(screen.queryByRole('textbox', { name: /Apple Foundation Models executable path/ })).not.toBeInTheDocument()
  })

  it('reports invalid relative paths and persistence failures', async () => {
    const user = userEvent.setup()
    render(<AiTab />)
    const path = screen.getByRole('textbox', { name: 'Codex CLI executable path (optional)' })
    await waitFor(() => expect(path).toBeEnabled())
    await user.clear(path)
    await user.type(path, 'bin/codex')
    await user.click(screen.getByRole('button', { name: 'Save paths & rescan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('absolute executable path')
    expect(api.aiSaveSettings).not.toHaveBeenCalled()

    await user.clear(path)
    vi.mocked(api.aiSaveSettings).mockRejectedValueOnce(new Error('Settings file is read-only'))
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(await screen.findByText('Settings file is read-only')).toBeInTheDocument()
  })

  it('displays unsupported providers as unavailable and explains the daemon host requirement', async () => {
    const user = userEvent.setup()
    render(<AiTab />)
    const selector = screen.getByRole('combobox', { name: 'AI provider' })
    await waitFor(() => expect(selector).toBeEnabled())
    await user.selectOptions(selector, 'antigravity-cli')
    expect(screen.getByRole('option', { name: 'Google Antigravity (agy) — Unavailable' })).toBeInTheDocument()
    expect(screen.getAllByText(/cannot isolate tools for a read-only analysis request/)).toHaveLength(2)
    expect(screen.getByText(/Discovery runs on the active daemon host/)).toBeInTheDocument()
    expect(api.aiChat).not.toHaveBeenCalled()
  })
})

describe('AI chat provider selection', () => {
  it('refreshes models without mutations and switches provider/model together', async () => {
    const user = userEvent.setup()
    render(<AiPanel open onClose={() => {}} />)
    await waitFor(() => expect(api.aiGetSettings).toHaveBeenCalled())
    await user.click(screen.getByTitle('Provider & model'))
    await waitFor(() => expect(api.aiGetModels).toHaveBeenCalledWith('ollama'))
    expect(api.aiSaveSettings).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chat AI provider' }), 'codex-cli')
    await waitFor(() => expect(api.aiSaveSettings).toHaveBeenCalledExactlyOnceWith({ provider: 'codex-cli', model: 'default' }))
    expect(screen.getByRole('option', { name: 'Google Antigravity (agy) — Unavailable' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Cursor CLI — Not found' })).toBeDisabled()
    vi.mocked(api.aiSaveSettings).mockClear()
    await user.click(screen.getByTitle('Refresh models'))
    await waitFor(() => expect(api.aiGetModels).toHaveBeenLastCalledWith('codex-cli'))
    expect(api.aiSaveSettings).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: 'Chat CLI model ID' }), 'my-cli-model')
    await user.click(screen.getByRole('button', { name: 'Save model' }))
    await waitFor(() => expect(api.aiSaveSettings).toHaveBeenCalledWith({ provider: 'codex-cli', model: 'my-cli-model' }))
  })

  it('prevents sending to an unavailable adapter and shows how to configure it', async () => {
    vi.mocked(api.aiGetSettings).mockResolvedValue({ ...settings, provider: 'antigravity-cli', model: 'default' })
    render(<AiPanel open onClose={() => {}} />)
    expect(await screen.findByText(/cannot isolate tools for a read-only analysis request/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ask anything… (Enter to send)')).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Configure installed providers' })).toHaveAttribute('href', '/settings/ai')
    expect(api.aiChat).not.toHaveBeenCalled()
  })

  it('sends the current question once with process context, only after the user submits', async () => {
    const user = userEvent.setup()
    render(<AiPanel open processId="example-process" processName="Example" onClose={() => {}} />)
    const input = screen.getByPlaceholderText('Ask anything… (Enter to send)')
    await waitFor(() => expect(input).toBeEnabled())
    expect(api.aiChat).not.toHaveBeenCalled()
    await user.type(input, 'Why did this fail?')
    await user.click(screen.getByTitle('Send (Enter)'))
    expect(api.aiChat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Why did this fail?', process_id: 'example-process', history: [], provider: 'ollama', model: 'old-ollama-model',
    }), expect.any(Function), expect.any(Function), expect.any(Function))
  })

  it.each(['Close', 'Clear chat'])('cancels generation when the user chooses %s', async action => {
    const user = userEvent.setup()
    const controller = new AbortController()
    vi.mocked(api.aiChat).mockReturnValue(controller)
    const onClose = vi.fn()
    render(<AiPanel open onClose={onClose} />)
    const input = screen.getByPlaceholderText('Ask anything… (Enter to send)')
    await waitFor(() => expect(input).toBeEnabled())
    await user.click(screen.getByTitle('Provider & model'))
    await user.type(input, 'Check this process')
    await user.click(screen.getByTitle('Send (Enter)'))
    expect(screen.getByRole('combobox', { name: 'Chat AI provider' })).toBeDisabled()
    await user.click(screen.getByTitle(action))
    expect(controller.signal.aborted).toBe(true)
    if (action === 'Close') expect(onClose).toHaveBeenCalledOnce()
  })

  it.each(['hide', 'unmount'])('cancels generation when the parent chooses to %s the panel', async action => {
    const user = userEvent.setup()
    const controller = new AbortController()
    vi.mocked(api.aiChat).mockReturnValue(controller)
    const { rerender, unmount } = render(<AiPanel open onClose={() => {}} />)
    const input = screen.getByPlaceholderText('Ask anything… (Enter to send)')
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Check this process')
    await user.click(screen.getByTitle('Send (Enter)'))
    if (action === 'hide') rerender(<AiPanel open={false} onClose={() => {}} />)
    else unmount()
    expect(controller.signal.aborted).toBe(true)
  })

  it('ignores late callbacks from a cleared request after a new generation starts', async () => {
    const user = userEvent.setup()
    render(<AiPanel open onClose={() => {}} />)
    const input = screen.getByPlaceholderText('Ask anything… (Enter to send)')
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'First question')
    await user.click(screen.getByTitle('Send (Enter)'))
    const oldCallbacks = vi.mocked(api.aiChat).mock.calls[0]
    await user.click(screen.getByTitle('Clear chat'))
    await user.type(input, 'Second question')
    await user.click(screen.getByTitle('Send (Enter)'))
    act(() => {
      oldCallbacks[1]('stale answer')
      oldCallbacks[2]()
      oldCallbacks[3]('stale error')
      vi.mocked(api.aiChat).mock.calls[1][1]('current answer')
    })
    expect(screen.queryByText('stale answer')).not.toBeInTheDocument()
    expect(screen.queryByText('stale error')).not.toBeInTheDocument()
    expect(screen.getByText('current answer')).toBeInTheDocument()
    expect(input).toBeDisabled()
  })
})

describe('AI response stream cleanup', () => {
  function streamRequest() {
    vi.mocked(api.aiChat).mockRestore()
    vi.stubGlobal('localStorage', { getItem: () => null })
    let source!: ReadableStreamDefaultController<Uint8Array>
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { source = controller },
      cancel,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const controller = api.aiChat({ message: 'Check logs', history: [] }, onDelta, onDone, onError)
    return { source, cancel, body, onDelta, onDone, onError, controller }
  }

  it.each(['done', 'error'])('cancels and releases the stream on an SSE %s event', async terminal => {
    const stream = streamRequest()
    stream.source.enqueue(new TextEncoder().encode(`data: {"delta":"answer"}\n\ndata: ${terminal === 'done' ? '{"done":true}' : '{"error":"Provider failed"}'}\n\ndata: {"delta":"ignored"}\n\n`))
    await waitFor(() => expect(stream.cancel).toHaveBeenCalledOnce())
    expect(stream.body.locked).toBe(false)
    expect(stream.onDelta).toHaveBeenCalledExactlyOnceWith('answer')
    if (terminal === 'done') {
      expect(stream.onDone).toHaveBeenCalledOnce()
      expect(stream.onError).not.toHaveBeenCalled()
    } else {
      expect(stream.onError).toHaveBeenCalledExactlyOnceWith('Provider failed')
      expect(stream.onDone).not.toHaveBeenCalled()
    }
  })

  it('cancels a pending stream read on abort without delivering completion or error callbacks', async () => {
    const stream = streamRequest()
    await waitFor(() => expect(stream.body.locked).toBe(true))
    stream.controller.abort()
    await waitFor(() => expect(stream.cancel).toHaveBeenCalledOnce())
    expect(stream.body.locked).toBe(false)
    expect(stream.onDelta).not.toHaveBeenCalled()
    expect(stream.onDone).not.toHaveBeenCalled()
    expect(stream.onError).not.toHaveBeenCalled()
  })
})

describe('provider API and paths', () => {
  it('requests the selected provider catalog using a read-only query', async () => {
    vi.mocked(api.aiGetModels).mockRestore()
    vi.stubGlobal('localStorage', { getItem: () => null })
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ models: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await api.aiGetModels('codex-cli')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/ai/models?provider=codex-cli', expect.not.objectContaining({ method: 'PUT' }))
  })

  it.each(['', '/opt/bin/codex', 'C:\\Program Files\\Codex\\codex.exe', '\\\\server\\tools\\codex.exe'])(
    'accepts absolute host paths or automatic discovery: %s', path => expect(isAbsoluteExecutablePath(path)).toBe(true),
  )
  it.each(['codex', './bin/codex', '~/bin/codex', 'C:codex.exe'])(
    'rejects paths that depend on a working directory: %s', path => expect(isAbsoluteExecutablePath(path)).toBe(false),
  )
})
