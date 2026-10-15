import { useCallback, useEffect, useMemo, useState } from 'react'
import { RoomEvent, type RemoteParticipant, type Room } from 'livekit-client'
import { RoomMusicSession } from '../music/RoomMusicSession'
import {
  MUSIC_TOPIC,
  currentMusicItem,
  type MusicCommand,
  type MusicPlayerReport,
  type YouTubeSource,
} from '../music/model'
import { getRoomMusicListening } from '../storage/preferences'

export { MAX_ROOM_MUSIC_QUEUE, roomMusicPosition } from '../music/model'

export const useRoomMusic = (room: Room) => {
  const [, render] = useState(0)
  const session = useMemo(
    () =>
      new RoomMusicSession(
        {
          identity: room.localParticipant.identity,
          name: room.localParticipant.name || room.localParticipant.identity,
          send: (payload, destination) =>
            room.localParticipant.publishData(new Uint8Array(payload), {
              reliable: true,
              topic: MUSIC_TOPIC,
              destinationIdentities: destination ? [destination] : undefined,
            }),
        },
        () => render((value) => value + 1),
      ),
    [room],
  )

  useEffect(() => {
    const membership = () => session.setPeers([...room.remoteParticipants.keys()])
    const reconnect = () => session.reconnect([...room.remoteParticipants.keys()])
    const receive = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (participant && topic === MUSIC_TOPIC) session.receive(payload, participant.identity, participant.name, topic)
    }
    room.on(RoomEvent.DataReceived, receive)
    room.on(RoomEvent.ParticipantConnected, membership)
    room.on(RoomEvent.ParticipantDisconnected, membership)
    room.on(RoomEvent.Reconnected, reconnect)
    session.start([...room.remoteParticipants.keys()], getRoomMusicListening())
    const timer = window.setInterval(() => session.tick(), 500)
    return () => {
      session.stop()
      window.clearInterval(timer)
      room.off(RoomEvent.DataReceived, receive)
      room.off(RoomEvent.ParticipantConnected, membership)
      room.off(RoomEvent.ParticipantDisconnected, membership)
      room.off(RoomEvent.Reconnected, reconnect)
    }
  }, [room, session])

  const command = useCallback((value: MusicCommand) => session.command(value), [session])
  const report = useCallback((value: MusicPlayerReport) => session.report(value), [session])
  const setListening = useCallback((enabled: boolean) => session.setListening(enabled), [session])
  const clearError = useCallback(() => session.clearError(), [session])
  const addSource = useCallback((source: YouTubeSource) => session.command({ type: 'add', source }), [session])
  return {
    state: session.state,
    error: session.error,
    ready: session.ready,
    identity: session.transport.identity,
    isController: session.isController,
    currentItem: currentMusicItem(session.state),
    command,
    report,
    setListening,
    clearError,
    addSource,
  }
}
export type RoomMusicController = ReturnType<typeof useRoomMusic>
