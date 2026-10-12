import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RoomMusicQueueItem, RoomMusicState } from '../../types'
import {
  loadYouTubeApi,
  parseYouTubeSource,
  type YouTubeApi,
  type YouTubePlayer,
} from '../../services/youtube'
import { MAX_ROOM_MUSIC_QUEUE, roomMusicPosition } from '../../hooks/useRoomMusic'
import { getRoomMusicVolume, saveRoomMusicVolume } from '../../storage/preferences'
import { Icon } from '../ui/Icon'

interface MusicPanelProps {
  open: boolean
  isController: boolean
  state: RoomMusicState
  currentItem?: RoomMusicQueueItem
  error: string
  onAdd: (source: NonNullable<ReturnType<typeof parseYouTubeSource>>) => boolean
  onAdvance: (expectedItemId?: string) => void
  onAdvancePlaylist: (
    expectedItemId: string,
    expectedPlaylistIndex: number,
    nextPlaylistIndex: number,
  ) => void
  onClear: () => void
  onClose: () => void
  onOpen: () => void
  onErrorClose: () => void
  onPlayItem: (itemId: string) => void
  onRemove: (itemId: string) => void
  onToggle: (positionSeconds?: number) => void
  onProgress: (positionSeconds: number, playlistIndex?: number) => void
}

const playerStateName = (api: YouTubeApi | null, value: number) => {
  if (!api) return ''
  if (value === api.PlayerState.PLAYING) return 'playing'
  if (value === api.PlayerState.PAUSED) return 'paused'
  if (value === api.PlayerState.CUED) return 'cued'
  return ''
}

const playerErrorMessage = (code: number) => {
  if (code === 2) return 'O link do YouTube contém um vídeo ou playlist inválido.'
  if (code === 5) return 'O player HTML5 do YouTube não conseguiu reproduzir este vídeo.'
  if (code === 100) return 'Este vídeo foi removido, está privado ou não está disponível.'
  if (code === 101 || code === 150) return 'O dono do vídeo não permite reprodução incorporada. Escolha outro vídeo.'
  if (code === 153) return 'O YouTube não identificou a origem do player. Atualize o app ou abra o Ford Kall pelo site.'
  return 'O YouTube não conseguiu reproduzir este item. Tente outro link.'
}

const youtubePlayerOrigin = () =>
  window.location.protocol === 'https:' || window.location.protocol === 'http:'
    ? window.location.origin
    : 'https://fordkall.11a3.dev'

const formatTime = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainder = value % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

