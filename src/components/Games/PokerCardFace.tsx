import type { PokerCard } from '../../games/poker'
import type { CSSProperties } from 'react'

const suits = { s: '♠', h: '♥', d: '♦', c: '♣' }
const suitNames = { s: 'espadas', h: 'copas', d: 'ouros', c: 'paus' }
export const PokerCardFace = ({
  card,
  highlighted = false,
  bestHand = false,
  motion,
  delay = 0,
}: {
  card?: PokerCard
  highlighted?: boolean
  bestHand?: boolean
  motion?: 'deal' | 'flip'
  delay?: number
}) => {
  const suit = card?.[1] as keyof typeof suits | undefined,
    rank = card?.[0] === 'T' ? '10' : card?.[0]
  const label = card && suit ? `${rank} de ${suitNames[suit]}` : 'Carta fechada'
  return (
    <span
      aria-label={`${label}${card && bestHand ? ', sua combinação atual' : ''}`}
      className={`poker-card ${!card ? 'poker-card--back' : ''} ${suit === 'h' || suit === 'd' ? 'is-red' : ''} ${highlighted ? 'is-highlighted' : ''} ${card && bestHand ? 'is-best-hand' : ''}`}
      role="img"
      data-card-motion={motion}
      style={motion ? { '--card-delay': `${delay}ms` } as CSSProperties : undefined}
    >
      {card && suit ? (
        <>
          <span className="poker-card__corner">
            <b>{rank}</b>
            <i>{suits[suit]}</i>
          </span>
          <strong aria-hidden="true">{suits[suit]}</strong>
          <span aria-hidden="true" className="poker-card__corner poker-card__corner--bottom">
            <b>{rank}</b>
            <i>{suits[suit]}</i>
          </span>
        </>
      ) : (
        <i aria-hidden="true">✦</i>
      )}
    </span>
  )
}
