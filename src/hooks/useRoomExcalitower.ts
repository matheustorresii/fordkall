import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { RoomEvent, type Room, type RemoteParticipant } from 'livekit-client'
import {
  BOARD_CONTROL_TOPIC,
  BOARD_SCENE_TOPIC,
  ExcalitowerSession,
} from '../whiteboard/session'
import { MAX_BOARD_MESSAGE_BYTES } from '../whiteboard/replica'

export const useRoomExcalitower = (room: Room, scope = '', artist = '') => {
  const controlTopic = scope
    ? `ford-kall.sketch.${scope}.control`
    : BOARD_CONTROL_TOPIC
  const sceneTopic = scope
    ? `ford-kall.sketch.${scope}.scene`
    : BOARD_SCENE_TOPIC
  const session = useMemo(
    () =>
      new ExcalitowerSession({
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
        // LiveKit streams handle chunking and backpressure; scenes/images never go in a 15-KiB data packet.
        scene: (message, to) =>
          room.localParticipant.sendText(JSON.stringify(message), {
            topic: sceneTopic,
            ...(to ? { destinationIdentities: [to] } : {}),
          }),
      }),
    [room, controlTopic, sceneTopic],
  )
  // Pointer movement should only repaint the editor, never the entire voice/camera screen.
  const summary = useSyncExternalStore(session.subscribe, () =>
    JSON.stringify([
      session.getView().count,
      session.getView().presence.length,
      session.getView().openId,
    ]),
  )
  const [count, people, openId] = JSON.parse(summary) as [
    number,
    number,
    string,
  ]
  useEffect(() => {
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
        (reader.info.size || 0) > MAX_BOARD_MESSAGE_BYTES ||
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
          if (bytes > MAX_BOARD_MESSAGE_BYTES)
            throw new Error('Lousa recebida excede o limite.')
          text += chunk
        }
        if (!stopped) session.receiveScene(peer.identity, JSON.parse(text))
      } catch {
        if (!stopped)
          session.setError(
            'A lousa não chegou por completo. Clique em sincronizar para tentar novamente.',
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
  }, [room, session, controlTopic, sceneTopic, artist])
  return { session, view: { count, people, openId } }
}
