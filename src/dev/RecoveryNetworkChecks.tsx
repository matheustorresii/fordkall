import { useEffect, useMemo, useRef, useState } from 'react'
import type { Room } from 'livekit-client'
import { createGameTestMesh } from './gameTestMesh'
import {
  installRecoveryPreview,
  roomRecoveryHub,
} from '../hooks/useGameRecovery'
import { useRoomPoker, POKER_TOPIC } from '../hooks/useRoomPoker'
import { useRoomCoup } from '../hooks/useRoomCoup'
import { useRoomExplodingKiwi, KIWI_TOPIC } from '../hooks/useRoomExplodingKiwi'
import { useRoomGameParticipation } from '../hooks/useRoomGameParticipation'
import { GameRecoveryStatus } from '../components/Games/GameRecoveryStatus'
import type { CheckpointRecord } from '../games/recovery'
type Probe = {
  poker: ReturnType<typeof useRoomPoker>
  coup: ReturnType<typeof useRoomCoup>
  kiwi: ReturnType<typeof useRoomExplodingKiwi>
}
const ids = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
]
const Child = ({
  room,
  report,
}: {
  room: Room
  report: (probe: Probe) => void
}) => {
  const participation = useRoomGameParticipation(room),
    poker = useRoomPoker(room, participation),
    coup = useRoomCoup(room, participation),
    kiwi = useRoomExplodingKiwi(room, participation)
  report({ poker, coup, kiwi })
  return (
    <div style={{ padding: 12, background: '#202838', borderRadius: 12 }}>
      <strong>{room.localParticipant.name}</strong>
      <p>
        Poker: {poker.state.phase} · {poker.state.revision} ·{' '}
        {poker.hand.join(' ')}
      </p>
      <p>
        Coup: {coup.state.phase} · {coup.hand.length} cartas
      </p>
      <p>
        Kiwi: {kiwi.state.phase} · {kiwi.hand.length} cartas
      </p>
      <GameRecoveryStatus room={room} />
    </div>
  )
}
export function RecoveryNetworkChecks() {
  const mesh = useMemo(
    () => createGameTestMesh('*', 3, { ids, roomName: 'QA-RECOVERY' }),
    [],
  )
  const clock = useRef(Date.now()),
    fail = useRef(false)
  const server = useRef(
    new Map<string, CheckpointRecord & { session: string }>(),
  )
  const views = useRef(new Map<string, Probe>())
  const [rooms, setRooms] = useState(() =>
    mesh.rooms.map((room) => ({ room, generation: 0 })),
  )
  const [mounted, setMounted] = useState([...ids]),
    [results, setResults] = useState<string[]>([]),
    [running, setRunning] = useState(false)
  const rpc =
    (identity: string) =>
    async (name: string, args: Record<string, unknown>) => {
      await new Promise((resolve) => window.setTimeout(resolve, 8))
      const key = String(args.p_topic),
        records = server.current,
        row = records.get(key),
        now = clock.current
      const view = (row: CheckpointRecord & { session: string }) => ({
        ...structuredClone(row),
        owns: row.owner === identity && row.session === args.p_session,
        payload:
          row.owner === identity && row.session === args.p_session
            ? structuredClone(row.payload)
            : null,
        ownPrivate: structuredClone(row.payload?.secrets?.[identity]),
      })
      if (name === 'list_game_checkpoints')
        return [...records.values()].map(view)
      if (name === 'claim_game_checkpoint') {
        let next = row
        if (!next) {
          next = {
            topic: key,
            owner: identity,
            session: String(args.p_session),
            owns: true,
            epoch: 1,
            revision: -1,
            state: null,
            savedAt: new Date(now).toISOString(),
            heartbeatAt: new Date(now).toISOString(),
            leaseUntil: new Date(now + 20000).toISOString(),
            payload: { secrets: {}, authority: null },
          }
          records.set(key, next)
        }
        const previousHeartbeatAt = next.heartbeatAt
        if (
          next.session === args.p_session ||
          Date.parse(next.leaseUntil) <= now
        ) {
          if (next.session !== args.p_session) next.epoch++
          next.owner = identity
          next.session = String(args.p_session)
          next.leaseUntil = new Date(now + 20000).toISOString()
          next.heartbeatAt = new Date(now).toISOString()
        }
        return { ...view(next), previousHeartbeatAt }
      }
      if (name === 'save_game_checkpoint') {
        if (fail.current) throw Error('TEST_NETWORK_FAILURE')
        if (
          !row ||
          row.owner !== identity ||
          row.session !== args.p_session ||
          row.epoch !== args.p_epoch ||
          Date.parse(row.leaseUntil) <= now ||
          Number((args.p_state as { revision: number }).revision) <=
            row.revision
        )
          throw Error('GAME_LEASE_LOST')
        row.state = structuredClone(args.p_state) as CheckpointRecord['state']
        row.payload = structuredClone(
          args.p_private,
        ) as CheckpointRecord['payload']
        row.revision = row.state!.revision
        row.savedAt = new Date(now).toISOString()
        row.leaseUntil = new Date(now + 20000).toISOString()
        row.heartbeatAt = new Date(now).toISOString()
        return { savedAt: row.savedAt, leaseUntil: row.leaseUntil }
      }
      if (name === 'renew_game_checkpoints')
        return [...records.values()]
          .filter(
            (row) =>
              row.owner === identity &&
              row.session === args.p_session &&
              Date.parse(row.leaseUntil) > now,
          )
          .map((row) => {
            row.leaseUntil = new Date(now + 20000).toISOString()
            row.heartbeatAt = new Date(now).toISOString()
            return { topic: row.topic, leaseUntil: row.leaseUntil }
          })
      throw Error(name)
    }
  useMemo(() => {
    mesh.rooms.forEach((room) =>
      installRecoveryPreview(
        room,
        rpc(room.localParticipant.identity),
        () => clock.current,
      ),
    )
  }, [mesh])
  const wait = async (predicate: () => boolean, label: string) => {
    const started = Date.now()
    while (!predicate()) {
      if (Date.now() - started > 12000) throw Error(`TIMEOUT: ${label}`)
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    }
  }
  const check = (condition: unknown, label: string) => {
    if (!condition) throw Error(label)
    setResults((previous) => [...previous, `PASS · ${label}`])
  }
  const run = async () => {
    if (running) return
    setRunning(true)
    setResults([])
    try {
      await wait(
        () =>
          views.current.size === 3 &&
          mesh.rooms.every((room) => roomRecoveryHub(room).coordinator.ready),
        'bootstrap',
      )
      views.current.get(ids[0]!)!.poker.start()
      await wait(
        () => ids.every((id) => views.current.get(id)?.poker.hand.length === 2),
        'private hands',
      )
      const before = new Map(
        ids.map((id) => [id, views.current.get(id)!.poker.hand.join(',')]),
      )
      const state = views.current.get(ids[0]!)!.poker.state,
        chips = state.players.reduce(
          (sum, player) => sum + player.stack + player.committed,
          0,
        )
      check(
        chips === 3000,
        'Três clientes reais receberam mãos privadas e 3.000 fichas',
      )
      setMounted(ids.slice(1))
      views.current.delete(ids[0]!)
      mesh.membership(ids.slice(1))
      await new Promise((resolve) => window.setTimeout(resolve, 80))
      clock.current += 21000
      await roomRecoveryHub(mesh.rooms[1]!).coordinator.heartbeat()
      await wait(
        () =>
          views.current.get(ids[1]!)?.poker.state.controllerIdentity === ids[1],
        'takeover',
      )
      check(
        views.current.get(ids[1]!)!.poker.hand.join(',') ===
          before.get(ids[1]!),
        'Troca de controlador não distribui cartas novas',
      )
      const replacement = { ...mesh.rooms[0]! } as Room
      installRecoveryPreview(replacement, rpc(ids[0]!), () => clock.current)
      setRooms((previous) =>
        previous.map((entry, index) =>
          index
            ? entry
            : { room: replacement, generation: entry.generation + 1 },
        ),
      )
      mesh.membership(ids)
      setMounted([...ids])
      await wait(
        () =>
          views.current.get(ids[0]!)?.poker.state.gameId === state.gameId &&
          views.current.get(ids[0]!)?.poker.hand.join(',') ===
            before.get(ids[0]!),
        'returning player',
      )
      await roomRecoveryHub(mesh.rooms[1]!).coordinator.heartbeat()
      await wait(
        () =>
          ids.every(
            (id) =>
              views.current.get(id)?.poker.hand.join(',') === before.get(id),
          ),
        'all private hands restored',
      )
      check(
        ids.every(
          (id) =>
            views.current.get(id)!.poker.hand.join(',') === before.get(id),
        ),
        'Reload preserva todas as mãos, inclusive a do antigo controlador',
      )
      const active = views.current.get(ids[1]!)!.poker.state
      const actor = active.players.find(
        (player) => player.identity === active.current,
      )!
      views.current
        .get(actor.identity)!
        .poker.act({ type: actor.bet >= active.currentBet ? 'check' : 'call' })
      await wait(
        () =>
          views.current.get(ids[1]!)!.poker.state.revision > active.revision,
        'continue action',
      )
      check(
        views.current
          .get(ids[1]!)!
          .poker.state.players.reduce(
            (sum, player) => sum + player.stack + player.committed,
            0,
          ) === chips,
        'A partida continua com fichas conservadas após a reconexão',
      )
      const revision = views.current.get(ids[1]!)!.poker.state.revision
      mesh.deliver(
        ids[0]!,
        ids[1]!,
        { type: 'state', epoch: 1, state: { ...state, revision: 99999 } },
        `${POKER_TOPIC}.recovery.v1`,
      )
      await new Promise((resolve) => window.setTimeout(resolve, 100))
      check(
        views.current.get(ids[1]!)!.poker.state.revision === revision,
        'Pacote atrasado do controlador antigo foi rejeitado',
      )
      check(
        mesh.packets
          .filter((packet) => !packet.directed)
          .every(
            (packet) =>
              !('authority' in packet.message) &&
              !('secrets' in packet.message),
          ),
        'Nenhum baralho/backup privado passou por broadcast',
      )
      views.current.get(ids[0]!)!.poker.reset()
      await wait(
        () =>
          ids.every(
            (id) => views.current.get(id)?.poker.state.phase === 'lobby',
          ),
        'reset poker',
      )
      for (const kind of ['coup', 'kiwi'] as const) {
        if (kind === 'coup') views.current.get(ids[0]!)!.coup.start()
        else views.current.get(ids[0]!)!.kiwi.start()
        await wait(
          () =>
            ids.every(
              (id) =>
                views.current.get(id)?.[kind].hand.length ===
                (kind === 'coup' ? 2 : 8),
            ),
          `${kind} deal`,
        )
        const gameId = views.current.get(ids[0]!)![kind].state.gameId
        const originalHands = new Map(
          ids.map((id) => [
            id,
            JSON.stringify(views.current.get(id)![kind].hand),
          ]),
        )
        const deck =
          kind === 'kiwi'
            ? JSON.stringify(
                (
                  server.current.get(KIWI_TOPIC)?.payload?.authority as {
                    deck: unknown
                  }
                ).deck,
              )
            : ''
        setMounted(ids.slice(1))
        views.current.delete(ids[0]!)
        mesh.membership(ids.slice(1))
        await new Promise((resolve) => window.setTimeout(resolve, 80))
        clock.current += 21000
        await roomRecoveryHub(mesh.rooms[1]!).coordinator.heartbeat()
        await wait(
          () =>
            views.current.get(ids[1]!)?.[kind].state.controllerIdentity ===
            ids[1],
          `${kind} takeover`,
        )
        const reload = { ...mesh.rooms[0]! } as Room
        installRecoveryPreview(reload, rpc(ids[0]!), () => clock.current)
        setRooms((previous) =>
          previous.map((entry, index) =>
            index ? entry : { room: reload, generation: entry.generation + 1 },
          ),
        )
        mesh.membership(ids)
        setMounted([...ids])
        await wait(
          () => views.current.get(ids[0]!)?.[kind].state.gameId === gameId,
          `${kind} reload`,
        )
        await roomRecoveryHub(mesh.rooms[1]!).coordinator.heartbeat()
        await wait(
          () =>
            ids.every(
              (id) =>
                JSON.stringify(views.current.get(id)?.[kind].hand) ===
                originalHands.get(id),
            ),
          `${kind} private hands`,
        )
        check(
          true,
          `${kind === 'coup' ? 'Coup' : 'Exploding Kiwi'} retomou a mesma partida e as mesmas cartas após perder o controlador`,
        )
        if (kind === 'kiwi')
          check(
            JSON.stringify(
              (
                server.current.get(KIWI_TOPIC)?.payload?.authority as {
                  deck: unknown
                }
              ).deck,
            ) === deck,
            'O monte secreto do Kiwi manteve a mesma ordem',
          )
        views.current.get(ids[0]!)![kind].reset()
        await wait(
          () =>
            ids.every(
              (id) => views.current.get(id)?.[kind].state.phase === 'lobby',
            ),
          `${kind} reset`,
        )
      }
      setResults((previous) => [...previous, 'DONE · TODOS OS TESTES PASSARAM'])
    } catch (cause) {
      setResults((previous) => [
        ...previous,
        `FAIL · ${cause instanceof Error ? cause.message : String(cause)}`,
      ])
    } finally {
      setRunning(false)
    }
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).has('autorun')) {
      const timer = window.setTimeout(run, 500)
      return () => clearTimeout(timer)
    }
  }, [])
  return (
    <main
      style={{
        padding: 32,
        color: '#e9effa',
        background: '#171d29',
        minHeight: '100vh',
        font: '14px system-ui',
      }}
    >
      <h1>Recuperação · hooks reais + servidor simulado</h1>
      <p>Sem conta, microfone ou conexão com produção.</p>
      <button onClick={() => void run()} disabled={running} type="button">
        {running ? 'Verificando…' : 'Executar verificações'}
      </button>
      <pre aria-live="polite" style={{ whiteSpace: 'pre-wrap', padding: 16 }}>
        {results.join('\n')}
      </pre>
      <div style={{ display: 'grid', gap: 12 }}>
        {rooms.map(
          ({ room, generation }) =>
            mounted.includes(room.localParticipant.identity) && (
              <Child
                key={`${room.localParticipant.identity}:${generation}`}
                room={room}
                report={(probe) =>
                  views.current.set(room.localParticipant.identity, probe)
                }
              />
            ),
        )}
      </div>
    </main>
  )
}
