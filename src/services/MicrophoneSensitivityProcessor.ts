import type { AudioProcessorOptions, TrackProcessor, Track } from 'livekit-client'

const GATE_HYSTERESIS_DB = 6
const CLOSE_HOLD_MS = 240
const SAMPLE_INTERVAL_MS = 40
const LEVEL_UPDATE_INTERVAL_MS = 120
const CLOSED_GAIN = 0
const OPEN_GAIN = 1

/** A local noise gate: audio below the selected dBFS threshold is not sent. */
export class MicrophoneSensitivityProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  readonly name = 'ford-kall-microphone-sensitivity'
  processedTrack?: MediaStreamTrack

  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private analyser?: AnalyserNode
  private gate?: GainNode
  private destination?: MediaStreamAudioDestinationNode
  private samples?: Float32Array<ArrayBuffer>
  private timer?: number
  private closeStartedAt = 0
  private lastLevelUpdateAt = 0
  private isOpen = true
  private thresholdDb: number
  private onLevel: (levelDb: number) => void
  private onVisibilityChange?: () => void

  constructor(thresholdDb: number, onLevel: (levelDb: number) => void) {
    this.thresholdDb = thresholdDb
    this.onLevel = onLevel
  }

  setThreshold(thresholdDb: number) {
    this.thresholdDb = thresholdDb
  }

  setOnLevel(onLevel: (levelDb: number) => void) {
    this.onLevel = onLevel
  }

  async init({ audioContext, track }: AudioProcessorOptions) {
    await this.createGraph(audioContext, track)
  }

  async restart({ audioContext, track }: AudioProcessorOptions) {
    this.disposeGraph()
    await this.createGraph(audioContext, track)
  }

  async destroy() {
    this.disposeGraph()
  }

  private async createGraph(context: AudioContext, track: MediaStreamTrack) {
    if (typeof context.createMediaStreamDestination !== 'function') {
      throw new Error('Este navegador não oferece processamento de áudio local.')
    }

    this.context = context
    try {
      const stream = new MediaStream([track])
      this.source = context.createMediaStreamSource(stream)
      this.analyser = context.createAnalyser()
      this.analyser.fftSize = 1024
      this.samples = new Float32Array(this.analyser.fftSize)
      this.gate = context.createGain()
      this.destination = context.createMediaStreamDestination()

      this.source.connect(this.analyser)
      this.source.connect(this.gate)
      this.gate.connect(this.destination)
      this.setGateOpen(true)

      if (context.state === 'suspended') {
        await context.resume()
      }

      const processedTrack = this.destination.stream.getAudioTracks()[0]
      if (!processedTrack) throw new Error('Não foi possível criar a saída de áudio processada.')
      this.processedTrack = processedTrack
      this.closeStartedAt = 0
      this.lastLevelUpdateAt = 0
      this.timer = window.setInterval(() => this.sample(), SAMPLE_INTERVAL_MS)
      this.onVisibilityChange = () => {
        // Browsers throttle timers in background tabs; bypass the gate so this
        // local convenience never cuts the user's call audio while they multitask.
        if (document.hidden) {
          this.closeStartedAt = 0
          this.setGateOpen(true)
        }
      }
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    } catch (error) {
      this.disposeGraph()
      if (error instanceof Error && error.message.includes('AudioContext')) throw error
      if (context.state === 'suspended') {
        throw new Error('O navegador bloqueou o processamento de áudio do microfone.')
      }
      throw error
    }
  }

  private sample() {
    const analyser = this.analyser
    const samples = this.samples
    if (!analyser || !samples) return

    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const sample of samples) sum += sample * sample
    const rms = Math.sqrt(sum / samples.length)
    const levelDb = rms > 0 ? 20 * Math.log10(rms) : -100
    const now = performance.now()

    if (now - this.lastLevelUpdateAt >= LEVEL_UPDATE_INTERVAL_MS) {
      this.lastLevelUpdateAt = now
      this.onLevel(Math.max(-100, Math.min(0, levelDb)))
    }

    if (document.hidden) {
      this.closeStartedAt = 0
      this.setGateOpen(true)
      return
    }

    if (this.isOpen) {
      if (levelDb < this.thresholdDb - GATE_HYSTERESIS_DB) {
        this.closeStartedAt ||= now
        if (now - this.closeStartedAt >= CLOSE_HOLD_MS) this.setGateOpen(false)
      } else {
        this.closeStartedAt = 0
      }
    } else if (levelDb >= this.thresholdDb) {
      this.closeStartedAt = 0
      this.setGateOpen(true)
    }
  }

  private setGateOpen(open: boolean) {
    if (open === this.isOpen && this.gate) return
    this.isOpen = open
    const parameter = this.gate?.gain
    const context = this.context
    if (!parameter || !context) return

    const now = context.currentTime
    parameter.cancelScheduledValues(now)
    parameter.setValueAtTime(parameter.value, now)
    parameter.linearRampToValueAtTime(open ? OPEN_GAIN : CLOSED_GAIN, now + 0.025)
  }

  private disposeGraph() {
    if (this.timer !== undefined) window.clearInterval(this.timer)
    this.timer = undefined
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
    }
    this.onVisibilityChange = undefined
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.gate?.disconnect()
    this.destination?.disconnect()
    this.source = undefined
    this.analyser = undefined
    this.gate = undefined
    this.destination = undefined
    this.samples = undefined
    this.context = undefined
    this.processedTrack = undefined
  }
}
