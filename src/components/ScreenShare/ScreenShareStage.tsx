import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { useParticipantVolume } from '../../hooks/useParticipantVolume'
import type {
  ContextMenuPoint,
  GalleryLayoutMode,
  ParticipantMedia,
  ScreenShareLive,
} from '../../types'
import { RemoteAudioRenderer } from '../AudioControls/RemoteAudioRenderer'
import { VolumeControl } from '../AudioControls/VolumeControl'
import { ParticipantGallery } from '../Participants/ParticipantGallery'
import { Icon } from '../ui/Icon'
import { setMediaSubscription } from '../../services/videoSuspension'

const VideoRenderer = ({
  track,
  videoRef,
}: {
  track: LocalVideoTrack | RemoteVideoTrack
  videoRef: RefObject<HTMLVideoElement | null>
}) => {
  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    track.attach(element)
    return () => {
      track.detach(element)
      element.pause()
      element.srcObject = null
      element.removeAttribute('src')
      element.load()
    }
  }, [track, videoRef])

  return <video autoPlay muted playsInline ref={videoRef} />
}

const GalleryStreamVideo = ({
  track,
}: {
  track: LocalVideoTrack | RemoteVideoTrack
}) => {
  const ref = useRef<HTMLVideoElement>(null)
  return <VideoRenderer track={track} videoRef={ref} />
}

interface LiveControlsProps {
  live: ScreenShareLive
  deafened: boolean
  screenOutputId: string
  open: boolean
  point: ContextMenuPoint | null
  onClose: () => void
  onPictureInPicture: () => void
  onPopout: () => void
  onFullscreen: () => void
  onWatchingChange: (watching: boolean) => void
  pipActive: boolean
  popoutActive: boolean
  fullscreenActive: boolean
  pipSupported: boolean
  portalTarget: Element | null
  watching: boolean
}

const LiveAudioControls = ({
  live,
  deafened,
  screenOutputId,
  open,
  point,
  onClose,
  onPictureInPicture,
  onPopout,
  onFullscreen,
  onWatchingChange,
  pipActive,
  popoutActive,
  fullscreenActive,
  pipSupported,
  portalTarget,
  watching,
}: LiveControlsProps) => {
  const [volume, setVolume] = useParticipantVolume(
    live.participantIdentity,
    'screen',
  )
  const [mutedLocally, setMutedLocally] = useState(false)

  return (
    <>
      {!live.isLocal && watching && (
        <RemoteAudioRenderer
          deafened={deafened}
          muted={mutedLocally || live.muted}
          outputDeviceId={screenOutputId}
          track={live.audioTrack}
          volume={volume}
        />
      )}

      {open &&
        portalTarget &&
        createPortal(
          <>
            <button
              aria-label="Fechar controles da transmissão"
              className="context-menu-backdrop"
              onClick={onClose}
              type="button"
            />
            <div
              aria-label="Controles da transmissão"
              className="context-menu live-controls-popover"
              onContextMenu={(event) => event.preventDefault()}
              role="dialog"
              style={
                point
                  ? { left: point.x, right: 'auto', top: point.y }
                  : undefined
              }
            >
              <header>
                <div>
                  <small>TRANSMISSÃO</small>
                  <strong>{live.participantName}</strong>
                </div>
                <button
                  aria-label="Fechar controles da transmissão"
                  className="icon-button"
                  onClick={onClose}
                  type="button"
                >
                  <Icon name="x" />
                </button>
              </header>

              {live.isLocal ? (
                <p>
                  {live.hasAudio
                    ? 'Áudio da tela no ar com proteção anti-retorno.'
                    : 'Esta transmissão está sem áudio compartilhado.'}
                </p>
              ) : !watching ? (
                <p>
                  Vídeo e áudio desconectados para você. Esta transmissão não
                  está consumindo sua banda.
                </p>
              ) : live.audioTrack ? (
                <div className="live-controls-popover__section">
                  <div>
                    <span>Áudio só para você</span>
                    <small>Volume independente da voz</small>
                  </div>
                  <VolumeControl
                    label={`Volume da transmissão de ${live.participantName}`}
                    muted={mutedLocally || live.muted}
                    onChange={setVolume}
                    onMuteToggle={() => setMutedLocally((current) => !current)}
                    value={volume}
                  />
                </div>
              ) : live.hasAudio ? (
                <p>Reconectando à faixa de áudio compartilhada…</p>
              ) : (
                <p>
                  Essa transmissão chegou sem uma faixa de áudio compartilhada.
                </p>
              )}

              <div className="live-controls-popover__actions">
                {!live.isLocal && (
                  <button
                    className="live-controls-popover__subscription"
                    onClick={() => {
                      onClose()
                      onWatchingChange(!watching)
                    }}
                    type="button"
                  >
                    <Icon name={watching ? 'eyeOff' : 'eye'} />
                    <span>
                      {watching ? 'Parar de assistir' : 'Assistir transmissão'}
                    </span>
                  </button>
                )}
                {watching && live.videoTrack && (
                  <>
                    <button
                      disabled={!pipSupported}
                      onClick={() => {
                        onClose()
                        onPictureInPicture()
                      }}
                      type="button"
                    >
                      <Icon name="pip" />
                      <span>
                        {pipActive ? 'Fechar PiP' : 'Picture-in-Picture'}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        onClose()
                        onPopout()
                      }}
                      type="button"
                    >
                      <Icon name="popout" />
                      <span>
                        {popoutActive ? 'Fechar janela' : 'Janela separada'}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        onClose()
                        onFullscreen()
                      }}
                      type="button"
                    >
                      <Icon name={fullscreenActive ? 'collapse' : 'expand'} />
                      <span>
                        {fullscreenActive ? 'Sair da tela cheia' : 'Tela cheia'}
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </>,
          portalTarget,
        )}
    </>
  )
}

