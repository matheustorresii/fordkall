import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { ParticipantMedia } from '../../types'
import type { useRoomIto } from '../../hooks/useRoomIto'
import { defaultItoSettings, ITO_TOPIC_MAX_LENGTH, itoNextProgress, itoRequiredVotes, itoRoundTopic, type ItoSettings } from '../../games/itoRules'
import { Icon } from '../ui/Icon'
import { GameError, GameHud, GameLobby, GameModal, NumberCard } from './GameTable'
import { useGameMotion } from './useGameMotion'
import './ItoGameStage.css'

interface ItoGameStageProps { game: ReturnType<typeof useRoomIto>; participants: ParticipantMedia[]; onExit: () => void; onOpenGameHub: () => void }
const voteLabels = { majority: 'Maioria absoluta', unanimous: 'Unanimidade', anyone: 'Qualquer pessoa' }

const TopicField = ({ id, value, onChange, previous = '', disabled = false, next = false }: {
  id: string; value: string; onChange: (value: string) => void; previous?: string; disabled?: boolean; next?: boolean
}) => <div className="ito-topic-field">
  <label htmlFor={id}>{next ? 'Tema da próxima rodada' : 'Tema da rodada'}</label>
  <div><input autoComplete="off" disabled={disabled} id={id} maxLength={ITO_TOPIC_MAX_LENGTH} onChange={(event) => onChange(event.currentTarget.value)} placeholder="Ex.: de um rolê tranquilo ao caos total" value={value} />
    <button aria-label="Sugerir um tema" className="game-action" disabled={disabled} onClick={() => onChange(itoRoundTopic('', value || previous))} type="button"><Icon name="refresh" /><span>Sugerir</span></button></div>
  <small>Escrevam o tema de vocês. Em branco, usamos uma sugestão.</small>
</div>

