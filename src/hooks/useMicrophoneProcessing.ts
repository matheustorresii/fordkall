import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalAudioTrack, RoomEvent, Track, type Room } from 'livekit-client'
import {
  getMicrophoneSensitivityEnabled,
  getMicrophoneSensitivityThreshold,
  getNoiseSuppression,
  saveMicrophoneSensitivityEnabled,
  saveMicrophoneSensitivityThreshold,
  saveNoiseSuppression,
} from '../storage/preferences'
import { MicrophoneSensitivityProcessor } from '../services/MicrophoneSensitivityProcessor'

export const microphoneCaptureOptions = () => ({
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: getNoiseSuppression(),
})

export const useMicrophoneProcessing = (room: Room) => {
  const [noiseSuppression, setNoiseSuppression] = useState(getNoiseSuppression)
  const [sensitivityEnabled, setSensitivityEnabledState] = useState(getMicrophoneSensitivityEnabled)
  const [sensitivityThresholdDb, setSensitivityThresholdDb] = useState(getMicrophoneSensitivityThreshold)
  const [inputLevelDb, setInputLevelDb] = useState(-100)
  const [processorRevision, setProcessorRevision] = useState(0)
  const [sensitivityBusy, setSensitivityBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sensitivitySupported =
    typeof AudioContext !== 'undefined' &&
    typeof AudioContext.prototype.createMediaStreamDestination === 'function'
  const supported =
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getSupportedConstraints().noiseSuppression === true

  const sensitivityEnabledRef = useRef(sensitivityEnabled)
  const sensitivityThresholdRef = useRef(sensitivityThresholdDb)
  const processorRef = useRef<MicrophoneSensitivityProcessor | null>(null)
  const processorTrackRef = useRef<LocalAudioTrack | null>(null)
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve())
  sensitivityEnabledRef.current = sensitivityEnabled
  sensitivityThresholdRef.current = sensitivityThresholdDb

  const applyNoiseSuppression = useCallback(
    async (enabled: boolean) => {
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
      if (!(publication?.track instanceof LocalAudioTrack)) return
      await publication.track.applyConstraints({
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: enabled,
      })
    },
    [room],
  )

  const syncSensitivity = useCallback(async () => {
    setSensitivityBusy(true)
    try {
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
      const track = publication?.track instanceof LocalAudioTrack ? publication.track : null
      const previousTrack = processorTrackRef.current
      const previousProcessor = processorRef.current

      if (previousTrack && previousTrack !== track) {
        if (previousTrack.getProcessor() === previousProcessor) {
          await previousTrack.stopProcessor()
          setProcessorRevision((revision) => revision + 1)
        }
        processorTrackRef.current = null
        processorRef.current = null
      }
      if (!track) return

      const currentProcessor = track.getProcessor()
      if (!sensitivityEnabledRef.current) {
        if (currentProcessor instanceof MicrophoneSensitivityProcessor) {
          await track.stopProcessor()
          setProcessorRevision((revision) => revision + 1)
        }
        if (processorTrackRef.current === track) {
          processorTrackRef.current = null
          processorRef.current = null
        }
        return
      }

      if (currentProcessor instanceof MicrophoneSensitivityProcessor) {
        currentProcessor.setThreshold(sensitivityThresholdRef.current)
        currentProcessor.setOnLevel(setInputLevelDb)
        processorTrackRef.current = track
        processorRef.current = currentProcessor
        return
      }
      if (currentProcessor) {
        throw new Error('Outro processamento de áudio já está ativo neste microfone.')
      }

      const processor = new MicrophoneSensitivityProcessor(
        sensitivityThresholdRef.current,
        setInputLevelDb,
      )
      await track.setProcessor(processor)
      if (sensitivityEnabledRef.current) {
        processorTrackRef.current = track
        processorRef.current = processor
        setProcessorRevision((revision) => revision + 1)
      } else if (track.getProcessor() === processor) {
        await track.stopProcessor()
        setProcessorRevision((revision) => revision + 1)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setError(message || 'Não foi possível ativar o limiar de sensibilidade deste microfone.')
      sensitivityEnabledRef.current = false
      saveMicrophoneSensitivityEnabled(false)
      setSensitivityEnabledState(false)
    } finally {
      setSensitivityBusy(false)
    }
  }, [room])

  const queueSensitivitySync = useCallback(() => {
    const next = syncQueueRef.current.catch(() => undefined).then(syncSensitivity)
    syncQueueRef.current = next.catch(() => undefined)
    return next
  }, [syncSensitivity])

  useEffect(() => {
    const restoreNoiseSuppression = () =>
      void applyNoiseSuppression(getNoiseSuppression()).catch(() => undefined)
    const restoreSensitivity = () => void queueSensitivitySync()
    room.on(RoomEvent.LocalTrackPublished, restoreNoiseSuppression)
    room.on(RoomEvent.LocalTrackPublished, restoreSensitivity)
    room.on(RoomEvent.LocalTrackUnpublished, restoreSensitivity)
    restoreNoiseSuppression()
    restoreSensitivity()

    return () => {
      room.off(RoomEvent.LocalTrackPublished, restoreNoiseSuppression)
      room.off(RoomEvent.LocalTrackPublished, restoreSensitivity)
      room.off(RoomEvent.LocalTrackUnpublished, restoreSensitivity)
      const cleanup = syncQueueRef.current.catch(() => undefined).then(async () => {
        const track = processorTrackRef.current
        const processor = processorRef.current
        if (track && processor && track.getProcessor() === processor) {
          await track.stopProcessor()
        }
        processorTrackRef.current = null
        processorRef.current = null
      })
      syncQueueRef.current = cleanup.catch(() => undefined)
    }
  }, [applyNoiseSuppression, queueSensitivitySync, room])

  useEffect(() => {
    void queueSensitivitySync()
  }, [queueSensitivitySync, sensitivityEnabled])

  useEffect(() => {
    processorRef.current?.setThreshold(sensitivityThresholdDb)
  }, [sensitivityThresholdDb])

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!supported) return
      setBusy(true)
      setError('')
      saveNoiseSuppression(enabled)
      setNoiseSuppression(enabled)
      try {
        await applyNoiseSuppression(enabled)
      } catch {
        setError('O navegador não conseguiu alterar o tratamento de ruído deste microfone.')
      } finally {
        setBusy(false)
      }
    },
    [applyNoiseSuppression, supported],
  )

  const setSensitivityEnabled = useCallback((enabled: boolean) => {
    setError('')
    sensitivityEnabledRef.current = enabled
    saveMicrophoneSensitivityEnabled(enabled)
    setSensitivityEnabledState(enabled)
    void queueSensitivitySync()
  }, [queueSensitivitySync])

  const setSensitivityThreshold = useCallback((thresholdDb: number) => {
    saveMicrophoneSensitivityThreshold(thresholdDb)
    sensitivityThresholdRef.current = thresholdDb
    setSensitivityThresholdDb(thresholdDb)
  }, [])

  return {
    noiseSuppression,
    supported,
    busy,
    error,
    clearError: () => setError(''),
    setEnabled,
    sensitivityEnabled,
    sensitivitySupported,
    sensitivityBusy,
    sensitivityThresholdDb,
    inputLevelDb,
    processorRevision,
    setSensitivityEnabled,
    setSensitivityThreshold,
  }
}
