import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { RoomEvent, type Room, type RemoteParticipant } from 'livekit-client'
import { DrawingSession } from '../games/drawing/session'
import { MAX_DRAWING_MESSAGE_BYTES } from '../games/drawing/replica'

export const useRoomDrawing = (room: Room, scope: string, artist: string) => {
  const controlTopic = `ford-kall.sketch.v2.${scope}.control`
  const sceneTopic = `ford-kall.sketch.v2.${scope}.scene`
  const session = useMemo(
    () =>
      new DrawingSession({
        identity: room.localParticipant.identity,
        peers: () => [...room.remoteParticipants.keys()],
        control: (message, to, reliable = true) =>
          room.localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(message)),
            {
              topic: controlTopic,
              reliable,
              ...(to ? { destinationIdentities: [to] } : {}),
            },
          ),
        // Completed strokes use reliable streams with chunking/backpressure.
        scene: (message, to) =>
          room.localParticipant.sendText(JSON.stringify(message), {
            topic: sceneTopic,
            ...(to ? { destinationIdentities: [to] } : {}),
          }),
      }),
    [room, controlTopic, sceneTopic],
  )
  const count = useSyncExternalStore(
    session.subscribe,
    () => session.getView().count,
  )
  useEffect(() => {
    if (!scope) return
    let stopped = false
    const readers = new Set<AbortController>()
    const receive = async (
      reader: Parameters<Parameters<Room['registerTextStreamHandler']>[1]>[0],
      peer: { identity: string },
    ) => {
      if (
        stopped ||
        (artist && peer.identity !== artist) ||
        !room.remoteParticipants.has(peer.identity) ||
        (reader.info.size || 0) > MAX_DRAWING_MESSAGE_BYTES ||
        readers.size >= 8
      )
        return
      const controller = new AbortController()
      readers.add(controller)
      const timeout = setTimeout(() => controller.abort(), 40_000)
      try {
        let text = '',
          bytes = 0
        for await (const chunk of reader.withAbortSignal(controller.signal)) {
          bytes += new TextEncoder().encode(chunk).byteLength
          if (bytes > MAX_DRAWING_MESSAGE_BYTES)
            throw new Error('Desenho recebida excede o limite.')
          text += chunk
        }
        if (!stopped) session.receiveScene(peer.identity, JSON.parse(text))
      } catch {
        if (!stopped)
          session.setError(
            'O desenho não chegou por completo. Tente sincronizar novamente.',
          )
      } finally {
        clearTimeout(timeout)
        readers.delete(controller)
      }
    }
    const control = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== controlTopic || !participant || payload.byteLength > 2_048)
        return
      try {
        session.receiveControl(
          participant.identity,
          JSON.parse(new TextDecoder().decode(payload)),
        )
      } catch {
        /* unrelated/malformed data */
      }
    }
    room.registerTextStreamHandler(sceneTopic, receive)
    room.on(RoomEvent.DataReceived, control)
    room.on(RoomEvent.ParticipantConnected, session.peersChanged)
    room.on(RoomEvent.ParticipantDisconnected, session.peersChanged)
    room.on(RoomEvent.Reconnected, session.sync)
    session.start()
    return () => {
      stopped = true
      session.stop()
      for (const reader of readers) reader.abort()
      room.unregisterTextStreamHandler(sceneTopic)
      room.off(RoomEvent.DataReceived, control)
      room.off(RoomEvent.ParticipantConnected, session.peersChanged)
      room.off(RoomEvent.ParticipantDisconnected, session.peersChanged)
      room.off(RoomEvent.Reconnected, session.sync)
    }
  }, [room, session, controlTopic, sceneTopic, artist, scope])
  return { session, view: { count } }
}
