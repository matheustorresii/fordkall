import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { RoomEvent, type Room, type RemoteParticipant } from 'livekit-client'
import { BOARD_CONTROL_TOPIC, BOARD_SCENE_TOPIC, ExcalitowerSession } from '../whiteboard/session'
import { MAX_BOARD_MESSAGE_BYTES } from '../whiteboard/replica'

export const useRoomExcalitower = (room: Room) => {
  const session = useMemo(() => new ExcalitowerSession({
    identity: room.localParticipant.identity,
    peers: () => [...room.remoteParticipants.keys()],
    control: (message, to, reliable = true) => room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), {
      topic: BOARD_CONTROL_TOPIC, reliable, ...(to ? { destinationIdentities: [to] } : {}),
    }),
    // LiveKit streams handle chunking and backpressure; scenes/images never go in a 15-KiB data packet.
    scene: (message, to) => room.localParticipant.sendText(JSON.stringify(message), {
      topic: BOARD_SCENE_TOPIC, ...(to ? { destinationIdentities: [to] } : {}),
    }),
  }), [room])
  // Pointer movement should only repaint the editor, never the entire voice/camera screen.
  const summary = useSyncExternalStore(session.subscribe, () => `${session.getView().count}:${session.getView().presence.length}`)
  const [count, people] = summary.split(':').map(Number)
  useEffect(() => {
    let stopped = false
    const readers = new Set<AbortController>()
    const receive = async (reader: Parameters<Parameters<Room['registerTextStreamHandler']>[1]>[0], peer: { identity: string }) => {
      if (stopped || !room.remoteParticipants.has(peer.identity) || (reader.info.size || 0) > MAX_BOARD_MESSAGE_BYTES || readers.size >= 8) return
      const controller = new AbortController()
      readers.add(controller)
      const timeout = setTimeout(() => controller.abort(), 40_000)
      try {
        let text = '', bytes = 0
        for await (const chunk of reader.withAbortSignal(controller.signal)) {
          bytes += new TextEncoder().encode(chunk).byteLength
          if (bytes > MAX_BOARD_MESSAGE_BYTES) throw new Error('Lousa recebida excede o limite.')
          text += chunk
        }
        if (!stopped) session.receiveScene(peer.identity, JSON.parse(text))
      } catch {
        if (!stopped) session.setError('A lousa não chegou por completo. Clique em sincronizar para tentar novamente.')
      } finally { clearTimeout(timeout); readers.delete(controller) }
    }
    const control = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== BOARD_CONTROL_TOPIC || !participant || payload.byteLength > 2_048) return
      try { session.receiveControl(participant.identity, JSON.parse(new TextDecoder().decode(payload))) } catch { /* unrelated/malformed data */ }
    }
    room.registerTextStreamHandler(BOARD_SCENE_TOPIC, receive)
    room.on(RoomEvent.DataReceived, control)
    room.on(RoomEvent.ParticipantConnected, session.peersChanged)
    room.on(RoomEvent.ParticipantDisconnected, session.peersChanged)
    room.on(RoomEvent.Reconnected, session.sync)
    session.start()
    return () => {
      stopped = true; session.stop()
      for (const reader of readers) reader.abort()
      room.unregisterTextStreamHandler(BOARD_SCENE_TOPIC)
      room.off(RoomEvent.DataReceived, control)
      room.off(RoomEvent.ParticipantConnected, session.peersChanged)
      room.off(RoomEvent.ParticipantDisconnected, session.peersChanged)
      room.off(RoomEvent.Reconnected, session.sync)
    }
  }, [room, session])
  return { session, view: { count: count!, people: people! } }
}
