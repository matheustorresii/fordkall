import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { RoomMusicController } from '../../hooks/useRoomMusic'
import {
  MAX_ROOM_MUSIC_QUEUE,
  MAX_ROOM_MUSIC_TRACKS,
  currentMusicVideo,
  parseYouTubeSource,
  roomMusicPosition,
} from '../../music/model'
import {
  YouTubeRoomPlayer,
  emptyLocalPlayer,
  type PlayerDependencies,
} from '../../music/YouTubeRoomPlayer'
import {
  getRoomMusicListening,
  getRoomMusicVolume,
  saveRoomMusicListening,
  saveRoomMusicVolume,
} from '../../storage/preferences'
import { Icon } from '../ui/Icon'
import './MusicPanel.css'

interface MusicPanelProps {
  open: boolean
  deafened?: boolean
  music: RoomMusicController
  onClose: () => void
  onOpen: () => void
  /** Only supplied by the development harness; production always uses the official iframe API. */
  playerDependencies?: PlayerDependencies
}
export const formatMusicTime = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds)),
    hours = Math.floor(value / 3_600),
    minutes = Math.floor((value % 3_600) / 60),
    remainder = String(value % 60).padStart(2, '0')
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`
}

export const MusicPanel = ({
  open,
  deafened = false,
  music,
  onClose,
  onOpen,
  playerDependencies,
}: MusicPanelProps) => {
  const { state, currentItem, identity, ready, command } = music
  const [input, setInput] = useState(''),
    [inputError, setInputError] = useState('')
  const [sourceMode, setSourceMode] = useState<'auto' | 'video' | 'playlist'>(
    'auto',
  )
  const [listening, setListening] = useState(getRoomMusicListening)
  const [volume, setVolume] = useState(getRoomMusicVolume)
  const [local, setLocal] = useState(emptyLocalPlayer)
  const [position, setPosition] = useState(0),
    [scrubbing, setScrubbing] = useState<number | null>(null)
  const [expandedPlaylist, setExpandedPlaylist] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null),
    playerRef = useRef<YouTubeRoomPlayer | null>(null)
  const musicRef = useRef(music),
    stateRef = useRef(state)
  musicRef.current = music
  stateRef.current = state
  const enabled = listening
  const hasItem = Boolean(currentItem)
  const mini = !open && enabled && hasItem
  const visible = open || mini

  useEffect(() => {
    music.setListening(enabled && !deafened)
  }, [enabled, deafened, music.setListening])
  useEffect(() => {
    if (!enabled || !hasItem || !hostRef.current) {
      setLocal(emptyLocalPlayer())
      return
    }
    const player = new YouTubeRoomPlayer(
      hostRef.current,
      {
        change: setLocal,
        report: (report) => musicRef.current.report(report),
        resolve: (playbackId, itemId, videoIds, offset, total) =>
          musicRef.current.command({
            type: 'resolve',
            playbackId,
            itemId,
            videoIds,
            offset,
            total,
          }),
      },
      playerDependencies,
    )
    playerRef.current = player
    player.update(
      stateRef.current,
      stateRef.current.driverIdentity === musicRef.current.identity,
      deafened ? 0 : volume,
    )
    return () => {
      player.dispose()
      if (playerRef.current === player) playerRef.current = null
    }
  }, [enabled, hasItem, playerDependencies])
  useEffect(() => {
    playerRef.current?.update(
      state,
      state.driverIdentity === identity,
      deafened ? 0 : volume,
    )
  }, [state, identity, volume, deafened])
  useEffect(() => {
    const update = () => setPosition(roomMusicPosition(stateRef.current))
    update()
    const timer = window.setInterval(update, 500)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    setScrubbing(null)
    setPosition(roomMusicPosition(stateRef.current))
  }, [state.playbackId])
  useEffect(() => {
    if (open) setConfirmClear(false)
  }, [open])

  const toggleListening = () => {
    const next = !listening
    if (!next) {
      playerRef.current?.dispose()
      playerRef.current = null
      music.setListening(false)
    }
    setListening(next)
    saveRoomMusicListening(next)
  }
  const source = parseYouTubeSource(input, sourceMode)
  const bothSources =
    parseYouTubeSource(input, 'video') && parseYouTubeSource(input, 'playlist')
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!source) {
      setInputError(
        'Use um link de vídeo ou playlist pública do YouTube ou YouTube Music.',
      )
      return
    }
    if (music.addSource(source)) {
      setInput('')
      setInputError('')
      setSourceMode('auto')
    }
  }
  const seek = () => {
    if (scrubbing !== null) {
      command({
        type: 'seek',
        playbackId: state.playbackId,
        position: scrubbing,
      })
      setScrubbing(null)
    }
  }
  const videoId = currentMusicVideo(state)
  const title =
    state.metadata.title ||
    local.title ||
    currentItem?.label ||
    'Nenhuma música na fila'
  const duration = state.metadata.duration || local.duration
  const unavailable = state.status === 'unavailable'
  const needsGesture =
    enabled &&
    state.playing &&
    (local.status === 'blocked' || local.status === 'paused')
  const resolvingPlaylist =
    enabled &&
    currentItem?.kind === 'playlist' &&
    !currentItem.videoIds.length &&
    local.status === 'ready'
  const localLabel = deafened
    ? 'Som desativado pelo deafen'
    : !listening
      ? 'Você não está ouvindo'
      : local.status === 'playing'
        ? 'Você está ouvindo'
        : local.status === 'blocked'
          ? 'Clique para liberar o áudio'
          : local.status === 'error'
            ? 'Não reproduziu neste dispositivo'
            : local.status === 'buffering' || local.status === 'loading'
              ? 'Carregando neste dispositivo…'
              : state.playing && !hasItem
                ? 'Escolha uma música'
                : state.playing
                  ? 'Conectando ao player…'
                  : 'Pronto para ouvir'
  const roomLabel = !ready
    ? 'Sincronizando sala…'
    : state.status === 'playing'
      ? `${state.listeners.length} ouvindo agora`
      : state.status === 'waiting' || state.status === 'loading'
        ? 'Aguardando reprodução'
        : state.status === 'paused'
          ? 'Pausado para todos'
          : state.status === 'ended'
            ? 'Fim da fila'
            : unavailable
              ? 'Faixa indisponível'
              : 'Fila compartilhada'

  return createPortal(
    <aside
      aria-label="Música da sala"
      aria-hidden={!visible}
      className={`room-music ${open ? 'is-open' : ''} ${mini ? 'is-mini' : ''}`}
    >
      <header className="room-music__header">
        <span className="room-music__symbol">
          <Icon name="music" />
        </span>
        <div>
          <strong>Música da sala</strong>
          <span aria-live="polite">
            <i className={state.status === 'playing' ? 'is-playing' : ''} />
            {roomLabel}
          </span>
        </div>
        <button
          aria-label={mini ? 'Expandir player' : 'Minimizar player'}
          className="icon-button"
          onClick={mini ? onOpen : onClose}
          type="button"
        >
          <Icon name={mini ? 'expand' : 'collapse'} />
        </button>
        <button
          aria-label="Fechar player e parar de ouvir neste dispositivo"
          title="Fechar e parar de ouvir aqui"
          className="icon-button"
          type="button"
          onClick={() => {
            playerRef.current?.dispose()
            playerRef.current = null
            setListening(false)
            saveRoomMusicListening(false)
            music.setListening(false)
            onClose()
          }}
        >
          <Icon name="x" />
        </button>
      </header>

      <div className="room-music__body">
        <section className="room-music__deck" aria-label="Reprodução">
          <div
            className={`room-music__video ${enabled && hasItem ? 'has-player' : ''}`}
          >
            <div ref={hostRef} className="room-music__iframe" />
            {(!enabled || !hasItem) && (
              <div className="room-music__placeholder">
                <div className="room-music__record">
                  <Icon name={hasItem ? 'headphones' : 'music'} />
                </div>
                <strong>
                  {hasItem ? 'A fila continua na sala' : 'O que vamos ouvir?'}
                </strong>
                <span>
                  {hasItem
                    ? 'Entre na música quando quiser.'
                    : 'YouTube e YouTube Music, juntos na call.'}
                </span>
              </div>
            )}
          </div>
          <div className="room-music__track">
            <span>
              {currentItem?.kind === 'playlist'
                ? `Playlist · faixa ${currentItem.playlistOffset + state.playlistIndex + 1} de ${currentItem.totalTracks || '…'}`
                : currentItem?.provider === 'youtube-music'
                  ? 'YouTube Music'
                  : 'YouTube'}
            </span>
            <strong title={title}>{title}</strong>
            {!mini && (
              <small>
                {currentItem
                  ? `Adicionado por ${currentItem.addedBy}`
                  : 'Adicione um link. Todos recebem a mesma fila.'}
              </small>
            )}
          </div>

          <div className="room-music__transport">
            <button
              aria-label="Faixa anterior"
              title="Faixa anterior para todos"
              disabled={!currentItem || !ready}
              onClick={() =>
                command({ type: 'previous', playbackId: state.playbackId })
              }
              type="button"
            >
              <Icon name="skip" className="room-music__previous" />
            </button>
            <button
              className="room-music__play"
              aria-label={
                state.playing ? 'Pausar para todos' : 'Tocar para todos'
              }
              title={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
              disabled={!currentItem || !ready}
              onClick={() =>
                command({
                  type: 'set-playing',
                  playbackId: state.playbackId,
                  playing: !state.playing,
                })
              }
              type="button"
            >
              <Icon name={state.playing ? 'pause' : 'play'} />
            </button>
            <button
              aria-label="Próxima faixa"
              title="Próxima faixa para todos"
              disabled={!currentItem || !ready}
              onClick={() =>
                command({ type: 'next', playbackId: state.playbackId })
              }
              type="button"
            >
              <Icon name="skip" />
            </button>
            <select
              aria-label="Repetição da fila"
              value={state.repeat}
              disabled={!ready}
              onChange={(event) =>
                command({
                  type: 'repeat',
                  repeat: event.target.value as typeof state.repeat,
                })
              }
            >
              <option value="off">Sem repetir</option>
              <option value="all">Repetir fila</option>
              <option value="one">Repetir faixa</option>
            </select>
          </div>
          <div className="room-music__timeline">
            <input
              aria-label="Posição da música para todos"
              type="range"
              min="0"
              max={duration || 1}
              step="1"
              disabled={!duration || !videoId || !ready}
              value={Math.min(duration || 1, scrubbing ?? position)}
              onChange={(event) => setScrubbing(Number(event.target.value))}
              onPointerUp={seek}
              onKeyUp={(event) => {
                if (
                  [
                    'ArrowLeft',
                    'ArrowRight',
                    'Home',
                    'End',
                    'PageUp',
                    'PageDown',
                  ].includes(event.key)
                )
                  seek()
              }}
              onBlur={seek}
            />
            <span>
              <time>{formatMusicTime(scrubbing ?? position)}</time>
              <time>{duration ? formatMusicTime(duration) : '—:—'}</time>
            </span>
          </div>

          <div
            className={`room-music__local ${!listening || deafened ? 'is-off' : ''}`}
          >
            <Icon name={enabled ? 'headphones' : 'volumeOff'} />
            <div>
              <strong>{localLabel}</strong>
              <span>Só neste dispositivo</span>
            </div>
            <button
              type="button"
              disabled={deafened}
              aria-label={listening ? 'Parar de ouvir aqui' : 'Ouvir aqui'}
              onClick={toggleListening}
            >
              {listening ? 'Desconectar' : 'Ouvir aqui'}
            </button>
          </div>
          {(needsGesture || resolvingPlaylist) && (
            <button
              className="room-music__unlock"
              onClick={() => playerRef.current?.resume()}
              type="button"
            >
              <Icon name="play" />
              {resolvingPlaylist
                ? 'Carregar faixas da playlist'
                : local.status === 'blocked'
                  ? 'Liberar áudio neste dispositivo'
                  : 'Voltar a ouvir a sala'}
            </button>
          )}
          {enabled && local.error && (
            <div className="room-music__notice" role="status">
              <span>{local.error}</span>
              <button
                onClick={() => {
                  if (unavailable)
                    command({ type: 'retry', playbackId: state.playbackId })
                  else playerRef.current?.retry()
                }}
                type="button"
              >
                Tentar novamente
              </button>
            </div>
          )}
          {!local.error && state.error && (
            <div className="room-music__notice" role="status">
              <span>{state.error}</span>
              <button
                onClick={() =>
                  command({ type: 'retry', playbackId: state.playbackId })
                }
                type="button"
              >
                Tentar novamente
              </button>
            </div>
          )}
          <label className="room-music__volume">
            <Icon name={volume ? 'audio' : 'volumeOff'} />
            <input
              aria-label="Volume da música neste dispositivo"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => {
                const next = Number(event.target.value)
                setVolume(next)
                saveRoomMusicVolume(next)
              }}
            />
            <output>{volume}%</output>
          </label>
          {currentItem && (
            <a
              className="room-music__external"
              href={
                videoId
                  ? `https://www.youtube.com/watch?v=${videoId}`
                  : currentItem.url
              }
              target="_blank"
              rel="noopener"
            >
              Abrir no YouTube <Icon name="popout" />
            </a>
          )}
        </section>

        <section className="room-music__library" aria-label="Fila da sala">
          <form className="room-music__add" onSubmit={add}>
            <label htmlFor="room-music-url">Adicionar à fila</label>
            <div>
              <input
                id="room-music-url"
                aria-label="Link do YouTube ou YouTube Music"
                placeholder="Cole uma música ou playlist"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value)
                  setInputError('')
                  setSourceMode('auto')
                }}
                autoComplete="off"
                spellCheck={false}
                type="text"
              />
              <button
                aria-label="Adicionar à fila"
                title="Adicionar à fila"
                type="submit"
                disabled={!input.trim() || !ready}
              >
                <Icon name="plus" />
              </button>
            </div>
            {bothSources && (
              <div className="room-music__source-options">
                <button
                  type="button"
                  aria-pressed={source?.kind === 'video'}
                  onClick={() => setSourceMode('video')}
                >
                  Só esta faixa
                </button>
                <button
                  type="button"
                  aria-pressed={source?.kind === 'playlist'}
                  onClick={() => setSourceMode('playlist')}
                >
                  Playlist inteira
                </button>
              </div>
            )}
            {inputError && <p role="alert">{inputError}</p>}
          </form>
          {music.error && (
            <div className="room-music__notice" role="alert">
              <span>{music.error}</span>
              <button
                aria-label="Fechar erro do player"
                onClick={music.clearError}
                type="button"
              >
                <Icon name="x" />
              </button>
            </div>
          )}
          <div className="room-music__queue-heading">
            <h3>
              Fila da sala <span>{state.queue.length}</span>
            </h3>
            {state.queue.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClear(!confirmClear)}
              >
                Limpar
              </button>
            )}
          </div>
          {confirmClear && (
            <div className="room-music__confirm">
              <span>Parar a música e esvaziar a fila para todos?</span>
              <button
                type="button"
                onClick={() => {
                  command({ type: 'clear' })
                  setConfirmClear(false)
                }}
              >
                Esvaziar fila
              </button>
              <button type="button" onClick={() => setConfirmClear(false)}>
                Cancelar
              </button>
            </div>
          )}
          {!state.queue.length ? (
            <div className="room-music__empty-queue">
              <Icon name="music" />
              <span>Sem músicas por enquanto</span>
              <small>Adicione o primeiro link acima.</small>
            </div>
          ) : (
            <ol className="room-music__queue">
              {state.queue.map((item, index) => (
                <li
                  key={item.id}
                  className={index === state.currentIndex ? 'is-current' : ''}
                >
                  <div className="room-music__queue-row">
                    <button
                      className="room-music__queue-select"
                      type="button"
                      aria-label={`Tocar ${item.label}`}
                      onClick={() =>
                        command({
                          type: 'play-item',
                          itemId: item.id,
                          trackIndex: 0,
                        })
                      }
                      disabled={!ready}
                    >
                      <span className="room-music__queue-index">
                        {index === state.currentIndex && state.playing ? (
                          <span className="room-music__equalizer">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          String(index + 1).padStart(2, '0')
                        )}
                      </span>
                      <span>
                        <strong>
                          {index === state.currentIndex &&
                          state.metadata.title &&
                          item.kind === 'video'
                            ? state.metadata.title
                            : item.label}
                        </strong>
                        <small>
                          {item.kind === 'playlist'
                            ? item.videoIds.length
                              ? `${item.videoIds.length} ${item.videoIds.length === 1 ? 'faixa' : 'faixas'}`
                              : item.resolutionError
                                ? 'Playlist indisponível'
                                : 'Playlist · a carregar'
                            : item.provider === 'youtube-music'
                              ? 'YouTube Music'
                              : 'YouTube'}{' '}
                          · {item.addedBy}
                        </small>
                      </span>
                    </button>
                    <button
                      aria-label={`Remover ${item.label}`}
                      className="room-music__remove"
                      title="Remover da fila"
                      onClick={() =>
                        command({ type: 'remove', itemId: item.id })
                      }
                      type="button"
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                  {item.kind === 'playlist' && item.videoIds.length > 0 && (
                    <>
                      <button
                        className="room-music__playlist-toggle"
                        aria-expanded={expandedPlaylist === item.id}
                        type="button"
                        onClick={() =>
                          setExpandedPlaylist(
                            expandedPlaylist === item.id ? '' : item.id,
                          )
                        }
                      >
                        {expandedPlaylist === item.id
                          ? 'Fechar faixas'
                          : 'Ver faixas'}
                        <Icon name="chevron" />
                      </button>
                      {expandedPlaylist === item.id && (
                        <ol className="room-music__playlist">
                          {item.videoIds.map((id, track) => (
                            <li key={`${track}-${id}`}>
                              <button
                                aria-current={
                                  index === state.currentIndex &&
                                  track === state.playlistIndex
                                    ? 'true'
                                    : undefined
                                }
                                type="button"
                                onClick={() =>
                                  command({
                                    type: 'play-item',
                                    itemId: item.id,
                                    trackIndex: track,
                                  })
                                }
                              >
                                <span>{item.playlistOffset + track + 1}</span>
                                <span>
                                  {(index === state.currentIndex &&
                                    track === state.playlistIndex &&
                                    state.metadata.title) ||
                                    `Faixa ${item.playlistOffset + track + 1}`}
                                  <small>{id}</small>
                                </span>
                                <Icon name="play" />
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                      {item.totalTracks > item.videoIds.length && (
                        <p className="room-music__limit">
                          Esta fila inclui as faixas {item.playlistOffset + 1}–
                          {item.playlistOffset + item.videoIds.length} de{' '}
                          {item.totalTracks}. Limite de {MAX_ROOM_MUSIC_TRACKS}{' '}
                          faixas por sala.
                        </p>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="room-music__footnote">
            Até {MAX_ROOM_MUSIC_QUEUE} links · Controles de reprodução alteram a
            sala. Volume e escuta são individuais.
          </p>
        </section>
      </div>
    </aside>,
    document.body,
  )
}
