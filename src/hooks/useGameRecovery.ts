import { useEffect, useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { supabase, isSupabaseConfigured } from '../services/supabase'
import {
  GameRecoveryCoordinator,
  type RecoveryBinding,
  type RecoverableState,
} from '../games/recovery'

interface Hub {
  coordinator: GameRecoveryCoordinator
  refs: number
  stop?: () => void
  people: Map<string, { identity: string; name?: string; metadata?: string }>
}
const hubs = new WeakMap<Room, Hub>()
const previewRooms = new WeakSet<Room>()
export const recoveryEnabled = (room: Room) =>
  (isSupabaseConfigured || (import.meta.env.DEV && previewRooms.has(room))) &&
  Boolean(room.name) &&
  /^[0-9a-f-]{36}$/i.test(room.localParticipant.identity)
export function installRecoveryPreview(
  room: Room,
  rpc: import('../games/recovery').GameRecoveryRpc,
  now: () => number,
) {
  if (!import.meta.env.DEV) throw Error('PREVIEW_UNAVAILABLE')
  previewRooms.add(room)
  hubs.set(room, {
    refs: 0,
    people: new Map(),
    coordinator: new GameRecoveryCoordinator(
      room.name,
      room.localParticipant.identity,
      rpc,
      () => [room.localParticipant.identity, ...room.remoteParticipants.keys()],
      now,
    ),
  })
}
export function roomRecoveryHub(room: Room) {
  let hub = hubs.get(room)
  if (!hub) {
    hub = {
      refs: 0,
      people: new Map(),
      coordinator: new GameRecoveryCoordinator(
        room.name,
        room.localParticipant.identity,
        async (name, args) => {
          const { data, error } = await supabase.rpc(name, args)
          if (error) throw error
          return data
        },
        () => [
          room.localParticipant.identity,
          ...room.remoteParticipants.keys(),
        ],
      ),
    }
    hubs.set(room, hub)
  }
  return hub
}
function startHub(room: Room, hub: Hub) {
  if (hub.stop) return
  let running = false,
    stopped = false
  const remember = () => {
    for (const person of [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ])
      hub.people.set(person.identity, person)
  }
  const roster = () => {
    remember()
    hub.coordinator.rosterChanged()
  }
  const tick = async () => {
    if (running || stopped) return
    running = true
    try {
      await hub.coordinator.heartbeat()
    } finally {
      running = false
    }
  }
  const resume = () => {
    void hub.coordinator.refresh().then(tick)
  }
  remember()
  room.on(RoomEvent.ParticipantConnected, roster)
  room.on(RoomEvent.ParticipantDisconnected, roster)
  room.on(RoomEvent.Reconnected, resume)
  window.addEventListener('online', resume)
  window.addEventListener('focus', resume)
  const timer = window.setInterval(tick, 8000)
  void hub.coordinator.refresh()
  hub.stop = () => {
    stopped = true
    window.clearInterval(timer)
    room.off(RoomEvent.ParticipantConnected, roster)
    room.off(RoomEvent.ParticipantDisconnected, roster)
    room.off(RoomEvent.Reconnected, resume)
    window.removeEventListener('online', resume)
    window.removeEventListener('focus', resume)
    hub.stop = undefined
  }
}
export function recoverableGameMembers(room: Room, kind?: string) {
  const connected = [room.localParticipant, ...room.remoteParticipants.values()]
  if (!recoveryEnabled(room)) return connected
  const hub = roomRecoveryHub(room),
    ids = new Set(connected.map((p) => p.identity))
  const names: Record<string, string> = {
    kiwi: 'exploding-kiwi',
    truco: 'truco-mineiro',
    mind: 'the-mind',
  }
  const state = kind
    ? [...hub.coordinator.bindings]
        .find(([topic]) =>
          topic.startsWith(`ford-kall.${names[kind] || kind}.`),
        )?.[1]
        .capture().state
    : undefined
  const eligible = !kind
    ? null
    : new Set(
        state?.gameId
          ? state.players?.map((player) => player.identity) || []
          : [],
      )
  return [
    ...connected,
    ...[...hub.people.values()].filter(
      (person) =>
        !ids.has(person.identity) &&
        (!eligible || eligible.has(person.identity)) &&
        hub.coordinator.hasGrace(person.identity),
    ),
  ]
}
export function useGameRecovery(
  room: Room,
  topic: string,
  binding: Omit<RecoveryBinding, 'changed'>,
) {
  const enabled = recoveryEnabled(room)
  const hub = useMemo(
    () => (enabled ? roomRecoveryHub(room) : null),
    [room, enabled],
  )
  const latest = useRef(binding)
  latest.current = binding
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!hub) return
    const unsubscribe = hub.coordinator.bind(topic, {
      capture: () => latest.current.capture(),
      restore: (...args) => latest.current.restore(...args),
      ownPrivate: (value) => latest.current.ownPrivate(value),
      committed: (...args) => latest.current.committed(...args),
      changed: () => setRevision((value) => value + 1),
    })
    hub.refs++
    startHub(room, hub)
    return () => {
      unsubscribe()
      if (--hub.refs === 0) hub.stop?.()
    }
  }, [hub, room, topic])
  return useMemo(
    () => ({
      enabled,
      coordinator: hub?.coordinator,
      revision,
      paused: () => Boolean(hub?.coordinator.paused(topic)),
      ready: () => !hub || hub.coordinator.ready,
      controller: (fallback: string) =>
        hub?.coordinator.authority(topic, fallback) || fallback,
      epoch: () => hub?.coordinator.epoch(topic) || 0,
      transact: (action: () => string | null, allowPaused = false) =>
        hub
          ? hub.coordinator.transact(topic, action, false, allowPaused)
          : Promise.resolve(action()),
      accepts: async (identity: string, epoch: number | undefined) => {
        if (!hub) return true
        if (!hub.coordinator.accepts(topic, identity, epoch))
          await hub.coordinator.refresh()
        return hub.coordinator.accepts(topic, identity, epoch)
      },
    }),
    [enabled, hub, topic, revision],
  )
}
export function seedRecoveringPlayers(room: Room, state: RecoverableState) {
  if (!recoveryEnabled(room)) return
  const hub = roomRecoveryHub(room)
  for (const player of state.players || [])
    if (!hub.people.has(player.identity))
      hub.people.set(player.identity, {
        identity: player.identity,
        name: player.name,
      })
}
