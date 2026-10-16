import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { ParticipantMedia } from '../../types'
import type { ItoCard, useRoomIto } from '../../hooks/useRoomIto'
import { defaultItoSettings, itoNextProgress, itoRequiredVotes, type ItoSettings } from '../../games/itoRules'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameLobby, GameModal, GameSeat, NumberCard } from './GameTable'
import './ItoGameStage.css'
import { useGameMotion, useGameResultPause } from './useGameMotion'

interface ItoGameStageProps { game: ReturnType<typeof useRoomIto>; participants: ParticipantMedia[]; onExit: () => void; onOpenGameHub: () => void }
const lossLabels = { keep: 'Manter as cartas', 'remove-one': 'Remover uma carta extra', reset: 'Voltar a uma carta por pessoa' }
const voteLabels = { majority: 'Maioria absoluta', unanimous: 'Unanimidade', anyone: 'Qualquer pessoa' }

export const ItoGameStage = ({ game, participants, onExit, onOpenGameHub }: ItoGameStageProps) => {
  const [settings, setSettings] = useState<ItoSettings>({ ...defaultItoSettings })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [selectedCardId, setSelectedCardId] = useState('')
  const [modal, setModal] = useState<'rules' | 'settings' | 'end' | null>(null)
  const [dismissedResult, setDismissedResult] = useState('')
  const [railScroll, setRailScroll] = useState({ left: false, right: false })
  const orderRailRef = useRef<HTMLDivElement>(null)
  const { state } = game
  const myIdentity = participants.find((person) => person.isLocal)?.id ?? ''
  const seats = arrangeSeats(state.players, myIdentity)
  const ownCards = state.cards.filter((card) => card.ownerIdentity === myIdentity)
  const activeCard = ownCards.find((card) => card.id === selectedCardId) ?? ownCards.find((card) => !card.clue) ?? ownCards[0]
  const activeValue = game.localCards.find((card) => card.cardId === activeCard?.id)?.value
  const draft = activeCard ? drafts[activeCard.id] ?? activeCard.clue : ''
  const orderedCards = state.order.map((id) => state.cards.find((card) => card.id === id)).filter((card): card is ItoCard => Boolean(card))
  const submittedCount = state.cards.filter((card) => card.clue).length
  const ownSubmittedCount = ownCards.filter((card) => card.clue).length
  const requiredVotes = itoRequiredVotes(state.settings.revealRule, state.players.length)
  const hasVoted = state.revealVotes.includes(myIdentity)
  const resultKey = `${state.gameId}:${state.phase}`
  const resultReady = useGameResultPause(resultKey, state.phase === 'revealed', 1200)
  const motionRef = useGameMotion(`${state.phase}:${state.order.join(',')}:${game.localCards.map((c) => c.value).join(',')}`, state.gameId)
  const maximumExtras = state.players.length * (state.settings.targetCards - 1)
  const nextExtras = itoNextProgress(state.extraCards, Boolean(state.succeeded), state.settings.lossRule, maximumExtras)
  const nextRecipient = state.players[nextExtras > state.extraCards ? state.extraCards % state.players.length : nextExtras % state.players.length]
  const nextRoundNote = state.campaignWon ? `Vocês venceram uma rodada com ${state.settings.targetCards} cartas por pessoa.`
    : state.succeeded ? `${nextRecipient?.name ?? 'Uma pessoa'} recebe mais uma carta na próxima rodada.`
      : state.settings.lossRule === 'keep' ? 'A próxima rodada mantém a quantidade de cartas de cada pessoa.'
        : state.settings.lossRule === 'reset' ? 'Na próxima rodada, todo mundo volta a uma carta.'
          : state.extraCards > 0 ? `${nextRecipient?.name ?? 'Uma pessoa'} terá uma carta a menos na próxima rodada.` : 'Todo mundo continua com uma carta.'
  const effectiveSettings = state.phase === 'lobby' ? settings : state.settings

  useEffect(() => { setDrafts({}); setSelectedCardId('') }, [state.gameId])
  useEffect(() => {
    const rail = orderRailRef.current
    if (!rail) return
    const update = () => setRailScroll({ left: rail.scrollLeft > 2, right: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2 })
    const resize = new ResizeObserver(update)
    resize.observe(rail); rail.addEventListener('scroll', update, { passive: true }); update()
    return () => { resize.disconnect(); rail.removeEventListener('scroll', update) }
  }, [state.gameId, state.phase, state.cards.length])

  const submitClue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeCard || !game.submitClue(activeCard.id, draft)) return
    const next = ownCards.find((card) => card.id !== activeCard.id && !card.clue)
    if (next) setSelectedCardId(next.id)
  }
  const start = () => game.start(settings)

  return <section aria-label="Jogo ITO" className={`ito-stage ${state.phase === 'lobby' ? 'ito-stage--lobby' : 'game-match'}`} data-phase={state.phase} data-player-count={state.players.length} ref={motionRef}>
    <GameHud onExit={onExit} onOpenGameHub={onOpenGameHub} subtitle={state.phase === 'lobby' ? 'Uma ordem, várias intuições' : `Rodada ${state.roundNumber} · ${state.cards.length} cartas`} title="ITO"><button aria-label="Regras do ITO" className="game-icon-button" onClick={() => setModal('rules')} type="button">?</button></GameHud>
    <GameError error={game.error} onClose={game.clearError} />
    {state.phase === 'lobby' ? <GameLobby art={<><NumberCard value={8} /><NumberCard value={92} /></>} description="Comecem com uma carta por pessoa. A cada vitória, mais uma carta entra na próxima rodada. Organizem todas as dicas, juntos." disabled={game.participantCount < 2 || game.participantCount > 8} eyebrow="2–8 JOGADORES · INTUIÇÃO" note={`${voteLabels[settings.revealRule]} para revelar · Meta: ${settings.targetCards} cartas por pessoa · Derrota: ${lossLabels[settings.lossRule].toLowerCase()}`} onRules={() => setModal('rules')} onSettings={() => setModal('settings')} onStart={start} participants={participants} title="ITO" /> : <>
      <div className="game-arena ito-arena"><div className="game-table-felt" />
        <div className="ito-round-step"><strong>Rodada {state.roundNumber}</strong><span>{state.phase === 'clue' ? `${submittedCount}/${state.cards.length} dicas` : state.phase === 'order' ? `${state.revealVotes.length}/${requiredVotes} votos para revelar` : state.campaignWon ? 'Partida vencida!' : state.succeeded ? 'Ordem perfeita!' : 'Ordem revelada'}</span></div>
        {seats.map((player, index) => {
          const owned = state.cards.filter((card) => card.ownerIdentity === player.identity)
          const pending = owned.filter((card) => !card.clue).length
          return <GameSeat active={state.phase === 'clue' && player.identity === myIdentity && pending > 0} avatar={participants.find((person) => person.id === player.identity)?.avatarDataUrl} cards={player.cardCount} index={index} key={player.identity} local={player.identity === myIdentity} name={player.name} status={state.phase === 'clue' ? pending ? `${owned.length - pending}/${owned.length} dicas` : '✓ Dicas prontas' : state.phase === 'order' && state.revealVotes.includes(player.identity) ? '✓ Aprovou' : undefined} total={seats.length} />
        })}
        {state.phase === 'clue' ? <div className="ito-topic-card"><small>TEMA DA RODADA</small><h2>{state.topic}</h2><span>Uma dica para cada carta da sua mão.</span><small>META · {state.settings.targetCards} CARTAS POR PESSOA</small></div> : <div className={`ito-order-table ${railScroll.left || railScroll.right ? 'is-scrollable' : ''}`} style={{ '--ito-card-count': state.cards.length } as CSSProperties}><p>{state.topic}</p><div className="ito-scale"><span><b>0</b> MENOR</span><i /><span>MAIOR <b>100</b></span></div>
          <div aria-label="Cartas em ordem, da esquerda para a direita" className="ito-order-rail" ref={orderRailRef}>{orderedCards.map((card, index) => {
            const owner = state.players.find((person) => person.identity === card.ownerIdentity)
            const ownerIndex = state.cards.filter((item) => item.ownerIdentity === card.ownerIdentity).findIndex((item) => item.id === card.id) + 1
            const label = `${owner?.name ?? 'Pessoa'}${(owner?.cardCount ?? 0) > 1 ? `, carta ${ownerIndex}` : ''}`
            return <article className="ito-clue-token" data-ito-card={card.id} data-game-card={`ito-table-${card.id}`} data-game-revealed={state.phase === 'revealed'} key={card.id}>
              <div className={`ito-clue-face ${state.phase === 'revealed' ? 'is-revealed' : ''}`}><small>{String(index + 1).padStart(2, '0')}</small><b className="ito-clue-face__number">{state.phase === 'revealed' ? state.numbers?.[card.id] ?? '—' : '?'}</b><blockquote>{card.clue}</blockquote><strong>{label}</strong></div>
              {state.phase === 'order' && <div className="ito-clue-controls"><button aria-label={`Mover ${label} para a esquerda`} className="game-action" disabled={!game.isParticipating || index === 0} onClick={() => game.moveCard(card.id, -1)} type="button">←</button><button aria-label={`Mover ${label} para a direita`} className="game-action" disabled={!game.isParticipating || index === orderedCards.length - 1} onClick={() => game.moveCard(card.id, 1)} type="button">→</button></div>}
            </article>
          })}</div>
          {(railScroll.left || railScroll.right) && <div className="ito-table-pan"><button aria-label="Mostrar cartas anteriores" className="game-action" disabled={!railScroll.left} onClick={() => orderRailRef.current?.scrollBy({ left: -orderRailRef.current.clientWidth * .8, behavior: 'smooth' })} type="button">←</button><span>{state.cards.length} cartas · deslize para ver todas</span><button aria-label="Mostrar próximas cartas" className="game-action" disabled={!railScroll.right} onClick={() => orderRailRef.current?.scrollBy({ left: orderRailRef.current.clientWidth * .8, behavior: 'smooth' })} type="button">→</button></div>}
        </div>}
      </div>
      <div className="ito-private-zone">
        <div className="ito-private-hand" aria-label="Suas cartas privadas"><small>{game.isParticipating ? `SUA MÃO · ${ownCards.length} ${ownCards.length === 1 ? 'CARTA' : 'CARTAS'}` : 'ESPECTADOR'}</small><div className="ito-private-hand__rail">{ownCards.map((card, index) => {
          const value = game.localCards.find((item) => item.cardId === card.id)?.value
          return <button aria-label={`Selecionar sua carta ${index + 1}${value === undefined ? ', aguardando número' : `, número ${value}`}${card.clue ? ', dica enviada' : ''}`} aria-pressed={activeCard?.id === card.id} className={`ito-private-card ${activeCard?.id === card.id ? 'is-selected' : ''}`} data-game-card={`ito-private-${card.id}`} key={card.id} onClick={() => setSelectedCardId(card.id)} type="button"><NumberCard hidden={value === undefined} value={value ?? '?'} /><span>{card.clue ? '✓' : index + 1}</span></button>
        })}</div></div>
        {state.phase === 'clue' && activeCard ? <form className="ito-clue-form" onSubmit={submitClue}><label htmlFor="ito-clue">Dica da carta {ownCards.findIndex((card) => card.id === activeCard.id) + 1} <small>{ownSubmittedCount}/{ownCards.length} enviadas</small></label><div><input autoComplete="off" disabled={activeValue === undefined} id="ito-clue" maxLength={80} onChange={(event) => { const value = event.currentTarget.value; setDrafts((current) => ({ ...current, [activeCard.id]: value })) }} placeholder="Dê uma dica sem falar o número…" value={draft} /><button aria-label={activeCard.clue ? 'Atualizar dica' : 'Enviar dica'} className="game-action game-action--primary" disabled={!draft.trim() || activeValue === undefined} type="submit"><Icon name={activeCard.clue ? 'check' : 'send'} /></button></div><small>{ownSubmittedCount === ownCards.length ? 'Dicas enviadas. Aguarde as outras pessoas.' : 'Toque nas suas cartas para dar uma dica para cada uma.'}</small><div><button aria-label="Configurações da partida" className="game-icon-button" onClick={() => setModal('settings')} type="button"><Icon name="controls" /></button><button aria-label="Encerrar partida" className="game-icon-button" onClick={() => setModal('end')} type="button"><Icon name="menu" /></button></div></form>
          : state.phase === 'clue' ? <p className="ito-spectator-note">A mesa está preparando as dicas.</p>
            : <div className="ito-private-actions"><p>{state.phase === 'order' ? `${voteLabels[state.settings.revealRule]} · ${state.revealVotes.length} de ${requiredVotes} votos necessários` : nextRoundNote}</p><div>{state.phase === 'order' ? <button aria-pressed={hasVoted} className={`game-action ${hasVoted ? 'is-selected' : 'game-action--primary'}`} disabled={!game.isParticipating} onClick={() => game.voteReveal(!hasVoted)} type="button"><Icon name={hasVoted ? 'check' : 'eye'} />{hasVoted ? 'Retirar voto' : state.settings.revealRule === 'anyone' ? 'Revelar números' : 'Votar para revelar'} <b>{state.revealVotes.length}/{requiredVotes}</b></button> : <button className="game-action game-action--primary" disabled={!game.isParticipating} onClick={state.campaignWon ? () => game.start(state.settings) : game.nextRound} type="button"><Icon name="refresh" />{state.campaignWon ? 'Nova partida' : 'Próxima rodada'}</button>}<button aria-label="Configurações da partida" className="game-icon-button" onClick={() => setModal('settings')} type="button"><Icon name="controls" /></button><button aria-label="Encerrar partida" className="game-icon-button" onClick={() => setModal('end')} type="button"><Icon name="menu" /></button></div>{state.phase === 'order' && <small className="ito-vote-hint" aria-live="polite">Mover qualquer carta zera os votos.</small>}</div>}
      </div>
    </>}

    {modal === 'settings' ? <GameModal detail={state.phase === 'lobby' ? 'Estas regras valem para toda a partida.' : 'Regras desta partida. Para mudar, encerre e configure uma nova.'} onClose={() => setModal(null)} title="Regras da mesa">
      <div className="ito-settings"><label><strong>Para revelar os números</strong><select aria-label="Regra de votação" disabled={state.phase !== 'lobby'} onChange={(event) => { const revealRule = event.currentTarget.value as ItoSettings['revealRule']; setSettings((current) => ({ ...current, revealRule })) }} value={effectiveSettings.revealRule}><option value="majority">Maioria absoluta (50% + 1)</option><option value="unanimous">Todo mundo precisa aprovar</option><option value="anyone">Qualquer pessoa pode revelar</option></select><small>Um voto por pessoa, mesmo com várias cartas. A maioria com 5 pessoas é de 3 votos.</small></label>
        <label><strong>Quando a equipe perder</strong><select aria-label="Regra de derrota" disabled={state.phase !== 'lobby'} onChange={(event) => { const lossRule = event.currentTarget.value as ItoSettings['lossRule']; setSettings((current) => ({ ...current, lossRule })) }} value={effectiveSettings.lossRule}><option value="keep">Manter as cartas e tentar de novo</option><option value="remove-one">Remover a última carta extra conquistada</option><option value="reset">Voltar a uma carta por pessoa</option></select><small>Ninguém fica sem cartas. Remover uma desfaz o último passo do rodízio.</small></label>
        <label><strong>Objetivo da partida</strong><select aria-label="Meta de cartas por pessoa" disabled={state.phase !== 'lobby'} onChange={(event) => { const targetCards = Number(event.currentTarget.value); setSettings((current) => ({ ...current, targetCards })) }} value={effectiveSettings.targetCards}>{[2,3,4,5].map((count) => <option key={count} value={count}>Vencer com {count} cartas por pessoa</option>)}</select><small>Todo mundo começa com uma carta. Cada vitória adiciona só uma carta à rodada seguinte, em rodízio.</small></label>
      </div><div className="game-modal__actions"><button className="game-action game-action--primary" onClick={() => setModal(null)} type="button">Pronto</button></div>
    </GameModal> : modal === 'rules' ? <GameModal onClose={() => setModal(null)} title="Como jogar ITO"><div className="game-rules"><p>Cada carta recebe um número secreto de 1 a 100. Dê uma dica para cada carta da sua mão, sem contar o número.</p><p>Organizem todas as dicas da esquerda (0) para a direita (100), usando as setas. Cartas da mesma pessoa podem ficar separadas na mesa.</p><p>Votem quando concordarem com a ordem. Cada pessoa tem um voto. Mudar a ordem cancela os votos para todo mundo conferir de novo.</p><p>Ganhar adiciona uma carta à próxima rodada, uma pessoa de cada vez. O objetivo padrão é vencer com duas cartas por pessoa. A consequência de perder e a votação são configuráveis.</p></div></GameModal> : modal === 'end' ? <GameModal onClose={() => setModal(null)} title="Encerrar a partida de ITO?"><div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Continuar</button><button className="game-action game-action--danger" onClick={() => { if (game.reset()) setModal(null) }} type="button">Encerrar</button></div></GameModal> : null}
    {resultReady && dismissedResult !== resultKey && !modal && <GameModal detail={nextRoundNote} onClose={() => setDismissedResult(resultKey)} title={state.campaignWon ? 'Vocês venceram a partida!' : state.succeeded ? 'Ordem perfeita!' : 'Foi por pouco.'}><div className="ito-result-mark">{state.campaignWon ? '✦' : state.succeeded ? '✓' : '↔'}</div><div className="game-modal__actions"><button className="game-action" onClick={() => setDismissedResult(resultKey)} type="button">Ver a mesa</button><button className="game-action game-action--primary" disabled={!game.isParticipating} onClick={state.campaignWon ? () => game.start(state.settings) : game.nextRound} type="button">{state.campaignWon ? 'Nova partida' : 'Próxima rodada'}</button></div></GameModal>}
  </section>
}
