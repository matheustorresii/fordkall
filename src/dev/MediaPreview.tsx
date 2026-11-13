import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RemoteAudioTrack,
  RemoteVideoTrack,
  RoomEvent,
  TrackEvent,
  type Room,
  type RemoteTrackPublication,
} from 'livekit-client'
import { ScreenShareStage } from '../components/ScreenShare/ScreenShareStage'
import { RemoteAudioRenderer } from '../components/AudioControls/RemoteAudioRenderer'
import { useDesktopPerformanceMode } from '../hooks/useDesktopPerformanceMode'
import { useDeafenControl } from '../hooks/useDeafenControl'
import {
  playCallSound,
  renderControlSound,
  type CallSound,
} from '../services/callSounds'
import { CONTROL_SOUNDS, type ControlSound } from '../services/controlFeedback'
import { createLiveKitRoom } from '../services/livekit'
import { externalVideos } from '../services/externalVideo'
import { Icon } from '../components/ui/Icon'
import type { ParticipantMedia } from '../types'

type Fixture = ReturnType<typeof fixture>
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
function fixture(changed: () => void) {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const brush = canvas.getContext('2d')!
  let frames = 0
  const draw = () => {
    frames++
    brush.fillStyle = '#142c37'
    brush.fillRect(0, 0, 1280, 720)
    brush.fillStyle = '#326b72'
    brush.fillRect((frames * 8) % 1200, 0, 80, 720)
    brush.strokeStyle = '#d6dec7'
    brush.lineWidth = 6
    brush.strokeRect(12, 12, 1256, 696)
    brush.fillStyle = '#e1e7d5'
    brush.font = 'bold 65px system-ui'
    brush.fillText('TRANSMISSÃO DE TESTE', 75, 170)
    brush.font = '42px monospace'
    brush.fillText(`Quadro ${frames}`, 75, 255)
    brush.font = '26px system-ui'
    brush.fillText('As quatro bordas devem ficar visíveis.', 75, 600)
    brush.fillText('Sem câmera, microfone ou conexão com uma sala.', 75, 650)
  }
  draw()
  const stream = canvas.captureStream(20),
    source = stream.getVideoTracks()[0]!
  const roomOptions = createLiveKitRoom().options.adaptiveStream
  const settings = typeof roomOptions === 'object' ? roomOptions : undefined
  const listeners = new Map<string, Set<() => void>>()
  const receiver = {} as RTCRtpReceiver
  const pub = {
    kind: 'video',
    isDesired: true,
    viewportEnabled: true,
    track: undefined as RemoteVideoTrack | undefined,
    setSubscribed(value: boolean) {
      this.isDesired = value
      this.apply()
      changed()
      listeners
        .get(RoomEvent.TrackSubscriptionStatusChanged)
        ?.forEach((fn) => fn())
    },
    apply() {
      if (this.track)
        this.track.mediaStreamTrack.enabled =
          this.isDesired && this.viewportEnabled
    },
  }
  const received: RemoteVideoTrack[] = []
  const replaceVideo = () => {
    const previous = pub.track
    const track = new RemoteVideoTrack(
      source.clone(),
      'QA_SCREEN',
      receiver,
      settings,
    )
    pub.track = track
    pub.viewportEnabled = true
    track.on(TrackEvent.VisibilityChanged, (visible) => {
      if (pub.track !== track) return
      pub.viewportEnabled = visible
      pub.apply()
      changed()
    })
    received.push(track)
    pub.apply()
    changed()
    if (previous) previous.mediaStreamTrack.stop()
  }
  replaceVideo()
  const room = {
    remoteParticipants: new Map([
      ['qa-remote', { videoTrackPublications: new Map([['qa-screen', pub]]) }],
    ]),
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
      return this
    },
    off(event: string, fn: () => void) {
      listeners.get(event)?.delete(fn)
      return this
    },
  } as unknown as Room

  const context = new AudioContext(),
    destination = context.createMediaStreamDestination(),
    osc = context.createOscillator()
  osc.frequency.value = 440
  osc.connect(destination)
  osc.start()
  const analyser = context.createAnalyser(),
    silentSink = context.createMediaStreamDestination()
  analyser.fftSize = 2048
  analyser.connect(silentSink)
  // Real SDK + native Web Audio, routed into a silent analysis sink instead of speakers.
  const mixContext = {
    get state() {
      return context.state
    },
    get currentTime() {
      return context.currentTime
    },
    destination: analyser,
    resume: () => context.resume(),
    createGain: () => context.createGain(),
    createMediaStreamSource: (s: MediaStream) =>
      context.createMediaStreamSource(s),
  } as unknown as AudioContext
  const audio = new RemoteAudioTrack(
    destination.stream.getAudioTracks()[0]!,
    'QA_AUDIO',
    receiver,
    mixContext,
  )
  const samples = new Float32Array(analyser.fftSize)
  const rms = () => {
    analyser.getFloatTimeDomainData(samples)
    return Math.sqrt(
      samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
    )
  }
  const timer = setInterval(draw, 50)
  return {
    pub,
    room,
    audio,
    mixContext,
    rms,
    replaceVideo,
    resume: () => context.resume(),
    dispose() {
      clearInterval(timer)
      source.stop()
      received.forEach((track) => {
        track.detach()
        track.mediaStreamTrack.stop()
      })
      audio.detach()
      osc.stop()
      destination.stream.getTracks().forEach((t) => t.stop())
      silentSink.stream.getTracks().forEach((t) => t.stop())
      void context.close()
    },
  }
}
const people: ParticipantMedia[] = [
  'Você',
  'Pessoa da transmissão',
  'Outra pessoa',
].map((name, i) => ({
  id: i ? `qa-${i}` : 'qa-local',
  name,
  isLocal: !i,
  cameraEnabled: false,
  microphoneMuted: false,
  appearance: {
    nameColor: '#dce5d5',
    nameFont: 'mono',
    theme: 'ocean',
    accentColor: '#96c9bc',
    avatarFrame: 'none',
  },
}))

