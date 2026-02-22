// @group BusinessLogic : Start new process form

import { useState } from 'react'
import { api } from '@/lib/api'
import { parseArgs, parseEnvString } from '@/lib/utils'
import { FormCard, FormField, FormRow } from '@/components/FormLayout'
import type { AppSettings } from '@/lib/settings'

interface Props {
  onDone: () => void
  settings: AppSettings
}

export default function StartPage({ onDone, settings }: Props) {
  const [script, setScript]         = useState('')
  const [name, setName]             = useState('')
  const [cwd, setCwd]               = useState('')
  const [namespace, setNamespace]   = useState(settings.defaultNamespace || 'default')
  const [args, setArgs]             = useState('')
  const [env, setEnv]               = useState('')
  const [autorestart, setAutorestart] = useState(true)
  const [watch, setWatch]           = useState(false)
  const [cron, setCron]             = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const cronVal = cron.trim() || undefined
      await api.startProcess({
        script: script.trim(),
        ...(name.trim()      && { name: name.trim() }),
        ...(cwd.trim()       && { cwd: cwd.trim() }),
        ...(namespace.trim() && { namespace: namespace.trim() }),
        ...(args.trim()      && { args: parseArgs(args.trim()) }),
        ...(env.trim()       && { env: parseEnvString(env.trim()) }),
        autorestart,
        watch,
        ...(cronVal && { cron: cronVal }),
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start process')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Start New Process</h2>
      </div>

      <FormCard onSubmit={handleSubmit}>
        <FormRow>
          <FormField label="Command *">
            <input style={inputStyle} value={script} onChange={e => setScript(e.target.value)}
              placeholder="node app.js" required />
          </FormField>
          <FormField label="Name">
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
              placeholder="my-app" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="Working Directory">
            <input style={inputStyle} value={cwd} onChange={e => setCwd(e.target.value)}
              placeholder="C:\Users\me\app" />
          </FormField>
          <FormField label="Namespace">
            <input style={inputStyle} value={namespace} onChange={e => setNamespace(e.target.value)}
              placeholder="default" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="Args (space-separated)">
            <input style={inputStyle} value={args} onChange={e => setArgs(e.target.value)}
              placeholder="--port 3000 --env prod" />
          </FormField>
          <FormField label="Env Vars (KEY=VAL, comma-separated)">
            <input style={inputStyle} value={env} onChange={e => setEnv(e.target.value)}
              placeholder="NODE_ENV=production,PORT=3000" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="">
            <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
              <CheckboxField label="Auto-restart on crash" checked={autorestart} onChange={setAutorestart} />
              <CheckboxField label="Watch mode" checked={watch} onChange={setWatch} />
            </div>
          </FormField>
          <FormField label={<>Cron Schedule <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11 }}>(e.g. "0 * * * *" — leave blank for normal)</span></>}>
            <input style={inputStyle} value={cron} onChange={e => setCron(e.target.value)}
              placeholder="0 * * * *" />
          </FormField>
        </FormRow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? 'Starting…' : '▶ Start'}
          </button>
          {error && <span style={{ fontSize: 12, color: 'var(--color-destructive)' }}>{error}</span>}
        </div>
      </FormCard>
    </div>
  )
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-primary)', width: 14, height: 14 }} />
      {label}
    </label>
  )
}

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', fontSize: 13,
  background: 'var(--color-input)', border: '1px solid var(--color-border)',
  borderRadius: 5, color: 'var(--color-foreground)', outline: 'none',
}

export const primaryBtnStyle: React.CSSProperties = {
  padding: '7px 20px', fontSize: 13, fontWeight: 600,
  background: 'var(--color-primary)', border: 'none',
  borderRadius: 5, cursor: 'pointer', color: '#fff',
}
