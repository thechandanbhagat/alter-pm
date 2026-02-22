// @group BusinessLogic : Imperative dialog hook — drop-in replacement for confirm() and alert()

import { useCallback, useRef, useState } from 'react'
import type { DialogVariant } from '@/components/Dialog'

// @group Types : Internal dialog state
interface DialogState {
  open: boolean
  title: string
  message?: string
  variant: DialogVariant
  confirmLabel?: string
  cancelLabel?: string
  resolve: ((value: boolean) => void) | null
}

const CLOSED: DialogState = {
  open: false,
  title: '',
  variant: 'confirm',
  resolve: null,
}

// @group BusinessLogic > useDialog : Returns dialog state + show helpers
export function useDialog() {
  const [state, setState] = useState<DialogState>(CLOSED)
  // Keep resolve in a ref so callbacks don't capture stale state
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  // @group Utilities > Show : Open dialog and return a Promise<boolean>
  const showDialog = useCallback((opts: {
    title: string
    message?: string
    variant?: DialogVariant
    confirmLabel?: string
    cancelLabel?: string
  }): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({
        open: true,
        title: opts.title,
        message: opts.message,
        variant: opts.variant ?? 'confirm',
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        resolve,
      })
    })
  }, [])

  // @group Utilities > Confirm : Shorthand for a confirm-style dialog
  const confirm = useCallback((title: string, message?: string): Promise<boolean> =>
    showDialog({ title, message, variant: 'confirm' }),
  [showDialog])

  // @group Utilities > Danger : Shorthand for a destructive-action dialog
  const danger = useCallback((title: string, message?: string, confirmLabel?: string): Promise<boolean> =>
    showDialog({ title, message, variant: 'danger', confirmLabel }),
  [showDialog])

  // @group Utilities > Alert : Shorthand for an info-only dialog (no cancel)
  const alert = useCallback((title: string, message?: string): Promise<void> =>
    showDialog({ title, message, variant: 'alert' }).then(() => undefined),
  [showDialog])

  // @group Utilities > HandleConfirm : Called when user clicks the confirm button
  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true)
    resolveRef.current = null
    setState(CLOSED)
  }, [])

  // @group Utilities > HandleCancel : Called when user clicks cancel / presses Esc
  const handleCancel = useCallback(() => {
    resolveRef.current?.(false)
    resolveRef.current = null
    setState(CLOSED)
  }, [])

  return {
    dialogState: state,
    confirm,
    danger,
    alert,
    handleConfirm,
    handleCancel,
  }
}