const Player = ({
  media,
  hidden,
  deafened,
}: {
  media: Fixture
  hidden: boolean
  deafened: boolean
}) => {
  useDesktopPerformanceMode(media.room, !hidden, 'gaming')
  return (
    <div className="call-media-layer" hidden={hidden}>
      <ScreenShareStage
        lives={[
          {
            id: 'qa-live',
            participantIdentity: 'qa-remote',
            participantName: 'Pessoa da transmissão',
            isLocal: false,
            videoTrack: media.pub.isDesired ? media.pub.track : undefined,
            videoPublication: media.pub as unknown as RemoteTrackPublication,
            subscribed: media.pub.isDesired,
            hasAudio: false,
            muted: false,
          },
        ]}
        participants={people}
        activeSpeakerIds={new Set()}
        deafened={deafened}
        screenOutputId=""
        galleryLayout="expanded"
        onParticipantMenu={() => {}}
      />
    </div>
  )
}

export const MediaPreview = () => {
  const [media, setMedia] = useState<Fixture | null>(null),
    live = useRef<Fixture | null>(null)
  const [, refresh] = useState(0),
    [hidden, setHidden] = useState(false),
    [rms, setRms] = useState(0)
  const [results, setResults] = useState<string[]>([]),
    [running, setRunning] = useState(false),
    [volume, setVolume] = useState(0.8)
  const feedbacks = useRef<CallSound[]>([])
  const feedback = useCallback((sound: CallSound) => {
    feedbacks.current.push(sound)
  }, [])
  const { deafened, toggleDeafen } = useDeafenControl(feedback)
  const latest = useRef({ deafened, rms })
  latest.current = { deafened, rms }
  const externalVideo = media?.pub.track?.attachedElements.find(
    (element) => element.ownerDocument !== document,
  ) as HTMLVideoElement | undefined
  const externalFrames =
    externalVideo?.getVideoPlaybackQuality().totalVideoFrames || 0
  useEffect(() => () => live.current?.dispose(), [])
  useEffect(() => {
    if (!media) return
    const timer = setInterval(() => {
      setRms(media.rms())
      refresh((n) => n + 1)
    }, 100)
    return () => clearInterval(timer)
  }, [media])
  const start = () => {
    const next = fixture(() => refresh((n) => n + 1))
    live.current = next
    setMedia(next)
    void next.resume()
  }
  const runAudio = async () => {
    if (!media || running) return
    setRunning(true)
    setResults([])
    const check = (ok: unknown, label: string) => {
      if (!ok) throw Error(label)
      setResults((items) => [...items, `PASS · ${label}`])
    }
    const wait = async (test: () => boolean) => {
      const limit = Date.now() + 4000
      while (!test()) {
        if (Date.now() > limit) throw Error('Timeout no áudio real')
        await pause(40)
      }
    }
    try {
      if (latest.current.deafened) {
        toggleDeafen()
        await wait(() => !latest.current.deafened)
      }
      await media.resume()
      await wait(() => media.rms() > 0.01)
      check(
        true,
        'SDK real reproduz áudio sintético no analisador, sem tocar nos alto-falantes',
      )
      const before = feedbacks.current.length
      for (let i = 0; i < 10; i++) {
        toggleDeafen()
        toggleDeafen()
        toggleDeafen()
        await wait(
          () =>
            latest.current.deafened &&
            media.audio.attachedElements.length === 0,
        )
        media.audio.setAudioContext(media.mixContext)
        await pause(150)
        check(
          media.rms() < 0.0001,
          `Ciclo ${i + 1}: deafen continua silencioso após recriar o contexto do SDK`,
        )
        toggleDeafen()
        toggleDeafen()
        toggleDeafen()
        await wait(
          () =>
            !latest.current.deafened &&
            media.audio.attachedElements.length === 1 &&
            media.rms() > 0.01,
        )
      }
      check(
        feedbacks.current.length - before === 60,
        '60 cliques produzem exatamente 60 feedbacks, inclusive em StrictMode',
      )
      check(
        !latest.current.deafened && media.audio.attachedElements.length === 1,
        'UI e áudio terminam juntos em escutando, sem conexões duplicadas',
      )
      for (const sound of Object.keys(CONTROL_SOUNDS) as ControlSound[]) {
        const context = new OfflineAudioContext(1, 44100, 44100)
        renderControlSound(context, sound)
        const buffer = await context.startRendering(),
          samples = buffer.getChannelData(0)
        let energy = 0,
          peak = 0,
          end = 0
        samples.forEach((value, i) => {
          energy += value * value
          peak = Math.max(peak, Math.abs(value))
          if (Math.abs(value) > 0.001) end = i / buffer.sampleRate
        })
        const level = Math.sqrt(energy / samples.length)
        check(
          level > 0.035 && peak < 0.65 && end > 0.34,
          `${sound}: ${Math.round(end * 1000)} ms, RMS ${level.toFixed(3)}, pico ${peak.toFixed(3)} sem clipping`,
        )
      }
      setResults((items) => [
        ...items,
        'COMPLETE · Áudio real e feedback aprovados',
      ])
    } catch (cause) {
      setResults((items) => [
        ...items,
        `FAIL · ${cause instanceof Error ? cause.message : cause}`,
      ])
    } finally {
      setRunning(false)
    }
  }
  return (
    <main className="call-shell" style={{ height: '100dvh' }}>
      <header className="call-header">
        <strong>QA de transmissão e áudio</strong>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {!media ? (
            <button onClick={start} type="button">
              Iniciar mídia de teste
            </button>
          ) : (
            <>
              <button
                aria-pressed={deafened}
                onClick={toggleDeafen}
                type="button"
              >
                {deafened ? 'Deafen ligado' : 'Escutando'}
              </button>
              <button onClick={() => setHidden(!hidden)} type="button">
                {hidden ? 'Mostrar call' : 'Ocultar call'}
              </button>
              <button onClick={() => media.replaceVideo()} type="button">
                Reconectar vídeo
              </button>
            </>
          )}
        </div>
      </header>
      <div className="call-workspace">
        {media && <Player media={media} hidden={hidden} deafened={deafened} />}
      </div>
      {media && (
        <RemoteAudioRenderer
          deafened={deafened}
          track={media.audio}
          volume={volume}
          outputDeviceId=""
        />
      )}
      <details
        style={{
          position: 'fixed',
          zIndex: 100,
          bottom: 90,
          left: 12,
          maxWidth: 'min(550px,95vw)',
          maxHeight: '70vh',
          overflow: 'auto',
          padding: 10,
          background: '#14212fed',
          color: '#deebdf',
          borderRadius: 10,
          font: '12px system-ui',
        }}
      >
        <summary>Diagnóstico e testes</summary>
        <p>
          Áudio RMS: <output>{rms.toFixed(6)}</output> · anexos:{' '}
          {media?.audio.attachedElements.length || 0}
        </p>
        <p>
          Vídeo: {media?.pub.isDesired ? 'inscrito' : 'pausado'} · SDK:{' '}
          {media?.pub.viewportEnabled ? 'ativo' : 'pausado'} · janela:{' '}
          {media && externalVideos.active(media.pub) ? 'ativa' : 'fechada'}
        </p>
        <p>
          Quadros na janela: <output>{externalFrames}</output> · tempo:{' '}
          {externalVideo?.currentTime.toFixed(1) || '0'} · app:{' '}
          {document.hidden ? 'oculto' : 'visível'}
        </p>
        <label>
          Volume de teste{' '}
          <input
            aria-label="Volume de teste"
            type="range"
            min="0"
            max="6"
            step="0.1"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        <button
          disabled={!media || running}
          onClick={() => void runAudio()}
          type="button"
        >
          {running ? 'Verificando…' : 'Verificar áudio e sons'}
        </button>
        <div>
          {(['mute', 'unmute', 'deafen', 'undeafen'] as const).map((sound) => (
            <button
              key={sound}
              type="button"
              onClick={() => playCallSound(sound)}
            >
              Ouvir {sound}
            </button>
          ))}
        </div>
        <pre
          aria-live="polite"
          style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
        >
          {results.join('\n')}
        </pre>
      </details>
      <footer className="call-dock">
        <div className="call-dock__group">
          <button
            className={`call-control ${deafened ? 'call-control--muted' : ''}`}
            type="button"
            onClick={toggleDeafen}
            aria-label="Alternar deafen"
          >
            <span className="call-control__icon">
              <Icon name={deafened ? 'deafen' : 'headphones'} />
            </span>
          </button>
        </div>
      </footer>
    </main>
  )
}
