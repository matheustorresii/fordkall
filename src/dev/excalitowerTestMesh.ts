import { RoomEvent, type Room } from 'livekit-client'
import type { BoardDelta } from '../whiteboard/replica'
import { BOARD_CONTROL_TOPIC, BOARD_SCENE_TOPIC } from '../whiteboard/session'

type Listener = (...args: unknown[]) => void
type StreamHandler = Parameters<Room['registerTextStreamHandler']>[1]
export const createExcalitowerTestMesh = () => {
  const ids = ['alice', 'bia'], names = ['Alice', 'Bia']
  const listeners = ids.map(() => new Map<string, Set<Listener>>())
  const handlers = ids.map(() => new Map<string, StreamHandler>())
  let connected = true
  let packetCount = 0
  const people = ids.map((identity, i) => ({
    identity, name: names[i]!,
    publishData: async (data: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
      if (data.byteLength > 2_048) throw new Error('Control packet too large')
      if (!connected) throw new Error('Offline')
      if (options.topic !== BOARD_CONTROL_TOPIC) throw new Error('Wrong topic')
      packetCount++
      const to = 1 - i
      if (options.destinationIdentities && !options.destinationIdentities.includes(ids[to]!)) return
      await Promise.resolve()
      listeners[to]?.get(RoomEvent.DataReceived)?.forEach((fn) => fn(data.slice(), { identity }, undefined, options.topic))
    },
    sendText: async (text: string, options: { topic: string; destinationIdentities?: string[] }) => {
      if (!connected) throw new Error('Offline')
      if (options.topic !== BOARD_SCENE_TOPIC) throw new Error('Wrong stream topic')
      const to = 1 - i
      if (options.destinationIdentities && !options.destinationIdentities.includes(ids[to]!)) return { id: crypto.randomUUID() }
      packetCount++
      const reader = {
        info: { id: crypto.randomUUID(), size: new TextEncoder().encode(text).length },
        withAbortSignal() { return this },
        async *[Symbol.asyncIterator]() {
          for (let n = 0; n < text.length; n += 8_000) { await Promise.resolve(); yield text.slice(n, n + 8_000) }
        },
      }
      handlers[to]?.get(options.topic)?.(reader as never, { identity })
      return reader.info
    },
  }))
  const rooms = people.map((person, i) => ({
    localParticipant: person,
    remoteParticipants: new Map([[ids[1 - i]!, people[1 - i]!]]),
    on(event: string, listener: Listener) { if (!listeners[i]!.has(event)) listeners[i]!.set(event, new Set()); listeners[i]!.get(event)!.add(listener); return this },
    off(event: string, listener: Listener) { listeners[i]!.get(event)?.delete(listener); return this },
    registerTextStreamHandler(topic: string, handler: StreamHandler) { handlers[i]!.set(topic, handler) },
    unregisterTextStreamHandler(topic: string) { handlers[i]!.delete(topic) },
  })) as unknown as Room[]
  return {
    rooms,
    packets: () => packetCount,
    reconnect() { connected = true; listeners.forEach((map) => map.get(RoomEvent.Reconnected)?.forEach((fn) => fn())) },
    disconnect() { connected = false },
    inject(from: number, data: BoardDelta) { void people[from]!.sendText(JSON.stringify(data), { topic: BOARD_SCENE_TOPIC }) },
  }
}
