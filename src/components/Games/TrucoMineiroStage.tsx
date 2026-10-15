import { useState } from 'react'
import type { ParticipantMedia } from '../../types'
import type { TrucoCard, TrucoRoomState } from '../../hooks/useRoomTruco'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameLobby, GameModal, GameSeat } from './GameTable'
import './TrucoMineiroStage.css'

interface TrucoGame {
  state: TrucoRoomState; hand: TrucoCard[]; error: string; clearError: () => void; participantCount: number
  start: () => boolean; play: (cardId: string) => boolean; callTruco: () => boolean
  acceptRaise: () => boolean; refuseRaise: () => boolean; nextHand: () => boolean; reset: () => boolean
}
interface TrucoMineiroStageProps { game: TrucoGame; participants: ParticipantMedia[]; onExit: () => void; onOpenGameHub: () => void }
const suitMark: Record<TrucoCard['suit'], string> = { paus: '♣', ouros: '♦', copas: '♥', espadas: '♠' }
const isManilha = (card: TrucoCard) => ['4-paus', '7-copas', 'A-espadas', '7-ouros'].includes(card.id)
export const TrucoCardFace = ({ card }: { card: TrucoCard }) => <span className={`truco-card-face ${card.suit === 'copas' || card.suit === 'ouros' ? 'is-red' : ''} ${isManilha(card) ? 'is-manilha' : ''}`}>
  <span className="truco-card-face__corner"><b>{card.rank}</b><i>{suitMark[card.suit]}</i></span><strong>{suitMark[card.suit]}</strong><span className="truco-card-face__corner truco-card-face__corner--bottom" aria-hidden="true"><b>{card.rank}</b><i>{suitMark[card.suit]}</i></span>{isManilha(card) && <small>✦</small>}
</span>

