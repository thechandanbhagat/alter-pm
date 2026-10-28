import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UiTab from '@/components/settings/UiTab'
import { ThemeMenu } from '@/components/ThemeMenu'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '@/lib/settings'
import { _setRemoteServerCache, type RemoteServer } from '@/lib/servers'
import { applyTheme, initializeTheme, readCachedTheme } from '@/lib/theme'

function mockSystemTheme(initiallyDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = {
    matches: initiallyDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    }),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  return {
    media,
    change(dark: boolean) {
      media.matches = dark
      listeners.forEach(listener => listener({ matches: dark } as MediaQueryListEvent))
    },
  }
}

function expectTheme(theme: 'dark' | 'light') {
  expect(document.documentElement).toHaveAttribute('data-theme', theme)
  expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
  expect(document.documentElement.style.colorScheme).toBe(theme)
}

beforeEach(() => {
  // Node's experimental Web Storage can shadow jsdom's storage in Vitest.
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    key: (index: number) => [...values.keys()][index] ?? null,
  } satisfies Storage)
  _setRemoteServerCache([])
  mockSystemTheme(false)
  applyTheme('dark')
})

afterEach(() => {
  cleanup()
  applyTheme('dark')
  _setRemoteServerCache([])
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('theme preference', () => {
  it('applies explicit themes regardless of the operating system preference', () => {
    const system = mockSystemTheme(true)
    applyTheme('light')
    expectTheme('light')
    system.change(false)
    applyTheme('dark')
    expectTheme('dark')
  })

  it('follows system changes live and stops following when an explicit theme is chosen', () => {
    const system = mockSystemTheme(false)
    applyTheme('system')
    expectTheme('light')
    expect(readCachedTheme()).toBe('system')

    system.change(true)
    expectTheme('dark')
    system.change(false)
    expectTheme('light')

    applyTheme('dark')
    expect(system.media.removeEventListener).toHaveBeenCalled()
    system.change(false)
    expectTheme('dark')
  })

  it('restores the cached preference before daemon settings load', () => {
    localStorage.setItem('alter_theme_local', 'light')
    initializeTheme()
    expectTheme('light')
  })

  it('keeps cached preferences separate for each daemon', () => {
    applyTheme('light')
    localStorage.setItem('alter_active_server', 'remote-example')
    expect(readCachedTheme()).toBe('dark')
    applyTheme('system')
    expect(localStorage.getItem('alter_theme_remote-example')).toBe('system')

    localStorage.removeItem('alter_active_server')
    expect(readCachedTheme()).toBe('light')
  })

  it('falls back to Dark for an invalid cached preference', () => {
    localStorage.setItem('alter_theme_local', 'sepia')
    initializeTheme()
    expectTheme('dark')
  })

  it('still changes appearance when browser storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })

    expect(() => initializeTheme()).not.toThrow()
    expectTheme('dark')
    expect(() => applyTheme('light')).not.toThrow()
    expectTheme('light')
  })
})

describe('persisted UI settings', () => {
  it.each([{}, { theme: 'sepia' }, { theme: null }])(
    'uses Dark for legacy or invalid daemon settings: %j',
    async raw => {
      localStorage.setItem('alter_theme_local', 'light')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(raw)))
      expect((await loadSettings()).theme).toBe('dark')
    },
  )

  it('keeps the cached appearance when the daemon is unavailable', async () => {
    localStorage.setItem('alter_theme_local', 'light')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')))
    expect((await loadSettings()).theme).toBe('light')
  })

  it('keeps the cached appearance when the daemon rejects the request', async () => {
    localStorage.setItem('alter_theme_local', 'system')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    expect((await loadSettings()).theme).toBe('system')
  })

  it.each(['load', 'save'] as const)(
    'resolves the selected remote daemon before a cold-start settings %s',
    async operation => {
      const remote: RemoteServer = {
        id: 'remote-example', name: 'Remote', host: '192.0.2.10', port: 4000, connectionType: 'direct',
      }
      localStorage.setItem('alter_active_server', remote.id)
      const remoteSettingsUrl = 'http://192.0.2.10:4000/api/v1/system/ui-settings'
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/v1/system/remote-servers') return Response.json({ servers: [remote] })
        if (url === remoteSettingsUrl) {
          return init?.method === 'PUT'
            ? new Response(null, { status: 204 })
            : Response.json({ theme: 'light' })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      if (operation === 'load') {
        expect((await loadSettings()).theme).toBe('light')
      } else {
        await saveSettings({ ...DEFAULT_SETTINGS, theme: 'system' })
      }

      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        '/api/v1/system/remote-servers', remoteSettingsUrl,
      ])
      if (operation === 'save') {
        expect(fetchMock.mock.calls[1][1]).toMatchObject({
          method: 'PUT', body: JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'system' }),
        })
      }
    },
  )

  it.each(['missing', 'offline'])(
    'never reads or writes local UI settings when the selected remote daemon is %s',
    async failure => {
      localStorage.setItem('alter_active_server', 'remote-example')
      localStorage.setItem('alter_theme_remote-example', 'light')
      const fetchMock = vi.fn(async () => {
        if (failure === 'offline') throw new TypeError('Network unavailable')
        return Response.json({ servers: [] })
      })
      vi.stubGlobal('fetch', fetchMock)

      expect((await loadSettings()).theme).toBe('light')
      await saveSettings({ ...DEFAULT_SETTINGS, theme: 'system' })

      expect(fetchMock.mock.calls).toHaveLength(2)
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/system/remote-servers', expect.anything())
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/system/remote-servers', expect.anything())
    },
  )

  it('restores, saves and resets the theme through the existing settings lifecycle', async () => {
    const writes: AppSettings[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        writes.push(JSON.parse(init.body as string) as AppSettings)
        return new Response(null, { status: 204 })
      }
      return Response.json({ ...DEFAULT_SETTINGS, theme: 'light', defaultNamespace: 'services', viewMode: 'card' })
    }))
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expectTheme('light')

    act(() => result.current.updateSettings({ theme: 'system' }))
    await waitFor(() => expect(writes.at(-1)?.theme).toBe('system'))
    expect(writes.at(-1)?.defaultNamespace).toBe('services')
    expect(writes.at(-1)).toHaveProperty('viewMode', 'card')
    expect(readCachedTheme()).toBe('system')

    await act(async () => result.current.resetToDefaults())
    expectTheme('dark')
    expect(readCachedTheme()).toBe('dark')
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
    expect(writes.at(-1)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('Settings → UI', () => {
  it('exposes Dark, Light and System and immediately updates the selected preference', async () => {
    const onUpdate = vi.fn()
    render(<UiTab settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />)
    const select = screen.getByRole('combobox', { name: 'Theme' })
    expect(select).toHaveValue('dark')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Dark', 'Light', 'System'])

    await userEvent.selectOptions(select, 'light')
    expect(onUpdate).toHaveBeenLastCalledWith({ theme: 'light' })
    await userEvent.selectOptions(select, 'system')
    expect(onUpdate).toHaveBeenLastCalledWith({ theme: 'system' })
    expect(screen.getByText('Process Row Actions')).toBeInTheDocument()
  })
})

describe('sidebar footer theme menu', () => {
  it('opens with the keyboard, identifies the current theme and selects another theme', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ThemeMenu theme="light" onChange={onChange} />)
    screen.getByRole('button', { name: 'Theme: Light' }).focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'false')

    await user.keyboard('{End}{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('system')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('does not open or change the theme while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ThemeMenu theme="dark" onChange={onChange} disabled />)
    const trigger = screen.getByRole('button', { name: 'Theme: Dark' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
