import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile, access } from 'node:fs/promises'
import { MessageChannel } from 'node:worker_threads'
import { resolve } from 'node:path'
import { isInstalledDisplay, canApplyUpdate, installInstructions } from '../src/pwa/policy.ts'

const root = resolve(import.meta.dirname, '..')
const origin = 'https://fordkall.11a3.dev'
const source = await readFile(resolve(root, 'src/pwa/service-worker.js'), 'utf8')
const build = { version: '1.2.0', buildId: 'test-build', files: ['/index.html', '/offline.html', '/assets/main-123.js', '/manifest.webmanifest'] }
const shellName = 'fordkall-shell-test-build'
const url = (request) => typeof request === 'string' ? new URL(request, origin).href : request.url

function harness({ clients = [], failingPath, offline = false } = {}) {
  const handlers = new Map(), stores = new Map(), requestHeaders = new Map(), fetches = []
  let skipCount = 0, claims = 0, noNetwork = offline
  const fetchMock = async (request) => {
    fetches.push(url(request))
    if (noNetwork) throw new Error('offline')
    return new Response(new URL(url(request)).pathname, { status: new URL(url(request)).pathname === failingPath ? 404 : 200, headers: { Vary: 'Origin' } })
  }
  const cacheApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const data = stores.get(name)
      return {
        async addAll(requests) {
          const fetched = await Promise.all(requests.map(async (request) => {
            const response = await fetchMock(request)
            if (!response.ok) throw new Error('partial deployment')
            return [url(request), response]
          }))
          fetched.forEach(([key, response]) => { data.set(key, response); requestHeaders.set(name + key, new Headers()) })
        },
        async match(request, options = {}) {
          const response = data.get(url(request))
          if (!response) return undefined
          const saved = requestHeaders.get(name + url(request)) || new Headers()
          const requested = request.headers || new Headers()
          if (!options.ignoreVary && (response.headers.get('vary') || '').split(',').filter(Boolean).some((header) => saved.get(header.trim()) !== requested.get(header.trim()))) return undefined
          return response.clone()
        },
        async put(request, response) { data.set(url(request), response); requestHeaders.set(name + url(request), request.headers || new Headers()) },
        async keys() { return [...data.keys()].map((key) => new Request(key)) },
        async delete(request) { return data.delete(url(request)) },
      }
    },
    async keys() { return [...stores.keys()] },
    async delete(name) { return stores.delete(name) },
  }
  const self = {
    location: { origin },
    addEventListener(name, handler) { handlers.set(name, handler) },
    clients: { async matchAll() { return clients }, async claim() { claims++ } },
    async skipWaiting() { skipCount++ },
  }
  class BrowserRequest extends Request { constructor(input, options) { super(typeof input === 'string' ? new URL(input, origin) : input, options) } }
  vm.runInNewContext(source.replace('/*__BUILD__*/', JSON.stringify(build)), {
    self, caches: cacheApi, fetch: fetchMock, Request: BrowserRequest, Response, URL, MessageChannel,
    setTimeout: (callback, ms) => setTimeout(callback, Math.min(ms, 30)), clearTimeout,
  })
  return {
    stores, fetches, caches: cacheApi,
    get skipCount() { return skipCount }, get claims() { return claims },
    offline(value = true) { noNetwork = value },
    async life(name) { let pending; handlers.get(name)({ waitUntil(promise) { pending = promise } }); await pending },
    async request(path, { mode = 'cors', method = 'GET', cache = 'default', headers = {} } = {}) {
      let response
      const request = { url: new URL(path, origin).href, mode, method, cache, headers: new Headers(headers) }
      handlers.get('fetch')({ request, respondWith(value) { response = value } })
      return response ? await response : undefined
    },
    async message(data) {
      let pending, reply
      handlers.get('message')({ data, ports: [{ postMessage(value) { reply = value } }], waitUntil(value) { pending = value } })
      await pending
      return reply
    },
  }
}

