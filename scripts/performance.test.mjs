import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import {
  VideoSuspensionPolicy,
  setMediaSubscription,
} from '../src/services/videoSuspension.ts'
import {
  summarizeRtcReports,
  rtcRates,
} from '../src/services/performanceStats.ts'
const publication = (kind = 'video', wanted = true) => ({
  kind,
  isDesired: wanted,
  writes: [],
  setSubscribed(value) {
    this.isDesired = value
    this.writes.push(value)
  },
})
test('game mode suspends only remote video, preserving both voice and screen audio', () => {
  const policy = new VideoSuspensionPolicy(),
    camera = publication(),
    screen = publication(),
    voice = publication('audio'),
    screenAudio = publication('audio')
  policy.sync([camera, screen, voice, screenAudio], true)
  assert.equal(policy.count, 2)
  assert.deepEqual(voice.writes, [])
  assert.deepEqual(screenAudio.writes, [])
  policy.restore([camera, screen, voice, screenAudio])
  assert.equal(camera.isDesired, true)
  assert.equal(screen.isDesired, true)
})
test('stopping a stream while minimized is not undone on returning to the app', () => {
  const policy = new VideoSuspensionPolicy(),
    screen = publication()
  policy.sync([screen], true)
  setMediaSubscription(screen, false)
  policy.restore([screen])
  assert.equal(screen.isDesired, false)
})
test('unwatched streams remain unwatched; detached PiP/popout video stays active', () => {
  const policy = new VideoSuspensionPolicy(),
    pip = publication(),
    unwatched = publication('video', false)
  policy.sync([pip, unwatched], true, (video) => video === pip)
  assert.deepEqual(pip.writes, [])
  assert.deepEqual(unwatched.writes, [])
})
test('RTC counters deduplicate reports and diagnostics retain no identities/IPs/SDP', () => {
  const rows = [
    {
      id: 'one',
      type: 'inbound-rtp',
      bytesReceived: 10000,
      packetsReceived: 98,
      packetsLost: 2,
      ip: 'SECRET',
    },
    { id: 'two', type: 'outbound-rtp', bytesSent: 5000 },
    {
      id: 'pair',
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      currentRoundTripTime: 0.025,
      address: 'SECRET',
    },
  ]
  const report = new Map(rows.map((row) => [row.id, row])),
    summary = summarizeRtcReports([report, report])
  assert.equal(summary.bytesIn, 10000)
  assert.equal(summary.bytesOut, 5000)
  assert.equal(summary.rttMs, 25)
  assert.ok(!JSON.stringify(summary).includes('SECRET'))
  const rates = rtcRates(
    { bytesIn: 0, bytesOut: 0, packets: 0, lost: 0 },
    summary,
    2000,
  )
  assert.equal(rates.inboundKbps, 40)
  assert.equal(rates.lossPercent, 2)
})
test('closing the meter stops worklet/UI reports without changing a single audio sample', async () => {
  const source = (
    await readFile(
      new URL(
        '../src/services/microphoneSensitivity.worklet.js',
        import.meta.url,
      ),
      'utf8',
    )
  ).replaceAll('export ', '')
  let Processor
  class Base {
    constructor() {
      this.messages = []
      this.port = { postMessage: (message) => this.messages.push(message) }
    }
  }
  vm.runInNewContext(source, {
    AudioWorkletProcessor: Base,
    sampleRate: 48000,
    registerProcessor(_name, value) {
      Processor = value
    },
  })
  const visible = new Processor({ processorOptions: { thresholdDb: -48 } }),
    hidden = new Processor({ processorOptions: { thresholdDb: -48 } })
  hidden.port.onmessage({ data: { type: 'meter', enabled: false } })
  for (let i = 0; i < 3750; i++) {
    const input = new Float32Array(128).fill(0.1),
      a = new Float32Array(128),
      b = new Float32Array(128)
    visible.process([[input]], [[a]])
    hidden.process([[input]], [[b]])
    assert.deepEqual(a, b)
  }
  assert.ok(visible.messages.length >= 80)
  assert.equal(hidden.messages.length, 0)
  console.log(
    `Measured over 10s: meter messages ${visible.messages.length} -> ${hidden.messages.length}; audio output identical`,
  )
})
