import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import { RemoteAudioOutput } from '../../services/remoteAudioOutput'

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
  const outputRef = useRef<RemoteAudioOutput | null>(null)
  const levelRef = useRef(volume)
  levelRef.current = volume
  const silent = deafened || muted || volume <= 0

  useLayoutEffect(() => {
    const element = audioRef.current
    if (!track || !element) return
    const output = new RemoteAudioOutput(track, element)
    outputRef.current = output
    output.setLevel(levelRef.current, silent)

    const resumePlayback = () => {
      if (document.visibilityState === 'visible') output.resume()
    }

    document.addEventListener('visibilitychange', resumePlayback)
    window.addEventListener('focus', resumePlayback)
    return () => {
      document.removeEventListener('visibilitychange', resumePlayback)
      window.removeEventListener('focus', resumePlayback)
      output.dispose()
      if (outputRef.current === output) outputRef.current = null
    }
  }, [track])

  useLayoutEffect(() => {
    outputRef.current?.setLevel(volume, silent)
  }, [silent, track, volume])

  useEffect(() => {
    if (!track) return
    void track.setSinkId(outputDeviceId).catch(() => {
      // A saved output can disappear; the browser safely keeps its default output.
    })
  }, [outputDeviceId, track])

  return <audio autoPlay className="remote-audio" ref={audioRef} />
}
