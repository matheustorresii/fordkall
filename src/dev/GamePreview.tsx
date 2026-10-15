import { useState, type ComponentProps } from 'react'
import { ExplodingKiwiStage } from '../components/Games/ExplodingKiwiStage'
import type { useRoomExplodingKiwi, KiwiCard, KiwiCardType, KiwiRoomState } from '../hooks/useRoomExplodingKiwi'
import type { ParticipantMedia } from '../types'
import { Icon } from '../components/ui/Icon'
import { BrandMark } from '../components/ui/BrandMark'
import { kiwiCardTitle } from '../games/kiwiCards'
import { TheMindStage } from '../components/Games/TheMindStage'
import { TrucoMineiroStage } from '../components/Games/TrucoMineiroStage'
import { ItoGameStage } from '../components/Games/ItoGameStage'
import type { MindRoomState } from '../hooks/useRoomMind'
import type { TrucoCard, TrucoRoomState } from '../hooks/useRoomTruco'
import type { ItoRoomState } from '../hooks/useRoomIto'
import { KiwiNetworkChecks } from './KiwiNetworkChecks'

export const previewParticipants: ParticipantMedia[] = ['frangoelho 2', 'luisalgaelalves76', 'gabriela kaori', 'torres mobile', 'Um nome bastante comprido para testar', 'Kiwi', 'Pandinha', 'Amigo da call'].map((name, index) => ({
  id: `p${index}`, name, isLocal: index === 0, cameraEnabled: false, microphoneMuted: false,
  appearance: { nameColor: '#d8e3cf', nameFont: 'mono', theme: 'lime', accentColor: '#b5d789', avatarFrame: 'none' },
}))
const card = (type: KiwiCardType, index: number): KiwiCard => ({ id: `${type}-${index}`, type })
const startingHand: KiwiCard[] = ['leaf-helmet', 'see-future-3', 'personal-attack', 'favor', 'kiwi-cat-a', 'kiwi-cat-a', 'shuffle', 'attack'].map((type, index) => card(type as KiwiCardType, index))
const future = [card('kiwi-burst', 100), card('skip', 101), card('favor', 102)]
const initialState = (count: number): KiwiRoomState => ({
  gameId: 'preview', controllerIdentity: 'p0', revision: 1, phase: 'playing', expansions: [], excludedCards: [],
  players: previewParticipants.slice(0, count).map((person, index) => ({ identity: person.id, name: person.name, alive: true, handCount: index === 0 ? 8 : 4 + index })),
  currentPlayerIdentity: 'p0', turnsRemaining: 1, direction: 1, deckCount: 31,
  discard: [{ ...card('attack', 91), playedByIdentity: 'p1' }, { ...card('skip', 92), playedByIdentity: 'p0' }],
  pendingDefenseIdentity: '', pendingDefenseTurnIdentity: '', pendingDefenseType: '', pendingAction: null, prompt: null, pendingFavor: null,
  barkingOwnerIdentity: '', winnerIdentity: '', lastAction: 'Jogue uma ação ou compre para encerrar seu turno.',
})
const initialMind = (count: number): MindRoomState => ({ gameId: 'mind-preview', controllerIdentity: 'p0', revision: 1, phase: 'playing', players: previewParticipants.slice(0, Math.min(count, 4)).map((person, index) => ({ identity: person.id, name: person.name, cardsRemaining: index === 1 ? 1 : 2 })), level: 2, maxLevel: 12, lives: 2, maxLives: 4, shurikens: 1, played: [8, 17, 35], shurikenVotes: [], lastMistake: null, lastEvent: 'luisalgaelalves76 jogou uma carta.' })
const initialTruco = (): TrucoRoomState => ({ gameId: 'truco-preview', controllerIdentity: 'p0', revision: 1, phase: 'playing', players: previewParticipants.slice(0, 4).map((person, seat) => ({ identity: person.id, name: person.name, seat, team: (seat % 2) as 0 | 1 })), scores: [4, 6], dealerSeat: 3, manoSeat: 0, currentSeat: 0, trickLeaderSeat: 0, trickIndex: 0, trickPlays: [{ identity: 'p1', card: { id: '7-ouros', rank: '7', suit: 'ouros' } }, { identity: 'p2', card: { id: 'K-paus', rank: 'K', suit: 'paus' } }], lastTrick: [], trickWinners: [], stake: 2, lastRaiseTeam: null, pendingRaise: null, handWinner: null, lastHandMessage: '' })
const initialTrucoHand: TrucoCard[] = [{ id: '4-paus', rank: '4', suit: 'paus' }, { id: 'A-espadas', rank: 'A', suit: 'espadas' }, { id: '3-copas', rank: '3', suit: 'copas' }]
const initialIto = (count: number): ItoRoomState => ({ gameId: 'ito-preview', controllerIdentity: 'p0', revision: 1, phase: 'order', topic: 'De pouco a muito constrangedor', players: previewParticipants.slice(0, count).map((person, index) => ({ identity: person.id, name: person.name, clue: ['Mandar mensagem no grupo errado', 'Dar tchau para quem não estava falando com você', 'Cair na frente de todo mundo', 'Errar o nome da pessoa', 'Microfone aberto na reunião', 'Tropeçar', 'Esquecer a fala', 'Áudio no viva-voz'][index]! })), order: previewParticipants.slice(0, count).map((person) => person.id) })

