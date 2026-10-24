import { useEffect, useMemo, useState } from 'react'
import {
  LocalVideoTrack,
  RemoteTrackPublication,
  RemoteAudioTrack,
  RemoteVideoTrack,
  RoomEvent,
  Track,
  type Participant,
  type Room,
} from 'livekit-client'
import type { ParticipantMedia, RemoteVoice, ScreenShareLive } from '../types'
import { participantProfileFromMetadata } from '../services/profile'
import { setMediaSubscription } from '../services/videoSuspension'

export const useRoomSnapshot = (room: Room) => {
  const [revision, setRevision] = useState(0)
  const [activeSpeakerIds, setActiveSpeakerIds] = useState(() => new Set(room.activeSpeakers.map(participant => participant.identity)))

  useEffect(() => {
    let stopped = false, scheduled = false
    const refresh = () => {
      if (scheduled || stopped) return
      scheduled = true
      queueMicrotask(() => { scheduled = false; if (!stopped) setRevision(current => current + 1) })
    }
    const disableScreenShareSubscription = (
      publication: RemoteTrackPublication,
      participant: Participant,
    ) => {
      if (
        participant === room.localParticipant ||
        (publication.source !== Track.Source.ScreenShare &&
          publication.source !== Track.Source.ScreenShareAudio)
      ) return

      // Screen shares are opt-in: don't download remote video or audio until
      // the viewer explicitly chooses “Assistir transmissão”.
      setMediaSubscription(publication, false)
    }
    const disablePublishedScreenShare = (
      publication: RemoteTrackPublication,
      participant: Participant,
    ) => {
      disableScreenShareSubscription(publication, participant)
      refresh()
    }
    const refreshActiveSpeakers = () => {
      if (document.hidden) return
      const next = new Set(room.activeSpeakers.map(participant => participant.identity))
      setActiveSpeakerIds(current => current.size === next.size && [...current].every(id => next.has(id)) ? current : next)
    }
    const refreshWhenVisible = () => {
      if (!document.hidden) { refresh(); refreshActiveSpeakers() }
    }

    room.on(RoomEvent.ParticipantConnected, refresh)
    room.on(RoomEvent.ParticipantDisconnected, refresh)
    room.on(RoomEvent.TrackPublished, disablePublishedScreenShare)
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

    // This also covers participants and publications already present when
    // the call screen mounts (for example after a reconnect or route change).
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication instanceof RemoteTrackPublication) {
          disableScreenShareSubscription(publication, participant)
        }
      }
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      stopped = true
      room.off(RoomEvent.ParticipantConnected, refresh)
      room.off(RoomEvent.ParticipantDisconnected, refresh)
      room.off(RoomEvent.TrackPublished, disablePublishedScreenShare)
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

  const snapshot = useMemo(() => {
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
        // The desktop background mode can temporarily unsubscribe video while
        // keeping the screen-share audio active. Treat the stream as watched
        // while either publication remains desired so the UI doesn't unmount
        // the audio renderer or mistake the temporary video pause for a user
        // disconnect.
        subscribed: videoPublication.isDesired || audioPublication?.isDesired === true,
        hasAudio: Boolean(audioPublication && !audioPublication.isMuted),
        muted: audioPublication?.isMuted ?? false,
      })
    }

    return {
      participants,
      participantMedia,
      remoteVoices,
      lives,
    }
  }, [revision, room])
  return { ...snapshot, activeSpeakerIds }
}
