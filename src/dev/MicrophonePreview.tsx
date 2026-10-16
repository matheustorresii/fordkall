import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { LocalAudioTrack, RoomEvent, Track, type AudioCaptureOptions, type AudioProcessorOptions, type Room } from 'livekit-client'
import { SettingsModal } from '../components/Settings/SettingsModal'
import { useMicrophoneProcessing } from '../hooks/useMicrophoneProcessing'
import { useMicrophoneMonitor } from '../hooks/useMicrophoneMonitor'
import { useAppUpdater } from '../hooks/useAppUpdater'
import { microphoneCaptureOptions } from '../services/microphoneCapture'
import { MicrophoneSensitivityProcessor } from '../services/MicrophoneSensitivityProcessor'
import { createLiveKitRoom } from '../services/livekit'

const pause = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const until = async (predicate: () => boolean, timeout = 2500) => {
  const deadline = performance.now() + timeout
  while (!predicate()) { if (performance.now() > deadline) throw new Error('Tempo esgotado aguardando o áudio.'); await pause() }
}
const createHarness = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  let track: LocalAudioTrack | undefined
  const captures: AudioCaptureOptions[] = [], tracks: LocalAudioTrack[] = [], contexts: AudioContext[] = []
  let failCapture = false
  const room = {
    localParticipant: { getTrackPublication: (source: Track.Source) => source === Track.Source.Microphone && track ? { track, source } : undefined },
    on(event: string, listener: (...args: unknown[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); return this },
    off(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); return this },
  } as unknown as Room
  const publish = (next: LocalAudioTrack) => { track = next; listeners.get(RoomEvent.LocalTrackPublished)?.forEach((fn) => fn({ track, source: Track.Source.Microphone })) }
  const input = (context: AudioContext) => {
    const oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination()
    oscillator.frequency.value = 220; gain.gain.value = 0.2
    oscillator.connect(gain); gain.connect(destination); oscillator.start()
    const raw = destination.stream.getAudioTracks()[0]!
    const local = new LocalAudioTrack(raw, microphoneCaptureOptions(), true, context)
    local.source = Track.Source.Microphone
    local.applyConstraints = async (settings) => {
      captures.push({ ...settings })
      if (failCapture) { failCapture = false; throw new DOMException('Falha simulada', 'OverconstrainedError') }
      // A synthetic MediaStreamDestination has no hardware NS/AGC controls.
      // Capture-option validation is recorded here; the DSP below remains real.
    }
    tracks.push(local)
    return { local, raw, gain, oscillator }
  }
  return { room, captures, contexts, publish, input, fail: () => { failCapture = true }, cleanup: () => { tracks.forEach((value) => value.stop()); contexts.forEach((context) => { if (context.state !== 'closed') void context.close() }) } }
}
type SettingsProps = ComponentProps<typeof SettingsModal>
const mockDevice = { deviceId: 'test', label: 'Sinal sintético · sem capturar microfone', kind: 'audioinput', groupId: '', toJSON: () => ({}) } as MediaDeviceInfo
const devices: SettingsProps['devices'] = {
  inputs: [mockDevice], videoInputs: [], outputs: [], preferences: { inputId: 'test', videoInputId: '', voiceOutputId: '', screenOutputId: '' },
  selectedInput: 'test', selectedVideoInput: '', loading: false, error: '', outputSelectionSupported: false,
  switchInput: async () => {}, switchVideoInput: async () => {}, setVoiceOutput: () => {}, setScreenOutput: () => {},
}
const shortcuts: SettingsProps['shortcuts'] = { bindings: { microphone: '', deafen: '', camera: '', screenShare: '', leave: '' }, failedActions: [], setBinding: () => {} }

