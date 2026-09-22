import { useCallback, useEffect, useState, type ReactNode } from 'react'

interface Pending {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

/** Popup confirmation. Usage: const { confirm, dialog } = useConfirm(); if (await confirm({ title: 'Delete?' })) … */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirm = useCallback(
    (opts: { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  )
  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }
  useEffect(() => {
    if (!pending) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const dialog = pending ? (
    <div className="modal-bg" onClick={() => close(false)}>
      <div className="modal confirm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <header>
          <b>{pending.title}</b>
        </header>
        <div className="body">
          {pending.message ?? 'This cannot be undone.'}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="ghost" onClick={() => close(false)} autoFocus>
              Cancel
            </button>
            <button className={pending.danger === false ? 'primary' : 'primary danger'} onClick={() => close(true)}>
              {pending.confirmLabel ?? 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null
  return { confirm, dialog }
}
