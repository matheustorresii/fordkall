import { useState } from 'react'
import type { ParticipantMedia } from '../../types'
import type { MindRoomState } from '../../hooks/useRoomMind'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameLobby, GameModal, GameSeat, NumberCard } from './GameTable'
import './TheMindStage.css'
import { useGameMotion, useGameResultPause } from './useGameMotion'

interface MindGame {
  state: MindRoomState
  hand: number[]
  error: string
  clearError: () => void
  participantCount: number
  start: () => boolean
  play: (card: number) => boolean
  voteShuriken: () => boolean
  nextLevel: () => boolean
  reset: () => boolean
}
interface TheMindStageProps { game: MindGame; participants: ParticipantMedia[]; onExit: () => void; onOpenGameHub: () => void }

export const TheMindStage = ({ game, participants, onExit, onOpenGameHub }: TheMindStageProps) => {
  const [modal, setModal] = useState<'rules' | 'sequence' | 'end' | null>(null)
  const [dismissedResult, setDismissedResult] = useState('')
  const localIdentity = participants.find((person) => person.isLocal)?.id ?? ''
  const localPlayer = game.state.players.find((player) => player.identity === localIdentity)
  const seats = arrangeSeats(game.state.players, localIdentity)
  const hasVoted = game.state.shurikenVotes.includes(localIdentity)
  const resultKey = `${game.state.gameId}:${game.state.level}:${game.state.phase}`
  const hasResult = ['level-result', 'won', 'lost'].includes(game.state.phase)
  const resultReady = useGameResultPause(resultKey, hasResult)
  const showResult = resultReady && dismissedResult !== resultKey && !modal
  const motionRef = useGameMotion(`${game.state.played.join(',')}:${game.hand.join(',')}:${game.state.phase}`, `${game.state.gameId}:${game.state.level}`)
  const lastCard = game.state.played.at(-1)
  const lastPlayer = game.state.lastMistake?.identity ? game.state.players.find((player) => player.identity === game.state.lastMistake?.identity)?.name : undefined

  return <section aria-label="The Mind" className={`mind-stage ${game.state.phase === 'lobby' ? 'mind-stage--lobby' : 'game-match'}`} ref={motionRef}>
    <GameHud onExit={onExit} onOpenGameHub={onOpenGameHub} subtitle={game.state.phase === 'lobby' ? '2–4 jogadores' : `Nível ${game.state.level}/${game.state.maxLevel}`} title="The Mind"><button aria-label="Regras de The Mind" className="game-icon-button" onClick={() => setModal('rules')} type="button">?</button></GameHud>
    <GameError error={game.error} onClose={game.clearError} />
    {game.state.phase === 'lobby' ? <GameLobby art={<><NumberCard value={17} /><NumberCard value={68} /></>} description="Joguem em ordem crescente sem contar seus números. Uma equipe, um ritmo — sintam a hora de jogar." disabled={game.participantCount < 2 || game.participantCount > 4} eyebrow="2–4 JOGADORES · COOPERATIVO" note={game.participantCount < 2 ? 'Entre com mais uma pessoa para jogar.' : 'Confiem na intuição da equipe.'} onRules={() => setModal('rules')} onStart={game.start} participants={participants} title={<>The<br />Mind</>} /> : <>
      <div className="game-arena mind-arena">
        <div className="game-table-felt" />
        <div className="mind-match-resources" aria-label={`Nível ${game.state.level}, ${game.state.lives} vidas, ${game.state.shurikens} shurikens`}><span>NÍVEL <b>{game.state.level}</b></span><span className="mind-lives">♥ <b>{game.state.lives}</b></span><span>✦ <b>{game.state.shurikens}</b></span></div>
        {seats.map((player, index) => <GameSeat active={player.identity === localIdentity && player.cardsRemaining > 0} avatar={participants.find((person) => person.id === player.identity)?.avatarDataUrl} cards={player.cardsRemaining} index={index} key={player.identity} local={player.identity === localIdentity} name={player.name} status={game.state.shurikenVotes.includes(player.identity) ? '✦ Votou' : player.cardsRemaining === 0 ? 'Sem cartas' : undefined} total={seats.length} />)}
        <button aria-label={`Ver sequência, ${game.state.played.length} cartas jogadas`} className={`mind-pile ${game.state.lastMistake ? 'mind-pile--mistake' : ''}`} onClick={() => setModal('sequence')} type="button">
          {game.state.played.slice(-3, -1).map((card) => <span className="mind-pile__previous" key={card}><NumberCard value={card} /></span>)}
          <span className="mind-pile__top" data-game-card={lastCard === undefined ? undefined : `mind-${lastCard}`} key={`${game.state.level}-${lastCard ?? 'empty'}`}>{lastCard !== undefined ? <NumberCard value={lastCard} /> : <span className="mind-pile__empty"><i>✦</i><strong>Confie no tempo.</strong><small>O menor número começa.</small></span>}</span>
          <span className="mind-pile__caption">{game.state.played.length ? `${game.state.played.length} cartas jogadas` : 'A mesa está pronta'}<Icon name="eye" /></span>
        </button>
        {game.state.lastMistake ? <p className="game-table-note mind-mistake" key={`${game.state.lastMistake.playedCard}`} role="status">−1 vida · {lastPlayer ?? 'Alguém'} jogou {game.state.lastMistake.playedCard} antes de {game.state.lastMistake.lowerCards.map((card) => card.value).join(', ')}.</p> : <p className="game-table-note" key={game.state.lastEvent} role="status">{game.state.lastEvent || 'Respirem. A menor carta abre a rodada.'}</p>}
      </div>
      <div className="game-hand mind-hand"><div className="game-hand__toolbar"><div className="game-hand__label"><strong>Sua mão</strong><small>{game.hand.length} cartas</small></div><div className="game-hand__actions">{hasResult ? <button className="game-action game-action--primary" onClick={() => setDismissedResult('')} type="button">{game.state.phase === 'level-result' ? 'Próximo nível' : 'Resultado'}</button> : game.state.shurikens > 0 && localPlayer && <button className={`game-action ${hasVoted ? 'is-selected' : ''}`} disabled={hasVoted} onClick={game.voteShuriken} type="button">✦ {hasVoted ? 'Votou' : 'Usar shuriken'} · {game.state.shurikenVotes.length}/{game.state.players.length}</button>}<button aria-label="Encerrar partida" className="game-icon-button" onClick={() => setModal('end')} type="button"><Icon name="menu" /></button></div></div>
        <div className="game-hand__rail">{game.state.phase === 'playing' && localPlayer ? game.hand.map((card) => <button aria-label={`Jogar carta ${card}`} className="mind-hand-card" data-game-card={`mind-${card}`} key={card} onClick={() => game.play(card)} type="button"><NumberCard value={card} /></button>) : null}{(!localPlayer || !game.hand.length || hasResult) && <span className="mind-hand-empty">{hasResult ? 'A equipe chegou ao fim deste nível.' : localPlayer ? 'Acompanhe o tempo da equipe…' : 'Você está assistindo à partida.'}</span>}</div>
      </div>
    </>}
    {modal === 'sequence' ? <GameModal detail="Números jogados nesta rodada, na ordem em que chegaram à mesa." onClose={() => setModal(null)} title="Sequência da equipe" wide><div className="mind-sequence-history">{game.state.played.map((card) => <NumberCard key={card} value={card} />)}</div>{!game.state.played.length && <p className="game-modal__hint">A primeira carta ainda não foi jogada.</p>}</GameModal>
      : modal === 'rules' ? <GameModal onClose={() => setModal(null)} title="Como jogar The Mind"><div className="game-rules"><p>Joguem suas cartas em ordem crescente, de 1 a 100. Vocês podem falar, mas não podem contar seus números nem combinar uma ordem.</p><p>Quando sentir que sua carta é a menor, jogue. Uma carta fora de ordem custa uma vida e as cartas menores que ficaram nas mãos são descartadas.</p><p>Se todo mundo votar em usar um <strong>shuriken</strong>, cada pessoa descarta sua menor carta. Os níveis avançam com mais cartas por pessoa.</p><p>A equipe vence ao completar todos os níveis antes que acabem as vidas.</p></div></GameModal>
        : modal === 'end' ? <GameModal detail="A partida termina para toda a equipe." onClose={() => setModal(null)} title="Encerrar The Mind?"><div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Continuar</button><button className="game-action game-action--danger" onClick={() => { if (game.reset()) setModal(null) }} type="button">Encerrar</button></div></GameModal> : null}
    {showResult && <GameModal detail={game.state.phase === 'level-result' ? `Preparem-se: o nível ${game.state.level + 1} traz mais cartas.` : game.state.phase === 'won' ? 'Vocês completaram todos os níveis juntos.' : 'As vidas acabaram. Uma nova partida traz outro ritmo.'} onClose={() => setDismissedResult(resultKey)} title={game.state.phase === 'level-result' ? `Nível ${game.state.level} completo!` : game.state.phase === 'won' ? 'Uma mente só. Vocês venceram!' : 'Fim de partida'}><div className="mind-result-art">{game.state.phase === 'lost' ? '♡' : '✦'}</div><div className="game-modal__actions"><button className="game-action" onClick={onOpenGameHub} type="button">Escolher jogo</button><button className="game-action game-action--primary" onClick={game.state.phase === 'level-result' ? game.nextLevel : game.start} type="button">{game.state.phase === 'level-result' ? `Jogar nível ${game.state.level + 1}` : 'Jogar de novo'}</button></div></GameModal>}
  </section>
}
