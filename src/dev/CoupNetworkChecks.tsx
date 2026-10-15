import { useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { COUP_TOPIC, useRoomCoup } from '../hooks/useRoomCoup'
import { coupActions, coupResponders, defaultCoupSettings } from '../games/coup'
import type { CoupMove } from '../games/coup'
import { parseCoupState } from '../games/coupWire'

type Listener = (...args: unknown[]) => void
const encoder = new TextEncoder(),
  decoder = new TextDecoder()
const createMesh = () => {
  const ids = Array.from({ length: 6 }, (_, i) => `p${i}`),
    connected = new Set(ids)
  const listeners = ids.map(() => new Map<string, Set<Listener>>())
  const packets: Array<{ from: string; to: string; message: Record<string, unknown>; directed: boolean }> = []
  const deliver = (from: string, to: string, message: unknown) =>
    listeners[ids.indexOf(to)]
      ?.get(RoomEvent.DataReceived)
      ?.forEach((fn) =>
        fn(encoder.encode(JSON.stringify(message)), { identity: from, name: from }, undefined, COUP_TOPIC),
      )
  const people = ids.map((identity) => ({
    identity,
    name: identity,
    publishData: async (
      payload: Uint8Array,
      options: { topic: string; destinationIdentities?: string[] },
    ) => {
      if (!connected.has(identity) || options.topic !== COUP_TOPIC) return
      for (const to of ids.filter(
        (id) =>
          id !== identity &&
          connected.has(id) &&
          (!options.destinationIdentities || options.destinationIdentities.includes(id)),
      )) {
        const message = JSON.parse(decoder.decode(payload))
        packets.push({ from: identity, to, message, directed: Boolean(options.destinationIdentities) })
        window.setTimeout(() => deliver(identity, to, message), 5)
      }
    },
  }))
  const rooms = people.map(
    (p, i) =>
      ({
        localParticipant: p,
        remoteParticipants: new Map(
          people.filter((other) => other !== p).map((other) => [other.identity, other]),
        ),
        on(event: string, fn: Listener) {
          if (!listeners[i]!.has(event)) listeners[i]!.set(event, new Set())
          listeners[i]!.get(event)!.add(fn)
          return this
        },
        off(event: string, fn: Listener) {
          listeners[i]!.get(event)?.delete(fn)
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
    rooms.forEach((room, i) => {
      if (!connected.has(room.localParticipant.identity)) return
      for (const id of removed)
        listeners[i]!.get(RoomEvent.ParticipantDisconnected)?.forEach((fn) =>
          fn(people.find((p) => p.identity === id)),
        )
      for (const id of added)
        listeners[i]!.get(RoomEvent.ParticipantConnected)?.forEach((fn) =>
          fn(people.find((p) => p.identity === id)),
        )
    })
  }
  return { rooms, packets, membership, deliver }
}
type Game = ReturnType<typeof useRoomCoup>
const pause = (ms = 75) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
export const CoupNetworkChecks = () => {
  const mesh = useMemo(createMesh, [])
  const a = useRoomCoup(mesh.rooms[0]!),
    b = useRoomCoup(mesh.rooms[1]!),
    c = useRoomCoup(mesh.rooms[2]!),
    d = useRoomCoup(mesh.rooms[3]!),
    e = useRoomCoup(mesh.rooms[4]!),
    f = useRoomCoup(mesh.rooms[5]!)
  const latest = useRef<Game[]>([])
  latest.current = [a, b, c, d, e, f]
  const [results, setResults] = useState<string[]>([]),
    [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    setResults([])
    const game = (identity = 'p0') => latest.current[Number(identity.slice(1))]!,
      state = () => game().state
    const assert = (ok: unknown, label: string) => {
      if (!ok) throw new Error(label)
      setResults((items) => [...items, `PASS · ${label}`])
    }
    const move = async (id: string, command: CoupMove) => {
      game(id).move(command)
      await pause()
    }
    const accept = async () => {
      const step = state().stepId
      for (const id of coupResponders(state())) {
        if (step !== state().stepId) break
        await move(id, { type: 'pass' })
      }
    }
    try {
      for (let count = 2; count <= 6; count++) {
        mesh.membership(Array.from({ length: count }, (_, i) => `p${i}`))
        await pause()
        game().reset()
        await pause()
        game('p1').start({ ...defaultCoupSettings, responseSeconds: 0 })
        await pause(125)
        const clients = () => latest.current.slice(0, count)
        assert(
          clients().every(
            (g) =>
              g.state.gameId === state().gameId && g.hand.length === 2 && g.state.players.length === count,
          ),
          `${count} clientes sincronizam a mesma partida e recebem suas duas influências`,
        )
        assert(
          new Set(clients().flatMap((g) => g.hand.map((c) => c.id))).size === count * 2,
          `${count} mãos privadas não têm cartas duplicadas`,
        )
        const wrong = state().players.find((p) => p.identity !== state().current)!.identity
        const before = state().stepId
        await move(wrong, { type: 'act', action: 'income' })
        assert(
          Boolean(game(wrong).error) && state().stepId === before,
          `Fora da vez não altera a partida de ${count}`,
        )
        const current = state().current
        await move(current, { type: 'act', action: 'exchange' })
        await accept()
        assert(
          state().phase === 'exchange' &&
            clients().every((g, i) => g.exchange.length === (`p${i}` === current ? 2 : 0)),
          `Troca de ${count}: somente o Embaixador recebe as duas cartas novas`,
        )
        await move(current, { type: 'exchange', keep: game(current).hand.map((c) => c.id) })
        assert(state().phase === 'turn', `Troca privada conclui e avança a vez em ${count}`)
        // Duplicate/stale commands carry a decision ID, so they can never spend/earn twice.
        if (state().current === 'p0') await move('p0', { type: 'act', action: 'income' })
        const actor = state().current,
          oldStep = state().stepId
        await move(actor, { type: 'act', action: 'income' })
        const coins = state().players.find((p) => p.identity === actor)!.coins
        mesh.deliver(actor, 'p0', {
          type: 'command',
          commandId: crypto.randomUUID(),
          command: {
            type: 'move',
            gameId: state().gameId,
            stepId: oldStep,
            move: { type: 'act', action: 'income' },
          },
        })
        await pause()
        assert(
          state().players.find((p) => p.identity === actor)!.coins === coins,
          `Comando atrasado/duplicado não repete moedas em ${count}`,
        )
        for (let step = 0; state().phase !== 'finished' && step < 300; step++) {
          const s = state(),
            p = s.pending
          if (s.phase === 'turn') {
            const who = s.players.find((p) => p.identity === s.current)!,
              target = s.players.find((p) => p.influence && p.identity !== who.identity)!
            await move(
              who.identity,
              who.coins >= 7
                ? { type: 'act', action: 'coup', target: target.identity }
                : { type: 'act', action: 'tax' },
            )
          } else if (['action-response', 'block-response', 'block-challenge'].includes(s.phase))
            await accept()
          else if (s.phase === 'lose-influence')
            await move(s.loss!.identity, { type: 'lose', cardId: game(s.loss!.identity).hand[0]!.id })
          else if (s.phase === 'proof' && p) {
            const id = p.claim === 'block' ? p.blocker : p.actor,
              role = p.claim === 'block' ? p.blockRole : coupActions[p.action].role
            const card = game(id).hand.find((c) => c.role === role)
            await move(id, card ? { type: 'prove', cardId: card.id } : { type: 'concede' })
          } else throw new Error(`Etapa inesperada: ${s.phase}`)
        }
        assert(
          state().phase === 'finished' && clients().every((g) => g.state.winner === state().winner),
          `Partida completa de ${count} chega ao mesmo vencedor em todos os clientes`,
        )
        assert(
          clients().every(
            (g, i) => g.hand.length === state().players.find((p) => p.identity === `p${i}`)!.influence,
          ),
          `Mãos privadas acompanham eliminações em ${count}`,
        )
      }
      assert(
        mesh.packets.filter((p) => p.message.type === 'private').every((p) => p.directed),
        'Toda entrega de cartas usa destino privado',
      )
      assert(
        mesh.packets
          .filter((p) => p.message.type === 'state')
          .every((p) => {
            const raw = p.message.state as Record<string, unknown>
            return (
              !('hands' in raw) && !('deck' in raw) && !('exchange' in raw) && Boolean(parseCoupState(raw))
            )
          }),
        'Nenhum snapshot público contém mãos, corte ou cartas de troca',
      )
      const revision = game('p2').state.revision
      mesh.deliver('p1', 'p2', {
        type: 'state',
        state: { ...state(), controllerIdentity: 'p1', revision: revision + 100 },
      })
      await pause()
      assert(game('p2').state.controllerIdentity === 'p0', 'Um jogador não pode se passar pelo distribuidor')
      game().reset()
      await pause()
      game().start({ responseSeconds: 0 })
      await pause()
      mesh.membership(['p1', 'p2', 'p3', 'p4', 'p5'])
      await pause(150)
      assert(
        latest.current.slice(1).every((g) => g.state.phase === 'lobby' && !g.hand.length),
        'Saída do distribuidor encerra sem repassar cartas privadas',
      )
      setResults((items) => [...items, 'COMPLETE · Integração Coup aprovada'])
    } catch (cause) {
      setResults((items) => [...items, `FAIL · ${cause instanceof Error ? cause.message : cause}`])
    } finally {
      setRunning(false)
    }
  }
  return (
    <main
      style={{
        padding: 28,
        color: '#e6eaf0',
        background: '#182233',
        font: '14px system-ui',
        minHeight: '100vh',
      }}
    >
      <h1>Coup · validação multiplayer</h1>
      <p>Hooks reais, seis clientes isolados, transporte simulado com atraso. Sem conta ou microfone.</p>
      <button disabled={running} onClick={() => void run()} type="button">
        {running ? 'Testando…' : 'Executar testes Coup'}
      </button>
      <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{results.join('\n')}</pre>
    </main>
  )
}