export const TrucoMineiroStage = ({ game, participants, onExit, onOpenGameHub }: TrucoMineiroStageProps) => {
  const [modal, setModal] = useState<'rules' | 'end' | null>(null)
  const [dismissedResult, setDismissedResult] = useState('')
  const [dismissedRaise, setDismissedRaise] = useState('')
  const localIdentity = participants.find((person) => person.isLocal)?.id ?? ''
  const localPlayer = game.state.players.find((player) => player.identity === localIdentity)
  const isMyTurn = game.state.players[game.state.currentSeat]?.identity === localIdentity
  const seats = arrangeSeats([...game.state.players].sort((a, b) => a.seat - b.seat), localIdentity)
  const pendingRaise = game.state.pendingRaise
  const raiseKey = pendingRaise ? `${pendingRaise.identity}:${pendingRaise.targetStake}:${game.state.scores.join(':')}` : ''
  const canAnswerRaise = Boolean(pendingRaise && localPlayer && pendingRaise.team !== localPlayer.team && isMyTurn)
  const visiblePlays = game.state.trickPlays.length ? game.state.trickPlays : game.state.lastTrick
  const resultKey = `${game.state.phase}:${game.state.revision}`
  const hasResult = game.state.phase === 'hand-result' || game.state.phase === 'finished'
  const showResult = hasResult && dismissedResult !== resultKey && !modal
  const teamIndex = localPlayer?.team ?? 0
  const myScore = game.state.scores[teamIndex]
  const otherScore = game.state.scores[teamIndex === 0 ? 1 : 0]
  const askLabel = game.state.stake === 2 ? 'Truco' : game.state.stake === 4 ? 'Seis' : game.state.stake === 6 ? 'Dez' : 'Doze'

  return <section aria-label="Truco Mineiro" className={`truco-stage ${game.state.phase === 'lobby' ? 'truco-stage--lobby' : 'game-match'}`}>
    <GameHud onExit={onExit} onOpenGameHub={onOpenGameHub} subtitle="Duplas · até 12 pontos" title="Truco Mineiro"><button aria-label="Regras do Truco Mineiro" className="game-icon-button" onClick={() => setModal('rules')} type="button">?</button></GameHud>
    <GameError error={game.error} onClose={game.clearError} />
    {game.state.phase === 'lobby' ? <GameLobby art={<><span className="truco-lobby-card"><TrucoCardFace card={{ id: '4-paus', rank: '4', suit: 'paus' }} /></span><span className="truco-lobby-card"><TrucoCardFace card={{ id: '7-copas', rank: '7', suit: 'copas' }} /></span></>} description="Duas duplas, manilhas fixas e aquela dúvida antes de aceitar o Truco. A primeira dupla a marcar 12 leva a mesa." disabled={game.participantCount !== 4} eyebrow="4 JOGADORES · DUPLAS" note={game.participantCount === 4 ? 'Duplas alternadas na mesa.' : `Aguardando 4 pessoas · ${game.participantCount} na sala`} onRules={() => setModal('rules')} onStart={game.start} participants={participants} title={<>Truco<br />Mineiro</>} /> : <>
      <div className="game-arena truco-arena"><div className="game-table-felt" />
        <div className="truco-scoreboard" aria-label={`Placar ${myScore} a ${otherScore}`}><span>{localPlayer ? 'NÓS' : 'DUPLA 1'}<b>{myScore}</b></span><i>—</i><span>{localPlayer ? 'ELES' : 'DUPLA 2'}<b>{otherScore}</b></span></div>
        {seats.map((player, index) => <GameSeat active={game.state.phase === 'playing' && game.state.currentSeat === player.seat} avatar={participants.find((person) => person.id === player.identity)?.avatarDataUrl} cards={player.identity === localIdentity ? game.hand.length : Math.max(0, 3 - game.state.trickIndex - Number(game.state.trickPlays.some((play) => play.identity === player.identity)))} index={index} key={player.identity} local={player.identity === localIdentity} name={player.name} status={`Dupla ${player.team + 1}${player.seat === game.state.dealerSeat ? ' · D' : ''}`} total={seats.length} />)}
        <div className="truco-center"><span className="truco-stake">MÃO VALENDO <b>{game.state.stake}</b></span><div className="truco-trick" aria-label="Cartas desta vaza">{visiblePlays.map((play) => <div aria-label={`${game.state.players.find((player) => player.identity === play.identity)?.name}: ${play.card.rank} de ${play.card.suit}`} className={`truco-table-card truco-table-card--seat-${seats.findIndex((player) => player.identity === play.identity)}`} key={play.card.id} title={`${game.state.players.find((player) => player.identity === play.identity)?.name} · ${play.card.rank}${suitMark[play.card.suit]}`}><TrucoCardFace card={play.card} /></div>)}{!visiblePlays.length && <span className="truco-empty-trick">{isMyTurn ? 'Abra a vaza.' : 'A primeira carta abre a vaza.'}</span>}</div></div>
        <p className="game-table-note" role="status">{pendingRaise ? `${game.state.players.find((player) => player.identity === pendingRaise.identity)?.name} pediu ${pendingRaise.targetStake} pontos.` : hasResult ? game.state.lastHandMessage : isMyTurn ? 'Sua vez · jogue uma carta ou peça Truco.' : `Vez de ${game.state.players[game.state.currentSeat]?.name ?? '…'}`}</p>
      </div>
      <div className="game-hand truco-hand"><div className="game-hand__toolbar"><div className="game-hand__label"><strong>Sua mão</strong><small>{game.hand.length} cartas</small></div><div className="game-hand__actions">{canAnswerRaise ? <button className="game-action game-action--primary" onClick={() => setDismissedRaise('')} type="button">Responder aposta</button> : game.state.phase === 'playing' && isMyTurn && !pendingRaise && game.state.stake < 12 ? <button className="game-action game-action--primary" onClick={game.callTruco} type="button">Pedir {askLabel}!</button> : null}{hasResult && <button className="game-action game-action--primary" onClick={() => setDismissedResult('')} type="button">{game.state.phase === 'finished' ? 'Resultado' : 'Próxima mão'}</button>}<button aria-label="Encerrar partida" className="game-icon-button" onClick={() => setModal('end')} type="button"><Icon name="menu" /></button></div></div>
        <div className="game-hand__rail">{game.state.phase === 'playing' && localPlayer && game.hand.map((card) => <button aria-label={`Jogar ${card.rank} de ${card.suit}`} className="truco-hand-card" disabled={!isMyTurn || Boolean(pendingRaise)} key={card.id} onClick={() => game.play(card.id)} type="button"><TrucoCardFace card={card} /></button>)}{(!localPlayer || hasResult || !game.hand.length) && <span className="truco-hand-empty">{hasResult ? 'A vaza está resolvida.' : localPlayer ? 'Acompanhe a mesa…' : 'Você está assistindo à partida.'}</span>}</div>
      </div>
    </>}
    {modal === 'rules' ? <GameModal onClose={() => setModal(null)} title="Truco Mineiro"><div className="game-rules"><p>Quatro pessoas em duplas alternadas. Cada mão começa valendo 2 pontos. A dupla que chegar a 12 vence.</p><p><strong>Manilhas fixas, da mais forte:</strong> 4♣, 7♥, A♠, 7♦.</p><p>Na sua vez, jogue uma carta ou aumente a aposta: Truco (4), Seis (6), Dez (10) e Doze (12). A outra dupla pode aceitar, correr ou aumentar.</p><p>A marca <strong>D</strong> identifica quem distribui o baralho nesta mão.</p></div></GameModal> : modal === 'end' ? <GameModal detail="A partida termina para todas as pessoas da mesa." onClose={() => setModal(null)} title="Encerrar Truco?"><div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Continuar</button><button className="game-action game-action--danger" onClick={() => { if (game.reset()) setModal(null) }} type="button">Encerrar</button></div></GameModal> : null}
    {canAnswerRaise && pendingRaise && dismissedRaise !== raiseKey && !modal && <GameModal detail={`${game.state.players.find((player) => player.identity === pendingRaise.identity)?.name} colocou ${pendingRaise.targetStake} pontos na mesa.`} onClose={() => setDismissedRaise(raiseKey)} title="Vai encarar?"><div className="truco-raise-value">{pendingRaise.targetStake}<small>PONTOS</small></div><div className="game-modal__actions"><button className="game-action" onClick={game.refuseRaise} type="button">Correr</button>{pendingRaise.targetStake < 12 && <button className="game-action" onClick={game.callTruco} type="button">Aumentar</button>}<button className="game-action game-action--primary" onClick={game.acceptRaise} type="button">Aceitar {pendingRaise.targetStake}</button></div></GameModal>}
    {showResult && <GameModal detail={game.state.lastHandMessage} onClose={() => setDismissedResult(resultKey)} title={game.state.phase === 'finished' ? `Dupla ${Number(game.state.handWinner) + 1} venceu!` : 'Mão encerrada'}><div className="truco-result-score"><strong>{game.state.scores[0]}</strong><span>—</span><strong>{game.state.scores[1]}</strong></div><div className="game-modal__actions"><button className="game-action" onClick={onOpenGameHub} type="button">Escolher jogo</button><button className="game-action game-action--primary" onClick={game.state.phase === 'finished' ? game.reset : game.nextHand} type="button">{game.state.phase === 'finished' ? 'Nova partida' : 'Próxima mão'}</button></div></GameModal>}
  </section>
}
