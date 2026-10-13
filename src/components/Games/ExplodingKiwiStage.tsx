import { useEffect, useMemo, useState } from 'react'
import type { ParticipantMedia } from '../../types'
import { Icon } from '../ui/Icon'
import { useRoomExplodingKiwi, type KiwiCardType, type KiwiExpansion } from '../../hooks/useRoomExplodingKiwi'
import './ExplodingKiwiStage.css'

type Game = ReturnType<typeof useRoomExplodingKiwi>
interface ExplodingKiwiStageProps {
  game: Game
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}

const expansionLabels: Record<KiwiExpansion, { name: string; note: string }> = {
  imploding: { name: 'Imploding Kiwi', note: 'Kiwi Implosivo, Reverter e novas ações' },
  streaking: { name: 'Streaking Kiwi', note: 'Um Kiwi Explosivo pode ficar na mão' },
  barking: { name: 'Barking Kiwi', note: 'Kiwis Latidores e efeitos de mesa' },
  zombie: { name: 'Zombie Kittens', note: 'Mãos ficam com quem morreu; dá para voltar' },
}
const exclusionGroups: Array<{ title: string; expansion?: KiwiExpansion; cards: KiwiCardType[] }> = [
  { title: 'Baralho base', cards: ['attack', 'favor', 'nope', 'shuffle', 'skip', 'see-future-3', 'kiwi-cat-a', 'kiwi-cat-b', 'kiwi-cat-c', 'kiwi-cat-d', 'kiwi-cat-e'] },
  { title: 'Imploding Kittens', expansion: 'imploding', cards: ['feral-kiwi', 'targeted-attack', 'reverse', 'draw-bottom', 'alter-future-3'] },
  { title: 'Streaking Kittens', expansion: 'streaking', cards: ['catomic-bomb', 'mark', 'curse', 'super-skip', 'see-future-5', 'alter-future-5', 'swap-top-bottom', 'garbage-collection'] },
  { title: 'Barking Kittens', expansion: 'barking', cards: ['alter-future-now', 'tower-of-power', 'take-that', 'potluck', 'bury', 'personal-attack', 'share-future', 'super-skip'] },
  { title: 'Zombie Kittens', expansion: 'zombie', cards: ['attack-of-dead', 'grave-robber', 'feed-dead', 'super-skip', 'nope', 'clone', 'clairvoyance', 'dig-deeper', 'shuffle-now'] },
]
const excludedByDefault: KiwiCardType[] = ['tower-of-power']
const artByType: Record<string, string> = {
  'kiwi-burst': '/assets/exploding-kiwi/kiwi-burst.png',
  'leaf-helmet': '/assets/exploding-kiwi/leaf-helmet.png',
  skip: '/assets/exploding-kiwi/skip-nap.png',
  'super-skip': '/assets/exploding-kiwi/skip-nap.png',
  attack: '/assets/exploding-kiwi/double-turn.png',
  'targeted-attack': '/assets/exploding-kiwi/double-turn.png',
  'personal-attack': '/assets/exploding-kiwi/double-turn.png',
  favor: '/assets/exploding-kiwi/kiwi-gift.png',
  'see-future-3': '/assets/exploding-kiwi/spyglass.png',
  'see-future-5': '/assets/exploding-kiwi/spyglass.png',
  'alter-future-3': '/assets/exploding-kiwi/spyglass.png',
  'alter-future-5': '/assets/exploding-kiwi/spyglass.png',
  'alter-future-now': '/assets/exploding-kiwi/spyglass.png',
  shuffle: '/assets/exploding-kiwi/shuffle.png',
  'kiwi-cat-a': '/assets/exploding-kiwi/kiwi-gift.png',
  'kiwi-cat-b': '/assets/exploding-kiwi/leaf-helmet.png',
  'kiwi-cat-c': '/assets/exploding-kiwi/skip-nap.png',
  'kiwi-cat-d': '/assets/exploding-kiwi/shuffle.png',
  'kiwi-cat-e': '/assets/exploding-kiwi/spyglass.png',
  'feral-kiwi': '/assets/exploding-kiwi/kiwi-burst.png',
}
const descriptions: Record<KiwiCardType, string> = {
  'kiwi-burst': 'Se comprar, você explode — a menos que consiga se defender.',
  'leaf-helmet': 'Guarde para se defender de um Kiwi Explosivo.',
  attack: 'Encerra seu turno e passa dois turnos para a próxima pessoa.',
  favor: 'Escolha alguém; essa pessoa entrega uma carta à sua escolha.',
  nope: 'Anula uma ação antes que ela comece. Nopes podem se anular.',
  shuffle: 'Embaralha o monte de compra.',
  skip: 'Encerra um turno sem comprar; cada turno restante ainda conta.',
  'see-future-3': 'Veja em segredo as próximas três cartas.',
  'alter-future-3': 'Veja e reorganize as próximas três cartas.',
  'kiwi-cat-a': 'Sem efeito sozinho. Combine com outra carta compatível para um combo.',
  'kiwi-cat-b': 'Sem efeito sozinho. Combine com outra carta compatível para um combo.',
  'kiwi-cat-c': 'Sem efeito sozinho. Combine com outra carta compatível para um combo.',
  'kiwi-cat-d': 'Sem efeito sozinho. Combine com outra carta compatível para um combo.',
  'kiwi-cat-e': 'Sem efeito sozinho. Combine com outra carta compatível para um combo.',
  imploding: 'Na primeira compra, volta virado para cima; se alguém comprar de novo, explode sem defesa.',
  'feral-kiwi': 'Carta de gato selvagem; use em combos de gatos.',
  'targeted-attack': 'Escolha qualquer pessoa viva: ela recebe dois turnos.',
  reverse: 'Inverte a ordem da rodada. Com duas pessoas, funciona como Pular.',
  'draw-bottom': 'Compra a carta de baixo do monte e encerra o turno.',
  streaking: 'Permite manter um Kiwi Explosivo na mão — só um por vez.',
  'catomic-bomb': 'Põe os Kiwis Explosivos no topo do monte e encerra seu turno.',
  mark: 'Revela e marca uma carta aleatória da mão de outra pessoa.',
  curse: 'A pessoa-alvo fica sem olhar a mão até comprar uma carta segura.',
  'super-skip': 'Encerra todos os turnos restantes que você tiver.',
  'see-future-5': 'Veja em segredo as próximas cinco cartas.',
  'alter-future-5': 'Veja e reorganize as próximas cinco cartas.',
  'swap-top-bottom': 'Troca a carta do topo com a carta de baixo do monte.',
  'garbage-collection': 'Todo mundo vivo escolhe uma carta para embaralhar de volta no monte.',
  barking: 'Revela o Kiwi Latidor; se outra pessoa tiver o par, precisa se defender.',
  'alter-future-now': 'A qualquer momento antes da próxima ação, reorganize o topo.',
  'tower-of-power': 'Ativa proteção contra roubo e guarda cartas sob a torre.',
  'take-that': 'A próxima carta comprada pela pessoa-alvo vem para você.',
  potluck: 'Todo mundo escolhe uma carta para colocar no topo do monte.',
  bury: 'Compre uma carta e devolva-a em qualquer posição do monte.',
  'personal-attack': 'Você recebe três turnos no total (ou empilha com turnos pendentes).',
  'share-future': 'Veja e reorganize as três próximas cartas junto com a pessoa seguinte.',
  zombie: 'Use ao comprar um Kiwi Explosivo para voltar ao monte e reviver alguém morto.',
  'attack-of-dead': 'Encerra seu turno e dá três turnos por pessoa morta ao próximo jogador.',
  'grave-robber': 'Cada pessoa morta devolve uma carta da mão ao monte; depois embaralhe.',
  'feed-dead': 'Escolha alguém morto; as outras pessoas vivas dão uma carta a ela.',
  'dig-deeper': 'Veja a carta do topo: fique com ela ou compre a próxima e devolva esta ao topo.',
  clone: 'Repete o efeito da última carta do descarte.',
  clairvoyance: 'Veja a próxima carta antes de uma ação começar.',
  'shuffle-now': 'Embaralha o monte imediatamente, inclusive fora do seu turno.',
}
const avatarLetters = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
const isNowCard = (type: KiwiCardType) => ['alter-future-now', 'clairvoyance', 'feed-dead', 'shuffle-now'].includes(type)
const allCardTypes: KiwiCardType[] = [
  'kiwi-burst', 'leaf-helmet', 'attack', 'favor', 'nope', 'shuffle', 'skip', 'see-future-3', 'alter-future-3',
  'kiwi-cat-a', 'kiwi-cat-b', 'kiwi-cat-c', 'kiwi-cat-d', 'kiwi-cat-e', 'imploding', 'feral-kiwi', 'targeted-attack',
  'reverse', 'draw-bottom', 'streaking', 'catomic-bomb', 'mark', 'curse', 'super-skip', 'see-future-5', 'alter-future-5',
  'swap-top-bottom', 'garbage-collection', 'barking', 'alter-future-now', 'tower-of-power', 'take-that', 'potluck', 'bury',
  'personal-attack', 'share-future', 'zombie', 'attack-of-dead', 'grave-robber', 'feed-dead', 'dig-deeper', 'clone', 'clairvoyance', 'shuffle-now',
]
const isPublicCardType = (value: string): value is KiwiCardType => allCardTypes.includes(value as KiwiCardType)