export const MusicPanel = ({
  open,
  isController,
  state,
  currentItem,
  error,
  onAdd,
  onAdvance,
  onAdvancePlaylist,
  onClear,
  onClose,
  onOpen,
  onErrorClose,
  onPlayItem,
  onRemove,
  onToggle,
  onProgress,
}: MusicPanelProps) => {
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState('')
  const [playerError, setPlayerError] = useState('')
  const [ready, setReady] = useState(false)
  const [needsLocalPlay, setNeedsLocalPlay] = useState(false)
  const [nowPlayingTitle, setNowPlayingTitle] = useState('')
  const [playbackTime, setPlaybackTime] = useState(0)
  const [playbackDuration, setPlaybackDuration] = useState(0)
  const [volume, setVolume] = useState(getRoomMusicVolume)
  const volumeRef = useRef(volume)
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const apiRef = useRef<YouTubeApi | null>(null)
  const stateRef = useRef(state)
  const loadedKeyRef = useRef('')
  const loadedItemIdRef = useRef('')
  const loadedPlaylistSourceRef = useRef('')
  const activePlaylistIndexRef = useRef<number | null>(null)
  const endedTokenRef = useRef('')
  const localPlaybackBlockedRef = useRef(false)
  const callbacksRef = useRef({ onAdvance, onAdvancePlaylist, onProgress })
  const isMini = !open && Boolean(currentItem && state.playing)
  stateRef.current = state
  volumeRef.current = volume
  callbacksRef.current = { onAdvance, onAdvancePlaylist, onProgress }
  const hasCurrentItem = Boolean(currentItem)

  useEffect(() => {
    const player = playerRef.current
    if (player && typeof player.setVolume === 'function') player.setVolume(volume)
  }, [volume])

  useEffect(() => {
    if (!hasCurrentItem || !hostRef.current) return
    const initialItem = stateRef.current.queue[stateRef.current.currentIndex]
    if (!initialItem) return
    const host = hostRef.current
    const target = document.createElement('iframe')
    target.title = 'YouTube player da sala'
    target.style.width = '100%'
    target.style.height = '100%'
    target.style.border = '0'
    target.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    target.allowFullscreen = true
    target.referrerPolicy = 'strict-origin-when-cross-origin'
    const embedUrl = new URL(
      initialItem.kind === 'video'
        ? `https://www.youtube.com/embed/${initialItem.sourceId}`
        : 'https://www.youtube.com/embed/',
    )
    embedUrl.searchParams.set('enablejsapi', '1')
    embedUrl.searchParams.set('origin', youtubePlayerOrigin())
    embedUrl.searchParams.set('controls', '0')
    embedUrl.searchParams.set('playsinline', '1')
    embedUrl.searchParams.set('rel', '0')
    embedUrl.searchParams.set('widget_referrer', 'https://fordkall.11a3.dev/')
    target.src = embedUrl.toString()
    loadedKeyRef.current = initialItem.kind === 'video' ? `${initialItem.id}:0` : ''
    loadedItemIdRef.current = initialItem.id
    loadedPlaylistSourceRef.current = initialItem.kind === 'playlist' ? initialItem.sourceId : ''
    host.replaceChildren(target)
    let cancelled = false
    let player: YouTubePlayer | null = null
    const readyTimer = window.setTimeout(() => {
      if (!cancelled) setPlayerError('O YouTube demorou para responder. Verifique bloqueadores e tente reabrir o player.')
    }, 10_000)
    setReady(false)
    setPlayerError('')
    localPlaybackBlockedRef.current = false

    void loadYouTubeApi()
      .then((api) => {
        if (cancelled) return
        apiRef.current = api
        player = new api.Player(target, {
          events: {
            onReady: ({ target }) => {
              if (cancelled) return
              window.clearTimeout(readyTimer)
              target.setVolume(volumeRef.current)
              const iframe = target.getIframe()
              iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
              iframe.allowFullscreen = true
              setPlayerError('')
              setReady(true)
            },
            onStateChange: ({ target, data }) => {
              if (cancelled) return
              const status = playerStateName(api, data)
              if (status === 'playing') {
                localPlaybackBlockedRef.current = false
                setNeedsLocalPlay(false)
                setPlayerError('')
              }
              const current = stateRef.current
              const activeItem = current.queue[current.currentIndex]
              if (activeItem?.kind === 'playlist' && (status === 'playing' || status === 'cued')) {
                const activeIndex = target.getPlaylistIndex()
                if (Number.isInteger(activeIndex) && activeIndex >= 0) {
                  activePlaylistIndexRef.current = activeIndex
                  if (
                    status === 'playing' &&
                    activeItem.id === loadedItemIdRef.current &&
                    activeIndex > current.playlistIndex
                  ) {
                    // YouTube may have auto-advanced before its ENDED event
                    // reaches every client. Report the actual playing index;
                    // the controller applies it only if the old index is still
                    // current, so concurrent reports cannot skip twice.
                    callbacksRef.current.onAdvancePlaylist(
                      activeItem.id,
                      current.playlistIndex,
                      activeIndex,
                    )
                  }
                }
              }
              if (status === 'playing' || status === 'cued') {
                const title = target.getVideoData().title?.trim()
                if (title) setNowPlayingTitle(title.slice(0, 160))
              }
              if (data !== api.PlayerState.ENDED) return

              const item = current.queue[current.currentIndex]
              if (!item || item.id !== loadedItemIdRef.current) return

              if (
                item.kind === 'video' &&
                target.getVideoData().video_id &&
                target.getVideoData().video_id !== item.sourceId
              ) return

              const expectedPlaylistIndex = item.kind === 'playlist'
                ? activePlaylistIndexRef.current ?? current.playlistIndex
                : 0
              // A delayed ENDED callback for the previous clip must not
              // advance a playlist after another participant already moved
              // the room to the next index.
              if (item.kind === 'playlist' && expectedPlaylistIndex !== current.playlistIndex) return
              const endedToken = `${item.id}:${expectedPlaylistIndex}`
              if (endedTokenRef.current === endedToken) return
              endedTokenRef.current = endedToken

              if (item.kind !== 'playlist') {
                callbacksRef.current.onAdvance(item.id)
                return
              }

              const playlist = target.getPlaylist() ?? []
              const actualPlaylistIndex = target.getPlaylistIndex()
              const nextIndex = Number.isInteger(actualPlaylistIndex) && actualPlaylistIndex > expectedPlaylistIndex
                ? actualPlaylistIndex
                : expectedPlaylistIndex + 1
              if (nextIndex < playlist.length) {
                callbacksRef.current.onAdvancePlaylist(item.id, expectedPlaylistIndex, nextIndex)
              } else {
                callbacksRef.current.onAdvance(item.id)
              }
            },
            onError: ({ data }) => {
              if (cancelled) return
              setPlayerError(playerErrorMessage(data))
              setNeedsLocalPlay(false)
            },
            onAutoplayBlocked: () => {
              if (cancelled) return
              localPlaybackBlockedRef.current = true
              setNeedsLocalPlay(true)
            },
          },
        })
        playerRef.current = player
      })
      .catch(() => {
        if (!cancelled) setPlayerError('Não foi possível carregar o player do YouTube.')
      })

    return () => {
      cancelled = true
      window.clearTimeout(readyTimer)
      setReady(false)
      loadedKeyRef.current = ''
      loadedItemIdRef.current = ''
      loadedPlaylistSourceRef.current = ''
      activePlaylistIndexRef.current = null
      endedTokenRef.current = ''
      localPlaybackBlockedRef.current = false
      playerRef.current = null
      if (player && typeof player.destroy === 'function') player.destroy()
      host.replaceChildren()
    }
  }, [hasCurrentItem])

  useEffect(() => {
    if (!ready || !currentItem || !playerRef.current) return
    const player = playerRef.current
    const position = roomMusicPosition(state)
    const loadedKey = `${currentItem.id}:${currentItem.kind === 'playlist' ? state.playlistIndex : 0}`

    if (loadedKeyRef.current !== loadedKey) {
      const playerAlreadyOnTargetPlaylist = currentItem.kind === 'playlist' &&
        loadedItemIdRef.current === currentItem.id &&
        loadedPlaylistSourceRef.current === currentItem.sourceId &&
        player.getPlaylistIndex() === state.playlistIndex &&
        Boolean(player.getPlaylist()?.length)

      if (playerAlreadyOnTargetPlaylist) {
        // YouTube advances its own playlist before/around ENDED. Keep that
        // already-playing item instead of reloading it and replaying its intro.
        loadedKeyRef.current = loadedKey
      } else {
        loadedKeyRef.current = loadedKey
        loadedItemIdRef.current = currentItem.id
        loadedPlaylistSourceRef.current = currentItem.kind === 'playlist' ? currentItem.sourceId : ''
        activePlaylistIndexRef.current = null
        endedTokenRef.current = ''
        setPlayerError('')
        setNowPlayingTitle('')
        setNeedsLocalPlay(false)
        localPlaybackBlockedRef.current = false
        if (currentItem.kind === 'playlist') {
          const options = {
            list: currentItem.sourceId,
            listType: 'playlist' as const,
            index: state.playlistIndex,
            startSeconds: position,
          }
          if (state.playing) player.loadPlaylist(options)
          else player.cuePlaylist(options)
        } else {
          const options = { videoId: currentItem.sourceId, startSeconds: position }
          if (state.playing) player.loadVideoById(options)
          else player.cueVideoById(options)
        }
        return
      }
    }

    const actualPosition = player.getCurrentTime()
    if (Number.isFinite(actualPosition) && Math.abs(actualPosition - position) > 1.35) {
      player.seekTo(position, true)
    }
    const api = apiRef.current
    const playerState = api ? player.getPlayerState() : -1
    if (state.playing) {
      if (
        !localPlaybackBlockedRef.current &&
        playerState !== api?.PlayerState.PLAYING &&
        playerState !== api?.PlayerState.BUFFERING &&
        playerState !== api?.PlayerState.ENDED
      ) player.playVideo()
    } else if (
      playerState === api?.PlayerState.PLAYING ||
      playerState === api?.PlayerState.BUFFERING
    ) {
      player.pauseVideo()
    }
  }, [currentItem, ready, state])

  useEffect(() => {
    if (!ready || !state.playing || !currentItem) return
    const timer = window.setInterval(() => {
      const player = playerRef.current
      const api = apiRef.current
      if (!player || !api) return
      const current = stateRef.current
      if (!current.playing || player.getPlayerState() !== api.PlayerState.PLAYING) return
      const actualPosition = player.getCurrentTime()
      if (!Number.isFinite(actualPosition)) return
      const currentItem = current.queue[current.currentIndex]
      const playlistIndex = currentItem?.kind === 'playlist'
        ? player.getPlaylistIndex()
        : undefined
      callbacksRef.current.onProgress(
        actualPosition,
        Number.isInteger(playlistIndex) && Number(playlistIndex) >= 0 ? Number(playlistIndex) : undefined,
      )
      const expectedPosition = roomMusicPosition(current)
      if (Math.abs(actualPosition - expectedPosition) > 1.8) player.seekTo(expectedPosition, true)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [currentItem, ready, state.playing])

  useEffect(() => {
    if (!ready || !currentItem) {
      setPlaybackTime(roomMusicPosition(state))
      setPlaybackDuration(0)
      return
    }

    const updateTimeline = () => {
      const player = playerRef.current
      if (!player) return
      const time = player.getCurrentTime()
      const duration = player.getDuration()
      if (Number.isFinite(time)) setPlaybackTime(Math.max(0, time))
      if (Number.isFinite(duration) && duration > 0) setPlaybackDuration(duration)
    }

    updateTimeline()
    const timer = window.setInterval(updateTimeline, 1_000)
    return () => window.clearInterval(timer)
  }, [currentItem?.id, ready, state.playing, state.playlistIndex])

  useEffect(() => {
    const reconcilePlayback = () => {
      if (document.visibilityState === 'hidden') return
      const player = playerRef.current
      const api = apiRef.current
      const current = stateRef.current
      if (!player || !api || !current.playing || localPlaybackBlockedRef.current) return

      const currentItem = current.queue[current.currentIndex]
      const playlistIndex = currentItem?.kind === 'playlist'
        ? player.getPlaylistIndex()
        : undefined
      const actualPosition = player.getCurrentTime()
      if (Number.isFinite(actualPosition)) {
        callbacksRef.current.onProgress(
          actualPosition,
          Number.isInteger(playlistIndex) && Number(playlistIndex) >= 0
            ? Number(playlistIndex)
            : undefined,
        )
        const expectedPosition = roomMusicPosition(current)
        if (Math.abs(actualPosition - expectedPosition) > 1.8) player.seekTo(expectedPosition, true)
      }

      const playerState = player.getPlayerState()
      if (
        playerState !== api.PlayerState.PLAYING &&
        playerState !== api.PlayerState.BUFFERING &&
        playerState !== api.PlayerState.ENDED
      ) player.playVideo()
    }

    document.addEventListener('visibilitychange', reconcilePlayback)
    window.addEventListener('focus', reconcilePlayback)
    return () => {
      document.removeEventListener('visibilitychange', reconcilePlayback)
      window.removeEventListener('focus', reconcilePlayback)
    }
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const source = parseYouTubeSource(input)
    if (!source) {
      setInputError('Cole um link válido de vídeo ou playlist do YouTube.')
      return
    }
    if (onAdd(source)) {
      setInput('')
      setInputError('')
    }
  }

  const currentPosition = () => {
    const player = playerRef.current
    const value = player && typeof player.getCurrentTime === 'function'
      ? player.getCurrentTime()
      : undefined
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : roomMusicPosition(state)
  }

  return (
    <aside
      aria-hidden={!open && !isMini}
      aria-label="Player da sala"
      className={`music-panel ${open ? 'is-open' : ''} ${isMini ? 'is-mini' : ''}`}
    >
      <header>
        <div className="music-panel__brand">
          <span className="music-panel__brand-icon"><Icon name="music" /></span>
          <span>
            <strong>Ford Kall Music</strong>
            <small><i />{isMini ? 'Tocando na sala' : isController ? 'Player da sala · ao vivo' : 'Sincronizado com a sala'}</small>
          </span>
        </div>
        <button
          aria-label={isMini ? 'Abrir controles do player' : 'Minimizar player'}
          className="icon-button"
          onClick={isMini ? onOpen : onClose}
          type="button"
        >
          <Icon name={isMini ? 'expand' : 'x'} />
        </button>
      </header>

      <div className="music-panel__body">
        <div className="music-deck">
          <div className={`music-player ${currentItem ? 'has-track' : ''}`}>
            <div className="music-player__host" ref={hostRef} />
            {!currentItem && (
              <div className="music-player__empty">
                <span className="music-player__empty-art"><Icon name="music" /></span>
                <strong>Sua próxima trilha começa aqui</strong>
                <span>Adicione um vídeo ou playlist à sala.</span>
              </div>
            )}
            {currentItem && <span className="music-player__badge"><i />{state.playing ? 'AO VIVO NA SALA' : 'PAUSADO'}</span>}
            {needsLocalPlay && currentItem && (
              <button
                className="music-player__resume"
                onClick={() => {
                  localPlaybackBlockedRef.current = false
                  playerRef.current?.playVideo()
                  setNeedsLocalPlay(false)
                }}
                type="button"
              >
                <Icon name="play" /> Ouvir neste dispositivo
              </button>
            )}
          </div>

          <div className="music-now-playing">
            <div className="music-now-playing__eyebrow">
              <span>{currentItem ? 'TOCANDO AGORA' : 'PLAYER DA SALA'}</span>
              {currentItem && <small>{currentItem.kind === 'playlist' ? `PLAYLIST · ${state.playlistIndex + 1}` : 'VÍDEO'}</small>}
            </div>
            <strong title={nowPlayingTitle || currentItem?.label}>
              {currentItem ? nowPlayingTitle || currentItem.label : 'Nenhuma faixa selecionada'}
            </strong>
            <small>{currentItem?.addedBy ? `Na fila por ${currentItem.addedBy}` : currentItem ? 'Fila compartilhada' : 'O que vamos ouvir?'}</small>
          </div>

          <div
            aria-label="Progresso da faixa"
            aria-valuemax={playbackDuration || 1}
            aria-valuemin={0}
            aria-valuenow={Math.min(playbackTime, playbackDuration || playbackTime)}
            className="music-timeline"
            role="progressbar"
          >
            <span><i style={{ width: `${playbackDuration > 0 ? Math.min(100, playbackTime / playbackDuration * 100) : 0}%` }} /></span>
            <div><small>{formatTime(playbackTime)}</small><small>{playbackDuration ? formatTime(playbackDuration) : '--:--'}</small></div>
          </div>

          <div className="music-controls">
            <button
              aria-label={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
              className="music-controls__play"
              disabled={!currentItem || !ready}
              onClick={() => onToggle(currentPosition())}
              title={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
              type="button"
            >
              <Icon name={state.playing ? 'pause' : 'play'} />
            </button>
            <button
              aria-label="Próximo item"
              disabled={!currentItem || !ready}
              onClick={() => onAdvance(currentItem?.id)}
              title="Próximo item"
              type="button"
            >
              <Icon name="skip" />
            </button>
            <label className="music-volume">
              <Icon name={volume === 0 ? 'volumeOff' : 'audio'} />
              <input
                aria-label="Volume da música neste dispositivo"
                max="100"
                min="0"
                onChange={(event) => {
                  const next = Number(event.target.value)
                  setVolume(next)
                  saveRoomMusicVolume(next)
                }}
                type="range"
                value={volume}
              />
              <output>{volume}%</output>
            </label>
          </div>
        </div>

        <div className="music-library">
          <form className="music-add" onSubmit={submit}>
            <label htmlFor="music-queue-url">Adicionar à fila</label>
            <div>
              <input
                id="music-queue-url"
                aria-label="Link de vídeo ou playlist do YouTube"
                onChange={(event) => setInput(event.target.value)}
                placeholder="Cole um link do YouTube"
                spellCheck={false}
                value={input}
              />
              <button aria-label="Adicionar à fila" disabled={!input.trim()} type="submit"><Icon name="send" /></button>
            </div>
          </form>
          {inputError && <p className="music-inline-error">{inputError}</p>}
          {playerError && <p className="music-inline-error">{playerError}</p>}
          {error && (
            <div className="music-sync-error">
              <span>{error}</span>
              <button aria-label="Fechar erro" onClick={onErrorClose} type="button"><Icon name="x" /></button>
            </div>
          )}

          <section className="music-queue">
            <header>
              <span>A seguir</span>
              <div>
                <small>{state.queue.length} / {MAX_ROOM_MUSIC_QUEUE}</small>
                {state.queue.length > 0 && <button onClick={onClear} type="button">Limpar</button>}
              </div>
            </header>
            {state.queue.length === 0 ? (
              <p>A fila está vazia. Adicione uma música para começar.</p>
            ) : (
              <ol>
                {state.queue.map((item, index) => (
                  <li className={index === state.currentIndex ? 'is-current' : ''} key={item.id}>
                    <button
                      aria-label={`Tocar ${item.label}`}
                      className="music-queue__select"
                      onClick={() => onPlayItem(item.id)}
                      type="button"
                    >
                      <span>{index === state.currentIndex && state.playing ? <Icon name="audio" /> : index + 1}</span>
                      <span><strong>{item.label}</strong><small>{item.kind === 'playlist' ? 'Playlist' : 'Vídeo'} · {item.addedBy}</small></span>
                    </button>
                    <button
                      aria-label={`Remover ${item.label}`}
                      className="music-queue__remove"
                      onClick={() => onRemove(item.id)}
                      title="Remover da fila"
                      type="button"
                    >
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </aside>
  )
}
