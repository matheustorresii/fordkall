import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalAudioTrack, RoomEvent, Track, TrackEvent, type Room } from 'livekit-client'
import {
  getMicrophoneCaptureSettings, getMicrophoneSensitivityEnabled, getMicrophoneSensitivityThreshold,
  saveAutoGainControl, saveEchoCancellation, saveNoiseSuppression,
  saveMicrophoneSensitivityEnabled, saveMicrophoneSensitivityThreshold,
} from '../storage/preferences'
import { MicrophoneSensitivityProcessor } from '../services/MicrophoneSensitivityProcessor'
import { clampMicrophoneThreshold, microphoneConstraints, microphonePresetFor, microphonePresets, type MicrophoneCaptureSettings, type MicrophonePreset } from '../services/microphoneSettings'

const saveCapture = (settings: MicrophoneCaptureSettings) => {
  saveNoiseSuppression(settings.noiseSuppression)
  saveEchoCancellation(settings.echoCancellation)
  saveAutoGainControl(settings.autoGainControl)
}

export const useMicrophoneProcessing = (room: Room, meterVisible = true) => {
  const [capture, setCaptureState] = useState(getMicrophoneCaptureSettings)
  const [sensitivityEnabled, setSensitivityEnabledState] = useState(getMicrophoneSensitivityEnabled)
  const [sensitivityThresholdDb, setSensitivityThresholdDb] = useState(getMicrophoneSensitivityThreshold)
  const [inputLevelDb, setInputLevelDb] = useState(-100)
  const [gateOpen, setGateOpen] = useState(true)
  const [processorRevision, setProcessorRevision] = useState(0)
  const [sensitivityBusy, setSensitivityBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isolationWarning, setIsolationWarning] = useState(false)
  const constraints = typeof navigator !== 'undefined' ? navigator.mediaDevices?.getSupportedConstraints() : undefined
  const sensitivitySupported = typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype

  const activeRef = useRef(true)
  const captureRef = useRef(capture)
  const sensitivityEnabledRef = useRef(sensitivityEnabled)
  const thresholdRef = useRef(sensitivityThresholdDb)
  const processorRef = useRef<MicrophoneSensitivityProcessor | null>(null)
  const processorTrackRef = useRef<LocalAudioTrack | null>(null)
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve())
  const failureRef = useRef<(message: string) => void>(() => {})
  const meterVisibleRef = useRef(meterVisible); meterVisibleRef.current = meterVisible

  const reportLevel = useCallback((db: number, open: boolean) => {
    if (activeRef.current && meterVisibleRef.current && !document.hidden) { setInputLevelDb(Math.round(db * 2) / 2); setGateOpen(open) }
  }, [])
  useEffect(() => {
    const sync = () => processorRef.current?.setMeterEnabled(meterVisibleRef.current && !document.hidden)
    sync(); document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [meterVisible, processorRevision])
  const getTrack = useCallback(() => {
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
    return publication?.track instanceof LocalAudioTrack ? publication.track : null
  }, [room])
  // Capture changes, processor swaps and cleanup share a queue. Fast toggles or
  // a device switch must never put an older processor/settings back on the sender.
  const enqueue = useCallback((work: () => Promise<void>) => {
    const next = syncQueueRef.current.catch(() => undefined).then(work)
    syncQueueRef.current = next.catch(() => undefined)
    return next
  }, [])
  const syncCapture = useCallback(async () => {
    if (!activeRef.current) return
    const track = getTrack()
    if (!track) return
    await track.applyConstraints(microphoneConstraints(captureRef.current))
    if (activeRef.current) {
      const settings = track.getSourceTrackSettings() as MediaTrackSettings & { voiceIsolation?: boolean }
      setIsolationWarning(settings.voiceIsolation === true)
      // Clones can retain their own capture constraints. Rebuild the local
      // monitor AFTER applying NS/AGC/echo, not before the async change finishes.
      setProcessorRevision((revision) => revision + 1)
    }
  }, [getTrack])
  const syncSensitivity = useCallback(async () => {
    if (!activeRef.current) return
    setSensitivityBusy(true)
    try {
      const track = getTrack()
      const previousTrack = processorTrackRef.current, previous = processorRef.current
      if (previousTrack && previousTrack !== track) {
        if (previousTrack.getProcessor() === previous) await previousTrack.stopProcessor()
        processorTrackRef.current = null; processorRef.current = null
      }
      if (!track) return
      const current = track.getProcessor()
      if (!sensitivityEnabledRef.current) {
        if (current instanceof MicrophoneSensitivityProcessor) await track.stopProcessor()
        processorTrackRef.current = null; processorRef.current = null
        if (activeRef.current) { setInputLevelDb(-100); setGateOpen(true) }
        return
      }
      if (current instanceof MicrophoneSensitivityProcessor) {
        current.setThreshold(thresholdRef.current); current.setOnLevel(reportLevel)
        current.setMeterEnabled(meterVisibleRef.current && !document.hidden)
        processorTrackRef.current = track; processorRef.current = current
        return
      }
      if (current) throw new Error('Outro processamento de áudio já está ativo neste microfone.')
      const processor = new MicrophoneSensitivityProcessor(thresholdRef.current, reportLevel, (message) => failureRef.current(message))
      await track.setProcessor(processor)
      processor.setMeterEnabled(meterVisibleRef.current && !document.hidden)
      if (activeRef.current && sensitivityEnabledRef.current) {
        processorTrackRef.current = track; processorRef.current = processor
      } else if (track.getProcessor() === processor) await track.stopProcessor()
    } catch (cause) {
      if (activeRef.current) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível ativar a sensibilidade. Sua voz continua sem esse filtro.')
        sensitivityEnabledRef.current = false
        saveMicrophoneSensitivityEnabled(false)
        setSensitivityEnabledState(false)
      }
    } finally { if (activeRef.current) setSensitivityBusy(false) }
  }, [getTrack, reportLevel])
  const queueSensitivity = useCallback(() => enqueue(syncSensitivity), [enqueue, syncSensitivity])
  failureRef.current = (message) => {
    if (!activeRef.current) return
    setError(message)
    sensitivityEnabledRef.current = false
    saveMicrophoneSensitivityEnabled(false); setSensitivityEnabledState(false)
    void queueSensitivity()
  }

  useEffect(() => {
    activeRef.current = true
    let bound: LocalAudioTrack | null = null
    const changed = () => { if (activeRef.current) setProcessorRevision((revision) => revision + 1) }
    const restore = () => {
      const next = getTrack()
      if (bound !== next) {
        bound?.off(TrackEvent.Restarted, restore)
        bound?.off(TrackEvent.TrackProcessorUpdate, changed)
        bound = next
        bound?.on(TrackEvent.Restarted, restore)
        bound?.on(TrackEvent.TrackProcessorUpdate, changed)
      }
      changed()
      void enqueue(syncCapture).catch(() => {
        if (activeRef.current) setError('Não foi possível aplicar o tratamento do microfone. Confira as opções ou tente trocar a entrada.')
      })
      void queueSensitivity()
    }
    room.on(RoomEvent.LocalTrackPublished, restore)
    room.on(RoomEvent.LocalTrackUnpublished, restore)
    restore()
    return () => {
      activeRef.current = false
      room.off(RoomEvent.LocalTrackPublished, restore)
      room.off(RoomEvent.LocalTrackUnpublished, restore)
      bound?.off(TrackEvent.Restarted, restore)
      bound?.off(TrackEvent.TrackProcessorUpdate, changed)
      void enqueue(async () => {
        const track = processorTrackRef.current, processor = processorRef.current
        if (track && processor && track.getProcessor() === processor) await track.stopProcessor()
        processorTrackRef.current = null; processorRef.current = null
      })
    }
  }, [enqueue, getTrack, queueSensitivity, room, syncCapture])

  const setCapture = useCallback(async (next: MicrophoneCaptureSettings) => {
    const previous = captureRef.current
    captureRef.current = next; saveCapture(next); setCaptureState(next)
    setBusy(true); setError('')
    try { await enqueue(syncCapture); return true }
    catch {
      if (captureRef.current === next) { captureRef.current = previous; saveCapture(previous); setCaptureState(previous) }
      setError('O navegador não conseguiu alterar esse tratamento. A configuração anterior foi mantida.')
      return false
    } finally { if (activeRef.current) setBusy(false) }
  }, [enqueue, syncCapture])
  const setSensitivityEnabled = useCallback((enabled: boolean) => {
    if (enabled && !sensitivitySupported) return
    setError('')
    sensitivityEnabledRef.current = enabled
    saveMicrophoneSensitivityEnabled(enabled); setSensitivityEnabledState(enabled)
    void queueSensitivity()
  }, [queueSensitivity, sensitivitySupported])
  const setSensitivityThreshold = useCallback((value: number) => {
    const threshold = clampMicrophoneThreshold(value)
    thresholdRef.current = threshold; saveMicrophoneSensitivityThreshold(threshold); setSensitivityThresholdDb(threshold)
    processorRef.current?.setThreshold(threshold)
  }, [])
  const setPreset = useCallback(async (preset: MicrophonePreset) => {
    setSensitivityEnabled(false)
    return setCapture({ ...microphonePresets[preset] })
  }, [setCapture, setSensitivityEnabled])

  return {
    ...capture,
    preset: microphonePresetFor(capture, sensitivityEnabled),
    setPreset,
    supported: constraints?.noiseSuppression === true,
    echoCancellationSupported: constraints?.echoCancellation === true,
    autoGainControlSupported: constraints?.autoGainControl === true,
    busy, error, isolationWarning,
    clearError: () => setError(''),
    setEnabled: (enabled: boolean) => setCapture({ ...captureRef.current, noiseSuppression: enabled }),
    setEchoCancellation: (enabled: boolean) => setCapture({ ...captureRef.current, echoCancellation: enabled }),
    setAutoGainControl: (enabled: boolean) => setCapture({ ...captureRef.current, autoGainControl: enabled }),
    sensitivityEnabled, sensitivitySupported, sensitivityBusy, sensitivityThresholdDb,
    inputLevelDb, gateOpen, processorRevision,
    setSensitivityEnabled, setSensitivityThreshold,
  }
}
