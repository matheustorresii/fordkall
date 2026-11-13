import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import {
  externalVideos,
  EXTERNAL_VIDEO_EVENT,
  observeExternalVideo,
} from './externalVideo.ts'

type Video = LocalVideoTrack | RemoteVideoTrack
/** A native media element in the child window, never a canvas/frame-copy loop. */
export class StreamPopout {
  private video: HTMLVideoElement
  private track?: Video
  private stopObserver?: () => void
  private unregister?: () => void
  private publication?: object
  private hideTimer = 0
  private disposed = false
  private name: HTMLSpanElement
  private fullscreenButton: HTMLButtonElement
  private closeButton: HTMLButtonElement
  readonly window: Window
  private onClosed: () => void

  constructor(
    window: Window,
    openerDocument: Document,
    participantName: string,
    publication: object | undefined,
    onClosed: () => void,
  ) {
    this.window = window
    this.onClosed = onClosed
    const doc = window.document
    const style = doc.createElement('style')
    style.textContent = `
      :root { color-scheme: dark; background: #000; font-family: system-ui, sans-serif; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
      video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
      .controls { position: absolute; z-index: 2; inset: 12px 12px auto; display: flex; gap: 8px; align-items: center; opacity: 0; transition: opacity 150ms; pointer-events: none; }
      body[data-controls-visible] .controls, .controls:focus-within { opacity: 1; }
      .controls span { max-width: calc(100% - 120px); margin-right: auto; padding: 7px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 8px; background: #121a21b8; color: #e2e9ee; font-size: 12px; }
      .controls button { width: 42px; height: 42px; border: 1px solid #fff3; border-radius: 10px; background: #121a21c9; color: #e4eaf0; font: 23px system-ui; cursor: pointer; pointer-events: auto; }
      .controls button:hover, .controls button:focus-visible { background: #31424de8; outline: 2px solid #d7e4dd; }
      body:fullscreen video { object-fit: contain; }
      @media(prefers-reduced-motion:reduce) { .controls { transition: none; } }
    `
    const controls = doc.createElement('div')
    controls.className = 'controls'
    this.name = doc.createElement('span')
    this.fullscreenButton = doc.createElement('button')
    this.fullscreenButton.textContent = '⛶'
    this.fullscreenButton.type = 'button'
    this.fullscreenButton.setAttribute(
      'aria-label',
      'Tela cheia da transmissão',
    )
    this.closeButton = doc.createElement('button')
    this.closeButton.textContent = '×'
    this.closeButton.type = 'button'
    this.closeButton.setAttribute('aria-label', 'Fechar janela da transmissão')
    controls.append(this.name, this.fullscreenButton, this.closeButton)
    // The SDK checks HTMLVideoElement against the opener realm.
    this.video = openerDocument.createElement('video')
    this.video.autoplay = true
    this.video.muted = true
    this.video.playsInline = true
    doc.head.replaceChildren(style)
    doc.body.replaceChildren(this.video, controls)
    this.setName(participantName)
    this.setPublication(publication)
    doc.addEventListener('visibilitychange', this.visibility)
    window.addEventListener('focus', this.resume)
    window.addEventListener('pagehide', this.closed, { once: true })
    doc.addEventListener('pointermove', this.showControls)
    doc.addEventListener('pointerdown', this.showControls)
    doc.addEventListener('fullscreenchange', this.fullscreenChanged)
    this.video.addEventListener('stalled', this.resume)
    this.video.addEventListener('pause', this.resume)
    this.fullscreenButton.addEventListener('click', this.toggleFullscreen)
    this.closeButton.addEventListener('click', this.closeWindow)
    this.showControls()
  }

  setName(name: string) {
    this.window.document.title = `${name} · Ford Kall`
    this.name.textContent = `${name} · transmissão`
  }

  setPublication(publication?: object) {
    if (this.disposed || publication === this.publication) return
    this.unregister?.()
    this.publication = publication
    this.unregister = externalVideos.register(
      publication,
      () => !this.window.closed,
    )
  }

  setTrack(track?: Video) {
    if (this.disposed || track === this.track) return
    this.stopObserver?.()
    this.stopObserver = undefined
    const previous = this.track
    this.track = undefined
    if (previous) previous.detach(this.video)
    this.video.pause()
    this.video.srcObject = null
    this.track = track
    if (!track) return
    track.attach(this.video)
    if ('observeElementInfo' in track)
      this.stopObserver = observeExternalVideo(track, this.video, this.window)
    this.resume()
  }

  private resume = () => {
    if (this.disposed || !this.track || this.window.closed) return
    void this.video.play().catch(() => undefined)
  }
  private visibility = () => {
    this.resume()
    if (typeof window !== 'undefined')
      window.dispatchEvent(new Event(EXTERNAL_VIDEO_EVENT))
  }
  private showControls = () => {
    if (this.disposed) return
    this.window.document.body.setAttribute('data-controls-visible', '')
    this.window.clearTimeout(this.hideTimer)
    // The child owns this timer, so hiding the opener cannot freeze the controls.
    this.hideTimer = this.window.setTimeout(
      () => this.window.document.body.removeAttribute('data-controls-visible'),
      1800,
    )
  }
  private fullscreenChanged = () => {
    this.fullscreenButton.setAttribute(
      'aria-label',
      this.window.document.fullscreenElement
        ? 'Sair da tela cheia'
        : 'Tela cheia da transmissão',
    )
    this.showControls()
  }
  private toggleFullscreen = () => {
    const doc = this.window.document
    void (
      doc.fullscreenElement
        ? doc.exitFullscreen()
        : doc.body.requestFullscreen()
    ).catch(() => undefined)
  }
  private closeWindow = () => this.window.close()
  private closed = () => {
    this.dispose(false)
    this.onClosed()
  }

  dispose(close = true) {
    if (this.disposed) return
    this.disposed = true
    this.window.clearTimeout(this.hideTimer)
    this.window.removeEventListener('pagehide', this.closed)
    this.window.removeEventListener('focus', this.resume)
    const doc = this.window.document
    doc.removeEventListener('visibilitychange', this.visibility)
    doc.removeEventListener('pointermove', this.showControls)
    doc.removeEventListener('pointerdown', this.showControls)
    doc.removeEventListener('fullscreenchange', this.fullscreenChanged)
    this.video.removeEventListener('stalled', this.resume)
    this.video.removeEventListener('pause', this.resume)
    this.fullscreenButton.removeEventListener('click', this.toggleFullscreen)
    this.closeButton.removeEventListener('click', this.closeWindow)
    this.stopObserver?.()
    this.track?.detach(this.video)
    this.video.pause()
    this.video.srcObject = null
    this.video.remove()
    this.unregister?.()
    if (close && !this.window.closed) this.window.close()
  }
}
