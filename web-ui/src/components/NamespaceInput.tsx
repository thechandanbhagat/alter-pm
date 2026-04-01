// @group BusinessLogic : Namespace text input with autocomplete from existing process namespaces

import { useEffect, useId, useState } from 'react'
import { api } from '@/lib/api'

interface NamespaceInputProps {
  value: string
  onChange: (value: string) => void
  style?: React.CSSProperties
  placeholder?: string
  spellCheck?: boolean
}

// @group BusinessLogic > NamespaceInput : Input + datalist — fetches namespace list once on mount
export function NamespaceInput({ value, onChange, style, placeholder = 'default', spellCheck = false }: NamespaceInputProps) {
  const [namespaces, setNamespaces] = useState<string[]>([])
  const listId = useId()

  useEffect(() => {
    api.getProcesses()
      .then(({ processes }) => {
        const unique = [...new Set(processes.map(p => p.namespace || 'default'))].sort()
        setNamespaces(unique)
      })
      .catch(() => {})
  }, [])

  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={style}
        placeholder={placeholder}
        spellCheck={spellCheck}
        autoComplete="off"
      />
      <datalist id={listId}>
        {namespaces.map(ns => <option key={ns} value={ns} />)}
      </datalist>
    </>
  )
}