export const GamePreview = () => {
  const [kind, setKind] = useState(new URLSearchParams(window.location.search).get('game-preview') || 'kiwi')
  const [count, setCount] = useState(5)
  const [state, setState] = useState(initialState(5))
  const [hand, setHand] = useState(startingHand)
  const [peek, setPeek] = useState<KiwiCard[]>([])
  const [peekId, setPeekId] = useState('')
  const [error, setError] = useState('')
  const [lastCommand, setLastCommand] = useState('')
  const [mindState, setMindState] = useState(initialMind(4))
  const [mindHand, setMindHand] = useState([61, 92])
  const [trucoState, setTrucoState] = useState(initialTruco)
  const [trucoHand, setTrucoHand] = useState(initialTrucoHand)
  const [itoState, setItoState] = useState(initialIto(5))
  const reveal = () => { setPeek(future); setPeekId(crypto.randomUUID()) }
  const game: ReturnType<typeof useRoomExplodingKiwi> = {
    state, hand, peek, peekId, stash: [], error, clearError: () => setError(''), participantCount: count,
    isController: true, isPlaying: true, isMyTurn: state.currentPlayerIdentity === 'p0', isPendingDefense: state.pendingDefenseIdentity === 'p0', isPendingFavor: false,
    start: () => { setState(initialState(count)); setHand(startingHand); return true }, reset: () => { setState((value) => ({ ...value, phase: 'lobby', prompt: null })); setPeek([]); return true },
    draw: () => { setState((value) => ({ ...value, deckCount: value.deckCount - 1, currentPlayerIdentity: 'p1' })); setHand((items) => [...items, card('kiwi-cat-b', Date.now())]); setPeek([]); return true },
    play: (ids, target) => {
      const selected = hand.filter((item) => ids.includes(item.id)); setLastCommand(`${selected.map((item) => item.type).join(',')} → ${target || 'SEM ALVO'}`)
      setHand((items) => items.filter((item) => !ids.includes(item.id)))
      setState((value) => ({ ...value, discard: [...value.discard, ...selected.map((item) => ({ ...item, playedByIdentity: 'p0' }))], lastAction: `frangoelho 2 jogou ${selected[0] ? kiwiCardTitle(selected[0].type) : 'combo'}.` }))
      if (selected[0]?.type === 'see-future-3') reveal()
      return true
    },
    defuse: () => { setState((value) => ({ ...value, pendingDefenseIdentity: '', pendingDefenseType: '' })); return true },
    favor: () => true, nope: () => true,
    choose: () => { setState((value) => ({ ...value, prompt: null })); setPeek([]); return true }, cardTitle: kiwiCardTitle,
  }
  const mindGame: ComponentProps<typeof TheMindStage>['game'] = { state: mindState, hand: mindHand, error: '', clearError: () => {}, participantCount: mindState.players.length, start: () => { setMindState(initialMind(count)); setMindHand([61,92]); return true }, play: (value) => { setMindHand((items) => items.filter((item) => item !== value)); setMindState((current) => ({ ...current, played: [...current.played, value], players: current.players.map((player) => player.identity === 'p0' ? { ...player, cardsRemaining: player.cardsRemaining - 1 } : player) })); return true }, voteShuriken: () => { setMindState((current) => ({ ...current, shurikenVotes: ['p0'] })); return true }, nextLevel: () => { setMindState((current) => ({ ...current, phase: 'playing', level: current.level + 1, played: [] })); return true }, reset: () => { setMindState((current) => ({ ...current, phase: 'lobby' })); return true } }
  const trucoGame: ComponentProps<typeof TrucoMineiroStage>['game'] = { state: trucoState, hand: trucoHand, error: '', clearError: () => {}, participantCount: 4, start: () => { setTrucoState(initialTruco()); setTrucoHand(initialTrucoHand); return true }, play: (id) => { const selected = trucoHand.find((item) => item.id === id); if (selected) { setTrucoHand((items) => items.filter((item) => item.id !== id)); setTrucoState((current) => ({ ...current, trickPlays: [...current.trickPlays, { identity: 'p0', card: selected }], currentSeat: 3 })) }; return true }, callTruco: () => { setTrucoState((current) => ({ ...current, pendingRaise: { identity: 'p1', team: 1, targetStake: 4 } })); return true }, acceptRaise: () => { setTrucoState((current) => ({ ...current, stake: 4, pendingRaise: null })); return true }, refuseRaise: () => { setTrucoState((current) => ({ ...current, phase: 'hand-result', handWinner: 1, pendingRaise: null, lastHandMessage: 'Dupla 2 levou a mão.' })); return true }, nextHand: () => { setTrucoState(initialTruco()); return true }, reset: () => { setTrucoState((current) => ({ ...current, phase: 'lobby' })); return true } }
  const itoGame: ComponentProps<typeof ItoGameStage>['game'] = { state: itoState, localNumber: 31, error: '', clearError: () => {}, isController: true, participantCount: count, isParticipating: true, start: () => { setItoState({ ...initialIto(count), phase: 'clue', players: initialIto(count).players.map((player) => ({ ...player, clue: '' })) }); return true }, submitClue: (clue) => { setItoState((current) => ({ ...current, players: current.players.map((person) => person.identity === 'p0' ? { ...person, clue } : person) })); return true }, movePlayer: (identity, offset) => { setItoState((current) => { const order = [...current.order]; const index = order.indexOf(identity); [order[index], order[index + offset]] = [order[index + offset]!, order[index]!]; return { ...current, order } }); return true }, reveal: () => { setItoState((current) => ({ ...current, phase: 'revealed', succeeded: true, numbers: Object.fromEntries(current.order.map((identity, index) => [identity, 5 + index * 12])) })); return true }, reset: () => { setItoState((current) => ({ ...current, phase: 'lobby' })); return true } }
  if (kind === 'checks') return <KiwiNetworkChecks />
  return <main className="call-shell call-shell--games-open">
    <header className="call-header"><button className="brand brand--compact call-home-button" type="button"><BrandMark /><h1>FORD KALL</h1></button><div className="call-header__actions">{(['users', 'music', 'gamepad', 'chat'] as const).map((name) => <button aria-label={name} className="participants-toggle" key={name} type="button"><Icon name={name} /></button>)}<div className="connection-pill connection-pill--connected"><i /></div></div></header>
    <div className="call-workspace">{kind === 'mind' ? <TheMindStage game={mindGame} participants={previewParticipants.slice(0, 4)} onExit={() => setLastCommand('Voltar para call')} onOpenGameHub={() => setLastCommand('Central de jogos')} /> : kind === 'truco' ? <TrucoMineiroStage game={trucoGame} participants={previewParticipants.slice(0, 4)} onExit={() => setLastCommand('Voltar para call')} onOpenGameHub={() => setLastCommand('Central de jogos')} /> : kind === 'ito' ? <ItoGameStage game={itoGame} participants={previewParticipants.slice(0, count)} onExit={() => setLastCommand('Voltar para call')} onOpenGameHub={() => setLastCommand('Central de jogos')} /> : <ExplodingKiwiStage game={game} participants={previewParticipants.slice(0, count)} onExit={() => setLastCommand('Voltar para call')} onOpenGameHub={() => setLastCommand('Central de jogos')} />}</div>
    <footer className="call-dock"><div className="call-dock__group">{(['micOff', 'cameraOff', 'headphones', 'screen', 'settings', 'leave'] as const).map((name) => <button aria-label={name} className="call-control" key={name} type="button"><span className="call-control__icon"><Icon name={name} /></span><span>{name}</span></button>)}</div></footer>
    {!new URLSearchParams(window.location.search).has('clean') && <details style={{ position: 'fixed', bottom: 10, left: 10, zIndex: 100, maxWidth: 230, borderRadius: 8, background: '#17231edc', padding: 7, font: '11px system-ui', color: '#dcdecf' }}><summary>Prévia de desenvolvimento</summary><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingTop: 6 }}>
      {['kiwi','mind','truco','ito'].map((value) => <button key={value} onClick={() => setKind(value)} type="button">{value}</button>)}
      {[2, 3, 5, 8].map((value) => <button key={value} onClick={() => { setCount(value); setState(initialState(Math.min(value, 5))); setHand(startingHand); setPeek([]); setItoState(initialIto(value)); setMindState(initialMind(value)) }} type="button">{value} pessoas</button>)}
      <button onClick={() => { setHand(startingHand); setState(initialState(count)); setPeek([]) }} type="button">Restaurar</button>
      <button onClick={reveal} type="button">Futuro</button>
      <button onClick={() => { reveal(); setState((value) => ({ ...value, prompt: { kind: 'reorder', actorIdentity: 'p0', targetIdentity: 'p0', queue: [], label: 'A primeira carta será a próxima compra.', count: 3 } })) }} type="button">Reordenar</button>
      <button onClick={() => setState((value) => ({ ...value, pendingDefenseIdentity: 'p0', pendingDefenseType: 'kiwi-burst', players: value.players.map((person) => person.identity === 'p0' ? { ...person, explosionCard: card('kiwi-burst', 55) } : person) }))} type="button">Defesa</button>
      <button onClick={() => setState((value) => ({ ...value, prompt: { kind: 'favor', actorIdentity: 'p1', targetIdentity: 'p0', queue: [], label: 'Escolha uma carta para entregar.', count: 1 } }))} type="button">Favor</button>
      <button onClick={() => setHand([...startingHand, ...startingHand.map((item) => ({ ...item, id: `${item.id}-extra` }))])} type="button">16 cartas</button>
      <button onClick={() => { setMindState((current) => ({ ...current, phase: 'level-result' })); setItoState((current) => ({ ...current, phase: 'clue', players: current.players.map((player) => ({ ...player, clue: '' })) })) }} type="button">Próxima fase</button>
    </div><output style={{ display: 'block', marginTop: 6 }}>{lastCommand}</output></details>}
  </main>
}
