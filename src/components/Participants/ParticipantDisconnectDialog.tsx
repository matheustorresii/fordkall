import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { friendlyModerationError } from '../../services/moderation'
import { Icon } from '../ui/Icon'
import './ParticipantModeration.css'

export const ParticipantDisconnectDialog = ({
  name,
  connected,
  onClose,
  onConfirm,
}: {
  name: string
  connected: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const titleId = useId(),
    detailId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  const confirm = async () => {
    if (busyRef.current || !connected) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (cause) {
      setError(friendlyModerationError(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return createPortal(
    <dialog
      className="participant-disconnect-dialog"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        if (!busyRef.current) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) onClose()
      }}
    >
      <div className="participant-disconnect-dialog__content">
        <header>
          <Icon name="leave" />
          <h2 id={titleId}>Desconectar da call?</h2>
        </header>
        <p id={detailId}>
          <strong>{name}</strong> vai sair desta sala. A conta continua ativa e a pessoa pode entrar
          novamente.
        </p>
        {error && (
          <p className="participant-disconnect-dialog__error" role="alert">
            {error}
          </p>
        )}
        {!connected && !busy && (
          <p role="status">Essa pessoa já saiu ou reconectou. Abra os controles dela novamente.</p>
        )}
        <footer>
          <button disabled={busy} onClick={onClose} type="button" autoFocus>
            Cancelar
          </button>
          <button
            className="is-danger"
            disabled={busy || !connected}
            onClick={() => void confirm()}
            type="button"
          >
            {busy ? 'Desconectando…' : 'Desconectar'}
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  )
}
