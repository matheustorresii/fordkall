export interface SuspendableVideo {
  kind: string
  isDesired: boolean
  setSubscribed: (wanted: boolean) => void
}
const intent = new WeakMap<object, boolean>()
/** Explicit viewer intent is separate from a temporary performance suspension. */
export function setMediaSubscription(
  publication: SuspendableVideo | undefined,
  wanted: boolean,
) {
  if (!publication) return
  intent.set(publication, wanted)
  publication.setSubscribed(wanted)
}
export class VideoSuspensionPolicy<T extends SuspendableVideo> {
  private suspended = new Set<T>()
  sync(
    publications: T[],
    background: boolean,
    keepVisible: (publication: T) => boolean = () => false,
  ) {
    const live = new Set(publications)
    for (const publication of this.suspended)
      if (!live.has(publication)) this.suspended.delete(publication)
    for (const publication of publications) {
      if (publication.kind !== 'video') continue
      if (background && !keepVisible(publication)) {
        if (publication.isDesired && intent.get(publication) !== false) {
          this.suspended.add(publication)
          publication.setSubscribed(false)
        }
      } else if (
        this.suspended.delete(publication) &&
        intent.get(publication) !== false
      )
        publication.setSubscribed(true)
    }
  }
  restore(publications: T[]) {
    this.sync(publications, false)
  }
  get count() {
    return this.suspended.size
  }
}
