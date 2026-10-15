export { parseYouTubeSource, type YouTubeSource } from '../music/model.ts'

export interface YouTubePlayerEvent {
  target: YouTubePlayer
  data: number
}
export interface YouTubePlayer {
  destroy: () => void
  cuePlaylist: (options: { list: string; listType: 'playlist'; index?: number; startSeconds?: number }) => void
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void
  getCurrentTime: () => number
  getDuration: () => number
  getIframe: () => HTMLIFrameElement
  getPlayerState: () => number
  getPlaylist: () => string[] | null
  getPlaylistIndex: () => number
  getVideoData: () => { title?: string; video_id?: string }
  pauseVideo: () => void
  stopVideo: () => void
  playVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
}
export interface YouTubePlayerOptions {
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void
    onStateChange?: (event: YouTubePlayerEvent) => void
    onError?: (event: YouTubePlayerEvent) => void
    onAutoplayBlocked?: (event: YouTubePlayerEvent) => void
  }
}
export interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number }
}
declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

export const youtubeErrorMessage = (code: number, playlist = false) => {
  if (code === 2) return 'Este link não contém um vídeo ou playlist válido.'
  if (code === 5) return 'O YouTube não conseguiu iniciar o vídeo. Tente novamente.'
  if (code === 100)
    return playlist
      ? 'A playlist não está disponível. Confira se ela é pública.'
      : 'Este vídeo está privado, foi removido ou está indisponível.'
  if (code === 101 || code === 150)
    return 'O proprietário não permite tocar este vídeo fora do YouTube. Avance ou escolha outro link.'
  if (code === 153) return 'O YouTube não identificou o app. Atualize o Ford Kall ou tente pelo site.'
  return playlist
    ? 'Não foi possível carregar a playlist. Confira o link e tente novamente.'
    : 'Não foi possível carregar o YouTube. Confira a conexão e tente novamente.'
}

/** Never substitute a different origin: it breaks the iframe API's postMessage checks. */
export const youtubeEmbedUrl = (videoId: string, playlistId = '', index = 0, location = window.location) => {
  const params = new URLSearchParams({
    enablejsapi: '1',
    autoplay: '0',
    playsinline: '1',
    controls: '1',
    fs: '0',
    rel: '0',
    disablekb: '1',
  })
  if (location.protocol === 'https:' || location.protocol === 'http:') params.set('origin', location.origin)
  if (playlistId) {
    params.set('listType', 'playlist')
    params.set('list', playlistId)
    params.set('index', String(index))
  }
  return `https://www.youtube.com/embed/${playlistId ? 'videoseries' : videoId}?${params}`
}

let apiPromise: Promise<YouTubeApi> | null = null
export const loadYouTubeApi = (): Promise<YouTubeApi> => {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    const existing = document.querySelector<HTMLScriptElement>('script[data-ford-kall-youtube-api]')
    const script = existing ?? document.createElement('script')
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      script.removeEventListener('error', onError)
      if (window.onYouTubeIframeAPIReady === onReady) window.onYouTubeIframeAPIReady = previous
      if (error) {
        script.remove()
        reject(error)
      } else if (window.YT?.Player) resolve(window.YT)
      else {
        script.remove()
        reject(new Error('A API do YouTube não respondeu.'))
      }
    }
    const onReady = () => {
      try {
        previous?.()
      } catch {
        /* Other embeds must not break this loader. */
      }
      finish()
    }
    const onError = () => finish(new Error('Não foi possível carregar o YouTube. Confira a conexão e tente novamente.'))
    const timeout = window.setTimeout(
      () => finish(new Error('O YouTube demorou para responder. Tente novamente.')),
      15_000,
    )
    window.onYouTubeIframeAPIReady = onReady
    script.addEventListener('error', onError, { once: true })
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
