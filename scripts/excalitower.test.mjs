import test from 'node:test'
import assert from 'node:assert/strict'
import { BoardReplica, MAX_BOARD_ELEMENTS, MAX_BOARD_FILE_BYTES, validBoardElement, validBoardFile, jsonBytes } from '../src/whiteboard/replica.ts'
import { ExcalitowerSession } from '../src/whiteboard/session.ts'

const element = (id, patch = {}) => ({ id, type: 'rectangle', x: 50, y: 80, width: 120, height: 80, angle: 0, version: 1, versionNonce: 2_000_000_000, isDeleted: false, strokeColor: '#263445', backgroundColor: 'transparent', opacity: 100, groupIds: [], index: 'a0', ...patch })
const delta = (elements = [], files = {}, epoch = { counter: 0, actor: '' }) => ({ elements, files, epoch })
const image = (id = 'image-1', text = 'aGVsbG8=') => ({ id, mimeType: 'image/png', dataURL: `data:image/png;base64,${text}`, created: Date.now() })
const pause = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms))
function mesh(count = 3) {
  const sessions = [], online = new Set(Array.from({ length: count }, (_, i) => `p${i}`)), controls = [], scenes = []
  let drop = false, fail = false
  const route = async (from, value, to, scene = false) => {
    if (fail) throw new Error('simulated transport failure')
    if (drop) return
    const copy = structuredClone(value)
    if (!scene) { assert.ok(jsonBytes(copy) < 2_048); controls.push(copy) } else scenes.push(copy)
    queueMicrotask(() => sessions.forEach((session, i) => {
      const id = `p${i}`
      if (id === from || !online.has(id) || !online.has(from) || to && id !== to) return
      if (scene) session.receiveScene(from, copy); else session.receiveControl(from, copy)
    }))
  }
  for (let i = 0; i < count; i++) {
    const identity = `p${i}`
    sessions.push(new ExcalitowerSession({ identity, peers: () => [...online].filter((id) => id !== identity), control: (value, to) => route(identity, value, to), scene: (value, to) => route(identity, value, to, true) }))
  }
  sessions.forEach((session) => session.start())
  return { sessions, online, controls, scenes, drop: (value) => { drop = value }, fail: (value) => { fail = value }, stop: () => sessions.forEach((session) => session.stop()) }
}

