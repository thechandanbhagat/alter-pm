// @group UnitTests : ScriptsPage component — rendering, interactions, and API integration

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import type { ScriptInfo } from '@/types'

// @group TestHelpers : Mock the api module (avoids actual fetch calls in unit tests)
vi.mock('@/lib/api', () => ({
  api: {
    listScripts: vi.fn(),
    getScript: vi.fn(),
    saveScript: vi.fn(),
    deleteScript: vi.fn(),
    runScript: vi.fn(),
  },
}))

import ScriptsPage from '@/pages/ScriptsPage'
import { api } from '@/lib/api'

// @group TestHelpers : Helpers to build ScriptInfo fixtures
function makeScript(overrides: Partial<ScriptInfo> = {}): ScriptInfo {
  return {
    name: 'my-script',
    language: 'python',
    size_bytes: 256,
    modified_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago
    ...overrides,
  }
}

// @group TestHelpers : Render ScriptsPage with necessary providers
function renderPage() {
  return render(<ScriptsPage />)
}

// @group TestSetup : Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
  // Default: empty script list
  vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
})

// @group UnitTests > ScriptsPage > Rendering : Loading state shown initially
describe('ScriptsPage loading', () => {
  it('shows Loading text while scripts are being fetched', () => {
    // listScripts never resolves in this test
    vi.mocked(api.listScripts).mockReturnValue(new Promise(() => {}))
    renderPage()
    // The loading overlay is shown when loading=true AND scripts.length===0
    expect(screen.getByText(/Loading/i)).toBeInTheDocument()
  })
})

// @group UnitTests > ScriptsPage > Rendering : Empty state
describe('ScriptsPage empty state', () => {
  it('renders empty state message when there are no scripts', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/No scripts yet/i)).toBeInTheDocument()
    })
  })

  it('shows a New button in the empty script list', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/No scripts yet/i)).toBeInTheDocument()
    })
    // There should be at least one "New" button
    const newButtons = screen.getAllByText(/New/i)
    expect(newButtons.length).toBeGreaterThan(0)
  })

  it('shows the empty editor state prompt', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Select a script or create a new one/i)).toBeInTheDocument()
    })
  })
})

// @group UnitTests > ScriptsPage > Rendering : Script list populated
describe('ScriptsPage with scripts', () => {
  it('renders script names from the API response', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({
      scripts: [
        makeScript({ name: 'deploy.py', language: 'python' }),
        makeScript({ name: 'backup.sh', language: 'bash' }),
      ],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('deploy.py')).toBeInTheDocument()
      expect(screen.getByText('backup.sh')).toBeInTheDocument()
    })
  })

  it('renders language badges for each script', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({
      scripts: [makeScript({ name: 'app.py', language: 'python' })],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('python')).toBeInTheDocument()
    })
  })

  it('renders file size for each script', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({
      scripts: [makeScript({ name: 'app.py', size_bytes: 1024 })],
    })
    renderPage()
    await waitFor(() => {
      // 1024 bytes = 1.0 KB
      expect(screen.getByText('1.0 KB')).toBeInTheDocument()
    })
  })

  it('shows small size in bytes for tiny scripts', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({
      scripts: [makeScript({ name: 'tiny.py', size_bytes: 50 })],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('50 B')).toBeInTheDocument()
    })
  })
})

// @group UnitTests > ScriptsPage > Interactions : New script creation flow
describe('ScriptsPage new script', () => {
  it('clicking New opens a blank editor', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()

    // Wait for empty state, then click New
    await waitFor(() => screen.getByText(/No scripts yet/i))

    const newBtn = screen.getAllByText(/New/i)[0]
    await userEvent.click(newBtn)

    // Editor should now show a name input (placeholder "Script name")
    expect(screen.getByPlaceholderText('Script name')).toBeInTheDocument()
  })

  it('new editor defaults to python language', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    const newBtn = screen.getAllByText(/New/i)[0]
    await userEvent.click(newBtn)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('python')
  })

  it('Save button is present in editor toolbar', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    await userEvent.click(screen.getAllByText(/New/i)[0])
    expect(screen.getByText('Save')).toBeInTheDocument()
  })

  it('Run button is disabled for new unsaved script', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    await userEvent.click(screen.getAllByText(/New/i)[0])

    const runBtn = screen.getByText('Run').closest('button') as HTMLButtonElement
    expect(runBtn.disabled).toBe(true)
  })

  it('shows "Save the script before running it" hint for new scripts', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    await userEvent.click(screen.getAllByText(/New/i)[0])
    expect(screen.getByText(/Save the script before running it/i)).toBeInTheDocument()
  })
})

