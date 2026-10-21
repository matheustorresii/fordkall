import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BoardReplica,
  validBoardElement,
  jsonBytes,
} from '../src/whiteboard/replica.ts'
import { ExcalitowerSession } from '../src/whiteboard/session.ts'
const shape = (id, patch = {}) => ({
  id,
  type: 'rectangle',
  x: 100,
  y: 120,
  w: 220,
  h: 140,
  rotation: 0,
  strokeColor: '#9ad4c3',
  fillColor: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  zIndex: 1,
  seed: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...patch,
})
const commit = (r, e, actor = 'alice', removed = []) => {
  const d = r.localDelta(e, removed, actor)
  r.apply(d)
  return d
}
test('uses the actual 11A3 model, not Excalidraw dimensions/nonces', () => {
  assert.equal(validBoardElement(shape('a')), true)
  assert.equal(validBoardElement({ ...shape('a'), w: NaN }), false)
  assert.equal(validBoardElement(shape('a', { type: 'iframe' })), false)
})
test('concurrent shapes converge independently of delivery order', () => {
  const a = new BoardReplica(),
    b = new BoardReplica()
  const da = commit(a, [shape('a')]),
    db = commit(b, [shape('b')], 'bia')
  a.apply(db)
  b.apply(da)
  assert.deepEqual(a.snapshot(), b.snapshot())
  assert.equal(a.count, 2)
})
test('same-element conflict converges by version and author', () => {
  const a = new BoardReplica(),
    b = new BoardReplica()
  const da = commit(a, [shape('a', { w: 200 })]),
    db = commit(b, [shape('a', { w: 600 })], 'bia')
  a.apply(db)
  b.apply(da)
  assert.deepEqual(a.snapshot(), b.snapshot())
  assert.equal(a.scene()[0].w, 600)
})
test('committed patch is detached from mutable canvas references', () => {
  const r = new BoardReplica(),
    e = shape('a')
  commit(r, [e])
  e.w = 2
  assert.equal(r.scene()[0].w, 220)
})
test('deleting does not resurrect on a late snapshot; undo is a new commit', () => {
  const r = new BoardReplica()
  const old = commit(r, [shape('a')])
  commit(r, [], 'alice', ['a'])
  r.apply(old)
  assert.equal(r.count, 0)
  commit(r, [shape('a')])
  assert.equal(r.count, 1)
})
test('remote additions absent from a local patch are never mistaken for deletions', () => {
  const r = new BoardReplica()
  commit(r, [shape('remote')], 'bia')
  commit(r, [shape('local')])
  assert.equal(r.count, 2)
})
test('clear epochs reject old gestures and invalid clears atomically', () => {
  const r = new BoardReplica(),
    old = commit(r, [shape('a')])
  r.clear('alice')
  r.apply(old)
  assert.equal(r.count, 0)
  assert.throws(() =>
    r.apply({
      epoch: { counter: 99, actor: 'x' },
      elements: [{ id: 'a', version: 1, actor: 'x', element: {} }],
    }),
  )
  assert.equal(r.epoch.counter, 1)
})
test('freehand commits preserve every point through a remote snapshot', () => {
  const r = new BoardReplica(),
    points = Array.from({ length: 800 }, (_, i) => ({
      x: i,
      y: Math.sin(i) * 40,
    }))
  commit(r, [shape('ink', { type: 'freehand', points })])
  const b = new BoardReplica()
  b.apply(r.snapshot())
  assert.equal(b.scene()[0].points.length, 800)
})
test('images are raster-only, bounded and part of the session scene', () => {
  assert.equal(
    validBoardElement(
      shape('i', {
        type: 'image',
        src: 'https://tracking.invalid/x',
        naturalW: 100,
        naturalH: 100,
      }),
    ),
    false,
  )
  assert.equal(
    validBoardElement(
      shape('i', {
        type: 'image',
        src: 'data:image/svg+xml;base64,abc=',
        naturalW: 100,
        naturalH: 100,
      }),
    ),
    false,
  )
  assert.equal(
    validBoardElement(
      shape('i', {
        type: 'image',
        src: 'data:image/png;base64,aGVsbG8=',
        naturalW: 100,
        naturalH: 100,
      }),
    ),
    true,
  )
})
function mesh() {
  const sessions = [],
    sent = []
  let offline = false
  for (let i = 0; i < 3; i++) {
    const identity = `p${i}`
    sessions.push(
      new ExcalitowerSession({
        identity,
        peers: () => ['p0', 'p1', 'p2'].filter((x) => x !== identity),
        control: async (message, to) => {
          if (offline) throw Error('offline')
          assert.ok(jsonBytes(message) < 2048)
          queueMicrotask(() =>
            sessions.forEach((s, j) => {
              if (j !== i && (!to || to === `p${j}`))
                s.receiveControl(identity, structuredClone(message))
            }),
          )
        },
        scene: async (message, to) => {
          if (offline) throw Error('offline')
          sent.push(message)
          queueMicrotask(() =>
            sessions.forEach((s, j) => {
              if (j !== i && (!to || to === `p${j}`))
                s.receiveScene(identity, structuredClone(message))
            }),
          )
        },
      }),
    )
  }
  sessions.forEach((s) => s.start())
  return {
    sessions,
    sent,
    offline: (v) => {
      offline = v
    },
    stop: () => sessions.forEach((s) => s.stop()),
  }
}
const wait = (n = 200) => new Promise((r) => setTimeout(r, n))
test('three peers synchronize commits, not pointer/selection updates', async (t) => {
  const m = mesh()
  t.after(m.stop)
  const [a, b, c] = m.sessions
  a.update([shape('alice')])
  b.update([shape('bia')])
  await wait()
  assert.equal(c.replica.count, 2)
  assert.equal(a.replica.digest(), b.replica.digest())
  const before = m.sent.length
  a.setVisible(true)
  for (let i = 0; i < 100; i++)
    a.pointer({ x: i, y: i, tool: 'pointer', button: 'down' })
  await wait()
  assert.equal(m.sent.length, before)
})
test('opening once moves all peers to the same activity; local minimizing does not reopen it', async (t) => {
  const m = mesh()
  t.after(m.stop)
  m.sessions[0].open()
  await wait()
  assert.ok(
    m.sessions.every(
      (s) => s.getView().openId === m.sessions[0].getView().openId,
    ),
  )
  const key = m.sessions[1].getView().openId
  m.sessions[1].setVisible(false)
  m.sessions[0].sync()
  await wait()
  assert.equal(m.sessions[1].getView().openId, key)
})
test('minimized peers retain the document and late re-sync repairs a missed commit', async (t) => {
  const m = mesh()
  t.after(m.stop)
  m.offline(true)
  m.sessions[0].update([shape('a')])
  await wait()
  m.offline(false)
  m.sessions.forEach((s) => s.sync())
  await wait(400)
  assert.equal(m.sessions[2].replica.count, 1)
  assert.equal(m.sessions[0].replica.digest(), m.sessions[2].replica.digest())
})
test('explicit flush completes before finishing a drawing turn', async (t) => {
  const m = mesh()
  t.after(m.stop)
  m.sessions[0].update([shape('last-stroke')])
  await m.sessions[0].flushNow()
  await wait(5)
  assert.equal(m.sessions[2].replica.count, 1)
})
test('old mounted editor cannot resurrect content after clear', async (t) => {
  const m = mesh()
  t.after(m.stop)
  const a = m.sessions[0],
    b = m.sessions[1],
    epoch = { ...a.replica.epoch }
  a.update([shape('a')])
  await wait()
  b.clear()
  await wait()
  a.update([shape('stale')], [], epoch)
  assert.equal(a.replica.count, 0)
})

