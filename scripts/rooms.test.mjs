import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshCallDirectory } from '../supabase/functions/_shared/callDirectory.ts'
import { normalizeCallDirectory } from '../src/services/roomDirectoryPolicy.ts'
import { startRoomHeartbeat } from '../src/services/roomHeartbeat.ts'

const user = '11111111-1111-1111-1111-111111111111'
test('directory inspects direct projects once per shared lease; never inspects private room codes', async () => {
  const calls = [],
    writes = []
  const result = await refreshCallDirectory(
    [
      { id: 'a', kind: 'direct' },
      { id: 'b', kind: 'direct' },
      { id: 'sandbox', kind: 'sandbox' },
    ],
    ['PUBLIC'],
    {
      async claim(id) {
        calls.push(id)
        return id === 'a' ? 'lease' : null
      },
      async inspect(id, codes) {
        assert.equal(id, 'a')
        assert.deepEqual(codes, ['PUBLIC'])
        return [
          { code: 'PUBLIC', user_ids: [user, user, 'bot'] },
          { code: 'PRIVATE', user_ids: [user] },
        ]
      },
      async finish(id, lease, rooms) {
        writes.push({ id, lease, rooms })
      },
    },
  )
  assert.deepEqual(calls, ['a', 'b'])
  assert.deepEqual(result, [true, true])
  assert.deepEqual(writes[0].rooms, [{ code: 'PUBLIC', user_ids: [user] }])
})
test('upstream failure preserves last successful snapshot instead of publishing an empty directory', async () => {
  const writes = []
  const result = await refreshCallDirectory(
    [{ id: 'a', kind: 'direct' }],
    ['PUBLIC'],
    {
      async claim() {
        return 'lease'
      },
      async inspect() {
        throw Error('timeout')
      },
      async finish(_id, _lease, rooms) {
        writes.push(rooms)
      },
    },
  )
  assert.deepEqual(result, [false])
  assert.deepEqual(writes, [null])
})
test('a confirmed empty server room list really removes stale attendance', async () => {
  let published
  await refreshCallDirectory([{ id: 'a', kind: 'direct' }], ['PUBLIC'], {
    async claim() {
      return 'lease'
    },
    async inspect() {
      return []
    },
    async finish(_id, _lease, rooms) {
      published = rooms
    },
  })
  assert.deepEqual(published, [])
})
test('one unavailable project does not hide rooms in another project', async () => {
  const result = await refreshCallDirectory(
    [
      { id: 'a', kind: 'direct' },
      { id: 'b', kind: 'direct' },
    ],
    ['PUBLIC'],
    {
      async claim(id) {
        return id
      },
      async inspect(id) {
        if (id === 'a') throw Error()
        return [{ code: 'PUBLIC', user_ids: [user] }]
      },
      async finish() {},
    },
  )
  assert.deepEqual(result, [false, true])
})
test('public normalization rejects private records, invalid codes and empty attendance; recent private history is separate', () => {
  const data = normalizeCallDirectory({
    rooms: [
      { code: 'PRIVATE', is_private: true, user_ids: [user] },
      { code: '<script>', user_ids: [user] },
      { code: 'EMPTY', user_ids: [] },
      { code: 'PUBLIC', user_ids: [user, user] },
    ],
    recentRooms: [
      {
        code: 'PRIVATE',
        is_private: true,
        last_joined_at: '2026-10-24T12:00:00Z',
      },
    ],
  })
  assert.deepEqual(data.rooms, [{ code: 'PUBLIC', user_ids: [user] }])
  assert.equal(data.recentRooms[0].code, 'PRIVATE')
  assert.equal(data.recentRooms[0].is_private, true)
  assert.deepEqual(normalizeCallDirectory(null).rooms, [])
})
function target(extra = {}) {
  const listeners = new Map()
  return {
    ...extra,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    fire(type) {
      listeners.get(type)?.forEach((fn) => fn())
    },
    get listenerCount() {
      return [...listeners.values()].reduce((n, set) => n + set.size, 0)
    },
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
function heartbeat(send = async () => {}) {
  let interval,
    cleared = false,
    connected = true
  const win = target({
    setInterval(fn) {
      interval = fn
      return 1
    },
    clearInterval() {
      cleared = true
    },
  })
  const doc = target({ visibilityState: 'visible' })
  const sends = []
  const api = startRoomHeartbeat({
    window: win,
    document: doc,
    connected: () => connected,
    async send(leave) {
      sends.push(leave)
      return send(leave)
    },
  })
  return {
    ...api,
    win,
    doc,
    sends,
    interval: () => interval(),
    get cleared() {
      return cleared
    },
    disconnect() {
      connected = false
    },
  }
}
test('heartbeat refreshes immediately on focus, visibility, network return and reconnection', async () => {
  const h = heartbeat()
  await tick()
  for (const event of ['focus', 'online', 'pageshow']) {
    h.win.fire(event)
    await tick()
  }
  h.doc.fire('visibilitychange')
  await tick()
  await h.refresh()
  assert.deepEqual(h.sends, [false, false, false, false, false, false])
  h.stop()
  assert.equal(h.sends.at(-1), true)
  assert.equal(h.win.listenerCount + h.doc.listenerCount, 0)
})
test('heartbeat never overlaps requests and closed sessions never resume after a delayed response', async () => {
  let finish
  const h = heartbeat(async (leave) => {
    if (!leave)
      await new Promise((resolve) => {
        finish = resolve
      })
  })
  h.win.fire('focus')
  h.interval()
  assert.deepEqual(h.sends, [false])
  h.stop()
  h.stop()
  finish()
  await tick()
  await h.refresh()
  h.win.fire('online')
  assert.deepEqual(h.sends, [false, true])
  assert.equal(h.cleared, true)
})
test('a transient heartbeat error retries and disconnected transports do not publish attendance', async () => {
  const h = heartbeat(async () => {
    throw Error('offline')
  })
  await tick()
  await h.refresh()
  h.disconnect()
  h.interval()
  await h.refresh()
  assert.deepEqual(h.sends, [false, false])
  h.stop()
})
