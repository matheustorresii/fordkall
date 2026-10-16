import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ParticipantMedia } from '../../types'
import { useRoomExplodingKiwi, type KiwiCard, type KiwiCardType, type KiwiExpansion } from '../../hooks/useRoomExplodingKiwi'
import { getKiwiCombo, getKiwiPlayTarget, isKiwiImmediate, kiwiCards, kiwiCardTypes } from '../../games/kiwiCards'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameModal, GameSeat } from './GameTable'
import './ExplodingKiwiStage.css'
import { useGameMotion } from './useGameMotion'

type Game = ReturnType<typeof useRoomExplodingKiwi>
interface ExplodingKiwiStageProps { game: Game; participants: ParticipantMedia[]; onExit: () => void; onOpenGameHub: () => void }
const expansionLabels: Record<KiwiExpansion, { name: string; note: string }> = {
  imploding: { name: 'Imploding Kiwi', note: 'Kiwi Implosivo, Reverter e novas ações' },
  streaking: { name: 'Streaking Kiwi', note: 'Guarde um Kiwi Explosivo na mão' },
  barking: { name: 'Barking Kiwi', note: 'Kiwis Latidores e efeitos de mesa' },
  zombie: { name: 'Zombie Kiwi', note: 'Pessoas eliminadas podem voltar' },
}
const expansionCards: Record<KiwiExpansion, KiwiCardType[]> = {
  imploding: ['imploding', 'feral-kiwi', 'targeted-attack', 'reverse', 'draw-bottom', 'alter-future-3'],
  streaking: ['streaking', 'catomic-bomb', 'mark', 'curse', 'super-skip', 'see-future-5', 'alter-future-5', 'swap-top-bottom', 'garbage-collection'],
  barking: ['barking', 'alter-future-now', 'tower-of-power', 'take-that', 'potluck', 'bury', 'personal-attack', 'share-future', 'super-skip'],
  zombie: ['zombie', 'attack-of-dead', 'grave-robber', 'feed-dead', 'super-skip', 'nope', 'clone', 'clairvoyance', 'dig-deeper', 'shuffle-now'],
}
const baseCards: KiwiCardType[] = ['attack', 'favor', 'nope', 'shuffle', 'skip', 'see-future-3', 'kiwi-cat-a', 'kiwi-cat-b', 'kiwi-cat-c', 'kiwi-cat-d', 'kiwi-cat-e']
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

export const KiwiCardFace = ({ type, detail = false, hidden = false }: { type: KiwiCardType; detail?: boolean; hidden?: boolean }) => {
  const card = kiwiCards[type]
  return <span className={`kiwi-card-face ${detail ? 'kiwi-card-face--detail' : ''} ${hidden ? 'kiwi-card-face--back' : ''}`} style={{ '--card-color': card.color } as CSSProperties}>
    <small>{hidden ? 'EXPLODING KIWI' : card.family}</small>
    <img alt="" draggable={false} src={hidden ? '/assets/exploding-kiwi/shuffle.png' : card.art} />
    <strong>{hidden ? 'Carta virada' : card.title}</strong>
    {detail && !hidden && <span>{card.description}</span>}
  </span>
}