test('closed boards cannot reopen from a delayed control or reconnect handshake', async (t) => {
  const m = mesh()
  t.after(m.stop)
  const [a, b, c] = m.sessions
  a.open()
  await wait(5)
  const oldOpen = a.getView().openId
  b.closeForAll()
  await wait(5)
  c.receiveControl('p0', { kind: 'open', id: oldOpen })
  a.sync()
  await wait(5)
  assert.ok(m.sessions.every((s) => s.getView().openId === ''))
  c.open()
  await wait(5)
  assert.ok(m.sessions.every((s) => s.getView().openId === c.getView().openId))
})

test('final drawing flush waits for an in-flight batch and the last stroke', async (t) => {
  let a, b
  a = new ExcalitowerSession({
    identity: 'alice',
    peers: () => ['bia'],
    control: async () => {},
    scene: async (delta) => {
      await wait(20)
      b.receiveScene('alice', delta)
    },
  })
  b = new ExcalitowerSession({
    identity: 'bia',
    peers: () => ['alice'],
    control: async () => {},
    scene: async () => {},
  })
  a.start()
  b.start()
  t.after(() => {
    a.stop()
    b.stop()
  })
  a.update([shape('first')])
  const first = a.flushNow()
  a.update([shape('last')])
  await a.flushNow()
  assert.equal(b.replica.count, 2)
  assert.equal(a.replica.digest(), b.replica.digest())
  await first
})

test('finishing a drawing reports send failure and retains the stroke for retry', async (t) => {
  const m = mesh()
  t.after(m.stop)
  const [a, b] = m.sessions
  m.offline(true)
  a.update([shape('pending-stroke')])
  await assert.rejects(a.flushNow(), /Sem conexão/)
  assert.equal(a.replica.count, 1)
  m.offline(false)
  await a.flushNow()
  await wait(5)
  assert.equal(b.replica.count, 1)
})