/** Real LiveKit track + real AudioWorklet; no getUserMedia or external room. */
export const MicrophonePreview = () => {
  const harness = useMemo(createHarness, [])
  const processing = useMicrophoneProcessing(harness.room)
  const monitor = useMicrophoneMonitor(harness.room, '', String(processing.processorRevision))
  const updater = useAppUpdater()
  const latest = useRef({ processing, monitor }); latest.current = { processing, monitor }
  const [settingsOpen, setSettingsOpen] = useState(false), [running, setRunning] = useState(false), [results, setResults] = useState<string[]>([])
  useEffect(() => () => harness.cleanup(), [harness])
  const run = async () => {
    setRunning(true); setResults([])
    const assert = (condition: unknown, description: string) => { if (!condition) throw new Error(description); setResults((rows) => [...rows, 'PASS · ' + description]) }
    const OriginalAudio = window.Audio
    const audios: Array<{ srcObject: MediaStream | null; paused: number; stream: MediaStream | null }> = []
    let rejectOldPlay: (() => void) | undefined
    try {
      await latest.current.processing.setPreset('natural'); await pause()
      const roomDefaults = createLiveKitRoom()
      assert(roomDefaults.options.audioCaptureDefaults?.voiceIsolation === false && roomDefaults.options.audioCaptureDefaults?.autoGainControl === false, 'Defaults da sala também impedem o SDK de restaurar filtros ocultos')
      const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }); harness.contexts.push(context)
      await context.resume()
      const first = harness.input(context); harness.publish(first.local)
      await until(() => harness.captures.length > 0)
      assert(harness.captures.every((value) => value.voiceIsolation === false && value.autoGainControl === false), 'Captura inicial nunca herda isolamento oculto nem ganho automático')
      assert(harness.captures.at(-1)?.noiseSuppression === false && harness.captures.at(-1)?.echoCancellation === true, 'Voz natural mantém só a proteção contra eco')
      latest.current.processing.setSensitivityEnabled(true)
      await until(() => first.local.getProcessor() instanceof MicrophoneSensitivityProcessor)
      await until(() => latest.current.processing.inputLevelDb > -25)
      const processor = first.local.getProcessor() as MicrophoneSensitivityProcessor, output = processor.processedTrack!
      assert(output !== first.raw && output.readyState === 'live', 'Sensibilidade publica uma saída AudioWorklet real, separada da captura')
      assert(latest.current.processing.gateOpen && Math.abs(latest.current.processing.inputLevelDb + 17) < 4, 'Medidor do worklet recebe o RMS esperado do sinal de 220 Hz')
      const probeSource = context.createMediaStreamSource(new MediaStream([output])), analyser = context.createAnalyser(), silent = context.createGain()
      silent.gain.value = 0; analyser.fftSize = 2048; probeSource.connect(analyser); analyser.connect(silent); silent.connect(context.destination)
      const rms = () => { const values = new Float32Array(2048); analyser.getFloatTimeDomainData(values); return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) }
      await pause(180)
      assert(rms() > 0.13 && rms() < 0.15, 'Saída processada mantém o volume original, sem compressão ou amplificação')
      first.gain.gain.value = 0.0001
      await until(() => !latest.current.processing.gateOpen)
      await pause(600)
      assert(rms() < 0.000001, 'Sinal abaixo do limiar é silenciado pelo áudio, não por timers da UI')
      first.gain.gain.value = 0.2
      await until(() => latest.current.processing.gateOpen)
      assert(rms() > 0.12, 'A voz volta sem ficar presa no gate fechado')
      probeSource.disconnect(); analyser.disconnect(); silent.disconnect()
      latest.current.processing.setSensitivityEnabled(false)
      await until(() => !first.local.getProcessor())
      assert(output.readyState === 'ended' && first.raw.readyState === 'live' && first.local.mediaStreamTrack === first.raw, 'Desligar sensibilidade encerra só a saída processada e devolve a captura original')
      for (let i = 0; i < 3; i++) { latest.current.processing.setSensitivityEnabled(true); await until(() => Boolean(first.local.getProcessor())); latest.current.processing.setSensitivityEnabled(false); await until(() => !first.local.getProcessor()) }
      assert(first.raw.readyState === 'live', 'Ligar e desligar repetidamente não encerra nem recaptura o microfone')
      await first.local.mute()
      await latest.current.processing.setPreset('noise'); await pause()
      assert(first.local.isMuted && !first.raw.enabled, 'Trocar tratamento nunca desmuta a pessoa nem vaza sua voz')
      assert(harness.captures.at(-1)?.noiseSuppression === true && harness.captures.at(-1)?.voiceIsolation === false, 'Supressão ligada não religa o isolamento de voz por trás')
      const before = latest.current.processing.noiseSuppression
      harness.fail(); const accepted = await latest.current.processing.setEnabled(!before); await pause()
      assert(!accepted && latest.current.processing.noiseSuppression === before && Boolean(latest.current.processing.error), 'Falha ao aplicar constraints mantém a opção anterior e mostra erro')
      await first.local.unmute(); await latest.current.processing.setPreset('natural')
      latest.current.processing.setSensitivityEnabled(true); await until(() => Boolean(first.local.getProcessor()))
      const second = harness.input(context), current = first.local.getProcessor() as MicrophoneSensitivityProcessor, oldOutput = current.processedTrack!
      await current.restart({ kind: Track.Kind.Audio, track: second.raw } as AudioProcessorOptions)
      assert(oldOutput.readyState === 'ended' && current.processedTrack?.readyState === 'live' && second.raw.readyState === 'live', 'Restart sem audioContext, como no SDK ao trocar entrada, reutiliza o contexto e libera a saída antiga')
      harness.publish(second.local)
      await until(() => Boolean(second.local.getProcessor()) && !first.local.getProcessor())
      assert(first.raw.readyState === 'live' && second.local.mediaStreamTrack.readyState === 'live', 'Troca de dispositivo move o processador sem matar a captura alheia')
      const failing = second.local.getProcessor() as MicrophoneSensitivityProcessor
      const node = Reflect.get(failing, 'node') as AudioWorkletNode
      node.dispatchEvent(new Event('processorerror'))
      await until(() => !second.local.getProcessor() && !latest.current.processing.sensitivityEnabled)
      assert(second.raw.readyState === 'live' && second.local.mediaStreamTrack === second.raw && Boolean(latest.current.processing.error), 'Falha do worklet cai para voz original em vez de silêncio permanente')

      // The monitor uses real graphs but fake playback, so QA never emits tones.
      window.Audio = class {
        autoplay = false; srcObject: MediaStream | null = null; paused = 0; stream: MediaStream | null = null
        constructor() { audios.push(this) }
        pause() { this.paused++ }
        async play() { this.stream = this.srcObject; if (audios.length === 1) await new Promise<void>((_, reject) => { rejectOldPlay = () => reject(new Error('Autoplay antigo')) }) }
      } as unknown as typeof Audio
      latest.current.monitor.setEnabled(true)
      await until(() => Boolean(rejectOldPlay))
      latest.current.processing.setSensitivityEnabled(true)
      await until(() => audios.length >= 2)
      await pause(150)
      const replacement = audios.at(-1)!, pauses = replacement.paused
      rejectOldPlay?.(); await pause()
      assert(latest.current.monitor.enabled && replacement.paused === pauses && replacement.srcObject !== null, 'Rejeição atrasada do retorno antigo não destrói o retorno novo')
      const countBeforeCapture = audios.length
      await latest.current.processing.setAutoGainControl(true)
      await until(() => audios.length > countBeforeCapture)
      assert(latest.current.monitor.enabled, 'Retorno é atualizado depois de mudar filtros de captura, mesmo sem trocar o gate')
      const monitorStream = audios.at(-1)!.srcObject!
      latest.current.monitor.setEnabled(false); await pause()
      assert(monitorStream.getTracks().every((track) => track.readyState === 'ended') && second.raw.readyState === 'live', 'Desligar retorno libera sua saída e preserva o microfone da call')
      await latest.current.processing.setPreset('natural')
      assert(harness.captures.every((value) => value.voiceIsolation === false), 'Todos os caminhos testados mantêm o isolamento adicional desligado')
    } catch (cause) { setResults((rows) => [...rows, 'FAIL · ' + (cause instanceof Error ? cause.message : String(cause))]) }
    finally { window.Audio = OriginalAudio; setRunning(false) }
  }
  return <main style={{ height: '100dvh', overflow: 'auto', padding: 32, background: '#202733', color: '#f3f6f9', font: '14px/1.7 system-ui' }}>
    <h1>Microfone · validação local</h1><p>Sinais sintéticos, track real do LiveKit e AudioWorklet real. Sem capturar microfone, sem sala externa e sem emitir tons pelo teste.</p>
    <button className="game-action" disabled={running} onClick={() => void run()} type="button">{running ? 'Testando…' : 'Executar verificações de áudio'}</button>{' '}
    <button className="game-action" onClick={() => setSettingsOpen(true)} type="button">Abrir configurações</button>
    <p role="status">{results.filter((row) => row.startsWith('PASS')).length} verificações passaram.</p><ol>{results.map((result, index) => <li key={index}>{result}</li>)}</ol>
    {settingsOpen && <SettingsModal devices={devices} gameOverlayEnabled={false} microphoneMonitor={monitor} microphoneProcessing={processing} callSoundsEnabled quality="1080p30" shortcuts={shortcuts} updater={updater} onCallSoundsChange={() => {}} onGameOverlayChange={() => {}} onQualityChange={() => {}} onClose={() => setSettingsOpen(false)} />}
  </main>
}
