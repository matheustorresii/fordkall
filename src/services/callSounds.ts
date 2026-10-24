import { getCallSoundsEnabled } from '../storage/preferences'

export type CallSound =
  | 'join'
  | 'leave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'ring'

let audioContext: AudioContext | null = null

const getAudioContext = () => {
  if (audioContext) return audioContext
  if (typeof window === 'undefined') return null

  const AudioContextConstructor = window.AudioContext ?? (
    window as typeof window & { webkitAudioContext?: typeof AudioContext }
  ).webkitAudioContext
  if (!AudioContextConstructor) return null

  audioContext = new AudioContextConstructor()
  return audioContext
}

const tone = (
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
) => {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const filter = context.createBiquadFilter()

  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(2_400, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  oscillator.connect(filter)
  filter.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

const hornVoice = (
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
) => {
  const reed = context.createOscillator()
  const harmonic = context.createOscillator()
  const harmonicGain = context.createGain()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()

  reed.type = 'sawtooth'
  harmonic.type = 'square'
  reed.frequency.setValueAtTime(frequency * 0.96, start)
  reed.frequency.exponentialRampToValueAtTime(frequency, start + 0.022)
  harmonic.frequency.setValueAtTime(frequency * 2, start)
  harmonicGain.gain.setValueAtTime(0.13, start)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1_650, start)
  filter.Q.setValueAtTime(0.8, start)

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
  gain.gain.setValueAtTime(volume, start + duration - 0.065)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  reed.connect(filter)
  harmonic.connect(harmonicGain)
  harmonicGain.connect(filter)
  filter.connect(gain)
  gain.connect(context.destination)
  reed.start(start)
  harmonic.start(start)
  reed.stop(start + duration + 0.02)
  harmonic.stop(start + duration + 0.02)
}

const sweepTone = (
  context: AudioContext,
  startFrequency: number,
  endFrequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sawtooth',
) => {
  const oscillator = context.createOscillator()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()

  oscillator.type = type
  oscillator.frequency.setValueAtTime(startFrequency, start)
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration)
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(Math.max(startFrequency, endFrequency), start)
  filter.frequency.exponentialRampToValueAtTime(
    Math.min(startFrequency, endFrequency),
    start + duration,
  )
  filter.Q.setValueAtTime(2.4, start)

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.018)
  gain.gain.setValueAtTime(volume * 0.82, start + duration * 0.7)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  oscillator.connect(filter)
  filter.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

const noiseBurst = (
  context: AudioContext,
  start: number,
  duration: number,
  volume: number,
  filterFrequency: number,
) => {
  const frameCount = Math.ceil(context.sampleRate * duration)
  const buffer = context.createBuffer(1, frameCount, context.sampleRate)
  const samples = buffer.getChannelData(0)

  for (let index = 0; index < samples.length; index += 1) {
    const decay = 1 - index / samples.length
    samples[index] = (Math.random() * 2 - 1) * decay
  }

  const source = context.createBufferSource()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()

  source.buffer = buffer
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(filterFrequency, start)
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(110, filterFrequency * 0.42),
    start + duration,
  )
  filter.Q.setValueAtTime(0.8, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(context.destination)
  source.start(start)
  source.stop(start + duration + 0.02)
}

const playPattern = (context: AudioContext, sound: CallSound) => {
  const now = context.currentTime + 0.015

  switch (sound) {
    case 'ring':
      tone(context, 440, now, 0.18, 0.025, 'sine')
      tone(context, 554.37, now + 0.22, 0.2, 0.025, 'sine')
      break
    case 'join':
      // Compact dual-tone car horn: obvious enough to land the Ford Kall joke,
      // short and filtered enough not to punish everyone already in the room.
      hornVoice(context, 370, now, 0.34, 0.034)
      hornVoice(context, 466.16, now, 0.34, 0.029)
      break
    case 'leave':
      // Cartoon getaway: tires, a panicked horn, a soft crash and the tiny
      // metallic "hubcap" bounces. Entirely synthesized and under one second.
      sweepTone(context, 1_280, 510, now, 0.39, 0.026)
      sweepTone(context, 980, 390, now + 0.025, 0.36, 0.019, 'square')
      hornVoice(context, 311.13, now + 0.13, 0.23, 0.022)
      hornVoice(context, 392, now + 0.13, 0.23, 0.018)

      noiseBurst(context, now + 0.39, 0.2, 0.047, 760)
      sweepTone(context, 112, 54, now + 0.39, 0.2, 0.04, 'triangle')

      tone(context, 1_318.51, now + 0.57, 0.075, 0.023, 'triangle')
      tone(context, 987.77, now + 0.67, 0.07, 0.018, 'triangle')
      tone(context, 739.99, now + 0.77, 0.065, 0.013, 'triangle')
      break
    case 'mute':
      tone(context, 330, now, 0.105, 0.036, 'triangle')
      tone(context, 220, now + 0.06, 0.13, 0.042, 'triangle')
      break
    case 'unmute':
      tone(context, 277.18, now, 0.105, 0.036, 'triangle')
      tone(context, 415.3, now + 0.06, 0.14, 0.043, 'triangle')
      break
    case 'deafen':
      tone(context, 196, now, 0.15, 0.046, 'sine')
      tone(context, 196, now + 0.115, 0.15, 0.04, 'sine')
      break
    case 'undeafen':
      tone(context, 293.66, now, 0.13, 0.038, 'sine')
      tone(context, 440, now + 0.095, 0.17, 0.044, 'sine')
      break
  }
}

export const primeCallSounds = () => {
  if (!getCallSoundsEnabled()) return
  const context = getAudioContext()
  if (context?.state === 'suspended') {
    void context.resume().catch(() => undefined)
  }
}

export const playCallSound = (sound: CallSound) => {
  if (!getCallSoundsEnabled()) return
  const context = getAudioContext()
  if (!context) return

  const play = () => playPattern(context, sound)
  if (context.state === 'suspended') {
    void context.resume().then(play).catch(() => undefined)
    return
  }
  play()
}