export const ItoGameStage = ({ game, participants, onExit, onOpenGameHub }: ItoGameStageProps) => {
  const [settings, setSettings] = useState<ItoSettings>({ ...defaultItoSettings })
  const [topicDraft, setTopicDraft] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [selectedCardId, setSelectedCardId] = useState('')
  const [placementCardId, setPlacementCardId] = useState('')
  const [modal, setModal] = useState<'rules' | 'settings' | 'end' | null>(null)
  const [railScroll, setRailScroll] = useState({ left: false, right: false })
  const orderRailRef = useRef<HTMLDivElement>(null)
  const { state } = game
  const myIdentity = participants.find((person) => person.isLocal)?.id ?? ''
  const ownCards = state.cards.filter((card) => card.ownerIdentity === myIdentity)
  const activeCard = ownCards.find((card) => card.id === selectedCardId) ?? ownCards.find((card) => !card.clue) ?? ownCards[0]
  const activeValue = game.localCards.find((card) => card.cardId === activeCard?.id)?.value
  const draft = activeCard ? drafts[activeCard.id] ?? activeCard.clue : ''
  const unplacedCards = state.cards.filter((card) => card.clue && !state.order.includes(card.id))
  const placementCard = state.phase === 'revealed' ? undefined : state.cards.find((card) => card.id === placementCardId && card.clue) ?? unplacedCards.find((card) => card.ownerIdentity === myIdentity) ?? unplacedCards[0]
  const submittedCount = state.cards.filter((card) => card.clue).length
  const placedCount = state.order.filter(Boolean).length
  const requiredVotes = itoRequiredVotes(state.settings.revealRule, state.players.length)
  const hasVoted = state.revealVotes.includes(myIdentity)
  const motionRef = useGameMotion(`${state.phase}:${state.order.join(',')}:${submittedCount}`, state.gameId)
  const maximumExtras = state.players.length * (state.settings.targetCards - 1)
  const nextExtras = itoNextProgress(state.extraCards, Boolean(state.succeeded), state.settings.lossRule, maximumExtras)
  const nextRecipient = state.players[nextExtras > state.extraCards ? state.extraCards % state.players.length : nextExtras % state.players.length]
  const nextRoundNote = state.campaignWon ? `Vocês venceram com ${state.settings.targetCards} cartas por pessoa.`
    : state.succeeded ? `${nextRecipient?.name ?? 'Uma pessoa'} recebe mais uma carta na próxima rodada.`
      : state.settings.lossRule === 'keep' ? 'A próxima rodada mantém as cartas de cada pessoa.'
        : state.settings.lossRule === 'reset' ? 'Na próxima rodada, todo mundo volta a uma carta.'
          : state.extraCards > 0 ? `${nextRecipient?.name ?? 'Uma pessoa'} terá uma carta a menos.` : 'Todo mundo continua com uma carta.'
  const effectiveSettings = state.phase === 'lobby' ? settings : state.settings
  const canStart = game.participantCount >= 2 && game.participantCount <= 8

  useEffect(() => { setDrafts({}); setSelectedCardId(''); setPlacementCardId(''); setTopicDraft(''); setModal(null) }, [state.gameId])
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
    if (activeCard && game.submitClue(activeCard.id, draft)) setPlacementCardId(activeCard.id)
  }
  const place = (slot: number) => {
    if (!placementCard || !game.placeCard(placementCard.id, slot)) return
    setPlacementCardId('')
    if (placementCard.id === activeCard?.id) {
      const next = ownCards.find((card) => card.id !== activeCard.id && !card.clue)
      if (next) setSelectedCardId(next.id)
    }
  }
  const start = () => canStart && game.start(settings, topicDraft)
  const nextRound = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!game.isParticipating) return
    if (state.campaignWon) game.start(state.settings, topicDraft)
    else game.nextRound(topicDraft)
  }

  return <section aria-label="Jogo ITO" className={`ito-stage ${state.phase === 'lobby' ? 'ito-stage--lobby' : 'game-match'}`} data-phase={state.phase} ref={motionRef}>
    <GameHud onExit={onExit} onOpenGameHub={onOpenGameHub} subtitle={state.phase === 'lobby' ? 'Uma ordem, várias intuições' : `Rodada ${state.roundNumber}`} title="ITO"><button aria-label="Regras do ITO" className="game-icon-button" onClick={() => setModal('rules')} type="button">?</button></GameHud>
    <GameError error={game.error} onClose={game.clearError} />
    {state.phase === 'lobby' ? <GameLobby art={<><NumberCard value={8} /><NumberCard value={92} /></>} description="Escolham um tema, deem suas dicas e encontrem a ordem juntos. Sem contar o número." disabled={!canStart} eyebrow="2–8 JOGADORES · INTUIÇÃO" note={`${voteLabels[settings.revealRule]} para revelar · Meta: ${settings.targetCards} cartas por pessoa`} onRules={() => setModal('rules')} onSettings={() => setModal('settings')} onStart={start} participants={participants} title="ITO">
      <form onSubmit={(event) => { event.preventDefault(); start() }}><TopicField id="ito-topic" onChange={setTopicDraft} value={topicDraft} /></form>
    </GameLobby> : <>
      <div className="game-arena ito-arena">
        <div className="game-table-felt" />
        <header className="ito-round-heading"><small>RODADA {state.roundNumber}</small><h2>{state.topic}</h2>
          <p aria-live="polite" className={`ito-round-status ${state.phase === 'revealed' ? 'is-result' : ''}`} role="status">
            {state.phase === 'revealed' ? <><strong>{state.campaignWon ? 'Partida vencida!' : state.succeeded ? 'Ordem perfeita!' : 'Não foi desta vez.'}</strong><span>{nextRoundNote}</span></>
              : <>{submittedCount}/{state.cards.length} dicas <span aria-hidden="true">·</span> {placedCount}/{state.cards.length} cartas na mesa</>}
          </p>
        </header>
        <div aria-label="Pessoas na mesa" className="ito-players">{state.players.map((player) => {
          const ready = state.cards.filter((card) => card.ownerIdentity === player.identity && card.clue).length
          const avatar = participants.find((person) => person.id === player.identity)?.avatarDataUrl
          const voted = state.revealVotes.includes(player.identity)
          return <div aria-label={`${player.name}, ${ready} de ${player.cardCount} dicas${voted ? ', aprovou a ordem' : ''}`} className={`ito-player ${voted ? 'has-voted' : ''}`} key={player.identity} title={player.name}>
            <span className="ito-player__avatar">{avatar ? <img alt="" src={avatar} /> : player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}</strong><small>{voted ? '✓' : `${ready}/${player.cardCount}`}</small>
          </div>
        })}</div>
        <div className="ito-order-table" style={{ '--ito-card-count': state.cards.length } as CSSProperties}>
          <div className="ito-scale"><span><b>0</b> MENOR</span><i /><span>MAIOR <b>100</b></span></div>
          <p className="ito-placement-hint" aria-live="polite">{state.phase === 'revealed' ? 'Os números estão abertos. Confiram a sequência.'
            : placementCard ? <>Escolha um espaço para <strong>“{placementCard.clue}”</strong></>
              : state.phase === 'order' ? 'Toque numa carta para mudar seu lugar ou use as setas.' : ownCards.length > 0 && ownCards.every((card) => card.clue) ? 'Sua dica está na mesa. Podem ajustar enquanto as outras chegam.' : 'Envie sua dica e escolha um espaço na mesa.'}</p>
          <div aria-label="Espaços da mesa, do menor para o maior" className="ito-order-rail" ref={orderRailRef}>{state.order.map((id, index) => {
            const card = state.cards.find((item) => item.id === id)
            const owner = state.players.find((person) => person.identity === card?.ownerIdentity)
            const label = `${owner?.name ?? 'Pessoa'}${(owner?.cardCount ?? 0) > 1 ? `, carta ${state.cards.filter((item) => item.ownerIdentity === card?.ownerIdentity).findIndex((item) => item.id === id) + 1}` : ''}`
            const selected = placementCard?.id === id
            return <div className={`ito-slot ${card ? 'is-filled' : ''} ${selected ? 'is-selected' : ''}`} data-ito-slot={index + 1} key={index}>
              <small className="ito-slot__label">{index + 1}º ESPAÇO</small>
              {card ? <article className="ito-clue-token" data-game-card={`ito-table-${card.id}`} data-game-revealed={state.phase === 'revealed'} data-ito-card={card.id}>
                <button aria-label={`Selecionar dica de ${label}: ${card.clue}`} aria-pressed={selected} className={`ito-clue-face ${state.phase === 'revealed' ? 'is-revealed' : ''}`} disabled={!game.isParticipating || state.phase === 'revealed'} onClick={() => setPlacementCardId(selected ? '' : card.id)} type="button">
                  <b className="ito-clue-face__number">{state.phase === 'revealed' ? state.numbers?.[card.id] ?? '—' : '?'}</b><span className="ito-clue-face__clue">{card.clue}</span><strong>{label}</strong>
                </button>
              </article> : <button aria-label={`Colocar carta no espaço ${index + 1}`} className="ito-slot__empty" disabled={!game.isParticipating || !placementCard} onClick={() => place(index)} type="button"><Icon name="plus" /><span>{placementCard ? 'Colocar aqui' : 'Espaço livre'}</span></button>}
              {card && state.phase !== 'revealed' && <div className="ito-clue-controls">{placementCard && !selected ? <button aria-label={`Trocar carta do espaço ${index + 1} pela dica selecionada`} className="game-action ito-swap" disabled={!game.isParticipating} onClick={() => place(index)} type="button">Colocar aqui</button> : <><button aria-label={`Mover ${label} para a esquerda`} className="game-action" disabled={!game.isParticipating || index === 0} onClick={() => game.moveCard(card.id, -1)} type="button">←</button><button aria-label={`Mover ${label} para a direita`} className="game-action" disabled={!game.isParticipating || index === state.order.length - 1} onClick={() => game.moveCard(card.id, 1)} type="button">→</button></>}</div>}
            </div>
          })}</div>
          <div className="ito-table-pan"><button aria-label="Mostrar espaços anteriores" className="game-action" disabled={!railScroll.left} onClick={() => orderRailRef.current?.scrollBy({ left: -orderRailRef.current.clientWidth * .8, behavior: 'smooth' })} type="button">←</button><span>{railScroll.left || railScroll.right ? 'Deslize para ver todos os espaços' : 'Da esquerda para a direita'}</span><button aria-label="Mostrar próximos espaços" className="game-action" disabled={!railScroll.right} onClick={() => orderRailRef.current?.scrollBy({ left: orderRailRef.current.clientWidth * .8, behavior: 'smooth' })} type="button">→</button></div>
        </div>
        <div aria-label="Dicas aguardando posição" className="ito-unplaced">{unplacedCards.length > 0 ? <><small>PARA COLOCAR</small>{unplacedCards.map((card) => <button aria-pressed={placementCard?.id === card.id} className={`game-action ${placementCard?.id === card.id ? 'is-selected' : ''}`} disabled={!game.isParticipating} key={card.id} onClick={() => setPlacementCardId(card.id)} title={card.clue} type="button">{card.clue}</button>)}</> : <small>{state.phase === 'clue' ? 'Cada carta tem seu espaço. Vocês já podem organizar as dicas que chegaram.' : ' '}</small>}</div>
      </div>
      <div className="ito-private-zone">
        <div className="ito-private-hand" aria-label="Suas cartas privadas"><small>{game.isParticipating ? 'SUA MÃO · SÓ VOCÊ VÊ' : 'ESPECTADOR'}</small><div className="ito-private-hand__rail">{ownCards.map((card, index) => {
          const value = game.localCards.find((item) => item.cardId === card.id)?.value
          return <button aria-label={`Selecionar sua carta ${index + 1}${value === undefined ? ', aguardando número' : `, número ${value}`}${card.clue ? ', dica enviada' : ''}`} aria-pressed={activeCard?.id === card.id} className={`ito-private-card ${activeCard?.id === card.id ? 'is-selected' : ''}`} data-game-card={`ito-private-${card.id}`} key={card.id} onClick={() => { setSelectedCardId(card.id); if (card.clue) setPlacementCardId(card.id) }} type="button"><NumberCard hidden={value === undefined} value={value ?? '?'} /><span>{state.order.includes(card.id) ? '✓' : card.clue ? '↗' : index + 1}</span></button>
        })}</div></div>
        <div className="ito-private-content">
          {state.phase === 'clue' && activeCard ? <form className="ito-clue-form" onSubmit={submitClue}><label htmlFor="ito-clue">Dica da sua carta {ownCards.length > 1 ? ownCards.findIndex((card) => card.id === activeCard.id) + 1 : ''}</label><div><input autoComplete="off" disabled={activeValue === undefined} id="ito-clue" maxLength={80} onChange={(event) => { const value = event.currentTarget.value; setDrafts((current) => ({ ...current, [activeCard.id]: value })) }} placeholder="Dê uma dica sem falar o número…" value={draft} /><button aria-label={activeCard.clue ? 'Atualizar dica' : 'Enviar dica'} className="game-action game-action--primary" disabled={!draft.trim() || activeValue === undefined} type="submit"><Icon name={activeCard.clue ? 'check' : 'send'} /></button></div><small>{activeCard.clue && !state.order.includes(activeCard.id) ? 'Dica enviada. Escolha um espaço acima para colocar sua carta.' : 'Seu número fica secreto até a votação.'}</small></form>
            : state.phase === 'order' ? <div className="ito-private-actions"><p>{voteLabels[state.settings.revealRule]} · {state.revealVotes.length}/{requiredVotes} votos</p><button aria-pressed={hasVoted} className={`game-action ${hasVoted ? 'is-selected' : 'game-action--primary'}`} disabled={!game.isParticipating} onClick={() => game.voteReveal(!hasVoted)} type="button"><Icon name={hasVoted ? 'check' : 'eye'} />{hasVoted ? 'Retirar voto' : 'Votar para revelar'}</button><small>Mudar a ordem cancela os votos.</small></div>
              : state.phase === 'revealed' ? <form className="ito-next-round" onSubmit={nextRound}><TopicField disabled={!game.isParticipating} id="ito-next-topic" next={!state.campaignWon} onChange={setTopicDraft} previous={state.topic} value={topicDraft} /><button className="game-action game-action--primary" disabled={!game.isParticipating} type="submit"><Icon name="play" />{state.campaignWon ? 'Nova partida' : 'Próxima rodada'}</button></form>
                : <p className="ito-spectator-note">As dicas aparecem na mesa assim que são enviadas.</p>}
          <div className="ito-table-tools"><button aria-label="Regras do ITO" className="game-icon-button" onClick={() => setModal('rules')} type="button">?</button><button aria-label="Configurações da partida" className="game-icon-button" onClick={() => setModal('settings')} type="button"><Icon name="controls" /></button><button aria-label="Encerrar partida" className="game-icon-button" onClick={() => setModal('end')} type="button"><Icon name="menu" /></button></div>
        </div>
      </div>
    </>}

    {modal === 'settings' ? <GameModal detail={state.phase === 'lobby' ? 'Estas regras valem para toda a partida.' : 'Regras desta partida. Para mudar, encerre e configure uma nova.'} onClose={() => setModal(null)} title="Regras da mesa">
      <div className="ito-settings"><label><strong>Para revelar os números</strong><select aria-label="Regra de votação" disabled={state.phase !== 'lobby'} onChange={(event) => { const revealRule = event.currentTarget.value as ItoSettings['revealRule']; setSettings((current) => ({ ...current, revealRule })) }} value={effectiveSettings.revealRule}><option value="majority">Maioria absoluta (50% + 1)</option><option value="unanimous">Todo mundo precisa aprovar</option><option value="anyone">Qualquer pessoa pode revelar</option></select><small>Um voto por pessoa, mesmo com várias cartas. A maioria com 5 pessoas é de 3 votos.</small></label>
        <label><strong>Quando a equipe perder</strong><select aria-label="Regra de derrota" disabled={state.phase !== 'lobby'} onChange={(event) => { const lossRule = event.currentTarget.value as ItoSettings['lossRule']; setSettings((current) => ({ ...current, lossRule })) }} value={effectiveSettings.lossRule}><option value="keep">Manter as cartas e tentar de novo</option><option value="remove-one">Remover a última carta extra conquistada</option><option value="reset">Voltar a uma carta por pessoa</option></select><small>Ninguém fica sem cartas. Remover uma desfaz o último passo do rodízio.</small></label>
        <label><strong>Objetivo da partida</strong><select aria-label="Meta de cartas por pessoa" disabled={state.phase !== 'lobby'} onChange={(event) => { const targetCards = Number(event.currentTarget.value); setSettings((current) => ({ ...current, targetCards })) }} value={effectiveSettings.targetCards}>{[2,3,4,5].map((count) => <option key={count} value={count}>Vencer com {count} cartas por pessoa</option>)}</select><small>Todo mundo começa com uma carta. Cada vitória adiciona só uma carta à rodada seguinte, em rodízio.</small></label>
      </div><div className="game-modal__actions"><button className="game-action game-action--primary" onClick={() => setModal(null)} type="button">Pronto</button></div>
    </GameModal> : modal === 'rules' ? <GameModal onClose={() => setModal(null)} title="Como jogar ITO"><div className="game-rules"><p>Escrevam o tema da rodada, pensando nos extremos da escala. Se ninguém preencher, usamos um tema sugerido.</p><p>Cada carta recebe um número secreto de 1 a 100. Dê uma dica para cada carta da sua mão, sem contar o número.</p><p>Assim que enviar a dica, escolha um dos espaços da esquerda (menor) para a direita (maior). Não é preciso esperar as outras pessoas. Os espaços indicam a ordem, não um número exato.</p><p>Toque numa carta para selecioná-la e depois em outro espaço para movê-la. Se os dois espaços estiverem ocupados, as cartas trocam de lugar. As setas também ajustam a ordem.</p><p>Quando todas as cartas estiverem na mesa, votem para revelar. Cada pessoa tem um voto. Mudar a ordem cancela os votos. Os números abrem na própria mesa, sem interromper o jogo.</p><p>Cada vitória adiciona uma carta à rodada seguinte, em rodízio. A consequência de perder e a votação são configuráveis.</p></div></GameModal> : modal === 'end' ? <GameModal onClose={() => setModal(null)} title="Encerrar a partida de ITO?"><div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Continuar</button><button className="game-action game-action--danger" onClick={() => { if (game.reset()) setModal(null) }} type="button">Encerrar</button></div></GameModal> : null}
  </section>
}