test('accepts actual unsigned Excalidraw nonces and validates timestamps', () => {
  assert.equal(validBoardElement(element('a')), true)
  assert.equal(validBoardElement(element('a', { versionNonce: 0xffffffff })), true)
  assert.equal(validBoardFile(image()), true)
  assert.equal(validBoardFile({ ...image(), created: NaN }), false)
})
test('concurrent different elements merge in either delivery order', () => {
  const a = new BoardReplica(), b = new BoardReplica()
  a.apply(delta([element('a')])); b.apply(delta([element('b')]))
  const da = a.snapshot(), db = b.snapshot()
  a.apply(db); b.apply(da)
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.equal(a.count, 2)
})
test('higher element version wins without clobbering other elements', () => {
  const r = new BoardReplica()
  r.apply(delta([element('a', { version: 8, x: 700 }), element('b')]))
  r.apply(delta([element('a', { version: 7, x: 200 })]))
  assert.equal(r.snapshot().elements.find((e) => e.id === 'a').x, 700)
  assert.equal(r.count, 2)
})
test('same-version concurrent edits converge via lower nonce like Excalidraw', () => {
  const a = new BoardReplica(), b = new BoardReplica()
  const first = delta([element('x', { versionNonce: 77, x: 10 })]), second = delta([element('x', { versionNonce: 55, x: 20 })])
  a.apply(first); a.apply(second); b.apply(second); b.apply(first)
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.equal(a.snapshot().elements[0].x, 20)
})
test('deletion tombstones stop late snapshots from resurrecting elements', () => {
  const r = new BoardReplica(), old = delta([element('a')])
  r.apply(old); r.apply(delta([element('a', { version: 2, isDeleted: true })])); r.apply(old)
  assert.equal(r.count, 0); assert.equal(r.snapshot().elements.length, 1)
})
test('undo can intentionally restore a tombstoned element with a higher version', () => {
  const r = new BoardReplica()
  r.apply(delta([element('a', { version: 2, isDeleted: true })]))
  r.apply(delta([element('a', { version: 3 })])); assert.equal(r.count, 1)
})
test('fractional indexes preserve layer order, independent of arrival order', () => {
  const r = new BoardReplica()
  r.apply(delta([element('front', { index: 'a2' }), element('back', { index: 'a0' }), element('middle', { index: 'a1' })]))
  assert.deepEqual(r.snapshot().elements.map((e) => e.id), ['back', 'middle', 'front'])
})
test('clear epochs defeat stale changes and old snapshots', () => {
  const r = new BoardReplica(), old = delta([element('a')])
  r.apply(old); const clear = r.clear('p0'); r.apply(old)
  assert.equal(r.count, 0); assert.equal(clear.epoch.counter, 1)
  r.apply(delta([element('b')], {}, clear.epoch)); assert.equal(r.count, 1)
})
test('simultaneous clears converge deterministically', () => {
  const a = new BoardReplica(), b = new BoardReplica()
  const da = a.clear('a'), db = b.clear('b')
  a.apply(db); b.apply(da); assert.deepEqual(a.snapshot(), b.snapshot())
})
test('invalid packets do not partially mutate or clear the document', () => {
  const r = new BoardReplica(); r.apply(delta([element('original')]))
  assert.throws(() => r.apply(delta([element('bad', { x: NaN })], {}, { counter: 2, actor: 'bad' })))
  assert.equal(r.count, 1); assert.equal(r.epoch.counter, 0)
})
test('rejects embeds, unsafe links, prototype keys and malformed strokes', () => {
  for (const patch of [{ type: 'embeddable' }, { type: 'iframe' }, { link: 'javascript:alert(1)' }, { id: '__proto__' }, { type: 'freedraw', points: [[1, null]] }, { version: -1 }, { index: '<div>' }]) assert.equal(validBoardElement(element('a', patch)), false)
})
test('rejects excessive scenes atomically', () => {
  const r = new BoardReplica()
  assert.throws(() => r.apply(delta(Array.from({ length: MAX_BOARD_ELEMENTS + 1 }, (_, i) => element(`e${i}`)))))
  assert.equal(r.count, 0)
})
test('only raster data images are accepted; oversized and external images are rejected', () => {
  assert.equal(validBoardFile({ ...image(), mimeType: 'image/svg+xml' }), false)
  assert.equal(validBoardFile({ ...image(), dataURL: 'https://example.test/image.png' }), false)
  assert.equal(validBoardFile(image('big', 'A'.repeat(Math.ceil(MAX_BOARD_FILE_BYTES / 3) * 4 + 8))), false)
})
test('image files merge once and travel with snapshots', () => {
  const a = new BoardReplica(), b = new BoardReplica(), file = image()
  a.apply(delta([element('picture', { type: 'image', fileId: file.id })], { [file.id]: file }))
  b.apply(a.snapshot()); b.apply(a.snapshot())
  assert.deepEqual(b.snapshot(), a.snapshot()); assert.equal(Object.keys(b.snapshot().files).length, 1)
})
test('replica detaches mutable editor data', () => {
  const input = element('x'), r = new BoardReplica(); r.apply(delta([input])); input.x = 555; input.version = 99
  assert.equal(r.snapshot().elements[0].x, 50); assert.equal(r.snapshot().elements[0].version, 1)
})
test('local delta excludes unchanged elements and image data during pointer movement', () => {
  const r = new BoardReplica(), file = image(), original = element('a')
  r.apply(delta([original], { [file.id]: file }))
  const unchanged = r.localDelta([original], { [file.id]: file })
  assert.equal(unchanged.elements.length, 0); assert.equal(Object.keys(unchanged.files).length, 0)
  const moved = r.localDelta([{ ...original, version: 2, x: 200 }], { [file.id]: file })
  assert.equal(moved.elements.length, 1); assert.equal(Object.keys(moved.files).length, 0)
})
test('digest distinguishes tombstones and same version sums', () => {
  const a = new BoardReplica(), b = new BoardReplica()
  a.apply(delta([element('a', { version: 1 }), element('b', { version: 3 })])); b.apply(delta([element('a', { version: 2 }), element('b', { version: 2 })]))
  assert.notEqual(a.digest(), b.digest()); const before = a.digest(); a.clear('p0'); assert.notEqual(a.digest(), before)
})
test('live sessions broadcast edits and concurrently create without losing strokes', async (t) => {
  const m = mesh(); t.after(m.stop)
  m.sessions[0].update([element('a')], {}); m.sessions[1].update([element('b')], {})
  await pause()
  assert.equal(m.sessions[2].replica.count, 2)
  assert.equal(new Set(m.sessions.map((s) => s.replica.digest())).size, 1)
})
test('late join receives complete scene including image and tombstone from remaining peers', async (t) => {
  const m = mesh(); t.after(m.stop)
  m.online.delete('p2'); m.sessions[2].stop()
  const file = image()
  m.sessions[0].update([element('x', { type: 'image', fileId: file.id }), element('removed', { isDeleted: true })], { [file.id]: file }); await pause()
  m.online.delete('p0'); m.sessions[0].stop(); m.online.add('p2'); m.sessions[2].start(); m.sessions[1].peersChanged()
  await pause()
  assert.deepEqual(m.sessions[2].replica.snapshot(), m.sessions[1].replica.snapshot())
  assert.equal(m.sessions[2].replica.snapshot().elements.length, 2)
  assert.equal(Object.keys(m.sessions[2].replica.snapshot().files).length, 1)
})
test('anti-entropy repairs missed updates on reconnect', async (t) => {
  const m = mesh(2); t.after(m.stop); m.drop(true)
  m.sessions[0].update([element('missed')], {}); await pause(); assert.equal(m.sessions[1].replica.count, 0)
  m.drop(false); m.sessions[1].sync(); await pause()
  assert.equal(m.sessions[1].replica.count, 1)
})
test('failed send keeps local work and retry converges', async (t) => {
  const m = mesh(2); t.after(m.stop); m.fail(true)
  m.sessions[0].update([element('offline')], {}); await pause(); assert.ok(m.sessions[0].getView().error)
  m.fail(false); m.sessions[0].sync(); await pause()
  assert.equal(m.sessions[1].replica.count, 1); assert.equal(m.sessions[0].getView().error, '')
})
test('a validation notice does not block subsequent valid edits or get silently dismissed', async (t) => {
  const m = mesh(2); t.after(m.stop)
  m.sessions[0].setError('Imagem grande demais.')
  m.sessions[0].update([element('a')], {}); await pause()
  m.sessions[0].update([element('a'), element('b')], {}); await pause()
  assert.equal(m.sessions[1].replica.count, 2)
  assert.equal(m.sessions[0].getView().error, 'Imagem grande demais.')
  m.sessions[0].setError(''); assert.equal(m.sessions[0].getView().error, '')
})
test('clear syncs to all peers and rejects the old editor epoch', async (t) => {
  const m = mesh(); t.after(m.stop)
  m.sessions[0].update([element('x')], {}); await pause(); const old = { ...m.sessions[1].replica.epoch }
  m.sessions[0].clear(); await pause()
  m.sessions[1].update([element('stale')], {}, old); await pause()
  assert.ok(m.sessions.every((s) => s.replica.count === 0))
})
test('large freehand uses scene stream, never oversized control data', async (t) => {
  const m = mesh(2); t.after(m.stop)
  m.sessions[0].update([element('stroke', { type: 'freedraw', points: Array.from({ length: 8_000 }, (_, i) => [i, i / 3]) })], {})
  await pause()
  assert.ok(m.scenes.some((message) => jsonBytes(message) > 15 * 1024)); assert.equal(m.sessions[1].replica.count, 1)
})
test('cursor and spectator state are ephemeral and disappear on minimizing', async (t) => {
  const m = mesh(2); t.after(m.stop)
  m.sessions[0].setVisible(true, false); m.sessions[0].pointer({ x: 22, y: 30, tool: 'pointer', button: 'up' }); await pause(20)
  assert.equal(m.sessions[1].getView().presence[0].editing, false)
  assert.equal(m.sessions[1].getView().presence[0].cursor.x, 22)
  m.sessions[0].setVisible(false); await pause(20)
  assert.equal(m.sessions[1].getView().presence.length, 0)
  assert.equal(m.sessions[1].replica.count, 0)
})
test('unconnected senders cannot modify the board or impersonate cursors', (t) => {
  const m = mesh(2); t.after(m.stop)
  m.sessions[0].receiveScene('intruder', delta([element('no')]))
  m.sessions[0].receiveControl('intruder', { kind: 'presence', visible: true })
  assert.equal(m.sessions[0].replica.count, 0); assert.equal(m.sessions[0].getView().presence.length, 0)
})
test('new room starts empty after all previous sessions are disposed', async () => {
  const a = mesh(1); a.sessions[0].update([element('private')], {}); a.stop()
  const b = mesh(1); assert.equal(b.sessions[0].replica.count, 0); b.stop()
})
test('repeated identical editor notices do not cause a render feedback loop', (t) => {
  const m = mesh(1); t.after(m.stop)
  let renders = 0
  const unsubscribe = m.sessions[0].subscribe(() => renders++)
  for (let i = 0; i < 100; i++) m.sessions[0].setError('Imagem grande demais.')
  assert.equal(renders, 1)
  unsubscribe()
})
test('unused cached files cannot re-enter an empty epoch after a shared clear', (t) => {
  const m = mesh(1); t.after(m.stop)
  const file = image(), s = m.sessions[0]
  s.update([element('picture', { type: 'image', fileId: file.id })], { [file.id]: file })
  assert.equal(Object.keys(s.replica.snapshot().files).length, 1)
  s.clear(); s.update([], { [file.id]: file })
  assert.equal(Object.keys(s.replica.snapshot().files).length, 0)
})
