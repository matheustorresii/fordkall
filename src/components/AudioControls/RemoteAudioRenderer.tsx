import { useEffect, useRef } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'

interface RemoteAudioRendererProps {
  track?: RemoteAudioTrack
  volume: number
  deafened: boolean
  muted?: boolean
  outputDeviceId: string
}

export const RemoteAudioRenderer = ({
  track,
  volume,
  deafened,
  muted = false,
  outputDeviceId,
}: RemoteAudioRendererProps) => {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const element = audioRef.current
    if (!track || !element) return

    track.attach(element)

    const resumePlayback = () => {
      if (document.visibilityState === 'visible') {
        void element.play().catch(() => undefined)
      }
    }

    document.addEventListener('visibilitychange', resumePlayback)
    window.addEventListener('focus', resumePlayback)
    return () => {
      document.removeEventListener('visibilitychange', resumePlayback)
      window.removeEventListener('focus', resumePlayback)
      track.detach(element)
      element.pause()
      element.srcObject = null
      element.removeAttribute('src')
      element.load()
    }
  }, [track])

  useEffect(() => {
    const element = audioRef.current
    if (!track || !element) return

    const shouldMute = deafened || muted
    const effectiveVolume = shouldMute ? 0 : volume
    track.setVolume(effectiveVolume)
    if (!shouldMute) void element.play().catch(() => undefined)
  }, [deafened, muted, track, volume])

  useEffect(() => {
    if (!track) return
    void track.setSinkId(outputDeviceId).catch(() => {
      // A saved output can disappear; the browser safely keeps its default output.
    })
  }, [outputDeviceId, track])

  return <audio autoPlay className="remote-audio" ref={audioRef} />
}
