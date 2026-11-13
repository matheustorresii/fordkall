/** The SDK's Web Audio gain can be recreated at 1 while its saved volume is 0.
 * A silent output owns no attachment at all, so reconnect/startAudio cannot leak audio. */
interface AudioTrackOutput {
  attach(element: HTMLMediaElement): unknown
  detach(element: HTMLMediaElement): unknown
  setVolume(volume: number): void
}
export class RemoteAudioOutput {
  private attached = false
  private silent = true
  private volume = 0
  private disposed = false
  private track: AudioTrackOutput
  private element: HTMLAudioElement

  constructor(track: AudioTrackOutput, element: HTMLAudioElement) {
    this.track = track
    this.element = element
  }

  setLevel(volume: number, silent: boolean) {
    if (this.disposed) return
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(6, volume)) : 0
    this.silent = silent || !this.volume
    if (this.silent) {
      this.track.setVolume(0)
      this.detach()
      return
    }
    // Cache a positive volume before attach: a rebuilt SDK graph starts at this level.
    this.track.setVolume(this.volume)
    if (!this.attached) {
      this.track.attach(this.element)
      this.attached = true
    }
    this.track.setVolume(this.volume)
    this.resume()
  }

  resume() {
    if (this.disposed || this.silent || !this.attached) return
    this.track.setVolume(this.volume)
    void this.element.play().catch(() => undefined)
  }

  private detach() {
    if (this.attached) this.track.detach(this.element)
    this.attached = false
    this.element.pause()
    this.element.srcObject = null
    this.element.removeAttribute('src')
    this.element.load()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.attached) this.track.setVolume(0)
    this.detach()
  }
}
