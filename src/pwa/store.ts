import { useSyncExternalStore } from 'react'
import { version } from '../../package.json'
import { appLaunchHint, canApplyUpdate, isInstalledDisplay } from './policy'

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' } | void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface PwaState {
  installed: boolean
  canInstall: boolean
  installing: boolean
  online: boolean
  inCall: boolean
  worker: 'starting' | 'ready' | 'error' | 'unsupported'
  update: 'idle' | 'checking' | 'available' | 'applying' | 'blocked' | 'upToDate' | 'error'
  version: string
  nextVersion: string
  message: string
}

let state: PwaState = {
  installed: false, canInstall: false, installing: false,
  online: navigator.onLine, inCall: false, worker: 'starting', update: 'idle',
  version, nextVersion: '', message: '',
}
const listeners = new Set<() => void>()
let registration: ServiceWorkerRegistration | undefined
let retryRegistration: (() => Promise<void>) | undefined
let installEvent: InstallPromptEvent | undefined
let booted = false
let reloadRequested = false
let lastCheck = 0
let busy = false
const emit = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export const usePwa = () => useSyncExternalStore(
  (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  () => state,
)

export const setPwaCallActive = (active: boolean) => {
  busy = active
  if (active !== state.inCall) emit({ inCall: active })
}

function workerRequest<T>(worker: ServiceWorker, message: object, timeout = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('O aplicativo não respondeu. Tente novamente.')) }, timeout)
    channel.port1.onmessage = (event: MessageEvent<T>) => {
      window.clearTimeout(timer)
      channel.port1.close()
      resolve(event.data)
    }
    worker.postMessage(message, [channel.port2])
  })
}

async function inspectWaiting() {
  const waiting = registration?.waiting
  if (!waiting) return false
  let nextVersion = ''
  try { nextVersion = (await workerRequest<{ version: string }>(waiting, { type: 'PWA_VERSION' })).version } catch { /* The worker can terminate while its replacement starts. */ }
  emit({ update: 'available', nextVersion, message: '' })
  return true
}

export async function checkPwaUpdate() {
  if (state.update === 'checking' || state.update === 'applying') return
  if (!navigator.onLine) { emit({ update: 'error', message: 'Conecte-se à internet para buscar atualizações.' }); return }
  if (!registration) {
    if (retryRegistration) {
      emit({ worker: 'starting', update: 'idle', message: '' })
      await retryRegistration()
    }
    return
  }
  lastCheck = Date.now()
  emit({ update: 'checking', message: '' })
  try {
    await registration.update()
    if (await inspectWaiting()) return
    if (registration.installing) return
    emit({ update: 'upToDate', message: 'Você está na versão mais recente disponível neste dispositivo.' })
  } catch {
    emit({ update: 'error', message: 'Não foi possível buscar atualizações. Seu aplicativo continua funcionando.' })
  }
}

export async function applyPwaUpdate() {
  if (!canApplyUpdate(busy, state.update === 'applying', navigator.onLine)) {
    emit({ update: 'blocked', message: busy ? 'Saia da call para aplicar a atualização. Ela já está pronta.' : 'Conecte-se à internet e tente novamente.' })
    return
  }
  if (!registration?.waiting) {
    // Another tab may already have activated it. Reload only this explicitly consenting page.
    if (state.update === 'available' || state.update === 'blocked') window.location.reload()
    return
  }
  emit({ update: 'applying', message: '' })
  reloadRequested = true
  try {
    const reply = await workerRequest<{ status: 'blocked' | 'activating' }>(registration.waiting, { type: 'PWA_ACTIVATE' })
    if (reply.status === 'blocked') {
      reloadRequested = false
      emit({ update: 'blocked', message: 'Há uma call ou outra aba ocupada. Encerre a call nas outras janelas e tente novamente.' })
    }
  } catch {
    reloadRequested = false
    emit({ update: 'error', message: 'Não foi possível aplicar a atualização. Feche e abra o app quando terminar sua call.' })
  }
}

export async function promptPwaInstall() {
  const prompt = installEvent
  if (!prompt || state.installing) return false
  installEvent = undefined
  emit({ installing: true, canInstall: false })
  try {
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') emit({ installed: true })
    return choice.outcome === 'accepted'
  } catch { return false } finally { emit({ installing: false }) }
}

export async function retryPwaConnection() {
  if (state.online) { window.location.reload(); return }
  try {
    const response = await fetch('/pwa-version.json', { cache: 'no-store', signal: AbortSignal.timeout(7000) })
    if (response.ok && (await response.json()).buildId) {
      emit({ online: true })
      window.location.reload()
    }
  } catch { /* Stay on the offline screen without deleting account data. */ }
}

export function startPwa() {
  if (booted) return
  booted = true
  if (window.fordKallDesktop || !['http:', 'https:'].includes(location.protocol)) {
    emit({ worker: 'unsupported' })
    return
  }
  const display = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)')
  let launchHint = appLaunchHint(window.location.href, null)
  try {
    launchHint = appLaunchHint(window.location.href, sessionStorage.getItem('fordkall.app-window'))
    if (launchHint || isInstalledDisplay(display.matches, Boolean((navigator as Navigator & { standalone?: boolean }).standalone), document.referrer)) {
      sessionStorage.setItem('fordkall.app-window', launchHint || 'pwa')
    }
  } catch { /* Private browsing/storage restrictions must not break app boot. */ }
  const readDisplay = () => emit({ installed: Boolean(launchHint) || isInstalledDisplay(display.matches, Boolean((navigator as Navigator & { standalone?: boolean }).standalone), document.referrer) })
  readDisplay()
  display.addEventListener('change', readDisplay)
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installEvent = event as InstallPromptEvent
    emit({ canInstall: !state.installed })
  })
  window.addEventListener('appinstalled', () => {
    installEvent = undefined
    emit({ installed: true, canInstall: false, installing: false })
  })
  window.addEventListener('offline', () => emit({ online: false }))
  window.addEventListener('online', () => { emit({ online: true }); void checkPwaUpdate() })
  // Vite's development HMR must never be cached or shadowed by a production worker.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) {
    emit({ worker: 'unsupported' })
    return
  }
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PWA_QUERY_UPDATE_STATUS') {
      event.ports[0]?.postMessage({ type: 'PWA_UPDATE_STATUS', busy: busy || state.update === 'applying' && !reloadRequested })
    }
  })
  let hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested && !busy) { window.location.reload(); return }
    if (hadController) emit({ update: 'available', message: 'Uma nova versão está pronta. Reabra o app quando preferir.' })
    hadController = true
  })
  const register = async () => {
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      if (registration.active) emit({ worker: 'ready' })
      await inspectWaiting()
      const trackInstall = () => {
        const worker = registration?.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') {
            emit({ worker: 'ready' })
            void inspectWaiting().then((found) => { if (!found && state.update === 'checking') emit({ update: 'upToDate' }) })
          }
          if (worker.state === 'redundant') {
            emit({
              worker: registration?.active ? 'ready' : 'error',
              update: 'error',
              message: 'Não foi possível preparar a nova versão. Seu aplicativo atual foi preservado; tente buscar atualizações novamente.',
            })
          }
        })
      }
      registration.addEventListener('updatefound', trackInstall)
      trackInstall()
      void checkPwaUpdate()
    } catch {
      emit({ worker: 'error', update: 'error', message: 'Não foi possível preparar o modo instalável. Você pode continuar pelo navegador ou tentar verificar novamente.' })
    }
  }
  retryRegistration = register
  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', () => { void register() }, { once: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60_000) void checkPwaUpdate()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) void checkPwaUpdate()
  }, 60 * 60_000)
}
