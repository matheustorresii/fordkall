export const CONTROL_SOUNDS = {
  mute: [
    { frequency: 523.25, offset: 0, duration: 0.19, volume: 0.15 },
    { frequency: 349.23, offset: 0.14, duration: 0.24, volume: 0.18 },
  ],
  unmute: [
    { frequency: 349.23, offset: 0, duration: 0.19, volume: 0.15 },
    { frequency: 659.25, offset: 0.14, duration: 0.24, volume: 0.18 },
  ],
  deafen: [
    { frequency: 587.33, offset: 0, duration: 0.18, volume: 0.15 },
    { frequency: 440, offset: 0.13, duration: 0.19, volume: 0.16 },
    { frequency: 293.66, offset: 0.27, duration: 0.27, volume: 0.18 },
  ],
  undeafen: [
    { frequency: 293.66, offset: 0, duration: 0.18, volume: 0.15 },
    { frequency: 440, offset: 0.13, duration: 0.19, volume: 0.16 },
    { frequency: 698.46, offset: 0.27, duration: 0.27, volume: 0.18 },
  ],
} as const
export type ControlSound = keyof typeof CONTROL_SOUNDS

/** A delayed autoplay resume must never replay feedback for an obsolete state. */
export class LatestControlFeedback {
  private generation = 0
  private cancel: (() => void) | undefined

  play(start: () => (() => void) | undefined, ready?: Promise<void>) {
    this.stop()
    const version = this.generation
    const play = () => {
      if (version === this.generation) this.cancel = start()
    }
    if (ready) void ready.then(play).catch(() => undefined)
    else play()
  }

  stop() {
    this.generation++
    this.cancel?.()
    this.cancel = undefined
  }
}
