import { useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { TRUCO_TOPIC, useRoomTruco } from '../hooks/useRoomTruco'
import { trucoCanRespond, trucoPaused, trucoPlayerAt } from '../games/truco'
import { parseTrucoState } from '../games/trucoWire'

type Listener = (...args: unknown[]) => void
type Packet = { from: string; to: string; message: Record<string, unknown>; directed: boolean }
const encoder = new TextEncoder(), decoder = new TextDecoder()
const createMesh = () => {
  const ids = ['A', 'B', 'C', 'D', 'E'], connected = new Set(ids.slice(0, 4))
  const listeners = ids.map(() => new Map<string, Set<Listener>>()), packets: Packet[] = []
  const deliver = (from: string, to: string, message: unknown) => listeners[ids.indexOf(to)]?.get(RoomEvent.DataReceived)
    ?.forEach((fn) => fn(encoder.encode(JSON.stringify(message)), { identity: from, name: from }, undefined, TRUCO_TOPIC))
  const people = ids.map((identity) => ({ identity, name: identity,
    publishData: async (payload: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
      if (!connected.has(identity) || options.topic !== TRUCO_TOPIC) return
      for (const to of ids.filter((id) => id !== identity && connected.has(id) && (!options.destinationIdentities || options.destinationIdentities.includes(id)))) {
        const message = JSON.parse(decoder.decode(payload))
        packets.push({ from: identity, to, message, directed: Boolean(options.destinationIdentities) })
        window.setTimeout(() => deliver(identity, to, message), 3)
      }
    },
  }))
  const rooms = people.map((p, index) => ({
    localParticipant: p,
    remoteParticipants: new Map(people.filter((other) => connected.has(other.identity) && other !== p).map((other) => [other.identity, other])),
    on(event: string, fn: Listener) { if (!listeners[index]!.has(event)) listeners[index]!.set(event, new Set()); listeners[index]!.get(event)!.add(fn); return this },
    off(event: string, fn: Listener) { listeners[index]!.get(event)?.delete(fn); return this },
  }) as unknown as Room)
  const membership = (keep: string[]) => {
    const removed = [...connected].filter((id) => !keep.includes(id)), added = keep.filter((id) => !connected.has(id))
    connected.clear(); keep.forEach((id) => connected.add(id))
    for (const room of rooms) {
      room.remoteParticipants.clear()
      for (const person of people) if (connected.has(person.identity) && person.identity !== room.localParticipant.identity)
        room.remoteParticipants.set(person.identity, person as never)
    }
    rooms.forEach((room, index) => {
      if (!connected.has(room.localParticipant.identity)) return
      for (const id of removed) listeners[index]!.get(RoomEvent.ParticipantDisconnected)?.forEach((fn) => fn(people.find((p) => p.identity === id)))
      for (const id of added) listeners[index]!.get(RoomEvent.ParticipantConnected)?.forEach((fn) => fn(people.find((p) => p.identity === id)))
    })
  }
  return { rooms, packets, membership, deliver }
}
type Game = ReturnType<typeof useRoomTruco>
const pause = (ms = 45) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
export const TrucoNetworkChecks = () => {
  const mesh = useMemo(createMesh, [])
  const a = useRoomTruco(mesh.rooms[0]!), b = useRoomTruco(mesh.rooms[1]!), c = useRoomTruco(mesh.rooms[2]!),
    d = useRoomTruco(mesh.rooms[3]!), e = useRoomTruco(mesh.rooms[4]!)
  const latest = useRef<Game[]>([]); latest.current = [a, b, c, d, e]
  const [results, setResults] = useState<string[]>([]), [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true); setResults([])
    const game = (id = 'A') => latest.current[id.charCodeAt(0) - 65]!, state = () => game().state
    const assert = (ok: unknown, label: string) => { if (!ok) throw new Error(label); setResults((items) => [...items, `PASS · ${label}`]) }
    const same = () => latest.current.slice(0, 4).every((g) => JSON.stringify(parseTrucoState(g.state)) === JSON.stringify(parseTrucoState(state())))
    const actor = () => trucoPlayerAt(state())!.identity
    const responders = () => state().players.filter((p) => trucoCanRespond(state(), p.identity)).map((p) => p.identity)
    const play = async (id = actor()) => { game(id).play(game(id).hand[0]!.id); await pause() }
    const request = async (id = actor()) => { game(id).callTruco(); await pause() }
    const accept = async (id = responders()[0]!) => { game(id).acceptRaise(); await pause() }
    const fresh = async () => { game().reset(); await pause(); game('D').start(); await pause(90) }
    const complete = async () => {
      for (let turns = 0; state().phase === 'playing'; turns++) {
        if (turns >= 12) throw new Error('Mão não terminou em 12 cartas')
        await play()
      }
    }
    try {
      await fresh()
      assert(same() && latest.current.slice(0, 4).every((g) => g.hand.length === 3), 'Quatro hooks reais recebem a mesma mesa e suas mãos privadas')
      assert(new Set(latest.current.slice(0, 4).flatMap((g) => g.hand.map((c) => c.id))).size === 12, 'As doze cartas são únicas e privadas')
      assert(state().players.map((p) => p.identity).join() === 'A,B,C,D' && actor() === 'B', 'Duplas e primeiro jogador são idênticos nos quatro clientes')
      const openingStep = state().stepId
      game('D').play(game('D').hand[0]!.id); await pause()
      assert(Boolean(game('D').error) && state().stepId === openingStep, 'Fora da vez não consome carta nem avança o turno')
      for (let position = 0; position < 4; position++) {
        for (let chain = 1; chain <= 4; chain++) {
          await fresh()
          const leader = state().trickLeaderSeat
          for (let i = 0; i < position; i++) await play()
          const cardActor = actor(), beforeHands = latest.current.slice(0, 4).map((g) => g.hand.map((c) => c.id).join()), beforePlays = JSON.stringify(state().trickPlays)
          await request()
          assert(same() && actor() === cardActor && responders().length === 2, `Posição ${position}, cadeia ${chain}: pedido pausa o ator correto`)
          assert(latest.current.slice(0, 4).map((g) => g.hand.map((c) => c.id).join()).join('|') === beforeHands.join('|'), `Posição ${position}, cadeia ${chain}: pedido não muda cartas privadas`)
          for (let increase = 1; increase < chain; increase++) {
            await request(responders()[increase % 2]!)
            assert(same() && actor() === cardActor && JSON.stringify(state().trickPlays) === beforePlays, `Posição ${position}, cadeia ${chain}: aumento ${increase} não troca a vez`)
          }
          const responseStep = state().stepId, responder = responders()[position % 2]!, gameId = state().gameId
          await accept(responder)
          assert(same() && actor() === cardActor && state().stake === [4, 6, 10, 12][chain - 1], `Posição ${position}, cadeia ${chain}: aceite retoma exatamente ${cardActor}`)
          mesh.deliver(responder, 'A', { type: 'command', commandId: crypto.randomUUID(), command: { type: 'move', gameId, stepId: responseStep, move: { type: 'accept-raise' } } })
          await pause()
          assert(!state().pendingRaise && actor() === cardActor && same(), `Posição ${position}, cadeia ${chain}: aceite atrasado não muda a retomada`)
          for (let i = position; i < 4; i++) await play()
          const expected = Array.from({ length: 4 }, (_, i) => state().players.find((p) => p.seat === (leader + i) % 4)!.identity).join()
          assert(state().lastTrick.map((p) => p.identity).join() === expected && same(), `Posição ${position}, cadeia ${chain}: cada um joga uma vez na ordem certa`)
          assert(latest.current.slice(0, 4).every((g) => g.hand.length === 2), `Posição ${position}, cadeia ${chain}: ninguém perdeu a vez nem ficou com carta extra`)
          await complete()
          assert(same() && ['hand-result', 'finished'].includes(state().phase), `Posição ${position}, cadeia ${chain}: mão termina sem softlock`)
        }
      }
      await fresh()
      await request()
      const both = responders(), simultaneousActor = actor()
      game(both[0]!).acceptRaise(); game(both[1]!).acceptRaise(); await pause(90)
      assert(same() && !state().pendingRaise && state().stake === 4 && actor() === simultaneousActor && latest.current.slice(0, 4).every((g) => g.hand.length === 3), 'Dois parceiros aceitando juntos resolvem uma única vez e não mudam a vez')
      await fresh()
      const requestGame = state().gameId, oldStep = state().stepId, requester = actor()
      await request()
      const pendingStep = state().stepId, target = state().pendingRaise!.targetStake
      mesh.deliver(requester, 'A', { type: 'command', commandId: crypto.randomUUID(), command: { type: 'move', gameId: requestGame, stepId: oldStep, move: { type: 'call-truco' } } })
      await pause()
      assert(state().stepId === pendingStep && state().pendingRaise!.targetStake === target, 'Duplo clique no pedido não cria uma segunda aposta')
      const answer = responders()[0]!
      await request(answer)
      const newPending = state().stepId
      mesh.deliver(answer, 'A', { type: 'command', commandId: crypto.randomUUID(), command: { type: 'move', gameId: state().gameId, stepId: pendingStep, move: { type: 'accept-raise' } } })
      await pause()
      assert(state().stepId === newPending && state().pendingRaise!.targetStake === 6, 'Aceite antigo não aceita um novo pedido de seis')
      await accept()
      const playedIdentity = actor(), oldCard = game(playedIdentity).hand[0]!, playStep = state().stepId
      await play()
      const afterPlay = state().stepId
      mesh.deliver(playedIdentity, 'A', { type: 'command', commandId: crypto.randomUUID(), command: { type: 'move', gameId: state().gameId, stepId: playStep, move: { type: 'play', cardId: oldCard.id } } })
      await pause()
      assert(state().stepId === afterPlay && state().trickPlays.length === 1 && same(), 'Carta duplicada ou atrasada não pula o próximo jogador')
      await fresh()
      const oldGameId = state().gameId, oldHand = structuredClone(game('D').hand)
      await request()
      game(responders()[0]!).refuseRaise(); await pause()
      const scores = [...state().scores], matchId = state().matchId, oldDealer = state().dealerSeat
      const oldNext = { type: 'next-hand', gameId: state().gameId, stepId: state().stepId }
      game('C').nextHand(); await pause(90)
      assert(same() && state().gameId !== oldGameId && state().matchId === matchId && state().handNumber === 2, 'Próxima mão muda id privado, mas preserva a queda')
      assert(state().dealerSeat === (oldDealer + 1) % 4 && state().scores.join() === scores.join(), 'Distribuidor roda sem zerar placar ou duplas')
      assert(latest.current.slice(0, 4).every((g) => g.hand.length === 3), 'Nova distribuição chega aos quatro clientes')
      const beforePrivate = JSON.stringify(game('D').hand), nextStep = state().stepId
      mesh.deliver('A', 'D', { type: 'private', gameId: oldGameId, data: oldHand })
      mesh.deliver('C', 'A', { type: 'command', commandId: crypto.randomUUID(), command: oldNext })
      await pause()
      assert(state().stepId === nextStep && JSON.stringify(game('D').hand) === beforePrivate, 'Mão privada e comando da distribuição anterior são ignorados')
      await request()
      const preserved = { seat: state().currentSeat, plays: JSON.stringify(state().trickPlays), pending: JSON.stringify(state().pendingRaise) }
      mesh.membership(['A', 'C', 'D']); await pause(90)
      assert([game('A'), game('C'), game('D')].every((g) => trucoPaused(g.state)), 'Desconexão de B pausa a mesa inteira')
      const pauseStep = state().stepId
      game('C').acceptRaise(); await pause()
      assert(state().stepId === pauseStep, 'Não responde aposta nem joga carta enquanto falta alguém')
      mesh.membership(['A', 'B', 'C', 'D']); await pause(120)
      assert(same() && !trucoPaused(state()) && state().currentSeat === preserved.seat && JSON.stringify(state().pendingRaise) === preserved.pending && JSON.stringify(state().trickPlays) === preserved.plays, 'Reconexão restaura cartas, pedido e vez exatos, sem pular B')
      await accept()
      await complete()
      assert(same(), 'Mão interrompida termina igual para os quatro após a reconexão')
      await fresh()
      mesh.membership(['A', 'B', 'C', 'D', 'E']); await pause(120)
      assert(game('E').state.gameId === state().gameId && game('E').hand.length === 0 && state().players.length === 4, 'Quinta pessoa é espectadora e não recebe cartas ou lugar de outro')
      const spectatorStep = state().stepId
      game('E').callTruco(); await pause()
      assert(state().stepId === spectatorStep && Boolean(game('E').error), 'Espectador não altera o turno ou a aposta')
      mesh.membership(['A', 'B', 'C', 'D']); await pause(90)
      assert(!trucoPaused(state()) && same(), 'Saída do espectador não pausa nem muda a mesa')
      const revision = game('C').state.revision
      mesh.deliver('B', 'C', { type: 'state', state: { ...state(), controllerIdentity: 'B', revision: revision + 100 } })
      mesh.deliver('A', 'D', { type: 'state', state: { ...state(), currentSeat: (state().currentSeat + 1) % 4, revision: revision + 100 } })
      await pause()
      assert(game('C').state.controllerIdentity === 'A' && game('D').state.revision === revision && same(), 'Autoridade falsa e snapshot com ordem inválida são rejeitados')
      const oldMatchId = state().matchId
      await fresh()
      const freshStep = state().stepId
      mesh.deliver('D', 'A', { type: 'command', commandId: crypto.randomUUID(), command: { type: 'reset', matchId: oldMatchId } })
      await pause()
      assert(state().phase === 'playing' && state().stepId === freshStep && same(), 'Encerramento atrasado de outra queda não encerra a partida nova')
      assert(mesh.packets.filter((p) => p.message.type === 'private').every((p) => p.directed && p.to !== 'E'), 'Toda mão privada foi enviada só ao dono, nunca ao espectador')
      assert(mesh.packets.filter((p) => p.message.type === 'state').every((p) => {
        const s = p.message.state as Record<string, unknown>
        return !('hands' in s) && !('deck' in s) && Boolean(parseTrucoState(s))
      }), 'Todos os snapshots publicados são válidos e sem baralho ou mãos alheias')
      mesh.membership(['B', 'C', 'D']); await pause(120)
      assert(latest.current.slice(1, 4).every((g) => g.state.phase === 'lobby' && g.hand.length === 0), 'Saída do distribuidor encerra a mesa sem deixar uma partida fantasma travada')
      setResults((items) => [...items, 'CONCLUÍDO · Todos os testes de rede do Truco passaram.'])
    } catch (cause) { setResults((items) => [...items, `FAIL · ${cause instanceof Error ? cause.message : String(cause)}`]) }
    finally { setRunning(false) }
  }
  return <main style={{ padding: 28, background: '#16221b', color: '#edf1e6', minHeight: '100dvh', font: '14px system-ui' }}>
    <h1>Truco · protocolo real com quatro jogadores</h1>
    <button disabled={running} onClick={() => void run()} type="button">{running ? 'Executando…' : 'Executar testes de rede'}</button>
    <p role="status">{results.filter((r) => r.startsWith('PASS')).length} verificações passaram</p>
    <ol>{results.map((result, index) => <li key={index} style={{ margin: '5px 0', color: result.startsWith('FAIL') ? '#ff9a98' : undefined }}>{result}</li>)}</ol>
    <details><summary>Diagnóstico dos clientes</summary><pre>{JSON.stringify(latest.current.map((g, i) => ({ client: String.fromCharCode(65 + i), state: g.state, hand: g.hand.map((c) => c.id), error: g.error })), null, 2)}</pre></details>
  </main>
}
