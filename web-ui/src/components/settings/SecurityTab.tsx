// @group BusinessLogic > SecurityTab : Security settings — password, PIN, session lock

import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Lock, Shield } from 'lucide-react'
import { api } from '@/lib/api'
import { card, inputStyle, sectionTitle, selectStyle, SettingRow } from './shared'

export default function SecurityTab() {
  // @group BusinessLogic > Security : Change password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [pwChangeError, setPwChangeError] = useState<string | null>(null)
  const [pwChangeSaved, setPwChangeSaved] = useState(false)
  const [pwChangeSaving, setPwChangeSaving] = useState(false)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  // @group BusinessLogic > Security : PIN state
  const [pinConfigured, setPinConfigured] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSaved, setPinSaved] = useState(false)
  const [pinSaving, setPinSaving] = useState(false)

  // @group BusinessLogic > Security : Lock timeout state
  const [lockTimeoutMins, setLockTimeoutMins] = useState<string>('0')
  const [lockSaving, setLockSaving] = useState(false)
  const [lockSaved, setLockSaved] = useState(false)

  useEffect(() => {
    api.authStatus().then(s => {
      setPinConfigured(s.pin_configured ?? false)
      setLockTimeoutMins(String(s.lock_timeout_mins ?? 0))
    }).catch(() => {})
  }, [])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwChangeError(null)
    if (newPassword !== confirmNewPassword) { setPwChangeError('New passwords do not match'); return }
    if (newPassword.length < 8) { setPwChangeError('Password must be at least 8 characters'); return }
    setPwChangeSaving(true)
    try {
      await api.authChangePassword(currentPassword, newPassword)
      setPwChangeSaved(true)
      setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('')
      setTimeout(() => setPwChangeSaved(false), 2000)
    } catch (err: unknown) {
      setPwChangeError((err as Error)?.message ?? 'Failed to change password')
    } finally {
      setPwChangeSaving(false)
    }
  }

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault()
    setPinError(null)
    if (pinInput.length !== 4 && pinInput.length !== 6) {
      setPinError('PIN must be exactly 4 or 6 digits'); return
    }
    if (!/^\d+$/.test(pinInput)) { setPinError('PIN must contain only digits'); return }
    setPinSaving(true)
    try {
      await api.authSetPin(pinInput)
      setPinConfigured(true)
      setPinSaved(true)
      setPinInput('')
      setTimeout(() => setPinSaved(false), 2000)
    } catch (err: unknown) {
      setPinError((err as Error)?.message ?? 'Failed to set PIN')
    } finally {
      setPinSaving(false)
    }
  }

  async function handleRemovePin() {
    setPinError(null)
    setPinSaving(true)
    try {
      await api.authRemovePin()
      setPinConfigured(false)
      setPinInput('')
    } catch (err: unknown) {
      setPinError((err as Error)?.message ?? 'Failed to remove PIN')
    } finally {
      setPinSaving(false)
    }
  }

  async function handleSaveLockTimeout() {
    setLockSaving(true)
    try {
      const mins = lockTimeoutMins === '0' ? null : Number(lockTimeoutMins)
      await api.authUpdateLockSettings(mins)
      setLockSaved(true)
      setTimeout(() => setLockSaved(false), 2000)
      window.dispatchEvent(new CustomEvent('lock-config-updated'))
    } catch { /* ignore */ } finally {
      setLockSaving(false)
    }
  }

  function PwField({
    label, value, onChange, autoComplete, show, onToggle,
  }: {
    label: string
    value: string
    onChange: (v: string) => void
    autoComplete: string
    show: boolean
    onToggle: () => void
  }) {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-muted-foreground)', marginBottom: 5, letterSpacing: '0.04em' }}>
          {label}
        </label>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => onChange(e.target.value)}
            autoComplete={autoComplete}
            style={{
              ...inputStyle,
              width: '100%',
              fontSize: 13,
              padding: '8px 36px 8px 12px',
              boxSizing: 'border-box',
              borderRadius: 6,
            }}
          />
          <button
            type="button"
            onClick={onToggle}
            tabIndex={-1}
            style={{
              position: 'absolute', right: 10,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-muted-foreground)',
              display: 'flex', alignItems: 'center', padding: 0,
            }}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
    )
  }

  const strength = newPassword.length >= 12 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword) ? 4
    : newPassword.length >= 10 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) ? 3
    : newPassword.length >= 8 ? 2
    : 1
  const strengthColors = ['var(--color-destructive)', 'orange', '#f0b429', 'var(--color-status-running)']

  return (
    <>
      <p style={sectionTitle}>Password</p>
      <div style={card}>
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-foreground)' }}>Change password</div>
          <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2, marginBottom: 16 }}>Update your dashboard login password.</div>
        </div>
        <form onSubmit={handleChangePassword}>
          <PwField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" show={showCurrentPw} onToggle={() => setShowCurrentPw(p => !p)} />
          <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0 16px' }} />
          <PwField label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" show={showNewPw} onToggle={() => setShowNewPw(p => !p)} />
          <PwField label="Confirm new password" value={confirmNewPassword} onChange={setConfirmNewPassword} autoComplete="new-password" show={showConfirmPw} onToggle={() => setShowConfirmPw(p => !p)} />

          {newPassword.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                {[1, 2, 3, 4].map(level => (
                  <div key={level} style={{
                    flex: 1, height: 3, borderRadius: 2,
                    background: level <= strength ? strengthColors[strength - 1] : 'var(--color-border)',
                    transition: 'background 0.2s',
                  }} />
                ))}
              </div>
              <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>
                {newPassword.length < 8 ? 'Too short' : strength === 4 ? 'Strong' : strength === 3 ? 'Good' : 'Fair — add uppercase, numbers, symbols'}
              </span>
            </div>
          )}

          {pwChangeError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 12px', borderRadius: 6, marginBottom: 12,
              background: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent)',
              fontSize: 12, color: 'var(--color-destructive)',
            }}>
              {pwChangeError}
            </div>
          )}
          {pwChangeSaved && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 12px', borderRadius: 6, marginBottom: 12,
              background: 'color-mix(in srgb, var(--color-status-running) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-status-running) 30%, transparent)',
              fontSize: 12, color: 'var(--color-status-running)',
            }}>
              <Check size={13} /> Password changed successfully.
            </div>
          )}

          <button
            type="submit"
            disabled={pwChangeSaving || !currentPassword || !newPassword || !confirmNewPassword}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 18px', fontSize: 13, fontWeight: 600,
              background: pwChangeSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
              color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
              opacity: (pwChangeSaving || !currentPassword || !newPassword || !confirmNewPassword) ? 0.5 : 1,
              transition: 'background 0.2s, opacity 0.15s',
            }}
          >
            <Shield size={13} />
            {pwChangeSaving ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>

      <p style={sectionTitle}>PIN</p>
      <div style={card}>
        <SettingRow
          label="Quick-unlock PIN"
          description={pinConfigured
            ? 'A PIN is set. Enter a new one to replace it, or remove it.'
            : 'Set a 4 or 6 digit PIN for the lock screen. Faster than typing the full password.'}
          isLast
          control={
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              {pinError && (
                <div style={{ fontSize: 11, color: 'var(--color-destructive)', textAlign: 'right' }}>{pinError}</div>
              )}
              <form onSubmit={handleSetPin} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={pinConfigured ? 'New PIN (4 or 6 digits)' : 'PIN (4 or 6 digits)'}
                  style={{ ...inputStyle, width: 160, fontSize: 12, padding: '5px 10px', letterSpacing: '0.15em', fontFamily: 'monospace' }}
                />
                <button
                  type="submit"
                  disabled={pinSaving || pinInput.length < 4}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    background: pinSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                    color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
                    opacity: (pinSaving || pinInput.length < 4) ? 0.5 : 1, transition: 'background 0.2s',
                  }}
                >
                  {pinSaved ? 'Saved!' : pinConfigured ? 'Update' : 'Set PIN'}
                </button>
                {pinConfigured && (
                  <button
                    type="button"
                    onClick={handleRemovePin}
                    disabled={pinSaving}
                    style={{
                      padding: '5px 10px', fontSize: 12,
                      background: 'transparent',
                      border: '1px solid var(--color-destructive)',
                      borderRadius: 5, cursor: 'pointer',
                      color: 'var(--color-destructive)',
                      opacity: pinSaving ? 0.5 : 1,
                    }}
                  >
                    Remove
                  </button>
                )}
              </form>
            </div>
          }
        />
      </div>

      <p style={sectionTitle}>Session</p>
      <div style={card}>
        <SettingRow
          label="Auto-lock after inactivity"
          description="Automatically lock the dashboard after a period of inactivity. Uses PIN if set, otherwise password."
          isLast
          control={
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={lockTimeoutMins}
                onChange={e => setLockTimeoutMins(e.target.value)}
                style={{ ...selectStyle, minWidth: 120 }}
              >
                <option value="0">Disabled</option>
                <option value="5">5 minutes</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
              </select>
              <button
                onClick={handleSaveLockTimeout}
                disabled={lockSaving}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', fontSize: 12, fontWeight: 500,
                  background: lockSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
                  color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
                  opacity: lockSaving ? 0.6 : 1, transition: 'background 0.2s',
                }}
              >
                <Lock size={11} />
                {lockSaved ? 'Saved!' : lockSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        />
      </div>
    </>
  )
}