interface ScreenShareStageProps {
  lives: ScreenShareLive[]
  participants: ParticipantMedia[]
  activeSpeakerIds: Set<string>
  deafened: boolean
  screenOutputId: string
  galleryLayout: GalleryLayoutMode
  onParticipantMenu: (participantId: string, point: ContextMenuPoint) => void
}

export const ScreenShareStage = ({
  lives,
  participants,
  activeSpeakerIds,
  deafened,
  screenOutputId,
  galleryLayout,
  onParticipantMenu,
}: ScreenShareStageProps) => {
  const [selectedId, setSelectedId] = useState('')
  const [focus, setFocus] = useState('')
  const [controlsOpen, setControlsOpen] = useState(false)
  const [controlsPoint, setControlsPoint] = useState<ContextMenuPoint | null>(
    null,
  )
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const popoutWindowRef = useRef<Window | null>(null)
  const popoutVideoRef = useRef<HTMLVideoElement | null>(null)
  const popoutTrackRef = useRef<LocalVideoTrack | RemoteVideoTrack | null>(null)
  const [pipActive, setPipActive] = useState(false)
  const [popoutActive, setPopoutActive] = useState(false)
  const [fullscreenActive, setFullscreenActive] = useState(false)
  const [stageError, setStageError] = useState('')

  const openControlsAt = (x: number, y: number) => {
    const menuWidth = 328
    const menuHeight = 284
    const dockClearance = window.innerWidth > 720 ? 96 : 76
    setControlsPoint({
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(
        8,
        Math.min(y, window.innerHeight - menuHeight - dockClearance),
      ),
    })
    setControlsOpen(true)
  }

  const pipSupported =
    typeof document !== 'undefined' &&
    document.pictureInPictureEnabled &&
    'requestPictureInPicture' in HTMLVideoElement.prototype

  useEffect(() => {
    const currentIds = new Set(lives.map((live) => live.id))
    if (selectedId && !currentIds.has(selectedId)) {
      setSelectedId('')
      setFocus('')
    }
  }, [lives, selectedId])

  const selectedLive = lives.find((live) => live.id === selectedId)
  const watchingSelectedLive = Boolean(
    selectedLive && (selectedLive.isLocal || selectedLive.subscribed),
  )

  const closePopout = useCallback((shouldCloseWindow = true) => {
    const popup = popoutWindowRef.current
    const video = popoutVideoRef.current
    const track = popoutTrackRef.current

    popoutWindowRef.current = null
    popoutVideoRef.current = null
    popoutTrackRef.current = null

    if (track && video) track.detach(video)
    if (video) {
      video.pause()
      video.srcObject = null
      video.removeAttribute('src')
      video.remove()
    }

    setPopoutActive(false)
    if (shouldCloseWindow && popup && !popup.closed) popup.close()
  }, [])

  const changeWatching = useCallback(
    (watching: boolean) => {
      if (!selectedLive || selectedLive.isLocal) return

      if (!watching) {
        if (document.pictureInPictureElement) {
          void document.exitPictureInPicture().catch(() => undefined)
        }
        closePopout()
      }

      setMediaSubscription(selectedLive.videoPublication, watching)
      setMediaSubscription(selectedLive.audioPublication, watching)
      setStageError('')
    },
    [closePopout, selectedLive],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleEnter = () => setPipActive(true)
    const handleLeave = () => setPipActive(false)
    video.addEventListener('enterpictureinpicture', handleEnter)
    video.addEventListener('leavepictureinpicture', handleLeave)
    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnter)
      video.removeEventListener('leavepictureinpicture', handleLeave)
    }
  }, [selectedLive?.id, focus])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreenActive(document.fullscreenElement === stageRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    handleFullscreenChange()
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(
    () => () => {
      closePopout()
    },
    [closePopout, selectedLive?.id],
  )

  const togglePictureInPicture = async () => {
    const video = videoRef.current
    if (!video || !pipSupported) return
    try {
      if (document.pictureInPictureElement)
        await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch {
      setPipActive(false)
    }
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await stageRef.current?.requestFullscreen()
      setStageError('')
    } catch {
      setStageError('O navegador não conseguiu alterar o modo de tela cheia.')
    }
  }

  const togglePopout = () => {
    if (!selectedLive?.videoTrack) return
    if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
      closePopout()
      return
    }

    const popup = window.open(
      '',
      `ford-kall-stream-${selectedLive.id}`,
      'popup=yes,width=1120,height=720,resizable=yes,scrollbars=no',
    )
    if (!popup) {
      setStageError(
        'O navegador bloqueou a janela da transmissão. Libere pop-ups para este site e tente novamente.',
      )
      return
    }

    const style = popup.document.createElement('style')
    style.textContent = `
      :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #030403; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #030403; }
      body { display: grid; grid-template-rows: 42px minmax(0, 1fr); }
      .bar { display: flex; align-items: center; gap: 9px; padding: 0 14px; border-bottom: 1px solid #252b26; background: #0d100e; color: #dce2dc; font-size: 12px; }
      .bar i { width: 7px; height: 7px; border-radius: 50%; background: #ff5a5f; box-shadow: 0 0 8px rgba(255,90,95,.72); }
      video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
    `
    const bar = popup.document.createElement('div')
    bar.className = 'bar'
    const dot = popup.document.createElement('i')
    const title = popup.document.createElement('span')
    title.textContent = `${selectedLive.participantName} · transmissão`
    bar.append(dot, title)

    // Creating the video in the opener keeps it in the same JS realm expected
    // by the LiveKit track, then the popup adopts it when appended.
    const popupVideo = document.createElement('video')
    popupVideo.autoplay = true
    popupVideo.muted = true
    popupVideo.playsInline = true

    popup.document.title = `${selectedLive.participantName} · Ford Kall`
    popup.document.head.replaceChildren(style)
    popup.document.body.replaceChildren(bar, popupVideo)

    popoutWindowRef.current = popup
    popoutVideoRef.current = popupVideo
    popoutTrackRef.current = selectedLive.videoTrack

    try {
      selectedLive.videoTrack.attach(popupVideo)
      popup.addEventListener('pagehide', () => closePopout(false), {
        once: true,
      })
      popup.focus()
      setPopoutActive(true)
      setStageError('')
    } catch {
      closePopout()
      setStageError(
        'Não foi possível mover a transmissão para uma janela separada.',
      )
    }
  }

  const audioLayers = (
    <>
      {lives.map((live) => (
        <LiveAudioControls
          key={live.id}
          deafened={deafened}
          live={live}
          onClose={() => setControlsOpen(false)}
          onFullscreen={() => void toggleFullscreen()}
          onPictureInPicture={() => void togglePictureInPicture()}
          onPopout={togglePopout}
          onWatchingChange={changeWatching}
          open={controlsOpen && live.id === selectedId}
          point={controlsPoint}
          fullscreenActive={fullscreenActive}
          pipActive={pipActive}
          pipSupported={pipSupported}
          popoutActive={popoutActive}
          portalTarget={
            fullscreenActive && stageRef.current
              ? stageRef.current
              : document.body
          }
          screenOutputId={screenOutputId}
          watching={live.isLocal || live.subscribed}
        />
      ))}
    </>
  )
  if (!selectedLive || !focus.startsWith('screen:')) {
    return (
      <>
        {audioLayers}
        <div className="media-gallery">
          {focus && (
            <button
              className="media-gallery__back"
              type="button"
              onClick={() => setFocus('')}
            >
              <Icon name="layout" />
              Voltar à grade
            </button>
          )}
          <ParticipantGallery
            activeSpeakerIds={activeSpeakerIds}
            layoutMode={galleryLayout}
            onParticipantMenu={onParticipantMenu}
            participants={participants}
            focusedId={focus.startsWith('person:') ? focus.slice(7) : ''}
            onFocus={(id) => setFocus(id ? `person:${id}` : '')}
          >
            {lives.map((live) => (
              <div
                key={live.id}
                className="gallery-person gallery-live"
                role="button"
                tabIndex={0}
                aria-label={`Focar transmissão de ${live.participantName}`}
                onClick={() => {
                  setSelectedId(live.id)
                  setFocus(`screen:${live.id}`)
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter') {
                    setSelectedId(live.id)
                    setFocus(`screen:${live.id}`)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setSelectedId(live.id)
                  openControlsAt(e.clientX, e.clientY)
                }}
              >
                {(live.isLocal || live.subscribed) && live.videoTrack ? (
                  <GalleryStreamVideo track={live.videoTrack} />
                ) : (
                  <div className="gallery-live__placeholder">
                    <Icon name="screen" />
                    <strong>{live.participantName}</strong>
                    <span>
                      {live.isLocal
                        ? 'Sua transmissão'
                        : 'Transmissão disponível'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMediaSubscription(live.videoPublication, true)
                        setMediaSubscription(live.audioPublication, true)
                      }}
                    >
                      Assistir
                    </button>
                  </div>
                )}
                <div className="gallery-person__meta">
                  <strong>{live.participantName}</strong>
                  <span className="live-badge">AO VIVO</span>
                </div>
              </div>
            ))}
          </ParticipantGallery>
        </div>
      </>
    )
  }

  return (
    <>
      {audioLayers}
      <section className="stream-stage" ref={stageRef}>
        <div className="stream-stage__topbar">
          <button
            className="media-gallery__back"
            onClick={() => setFocus('')}
            type="button"
          >
            <Icon name="layout" />
            Voltar à grade
          </button>
          <div className="stream-stage__identity">
            <span className="live-badge">
              <i /> AO VIVO
            </span>
            <strong>{selectedLive.participantName}</strong>
          </div>
          <div className="stream-stage__actions">
            {watchingSelectedLive && !selectedLive.hasAudio && (
              <span className="live-audio-state" title="Transmissão sem áudio">
                <Icon name="volumeOff" />
              </span>
            )}
            {!selectedLive.isLocal && (
              <button
                aria-label={
                  watchingSelectedLive
                    ? 'Parar de assistir transmissão'
                    : 'Assistir transmissão'
                }
                className={`icon-button ${!watchingSelectedLive ? 'icon-button--paused' : ''}`}
                onClick={() => changeWatching(!watchingSelectedLive)}
                title={
                  watchingSelectedLive
                    ? 'Desconectar vídeo e áudio desta live'
                    : 'Reconectar à transmissão'
                }
                type="button"
              >
                <Icon name={watchingSelectedLive ? 'eyeOff' : 'eye'} />
              </button>
            )}
            <button
              aria-label="Abrir controles da transmissão"
              className={`icon-button ${controlsOpen ? 'icon-button--active' : ''}`}
              onClick={() => {
                setControlsPoint(null)
                setControlsOpen((current) => !current)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                openControlsAt(event.clientX, event.clientY)
              }}
              title="Controles da transmissão"
              type="button"
            >
              <Icon name="controls" />
            </button>
          </div>
        </div>

        {stageError && (
          <div className="stream-stage__message" role="alert">
            <Icon name="warning" />
            <span>{stageError}</span>
            <button
              aria-label="Fechar aviso"
              onClick={() => setStageError('')}
              type="button"
            >
              <Icon name="x" />
            </button>
          </div>
        )}

        {lives.length > 1 && (
          <div className="live-switcher" aria-label="Escolher transmissão">
            {lives.map((live) => (
              <button
                className={`${live.id === selectedLive.id ? 'is-active' : ''} ${!live.isLocal && !live.subscribed ? 'is-paused' : ''}`}
                key={live.id}
                onClick={() => {
                  setSelectedId(live.id)
                  setFocus(`screen:${live.id}`)
                }}
                type="button"
              >
                <i /> {live.participantName}
                {!live.isLocal && !live.subscribed ? ' · pausada' : ''}
              </button>
            ))}
          </div>
        )}

        <div className="stream-stage__content">
          <div
            className="stream-stage__video"
            onContextMenu={(event) => {
              event.preventDefault()
              openControlsAt(event.clientX, event.clientY)
            }}
            title="Botão direito para controles da transmissão"
          >
            {watchingSelectedLive && selectedLive.videoTrack ? (
              <VideoRenderer
                track={selectedLive.videoTrack}
                videoRef={videoRef}
              />
            ) : watchingSelectedLive ? (
              <div className="stream-stage__subscription-state" role="status">
                <span className="spinner" />
                <strong>Conectando à transmissão</strong>
                <small>Pedindo os tracks de vídeo e áudio ao LiveKit…</small>
              </div>
            ) : (
              <div className="stream-stage__subscription-state stream-stage__subscription-state--paused">
                <span>
                  <Icon name="eyeOff" />
                </span>
                <strong>Transmissão desconectada</strong>
                <small>
                  Você continua na call, mas não recebe vídeo nem áudio desta
                  live.
                </small>
                <button onClick={() => changeWatching(true)} type="button">
                  <Icon name="eye" /> Assistir transmissão
                </button>
              </div>
            )}
          </div>

          <ParticipantGallery
            activeSpeakerIds={activeSpeakerIds}
            compact
            onParticipantMenu={onParticipantMenu}
            participants={participants}
            onFocus={(id) => setFocus(id ? `person:${id}` : '')}
          />
        </div>
      </section>
    </>
  )
}
