// @group Authentication : Login page — password + Windows Hello / passkey sign-in

import { useEffect, useState } from 'react'
import { Fingerprint, KeyRound, Eye, EyeOff } from 'lucide-react'
import { loginWithPasskey, registerPasskey, setSessionToken } from '@/lib/auth'
import { api } from '@/lib/api'

interface LoginPageProps {
  onAuthenticated: () => void
  subtitle?: string
}

// @group Authentication > LoginPage : Setup vs login mode
type Mode = 'loading' | 'setup' | 'login'

export default function LoginPage({ onAuthenticated, subtitle }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>('loading')
  const [passkeysAvailable, setPasskeysAvailable] = useState(false)
  const [pinConfigured, setPinConfigured] = useState(false)
  const [usePin, setUsePin] = useState(false)
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // @group Authentication > LoginPage : Determine whether password / PIN has been configured
  useEffect(() => {
    api.authStatus()
      .then(({ password_configured, passkeys_count, pin_configured }) => {
        setMode(password_configured ? 'login' : 'setup')
        setPasskeysAvailable(passkeys_count > 0 && !!window.PublicKeyCredential)
        setPinConfigured(!!pin_configured)
        setUsePin(!!pin_configured)
      })
      .catch(() => setMode('login'))
  }, [])

  // @group Authentication > LoginPage : Keyboard input for PIN numpad
  useEffect(() => {
    if (!usePin || mode !== 'login') return
    function handleKey(e: KeyboardEvent) {
      if (loading) return
      if (e.key >= '0' && e.key <= '9') pressDigit(e.key)
      else if (e.key === 'Backspace') setPin(p => p.slice(0, -1))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [usePin, mode, loading, pin])

  async function handlePinDigit(digits: string) {
    if (digits.length !== 4 && digits.length !== 6) return
    setLoading(true)
    setError(null)
    try {
      const { session_token } = await api.authPinLogin(digits)
      setSessionToken(session_token)
      onAuthenticated()
    } catch {
      setError('Incorrect PIN')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  function pressDigit(d: string) {
    if (loading || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    if (next.length === 4 || next.length === 6) {
      setTimeout(() => handlePinDigit(next), 80)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'setup') {
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          return
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters')
          return
        }
        const { session_token } = await api.authSetup(password)
        setSessionToken(session_token)
        onAuthenticated()
      } else {
        const { session_token } = await api.authLogin(password)
        setSessionToken(session_token)
        onAuthenticated()
      }
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasskeyLogin() {
    setError(null)
    setLoading(true)
    try {
      const token = await loginWithPasskey(
        () => api.passkeyLoginStart(),
        (cred) => api.passkeyLoginFinish(cred),
      )
      setSessionToken(token)
      onAuthenticated()
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Passkey authentication failed')
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ color: 'var(--color-muted-foreground)', fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    )
  }

  const logo = (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <span style={{ fontWeight: 700, fontSize: 28, letterSpacing: '-0.5px', color: 'var(--color-primary)' }}>alter</span>
      <span style={{ fontSize: 14, color: 'var(--color-muted-foreground)', fontWeight: 500 }}>pm</span>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-muted-foreground)' }}>
        {subtitle ?? (mode === 'setup' ? 'Set a password to secure your dashboard' : 'Sign in to continue')}
      </p>
    </div>
  )

  const errorBanner = error && (
    <div style={{
      background: 'color-mix(in srgb, var(--color-destructive) 15%, transparent)',
      border: '1px solid var(--color-destructive)',
      borderRadius: 6, padding: '8px 12px',
      fontSize: 13, color: 'var(--color-destructive)',
      marginBottom: 16,
    }}>
      {error}
    </div>
  )

  // @group Authentication > LoginPage : PIN numpad view
  if (mode === 'login' && usePin) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          {logo}
          {errorBanner}

          {/* PIN dots */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 20 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{
                width: 12, height: 12, borderRadius: '50%',
                background: i < pin.length ? 'var(--color-primary)' : 'var(--color-border)',
                transition: 'background 0.15s',
                display: pin.length <= 4 && i >= 4 ? 'none' : 'block',
              }} />
            ))}
          </div>

          {/* Numpad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, maxWidth: 220, margin: '0 auto 20px' }}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, idx) => (
              d === '' ? <div key={idx} /> :
              <button
                key={idx}
                onClick={() => d === '⌫' ? setPin(p => p.slice(0, -1)) : pressDigit(d)}
                disabled={loading}
                style={{
                  width: 64, height: 64, borderRadius: 32,
                  fontSize: d === '⌫' ? 20 : 22, fontWeight: 500,
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer', color: 'var(--color-foreground)',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Passkey option */}
          {passkeysAvailable && (
            <button onClick={handlePasskeyLogin} disabled={loading} style={{ ...passkeyBtnStyle, marginBottom: 12 }}>
              <Fingerprint size={16} />
              Sign in with Windows Hello / Passkey
            </button>
          )}

          {/* Switch to password */}
          <button
            onClick={() => { setUsePin(false); setError(null) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-muted-foreground)', textDecoration: 'underline' }}
          >
            Use password instead
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {logo}
        {errorBanner}

        {/* Passkey button — shown on login if passkeys are registered */}
        {mode === 'login' && passkeysAvailable && (
          <>
            <button onClick={handlePasskeyLogin} disabled={loading} style={passkeyBtnStyle}>
              <Fingerprint size={16} />
              Sign in with Windows Hello / Passkey
            </button>
            <div style={dividerStyle}>
              <span style={dividerLineStyle} />
              <span style={{ padding: '0 8px', fontSize: 11, color: 'var(--color-muted-foreground)' }}>or</span>
              <span style={dividerLineStyle} />
            </div>
          </>
        )}

        {/* Password form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
                required
                style={inputStyle}
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={eyeBtnStyle} tabIndex={-1}>
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {mode === 'setup' && (
            <div>
              <label style={labelStyle}>Confirm password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  required
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          <button type="submit" disabled={loading || !password} style={submitBtnStyle}>
            <KeyRound size={14} />
            {loading ? 'Please wait…' : mode === 'setup' ? 'Set password & sign in' : 'Sign in'}
          </button>
        </form>

        {/* Switch to PIN */}
        {mode === 'login' && pinConfigured && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              onClick={() => { setUsePin(true); setError(null); setPin('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-muted-foreground)', textDecoration: 'underline' }}
            >
              Use PIN instead
            </button>
          </div>
        )}

        {!subtitle && (
          <p style={{ marginTop: 12, fontSize: 11, color: 'var(--color-muted-foreground)', textAlign: 'center', lineHeight: 1.5 }}>
            {mode === 'setup'
              ? 'This password protects the alter dashboard. The CLI authenticates automatically via a local token.'
              : 'You can also use the CLI — it authenticates automatically.'}
          </p>
        )}
      </div>
    </div>
  )
}

// @group Authentication > LoginPage : Register passkey after login (exported for SettingsPage use)
export async function doRegisterPasskey(passkeyName: string): Promise<void> {
  await registerPasskey(
    () => api.passkeyRegisterStart(),
    (cred, name) => api.passkeyRegisterFinish(cred, name),
    passkeyName,
  )
}

// @group Styles : Login page layout and card styles
const containerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100vh', background: 'var(--color-background)',
}

const cardStyle: React.CSSProperties = {
  width: 360,
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  padding: 28,
  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500,
  color: 'var(--color-foreground)', marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 36px 8px 10px',
  fontSize: 13, borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-background)',
  color: 'var(--color-foreground)',
  outline: 'none', boxSizing: 'border-box',
}

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--color-muted-foreground)', padding: 0, display: 'flex',
}

const submitBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '9px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--color-primary)', color: 'var(--color-primary-foreground)',
  border: 'none', borderRadius: 6, cursor: 'pointer',
  opacity: 1,
}

const passkeyBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  width: '100%', padding: '9px 16px', fontSize: 13, fontWeight: 500,
  background: 'var(--color-secondary)', color: 'var(--color-foreground)',
  border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer',
  marginBottom: 8,
}

const dividerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', marginBottom: 12,
}

const dividerLineStyle: React.CSSProperties = {
  flex: 1, height: 1, background: 'var(--color-border)',
}
