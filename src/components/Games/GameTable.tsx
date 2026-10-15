import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui/Icon'
import type { ParticipantMedia } from '../../types'
import './GameTable.css'

export const arrangeSeats = <T extends { identity: string }>(players: T[], localIdentity: string): T[] => {
  const localIndex = players.findIndex((player) => player.identity === localIdentity)
  return localIndex < 1 ? players : [...players.slice(localIndex), ...players.slice(0, localIndex)]
}

const seatPositions: Record<number, Array<[number, number]>> = {
  1: [[50, 87]],
  2: [[50, 88], [50, 10]],
  3: [[50, 88], [13, 27], [87, 27]],
  4: [[50, 88], [10, 49], [50, 10], [90, 49]],
  5: [[50, 88], [9, 57], [28, 11], [72, 11], [91, 57]],
  6: [[50, 88], [11, 70], [13, 24], [50, 10], [87, 24], [89, 70]],
  7: [[50, 88], [16, 79], [9, 39], [32, 10], [68, 10], [91, 39], [84, 79]],
  8: [[50, 88], [20, 82], [8, 48], [23, 14], [50, 9], [77, 14], [92, 48], [80, 82]],
}

export const GameSeat = ({ name, avatar, index, total, cards, active, local, eliminated, status }: {
  name: string
  avatar?: string
  index: number
  total: number
  cards?: number
  active?: boolean
  local?: boolean
  eliminated?: boolean
  status?: string
}) => {
  const [x, y] = seatPositions[total]?.[index] ?? [50, 50]
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return (
    <div
      className={`game-seat ${active ? 'is-active' : ''} ${local ? 'is-local' : ''} ${eliminated ? 'is-eliminated' : ''}`}
      style={{ '--seat-x': `${x}%`, '--seat-y': `${y}%` } as CSSProperties}
      aria-label={`${name}${local ? ', você' : ''}${cards === undefined ? '' : `, ${cards} cartas`}${status ? `, ${status}` : ''}`}
      title={name}
      data-seat-index={index}
    >
      {cards !== undefined && cards > 0 && <span className="game-seat__cards" aria-hidden="true">
        {Array.from({ length: Math.min(cards, 3) }, (_, card) => <i key={card} />)}
      </span>}
      <span className="game-seat__portrait">{avatar ? <img alt="" src={avatar} /> : <b>{initials || '?'}</b>}</span>
      {cards !== undefined && <span className="game-seat__count" title={`${cards} cartas`}>{cards}</span>}
      <strong className="game-seat__name">{name}</strong>
      {status && <span className="game-seat__status">{status}</span>}
    </div>
  )
}

export const GameHud = ({ title, subtitle, children, onOpenGameHub, onExit }: {
  title: string
  subtitle?: string
  children?: ReactNode
  onOpenGameHub: () => void
  onExit: () => void
}) => (
  <header className="game-hud">
    <button className="game-hud__switch" onClick={onOpenGameHub} title="Escolher outro jogo" type="button">
      <strong>{title}</strong><Icon name="chevron" />
    </button>
    {subtitle && <span className="game-hud__subtitle">{subtitle}</span>}
    {children}
    <button aria-label="Voltar para a call" className="game-icon-button" onClick={onExit} title="Voltar para a call" type="button"><Icon name="x" /></button>
  </header>
)

export const GameError = ({ error, onClose }: { error: string; onClose: () => void }) => error ? (
  <div className="game-error" role="alert"><Icon name="warning" /><span>{error}</span><button aria-label="Fechar aviso" onClick={onClose} type="button"><Icon name="x" /></button></div>
) : null

export const GameModal = ({ title, detail, children, onClose, wide = false }: {
  title: string
  detail?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const detailId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return createPortal(
    <dialog
      aria-labelledby={titleId}
      aria-describedby={detail ? detailId : undefined}
      className={`game-modal ${wide ? 'game-modal--wide' : ''}`}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      ref={dialogRef}
    >
      <div className="game-modal__panel">
        <header><div><h2 id={titleId}>{title}</h2>{detail && <p id={detailId}>{detail}</p>}</div><button aria-label="Fechar" className="game-icon-button" onClick={onClose} type="button"><Icon name="x" /></button></header>
        <div className="game-modal__body">{children}</div>
      </div>
    </dialog>, document.body,
  )
}

export const NumberCard = ({ value, hidden = false }: { value: number | string; hidden?: boolean }) => (
  <span className={`game-number-card ${hidden ? 'game-number-card--back' : ''}`}>
    <span className="game-number-card__corner">{hidden ? '✦' : value}</span>
    <strong>{hidden ? '?' : value}</strong>
    <span className="game-number-card__corner game-number-card__corner--bottom" aria-hidden="true">{hidden ? '✦' : value}</span>
  </span>
)

export const GameLobby = ({ title, eyebrow, description, art, participants, disabled, onStart, onRules, note }: {
  title: ReactNode
  eyebrow: string
  description: string
  art: ReactNode
  participants: ParticipantMedia[]
  disabled: boolean
  onStart: () => void
  onRules: () => void
  note: string
}) => (
  <div className="game-lobby">
    <div className="game-lobby__art" aria-hidden="true">{art}</div>
    <div className="game-lobby__copy"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p>
      <div className="game-lobby__guests">{participants.map((person) => <span key={person.id} title={person.name}>{person.avatarDataUrl ? <img alt={person.name} src={person.avatarDataUrl} /> : person.name.slice(0, 1).toUpperCase()}</span>)}</div>
      <div className="game-lobby__actions"><button className="game-action" onClick={onRules} type="button">Como jogar</button><button className="game-action game-action--primary" disabled={disabled} onClick={onStart} type="button"><Icon name="play" />Jogar</button></div><small>{note}</small>
    </div>
  </div>
)