// @group UnitTests > ScriptsPage > Interactions : Save validation
describe('ScriptsPage save validation', () => {
  it('shows error when trying to save with empty name', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    vi.mocked(api.saveScript).mockResolvedValue({})
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    await userEvent.click(screen.getAllByText(/New/i)[0])

    // Leave name empty and click Save
    await userEvent.click(screen.getByText('Save'))

    expect(screen.getByText(/Name is required/i)).toBeInTheDocument()
    expect(api.saveScript).not.toHaveBeenCalled()
  })

  it('calls api.saveScript with name, language, content when valid', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    vi.mocked(api.saveScript).mockResolvedValue({})
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    await userEvent.click(screen.getAllByText(/New/i)[0])

    // Type a name
    const nameInput = screen.getByPlaceholderText('Script name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'my-test-script')

    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(api.saveScript).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-test-script',
          language: expect.any(String),
          content: expect.any(String),
        })
      )
    })
  })
})

// @group UnitTests > ScriptsPage > Interactions : Selecting a script
describe('ScriptsPage script selection', () => {
  it('clicking a script calls api.getScript', async () => {
    const script = makeScript({ name: 'hello.py', language: 'python' })
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [script] })
    vi.mocked(api.getScript).mockResolvedValue({
      name: 'hello.py',
      language: 'python',
      content: 'print("hello")',
    })

    renderPage()
    await waitFor(() => screen.getByText('hello.py'))

    await userEvent.click(screen.getByText('hello.py'))

    await waitFor(() => {
      expect(api.getScript).toHaveBeenCalledWith('hello.py')
    })
  })
})

// @group UnitTests > ScriptsPage > Interactions : Back button closes editor
describe('ScriptsPage back navigation', () => {
  it('back button closes editor and shows empty state', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    // Open editor
    await userEvent.click(screen.getAllByText(/New/i)[0])
    expect(screen.getByPlaceholderText('Script name')).toBeInTheDocument()

    // Click back button (ChevronLeft icon button)
    const backBtn = screen.getByTitle('Back to list')
    await userEvent.click(backBtn)

    // Editor should be gone, empty state prompt visible
    await waitFor(() => {
      expect(screen.getByText(/Select a script or create a new one/i)).toBeInTheDocument()
    })
  })
})

// @group UnitTests > ScriptsPage > Interactions : Language switching
describe('ScriptsPage language selector', () => {
  it('changing language updates the select value', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    await userEvent.click(screen.getAllByText(/New/i)[0])

    const select = screen.getByRole('combobox') as HTMLSelectElement
    await userEvent.selectOptions(select, 'bash')

    expect(select.value).toBe('bash')
  })

  it('all language options are present in select', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => screen.getByText(/No scripts yet/i))

    await userEvent.click(screen.getAllByText(/New/i)[0])

    const select = screen.getByRole('combobox')
    const options = Array.from((select as HTMLSelectElement).options).map(o => o.value)

    expect(options).toContain('python')
    expect(options).toContain('node')
    expect(options).toContain('bash')
    expect(options).toContain('powershell')
    expect(options).toContain('go')
  })
})

// @group UnitTests > ScriptsPage > Scripts header section
describe('ScriptsPage header', () => {
  it('renders the Scripts section header', async () => {
    vi.mocked(api.listScripts).mockResolvedValue({ scripts: [] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Scripts')).toBeInTheDocument()
    })
  })
})
