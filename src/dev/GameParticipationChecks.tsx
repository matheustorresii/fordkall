import { useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { GAME_KINDS as ALL_GAME_KINDS, GAME_LIMITS } from '../games/gameParticipation'
type GameKind=Exclude<typeof ALL_GAME_KINDS[number],'gartic'|'impostor'>
const GAME_KINDS=ALL_GAME_KINDS.filter((k):k is GameKind=>k!=='gartic'&&k!=='impostor')
import { GAME_PARTICIPATION_TOPIC, useRoomGameParticipation } from '../hooks/useRoomGameParticipation'
import { useRoomIto } from '../hooks/useRoomIto'
import { useRoomExplodingKiwi } from '../hooks/useRoomExplodingKiwi'
import { useRoomTruco } from '../hooks/useRoomTruco'
import { useRoomMind } from '../hooks/useRoomMind'
import { useRoomPoker } from '../hooks/useRoomPoker'
import { useRoomCoup } from '../hooks/useRoomCoup'
import { useRoomCodenames } from '../hooks/useRoomCodenames'
import { ItoGameStage } from '../components/Games/ItoGameStage'
import { ExplodingKiwiStage } from '../components/Games/ExplodingKiwiStage'
import { TrucoMineiroStage } from '../components/Games/TrucoMineiroStage'
import { TheMindStage } from '../components/Games/TheMindStage'
import { PokerStage } from '../components/Games/PokerStage'
import { CoupStage } from '../components/Games/CoupStage'
import { CodenamesStage } from '../components/Games/CodenamesStage'
import { GameParticipationContext } from '../components/Games/GameParticipationContext'
import { GameParticipationPanel } from '../components/Games/GameParticipationPanel'
import { BrandMark } from '../components/ui/BrandMark'
import type { ParticipantMedia } from '../types'

type Listener = (payload: Uint8Array, participant: { identity: string; name: string }, kind: undefined, topic: string) => void
const names = ['Controlador', 'Torres', 'Kaori', 'Filipe', 'Pandinha', 'Kiwi', 'Amigo da call', 'Visitante']
const createMesh = (lateFirst = false) => {
  const listeners = names.map(() => new Map<string, Set<Listener>>())
  const connected = new Set(names.map((_, i) => `p${i}`).filter((id) => !lateFirst || id !== 'p0'))
  const deliver = (from: string, to: string, topic: string, message: unknown) => { if (connected.has(from) && connected.has(to)) listeners[Number(to.slice(1))]?.get(RoomEvent.DataReceived)?.forEach((fn) => fn(new TextEncoder().encode(JSON.stringify(message)), { identity: from, name: names[Number(from.slice(1))]! }, undefined, topic)) }
  const people = names.map((name, index) => ({ identity: `p${index}`, name, publishData: async (payload: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
    for (let target = 0; target < names.length; target++) if (target !== index && (!options.destinationIdentities || options.destinationIdentities.includes(`p${target}`))) queueMicrotask(() => deliver(`p${index}`, `p${target}`, options.topic, JSON.parse(new TextDecoder().decode(payload))))
  } }))
  const rooms = people.map((person, index) => ({ localParticipant: person, remoteParticipants: new Map(people.filter((p) => p !== person && connected.has(p.identity)).map((p) => [p.identity, p])),
    on(event: string, fn: Listener) { if (!listeners[index]!.has(event)) listeners[index]!.set(event, new Set()); listeners[index]!.get(event)!.add(fn); return this },
    off(event: string, fn: Listener) { listeners[index]!.get(event)?.delete(fn); return this },
  }) as unknown as Room)
  const disconnect = (identity: string) => {
    connected.delete(identity)
    rooms.forEach((room) => room.remoteParticipants.delete(identity))
    listeners.forEach((events, i) => { if (`p${i}` !== identity) events.get(RoomEvent.ParticipantDisconnected)?.forEach((fn) => (fn as unknown as (p: { identity: string }) => void)({ identity })) })
  }
  const connect = (identity: string) => {
    connected.add(identity)
    const person = people.find((p) => p.identity === identity)!
    rooms.forEach((room) => { if (room.localParticipant.identity !== identity) room.remoteParticipants.set(identity, person as never) })
    listeners.forEach((events) => events.get(RoomEvent.ParticipantConnected)?.forEach((fn) => (fn as unknown as (p: typeof person) => void)(person)))
  }
  return { rooms, deliver, disconnect, connect }
}
const useClient = (room: Room) => {
  const participation = useRoomGameParticipation(room)
  return { participation, ito: useRoomIto(room, participation), kiwi: useRoomExplodingKiwi(room, participation), truco: useRoomTruco(room, participation), mind: useRoomMind(room, participation), poker: useRoomPoker(room, participation), coup: useRoomCoup(room, participation), codenames: useRoomCodenames(room, participation) }
}
const pause = (ms = 45) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** All seven production hooks on eight actual protocol clients; p0 can watch while coordinating. */
export const GameParticipationChecks = ({ interactive = false }: { interactive?: boolean }) => {
  const mesh = useMemo(createMesh, [])
  const lateMesh = useMemo(() => createMesh(true), [])
  const arriving = useRoomGameParticipation(lateMesh.rooms[0]!), established = useRoomGameParticipation(lateMesh.rooms[1]!)
  const lateLatest = useRef({ arriving, established }); lateLatest.current = { arriving, established }
  const a = useClient(mesh.rooms[0]!), b = useClient(mesh.rooms[1]!), c = useClient(mesh.rooms[2]!), d = useClient(mesh.rooms[3]!)
  const e = useClient(mesh.rooms[4]!), f = useClient(mesh.rooms[5]!), g = useClient(mesh.rooms[6]!), h = useClient(mesh.rooms[7]!)
  const latest = useRef([a,b,c,d,e,f,g,h]); latest.current = [a,b,c,d,e,f,g,h]
  const [results, setResults] = useState<string[]>([]), [running, setRunning] = useState(false)
  const query = new URLSearchParams(window.location.search)
  const [kind, setKind] = useState<GameKind>(GAME_KINDS.includes(query.get('game') as GameKind) ? query.get('game') as GameKind : 'ito')
  const [view, setView] = useState(1), [panelOpen, setPanelOpen] = useState(false)
  const client = (index = 0) => latest.current[index]!
  const configure = async (game: GameKind, count = game === 'mind' || game === 'poker' || game === 'coup' ? 3 : 4) => {
    for (let i = 0; i < 8; i++) { client(i).participation.setPlaying(game, i >= 1 && i <= count); await pause(12) }
    client(1).participation.organize(game); await pause()
  }
  const start = async (game: GameKind) => {
    if (game === 'codenames') {
      for (let i = 1; i <= 4; i++) { client(i).codenames.move({ type: 'seat', team: i % 2 ? 'red' : 'blue', role: i <= 2 ? 'spymaster' : 'operative' }); await pause(12) }
    }
    client(1)[game].start(); await pause()
  }
  const run = async () => {
    setRunning(true); setResults([])
    const assert = (test: unknown, label: string) => { if (!test) throw new Error(label); setResults((items) => [...items, `PASS · ${label}`]) }
    try {
      for (const game of GAME_KINDS) {
        await configure(game)
        const expected = game === 'mind' || game === 'poker' || game === 'coup' ? 3 : 4
        assert(latest.current.every((item) => item.participation.members(game).length === expected && !item.participation.allowed(game, 'p0')), `${game}: lista de participantes sincronizada nos oito clientes`)
        assert(latest.current.every((item) => item.participation.state.games[game].organizer === 'p1'), `${game}: organizador é quem prepara a mesa, não o controlador técnico`)
        await start(game)
        const state = client()[game].state
        assert(Boolean(state.gameId) && state.players.filter((p) => !('team' in p) || p.team !== null).length === expected, `${game}: inicia só com quem participa, mesmo com oito pessoas na call`)
        assert(!state.players.some((p) => p.identity === 'p0') || game === 'codenames' && state.players.some((p) => p.identity === 'p0' && 'team' in p && !p.team), `${game}: controlador espectador não é forçado a receber cartas`)
        const previousGame = state.gameId
        client(2).participation.setPlaying(game, false); await pause(100)
        assert(latest.current.every((item) => !item.participation.allowed(game, 'p2')), `${game}: optout durante a partida chega a todos sem sair da call`)
        assert(mesh.rooms.every((room) => room.remoteParticipants.size === 7), `${game}: a call mantém as oito pessoas conectadas`)
        if (game === 'ito') {
          assert(client().ito.state.players.length === 3 && client().ito.state.gameId !== previousGame && !client(2).ito.localCards.length, 'ITO: redistribui entre quem ficou e retira a mão privada de quem saiu')
          assert(client().ito.state.roundNumber === 1 && client().ito.state.extraCards === 0, 'ITO: sair não inventa vitória, derrota ou avanço de dificuldade')
          client(2).ito.voteReveal(true); await pause()
          assert(Boolean(client(2).ito.error), 'ITO: espectador não pode votar')
        } else if (game === 'mind') {
          assert(client().mind.state.players.length === 2 && client().mind.state.gameId !== previousGame && !client(2).mind.hand.length, 'The Mind: novo nível privado só para quem ficou')
          assert(client().mind.state.level === 1 && client().mind.state.lives === 3, 'The Mind: a saída não cobra uma vida nem avança o nível')
        } else if (game === 'poker') {
          assert(client().poker.state.players.find((p) => p.identity === 'p2')?.away && client().poker.state.phase !== 'lobby', 'Poker: jogador fica ausente e o pote não é apagado')
          client(2).poker.act({ type: 'check' }); await pause()
          assert(Boolean(client(2).poker.error), 'Poker: espectador não joga uma mão antiga')
        } else if (game === 'coup') {
          assert(client().coup.state.players.find((p) => p.identity === 'p2')?.influence === 0 && client().coup.state.phase !== 'lobby', 'Coup: saída elimina apenas a pessoa, sem reiniciar a partida')
        } else if (game === 'truco') {
          assert(client().truco.state.phase === 'lobby' && latest.current.every((item) => !item.truco.hand.length), 'Truco: volta à preparação com três pessoas, sem ficar travado')
        } else if (game === 'kiwi') {
          assert(client().kiwi.state.players.find((p) => p.identity === 'p2')?.alive === false && !client(2).kiwi.hand.length && client().kiwi.state.phase === 'playing', 'Kiwi: saída elimina e limpa a mão, mantendo os outros na rodada')
          assert(client().kiwi.state.currentPlayerIdentity !== 'p2', 'Kiwi: quem saiu nunca fica segurando a vez')
        } else {
          assert(client().codenames.state.phase === 'lobby' && latest.current.every((item) => !item.codenames.key.length), 'Codenames: volta às equipes sem vazar a chave antiga')
        }
        client(3).participation.remove(game, 'p1'); await pause()
        assert(client().participation.allowed(game, 'p1') && Boolean(client(3).participation.error), `${game}: outro jogador não pode retirar o organizador`)
        client(1).participation.remove(game, 'p3'); await pause(100)
        assert(latest.current.every((item) => !item.participation.allowed(game, 'p3')), `${game}: organizador consegue mover outra pessoa para espectador`)
        client(3).participation.setPlaying(game, true); await pause()
        assert(latest.current.every((item) => item.participation.allowed(game, 'p3')), `${game}: só a própria pessoa escolhe voltar a participar`)
      }
      const before = client().participation.getState().revision
      mesh.deliver('p1', 'p0', GAME_PARTICIPATION_TOPIC, { type: 'command', commandId: crypto.randomUUID(), command: { type: 'participation', game: 'ito', target: 'p2', playing: true, revision: before } }); await pause()
      assert(!client().participation.allowed('ito', 'p2'), 'Nem o organizador pode forçar quem optou por assistir a voltar')
      const authentic = client(4).participation.state
      mesh.deliver('p3', 'p4', GAME_PARTICIPATION_TOPIC, { type: 'state', state: { ...authentic, controllerIdentity: 'p3', revision: authentic.revision + 100 } }); await pause()
      assert(client(4).participation.state.controllerIdentity === 'p0', 'Estado falso de outro participante não assume o controle da lista')
      assert(client().participation.getState().revision >= before, 'Revisões continuam coerentes após os sete jogos')
      const choices = JSON.stringify(client(1).participation.state.games)
      mesh.disconnect('p0'); await pause(150)
      assert(latest.current.slice(1).every((item) => JSON.stringify(item.participation.state.games) === choices), 'A saída do controlador não apaga os optouts de nenhum jogo')
      assert(latest.current.slice(1).every((item) => item.participation.state.controllerIdentity === 'p1'), 'Um novo controlador assume a lista sem colocar espectadores para jogar')
      lateLatest.current.established.setPlaying('ito', false); await pause()
      lateMesh.connect('p0'); await pause(150)
      assert(!lateLatest.current.arriving.allowed('ito', 'p1') && !lateLatest.current.established.allowed('ito', 'p1'), 'Pessoa que entra depois, com identidade menor, recebe os optouts existentes sem apagá-los')
    } catch (cause) { setResults((items) => [...items, `FAIL · ${cause instanceof Error ? cause.message : String(cause)}`]) }
    finally { setRunning(false) }
  }
  if (!interactive) return <section style={{ height: '100%', overflow: 'auto', padding: '70px 24px 100px', background: '#14251e', color: '#e5eddf', font: '14px system-ui' }}><h1>Optout nos sete jogos</h1><p>Oito clientes reais, controle compartilhado, organizador e saída durante as partidas.</p><button className="game-action" disabled={running} onClick={() => void run()} type="button">{running ? 'Testando…' : 'Executar verificações de participação'}</button><ol aria-live="polite">{results.map((text, i) => <li key={i} style={{ marginBottom: 8 }}>{text}</li>)}</ol><p>{results.filter((line) => line.startsWith('PASS')).length} verificações passaram.</p></section>
  const current = client(view), game = current[kind], participation = current.participation
  const participants: ParticipantMedia[] = names.map((name, i) => ({ id: `p${i}`, name, isLocal: i === view, cameraEnabled: false, microphoneMuted: false, appearance: { nameColor: '#d8e3cf', nameFont: 'mono', theme: 'lime', accentColor: '#b5d789', avatarFrame: 'none' } }))
  const ui = { kind, participating: participation.allowed(kind, `p${view}`), count: participation.members(kind).length, canStart: participation.canStart(kind, `p${view}`), members: participants.filter((person) => participation.allowed(kind, person.id)), open: () => setPanelOpen(true) }
  const props = { participants, onExit: () => {}, onOpenGameHub: () => {} }
  return <main className="call-shell call-shell--games-open"><header className="call-header"><button className="brand brand--compact call-home-button" type="button"><BrandMark /></button></header><GameParticipationContext.Provider value={ui}><div className="call-workspace">
    {kind === 'ito' ? <ItoGameStage {...props} game={current.ito} /> : kind === 'kiwi' ? <ExplodingKiwiStage {...props} game={current.kiwi} /> : kind === 'truco' ? <TrucoMineiroStage {...props} game={current.truco} /> : kind === 'mind' ? <TheMindStage {...props} game={current.mind} /> : kind === 'poker' ? <PokerStage {...props} game={current.poker} /> : kind === 'coup' ? <CoupStage {...props} game={current.coup} /> : <CodenamesStage {...props} game={current.codenames} />}
  </div>{panelOpen && <GameParticipationPanel active={Boolean(game.state.gameId)} activeIds={game.state.players.map((p) => p.identity)} kind={kind} onClose={() => setPanelOpen(false)} participants={participants} participation={participation} />}</GameParticipationContext.Provider><details style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 100, padding: 8, borderRadius: 8, background: '#10241f', color: '#edf4e5', font: '12px system-ui' }}><summary>Prévia de participação</summary><div style={{ display: 'grid', gap: 8, paddingTop: 8 }}><label>Jogo <select value={kind} onChange={(event) => setKind(event.currentTarget.value as GameKind)}>{GAME_KINDS.map((value) => <option key={value} value={value}>{GAME_LIMITS[value].name}</option>)}</select></label><label>Visão <select value={view} onChange={(event) => setView(Number(event.currentTarget.value))}>{names.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label><button onClick={() => void configure(kind).then(() => start(kind))} type="button">Preparar e iniciar</button></div></details></main>
}
