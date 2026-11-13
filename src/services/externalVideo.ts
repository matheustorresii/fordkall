import type { ElementInfo } from 'livekit-client'

export const EXTERNAL_VIDEO_EVENT = 'ford-kall:external-video-change'
const notify = () => {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(EXTERNAL_VIDEO_EVENT))
}

/** The publication outlives a replaced RemoteVideoTrack. An explicitly opened
 * viewer stays active until closed, including when Chromium marks it occluded.
 * Window presence never overrides opt-out. */
export class ExternalVideoRegistry {
  private viewers = new WeakMap<object, Map<object, () => boolean>>()
  register(publication: object | undefined, active: () => boolean) {
    if (!publication) return () => undefined
    const token = {},
      sources =
        this.viewers.get(publication) || new Map<object, () => boolean>()
    sources.set(token, active)
    this.viewers.set(publication, sources)
    notify()
    return () => {
      sources.delete(token)
      notify()
    }
  }
  active(publication: object) {
    return [...(this.viewers.get(publication)?.values() || [])].some(
      (check) => {
        try {
          return check()
        } catch {
          return false
        }
      },
    )
  }
}
export const externalVideos = new ExternalVideoRegistry()

interface AdaptiveExternalTrack {
  isAdaptiveStream: boolean
  observeElementInfo(info: ElementInfo): void
  stopObservingElementInfo(info: ElementInfo): void
}
/** The default SDK observer belongs to the opener's viewport. Use the external
 * video's dimensions and keep this explicit viewer active until its window closes.
 * Child visibility is unreliable when occluded; this is not a PiP element. */
export function observeExternalVideo(
  track: AdaptiveExternalTrack,
  video: HTMLVideoElement,
  popup: Window,
) {
  if (!track.isAdaptiveStream) return () => undefined
  const visible = () => !popup.closed
  const sync = () => {
    const next = visible()
    if (next !== info.visible) {
      info.visible = next
      info.visibilityChangedAt = Date.now()
      info.handleVisibilityChanged?.()
    }
    info.handleResize?.()
    notify()
    if (next && video.paused && video.srcObject)
      void video.play().catch(() => undefined)
  }
  let resize: ResizeObserver | undefined
  const info: ElementInfo = {
    element: {},
    width: () => video.clientWidth,
    height: () => video.clientHeight,
    visible: visible(),
    pictureInPicture: false,
    visibilityChangedAt: Date.now(),
    observe() {
      popup.document.addEventListener('visibilitychange', sync)
      popup.addEventListener('resize', sync)
      popup.addEventListener('focus', sync)
      popup.addEventListener('pageshow', sync)
      const Observer = popup.document.defaultView?.ResizeObserver
      if (Observer) {
        resize = new Observer(sync)
        resize.observe(video)
      }
    },
    stopObserving() {
      popup.document.removeEventListener('visibilitychange', sync)
      popup.removeEventListener('resize', sync)
      popup.removeEventListener('focus', sync)
      popup.removeEventListener('pageshow', sync)
      resize?.disconnect()
    },
  }
  track.observeElementInfo(info)
  return () => track.stopObservingElementInfo(info)
}
