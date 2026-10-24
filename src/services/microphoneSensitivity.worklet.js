// Self-contained ES module: Vite emits this file as an asset for AudioWorklet.
// No timers, UI messages carrying audio, spectral filters, AGC or amplification.
export const MICROPHONE_GATE = Object.freeze({
  lookaheadSeconds: 0.012,
  holdSeconds: 0.28,
  attackSeconds: 0.0015,
  releaseSeconds: 0.045,
  hysteresisDb: 6,
})

/** Shared by the real worklet and deterministic sample-level regression tests. */
export class MicrophoneGate {
  constructor(rate, thresholdDb = -48) {
    this.rate = rate
    this.delayFrames = Math.max(1, Math.round(rate * MICROPHONE_GATE.lookaheadSeconds))
    this.attack = Math.exp(-1 / (rate * MICROPHONE_GATE.attackSeconds))
    this.release = Math.exp(-1 / (rate * MICROPHONE_GATE.releaseSeconds))
    this.buffers = []
    this.position = 0
    this.quietFrames = 0
    this.power = 0
    this.levelDb = -100
    this.gain = 1
    this.open = true
    this.setThreshold(thresholdDb)
  }

  setThreshold(value) {
    this.thresholdDb = Number.isFinite(value) ? Math.min(-20, Math.max(-70, value)) : -48
    this.quietFrames = 0
  }

  process(input, output) {
    const frames = output[0]?.length ?? 0
    if (!frames) return
    // Channel changes only allocate on setup/reconfiguration, never per quantum.
    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.delayFrames))
    let power = 0
    for (let c = 0; c < input.length; c++) {
      let sum = 0
      const channel = input[c]
      for (let i = 0; i < frames; i++) {
        const sample = channel[i]
        if (Number.isFinite(sample)) sum += sample * sample
      }
      power = Math.max(power, sum / frames)
    }
    const smoothing = Math.exp(-frames / (this.rate * (power > this.power ? 0.003 : 0.06)))
    this.power = power + smoothing * (this.power - power)
    this.levelDb = Math.max(-100, Math.min(0, this.power > 1e-10 ? 10 * Math.log10(this.power) : -100))
    if (this.levelDb >= this.thresholdDb) {
      this.open = true
      this.quietFrames = 0
    } else if (this.levelDb < this.thresholdDb - MICROPHONE_GATE.hysteresisDb) {
      this.quietFrames += frames
      if (this.quietFrames >= this.rate * MICROPHONE_GATE.holdSeconds) this.open = false
    } else {
      this.quietFrames = 0
    }
    const target = this.open ? 1 : 0
    const coefficient = this.open ? this.attack : this.release
    for (let i = 0; i < frames; i++) {
      this.gain = target + coefficient * (this.gain - target)
      if (this.open && this.gain > 0.99999) this.gain = 1
      else if (!this.open && this.gain < 0.00001) this.gain = 0
      for (let c = 0; c < output.length; c++) {
        const buffer = this.buffers[c]
        const delayed = buffer[this.position]
        const sample = input[c]?.[i] ?? 0
        buffer[this.position] = Number.isFinite(sample) ? sample : 0
        output[c][i] = delayed * this.gain
      }
      this.position = (this.position + 1) % this.delayFrames
    }
  }
}

// The guard permits importing the exact production DSP in Node tests as well.
if (typeof registerProcessor === 'function') {
  class MicrophoneSensitivityWorklet extends AudioWorkletProcessor {
    constructor(options) {
      super()
      this.gate = new MicrophoneGate(sampleRate, options.processorOptions?.thresholdDb)
      this.framesSinceReport = 0
      this.active = true
      this.reportEnabled = true
      this.port.onmessage = ({ data }) => {
        if (data?.type === 'threshold') this.gate.setThreshold(data.value)
        else if (data?.type === 'stop') this.active = false
        else if (data?.type === 'meter') this.reportEnabled = data.enabled === true
      }
    }
    process(inputs, outputs) {
      if (!this.active) return false
      const output = outputs[0]
      if (!output) return true
      this.gate.process(inputs[0] ?? [], output)
      this.framesSinceReport += output[0]?.length ?? 0
      if (this.reportEnabled && this.framesSinceReport >= sampleRate * 0.12) {
        this.framesSinceReport = 0
        this.port.postMessage({ levelDb: this.gate.levelDb, open: this.gate.open })
      }
      return true
    }
  }
  registerProcessor('ford-kall-microphone-sensitivity-v2', MicrophoneSensitivityWorklet)
}
