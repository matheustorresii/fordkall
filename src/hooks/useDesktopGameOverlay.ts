import { useEffect } from 'react'
import { RoomEvent, Track, type Room } from 'livekit-client'
import { participantAvatarFromMetadata } from '../services/profile'

export const useDesktopGameOverlay = (room: Room, enabled: boolean) => {
  useEffect(() => {
    const desktop = window.fordKallDesktop
    if (!desktop || desktop.platform !== 'win32') return
    if (!enabled) { desktop.setGameOverlayState({ enabled: false, participants: [] }); return }

    const activeSpeakerIds = () => room.activeSpeakers.map((participant) => participant.identity)

    const publishState = () => {
      const activeSpeakers = new Set(
        activeSpeakerIds(),
      )
      const participants = [
        room.localParticipant,
        ...room.remoteParticipants.values(),
      ].map((participant) => ({
        id: participant.identity,
        name: participant.name || participant.identity,
        avatarDataUrl: participantAvatarFromMetadata(participant.metadata),
        isLocal: participant === room.localParticipant,
        muted: participant.getTrackPublication(Track.Source.Microphone)?.isMuted ?? true,
        speaking: activeSpeakers.has(participant.identity),
      }))

      desktop.setGameOverlayState({ enabled, participants })
    }

    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantMetadataChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ] as const

    events.forEach((event) => room.on(event, publishState))
    const publishSpeakers = () => desktop.setGameOverlaySpeakers(activeSpeakerIds())
    room.on(RoomEvent.ActiveSpeakersChanged, publishSpeakers)
    publishState()

    return () => {
      events.forEach((event) => room.off(event, publishState))
      room.off(RoomEvent.ActiveSpeakersChanged, publishSpeakers)
      desktop.setGameOverlayState({ enabled: false, participants: [] })
    }
  }, [enabled, room])
}
