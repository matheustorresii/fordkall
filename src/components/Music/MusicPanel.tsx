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
  onErrorClose: () => void
  onPlayItem: (itemId: string) => void
  onRemove: (itemId: string) => void
  onToggle: (positionSeconds?: number) => void
}

const playerStateName = (api: YouTubeApi | null, value: number) => {
  if (!api) return ''
  if (value === api.PlayerState.PLAYING) return 'playing'
  if (value === api.PlayerState.PAUSED) return 'paused'
  if (value === api.PlayerState.CUED) return 'cued'
  return ''
}

export const MusicPanel = ({
  open,
  state,
  currentItem,
  error,
  onAdd,
  onAdvance,
  onAdvancePlaylist,
  onClear,
  onClose,
  onErrorClose,
  onPlayItem,
  onRemove,
  onToggle,
}: MusicPanelProps) => {
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState('')
  const [playerError, setPlayerError] = useState('')
  const [ready, setReady] = useState(false)
  const [needsLocalPlay, setNeedsLocalPlay] = useState(false)
  const [nowPlayingTitle, setNowPlayingTitle] = useState('')
  const [volume, setVolume] = useState(getRoomMusicVolume)
  const volumeRef = useRef(volume)
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const apiRef = useRef<YouTubeApi | null>(null)
  const stateRef = useRef(state)
  const loadedKeyRef = useRef('')
  const loadedItemIdRef = useRef('')
  const callbacksRef = useRef({ onAdvance, onAdvancePlaylist })
  stateRef.current = state
  volumeRef.current = volume
  callbacksRef.current = { onAdvance, onAdvancePlaylist }
  const hasCurrentItem = Boolean(currentItem)

  useEffect(() => {
    const player = playerRef.current
    if (player && typeof player.setVolume === 'function') player.setVolume(volume)
  }, [volume])

  useEffect(() => {
    if (!open || !currentItem || !hostRef.current) return
    const host = hostRef.current
    const target = document.createElement('div')
    target.style.width = '100%'
    target.style.height = '100%'
    host.replaceChildren(target)
    let cancelled = false
    let player: YouTubePlayer | null = null
    const readyTimer = window.setTimeout(() => {
      if (!cancelled) setPlayerError('O YouTube demorou para responder. Verifique bloqueadores e tente reabrir o player.')
    }, 10_000)
    setReady(false)
    setPlayerError('')

    void loadYouTubeApi()
      .then((api) => {
        if (cancelled) return
        apiRef.current = api
        player = new api.Player(target, {
          width: '100%',
          height: '100%',
          videoId: currentItem.sourceId,
          playerVars: {
            controls: 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: ({ target }) => {
              window.clearTimeout(readyTimer)
              target.setVolume(volumeRef.current)
              setReady(true)
            },
            onStateChange: ({ target, data }) => {
              const status = playerStateName(api, data)
              if (status === 'playing') {
                setNeedsLocalPlay(false)
                setPlayerError('')
              }
              if (status === 'playing' || status === 'cued') {
                const title = target.getVideoData().title?.trim()
                if (title) setNowPlayingTitle(title.slice(0, 160))
              }
              if (data !== api.PlayerState.ENDED) return

              const current = stateRef.current
              const item = current.queue[current.currentIndex]
              if (!item || item.id !== loadedItemIdRef.current) return
              const expectedItemId = item.id
              const expectedPlaylistIndex = current.playlistIndex

              if (item.kind !== 'playlist') {
                callbacksRef.current.onAdvance(expectedItemId)
                return
              }

              window.setTimeout(() => {
                const activePlayer = playerRef.current
                if (!activePlayer) return
                const playlist = activePlayer.getPlaylist() ?? []
                const actualIndex = activePlayer.getPlaylistIndex()
                if (actualIndex > expectedPlaylistIndex) {
                  callbacksRef.current.onAdvancePlaylist(
                    expectedItemId,
                    expectedPlaylistIndex,
                    actualIndex,
                  )
                } else if (expectedPlaylistIndex + 1 < playlist.length) {
                  activePlayer.playVideoAt(expectedPlaylistIndex + 1)
                  callbacksRef.current.onAdvancePlaylist(
                    expectedItemId,
                    expectedPlaylistIndex,
                    expectedPlaylistIndex + 1,
                  )
                } else {
                  callbacksRef.current.onAdvance(expectedItemId)
                }
              }, 450)
            },
            onError: () => setPlayerError('Este vídeo não pôde ser reproduzido pelo player incorporado.'),
            onAutoplayBlocked: () => setNeedsLocalPlay(true),
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
      playerRef.current = null
      if (player && typeof player.destroy === 'function') player.destroy()
      host.replaceChildren()
    }
  }, [hasCurrentItem, open])

  useEffect(() => {
    if (!open || !ready || !currentItem || !playerRef.current) return
    const player = playerRef.current
    const position = roomMusicPosition(state)
    const loadedKey = `${currentItem.id}:${currentItem.kind === 'playlist' ? state.playlistIndex : 0}`

    if (loadedKeyRef.current !== loadedKey) {
      loadedKeyRef.current = loadedKey
      loadedItemIdRef.current = currentItem.id
      setNowPlayingTitle('')
      setNeedsLocalPlay(false)
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

    const actualPosition = player.getCurrentTime()
    if (Number.isFinite(actualPosition) && Math.abs(actualPosition - position) > 2.5) {
      player.seekTo(position, true)
    }
    if (state.playing) player.playVideo()
    else player.pauseVideo()
  }, [currentItem, open, ready, state])

  useEffect(() => {
    if (!open || !ready || !state.playing || !currentItem) return
    const timer = window.setInterval(() => {
      const player = playerRef.current
      const api = apiRef.current
      if (!player || !api) return
      const actualPosition = player.getCurrentTime()
      const expectedPosition = roomMusicPosition(stateRef.current)
      if (Math.abs(actualPosition - expectedPosition) > 3) player.seekTo(expectedPosition, true)
      if (player.getPlayerState() !== api.PlayerState.PLAYING && !playerError) {
        setNeedsLocalPlay(true)
      }
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [currentItem, open, playerError, ready, state.playing])

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
    <aside aria-hidden={!open} aria-label="Player da sala" className={`music-panel ${open ? 'is-open' : ''}`}>
      <header>
        <div><Icon name="music" /><span><strong>Player da sala</strong><small>YouTube sincronizado</small></span></div>
        <button aria-label="Fechar player" className="icon-button" onClick={onClose} type="button"><Icon name="x" /></button>
      </header>

      <div className="music-panel__body">
        <div className="music-player">
          {open && <div className="music-player__host" ref={hostRef} />}
          {!currentItem && (
            <div className="music-player__empty">
              <Icon name="music" />
              <strong>Nada tocando</strong>
              <span>Adicione um vídeo ou playlist.</span>
            </div>
          )}
          {needsLocalPlay && currentItem && (
            <button
              className="music-player__resume"
              onClick={() => {
                playerRef.current?.playVideo()
                setNeedsLocalPlay(false)
              }}
              type="button"
            >
              <Icon name="play" /> Ouvir neste dispositivo
            </button>
          )}
        </div>

        {currentItem && (
          <div className="music-now-playing">
            <span>Tocando agora</span>
            <strong title={nowPlayingTitle || currentItem.label}>{nowPlayingTitle || currentItem.label}</strong>
            <small>{currentItem.addedBy ? `Adicionado por ${currentItem.addedBy}` : 'Fila compartilhada'}</small>
          </div>
        )}

        <div className="music-controls">
          <button
            aria-label={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
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

        <form className="music-add" onSubmit={submit}>
          <input
            aria-label="Link de vídeo ou playlist do YouTube"
            onChange={(event) => setInput(event.target.value)}
            placeholder="Link do YouTube"
            spellCheck={false}
            value={input}
          />
          <button disabled={!input.trim()} type="submit">Adicionar</button>
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
            <span>Fila</span>
            <div>
              <small>{state.queue.length}/{MAX_ROOM_MUSIC_QUEUE}</small>
              {state.queue.length > 0 && <button onClick={onClear} type="button">Limpar</button>}
            </div>
          </header>
          {state.queue.length === 0 ? (
            <p>A fila está vazia.</p>
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
    </aside>
  )
}
