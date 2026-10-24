import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import type { DirectCallsController } from '../../hooks/useDirectCalls'
import { directCallLabel } from '../../services/directCallsPolicy'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { Icon } from '../ui/Icon'
import './DirectCalls.css'
export function DirectCallOverlay({
  calls,
  userId,
}: {
  calls: DirectCallsController
  userId: string
}) {
  const incoming = calls.incoming,
    outgoing = calls.outgoing
  const dialogRef = useRef<HTMLElement>(null)
  const callsRef = useRef(calls)
  callsRef.current = calls
  const incomingId =
    incoming && !calls.preferences.do_not_disturb ? incoming.id : null
  useEffect(() => {
    if (!incomingId) return
    const dialog = dialogRef.current
    if (!dialog) return
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    if (root) root.inert = true
    const controls = () => [
      ...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ]
    const focus = () => (controls()[0] || dialog).focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape' && !callsRef.current.busy) {
        event.preventDefault()
        void callsRef.current.decline()
      }
      if (event.key !== 'Tab') return
      event.preventDefault()
      const buttons = controls()
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      )
      const next =
        (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
      ;(buttons[next] || dialog).focus({ preventScroll: true })
    }
    const onFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focus()
    }
    focus()
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus)
      if (root) root.inert = wasInert
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [incomingId])
  const person = calls.people.get(
    incoming?.caller_id || outgoing?.recipient_id || '',
  )
  return createPortal(
    <>
      {incoming && !calls.preferences.do_not_disturb && (
        <section
          ref={dialogRef}
          tabIndex={-1}
          className="direct-call-incoming"
          role="dialog"
          aria-modal="true"
          aria-label="Chamada recebida"
        >
          <div className="direct-call-incoming__card">
            <span className="direct-call-kicker">
              <Icon name="phone" /> Chamada de voz
            </span>
            <div className="direct-call-avatar">
              <ProfileAvatar
                className="social-avatar"
                name={person?.displayName || 'Pessoa'}
                appearance={person?.appearance}
                avatarDataUrl={person?.avatarDataUrl}
              />
            </div>
            <h2>{person?.displayName || 'Alguém'} está ligando</h2>
            <p>A câmera começa desligada. Atenda quando quiser conversar.</p>
            <div className="direct-call-actions">
              <button
                className="direct-call-decline"
                type="button"
                disabled={calls.busy}
                onClick={() => void calls.decline()}
              >
                <Icon name="leave" /> Recusar
              </button>
              <button
                className="direct-call-accept"
                type="button"
                disabled={calls.busy}
                onClick={() => void calls.accept()}
              >
                <Icon name="phone" /> {calls.busy ? 'Conectando…' : 'Atender'}
              </button>
            </div>
          </div>
        </section>
      )}
      {outgoing && (
        <aside className="direct-call-outgoing" aria-live="polite">
          <Icon name="phone" />
          <div>
            <strong>{person?.displayName || 'Chamando'}</strong>
            <span>Chamando…</span>
          </div>
          <button
            type="button"
            onClick={() => void calls.cancel()}
            aria-label="Cancelar chamada"
          >
            <Icon name="leave" />
          </button>
        </aside>
      )}
      {calls.error && (
        <aside className="direct-call-error" role="alert">
          <span>{calls.error}</span>
          <button
            type="button"
            onClick={calls.clearError}
            aria-label="Fechar aviso"
          >
            <Icon name="x" />
          </button>
        </aside>
      )}
      {!incoming &&
        !outgoing &&
        calls.latest &&
        calls.latest.caller_id === userId &&
        Date.now() - Date.parse(calls.latest.ended_at || '1970-01-01') <
          10000 && (
          <aside
            className="direct-call-outgoing direct-call-outgoing--ended"
            role="status"
          >
            <Icon name="phone" />
            <span>{directCallLabel(calls.latest, userId)}</span>
          </aside>
        )}
    </>,
    document.body,
  )
}
