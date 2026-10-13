import type { ParticipantMedia } from '../../types'
import type { TrucoCard, TrucoRoomState } from '../../hooks/useRoomTruco'
import { Icon } from '../ui/Icon'
import './TrucoMineiroStage.css'

interface TrucoGame {
  state: TrucoRoomState
  hand: TrucoCard[]
  error: string
  clearError: () => void
  participantCount: number
  start: () => boolean
  play: (cardId: string) => boolean
  callTruco: () => boolean
  acceptRaise: () => boolean
  refuseRaise: () => boolean
  nextHand: () => boolean
  reset: () => boolean
}

interface TrucoMineiroStageProps {
  game: TrucoGame
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}

const suitMark: Record<TrucoCard['suit'], string> = { paus: '♣', ouros: '♦', copas: '♥', espadas: '♠' }
const avatarLetters = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
const cardName = (card: TrucoCard) => `${card.rank}${suitMark[card.suit]}`
const isManilha = (card: TrucoCard) => ['4-paus', '7-copas', 'A-espadas', '7-ouros'].includes(card.id)

export const TrucoMineiroStage = ({ game, participants, onExit, onOpenGameHub }: TrucoMineiroStageProps) => {
  const localIdentity = participants.find((participant) => participant.isLocal)?.id ?? ''
  const localPlayer = game.state.players.find((player) => player.identity === localIdentity)
  const isMyTurn = game.state.players[game.state.currentSeat]?.identity === localIdentity
  const pendingRaise = game.state.pendingRaise
  const canAnswerRaise = Boolean(pendingRaise && localPlayer && pendingRaise.team !== localPlayer.team && isMyTurn)
  const visiblePlays = game.state.trickPlays.length ? game.state.trickPlays : game.state.lastTrick
  const roster = game.state.players.length
    ? game.state.players
    : participants.map((participant, seat) => ({ identity: participant.id, name: participant.name, seat, team: (seat % 2) as 0 | 1 }))

  return (
    <section className="truco-stage" aria-label="Truco Mineiro">
      <header className="truco-stage__topbar">
        <div className="truco-stage__brand">
          <span className="truco-stage__mark"><span>♠</span><span>♥</span></span>
          <div><small>JOGOS DA SALA</small><strong>Truco Mineiro</strong></div>
        </div>
        <button className="truco-stage__hub-button" onClick={onOpenGameHub} type="button">
          <Icon name="gamepad" />Trocar jogo
        </button>
        <div className="truco-stage__topbar-actions">
          {game.state.gameId && <span className="truco-stage__status"><i />{game.state.players.length}/4 na mesa</span>}
          <button aria-label="Voltar para a call" className="icon-button" onClick={onExit} title="Voltar para a call" type="button"><Icon name="x" /></button>
        </div>
      </header>

      {game.error && (
        <div className="truco-stage__error" role="alert">
          <Icon name="warning" /><span>{game.error}</span>
          <button aria-label="Fechar aviso" onClick={game.clearError} type="button"><Icon name="x" /></button>
        </div>
      )}

      {game.state.phase === 'lobby' && (
        <div className="truco-lobby">
          <div className="truco-lobby__intro">
            <span className="truco-eyebrow">DUELO DE DUPLAS · MANILHAS FIXAS</span>
            <h2>Truco Mineiro,<br />sem sair da call.</h2>
            <p>Quatro pessoas, duas duplas alternadas e uma partida até 12 pontos. As cartas e a vez ficam sincronizadas para todo mundo.</p>
          </div>
          <div className="truco-lobby__rules">
            <div><small>MANILHAS · DA MAIS FORTE</small><strong>4♣ <span>›</span> 7♥ <span>›</span> A♠ <span>›</span> 7♦</strong></div>
            <div><small>APOSTA DA MÃO</small><strong>2 <span>›</span> 4 <span>›</span> 6 <span>›</span> 10 <span>›</span> 12</strong></div>
            <p>Truco, Seis, Dez e Doze. As cartas de cada pessoa só aparecem para ela.</p>
          </div>
          <div className="truco-lobby__footer">
            <div>
              <small>NA SALA · {game.participantCount} DE 4</small>
              <div className="truco-roster">
                {roster.map((player) => {
                  const participant = participants.find((person) => person.id === player.identity)
                  return (
                    <span className="truco-roster__person" key={player.identity}>
                      <i>{participant?.avatarDataUrl ? <img alt="" src={participant.avatarDataUrl} /> : avatarLetters(player.name)}</i>
                      <span>{player.name}{participant?.isLocal ? ' · você' : ''}</span>
                    </span>
                  )
                })}
              </div>
            </div>
            <button className="truco-button truco-button--primary" disabled={game.participantCount !== 4} onClick={game.start} type="button">
              <Icon name="play" />Começar partida
            </button>
          </div>
          {game.participantCount !== 4 && <small className="truco-lobby__hint">A mesa abre quando houver exatamente 4 pessoas na sala.</small>}
        </div>
      )}

      {game.state.phase !== 'lobby' && (
        <div className="truco-table">
          <div className="truco-table__heading">
            <div>
              <span className="truco-eyebrow">{game.state.phase === 'finished' ? 'PARTIDA ENCERRADA' : `MÃO · ${game.state.stake} PONTOS`}</span>
              <h2>{game.state.phase === 'finished' ? `Dupla ${Number(game.state.handWinner) + 1} venceu a partida` : game.state.phase === 'hand-result' ? 'Mão encerrada' : pendingRaise ? 'A aposta está na mesa' : 'Sua vez de jogar'}</h2>
            </div>
            <div className="truco-score" aria-label={`Placar ${game.state.scores[0]} a ${game.state.scores[1]}`}>
              <span className="truco-score__team truco-score__team--0"><small>DUPLA 1</small><strong>{game.state.scores[0]}</strong></span>
              <span className="truco-score__divider">–</span>
              <span className="truco-score__team truco-score__team--1"><small>DUPLA 2</small><strong>{game.state.scores[1]}</strong></span>
            </div>
          </div>

          {game.state.lastHandMessage && <p className="truco-table__message">{game.state.lastHandMessage}</p>}

          <div className="truco-table__players">
            {[...game.state.players].sort((a, b) => a.seat - b.seat).map((player) => {
              const participant = participants.find((person) => person.id === player.identity)
              const isCurrent = game.state.phase === 'playing' && game.state.currentSeat === player.seat
              return (
                <div className={`truco-player truco-player--team-${player.team} ${isCurrent ? 'is-current' : ''}`} key={player.identity}>
                  <i className="truco-player__avatar">{participant?.avatarDataUrl ? <img alt="" src={participant.avatarDataUrl} /> : avatarLetters(player.name)}</i>
                  <span><strong>{player.name}{player.identity === localIdentity ? ' · você' : ''}</strong><small>Dupla {player.team + 1}{player.seat === game.state.dealerSeat ? ' · mão do baralho' : ''}</small></span>
                  {isCurrent && <em>SUA VEZ</em>}
                  {visiblePlays.find((play) => play.identity === player.identity) && (
                    <b className={`truco-play-card ${visiblePlays.find((play) => play.identity === player.identity)?.card.suit === 'copas' || visiblePlays.find((play) => play.identity === player.identity)?.card.suit === 'ouros' ? 'is-red' : ''}`}>
                      {cardName(visiblePlays.find((play) => play.identity === player.identity)!.card)}
                    </b>
                  )}
                </div>
              )
            })}
          </div>

          {pendingRaise && (
            <div className="truco-raise" role="status">
              <div><small>APOSTA EM RESPOSTA</small><strong>{game.state.players.find((player) => player.identity === pendingRaise.identity)?.name} pediu {pendingRaise.targetStake} pontos.</strong></div>
              {canAnswerRaise && <div className="truco-raise__actions">
                <button className="truco-button truco-button--subtle" onClick={game.refuseRaise} type="button">Correr</button>
                {pendingRaise.targetStake < 12 && <button className="truco-button" onClick={game.callTruco} type="button">Aumentar</button>}
                <button className="truco-button truco-button--primary" onClick={game.acceptRaise} type="button">Aceitar {pendingRaise.targetStake}</button>
              </div>}
            </div>
          )}

          {game.state.phase === 'playing' && !pendingRaise && (
            <div className="truco-table__call-row">
              <span>{isMyTurn ? 'Escolha uma carta ou aumente a aposta.' : `Vez de ${game.state.players[game.state.currentSeat]?.name ?? 'aguardando'}.`}</span>
              {isMyTurn && game.state.stake < 12 && <button className="truco-button truco-button--raise" onClick={game.callTruco} type="button">Pedir {game.state.stake === 2 ? 'Truco' : game.state.stake === 4 ? 'Seis' : game.state.stake === 6 ? 'Dez' : 'Doze'}</button>}
            </div>
          )}

          {game.state.phase === 'playing' && (
            <div className="truco-hand">
              <div className="truco-hand__heading"><strong>Sua mão</strong><small>{localPlayer ? `${game.hand.length} cartas` : 'Você está acompanhando a partida'}</small></div>
              {localPlayer ? (
                <div className="truco-hand__cards">
                  {game.hand.map((card) => (
                    <button
                      className={`truco-card ${card.suit === 'copas' || card.suit === 'ouros' ? 'is-red' : ''} ${isManilha(card) ? 'is-manilha' : ''}`}
                      disabled={!isMyTurn || Boolean(pendingRaise)}
                      key={card.id}
                      onClick={() => game.play(card.id)}
                      title={`${card.rank} de ${card.suit}${isManilha(card) ? ' · manilha fixa' : ''}`}
                      type="button"
                    >
                      <strong>{card.rank}</strong><span>{suitMark[card.suit]}</span>
                      {isManilha(card) && <small>MANILHA</small>}
                    </button>
                  ))}
                  {!game.hand.length && <span className="truco-hand__waiting">Recebendo suas cartas…</span>}
                </div>
              ) : <p className="truco-hand__waiting">Você pode assistir à mão; as cartas privadas ficam visíveis apenas para cada jogador.</p>}
            </div>
          )}

          {game.state.phase === 'hand-result' && (
            <div className="truco-result-actions">
              <button className="truco-button truco-button--primary" onClick={game.nextHand} type="button"><Icon name="refresh" />Próxima mão</button>
              <button className="truco-button truco-button--subtle" onClick={game.reset} type="button">Encerrar partida</button>
            </div>
          )}
          {game.state.phase === 'finished' && (
            <div className="truco-result-actions">
              <button className="truco-button truco-button--primary" onClick={game.reset} type="button"><Icon name="refresh" />Nova partida</button>
              <button className="truco-button truco-button--subtle" onClick={onOpenGameHub} type="button">Escolher outro jogo</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