const tab = (busy = false, responds = true) => ({ url: origin + '/', postMessage(message, [port]) {
  assert.equal(message.type, 'PWA_QUERY_UPDATE_STATUS')
  if (responds) port.postMessage({ type: 'PWA_UPDATE_STATUS', busy })
  port.close()
} })

test('install is atomic, precaches only public shell and never forces activation', async () => {
  const h = harness()
  await h.life('install')
  assert.equal(h.stores.get(shellName).size, build.files.length)
  assert.equal(h.skipCount, 0)
  assert.ok([...h.stores.get(shellName).keys()].every((key) => !key.includes('?')))
})
test('a partial deployment cannot replace the working shell', async () => {
  const h = harness({ failingPath: '/assets/main-123.js' })
  await (await h.caches.open('fordkall-shell-old')).put('/index.html', new Response('old'))
  await assert.rejects(h.life('install'), /partial/)
  assert.equal(h.stores.has(shellName), false)
  assert.equal(await (await (await h.caches.open('fordkall-shell-old')).match('/index.html')).text(), 'old')
})
test('offline navigation with room/invite parameters uses canonical public shell only', async () => {
  const h = harness(); await h.life('install'); h.offline()
  assert.equal(await (await h.request('/?room=SECRET&invite=PRIVATE', { mode: 'navigate' })).text(), '/index.html')
  assert.equal([...h.stores.get(shellName).keys()].some((key) => key.includes('SECRET') || key.includes('PRIVATE')), false)
})
test('network navigation is fresh and never stored with an account/room URL', async () => {
  const h = harness(); await h.life('install')
  assert.equal(await (await h.request('/?room=KIWI', { mode: 'navigate' })).text(), '/')
  assert.equal(h.stores.get(shellName).size, build.files.length)
})
test('Supabase, auth, tokens, APIs, POSTs, YouTube and no-store requests bypass the worker', async () => {
  const h = harness()
  for (const path of ['https://meowhnfcagoebolimqhl.supabase.co/auth/v1/token', '/functions/v1/livekit-token', '/api/messages', 'https://www.youtube.com/embed/id', '/.well-known/assetlinks.json', '/pwa-version.json']) {
    assert.equal(await h.request(path), undefined, path)
  }
  assert.equal(await h.request('/assets/main-123.js', { method: 'POST' }), undefined)
  assert.equal(await h.request('/assets/main-123.js', { cache: 'no-store' }), undefined)
  assert.equal(await h.request('/assets/main-123.js', { headers: { Authorization: 'Bearer private' } }), undefined)
  assert.equal(h.fetches.length, 0)
  assert.equal(h.stores.size, 0)
})
test('offline assets work; a missing script never receives HTML', async () => {
  const h = harness(); await h.life('install'); h.offline()
  assert.equal(await (await h.request('/assets/main-123.js')).text(), '/assets/main-123.js')
  const missing = await h.request('/assets/missing-456.js')
  assert.equal(missing.status, 503)
  assert.ok(!missing.headers.get('content-type').includes('html'))
})
test('old game chunks survive a new worker activation', async () => {
  const h = harness(); await h.life('install')
  await (await h.caches.open('fordkall-shell-old')).put('/assets/Gartic-previous.js', new Response('old-game'))
  await h.life('activate'); h.offline()
  assert.equal(await (await h.request('/assets/Gartic-previous.js')).text(), 'old-game')
  assert.equal(h.claims, 1)
})
test('CORS module scripts stay available offline when the static server sends Vary: Origin', async () => {
  const h = harness(); await h.life('install'); h.offline()
  const script = await h.request('/assets/main-123.js', { headers: { Origin: origin } })
  assert.equal(script.status, 200)
  assert.equal(await script.text(), '/assets/main-123.js')
})
test('only old Ford Kall caches are pruned, leaving browser/application data intact', async () => {
  const h = harness()
  for (const name of ['other-app-cache', 'fordkall-shell-1', 'fordkall-shell-2', 'fordkall-shell-3', shellName]) await h.caches.open(name)
  await h.life('activate')
  assert.ok(h.stores.has('other-app-cache'))
  assert.equal(h.stores.has('fordkall-shell-1'), false)
  assert.ok(h.stores.has('fordkall-shell-2'))
  assert.ok(h.stores.has('fordkall-shell-3'))
})
test('public art cache has a 90-entry bound and does not accept query strings', async () => {
  const h = harness()
  for (let index = 0; index < 95; index++) await h.request(`/cosmetics/frame-${index}.webp`)
  assert.equal(h.stores.get('fordkall-public-media-' + build.version).size, 90)
  assert.equal(await h.request('/cosmetics/frame-1.webp?token=private'), undefined)
})
test('an update waits for calls in every open tab, not only the requesting tab', async () => {
  const h = harness({ clients: [tab(false), tab(true)] })
  assert.equal((await h.message({ type: 'PWA_ACTIVATE' })).status, 'blocked')
  assert.equal(h.skipCount, 0)
})
test('an unresponsive tab fails closed instead of silently restarting a call', async () => {
  const h = harness({ clients: [tab(false, false)] })
  assert.equal((await h.message({ type: 'PWA_ACTIVATE' })).status, 'blocked')
  assert.equal(h.skipCount, 0)
})
test('explicit activation succeeds once all tabs report safe', async () => {
  const h = harness({ clients: [tab(false), tab(false)] })
  assert.equal((await h.message({ type: 'PWA_ACTIVATE' })).status, 'activating')
  assert.equal(h.skipCount, 1)
  assert.equal((await h.message({ type: 'PWA_VERSION' })).version, build.version)
})
test('install instructions distinguish Android, iPhone/iPad and desktop', () => {
  assert.equal(installInstructions('Mozilla/5.0 (Linux; Android 16)').platform, 'android')
  assert.equal(installInstructions('Mozilla/5.0 (iPhone; CPU iPhone OS)').platform, 'ios')
  assert.equal(installInstructions('Mozilla/5.0 (Macintosh; Intel Mac OS X) Mobile/15E148').platform, 'ios')
  assert.equal(installInstructions('Mozilla/5.0 (Windows NT 10.0)').platform, 'desktop')
})
test('installed state never trusts a source query parameter or arbitrary app referrer', () => {
  assert.equal(isInstalledDisplay(false, false, 'android-app://dev.elevena3.fordkall'), true)
  assert.equal(isInstalledDisplay(false, false, 'android-app://evil.example'), false)
  assert.equal(isInstalledDisplay(false, false, 'https://fordkall.11a3.dev/?source=android'), false)
  assert.equal(isInstalledDisplay(true, false, ''), true)
  assert.equal(isInstalledDisplay(false, true, ''), true)
})
test('local update policy refuses active calls, duplicate activation and offline restart', () => {
  assert.equal(canApplyUpdate(true, false, true), false)
  assert.equal(canApplyUpdate(false, true, true), false)
  assert.equal(canApplyUpdate(false, false, false), false)
  assert.equal(canApplyUpdate(false, false, true), true)
})
test('manifest has stable identity, scope, maskable icons and no unsupported share handler', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'public/manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.id, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.share_target, undefined)
  for (const icon of manifest.icons) await access(resolve(root, 'public', '.' + icon.src))
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'))
  for (const screenshot of manifest.screenshots || []) await access(resolve(root, 'public', '.' + screenshot.src))
})
test('Android association contains a release certificate, never signing key material', async () => {
  const association = JSON.parse(await readFile(resolve(root, 'public/.well-known/assetlinks.json'), 'utf8'))
  assert.equal(association[0].target.package_name, 'dev.elevena3.fordkall')
  assert.match(association[0].target.sha256_cert_fingerprints[0], /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/)
})
