export interface YouTubeSource {
  kind: 'video' | 'playlist'
  sourceId: string
  url: string
  label: string
}

export interface YouTubePlayerEvent {
  target: YouTubePlayer
  data: number
}

export interface YouTubePlayer {
  destroy: () => void
  cuePlaylist: (options: YouTubePlaylistOptions) => void
  cueVideoById: (options: YouTubeVideoOptions) => void
  getCurrentTime: () => number
  getDuration: () => number
  getIframe: () => HTMLIFrameElement
  getPlayerState: () => number
  getPlaylist: () => string[] | null
  getPlaylistIndex: () => number
  getVideoData: () => { title?: string; video_id?: string }
  nextVideo: () => void
  loadPlaylist: (options: YouTubePlaylistOptions) => void
  loadVideoById: (options: YouTubeVideoOptions) => void
  pauseVideo: () => void
  playVideo: () => void
  playVideoAt: (index: number) => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
}

interface YouTubeVideoOptions {
  videoId: string
  startSeconds?: number
}

interface YouTubePlaylistOptions {
  list: string
  listType: 'playlist'
  index?: number
  startSeconds?: number
}

interface YouTubePlayerOptions {
  host?: string
  videoId?: string
  width?: string | number
  height?: string | number
  playerVars?: Record<string, string | number>
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void
    onStateChange?: (event: YouTubePlayerEvent) => void
    onError?: (event: YouTubePlayerEvent) => void
    onAutoplayBlocked?: (event: YouTubePlayerEvent) => void
  }
}

export interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer
  PlayerState: {
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,100}$/

const isYouTubeHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be'
}

export const parseYouTubeSource = (value: string): YouTubeSource | null => {
  const input = value.trim()
  if (VIDEO_ID.test(input)) {
    return {
      kind: 'video',
      sourceId: input,
      url: `https://www.youtube.com/watch?v=${input}`,
      label: 'Vídeo do YouTube',
    }
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (!isYouTubeHost(url.hostname)) return null

  const playlistId = url.searchParams.get('list')
  if (playlistId && PLAYLIST_ID.test(playlistId)) {
    return {
      kind: 'playlist',
      sourceId: playlistId,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      label: 'Playlist do YouTube',
    }
  }

  const normalizedHost = url.hostname.toLowerCase().replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  const videoId = normalizedHost === 'youtu.be'
    ? parts[0]
    : parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live'
      ? parts[1]
      : url.searchParams.get('v')

  if (!videoId || !VIDEO_ID.test(videoId)) return null
  return {
    kind: 'video',
    sourceId: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    label: 'Vídeo do YouTube',
  }
}

let apiPromise: Promise<YouTubeApi> | null = null

export const loadYouTubeApi = () => {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    let settled = false
    const previousReady = window.onYouTubeIframeAPIReady
    const existing = document.querySelector<HTMLScriptElement>('script[data-ford-kall-youtube-api]')
    const script = existing ?? document.createElement('script')
    const timeout = window.setTimeout(() => {
      script.remove()
      finish(new Error('O YouTube demorou para carregar a API.'))
    }, 15_000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      script.removeEventListener('error', onScriptError)
      if (error) reject(error)
      else if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('A API do YouTube não respondeu.'))
    }
    const onScriptError = () => {
      script.remove()
      finish(new Error('Não foi possível carregar o player do YouTube.'))
    }

    window.onYouTubeIframeAPIReady = () => {
      try {
        previousReady?.()
      } catch {
        // The YouTube API readiness callback must still resolve for this app.
      }
      finish()
    }
    script.addEventListener('error', onScriptError, { once: true })

    if (!existing) {
      script.dataset.fordKallYoutubeApi = 'true'
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      document.head.append(script)
    }
  }).catch((error: unknown) => {
    apiPromise = null
    throw error
  })

  return apiPromise
}
