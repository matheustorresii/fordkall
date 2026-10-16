import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MICROPHONE_GATE, MicrophoneGate } from '../src/services/microphoneSensitivity.worklet.js'
import { clampMicrophoneThreshold, microphoneConstraints, microphonePresetFor, microphonePresets } from '../src/services/microphoneSettings.ts'

const signal = (rate, seconds, value) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => typeof value === 'function' ? value(i / rate) : value)
const render = (gate, input, quantum = 128) => {
  const output = new Float32Array(input.length)
  for (let i = 0; i < input.length; i += quantum) {
    const chunk = input.subarray(i, i + quantum), result = new Float32Array(chunk.length)
    gate.process([chunk], [result]); output.set(result, i)
  }
  return output
}
const rms = (samples) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
const maximum = (samples) => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0)

test('todos os perfis desligam explicitamente o isolamento oculto; ruído, eco e ganho são independentes', () => {
  for (const noiseSuppression of [true, false]) for (const echoCancellation of [true, false]) for (const autoGainControl of [true, false]) {
    assert.deepEqual(microphoneConstraints({ noiseSuppression, echoCancellation, autoGainControl }), { noiseSuppression, echoCancellation, autoGainControl, voiceIsolation: false })
  }
  assert.deepEqual(microphonePresets.natural, { noiseSuppression: false, echoCancellation: true, autoGainControl: false })
  assert.deepEqual(microphonePresets.unprocessed, { noiseSuppression: false, echoCancellation: false, autoGainControl: false })
  for (const preset of Object.keys(microphonePresets)) assert.equal(microphonePresetFor(microphonePresets[preset], false), preset)
  assert.equal(microphonePresetFor(microphonePresets.natural, true), 'custom')
  assert.equal(microphonePresetFor({ ...microphonePresets.natural, autoGainControl: true }, false), 'custom')
})
test('limiar inválido nunca vira NaN nem um nível impossível de abrir', () => {
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(clampMicrophoneThreshold(value), -48)
  assert.equal(clampMicrophoneThreshold(-300), -70)
  assert.equal(clampMicrophoneThreshold(20), -20)
  assert.equal(clampMicrophoneThreshold(-47.6), -48)
})
test('voz acima do limiar passa amostra por amostra, sem EQ, compressão, ganho ou distorção', () => {
  for (const rate of [44100, 48000, 96000]) for (const quantum of [64, 128, 256]) {
    const gate = new MicrophoneGate(rate)
    const input = signal(rate, 0.15, (t) => 0.2 * Math.sin(2 * Math.PI * 180 * t) + 0.08 * Math.sin(2 * Math.PI * 3400 * t) + 0.02 * Math.sin(2 * Math.PI * 8200 * t))
    const original = new Float32Array(input), output = render(gate, input, quantum)
    assert.deepEqual(input, original)
    assert.deepEqual(output.subarray(gate.delayFrames), input.subarray(0, input.length - gate.delayFrames))
    assert.equal(gate.open, true)
    assert.equal(gate.delayFrames, Math.round(rate * MICROPHONE_GATE.lookaheadSeconds))
  }
})
test('ruído abaixo do limiar fecha sem depender de timers, foco, abas ou taxa de quadros da UI', () => {
  const gate = new MicrophoneGate(48000)
  const output = render(gate, signal(48000, 1.5, 0.0002))
  assert.equal(gate.open, false)
  assert.ok(rms(output.subarray(48000)) < 1e-7)
  const source = readFileSync(new URL('../src/services/microphoneSensitivity.worklet.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /setInterval|setTimeout|document\.hidden|visibilitychange/)
})
test('lookahead preserva o início da primeira sílaba depois de silêncio prolongado', () => {
  const gate = new MicrophoneGate(48000)
  render(gate, signal(48000, 1.2, 0))
  assert.equal(gate.open, false)
  const output = render(gate, signal(48000, 0.1, 0.2))
  assert.ok(output[gate.delayFrames] / 0.2 > 0.99)
  assert.ok(rms(output.subarray(gate.delayFrames + 480)) > 0.199)
  assert.equal(gate.open, true)
})
test('histerese e hold preservam voz baixa e fim de palavras sem fechar entre sílabas', () => {
  const gate = new MicrophoneGate(48000, -48)
  render(gate, signal(48000, 0.15, 0.05))
  const tail = render(gate, signal(48000, 0.22, 0.001))
  assert.equal(gate.open, true)
  assert.ok(rms(tail.subarray(gate.delayFrames)) >= 0.000999)
  render(gate, signal(48000, 0.3, 10 ** (-51 / 20)))
  assert.equal(gate.open, true)
})
test('fechamento tem release gradual em vez de corte abrupto no meio da forma de onda', () => {
  const gate = new MicrophoneGate(48000)
  render(gate, signal(48000, 0.15, 0.05))
  const output = render(gate, signal(48000, 1.2, 0.0005))
  const tail = output.subarray(4800)
  let maxDelta = 0
  for (let i = 1; i < tail.length; i++) maxDelta = Math.max(maxDelta, Math.abs(tail[i] - tail[i - 1]))
  assert.ok(maxDelta < 0.000001)
  assert.equal(gate.gain, 0)
})
test('ajustar o limiar em uso reabre imediatamente para uma voz antes bloqueada', () => {
  const gate = new MicrophoneGate(48000, -20)
  render(gate, signal(48000, 1, 0.003))
  assert.equal(gate.open, false)
  gate.setThreshold(-70)
  const output = render(gate, signal(48000, 0.1, 0.003))
  assert.equal(gate.open, true)
  assert.ok(rms(output.subarray(2400)) > 0.00299)
})
test('não amplifica nem satura sinal forte; canais não mudam de fase ou vazam uns para os outros', () => {
  const gate = new MicrophoneGate(48000)
  const left = signal(48000, 0.2, (t) => 0.95 * Math.sin(2 * Math.PI * 1000 * t)), right = left.map((value) => -value)
  const output = [new Float32Array(left.length), new Float32Array(right.length)]
  gate.process([left, right], output)
  assert.ok(output.every((channel) => maximum(channel) <= maximum(left)))
  assert.deepEqual(output[0].subarray(gate.delayFrames), left.subarray(0, left.length - gate.delayFrames))
  assert.deepEqual(output[1].subarray(gate.delayFrames), right.subarray(0, right.length - gate.delayFrames))
})
test('buffers vazios, tamanhos de quantum variáveis e amostras inválidas não derrubam o worklet', () => {
  const gate = new MicrophoneGate(48000)
  gate.process([], [])
  for (const frames of [64, 128, 256, 512]) {
    const output = new Float32Array(frames)
    gate.process([], [output]); assert.ok(output.every(Number.isFinite))
    const invalid = new Float32Array(frames).fill(NaN)
    gate.process([invalid], [output]); assert.ok(output.every(Number.isFinite))
  }
  assert.ok(Number.isFinite(gate.levelDb))
})
