import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { normalizeCallDirectory } from '../src/services/roomDirectoryPolicy.ts'

const raw = await readFile(
  new URL('../src/hooks/useCallDirectory.ts', import.meta.url),
  'utf8',
)
const source =
  stripTypeScriptTypes(raw)
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replaceAll('export ', '') + '\nthis.hook = useCallDirectory;'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const events = () => {
  const listeners = new Map()
  return {
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
  }
}
function harness() {
  const cells = [],
    effects = [],
    requests = []
  let cursor = 0,
    interval
  const win = {
    ...events(),
    setInterval(fn) {
      interval = fn
      return 1
    },
    clearInterval() {},
  }
  const doc = { ...events(), visibilityState: 'visible' }
  const scope = {
    window: win,
    document: doc,
    normalizeCallDirectory,
    getCallDirectory() {
      return new Promise((resolve, reject) =>
        requests.push({ resolve, reject }),
      )
    },
    useState(initial) {
      const slot = cursor++
      if (!cells[slot])
        cells[slot] = {
          value: typeof initial === 'function' ? initial() : initial,
        }
      return [
        cells[slot].value,
        (value) => {
          cells[slot].value = value
        },
      ]
    },
    useRef(initial) {
      const slot = cursor++
      if (!cells[slot]) cells[slot] = { current: initial }
      return cells[slot]
    },
    useCallback(fn) {
      cursor++
      return fn
    },
    useEffect(fn, deps) {
      const slot = cursor++
      const previous = cells[slot]
      if (
        !previous ||
        deps.some((value, index) => value !== previous.deps[index])
      ) {
        effects.push(() => {
          previous?.cleanup?.()
          cells[slot] = { deps, cleanup: fn() }
        })
      }
    },
  }
  vm.runInNewContext(source, scope)
  return {
    requests,
    win,
    doc,
    poll: () => interval(),
    render(account = 'a') {
      cursor = 0
      return scope.hook(account)
    },
    flush() {
      effects.splice(0).forEach((fn) => fn())
    },
  }
}
const directory = {
  rooms: [{ code: 'PUBLIC', user_ids: ['person'] }],
  recentRooms: [
    {
      code: 'PRIVATE',
      is_private: true,
      last_joined_at: '2026-10-24T12:00:00Z',
    },
  ],
}
test('network failure keeps the last visible rooms and retry is available immediately', async () => {
  const h = harness()
  h.render()
  h.flush()
  h.requests[0].resolve(directory)
  await tick()
  assert.equal(h.render().rooms[0].code, 'PUBLIC')
  h.win.fire('focus')
  h.requests[1].reject(Error('offline'))
  await tick()
  const view = h.render()
  assert.equal(view.rooms[0].code, 'PUBLIC')
  assert.match(view.error, /mantida/)
  void view.refresh()
  assert.equal(h.requests.length, 3)
  h.requests[2].resolve(directory)
  await tick()
  assert.equal(h.render().error, '')
})
test('account changes hide old private history before effects run; stale in-flight requests are ignored', async () => {
  const h = harness()
  h.render('a')
  h.flush()
  h.requests[0].resolve(directory)
  await tick()
  h.win.fire('focus')
  assert.equal(h.render('b').recentRooms.length, 0)
  h.flush()
  h.requests[1].resolve(directory)
  h.requests[2].resolve({ rooms: [], recentRooms: [] })
  await tick()
  assert.equal(h.render('b').recentRooms.length, 0)
})
test('focus and reconnection refresh without overlapping requests; hidden tabs do not poll', async () => {
  const h = harness()
  h.render()
  h.flush()
  h.win.fire('focus')
  h.win.fire('online')
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve(directory)
  await tick()
  h.doc.visibilityState = 'hidden'
  h.poll()
  assert.equal(h.requests.length, 1)
  h.doc.visibilityState = 'visible'
  h.doc.fire('visibilitychange')
  assert.equal(h.requests.length, 2)
})
