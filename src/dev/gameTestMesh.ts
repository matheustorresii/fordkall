import { RoomEvent, type Room } from 'livekit-client'
type Listener = (...args: unknown[]) => void
export const createGameTestMesh = (topic: string, count = 12) => {
  const ids = Array.from({ length: count }, (_, i) => `p${i}`),
    connected = new Set(ids)
  const listeners = ids.map(() => new Map<string, Set<Listener>>())
  const packets: Array<{ from: string; to: string; message: Record<string, unknown>; directed: boolean }> = []
  const encoder = new TextEncoder(),
    decoder = new TextDecoder()
  const deliver = (from: string, to: string, message: unknown) => {
    if (!connected.has(to) || !connected.has(from)) return
    listeners[ids.indexOf(to)]
      ?.get(RoomEvent.DataReceived)
      ?.forEach((fn) =>
        fn(encoder.encode(JSON.stringify(message)), { identity: from, name: from }, undefined, topic),
      )
  }
  const people = ids.map((identity) => ({
    identity,
    name: identity,
    publishData: async (data: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
      if (data.byteLength > 15 * 1024) throw new Error('O pacote excede o limite recomendado do LiveKit.')
      if (!connected.has(identity) || options.topic !== topic) return
      for (const to of ids.filter(
        (id) =>
          id !== identity &&
          connected.has(id) &&
          (!options.destinationIdentities || options.destinationIdentities.includes(id)),
      )) {
        const message = JSON.parse(decoder.decode(data))
        packets.push({ from: identity, to, message, directed: Boolean(options.destinationIdentities) })
        window.setTimeout(() => deliver(identity, to, message), 3)
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