export const ExplodingKiwiStage = ({ game, participants, onExit, onOpenGameHub }: ExplodingKiwiStageProps) => {
  const motionRef = useGameMotion(`${game.state.phase}:${game.state.discard.at(-1)?.id}:${game.hand.map((c) => c.id).join(',')}`, game.state.gameId)
  const [expansions, setExpansions] = useState<KiwiExpansion[]>([])
  const [excludedCards, setExcludedCards] = useState<KiwiCardType[]>(['tower-of-power'])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [comboMode, setComboMode] = useState(false)
  const [modal, setModal] = useState<'discard' | 'inspect' | 'play' | 'options' | 'rules' | 'end' | null>(null)
  const [targetIdentity, setTargetIdentity] = useState('')
  const [namedCardType, setNamedCardType] = useState<KiwiCardType | ''>('')
  const [position, setPosition] = useState(0)
  const [secondPosition, setSecondPosition] = useState(0)
  const [reviveIdentity, setReviveIdentity] = useState('')
  const [choiceCardId, setChoiceCardId] = useState('')
  const [defenseCardId, setDefenseCardId] = useState('')
  const [orderedPeek, setOrderedPeek] = useState<string[]>([])
  const [dismissedPeekId, setDismissedPeekId] = useState('')
  const [dismissedPrompt, setDismissedPrompt] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [playEffect, setPlayEffect] = useState<KiwiCard | null>(null)
  const lastDiscardId = useRef(game.state.discard.at(-1)?.id)
  const myIdentity = participants.find((person) => person.isLocal)?.id ?? ''
  const myPlayer = game.state.players.find((player) => player.identity === myIdentity)
  const selectedCards = game.hand.filter((card) => selectedIds.includes(card.id))
  const selectedCard = selectedCards[0]
  const targetKind = myPlayer?.blind ? 'none' : getKiwiPlayTarget(selectedCards)
  const needsNamedCard = selectedCards.length === 3 || selectedCards.length === 5
  const targetPlayers = game.state.players.filter((player) => targetKind === 'dead' ? !player.alive : player.alive && (targetKind === 'living' || player.identity !== myIdentity))
  const currentPlayer = game.state.players.find((player) => player.identity === game.state.currentPlayerIdentity)
  const seats = arrangeSeats(game.state.players, myIdentity)
  const prompt = game.state.prompt
  const peekKey = game.peek.map((card) => card.id).join(':')
  const revealId = game.peekId || peekKey
  const promptKey = prompt ? `${game.state.gameId}:${prompt.kind}:${prompt.actorIdentity}:${prompt.targetIdentity}:${prompt.queue.join(',')}:${revealId}` : ''
  const ownsPrompt = Boolean(prompt && (prompt.kind === 'favor' ? prompt.targetIdentity === myIdentity : prompt.kind === 'give' ? prompt.queue[0] === myIdentity : prompt.actorIdentity === myIdentity))
  const defenseKey = game.isPendingDefense ? `defense:${myPlayer?.explosionCard?.id}:${game.state.pendingDefenseType}` : ''
  const showDefense = Boolean(defenseKey && dismissedPrompt !== defenseKey)
  const showPrompt = Boolean(ownsPrompt && dismissedPrompt !== promptKey)
  const showFuture = game.peek.length > 0 && !ownsPrompt && !game.isPendingDefense && revealId !== dismissedPeekId
  const defenseCards = game.hand.filter((card) => card.type === 'leaf-helmet' || card.type === 'zombie' && game.state.pendingDefenseType !== 'barking')
  const defenseCard = defenseCards.find((card) => card.id === defenseCardId) ?? defenseCards[0]
  const deadPlayers = game.state.players.filter((player) => !player.alive)
  const activeCardTypes = [...new Set([...baseCards, ...expansions.flatMap((expansion) => expansionCards[expansion])])]
  const namedChoices = selectedCards.length === 5 ? [...new Set(game.state.discard.map((card) => card.type))] : kiwiCardTypes
  const pending = Boolean(game.state.pendingAction || game.state.pendingDefenseIdentity || prompt)
  const canDraw = game.isMyTurn && !pending && game.state.phase === 'playing' && Boolean(myPlayer?.alive)
  const singlePlayable = selectedCard && (myPlayer?.blind || !['leaf-helmet', 'kiwi-burst', 'imploding', 'zombie', 'streaking', 'nope'].includes(selectedCard.type) && !selectedCard.type.startsWith('kiwi-cat-') && selectedCard.type !== 'feral-kiwi')
  const validCombo = getKiwiCombo(selectedCards, game.state.expansions.includes('zombie'))
  const canPlay = selectedCards.length > 0 && !pending && (game.isMyTurn || selectedCards.length === 1 && isKiwiImmediate(selectedCard!.type)) && (selectedCards.length > 1 ? Boolean(validCombo) : singlePlayable)
  const actorName = (identity: string) => game.state.players.find((person) => person.identity === identity)?.name ?? 'Jogador'

  useEffect(() => setSelectedIds((ids) => ids.filter((id) => game.hand.some((card) => card.id === id))), [game.hand])
  // Private hand refreshes must not undo the player's reordered future.
  useEffect(() => { setOrderedPeek(game.peek.map((card) => card.id)) }, [revealId, peekKey])
  useEffect(() => { if (!prompt && !game.isPendingDefense) setDismissedPrompt('') }, [prompt, game.isPendingDefense])
  useEffect(() => {
    const action = game.state.pendingAction
    if (!action) { setRemainingSeconds(0); return }
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((action.resolvesAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 150)
    return () => window.clearInterval(timer)
  }, [game.state.pendingAction])
  useEffect(() => {
    const card = game.state.discard.at(-1)
    if (!card || card.id === lastDiscardId.current) return
    lastDiscardId.current = card.id
    if (!card.playedByIdentity) return
    setPlayEffect(card)
    const timer = window.setTimeout(() => setPlayEffect(null), 1600)
    return () => window.clearTimeout(timer)
  }, [game.state.discard.at(-1)?.id])

  const toggleCard = (id: string) => {
    setSelectedIds((ids) => comboMode ? ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < 5 ? [...ids, id] : ids : ids[0] === id ? [] : [id])
    setTargetIdentity(''); setNamedCardType('')
  }
  const sendPlay = () => {
    if (game.play(selectedIds, targetKind === 'none' ? '' : targetIdentity, needsNamedCard ? namedCardType || undefined : undefined)) {
      setSelectedIds([]); setModal(null); setComboMode(false); setTargetIdentity(''); setNamedCardType('')
    }
  }
  const requestPlay = () => {
    if (!canPlay) return
    if (targetKind !== 'none' || needsNamedCard) { setTargetIdentity(''); setNamedCardType(''); setModal('play') }
    else sendPlay()
  }
  const movePeek = (id: string, direction: -1 | 1) => setOrderedPeek((ids) => {
    const index = ids.indexOf(id); const next = index + direction
    if (index < 0 || next < 0 || next >= ids.length) return ids
    const changed = [...ids]; [changed[index], changed[next]] = [changed[next]!, changed[index]!]; return changed
  })
  const playerChoice = (identity: string, name: string, selected: string, onChoose: (id: string) => void, hint?: string) => {
    const person = participants.find((participant) => participant.id === identity)
    return <button className={`game-choice ${selected === identity ? 'is-selected' : ''}`} key={identity} onClick={() => onChoose(identity)} type="button">
      <i className="game-choice__avatar">{person?.avatarDataUrl ? <img alt="" src={person.avatarDataUrl} /> : initials(name)}</i><strong>{name}</strong>{hint && <small>{hint}</small>}
    </button>
  }
  const positionControl = (value: number, onChange: (value: number) => void, label = 'Onde devolver ao monte?') => <label className="kiwi-position"><strong>{label}</strong><span>{value === game.state.deckCount ? 'No topo · próxima compra' : value === 0 ? 'No fundo do monte' : `${game.state.deckCount - value} carta(s) antes dela`}</span><input aria-label={label} max={game.state.deckCount} min={0} onChange={(event) => onChange(Number(event.currentTarget.value))} type="range" value={Math.min(value, game.state.deckCount)} /><small><span>Fundo</span><span>Topo</span></small></label>
  const pendingOwner = game.state.pendingDefenseIdentity || (prompt?.kind === 'favor' ? prompt.targetIdentity : prompt?.kind === 'give' ? prompt.queue[0] : prompt?.actorIdentity)

  return <section aria-label="Exploding Kiwi" className={`kiwi-stage ${game.state.phase === 'lobby' ? 'kiwi-stage--lobby' : 'game-match'}`} ref={motionRef}>
    <GameHud onExit={onExit} onOpenGameHub={onOpenGameHub} subtitle={game.state.phase === 'lobby' ? '2–5 jogadores' : `${game.state.players.filter((player) => player.alive).length} na mesa`} title="Exploding Kiwi">
      <button aria-label="Regras do Exploding Kiwi" className="game-icon-button" onClick={() => setModal('rules')} type="button">?</button>
    </GameHud>
    <GameError error={game.error} onClose={game.clearError} />
    {game.state.phase === 'lobby' ? <div className="kiwi-lobby">
      <div className="kiwi-lobby__art"><img alt="Kiwi segurando um baralho" src="/assets/exploding-kiwi/shuffle.png" /></div>
      <div className="kiwi-lobby__copy"><span>2–5 JOGADORES</span><h1>Exploding<br /><em>Kiwi</em></h1><p>Um monte. Alguns kiwis explosivos.<br />Sobreviva até sobrar só você.</p>
        <div className="kiwi-lobby__guests">{participants.map((person) => <span key={person.id} title={person.name}>{person.avatarDataUrl ? <img alt={person.name} src={person.avatarDataUrl} /> : initials(person.name)}</span>)}</div>
        <div className="kiwi-lobby__buttons"><button className="game-action" onClick={() => setModal('options')} type="button"><Icon name="controls" />Baralho e expansões</button><button className="game-action game-action--primary" disabled={!game.isController || game.participantCount < 2 || game.participantCount > 5} onClick={() => game.start(expansions, excludedCards)} type="button"><Icon name="play" />Jogar</button></div>
        <small>{!game.isController ? 'A pessoa que abriu a mesa inicia a partida.' : game.participantCount < 2 ? 'Entre com mais uma pessoa para jogar.' : `${expansions.length ? expansions.map((item) => expansionLabels[item].name).join(' · ') : 'Baralho clássico'} · 1 defesa para cada pessoa`}</small>
      </div>
    </div> : <>
      <div className="game-arena kiwi-arena">
        <div className="game-table-felt" />
        <div aria-live="polite" className={`kiwi-turn ${game.isMyTurn ? 'is-yours' : ''}`}><i />{game.state.phase === 'finished' ? `${actorName(game.state.winnerIdentity)} venceu` : game.isMyTurn ? `Sua vez${game.state.turnsRemaining > 1 ? ` · ${game.state.turnsRemaining} turnos` : ''}` : `Vez de ${currentPlayer?.name ?? '…'}`}</div>
        {seats.map((player, index) => <GameSeat active={player.identity === game.state.currentPlayerIdentity && game.state.phase === 'playing'} avatar={participants.find((person) => person.id === player.identity)?.avatarDataUrl} cards={player.handCount} eliminated={!player.alive} index={index} key={player.identity} local={player.identity === myIdentity} name={player.name} status={player.blind ? 'Amaldiçoado' : player.tower ? 'Torre do Poder' : !player.alive ? 'Eliminado' : undefined} total={seats.length} />)}
        <div className="kiwi-piles">
          <button aria-label={`Comprar uma carta. ${game.state.deckCount} no monte`} className="kiwi-pile kiwi-pile--deck" disabled={!canDraw} onClick={game.draw} type="button"><KiwiCardFace hidden type="kiwi-cat-d" /><span>Comprar <b>{game.state.deckCount}</b></span></button>
          <button aria-label={`Ver descarte, ${game.state.discard.length} cartas`} className="kiwi-pile kiwi-pile--discard" data-game-card={game.state.discard.at(-1)?.id} onClick={() => setModal('discard')} type="button">{game.state.discard.at(-1) ? <KiwiCardFace type={game.state.discard.at(-1)!.type} /> : <span className="kiwi-empty-pile"><Icon name="eye" />Descarte vazio</span>}<span>Descarte <b>{game.state.discard.length}</b><Icon name="eye" /></span></button>
        </div>
        {game.state.pendingAction ? <div className="kiwi-reaction" role="status"><span>{game.state.pendingAction.nopeCount % 2 ? 'Ação anulada' : 'Pode jogar Não!'}<b>{remainingSeconds}s</b></span>{game.hand.find((card) => card.type === 'nope') && <button className="game-action game-action--danger" onClick={() => game.nope(game.hand.find((card) => card.type === 'nope')!.id)} type="button">Não!</button>}</div>
          : pendingOwner && pendingOwner !== myIdentity ? <p className="game-table-note" role="status">Aguardando {actorName(pendingOwner)}…</p> : <p className="game-table-note" key={game.state.lastAction} role="status">{game.state.lastAction}</p>}
        {playEffect && <div className="kiwi-play-effect" key={playEffect.id} aria-hidden="true"><small>{actorName(playEffect.playedByIdentity ?? '')}</small><KiwiCardFace type={playEffect.type} /></div>}
      </div>
      <div className="game-hand kiwi-hand">
        <div className="game-hand__toolbar"><div className="game-hand__label"><strong>{selectedCards.length > 1 ? `${selectedCards.length} cartas selecionadas` : selectedCard && !myPlayer?.blind ? kiwiCards[selectedCard.type].title : 'Sua mão'}</strong><small>{game.hand.length} cartas</small></div>
          <div className="game-hand__actions">
            {(game.isPendingDefense || ownsPrompt) && <button className="game-action game-action--primary" onClick={() => setDismissedPrompt('')} type="button">Continuar escolha</button>}
            {game.peek.length > 0 && !ownsPrompt && <button aria-label="Rever o futuro" className="game-action" onClick={() => setDismissedPeekId('')} type="button"><Icon name="eye" /></button>}
            {selectedCards.length === 1 && !myPlayer?.blind && <button className="game-action" onClick={() => setModal('inspect')} type="button"><Icon name="eye" /><span>Detalhes</span></button>}
            {selectedCards.length > 0 && <button className="game-action game-action--primary" disabled={!canPlay} onClick={requestPlay} type="button">{selectedCards.length > 1 ? 'Jogar combo' : 'Jogar'}</button>}
            {game.isPlaying && <button className={`game-action game-action--quiet ${comboMode ? 'is-selected' : ''}`} onClick={() => { setComboMode(!comboMode); setSelectedIds([]) }} type="button">{comboMode ? 'Cancelar combo' : 'Combo'}</button>}
            {game.isController && <button aria-label="Encerrar partida" className="game-icon-button" onClick={() => setModal('end')} type="button"><Icon name="menu" /></button>}
          </div>
        </div>
        <div className="game-hand__rail">{game.hand.map((card) => <button aria-label={myPlayer?.blind ? 'Carta virada' : kiwiCards[card.type].title} aria-pressed={selectedIds.includes(card.id)} className={`kiwi-hand-card ${selectedIds.includes(card.id) ? 'is-selected' : ''} ${card.marked ? 'is-marked' : ''}`} data-game-card={card.id} key={card.id} onClick={() => toggleCard(card.id)} onDoubleClick={() => { if (!myPlayer?.blind) { setSelectedIds([card.id]); setModal('inspect') } }} type="button"><KiwiCardFace hidden={myPlayer?.blind} type={card.type} /></button>)}{!game.hand.length && <span className="kiwi-hand-empty">{game.isPlaying ? 'Aguardando a próxima jogada…' : 'Você está assistindo à partida.'}</span>}</div>
      </div>
    </>}

    {showDefense ? <GameModal detail="Sua defesa é privada. Escolha a carta e onde esconder o perigo." onClose={() => setDismissedPrompt(defenseKey)} title="Você comprou um Kiwi Explosivo">
      <div className="kiwi-defense-art"><KiwiCardFace type="kiwi-burst" /></div>
      <div className="game-choice-grid">{defenseCards.map((card) => <button className={`game-choice ${defenseCard?.id === card.id ? 'is-selected' : ''}`} key={card.id} onClick={() => setDefenseCardId(card.id)} type="button"><img alt="" src={kiwiCards[card.type].art} /><strong>{kiwiCards[card.type].title}</strong></button>)}</div>
      {game.state.pendingDefenseType !== 'barking' && positionControl(position, setPosition)}
      {defenseCard?.type === 'zombie' && deadPlayers.length > 0 && <><h3 className="kiwi-modal-label">Quem volta à partida?</h3><div className="game-choice-grid">{deadPlayers.map((player) => playerChoice(player.identity, player.name, reviveIdentity, setReviveIdentity))}</div>{reviveIdentity && positionControl(secondPosition, setSecondPosition, 'Onde esconder o segundo Kiwi?')}</>}
      <div className="game-modal__actions"><button className="game-action game-action--primary" disabled={!defenseCard || defenseCard.type === 'zombie' && deadPlayers.length > 0 && !reviveIdentity} onClick={() => defenseCard && game.defuse(defenseCard.id, position, reviveIdentity || undefined, secondPosition)} type="button">Usar defesa</button></div>
    </GameModal> : showPrompt && prompt ? <GameModal detail={prompt.label} onClose={() => setDismissedPrompt(promptKey)} title={prompt.kind === 'reorder' ? 'Mude o futuro' : prompt.kind === 'favor' ? `Entregue uma carta a ${actorName(prompt.actorIdentity)}` : prompt.kind === 'give' ? 'Escolha sua carta' : prompt.kind === 'reveal' ? 'Cavar mais fundo' : prompt.kind === 'barking' ? 'Escolha quem recebe o Kiwi' : prompt.kind === 'tower' ? 'Guardar na torre' : 'Esconda a carta no monte'} wide={prompt.kind === 'reorder'}>
      {prompt.kind === 'reorder' ? <><div className="game-modal__cards">{orderedPeek.map((id, index) => { const card = game.peek.find((item) => item.id === id); return card ? <div className="kiwi-future-item" key={id}><small>{index === 0 ? 'PRÓXIMA COMPRA' : `${index + 1}ª CARTA`}</small><KiwiCardFace type={card.type} /><div><button aria-label={`Mover ${kiwiCards[card.type].title} para a esquerda`} className="game-action" disabled={index === 0} onClick={() => movePeek(id, -1)} type="button">←</button><button aria-label={`Mover ${kiwiCards[card.type].title} para a direita`} className="game-action" disabled={index === orderedPeek.length - 1} onClick={() => movePeek(id, 1)} type="button">→</button></div></div> : null })}</div><div className="game-modal__actions"><button className="game-action game-action--primary" disabled={!game.peek.length || orderedPeek.length !== game.peek.length} onClick={() => game.choose({ cardIds: orderedPeek })} type="button">Confirmar ordem</button></div></>
        : prompt.kind === 'favor' || prompt.kind === 'give' || prompt.kind === 'tower' ? <><div className="kiwi-choice-cards">{game.hand.map((card) => <button aria-label={myPlayer?.blind ? 'Escolher carta virada' : `Escolher ${kiwiCards[card.type].title}`} aria-pressed={choiceCardId === card.id} className={`kiwi-choice-card ${choiceCardId === card.id ? 'is-selected' : ''}`} key={card.id} onClick={() => setChoiceCardId(card.id)} type="button"><KiwiCardFace hidden={myPlayer?.blind} type={card.type} /></button>)}</div><div className="game-modal__actions"><button className="game-action game-action--primary" disabled={!game.hand.some((card) => card.id === choiceCardId)} onClick={() => { if (game.choose({ cardId: choiceCardId })) setChoiceCardId('') }} type="button">Entregar carta</button></div></>
          : prompt.kind === 'insert' || prompt.kind === 'bury' ? <>{game.peek[0] && <div className="kiwi-defense-art"><KiwiCardFace type={game.peek[0].type} /></div>}{positionControl(position, setPosition)}<div className="game-modal__actions"><button className="game-action game-action--primary" disabled={!game.peek.length} onClick={() => game.choose({ position })} type="button">Devolver ao monte</button></div></>
            : prompt.kind === 'reveal' ? <>{game.peek[0] && <div className="kiwi-defense-art"><KiwiCardFace type={game.peek[0].type} /></div>}<div className="game-modal__actions"><button className="game-action" onClick={() => game.choose({})} type="button">Comprar a próxima</button><button className="game-action game-action--primary" disabled={!game.peek.length} onClick={() => game.choose({ cardId: game.peek[0]?.id })} type="button">Ficar com esta</button></div></>
              : <div className="game-choice-grid">{game.state.players.filter((player) => player.alive).map((player) => playerChoice(player.identity, player.name, '', (identity) => game.choose({ targetIdentity: identity })))}</div>}
    </GameModal> : showFuture ? <GameModal detail="Só você vê estas cartas. Da esquerda para a direita, esta é a ordem das próximas compras." onClose={() => setDismissedPeekId(revealId)} title="Ver o futuro" wide>
      <div className="game-modal__cards">{game.peek.map((card, index) => <div className="kiwi-future-item" key={card.id}><small>{index === 0 ? 'PRÓXIMA COMPRA' : `${index + 1}ª CARTA`}</small><KiwiCardFace type={card.type} /></div>)}</div><div className="game-modal__actions"><button className="game-action game-action--primary" onClick={() => setDismissedPeekId(revealId)} type="button">Voltar à mesa</button></div>
    </GameModal> : modal === 'discard' ? <GameModal detail={`${game.state.discard.length} cartas · a mais recente aparece primeiro`} onClose={() => setModal(null)} title="Descarte" wide><div className="kiwi-discard-grid">{[...game.state.discard].reverse().map((card) => <article key={card.id}><KiwiCardFace type={card.type} /><small>{card.playedByIdentity ? actorName(card.playedByIdentity) : 'Descartada'}</small></article>)}</div>{!game.state.discard.length && <p className="game-modal__hint">Nenhuma carta foi descartada ainda.</p>}</GameModal>
      : modal === 'inspect' && selectedCard ? <GameModal onClose={() => setModal(null)} title={kiwiCards[selectedCard.type].title}><div className="kiwi-inspect"><KiwiCardFace detail type={selectedCard.type} /></div><div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Voltar</button><button className="game-action game-action--primary" disabled={!canPlay} onClick={requestPlay} type="button">Jogar carta</button></div></GameModal>
        : modal === 'play' ? <GameModal detail={selectedCards.length > 1 ? `${selectedCards.length} cartas no combo` : selectedCard ? kiwiCards[selectedCard.type].description : ''} onClose={() => setModal(null)} title={selectedCards.length > 1 ? 'Jogar combo' : selectedCard ? kiwiCards[selectedCard.type].title : 'Jogar carta'}>
          {targetKind !== 'none' && <><h3 className="kiwi-modal-label">{targetKind === 'dead' ? 'Escolha uma pessoa eliminada' : 'Quem recebe a ação?'}</h3><div className="game-choice-grid">{targetPlayers.map((player) => playerChoice(player.identity, player.name, targetIdentity, setTargetIdentity, `${player.handCount} cartas`))}</div>{!targetPlayers.length && <p className="game-modal__hint">Não há um alvo válido para esta carta agora.</p>}</>}
          {needsNamedCard && <label className="kiwi-named-card"><strong>{selectedCards.length === 5 ? 'Qual carta pegar do descarte?' : 'Qual carta você quer pedir?'}</strong><select aria-label="Carta desejada" onChange={(event) => setNamedCardType(event.currentTarget.value as KiwiCardType)} value={namedCardType}><option value="">Escolha a carta</option>{namedChoices.map((type) => <option key={type} value={type}>{kiwiCards[type].title}</option>)}</select></label>}
          <div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Cancelar</button><button className="game-action game-action--primary" disabled={!canPlay || targetKind !== 'none' && !targetIdentity || needsNamedCard && !namedCardType} onClick={sendPlay} type="button">Confirmar jogada</button></div>
        </GameModal> : modal === 'options' ? <GameModal detail="As escolhas valem para a próxima partida." onClose={() => setModal(null)} title="Baralho e expansões" wide><div className="kiwi-expansions">{(Object.keys(expansionLabels) as KiwiExpansion[]).map((expansion) => <label key={expansion}><input checked={expansions.includes(expansion)} onChange={() => setExpansions((items) => items.includes(expansion) ? items.filter((item) => item !== expansion) : [...items, expansion])} type="checkbox" /><span><strong>{expansionLabels[expansion].name}</strong><small>{expansionLabels[expansion].note}</small></span></label>)}</div><h3 className="kiwi-modal-label">Remover cartas da partida</h3><p className="game-modal__hint">Marque os efeitos que não quer usar. Torre do Poder começa removida.</p><div className="kiwi-exclusions">{activeCardTypes.map((type) => <label key={type}><input checked={excludedCards.includes(type)} onChange={() => setExcludedCards((items) => items.includes(type) ? items.filter((item) => item !== type) : [...items, type])} type="checkbox" /><span>{kiwiCards[type].title}</span></label>)}</div><div className="game-modal__actions"><button className="game-action game-action--primary" onClick={() => setModal(null)} type="button">Pronto</button></div></GameModal>
          : modal === 'end' ? <GameModal detail="A rodada será encerrada para todas as pessoas da mesa." onClose={() => setModal(null)} title="Encerrar partida?"><div className="game-modal__actions"><button className="game-action" onClick={() => setModal(null)} type="button">Continuar jogando</button><button className="game-action game-action--danger" onClick={() => { if (game.reset()) setModal(null) }} type="button">Encerrar</button></div></GameModal>
            : modal === 'rules' ? <GameModal onClose={() => setModal(null)} title="Como jogar"><div className="kiwi-rules"><p>Na sua vez, jogue quantas ações quiser. Compre uma carta para encerrar o turno.</p><p>Comprou um Kiwi Explosivo? Use uma Folha-Segura e devolva o perigo em segredo ao monte. Sem defesa, você é eliminado.</p><p><strong>Combos:</strong> duas cartas de Kiwi iguais roubam uma carta; três iguais permitem pedir uma carta específica; cinco tipos diferentes recuperam uma carta do descarte.</p><p>Use <strong>Não!</strong> durante a contagem de resposta para cancelar uma ação. O descarte pode ser consultado clicando na pilha.</p><p>Ganha a última pessoa viva.</p></div></GameModal> : null}
    {game.state.phase === 'finished' && !modal && <GameModal detail="A última pessoa viva levou a rodada." onClose={onOpenGameHub} title={`${actorName(game.state.winnerIdentity)} venceu!`}><div className="kiwi-result"><img alt="" src="/assets/exploding-kiwi/kiwi-gift.png" /><button className="game-action game-action--primary" onClick={game.reset} type="button">Jogar de novo</button><button className="game-action" onClick={onOpenGameHub} type="button">Escolher jogo</button></div></GameModal>}
  </section>
}

export { expansionLabels }
