import { useEffect } from 'react'
import { RemoteTrackPublication, RoomEvent, type Room } from 'livekit-client'
import type { PerformanceMode } from '../storage/preferences'
import { VideoSuspensionPolicy } from '../services/videoSuspension'
import '../components/Settings/PerformancePanel.css'

/** Pause remote VIDEO only. Voice, screen audio, microphone DSP and games keep running. */
export const useDesktopPerformanceMode = (room: Room, active = true, mode: PerformanceMode = 'gaming') => {
  useEffect(() => {
    const policy = new VideoSuspensionPolicy<RemoteTrackPublication>()
    const publications = () => [...room.remoteParticipants.values()].flatMap(person => [...person.videoTrackPublications.values()])
    const externallyVisible = (publication: RemoteTrackPublication) => publication.track?.attachedElements.some(element =>
      element === document.pictureInPictureElement || element.ownerDocument !== document && !element.ownerDocument.hidden,
    ) || false
    let scheduled = false, stopped = false
    const sync = () => {
      const background = mode === 'gaming' && (document.hidden || !active)
      document.documentElement.classList.toggle('performance-background-mode', background)
      policy.sync(publications(), background, externallyVisible)
    }
    const schedule = () => { if (scheduled || stopped) return; scheduled = true; queueMicrotask(() => { scheduled = false; if (!stopped) sync() }) }
    document.addEventListener('visibilitychange', schedule)
    document.addEventListener('enterpictureinpicture', schedule, true); document.addEventListener('leavepictureinpicture', schedule, true)
    const events = [RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnpublished, RoomEvent.Reconnected] as const
    events.forEach(event => room.on(event, schedule))
    sync()
    return () => {
      stopped = true; document.removeEventListener('visibilitychange', schedule)
      document.removeEventListener('enterpictureinpicture', schedule, true); document.removeEventListener('leavepictureinpicture', schedule, true)
      events.forEach(event => room.off(event, schedule)); policy.restore(publications())
      document.documentElement.classList.remove('performance-background-mode')
    }
  }, [room, active, mode])
}
