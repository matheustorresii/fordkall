import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { MessageChannel } from 'node:worker_threads'
import { isInstalledDisplay, canApplyUpdate } from '../src/pwa/policy.ts'

const raw = await readFile(new URL('../src/pwa/store.ts', import.meta.url), 'utf8')
const source = stripTypeScriptTypes(raw).replace(/^import .*$/gm, '').replaceAll('export ', '').replaceAll('import.meta.env.PROD', 'PRODUCTION') + '\nthis.api = { startPwa, usePwa, setPwaCallActive, checkPwaUpdate, applyPwaUpdate, promptPwaInstall };'
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
function events(extra = {}) {
  const listeners = new Map()
  return { ...extra, addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(listener)
  }, fire(type, event = {}) { listeners.get(type)?.forEach((listener) => listener(event)) } }
}

async function harness({ desktop = false, production = true, protocol = 'https:', waiting = false, blocked = false, registrationFails = false } = {}) {
  let reloads = 0, registrations = 0, registerOptions, activateRequests = 0
  const manager = events({ controller: {} })
  const worker = events({ state: 'installed', postMessage(message, [port]) {
    if (message.type === 'PWA_VERSION') port.postMessage({ version: '1.3.0', buildId: 'next' })
    if (message.type === 'PWA_ACTIVATE') {
      activateRequests++
      port.postMessage({ status: blocked ? 'blocked' : 'activating' })
      if (!blocked) setTimeout(() => { registration.waiting = null; manager.fire('controllerchange') }, 2)
    }
    port.close()
  } })
  const registration = events({ active: {}, waiting: waiting ? worker : null, installing: null, async update() {} })
  manager.register = async (_url, options) => { registrations++; registerOptions = options; if (registrationFails) throw new Error('temporarily unavailable'); return registration }
  const win = events({
    fordKallDesktop: desktop ? {} : undefined, isSecureContext: true,
    location: { reload() { reloads++ } },
    matchMedia() { return events({ matches: false }) },
    setTimeout, clearTimeout, setInterval() {},
  })
  const doc = events({ referrer: '', readyState: 'complete', visibilityState: 'visible' })
  const navigator = { onLine: true, serviceWorker: manager }
  const scope = {
    version: '1.2.0', window: win, document: doc, navigator,
    location: { protocol }, PRODUCTION: production, MessageChannel,
    canApplyUpdate, isInstalledDisplay,
    useSyncExternalStore(_subscribe, snapshot) { return snapshot() },
    setTimeout, clearTimeout, fetch: async () => { throw new Error('offline') }, AbortSignal,
  }
  vm.runInNewContext(source, scope)
  scope.api.startPwa()
  await tick()
  for (let attempt = 0; attempt < 100 && ['starting', 'checking'].some((value) => [scope.api.usePwa().worker, scope.api.usePwa().update].includes(value)); attempt++) await tick()
  return { ...scope.api, win, doc, navigator, manager, worker, registration,
    get reloads() { return reloads }, get registrations() { return registrations }, get registerOptions() { return registerOptions }, get activateRequests() { return activateRequests },
  }
}

