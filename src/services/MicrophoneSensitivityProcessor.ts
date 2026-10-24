import type { AudioProcessorOptions, TrackProcessor, Track } from 'livekit-client'
import microphoneWorkletUrl from './microphoneSensitivity.worklet.js?url&no-inline'
import { clampMicrophoneThreshold } from './microphoneSettings'

const modules = new WeakMap<AudioContext, Promise<void>>()
const loadWorklet = (context: AudioContext) => {
  let loading = modules.get(context)
  if (!loading) {
    loading = context.audioWorklet.addModule(microphoneWorkletUrl).catch((cause) => {
      modules.delete(context)
      throw cause
    })
    modules.set(context, loading)
  }
  return loading
}

/** Optional unity-gain gate running on the audio thread, not UI/background timers. */
export class MicrophoneSensitivityProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'ford-kall-microphone-sensitivity'
  processedTrack?: MediaStreamTrack

  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private node?: AudioWorkletNode
  private bypass?: GainNode
  private destination?: MediaStreamAudioDestinationNode
  private thresholdDb: number
  private failed = false

  constructor(
    thresholdDb: number,
    private onLevel: (levelDb: number, open: boolean) => void,
    private onFailure: (message: string) => void = () => {},
  ) {
    this.thresholdDb = clampMicrophoneThreshold(thresholdDb)
  }

  setThreshold(thresholdDb: number) {
    this.thresholdDb = clampMicrophoneThreshold(thresholdDb)
    this.node?.port.postMessage({ type: 'threshold', value: this.thresholdDb })
  }

  setOnLevel(onLevel: (levelDb: number, open: boolean) => void) { this.onLevel = onLevel }
  setMeterEnabled(enabled: boolean) { this.node?.port.postMessage({ type: 'meter', enabled }) }

  async init({ audioContext, track }: AudioProcessorOptions) {
    await this.createGraph(audioContext, track)
  }

  async restart({ audioContext, track }: AudioProcessorOptions) {
    // LiveKit 2.22's device-change restart omits audioContext at runtime.
    const context = audioContext ?? this.context
    this.disposeGraph()
    if (!context) throw new Error('O contexto de áudio do microfone não está disponível.')
    await this.createGraph(context, track)
  }

  async destroy() { this.disposeGraph() }

  private failOpen = () => {
    if (this.failed) return
    this.failed = true
    // A processor exception otherwise makes a worklet permanently silent.
    // Keep the original microphone audible until the hook removes the gate.
    this.node?.disconnect()
    if (this.bypass) this.bypass.gain.value = 1
    this.onFailure('A sensibilidade foi desativada após uma falha. Sua voz continua sem esse filtro.')
  }

  private async createGraph(context: AudioContext, track: MediaStreamTrack) {
    if (!context?.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      throw new Error('Este navegador não oferece sensibilidade em tempo real. O microfone pode funcionar sem ela.')
    }
    this.context = context
    this.failed = false
    try {
      await loadWorklet(context)
      // Do not attach a silent processed track if autoplay is still blocked.
      if (context.state === 'suspended') {
        const resume = context.resume()
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([resume, new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Ative o áudio da call antes de ligar a sensibilidade.')), 1500)
          })])
        } finally { if (timeout !== undefined) clearTimeout(timeout) }
      }
      if (context.state !== 'running') throw new Error('O áudio local está suspenso. A sensibilidade pode ser ligada quando ele voltar.')

      this.source = context.createMediaStreamSource(new MediaStream([track]))
      this.destination = context.createMediaStreamDestination()
      this.destination.channelCount = 1
      this.bypass = context.createGain()
      this.bypass.gain.value = 0
      this.node = new AudioWorkletNode(context, 'ford-kall-microphone-sensitivity-v2', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        outputChannelCount: [1],
        processorOptions: { thresholdDb: this.thresholdDb },
      })
      this.node.addEventListener('processorerror', this.failOpen)
      this.node.port.onmessage = ({ data }) => {
        if (typeof data?.levelDb === 'number' && Number.isFinite(data.levelDb)) {
          this.onLevel(Math.max(-100, Math.min(0, data.levelDb)), data.open === true)
        }
      }
      this.source.connect(this.node)
      this.node.connect(this.destination)
      this.source.connect(this.bypass)
      this.bypass.connect(this.destination)
      const output = this.destination.stream.getAudioTracks()[0]
      if (!output) throw new Error('Não foi possível criar a saída de áudio processada.')
      this.processedTrack = output
    } catch (cause) {
      this.disposeGraph()
      throw cause
    }
  }

  private disposeGraph() {
    if (this.node) {
      this.node.removeEventListener('processorerror', this.failOpen)
      this.node.port.onmessage = null
      this.node.port.postMessage({ type: 'stop' })
      this.node.port.close()
      this.node.disconnect()
    }
    this.source?.disconnect()
    this.bypass?.disconnect()
    this.destination?.disconnect()
    this.destination?.stream.getTracks().forEach((track) => track.stop())
    this.source = undefined
    this.node = undefined
    this.bypass = undefined
    this.destination = undefined
    // The SDK owns the input track and AudioContext; never stop/close either here.
    this.processedTrack = undefined
  }
}
