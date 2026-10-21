import {
  loadYouTubeApi,
  youtubeEmbedUrl,
  youtubeErrorMessage,
  type YouTubeApi,
  type YouTubePlayer,
} from '../services/youtube.ts'
import {
  MAX_ROOM_MUSIC_TRACKS,
  currentMusicItem,
  currentMusicVideo,
  isYouTubeVideoId,
  musicNow,
  roomMusicPosition,
  type LocalMusicStatus,
  type MusicPlayerReport,
  type RoomMusicState,
} from './model.ts'

export interface LocalPlayerSnapshot {
  status: LocalMusicStatus
  position: number
  duration: number
  title: string
  error: string
  errorCode: number
}
export const emptyLocalPlayer = (): LocalPlayerSnapshot => ({
  status: 'off',
  position: 0,
  duration: 0,
  title: '',
  error: '',
  errorCode: 0,
})
interface PlayerCallbacks {
  change: (snapshot: LocalPlayerSnapshot) => void
  report: (report: MusicPlayerReport) => void
  resolve: (playbackId: string, itemId: string, videoIds: string[], offset: number, total: number) => void
}
export interface PlayerDependencies {
  api?: () => Promise<YouTubeApi>
  now?: () => number
  iframe?: () => HTMLIFrameElement
}

/** One visible iframe per listener. Resolved playlists play as individual, room-selected video IDs. */
export class YouTubeRoomPlayer {
  snapshot = emptyLocalPlayer()
  private host: HTMLDivElement
  private callbacks: PlayerCallbacks
  private dependencies: PlayerDependencies
  private now: () => number
  private player?: YouTubePlayer
  private state?: RoomMusicState
  private driver = false
  private volume = 70
  private ready = false
  private disposed = false
  private generation = 0
  private mode = ''
  private loadedPlayback = ''
  private loadedVideo = ''
  private loadedAt = 0
  private lastSeek = 0
  private endedToken = ''
  private resolvedToken = ''
  private playlistCandidate = ''
  private playlistCandidateAt = 0
  private blocked = false
  private pausedHere = false
  private desiredPlaying = false
  private lastController = ''
  private timeout?: number
  private interval: number

