import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { ParticipantMedia } from '../../types'
import type { ItoPlayer, ItoRoomState } from '../../hooks/useRoomIto'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameLobby, GameModal, GameSeat, NumberCard } from './GameTable'
import './ItoGameStage.css'

interface ItoGameController {
  state: ItoRoomState; localNumber: number | null; error: string; clearError: () => void; isController: boolean
  participantCount: number; isParticipating: boolean; start: () => boolean; submitClue: (clue: string) => boolean
  movePlayer: (identity: string, offset: -1 | 1) => boolean; reveal: () => boolean; reset: () => boolean
}
interface ItoGameStageProps { game: ItoGameController; participants: ParticipantMedia[]; onExit: () => void; onOpenGameHub: () => void }

export const ItoGameStage = ({ game, participants, onExit, onOpenGameHub }: ItoGameStageProps) => {
  const [draft, setDraft] = useState('')
  const [modal, setModal] = useState<'rules' | 'end' | null>(null)
  const [dismissedResult, setDismissedResult] = useState('')
  const orderRailRef = useRef<HTMLDivElement>(null)
  const previousCardPositions = useRef(new Map<string, DOMRect>())
  const myIdentity = participants.find((person) => person.isLocal)?.id ?? ''
  const myPlayer = game.state.players.find((player) => player.identity === myIdentity)
  const seats = arrangeSeats(game.state.players, myIdentity)
  const orderedPlayers = game.state.order.map((identity) => game.state.players.find((player) => player.identity === identity)).filter((player): player is ItoPlayer => Boolean(player))
  const submittedCount = game.state.players.filter((player) => player.clue).length
  const resultKey = `${game.state.gameId}:${game.state.phase}`

  useEffect(() => setDraft(''), [game.state.gameId])
  useLayoutEffect(() => {
    const cards = Array.from(orderRailRef.current?.querySelectorAll<HTMLElement>('[data-ito-player]') ?? [])
    const positions = new Map<string, DOMRect>()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const card of cards) {
      const identity = card.dataset.itoPlayer!
      const next = card.getBoundingClientRect()
      const previous = previousCardPositions.current.get(identity)
      if (previous && !reduceMotion && (previous.left !== next.left || previous.top !== next.top)) card.animate([
        { transform: `translate(${previous.left - next.left}px, ${previous.top - next.top}px)` }, { transform: 'translate(0, 0)' },
      ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' })
      positions.set(identity, next)
    }
    previousCardPositions.current = positions
  }, [game.state.order, game.state.gameId])
  const submitClue = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (game.submitClue(draft)) setDraft('') }

  return <section aria-label="Jogo ITO" className={`ito-stage ${game.state.phase === 'lobby' ? 'ito-stage--lobby' : 'game-match'}`} data-phase={game.state.phase} data-player-count={game.state.players.length}>
    <GameHud onExit={onExit} onOpenGameHub={onOpenGameHub} subtitle="Uma ordem, várias intuições" title="ITO"><button aria-label="Regras do ITO" className="game-icon-button" onClick={() => setModal('rules')} type="button">?</button></GameHud>
    <GameError error={game.error} onClose={game.clearError} />
    {game.state.phase === 'lobby' ? <GameLobby art={<><NumberCard value={8} /><NumberCard value={92} /></>} description="Cada pessoa recebe um número secreto. Dê uma dica e descubram juntos a ordem de todo mundo." disabled={game.participantCount < 2 || game.participantCount > 8} eyebrow="2–8 JOGADORES · INTUIÇÃO" note={game.participantCount < 2 ? 'Entre com mais uma pessoa para jogar.' : 'A menor dica fica à esquerda. A maior, à direita.'} onRules={() => setModal('rules')} onStart={game.start} participants={participants} title="ITO" /> : <>
      <div className="game-arena ito-arena"><div className="game-table-felt" />
        <span className="ito-round-step">{game.state.phase === 'clue' ? `${submittedCount}/${game.state.players.length} dicas enviadas` : game.state.phase === 'order' ? 'Conversem e movam as cartas' : game.state.succeeded ? 'Ordem perfeita!' : 'A ordem foi revelada'}</span>
        {seats.map((player, index) => <GameSeat active={player.identity === myIdentity && !player.clue} avatar={participants.find((person) => person.id === player.identity)?.avatarDataUrl} index={index} key={player.identity} local={player.identity === myIdentity} name={player.name} status={game.state.phase === 'clue' ? player.clue ? '✓ Dica pronta' : 'Pensando…' : undefined} total={seats.length} />)}
        {game.state.phase === 'clue' ? <div className="ito-topic-card"><small>TEMA DA RODADA</small><h2>{game.state.topic}</h2><span>Pense numa dica que combine com seu número.</span></div> : <div className="ito-order-table"><p>{game.state.topic}</p><div className="ito-scale"><span><b>0</b> MENOR</span><i /><span>MAIOR <b>100</b></span></div>
          <div aria-label="Cartas em ordem, da esquerda para a direita" className="ito-order-rail" ref={orderRailRef}>{orderedPlayers.map((player, index) => <article className="ito-clue-token" data-ito-player={player.identity} key={player.identity}>
            <div className={`ito-clue-face ${game.state.phase === 'revealed' ? 'is-revealed' : ''}`}><small>{String(index + 1).padStart(2, '0')}</small><b className="ito-clue-face__number">{game.state.phase === 'revealed' ? game.state.numbers?.[player.identity] ?? '—' : '?'}</b><blockquote>{player.clue}</blockquote><strong>{player.name}</strong></div>
            {game.state.phase === 'order' && <div className="ito-clue-controls"><button aria-label={`Mover ${player.name} para a esquerda`} className="game-action" disabled={!game.isParticipating || index === 0} onClick={() => game.movePlayer(player.identity, -1)} type="button">←</button><button aria-label={`Mover ${player.name} para a direita`} className="game-action" disabled={!game.isParticipating || index === orderedPlayers.length - 1} onClick={() => game.movePlayer(player.identity, 1)} type="button">→</button></div>}
          </article>)}</div>
        </div>}
      </div>
      <div className="ito-private-zone"><div className="ito-private-number"><small>SEU NÚMERO</small><div><NumberCard hidden={!game.isParticipating || game.localNumber === null} value={game.localNumber ?? '—'} /></div></div>
        {game.state.phase === 'clue' && game.isParticipating ? myPlayer?.clue ? <div className="ito-submitted"><small>SUA DICA</small><strong>{myPlayer.clue}</strong><span>✓ Enviada. Aguarde as outras pessoas.</span></div> : <form className="ito-clue-form" onSubmit={submitClue}><label htmlFor="ito-clue">Qual dica combina com seu número?</label><div><input autoComplete="off" disabled={game.localNumber === null} id="ito-clue" maxLength={80} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="Dê uma dica sem falar o número…" value={draft} /><button aria-label="Enviar dica" className="game-action game-action--primary" disabled={!draft.trim() || game.localNumber === null} type="submit"><Icon name="send" /></button></div><small>Só você vê o número desta carta.</small></form>
          : <div className="ito-private-actions"><p>{game.state.phase === 'order' ? 'Organizem as dicas do menor para o maior.' : game.state.succeeded ? 'Vocês acertaram juntos.' : 'Confiram as cartas e tentem outra rodada.'}</p><div>{game.state.phase === 'order' ? <button className="game-action game-action--primary" disabled={!game.isParticipating || submittedCount !== game.state.players.length} onClick={game.reveal} type="button"><Icon name="eye" />Revelar números</button> : <button className="game-action game-action--primary" onClick={game.reset} type="button"><Icon name="refresh" />Nova rodada</button>}<button aria-label="Encerrar partida" className="game-icon-button" onClick={() => setModal('end')} type="button"><Icon name="menu" /></button></div></div>}
      </div>
    </>}
    {modal === 'rules' ? <GameModal onClose={() => setModal(null)} title="Como jogar ITO"><div className="game-rules"><p>Cada pessoa recebe um número de 1 a 100. O tema indica uma escala: o número menor representa uma ponta e o maior representa a outra.</p><p>Dê uma dica que combine com seu número, sem contar o número nem dar uma pista matemática direta.</p><p>Quando todas as dicas chegarem, conversem e usem as setas para colocar as cartas em ordem, da esquerda (0) para a direita (100).</p><p>Revelem os números quando concordarem. A equipe ganha se a ordem for crescente.</p></div></GameModal> : modal === 'end' ? <GameModal onClose={() => setModal(null)} title="Encerrar a rodada de ITO?"><div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Continuar</button><button className="game-action game-action--danger" onClick={() => { if (game.reset()) setModal(null) }} type="button">Encerrar</button></div></GameModal> : null}
    {game.state.phase === 'revealed' && dismissedResult !== resultKey && !modal && <GameModal detail={game.state.succeeded ? 'As dicas ficaram na ordem certa, do menor número ao maior.' : 'Alguns números ficaram fora de ordem. Vocês podem conferir as cartas na mesa.'} onClose={() => setDismissedResult(resultKey)} title={game.state.succeeded ? 'Ordem perfeita!' : 'Foi por pouco.'}><div className="ito-result-mark">{game.state.succeeded ? '✓' : '↔'}</div><div className="game-modal__actions"><button className="game-action" onClick={() => setDismissedResult(resultKey)} type="button">Ver a mesa</button><button className="game-action game-action--primary" onClick={game.reset} type="button">Nova rodada</button></div></GameModal>}
  </section>
}