export const ExplodingKiwiStage = ({ game, participants, onExit, onOpenGameHub }: ExplodingKiwiStageProps) => {
  const [expansions, setExpansions] = useState<KiwiExpansion[]>([])
  const [excludedCards, setExcludedCards] = useState<KiwiCardType[]>(excludedByDefault)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [targetIdentity, setTargetIdentity] = useState('')
  const [namedCardType, setNamedCardType] = useState<KiwiCardType | ''>('')
  const [position, setPosition] = useState(0)
  const [secondPosition, setSecondPosition] = useState(0)
  const [reviveIdentity, setReviveIdentity] = useState('')
  const [orderedPeek, setOrderedPeek] = useState<string[]>([])
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const myIdentity = participants.find((participant) => participant.isLocal)?.id ?? ''
  const myPlayer = game.state.players.find((player) => player.identity === myIdentity)
  const prompt = game.state.prompt
  const activeCard = game.hand.find((card) => selectedIds.includes(card.id))
  const isComboFive = selectedIds.length === 5
  const isComboTriple = selectedIds.length === 3
  const targetPlayers = useMemo(() => {
    if (activeCard?.type === 'feed-dead') return game.state.players.filter((player) => !player.alive)
    if (activeCard?.type === 'targeted-attack') return game.state.players.filter((player) => player.alive)
    return game.state.players.filter((player) => player.alive && player.identity !== myIdentity)
  }, [activeCard?.type, game.state.players, myIdentity])

  useEffect(() => setSelectedIds((ids) => ids.filter((id) => game.hand.some((card) => card.id === id))), [game.hand])
  useEffect(() => setOrderedPeek(game.peek.map((card) => card.id)), [game.peek])
  useEffect(() => {
    const pending = game.state.pendingAction
    if (!pending) { setRemainingSeconds(0); return }
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((pending.resolvesAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 200)
    return () => window.clearInterval(timer)
  }, [game.state.pendingAction])
  useEffect(() => {
    if (targetPlayers.some((player) => player.identity === targetIdentity)) return
    setTargetIdentity(targetPlayers[0]?.identity ?? '')
  }, [targetIdentity, targetPlayers])

  const toggleCard = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < 5 ? [...ids, id] : ids)
  const handlePlay = () => {
    if (!selectedIds.length) return
    game.play(selectedIds, targetIdentity, namedCardType || undefined)
    setSelectedIds([]); setNamedCardType('')
  }
  const movePeek = (id: string, offset: -1 | 1) => setOrderedPeek((ids) => {
    const index = ids.indexOf(id); const next = index + offset
    if (index < 0 || next < 0 || next >= ids.length) return ids
    const updated = [...ids]; [updated[index], updated[next]] = [updated[next]!, updated[index]!]; return updated
  })
  const currentPlayer = game.state.players.find((player) => player.identity === game.state.currentPlayerIdentity)
  const supportPlayers = game.state.players.filter((player) => !player.alive)
  const canStart = game.participantCount >= 2 && game.participantCount <= 5
  const helpCardIds = game.state.discard.map((card) => card.type)
  const visibleExclusionGroups = useMemo(() => {
    const seen = new Set<KiwiCardType>()
    return exclusionGroups.filter((group) => !group.expansion || expansions.includes(group.expansion)).map((group) => ({
      ...group,
      cards: group.cards.filter((type) => {
        if (seen.has(type)) return false
        seen.add(type)
        return true
      }),
    })).filter((group) => group.cards.length > 0)
  }, [expansions])
  const activeExcludedCount = [...new Set(visibleExclusionGroups.flatMap((group) => group.cards))].filter((type) => excludedCards.includes(type)).length
  const toggleExcludedCard = (type: KiwiCardType) => setExcludedCards((current) => current.includes(type)
    ? current.filter((item) => item !== type)
    : [...current, type])

  return (
    <section className="kiwi-stage" aria-label="Exploding Kiwi">
      <header className="kiwi-stage__topbar">
        <div className="kiwi-stage__brand">
          <span className="kiwi-stage__mark"><img alt="" src="/assets/exploding-kiwi/kiwi-burst.png" /></span>
          <div><small>JOGOS DA SALA</small><strong>EXPLODING KIWI <span>· cartas</span></strong></div>
        </div>
        <button className="kiwi-stage__hub-button" onClick={onOpenGameHub} type="button">
          <Icon name="gamepad" />Trocar jogo
        </button>
        <div className="kiwi-stage__topbar-actions">
          {game.state.gameId && <span className="kiwi-stage__status"><i />{game.state.players.filter((player) => player.alive).length} vivas</span>}
          {game.state.phase === 'finished' && <button className="kiwi-stage__text-button" onClick={() => game.reset()} type="button">Nova rodada</button>}
          <button aria-label="Voltar para a call" className="icon-button" onClick={onExit} title="Voltar para a call" type="button"><Icon name="x" /></button>
        </div>
      </header>

      {game.error && <div className="kiwi-stage__error" role="alert"><Icon name="warning" /><span>{game.error}</span><button aria-label="Fechar aviso" onClick={game.clearError} type="button"><Icon name="x" /></button></div>}

      {game.state.phase === 'lobby' && (
        <div className="kiwi-lobby">
          <div className="kiwi-lobby__intro">
            <span className="kiwi-eyebrow">2–5 JOGADORES · BARALHO DA SALA</span>
            <h2>Sobreviva até ser<br />o último kiwi vivo.</h2>
            <p>Jogue cartas para mudar a rodada ou compre para encerrar seu turno. A mão é privada; o monte e o descarte são compartilhados.</p>
          </div>
          <div className="kiwi-lobby__expansions">
            <div className="kiwi-lobby__section-title"><strong>Expansões</strong><span>Escolha qualquer combinação</span></div>
            {(['imploding', 'streaking', 'barking', 'zombie'] as KiwiExpansion[]).map((expansion) => (
              <label className={`kiwi-expansion ${expansions.includes(expansion) ? 'is-selected' : ''}`} key={expansion}>
                <input checked={expansions.includes(expansion)} onChange={() => setExpansions((items) => items.includes(expansion) ? items.filter((item) => item !== expansion) : [...items, expansion])} type="checkbox" />
                <span className="kiwi-expansion__check">✓</span><span><strong>{expansionLabels[expansion].name}</strong><small>{expansionLabels[expansion].note}</small></span>
              </label>
            ))}
            <details className="kiwi-card-options">
              <summary><span><strong>Cartas da partida</strong><small>Remova efeitos que não quer usar</small></span><i>{activeExcludedCount} removida{activeExcludedCount === 1 ? '' : 's'}</i></summary>
              <p>As cartas marcadas não entram no baralho. Desmarque Torre do Poder para incluí-la; a escolha vale para todas as cópias do mesmo tipo.</p>
              <div className="kiwi-card-options__groups">
                {visibleExclusionGroups.map((group) => <fieldset key={group.title}>
                  <legend>{group.title}</legend>
                  <div>{group.cards.map((type) => <label className="kiwi-card-option" key={`${group.title}-${type}`}>
                    <input checked={excludedCards.includes(type)} onChange={() => toggleExcludedCard(type)} type="checkbox" />
                    <span>{game.cardTitle(type)}</span>
                  </label>)}</div>
                </fieldset>)}
              </div>
            </details>
          </div>
          <div className="kiwi-lobby__footer">
            <div><small>NA SALA AGORA · {game.participantCount}</small><div className="kiwi-roster">
              {participants.map((participant) => <span className="kiwi-roster__person" key={participant.id} title={participant.name}>
                <i>{participant.avatarDataUrl ? <img alt="" src={participant.avatarDataUrl} /> : avatarLetters(participant.name)}</i>{participant.name}
              </span>)}
            </div></div>
            <button className="kiwi-button kiwi-button--primary" disabled={!game.isController || !canStart} onClick={() => game.start(expansions, excludedCards)} type="button"><Icon name="play" />Começar partida</button>
          </div>
          {!canStart && <small className="kiwi-lobby__hint">Exploding Kiwi precisa de 2 a 5 pessoas na sala.</small>}
          {!game.isController && <small className="kiwi-lobby__hint">A primeira pessoa na sala pode iniciar a partida.</small>}
        </div>
      )}

      {game.state.phase !== 'lobby' && (
        <div className="kiwi-table">
          <div className="kiwi-table__header">
            <div><span className="kiwi-eyebrow">{game.state.phase === 'finished' ? 'FIM DE JOGO' : 'RODADA EM ANDAMENTO'}</span>
              <h2>{game.state.phase === 'finished' ? `${game.state.players.find((player) => player.identity === game.state.winnerIdentity)?.name ?? 'Ninguém'} venceu.` : `Turno de ${currentPlayer?.name ?? '…'}`}</h2></div>
            <div className="kiwi-table__counts"><span>{game.state.deckCount} no monte</span><span>{game.state.discard.length} no descarte</span></div>
          </div>

          <div className="kiwi-table__players">
            {game.state.players.map((player) => (
              <article className={`kiwi-player ${!player.alive ? 'is-dead' : ''} ${player.identity === game.state.currentPlayerIdentity ? 'is-current' : ''}`} key={player.identity}>
                <span className="kiwi-player__avatar">{participants.find((person) => person.id === player.identity)?.avatarDataUrl
                  ? <img alt="" src={participants.find((person) => person.id === player.identity)?.avatarDataUrl} /> : avatarLetters(player.name)}</span>
                <span className="kiwi-player__info"><strong>{player.name}{player.identity === myIdentity ? ' · você' : ''}</strong><small>{player.alive ? `${player.handCount} cartas` : 'Morta · pode voltar'}</small></span>
                {player.identity === game.state.currentPlayerIdentity && <span className="kiwi-player__turn">{game.state.turnsRemaining} turno{game.state.turnsRemaining === 1 ? '' : 's'}</span>}
                {player.blind && <span className="kiwi-player__badge">Amaldiçoada</span>}
                {player.tower && <span className="kiwi-player__badge">Torre</span>}
                {player.markedCardType && <span className="kiwi-player__badge">Kiwi Latidor</span>}
                {player.takeThatCard && <span className="kiwi-player__badge">Próxima compra emprestada</span>}
                {player.explosionCard && <span className="kiwi-player__badge kiwi-player__badge--dead">Kiwi à mostra</span>}
              </article>
            ))}
          </div>

          <div className="kiwi-table__board">
            <button className="kiwi-deck" disabled={!game.isMyTurn || Boolean(game.state.pendingAction || game.state.pendingDefenseIdentity || prompt) || game.state.phase !== 'playing'} onClick={() => game.draw()} type="button">
              <span className="kiwi-deck__art"><img alt="" src="/assets/exploding-kiwi/shuffle.png" /></span><strong>COMPRAR</strong><small>{game.state.deckCount} restantes</small>
            </button>
            <div className="kiwi-discard"><small>DESCARTE</small>{game.state.discard.at(-1) ? <><img alt="" className="kiwi-discard__art" key={game.state.discard.at(-1)!.id} src={artByType[game.state.discard.at(-1)!.type] ?? artByType['kiwi-burst']} /><strong>{game.cardTitle(game.state.discard.at(-1)!.type)}</strong></> : <span>Vazio</span>}</div>
            <div className="kiwi-table__message" role="status">{game.state.lastAction || 'Escolha uma carta para começar.'}</div>
          </div>

          {game.state.pendingAction && <section className="kiwi-response" aria-live="polite">
            <div><span className="kiwi-eyebrow">JANELA DE RESPOSTA · {remainingSeconds}s</span><strong>{game.cardTitle(isPublicCardType(game.state.pendingAction.cardType) ? game.state.pendingAction.cardType : 'kiwi-cat-a')} · {game.state.pendingAction.nopeCount % 2 ? 'anulada por enquanto' : 'pode ser anulada'}</strong></div>
            <div className="kiwi-response__buttons">
              {game.hand.filter((card) => card.type === 'nope').map((card) => <button className="kiwi-button" key={card.id} onClick={() => game.nope(card.id)} type="button">Jogar Não!</button>)}
              {!game.hand.some((card) => card.type === 'nope') && <small>Sem Não! na sua mão</small>}
            </div>
          </section>}

          {game.isPendingDefense && <section className="kiwi-choice" role="alert">
            <div><span className="kiwi-eyebrow">DEFESA</span><strong>{game.state.pendingDefenseType === 'barking' ? 'O Kiwi Latidor chegou até você.' : 'Você comprou um Kiwi Explosivo.'}</strong><small>Se usar uma Folha-Segura, indique onde recolocar a carta no monte.</small></div>
            <div className="kiwi-choice__fields">
              <label>Carta<select id="kiwi-defense" defaultValue=""><option disabled value="">Selecione</option>{game.hand.filter((card) => card.type === 'leaf-helmet' || card.type === 'zombie').map((card) => <option key={card.id} value={card.id}>{game.cardTitle(card.type)}</option>)}</select></label>
              {game.state.pendingDefenseType !== 'barking' && <label>Posição da carta<input max={game.state.deckCount} min="0" onChange={(event) => setPosition(Number(event.currentTarget.value))} type="number" value={position} /></label>}
              {game.hand.some((card) => card.type === 'zombie') && supportPlayers.length > 0 && <label>Trazer de volta<select onChange={(event) => setReviveIdentity(event.currentTarget.value)} value={reviveIdentity}><option value="">Escolha alguém morto</option>{supportPlayers.map((person) => <option key={person.identity} value={person.identity}>{person.name}</option>)}</select></label>}
              {reviveIdentity && <label>Segunda posição<input max={game.state.deckCount} min="0" onChange={(event) => setSecondPosition(Number(event.currentTarget.value))} type="number" value={secondPosition} /></label>}
              <button className="kiwi-button kiwi-button--primary" onClick={() => {
                const select = document.querySelector<HTMLSelectElement>('#kiwi-defense')
                if (select?.value) game.defuse(select.value, position, reviveIdentity || undefined, secondPosition)
              }} type="button">Defender</button>
            </div>
          </section>}

          {prompt && <section className="kiwi-choice" aria-live="polite">
            <div><span className="kiwi-eyebrow">ESCOLHA PENDENTE</span><strong>{prompt.label}</strong><small>{prompt.queue[0] ? `Aguardando ${game.state.players.find((player) => player.identity === prompt.queue[0])?.name ?? 'jogador'}` : ''}</small></div>
            {prompt.kind === 'favor' && prompt.targetIdentity === myIdentity && <div className="kiwi-choice__fields"><span>Escolha uma carta da sua mão para entregar.</span>{game.hand.map((card) => <button className="kiwi-button" key={card.id} onClick={() => game.choose({ cardId: card.id })} type="button">{myPlayer?.blind ? 'Carta virada' : game.cardTitle(card.type)}</button>)}</div>}
            {(prompt.kind === 'bury' || prompt.kind === 'insert') && prompt.actorIdentity === myIdentity && <div className="kiwi-choice__fields"><label>Posição no monte (0 = fundo, máximo = topo)<input max={game.state.deckCount} min="0" onChange={(event) => setPosition(Number(event.currentTarget.value))} type="number" value={position} /></label><button className="kiwi-button kiwi-button--primary" onClick={() => game.choose({ position })} type="button">Devolver carta</button></div>}
            {prompt.kind === 'reorder' && prompt.actorIdentity === myIdentity && <div className="kiwi-peek-order">{orderedPeek.map((id, index) => { const card = game.peek.find((item) => item.id === id); return card ? <div className="kiwi-peek-order__card" key={id}><img alt="" src={artByType[card.type] ?? artByType['kiwi-burst']} /><span>{index + 1}. {game.cardTitle(card.type)}</span><button aria-label="Mover para cima" disabled={index === 0} onClick={() => movePeek(id, -1)} type="button">↑</button><button aria-label="Mover para baixo" disabled={index === orderedPeek.length - 1} onClick={() => movePeek(id, 1)} type="button">↓</button></div> : null })}<button className="kiwi-button kiwi-button--primary" onClick={() => game.choose({ cardIds: orderedPeek })} type="button">Confirmar ordem</button></div>}
            {prompt.kind === 'reveal' && prompt.actorIdentity === myIdentity && <div className="kiwi-choice__fields"><button className="kiwi-button kiwi-button--primary" onClick={() => game.choose({ cardId: game.peek[0]?.id })} type="button">Ficar com a carta</button><button className="kiwi-button" onClick={() => game.choose({})} type="button">Comprar a próxima</button></div>}
            {prompt.kind === 'give' && prompt.queue[0] === myIdentity && <div className="kiwi-choice__fields"><span>Escolha uma carta sem revelar o conteúdo aos outros.</span>{game.hand.map((card) => <button className="kiwi-button" key={card.id} onClick={() => game.choose({ cardId: card.id })} type="button">{myPlayer?.blind ? 'Carta virada' : game.cardTitle(card.type)}</button>)}</div>}
          </section>}

          {game.isPlaying && game.state.phase === 'playing' && !prompt && !game.isPendingDefense && (
            <section className="kiwi-hand">
              <div className="kiwi-hand__heading"><div><span className="kiwi-eyebrow">SUA MÃO · PRIVADA</span><strong>{myPlayer?.blind ? 'Escolha sem olhar' : `${game.hand.length} cartas`}</strong></div>
                <div className="kiwi-hand__actions">
                  {activeCard && (targetPlayers.length > 0 || activeCard.type === 'targeted-attack' || activeCard.type === 'feed-dead') && <select aria-label="Alvo da carta" onChange={(event) => setTargetIdentity(event.currentTarget.value)} value={targetIdentity}><option value="">Escolha alvo</option>{targetPlayers.map((person) => <option key={person.identity} value={person.identity}>{person.name}</option>)}</select>}
                  {(isComboTriple || isComboFive) && <select aria-label="Carta desejada" onChange={(event) => setNamedCardType(event.currentTarget.value as KiwiCardType | '')} value={namedCardType}><option value="">Carta desejada</option>{(isComboFive ? helpCardIds.filter(isPublicCardType) : allCardTypes).map((type, index) => <option key={`${type}-${index}`} value={type}>{game.cardTitle(type)}</option>)}</select>}
                  {selectedIds.length > 0 && <button className="kiwi-button kiwi-button--primary" disabled={!game.isMyTurn && !selectedIds.some((id) => { const card = game.hand.find((item) => item.id === id); return card && (isNowCard(card.type) || card.type === 'nope') })} onClick={handlePlay} type="button">Jogar {selectedIds.length > 1 ? `combo · ${selectedIds.length}` : ''}</button>}
                  {game.isController && <button className="kiwi-button kiwi-button--subtle" onClick={() => game.reset()} type="button">Encerrar</button>}
                </div>
              </div>
              {game.hand.length ? <div className={`kiwi-card-row ${myPlayer?.blind ? 'is-blind' : ''}`}>
                {game.hand.map((card) => <button aria-label={myPlayer?.blind ? 'Carta virada' : `${game.cardTitle(card.type)}. ${descriptions[card.type]}`} aria-pressed={selectedIds.includes(card.id)} className={`kiwi-card ${selectedIds.includes(card.id) ? 'is-selected' : ''} ${card.marked ? 'is-marked' : ''}`} key={card.id} onClick={() => toggleCard(card.id)} title={myPlayer?.blind ? 'Carta virada' : descriptions[card.type]} type="button">
                  {!myPlayer?.blind && <img alt="" src={artByType[card.type] ?? artByType['kiwi-burst']} />}
                  <span className="kiwi-card__name">{myPlayer?.blind ? 'Virada' : game.cardTitle(card.type)}</span>
                  {!myPlayer?.blind && <small>{descriptions[card.type]}</small>}
                </button>)}
              </div> : <p className="kiwi-hand__empty">Sua mão está vazia. Compre para continuar.</p>}
            </section>
          )}
          {game.state.phase === 'finished' && <div className="kiwi-finish"><img alt="" src="/assets/exploding-kiwi/kiwi-gift.png" /><strong>Nova partida?</strong><p>As mãos são descartadas e uma rodada nova é montada com as mesmas expansões.</p><button className="kiwi-button kiwi-button--primary" onClick={() => game.reset()} type="button">Voltar ao lobby</button></div>}
        </div>
      )}
    </section>
  )
}

export { expansionLabels }
