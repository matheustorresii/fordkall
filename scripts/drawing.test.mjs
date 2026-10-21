import test from 'node:test'
import assert from 'node:assert/strict'
import { validStroke, paintDrawing } from '../src/games/drawing/model.ts'
import { DrawingReplica, jsonBytes } from '../src/games/drawing/replica.ts'
import { DrawingSession } from '../src/games/drawing/session.ts'

const stroke = (id, patch = {}) => ({
  id,
  color: '#263445',
  width: 4,
  order: 1,
  points: [
    { x: 10, y: 20 },
    { x: 150, y: 300 },
  ],
  ...patch,
})
const commit = (r, items, actor = 'alice', removed = []) => {
  const d = r.localDelta(items, removed, actor)
  r.apply(d)
  return d
}
const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))
test('drawing accepts only bounded strokes, not editor elements or images', () => {
  assert.ok(validStroke(stroke('a')))
  for (const patch of [
    { points: [] },
    { points: [{ x: 1001, y: 0 }] },
    { points: [{ x: 0, y: NaN }] },
    { width: 30 },
    { color: 'url(https://example.invalid)' },
    { id: '__proto__' },
    { order: Infinity },
  ])
    assert.equal(validStroke(stroke('a', patch)), false)
  assert.equal(
    validStroke({ id: 'a', type: 'image', src: 'data:image/png;base64,AA==' }),
    false,
  )
})
test('completed strokes are detached from mutable pointer arrays', () => {
  const r = new DrawingReplica(),
    s = stroke('a')
  commit(r, [s])
  s.points[0].x = 900
  assert.equal(r.scene()[0].points[0].x, 10)
})
test('concurrent commits converge regardless of delivery order', () => {
  const a = new DrawingReplica(),
    b = new DrawingReplica(),
    da = commit(a, [stroke('a')]),
    db = commit(b, [stroke('b')], 'bia')
  a.apply(db)
  b.apply(da)
  assert.deepEqual(a.snapshot(), b.snapshot())
})
test('undo is a tombstone and redo is a newer commit', () => {
  const r = new DrawingReplica(),
    old = commit(r, [stroke('a')])
  commit(r, [], 'alice', ['a'])
  r.apply(old)
  assert.equal(r.count, 0)
  commit(r, [stroke('a')])
  assert.equal(r.count, 1)
})
test('clear rejects stale gestures and malformed epochs do not erase a drawing', () => {
  const r = new DrawingReplica(),
    old = commit(r, [stroke('a')])
  r.clear('alice')
  r.apply(old)
  assert.equal(r.count, 0)
  commit(r, [stroke('b')])
  assert.throws(() =>
    r.apply({ epoch: { counter: 999, actor: 'x' }, elements: [{}] }),
  )
  assert.equal(r.count, 1)
})
test('long strokes preserve every sampled point through replication', () => {
  const a = new DrawingReplica(),
    b = new DrawingReplica(),
    points = Array.from({ length: 10000 }, (_, i) => ({
      x: i / 10,
      y: 300 + Math.sin(i) * 200,
    }))
  commit(a, [stroke('long', { points })])
  b.apply(a.snapshot())
  assert.deepEqual(b.scene()[0].points, points)
})
test('canvas renderer has no document tools and scales a shared surface consistently', () => {
  const calls = [],
    ctx = new Proxy(
      {},
      {
        set: (o, k, v) => {
          o[k] = v
          return true
        },
        get: (o, k) => o[k] || ((...args) => calls.push([k, ...args])),
      },
    )
  paintDrawing(ctx, 600, 360, [
    stroke('a'),
    stroke('dot', { points: [{ x: 500, y: 300 }] }),
  ])
  assert.ok(calls.some((x) => x[0] === 'scale' && x[1] === 0.6 && x[2] === 0.6))
  assert.ok(calls.some((x) => x[0] === 'stroke'))
  assert.ok(calls.some((x) => x[0] === 'arc'))
})
function mesh() {
  const sessions = [],
    sent = []
  let offline = false
  for (let i = 0; i < 3; i++) {
    const identity = `p${i}`
    sessions.push(
      new DrawingSession({
        identity,
        peers: () => ['p0', 'p1', 'p2'].filter((p) => p !== identity),
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
test('three clients retain strokes without a mounted game UI', async (t) => {
  const m = mesh()
  t.after(m.stop)
  m.sessions[0].update([stroke('a')])
  m.sessions[1].update([stroke('b')])
  await wait()
  assert.ok(m.sessions.every((s) => s.replica.count === 2))
  assert.equal(m.sessions[0].replica.digest(), m.sessions[2].replica.digest())
})
test('sync after a missed transmission repairs the drawing', async (t) => {
  const m = mesh()
  t.after(m.stop)
  m.offline(true)
  m.sessions[0].update([stroke('lost')])
  await wait()
  m.offline(false)
  m.sessions.forEach((s) => s.sync())
  await wait(300)
  assert.equal(m.sessions[2].replica.count, 1)
})
test('finishing waits for the in-flight batch and the last stroke', async (t) => {
  let a, b
  a = new DrawingSession({
    identity: 'alice',
    peers: () => ['bia'],
    control: async () => {},
    scene: async (d) => {
      await wait(20)
      b.receiveScene('alice', d)
    },
  })
  b = new DrawingSession({
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
  a.update([stroke('first')])
  const pending = a.flushNow()
  a.update([stroke('last')])
  await a.flushNow()
  await pending
  assert.equal(b.replica.count, 2)
})
test('failed last stroke remains available for retry', async (t) => {
  const m = mesh()
  t.after(m.stop)
  m.offline(true)
  m.sessions[0].update([stroke('pending')])
  await assert.rejects(m.sessions[0].flushNow(), /Sem conexão/)
  m.offline(false)
  await m.sessions[0].flushNow()
  await wait(5)
  assert.equal(m.sessions[2].replica.count, 1)
})
test('a gesture from before clear cannot resurrect the old drawing', async (t) => {
  const m = mesh()
  t.after(m.stop)
  const [a, b] = m.sessions,
    epoch = { ...a.replica.epoch }
  a.update([stroke('a')])
  await wait()
  b.clear()
  await wait()
  a.update([stroke('stale')], [], epoch)
  assert.equal(a.replica.count, 0)
})
test('only peers are accepted and removed activity commands do nothing', () => {
  const s = new DrawingSession({
    identity: 'p0',
    peers: () => ['p1'],
    control: async () => {},
    scene: async () => {},
  })
  s.start()
  try {
    const r = new DrawingReplica()
    const delta = commit(r, [stroke('a')], 'p1')
    s.receiveScene('outsider', delta)
    assert.equal(s.replica.count, 0)
    for (const kind of ['open', 'close', 'presence'])
      s.receiveControl('p1', { kind, id: `${Date.now()}:p1` })
    assert.equal(s.getView().count, 0)
    assert.equal('openId' in s.getView(), false)
  } finally {
    s.stop()
  }
})
