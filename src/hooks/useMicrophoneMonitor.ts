import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalAudioTrack, RoomEvent, Track, type Room } from 'livekit-client'
import { getMicrophoneMonitorVolume, saveMicrophoneMonitorVolume } from '../storage/preferences'

interface MonitorGraph {
  audio: HTMLAudioElement
  context: AudioContext
  gain: GainNode
  source: MediaStreamAudioSourceNode
  destination: MediaStreamAudioDestinationNode
  track: MediaStreamTrack
  disposed: boolean
}
const audioContextConstructor = () => window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
const dispose = (graph: MonitorGraph) => {
  if (graph.disposed) return
  graph.disposed = true
  graph.audio.pause(); graph.audio.srcObject = null
  graph.source.disconnect(); graph.gain.disconnect(); graph.destination.disconnect()
  graph.destination.stream.getTracks().forEach((track) => track.stop())
  graph.track.stop()
  void graph.context.close().catch(() => undefined)
}

export const useMicrophoneMonitor = (room: Room, outputDeviceId: string, sourceRevision: string) => {
  const [enabled, setEnabledState] = useState(false)
  const [volume, setVolumeState] = useState(getMicrophoneMonitorVolume)
  const [error, setError] = useState('')
  const [trackRevision, setTrackRevision] = useState(0)
  const graphRef = useRef<MonitorGraph | null>(null)
  const volumeRef = useRef(volume); volumeRef.current = volume
  const supported = Boolean(audioContextConstructor())

  useEffect(() => {
    const refresh = () => setTrackRevision((current) => current + 1)
    room.on(RoomEvent.LocalTrackPublished, refresh)
    room.on(RoomEvent.LocalTrackUnpublished, refresh)
    return () => {
      room.off(RoomEvent.LocalTrackPublished, refresh)
      room.off(RoomEvent.LocalTrackUnpublished, refresh)
    }
  }, [room])

  useEffect(() => {
    let cancelled = false
    let owned: MonitorGraph | null = null
    const cleanup = () => {
      cancelled = true
      if (owned) { dispose(owned); if (graphRef.current === owned) graphRef.current = null }
    }
    if (!enabled || !supported) return cleanup
    const start = async () => {
      let context: AudioContext | null = null, clone: MediaStreamTrack | null = null
      try {
        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
        if (!(publication?.track instanceof LocalAudioTrack)) return
        const Context = audioContextConstructor()
        if (!Context) return
        // LiveKit's getter returns the processed track when a processor is active.
        // Never acquire another microphone or bypass the published treatment.
        clone = publication.track.mediaStreamTrack.clone()
        clone.enabled = true
        context = new Context({ latencyHint: 'interactive' })
        const source = context.createMediaStreamSource(new MediaStream([clone]))
        const gain = context.createGain(), destination = context.createMediaStreamDestination(), audio = new Audio()
        owned = { audio, context, gain, source, destination, track: clone, disposed: false }
        gain.gain.value = volumeRef.current
        source.connect(gain); gain.connect(destination)
        audio.autoplay = true; audio.srcObject = destination.stream
        try {
          if (outputDeviceId && typeof audio.setSinkId === 'function') await audio.setSinkId(outputDeviceId)
        } catch { /* A disappeared output falls back to the system default. */ }
        if (cancelled) { dispose(owned); return }
        graphRef.current = owned
        gain.gain.value = volumeRef.current
        await context.resume()
        if (cancelled) return
        await audio.play()
        if (!cancelled) setError('')
      } catch {
        // A late rejection from an OLD monitor must not tear down its replacement.
        if (owned) { dispose(owned); if (graphRef.current === owned) graphRef.current = null }
        else { clone?.stop(); if (context) void context.close().catch(() => undefined) }
        if (!cancelled) { setEnabledState(false); setError('O sistema bloqueou o retorno do microfone. Tente ativá-lo novamente.') }
      }
    }
    void start()
    return cleanup
  }, [enabled, outputDeviceId, room, sourceRevision, supported, trackRevision])

  useEffect(() => {
    const graph = graphRef.current
    if (graph && !graph.disposed) graph.gain.gain.setTargetAtTime(volume, graph.context.currentTime, 0.015)
  }, [volume])
  const setEnabled = useCallback((value: boolean) => { setError(''); setEnabledState(value) }, [])
  const setVolume = useCallback((value: number) => {
    const clamped = Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1
    setVolumeState(clamped); saveMicrophoneMonitorVolume(clamped)
  }, [])
  return { enabled, volume, supported, error, clearError: () => setError(''), setEnabled, setVolume }
}
