import { useEffect, useMemo, useState } from 'react'
import {
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
  RoomEvent,
  Track,
  type Participant,
  type Room,
} from 'livekit-client'
import type { ParticipantMedia, RemoteVoice, ScreenShareLive } from '../types'
import { participantProfileFromMetadata } from '../services/profile'

export const useRoomSnapshot = (room: Room) => {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1)
    const refreshActiveSpeakers = () => {
      if (!document.hidden) refresh()
    }
    const refreshWhenVisible = () => {
      if (!document.hidden) refresh()
    }

    room.on(RoomEvent.ParticipantConnected, refresh)
    room.on(RoomEvent.ParticipantDisconnected, refresh)
    room.on(RoomEvent.TrackPublished, refresh)
    room.on(RoomEvent.TrackUnpublished, refresh)
    room.on(RoomEvent.TrackSubscribed, refresh)
    room.on(RoomEvent.TrackUnsubscribed, refresh)
    room.on(RoomEvent.TrackSubscriptionStatusChanged, refresh)
    room.on(RoomEvent.TrackMuted, refresh)
    room.on(RoomEvent.TrackUnmuted, refresh)
    room.on(RoomEvent.LocalTrackPublished, refresh)
    room.on(RoomEvent.LocalTrackUnpublished, refresh)
    room.on(RoomEvent.ActiveSpeakersChanged, refreshActiveSpeakers)
    room.on(RoomEvent.ParticipantNameChanged, refresh)
    room.on(RoomEvent.ParticipantMetadataChanged, refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      room.off(RoomEvent.ParticipantConnected, refresh)
      room.off(RoomEvent.ParticipantDisconnected, refresh)
      room.off(RoomEvent.TrackPublished, refresh)
      room.off(RoomEvent.TrackUnpublished, refresh)
      room.off(RoomEvent.TrackSubscribed, refresh)
      room.off(RoomEvent.TrackUnsubscribed, refresh)
      room.off(RoomEvent.TrackSubscriptionStatusChanged, refresh)
      room.off(RoomEvent.TrackMuted, refresh)
      room.off(RoomEvent.TrackUnmuted, refresh)
      room.off(RoomEvent.LocalTrackPublished, refresh)
      room.off(RoomEvent.LocalTrackUnpublished, refresh)
      room.off(RoomEvent.ActiveSpeakersChanged, refreshActiveSpeakers)
      room.off(RoomEvent.ParticipantNameChanged, refresh)
      room.off(RoomEvent.ParticipantMetadataChanged, refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [room])

  return useMemo(() => {
    const activeSpeakerIds = new Set(room.activeSpeakers.map((participant) => participant.identity))
    const participants: Participant[] = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ]

    const remoteVoices: RemoteVoice[] = [...room.remoteParticipants.values()].map(
      (participant) => {
        const publication = participant.getTrackPublication(Track.Source.Microphone)
        return {
          id: participant.identity,
          participant,
          track:
            publication?.track instanceof RemoteAudioTrack ? publication.track : undefined,
          muted: publication?.isMuted ?? true,
        }
      },
    )

    const participantMedia: ParticipantMedia[] = participants.map((participant) => {
      const cameraPublication = participant.getTrackPublication(Track.Source.Camera)
      const microphonePublication = participant.getTrackPublication(Track.Source.Microphone)
      const cameraTrack = cameraPublication?.videoTrack
      const publicProfile = participantProfileFromMetadata(participant.metadata)

      return {
        id: participant.identity,
        name: participant.name || participant.identity,
        avatarDataUrl: publicProfile.avatarDataUrl,
        bio: publicProfile.bio,
        appearance: publicProfile.appearance,
        isLocal: participant === room.localParticipant,
        cameraTrack:
          cameraTrack instanceof LocalVideoTrack || cameraTrack instanceof RemoteVideoTrack
            ? cameraTrack
            : undefined,
        cameraEnabled: Boolean(cameraPublication && !cameraPublication.isMuted),
        microphoneMuted: microphonePublication?.isMuted ?? true,
      }
    })

    const lives: ScreenShareLive[] = []
    const localVideoPublication = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShare,
    )
    const localAudioPublication = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShareAudio,
    )
    if (localVideoPublication?.videoTrack instanceof LocalVideoTrack) {
      lives.push({
        id: `local:${localVideoPublication.trackSid}`,
        participantIdentity: room.localParticipant.identity,
        participantName: room.localParticipant.name || room.localParticipant.identity,
        isLocal: true,
        videoTrack: localVideoPublication.videoTrack,
        subscribed: true,
        hasAudio: Boolean(localAudioPublication && !localAudioPublication.isMuted),
        muted: false,
      })
    }

    for (const participant of room.remoteParticipants.values()) {
      const videoPublication = participant.getTrackPublication(Track.Source.ScreenShare)
      if (!videoPublication) continue
      const audioPublication = participant.getTrackPublication(Track.Source.ScreenShareAudio)
      lives.push({
        id: `${participant.identity}:${videoPublication.trackSid}`,
        participantIdentity: participant.identity,
        participantName: participant.name || participant.identity,
        isLocal: false,
        videoTrack:
          videoPublication.videoTrack instanceof RemoteVideoTrack
            ? videoPublication.videoTrack
            : undefined,
        audioTrack:
          audioPublication?.track instanceof RemoteAudioTrack
            ? audioPublication.track
            : undefined,
        videoPublication,
        audioPublication,
        subscribed: videoPublication.isDesired,
        hasAudio: Boolean(audioPublication && !audioPublication.isMuted),
        muted: audioPublication?.isMuted ?? false,
      })
    }

    return {
      participants,
      participantMedia,
      remoteVoices,
      lives,
      activeSpeakerIds,
    }
  }, [revision, room])
}
