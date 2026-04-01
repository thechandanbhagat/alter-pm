// @group BusinessLogic > TelegramTab : Telegram bot settings — token, chat IDs, notifications

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { card, inputStyle, sectionTitle, SettingRow, Toggle } from './shared'

export default function TelegramTab() {
  const [tgEnabled, setTgEnabled] = useState(false)
  const [tgToken, setTgToken] = useState('')
  const [tgTokenHint, setTgTokenHint] = useState<string | null>(null)
  const [tgTokenSet, setTgTokenSet] = useState(false)
  const [tgChatIds, setTgChatIds] = useState<string>('')
  const [tgNotifyCrash, setTgNotifyCrash] = useState(true)
  const [tgNotifyStart, setTgNotifyStart] = useState(false)
  const [tgNotifyStop, setTgNotifyStop] = useState(false)
  const [tgNotifyRestart, setTgNotifyRestart] = useState(true)
  const [tgSaving, setTgSaving] = useState(false)
  const [tgSaved, setTgSaved] = useState(false)
  const [tgError, setTgError] = useState<string | null>(null)
  const [tgBotInfo, setTgBotInfo] = useState<{ ok: boolean; username: string | null; first_name: string | null; error: string | null } | null>(null)
  const [tgValidating, setTgValidating] = useState(false)
  const [tgTesting, setTgTesting] = useState(false)
  const [tgTestResult, setTgTestResult] = useState<string | null>(null)
  const [tgChangingToken, setTgChangingToken] = useState(false)

  useEffect(() => {
    api.getTelegramConfig().then(cfg => {
      setTgEnabled(cfg.enabled)
      setTgTokenHint(cfg.bot_token_hint)
      setTgTokenSet(cfg.bot_token_set)
      setTgChatIds(cfg.allowed_chat_ids.join('\n'))
      setTgNotifyCrash(cfg.notify_on_crash)
      setTgNotifyStart(cfg.notify_on_start)
      setTgNotifyStop(cfg.notify_on_stop)
      setTgNotifyRestart(cfg.notify_on_restart)
    }).catch(() => {})
  }, [])

  function parseChatIds(): number[] {
    return tgChatIds
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(n => !isNaN(n) && n !== 0)
  }

  async function handleSaveTelegram(e: React.FormEvent) {
    e.preventDefault()
    setTgError(null)
    setTgSaving(true)
    try {
      const payload: Parameters<typeof api.updateTelegramConfig>[0] = {
        enabled: tgEnabled,
        allowed_chat_ids: parseChatIds(),
        notify_on_crash: tgNotifyCrash,
        notify_on_start: tgNotifyStart,
        notify_on_stop: tgNotifyStop,
        notify_on_restart: tgNotifyRestart,
      }
      if (tgToken) payload.bot_token = tgToken
      await api.updateTelegramConfig(payload)
      setTgSaved(true)
      setTgToken('')
      if (tgToken) { setTgTokenSet(true); setTgBotInfo(null) }
      setTimeout(() => setTgSaved(false), 2000)
    } catch (err: unknown) {
      setTgError((err as Error)?.message ?? 'Failed to save Telegram config')
    } finally {
      setTgSaving(false)
    }
  }

  async function handleValidateToken() {
    setTgValidating(true)
    setTgBotInfo(null)
    if (tgToken) {
      try { await api.updateTelegramConfig({ bot_token: tgToken }) } catch { /* ignore */ }
    }
    try {
      const info = await api.getTelegramBotInfo()
      setTgBotInfo(info)
      if (info.ok) { setTgTokenSet(true); setTgToken(''); setTgChangingToken(false) }
    } catch (err: unknown) {
      setTgBotInfo({ ok: false, username: null, first_name: null, error: (err as Error)?.message ?? 'Request failed' })
    } finally {
      setTgValidating(false)
    }
  }

  async function handleTestTelegram() {
    setTgTesting(true)
    setTgTestResult(null)
    try {
      await api.testTelegram()
      setTgTestResult('✅ Test message sent!')
    } catch (err: unknown) {
      setTgTestResult(`❌ ${(err as Error)?.message ?? 'Failed to send test message'}`)
    } finally {
      setTgTesting(false)
      setTimeout(() => setTgTestResult(null), 4000)
    }
  }

  return (
    <>
      <p style={sectionTitle}>Telegram Bot</p>
      <div style={card}>
        <SettingRow
          label="Enable Telegram Bot"
          description="Allow controlling processes and receiving alerts via Telegram"
          isLast
          control={<Toggle checked={tgEnabled} onChange={v => setTgEnabled(v)} />}
        />
      </div>

      <p style={sectionTitle}>Bot Token</p>
      <div style={card}>
        <SettingRow
          label="Bot Token"
          description={
            tgTokenSet && !tgChangingToken
              ? 'Token is saved — click Change to replace it'
              : 'Get your token from @BotFather on Telegram'
          }
          isLast
          control={
            tgTokenSet && !tgChangingToken ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{
                  ...inputStyle, width: 240, fontSize: 12,
                  display: 'flex', alignItems: 'center', gap: 6,
                  color: 'var(--color-muted-foreground)',
                  background: 'var(--color-secondary)',
                }}>
                  <span style={{ color: 'var(--color-status-running)', fontSize: 13 }}>✓</span>
                  <span style={{ fontFamily: 'monospace' }}>{tgTokenHint ?? '••••••••'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setTgChangingToken(true); setTgBotInfo(null) }}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    background: 'var(--color-card)', color: 'var(--color-foreground)',
                    border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer',
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="password"
                  placeholder="Paste new bot token…"
                  value={tgToken}
                  onChange={e => { setTgToken(e.target.value); setTgBotInfo(null) }}
                  style={{ ...inputStyle, width: 240, fontSize: 12 }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleValidateToken}
                  disabled={tgValidating || !tgToken}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    background: 'var(--color-card)', color: 'var(--color-foreground)',
                    border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer',
                    opacity: (tgValidating || !tgToken) ? 0.5 : 1,
                  }}
                >
                  {tgValidating ? 'Checking…' : 'Validate'}
                </button>
                {tgTokenSet && (
                  <button
                    type="button"
                    onClick={() => { setTgChangingToken(false); setTgToken(''); setTgBotInfo(null) }}
                    style={{
                      padding: '5px 10px', fontSize: 12,
                      background: 'none', color: 'var(--color-muted-foreground)',
                      border: '1px solid var(--color-border)', borderRadius: 5, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            )
          }
        />
        {tgBotInfo && (
          <div style={{
            marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12,
            background: tgBotInfo.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: tgBotInfo.ok ? 'var(--color-status-running)' : 'var(--color-status-errored)',
            border: `1px solid ${tgBotInfo.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            {tgBotInfo.ok
              ? `✅ Connected as @${tgBotInfo.username ?? tgBotInfo.first_name}`
              : `❌ ${tgBotInfo.error ?? 'Invalid token'}`}
          </div>
        )}
      </div>

      <p style={sectionTitle}>Allowed Chat IDs</p>
      <div style={card}>
        <SettingRow
          label="Allowed Chat IDs"
          description="Only these Telegram user/group IDs can send commands. One ID per line. Find your ID by messaging @userinfobot."
          isLast
          control={
            <textarea
              placeholder={'123456789\n-987654321'}
              value={tgChatIds}
              onChange={e => setTgChatIds(e.target.value)}
              rows={4}
              style={{
                ...inputStyle,
                width: 200,
                resize: 'vertical',
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            />
          }
        />
      </div>

      <p style={sectionTitle}>Notifications</p>
      <div style={card}>
        <SettingRow label="Notify on crash" description="Send a message when a process crashes" control={<Toggle checked={tgNotifyCrash} onChange={setTgNotifyCrash} />} />
        <SettingRow label="Notify on start" description="Send a message when a process starts" control={<Toggle checked={tgNotifyStart} onChange={setTgNotifyStart} />} />
        <SettingRow label="Notify on stop" description="Send a message when a process is stopped" control={<Toggle checked={tgNotifyStop} onChange={setTgNotifyStop} />} />
        <SettingRow
          label="Notify on restart"
          description="Send a message when a process is automatically restarted"
          isLast
          control={<Toggle checked={tgNotifyRestart} onChange={setTgNotifyRestart} />}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button
          onClick={handleSaveTelegram}
          disabled={tgSaving}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 500,
            background: tgSaved ? 'var(--color-status-running)' : 'var(--color-primary)',
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            opacity: tgSaving ? 0.6 : 1, transition: 'background 0.2s',
          }}
        >
          {tgSaved ? 'Saved!' : tgSaving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleTestTelegram}
          disabled={tgTesting || !tgTokenSet || parseChatIds().length === 0}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 500,
            background: 'var(--color-card)', color: 'var(--color-foreground)',
            border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer',
            opacity: (tgTesting || !tgTokenSet || parseChatIds().length === 0) ? 0.5 : 1,
          }}
        >
          {tgTesting ? 'Sending…' : 'Send Test Message'}
        </button>
        {tgTestResult && (
          <span style={{ fontSize: 12, color: tgTestResult.startsWith('✅') ? 'var(--color-status-running)' : 'var(--color-status-errored)' }}>
            {tgTestResult}
          </span>
        )}
      </div>
      {tgError && (
        <p style={{ fontSize: 12, color: 'var(--color-status-errored)', marginTop: 8 }}>{tgError}</p>
      )}

      <div style={{ ...card, marginTop: 20, background: 'rgba(var(--color-primary-rgb, 99,102,241),0.05)', borderColor: 'rgba(var(--color-primary-rgb, 99,102,241),0.2)' }}>
        <p style={{ ...sectionTitle, color: 'var(--color-primary)', marginBottom: 8 }}>Setup Guide</p>
        <ol style={{ fontSize: 12, color: 'var(--color-muted-foreground)', paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
          <li>Message <strong>@BotFather</strong> on Telegram → <code>/newbot</code> → copy the token above</li>
          <li>Click <strong>Validate</strong> to confirm the token works</li>
          <li>Message your bot, then message <strong>@userinfobot</strong> to get your Chat ID</li>
          <li>Add your Chat ID to the Allowed Chat IDs list</li>
          <li>Enable the bot and save</li>
          <li>Send <strong>/help</strong> to your bot to see available commands</li>
        </ol>
        <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginTop: 12, marginBottom: 0 }}>
          <strong>Commands:</strong> /list · /start &lt;name&gt; · /stop &lt;name&gt; · /restart &lt;name&gt; · /logs &lt;name&gt; [lines] · /status &lt;name&gt; · /ping · /help
        </p>
      </div>
    </>
  )
}