  constructor(host: HTMLDivElement, callbacks: PlayerCallbacks, dependencies: PlayerDependencies = {}) {
    this.host = host
    this.callbacks = callbacks
    this.dependencies = dependencies
    this.now = dependencies.now ?? musicNow
    this.interval = window.setInterval(() => this.sample(), 1_000)
    document.addEventListener('visibilitychange', this.onVisible)
    window.addEventListener('focus', this.onVisible)
  }
  private onVisible = () => {
    if (document.visibilityState === 'hidden') return
    this.reconcile(true)
    if (
      this.ready &&
      this.mode === 'video' &&
      this.state?.playing &&
      !this.blocked &&
      !this.pausedHere &&
      !['error', 'ended'].includes(this.snapshot.status) &&
      this.player?.getPlayerState() === 5
    )
      this.player.playVideo()
    this.sample()
  }
  private updateSnapshot(next: Partial<LocalPlayerSnapshot>) {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...next }
    this.callbacks.change(this.snapshot)
  }
  private report(status = this.snapshot.status) {
    if (!this.state || !this.loadedPlayback || this.loadedPlayback !== this.state.playbackId) return
    this.callbacks.report({ ...this.snapshot, status, playbackId: this.loadedPlayback, videoId: this.loadedVideo })
  }
  private fail(code: number, message?: string) {
    this.updateSnapshot({
      status: 'error',
      errorCode: code,
      error: message || youtubeErrorMessage(code, this.mode.startsWith('playlist:')),
    })
    this.report('error')
  }
  private clearPlayer() {
    this.generation++
    this.ready = false
    window.clearTimeout(this.timeout)
    try {
      this.player?.stopVideo()
      this.player?.destroy()
    } catch {
      /* A failed iframe can already be detached. */
    }
    this.player = undefined
    this.host.replaceChildren()
  }
  private create(mode: string) {
    this.clearPlayer()
    this.mode = mode
    this.loadedPlayback = this.state!.playbackId
    this.loadedVideo = currentMusicVideo(this.state!)
    this.loadedAt = this.now()
    this.blocked = false
    this.pausedHere = false
    this.endedToken = ''
    this.resolvedToken = ''
    this.playlistCandidate = ''
    this.updateSnapshot({ ...emptyLocalPlayer(), status: 'loading' })
    const generation = this.generation
    this.timeout = window.setTimeout(() => {
      if (generation === this.generation)
        this.fail(0, 'O YouTube demorou para carregar. Tente novamente ou avance a faixa.')
    }, 25_000)
    void (this.dependencies.api ?? loadYouTubeApi)()
      .then((api) => {
        if (this.disposed || generation !== this.generation || !this.state) return
        const item = currentMusicItem(this.state)!
        const resolving = mode.startsWith('playlist:')
        const iframe = this.dependencies.iframe?.() ?? document.createElement('iframe')
        if (!this.dependencies.iframe)
          iframe.src = youtubeEmbedUrl(this.loadedVideo, resolving ? item.sourceId : '', item.startIndex)
        iframe.title = 'Player de música do YouTube'
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture'
        iframe.referrerPolicy = 'strict-origin-when-cross-origin'
        this.host.append(iframe)
        this.player = new api.Player(iframe, {
          events: {
            onReady: () => {
              if (this.disposed || generation !== this.generation) return
              this.ready = true
              this.player?.setVolume(this.volume)
              if (!resolving) window.clearTimeout(this.timeout)
              this.updateSnapshot({ status: 'ready' })
              if (this.mode.startsWith('playlist:')) {
                this.loadedAt = this.now()
                // A videoseries URL can initially expose only a preview (notably Shorts).
                // Cue the actual playlist through the API before taking the room snapshot.
                this.player?.cuePlaylist({ list: item.sourceId, listType: 'playlist', index: item.startIndex })
                this.sample()
              } else {
                this.loadedPlayback = ''
                this.reconcile()
              }
            },
            onStateChange: (event) => {
              if (!this.ready || this.disposed || generation !== this.generation) return
              if (this.mode.startsWith('playlist:')) {
                // A user may need to initialize a Shorts playlist by clicking play.
                // Stop its native playback before switching to the room's canonical IDs.
                if (event.data === api.PlayerState.PLAYING) event.target.pauseVideo()
                this.sample()
                return
              }
              if (event.target.getVideoData().video_id !== this.loadedVideo) return
              if (event.data === api.PlayerState.PLAYING) {
                this.blocked = false
                this.pausedHere = false
                if (!this.state?.playing) {
                  event.target.pauseVideo()
                  return
                }
                this.updateSnapshot({ status: 'playing', error: '', errorCode: 0 })
                this.sample()
              } else if (event.data === api.PlayerState.BUFFERING) {
                this.updateSnapshot({ status: 'buffering' })
                this.sample()
              } else if (event.data === api.PlayerState.PAUSED) {
                if (this.state?.playing && this.now() - this.loadedAt > 700 && !this.blocked) this.pausedHere = true
                this.updateSnapshot({ status: this.blocked ? 'blocked' : 'paused' })
                this.sample()
              } else if (event.data === api.PlayerState.ENDED) this.sample()
            },
            onError: (event) => {
              if (this.disposed || generation !== this.generation) return
              window.clearTimeout(this.timeout)
              this.fail(event.data)
            },
            onAutoplayBlocked: () => {
              if (this.disposed || generation !== this.generation) return
              this.blocked = true
              this.updateSnapshot({ status: 'blocked', error: '' })
              this.report('blocked')
            },
          },
        })
      })
      .catch((error) => {
        if (!this.disposed && generation === this.generation) {
          window.clearTimeout(this.timeout)
          this.fail(0, error instanceof Error ? error.message : undefined)
        }
      })
  }

  update(state: RoomMusicState, isDriver: boolean, volume: number) {
    const previousPlaying = this.state?.playing
    if (state.controllerIdentity) {
      // Handoffs can keep the same video/epoch. Re-anchor before reporting an offline playhead.
      if (this.lastController && this.lastController !== state.controllerIdentity) this.loadedPlayback = ''
      this.lastController = state.controllerIdentity
    }
    this.state = state
    this.driver = isDriver
    if (this.volume !== volume) {
      this.volume = volume
      try {
        this.player?.setVolume(volume)
      } catch {
        /* Not ready yet. */
      }
    }
    const item = currentMusicItem(state)
    if (!item) {
      if (this.mode) this.clearPlayer()
      this.mode = ''
      this.loadedPlayback = ''
      this.updateSnapshot(emptyLocalPlayer())
      return
    }
    const mode = item.videoIds.length ? 'video' : `playlist:${item.id}`
    if (this.ready && this.mode.startsWith('playlist:') && mode === 'video') {
      // Resolve once, then reuse the activated iframe for the whole room queue.
      this.mode='video'; this.loadedPlayback=''; window.clearTimeout(this.timeout)
    }
    if (
      mode !== this.mode ||
      (this.loadedPlayback !== state.playbackId && (mode.startsWith('playlist:') || this.snapshot.status === 'error'))
    ) {
      this.create(mode)
      return
    }
    if (previousPlaying === false && state.playing) {
      this.pausedHere = false
      this.blocked = false
    }
    this.reconcile()
  }

  private reconcile(forceSync = false) {
    const state = this.state,
      player = this.player
    if (!state || !player || !this.ready || this.mode !== 'video') return
    const videoId = currentMusicVideo(state)
    if (!videoId) return
    const expected = roomMusicPosition(state, this.now())
    const newEpoch = this.loadedPlayback !== state.playbackId
    const shouldStart = state.playing && !this.desiredPlaying
    // Set intent before calling the iframe: mocks and some player events can be synchronous.
    this.desiredPlaying = state.playing
    if (newEpoch) {
      const changedVideo = videoId !== this.loadedVideo
      this.loadedVideo = videoId
      this.loadedPlayback = state.playbackId
      this.loadedAt = this.now()
      this.endedToken = ''
      this.pausedHere = false
      this.blocked = false
      this.lastSeek = this.now()
      this.updateSnapshot({
        status: 'loading',
        position: expected,
        title: state.metadata.title,
        duration: state.metadata.duration,
        error: '',
        errorCode: 0,
      })
      if (changedVideo || player.getVideoData().video_id !== videoId) {
        const options = { videoId, startSeconds: expected }
        if (state.playing && !this.blocked) player.loadVideoById(options)
        else player.cueVideoById(options)
      } else {
        player.seekTo(expected, true)
        if (state.playing && !this.blocked) player.playVideo()
        else if (!state.playing) player.pauseVideo()
      }
      return
    }
    if (!state.playing) {
      if (player.getPlayerState() === 1 || player.getPlayerState() === 3) player.pauseVideo()
    } else if (shouldStart && !this.blocked) player.playVideo()
    if (
      !this.driver &&
      !this.blocked &&
      !this.pausedHere &&
      state.status === 'playing' &&
      player.getPlayerState() === 1 &&
      document.visibilityState !== 'hidden' &&
      this.now() - this.lastSeek > (forceSync ? 700 : 3_000) &&
      Math.abs(player.getCurrentTime() - expected) > 1.5
    ) {
      this.lastSeek = this.now()
      player.seekTo(expected, true)
    }
  }

  sample() {
    if (this.disposed || !this.ready || !this.player || !this.state) return
    const player = this.player,
      state = this.state,
      item = currentMusicItem(state)
    if (!item) return
    if (this.mode.startsWith('playlist:')) {
      if (this.resolvedToken === state.playbackId || this.snapshot.status === 'error') return
      const ids = player.getPlaylist()?.filter(isYouTubeVideoId) ?? []
      if (ids.length) {
        const candidate = ids.join(',')
        if (this.playlistCandidate !== candidate) {
          this.playlistCandidate = candidate
          this.playlistCandidateAt = this.now()
          return
        }
        if (this.now() - this.playlistCandidateAt < 800 || this.now() - this.loadedAt < 1_000) return
        window.clearTimeout(this.timeout)
        this.resolvedToken = state.playbackId
        const initial = item.initialVideoId
          ? ids[item.startIndex] === item.initialVideoId
            ? item.startIndex
            : ids.indexOf(item.initialVideoId)
          : -1
        const selected = initial >= 0 ? initial : Math.min(ids.length - 1, item.startIndex)
        const offset = Math.min(
          Math.max(0, ids.length - MAX_ROOM_MUSIC_TRACKS),
          Math.max(0, selected - Math.floor(MAX_ROOM_MUSIC_TRACKS / 2)),
        )
        this.callbacks.resolve(
          state.playbackId,
          item.id,
          ids.slice(offset, offset + MAX_ROOM_MUSIC_TRACKS),
          offset,
          ids.length,
        )
      }
      return
    }
    const data = player.getVideoData()
    if (this.loadedPlayback !== state.playbackId) return
    if (data.video_id !== this.loadedVideo) {
      if (state.playing && this.now() - this.loadedAt > 5_000 && this.snapshot.status === 'loading') {
        this.blocked = true
        this.updateSnapshot({ status: 'blocked' })
        this.report('blocked')
      }
      return
    }
    const position = Math.min(86_400, Math.max(0, player.getCurrentTime() || 0)),
      duration = Math.min(86_400, Math.max(0, player.getDuration() || 0)),
      actual = player.getPlayerState()
    let status = this.snapshot.status
    if (status !== 'error')
      status = this.blocked
        ? 'blocked'
        : actual === 1
          ? 'playing'
          : actual === 3
            ? 'buffering'
            : actual === 2
              ? 'paused'
              : actual === 0
                ? 'ended'
                : 'ready'
    // Some browsers leave the iframe cued without emitting onAutoplayBlocked.
    if (state.playing && status === 'ready' && document.visibilityState !== 'hidden' && this.now() - this.loadedAt > 4_000) {
      this.blocked = true
      status = 'blocked'
    }
    if (status === 'ended' && (this.now() - this.loadedAt < 700 || !duration || position < duration - 1.5)) return
    this.updateSnapshot({ position, duration, title: data.title || state.metadata.title, status })
    if (status === 'ended') {
      if (this.endedToken === state.playbackId) return
      this.endedToken = state.playbackId
    }
    this.report(status)
    this.reconcile()
  }

  resume() {
    this.blocked = false
    this.pausedHere = false
    if (this.snapshot.status === 'error') {
      this.retry()
      return
    }
    this.updateSnapshot({ status: this.ready ? 'ready' : 'loading', error: '' })
    if (this.player && this.ready && this.mode.startsWith('playlist:')) {
      this.player.playVideo()
      return
    }
    if (this.player && this.ready && this.mode === 'video' && this.state) {
      this.player.seekTo(roomMusicPosition(this.state, this.now()), true)
      if (this.state.playing) this.player.playVideo()
      this.lastSeek = this.now()
    }
  }
  retry() {
    if (!this.state || !currentMusicItem(this.state)) return
    this.create(
      currentMusicItem(this.state)!.videoIds.length ? 'video' : `playlist:${currentMusicItem(this.state)!.id}`,
    )
  }
  dispose() {
    this.disposed = true
    window.clearInterval(this.interval)
    document.removeEventListener('visibilitychange', this.onVisible)
    window.removeEventListener('focus', this.onVisible)
    this.clearPlayer()
  }
}
