import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteAudioOutput } from '../src/services/remoteAudioOutput.ts'
import {
  CONTROL_SOUNDS,
  LatestControlFeedback,
} from '../src/services/controlFeedback.ts'
import {
  ExternalVideoRegistry,
  externalVideos,
  observeExternalVideo,
} from '../src/services/externalVideo.ts'
import { StreamPopout } from '../src/services/streamPopout.ts'
import {
  VideoSuspensionPolicy,
  setMediaSubscription,
} from '../src/services/videoSuspension.ts'

class Element extends EventTarget {
  children = []
  attrs = new Map()
  paused = true
  srcObject = null
  plays = 0
  clientWidth = 1120
  clientHeight = 720
  constructor(tag, doc) {
    super()
    this.tagName = tag
    this.ownerDocument = doc
  }
  setAttribute(key, value) {
    this.attrs.set(key, value)
  }
  removeAttribute(key) {
    this.attrs.delete(key)
  }
  append(...children) {
    children.forEach((c) => {
      c.ownerDocument = this.ownerDocument
    })
    this.children.push(...children)
  }
  replaceChildren(...children) {
    this.children = []
    this.append(...children)
  }
  remove() {
    this.removed = true
  }
  play() {
    this.paused = false
    this.plays++
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
  load() {}
}
class Doc extends EventTarget {
  hidden = false
  visibilityState = 'visible'
  constructor() {
    super()
    this.body = new Element('body', this)
    this.head = new Element('head', this)
  }
  createElement(tag) {
    return new Element(tag, this)
  }
  visible(value) {
    this.hidden = !value
    this.visibilityState = value ? 'visible' : 'hidden'
    this.dispatchEvent(new Event('visibilitychange'))
  }
}
class Popup extends EventTarget {
  document = new Doc()
  closed = false
  setTimeout = setTimeout
  clearTimeout = clearTimeout
  close() {
    if (this.closed) return
    this.closed = true
    this.dispatchEvent(new Event('pagehide'))
  }
}
const outputFixture = () => {
  const element = new Element('audio', new Doc())
  const track = {
    elements: new Set(),
    level: 1,
    graphGain: 0,
    attaches: 0,
    attach(element) {
      this.elements.add(element)
      this.attaches++
      element.srcObject = {}
      this.rebuild()
    },
    detach(element) {
      this.elements.delete(element)
      this.graphGain = this.elements.size ? this.level || 1 : 0
    },
    setVolume(level) {
      this.level = level
      if (this.elements.size) this.graphGain = level
    },
    // Reproduces LiveKit 2.22's falsy-zero check after startAudio/setAudioContext.
    rebuild() {
      this.graphGain = this.elements.size ? this.level || 1 : 0
    },
  }
  return { element, track, output: new RemoteAudioOutput(track, element) }
}
test('deafen removes the real output, so SDK graph recreation cannot turn volume zero into one', () => {
  const { output, track, element } = outputFixture()
  output.setLevel(0.8, false)
  assert.equal(track.graphGain, 0.8)
  output.setLevel(0.8, true)
  track.rebuild()
  output.resume()
  assert.equal(track.graphGain, 0)
  assert.equal(track.elements.size, 0)
  assert.equal(element.srcObject, null)
  output.setLevel(0.8, false)
  assert.equal(track.graphGain, 0.8)
  assert.equal(track.elements.size, 1)
  output.dispose()
})
test('rapid toggles always end at the latest requested state without accumulating attachments', () => {
  const { output, track } = outputFixture()
  for (let i = 0; i < 101; i++) {
    const silent = i % 2 === 0
    output.setLevel(6, silent)
    track.rebuild()
    output.resume()
    assert.equal(track.graphGain, silent ? 0 : 6)
    assert.equal(track.elements.size, silent ? 0 : 1)
  }
  output.dispose()
})
test('individual mute, zero volume and invalid levels stay silent through focus/resume', () => {
  const { output, track } = outputFixture()
  for (const [level, muted] of [
    [0, false],
    [4, true],
    [NaN, false],
    [-1, false],
    [Infinity, false],
  ]) {
    output.setLevel(1, false)
    output.setLevel(level, muted)
    output.resume()
    track.rebuild()
    assert.equal(track.graphGain, 0)
    assert.equal(track.elements.size, 0)
  }
  output.dispose()
})
test('changing a positive volume reuses one graph; disposal cannot be resurrected by a late resume', () => {
  const { output, track, element } = outputFixture()
  output.setLevel(1, false)
  output.setLevel(2, false)
  output.setLevel(20, false)
  assert.equal(track.attaches, 1)
  assert.equal(track.graphGain, 6)
  output.dispose()
  const plays = element.plays
  output.setLevel(1, false)
  output.resume()
  track.rebuild()
  assert.equal(element.plays, plays)
  assert.equal(track.elements.size, 0)
  assert.equal(track.graphGain, 0)
})
test('control feedback has a sustained, distinct two-note mic cue and three-note deafen cue', () => {
  for (const [sound, notes] of Object.entries(CONTROL_SOUNDS)) {
    assert.equal(notes.length, sound.includes('deafen') ? 3 : 2)
    const duration = Math.max(...notes.map((n) => n.offset + n.duration))
    assert.ok(duration >= 0.35 && duration <= 0.6)
    assert.ok(notes.every((n) => n.volume >= 0.15 && n.volume <= 0.2))
    assert.ok(notes.reduce((sum, n) => sum + n.volume, 0) < 0.6)
    const ascending = notes.at(-1).frequency > notes[0].frequency
    assert.equal(ascending, sound === 'unmute' || sound === 'undeafen')
  }
})
test('new control feedback cancels previous audio and ignores stale autoplay resumes', async () => {
  const queue = new LatestControlFeedback(),
    events = []
  let ready
  queue.play(
    () => {
      events.push('old')
      return () => events.push('cancel-old')
    },
    new Promise((resolve) => {
      ready = resolve
    }),
  )
  queue.play(() => {
    events.push('latest')
    return () => events.push('cancel-latest')
  })
  ready()
  await Promise.resolve()
  assert.deepEqual(events, ['latest'])
  queue.play(() => {
    events.push('newest')
    return () => events.push('cancel-newest')
  })
  queue.stop()
  assert.deepEqual(events, [
    'latest',
    'cancel-latest',
    'newest',
    'cancel-newest',
  ])
})
test('external visibility survives missing/replaced track objects and never revives explicit opt-out', () => {
  const registry = new ExternalVideoRegistry(),
    policy = new VideoSuspensionPolicy()
  const publication = {
    kind: 'video',
    isDesired: true,
    writes: [],
    setSubscribed(value) {
      this.isDesired = value
      this.writes.push(value)
    },
  }
  let visible = true
  const release = registry.register(publication, () => visible)
  policy.sync([publication], true, (p) => registry.active(p))
  assert.deepEqual(publication.writes, [])
  visible = false
  policy.sync([publication], true, (p) => registry.active(p))
  assert.equal(publication.isDesired, false)
  visible = true
  policy.sync([publication], true, (p) => registry.active(p))
  assert.equal(publication.isDesired, true)
  setMediaSubscription(publication, false)
  policy.sync([publication], true, (p) => registry.active(p))
  assert.equal(publication.isDesired, false)
  release()
  assert.equal(registry.active(publication), false)
})
test('multiple external viewers are reference-counted and a broken/closed window cannot keep video alive', () => {
  const registry = new ExternalVideoRegistry(),
    publication = {}
  const a = registry.register(publication, () => true),
    b = registry.register(publication, () => true)
  a()
  assert.equal(registry.active(publication), true)
  b()
  assert.equal(registry.active(publication), false)
  registry.register(publication, () => {
    throw Error('Cross origin')
  })
  assert.equal(registry.active(publication), false)
})
test('adaptive observer keeps an explicit viewer active while occluded, tracks resize and cleans up', () => {
  const popup = new Popup(),
    video = new Element('video', popup.document)
  let info,
    visibilityEvents = 0,
    resizeEvents = 0
  const track = {
    isAdaptiveStream: true,
    observeElementInfo(value) {
      info = value
      value.handleVisibilityChanged = () => visibilityEvents++
      value.handleResize = () => resizeEvents++
      value.observe()
    },
    stopObservingElementInfo(value) {
      value.stopObserving()
    },
  }
  const stop = observeExternalVideo(track, video, popup)
  assert.equal(info.visible, true)
  assert.equal(info.width(), 1120)
  popup.document.visible(false)
  assert.equal(info.visible, true)
  popup.document.visible(true)
  popup.dispatchEvent(new Event('resize'))
  assert.equal(info.visible, true)
  assert.equal(visibilityEvents, 0)
  assert.ok(resizeEvents >= 3)
  popup.closed = true
  popup.dispatchEvent(new Event('focus'))
  assert.equal(info.visible, false)
  assert.equal(visibilityEvents, 1)
  stop()
  popup.closed = false
  popup.document.visible(false)
  assert.equal(info.visible, false)
})
const videoTrack = () => ({
  isAdaptiveStream: true,
  elements: new Set(),
  infos: new Set(),
  attach(el) {
    this.elements.add(el)
    el.srcObject = {}
  },
  detach(el) {
    this.elements.delete(el)
  },
  observeElementInfo(info) {
    this.infos.add(info)
    info.observe()
  },
  stopObservingElementInfo(info) {
    info.stopObserving()
    this.infos.delete(info)
  },
})
test('popout rebinds a replaced track and publication, keeps only one video and releases all observers on close', () => {
  const popup = new Popup(),
    publication = {},
    nextPublication = {},
    first = videoTrack(),
    second = videoTrack()
  let closed = 0
  const popout = new StreamPopout(
    popup,
    new Doc(),
    '<QA>',
    publication,
    () => closed++,
  )
  popout.setTrack(first)
  assert.equal(first.elements.size, 1)
  assert.equal(first.infos.size, 1)
  popup.document.visible(false)
  assert.equal(externalVideos.active(publication), true)
  popout.setTrack(undefined)
  assert.equal(first.elements.size, 0)
  assert.equal(first.infos.size, 0)
  assert.equal(externalVideos.active(publication), true)
  popout.setPublication(nextPublication)
  popout.setTrack(second)
  assert.equal(externalVideos.active(publication), false)
  assert.equal(externalVideos.active(nextPublication), true)
  assert.equal(second.elements.size, 1)
  assert.equal(second.infos.size, 1)
  assert.equal(
    popup.document.body.children.filter((el) => el.tagName === 'video').length,
    1,
  )
  popup.close()
  assert.equal(closed, 1)
  assert.equal(second.elements.size, 0)
  assert.equal(second.infos.size, 0)
  assert.equal(externalVideos.active(nextPublication), false)
  popout.dispose()
  assert.equal(closed, 1)
})
test('disposing a popout from the main window closes it without recursively dispatching close', () => {
  const popup = new Popup(),
    track = videoTrack()
  let calls = 0
  const popout = new StreamPopout(popup, new Doc(), 'QA', {}, () => calls++)
  popout.setTrack(track)
  popout.dispose()
  assert.equal(popup.closed, true)
  assert.equal(calls, 0)
  assert.equal(track.elements.size, 0)
})
