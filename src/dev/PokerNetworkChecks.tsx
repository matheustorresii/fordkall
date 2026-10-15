import { useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { POKER_TOPIC, parsePokerState, useRoomPoker } from '../hooks/useRoomPoker'
import { defaultPokerSettings, pokerLegalActions } from '../games/poker'

type Listener = (
  payload: Uint8Array,
  participant?: { identity: string; name: string },
  kind?: unknown,
  topic?: string,
) => void
interface Packet {
  from: string
  to: string
  payload: Uint8Array
  topic: string
}
const decoder = new TextDecoder(),
  encoder = new TextEncoder()
const createMesh = () => {
  const identities = Array.from({ length: 6 }, (_, index) => `p${index}`),
    connected = new Set(identities)
  const listeners = identities.map(() => new Map<string, Set<Listener>>()),
    packets: Packet[] = []
  const deliver = (packet: Packet) =>
    listeners[identities.indexOf(packet.to)]
      ?.get(RoomEvent.DataReceived)
      ?.forEach((listener) =>
        listener(packet.payload, { identity: packet.from, name: packet.from }, undefined, packet.topic),
      )
  const people = identities.map((identity) => ({
    identity,
    name: identity,
    publishData: async (payload: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
      if (!connected.has(identity)) return
      for (const to of identities.filter(
        (id) =>
          id !== identity &&
          connected.has(id) &&
          (!options.destinationIdentities || options.destinationIdentities.includes(id)),
      )) {
        const packet = { from: identity, to, payload: new Uint8Array(payload), topic: options.topic }
        packets.push(packet)
        queueMicrotask(() => deliver(packet))
      }
    },
  }))
  const rooms = people.map(
    (person, index) =>
      ({
        localParticipant: person,
        remoteParticipants: new Map(people.filter((p) => p !== person).map((p) => [p.identity, p])),
        on(event: string, listener: Listener) {
          if (!listeners[index]!.has(event)) listeners[index]!.set(event, new Set())
          listeners[index]!.get(event)!.add(listener)
          return this
        },
        off(event: string, listener: Listener) {
          listeners[index]!.get(event)?.delete(listener)
          return this
        },
      }) as unknown as Room,
  )
  const membership = (keep: string[]) => {
    const removed = [...connected].filter((id) => !keep.includes(id)),
      added = keep.filter((id) => !connected.has(id))
    connected.clear()
    keep.forEach((id) => connected.add(id))
    for (const room of rooms) {
      room.remoteParticipants.clear()
      for (const person of people)
        if (connected.has(person.identity) && person.identity !== room.localParticipant.identity)
          room.remoteParticipants.set(person.identity, person as never)
    }
    rooms.forEach((room, index) => {
      if (connected.has(room.localParticipant.identity)) {
        for (const id of removed)
          listeners[index]!.get(RoomEvent.ParticipantDisconnected)?.forEach((listener) =>
            listener(people.find((p) => p.identity === id) as never),
          )
        for (const id of added)
          listeners[index]!.get(RoomEvent.ParticipantConnected)?.forEach((listener) =>
            listener(people.find((p) => p.identity === id) as never),
          )
      }
    })
  }
  const command = (from: string, value: unknown) =>
    deliver({
      from,
      to: 'p0',
      topic: POKER_TOPIC,
      payload: encoder.encode(JSON.stringify({ type: 'command', commandId: crypto.randomUUID(), command: value })),
    })
  return { rooms, packets, deliver, command, membership }
}
const pause = (ms = 30) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
type Game = ReturnType<typeof useRoomPoker>
export const PokerNetworkChecks = () => {
  const mesh = useMemo(createMesh, [])
  const a = useRoomPoker(mesh.rooms[0]!),
    b = useRoomPoker(mesh.rooms[1]!),
    c = useRoomPoker(mesh.rooms[2]!),
    d = useRoomPoker(mesh.rooms[3]!),
    e = useRoomPoker(mesh.rooms[4]!),
    f = useRoomPoker(mesh.rooms[5]!)
  const latest = useRef<Game[]>([])
  latest.current = [a, b, c, d, e, f]
  const [running, setRunning] = useState(false),
    [results, setResults] = useState<string[]>([])
  const run = async () => {
    if (running) return
    setRunning(true)
    setResults([])
    const game = (index = 0) => latest.current[index]!,
      state = () => game().state
    const assert = (condition: unknown, message: string) => {
      if (!condition) throw new Error(message)
      setResults((items) => [...items, `PASS · ${message}`])
    }
    const current = () => game(Number(state().current.slice(1)))
    const finish = async (allIn = false) => {
      for (let step = 0; step < 100 && state().phase === 'playing'; step++) {
        const legal = pokerLegalActions(state(), state().current)
        current().act({ type: allIn && legal.canAllIn ? 'all-in' : legal.canCheck ? 'check' : 'call' })
        await pause()
      }
      if (state().phase === 'playing') throw new Error('Mesa travada durante as apostas')
    }
    try {
      for (let count = 2; count <= 6; count++) {
        mesh.membership(Array.from({ length: count }, (_, i) => `p${i}`))
        await pause()
        game().reset()
        await pause()
        game(1).start({ ...defaultPokerSettings, turnSeconds: 0 })
        await pause()
        const clients = () => latest.current.slice(0, count)
        assert(
          clients().every(
            (client) =>
              client.state.gameId === state().gameId &&
              client.hand.length === 2 &&
              client.state.players.length === count,
          ),
          `${count} clientes reais sincronizam a mesma mão e recebem duas cartas`,
        )
        assert(
          new Set(clients().flatMap((client) => client.hand)).size === count * 2 &&
            clients().every((client) => !Object.keys(client.state.revealed).length),
          `Privacidade e baralho sem duplicatas em ${count} assentos`,
        )
        const publicPacket = [...mesh.packets]
          .reverse()
          .map((packet) => JSON.parse(decoder.decode(packet.payload)))
          .find((message) => message.type === 'state' && message.state.gameId === state().gameId)
        assert(
          !publicPacket.state.hands && !publicPacket.state.deck && parsePokerState(publicPacket.state) !== null,
          `Estado público da mesa de ${count} não contém baralho nem mãos privadas`,
        )
        const wrong = state().players.find((p) => p.identity !== state().current)!
        game(Number(wrong.identity.slice(1))).act({ type: 'fold' })
        await pause()
        assert(
          Boolean(game(Number(wrong.identity.slice(1))).error) && state().players.every((p) => !p.folded),
          `Ação fora da vez é rejeitada com ${count} pessoas`,
        )
        game(Number(wrong.identity.slice(1))).clearError()
        await finish()
        assert(
          clients().every(
            (client) =>
              JSON.stringify(client.state) === JSON.stringify(state()) &&
              Object.keys(client.state.revealed).length === count,
          ),
          `Showdown, potes e stacks são iguais nos ${count} clientes`,
        )
        assert(
          state().players.reduce((n, p) => n + p.stack, 0) === count * 1000,
          `Conservação de ${count * 1000} fichas após showdown`,
        )
        const oldPrivate = [...mesh.packets]
          .reverse()
          .find((packet) => packet.to === 'p1' && JSON.parse(decoder.decode(packet.payload)).type === 'private')!
        const oldHand = state().gameId,
          oldMatch = state().matchId,
          staleNext = game(1).nextHand
        game().nextHand()
        staleNext()
        await pause()
        assert(
          state().handNumber === 2 && state().gameId !== oldHand && state().matchId === oldMatch,
          `Próxima mão gira o dealer sem duplicar distribuição (${count} pessoas)`,
        )
        const hand = game(1).hand.join()
        mesh.deliver(oldPrivate)
        await pause()
        assert(game(1).hand.join() === hand, `Pacote privado atrasado não troca cartas novas (${count} pessoas)`)
        mesh.command('p1', { type: 'timeout', gameId: state().gameId, turnId: state().turnId })
        await pause()
        assert(
          state().players.every((p) => !p.folded),
          `Um cliente não pode forçar o timeout dos adversários (${count} pessoas)`,
        )
        await finish(true)
        assert(
          clients().every((client) => client.state.phase === state().phase && client.state.board.length === 5) &&
            state().players.reduce((n, p) => n + p.stack, 0) === count * 1000,
          `All-ins fazem o runout e distribuem potes nos ${count} clientes`,
        )
      }
      game().reset()
      await pause()
      game().start({ ...defaultPokerSettings, turnSeconds: 0 })
      await pause()
      const remote = state().players.find((p) => p.identity !== 'p0' && p.identity !== state().current)!
      mesh.membership(
        state()
          .players.filter((p) => p.identity !== remote.identity)
          .map((p) => p.identity),
      )
      await pause()
      assert(
        state().players.find((p) => p.identity === remote.identity)?.folded,
        'Quem sai da call dá fold sem travar a vez atual',
      )
      mesh.membership(state().players.map((p) => p.identity))
      await pause()
      assert(
        !state().players.find((p) => p.identity === remote.identity)?.away &&
          state().players.find((p) => p.identity === remote.identity)?.folded,
        'Reconexão recebe estado e cartas, sem voltar à mão após fold',
      )
      const payload = JSON.parse(JSON.stringify(state()))
      payload.board = ['As', 'As', 'Kd']
      assert(
        parsePokerState(payload) === null && parsePokerState({ ...state(), revealed: { p1: ['As', 'Kh'] } }) === null,
        'Parser rejeita cartas duplicadas e revelação antes do showdown',
      )
      mesh.membership(['p1', 'p2', 'p3', 'p4', 'p5'])
      await pause()
      assert(
        latest.current.slice(1).every((client) => client.state.phase === 'lobby'),
        'Saída do controlador encerra a mesa e não tenta reconstruir um baralho perdido',
      )
      mesh.membership(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
      await pause()
      game().reset()
      await pause()
      game().start({ ...defaultPokerSettings, turnSeconds: 30 })
      await pause()
      const timedIdentity = state().current,
        timedTurn = state().turnId
      setResults((items) => [...items, 'PASS · Aguardando um timeout real de 30 segundos'])
      await pause(30200)
      assert(
        state().turnId !== timedTurn && state().players.find((p) => p.identity === timedIdentity)?.folded,
        'Relógio real dá fold após 30 segundos e avança a vez para todos',
      )
      game().reset()
      await pause()
      setResults((items) => [...items, 'PASS · Integração do poker concluída'])
    } catch (error) {
      setResults((items) => [...items, `FAIL · ${error instanceof Error ? error.message : String(error)}`])
    } finally {
      setRunning(false)
    }
  }
  return (
    <section
      style={{
        height: '100%',
        overflow: 'auto',
        padding: '70px 28px 100px',
        background: '#202733',
        color: '#edf4f8',
        font: '14px system-ui',
      }}
    >
      <h1>Integração do Poker</h1>
      <p>Seis hooks reais, transporte confiável em memória. Não usa contas nem fichas de produção.</p>
      <button className="game-action game-action--primary" disabled={running} onClick={() => void run()} type="button">
        {running ? 'Testando…' : 'Executar verificações do poker'}
      </button>
      <ol aria-live="polite" style={{ display: 'grid', gap: 10 }}>
        {results.map((result, index) => (
          <li key={index}>{result}</li>
        ))}
      </ol>
      <p>
        {running
          ? 'Testes em andamento…'
          : `${results.filter((r) => r.startsWith('PASS')).length} verificações passaram.`}
      </p>
    </section>
  )
}