test('desktop Electron, file URLs and Vite development never register a worker', async () => {
  for (const options of [{ desktop: true }, { protocol: 'file:' }, { production: false }]) {
    const h = await harness(options)
    assert.equal(h.registrations, 0)
    assert.equal(h.usePwa().worker, 'unsupported')
  }
})
test('production registration disables worker HTTP caching and does not force a reload', async () => {
  const h = await harness()
  assert.equal(h.registrations, 1)
  assert.equal(h.registerOptions.scope, '/')
  assert.equal(h.registerOptions.updateViaCache, 'none')
  assert.equal(h.usePwa().worker, 'ready')
  assert.equal(h.reloads, 0)
})
test('discovering a waiting worker prepares an update without applying it', async () => {
  const h = await harness({ waiting: true })
  assert.equal(h.usePwa().update, 'available')
  assert.equal(h.usePwa().nextVersion, '1.3.0')
  assert.equal(h.activateRequests, 0)
  assert.equal(h.reloads, 0)
})
test('a failed initial registration can be retried without an inert settings button', async () => {
  const h = await harness({ registrationFails: true })
  assert.equal(h.usePwa().worker, 'error')
  assert.equal(h.usePwa().update, 'error')
  h.manager.register = async () => h.registration
  await h.checkPwaUpdate()
  await tick()
  assert.equal(h.usePwa().worker, 'ready')
  assert.equal(h.usePwa().update, 'upToDate')
})
test('an active call refuses local update activation before messaging the worker', async () => {
  const h = await harness({ waiting: true })
  h.setPwaCallActive(true)
  await h.applyPwaUpdate()
  assert.equal(h.usePwa().update, 'blocked')
  assert.equal(h.activateRequests, 0)
  assert.equal(h.reloads, 0)
})
test('the worker receives current busy status for calls in other tabs', async () => {
  const h = await harness()
  let reply
  h.setPwaCallActive(true)
  h.manager.fire('message', { data: { type: 'PWA_QUERY_UPDATE_STATUS' }, ports: [{ postMessage(value) { reply = value } }] })
  assert.equal(reply.busy, true)
  h.setPwaCallActive(false)
  h.manager.fire('message', { data: { type: 'PWA_QUERY_UPDATE_STATUS' }, ports: [{ postMessage(value) { reply = value } }] })
  assert.equal(reply.busy, false)
})
test('explicit update reloads only the consenting client after controller change', async () => {
  const h = await harness({ waiting: true })
  await h.applyPwaUpdate()
  await tick()
  assert.equal(h.activateRequests, 1)
  assert.equal(h.reloads, 1)
})
test('a worker veto from another busy tab does not reload or stick in applying', async () => {
  const h = await harness({ waiting: true, blocked: true })
  await h.applyPwaUpdate()
  assert.equal(h.usePwa().update, 'blocked')
  assert.equal(h.reloads, 0)
  await h.applyPwaUpdate()
  assert.equal(h.activateRequests, 2)
  assert.equal(h.usePwa().update, 'blocked')
})
test('an update activated elsewhere never automatically reloads this page', async () => {
  const h = await harness()
  h.manager.fire('controllerchange')
  assert.equal(h.usePwa().update, 'available')
  assert.equal(h.reloads, 0)
  await h.applyPwaUpdate()
  assert.equal(h.reloads, 1)
})
test('a failed new installation preserves active worker and unblocks checking', async () => {
  const h = await harness()
  h.registration.installing = h.worker
  h.manager.fire('message', { data: { type: 'UNRELATED' }, ports: [] })
  h.registration.fire('updatefound')
  await h.checkPwaUpdate()
  assert.equal(h.usePwa().update, 'checking')
  h.worker.state = 'redundant'
  h.worker.fire('statechange')
  h.registration.installing = null
  assert.equal(h.usePwa().worker, 'ready')
  assert.equal(h.usePwa().update, 'error')
  await h.checkPwaUpdate()
  assert.equal(h.usePwa().update, 'upToDate')
})
test('the installation prompt is user-driven and a dismissed prompt can be offered again', async () => {
  const h = await harness()
  let prompts = 0, prevented = 0
  const event = (outcome) => ({ preventDefault() { prevented++ }, async prompt() { prompts++ }, userChoice: Promise.resolve({ outcome }) })
  h.win.fire('beforeinstallprompt', event('dismissed'))
  assert.equal(prevented, 1)
  assert.equal(prompts, 0)
  assert.equal(h.usePwa().canInstall, true)
  assert.equal(await h.promptPwaInstall(), false)
  assert.equal(h.usePwa().installing, false)
  h.win.fire('beforeinstallprompt', event('accepted'))
  assert.equal(await h.promptPwaInstall(), true)
  assert.equal(h.usePwa().installed, true)
  assert.equal(prompts, 2)
})
test('network state updates without reloading or clearing a call', async () => {
  const h = await harness()
  h.setPwaCallActive(true)
  h.navigator.onLine = false
  h.win.fire('offline')
  assert.equal(h.usePwa().online, false)
  assert.equal(h.usePwa().inCall, true)
  await h.checkPwaUpdate()
  assert.equal(h.usePwa().update, 'error')
  assert.equal(h.reloads, 0)
})
