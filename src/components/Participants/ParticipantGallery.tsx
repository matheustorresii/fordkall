import { Children, useEffect, useRef, type ReactNode } from 'react'
import { cosmeticAsset } from '../../services/cosmetics'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type {
  ContextMenuPoint,
  GalleryLayoutMode,
  ParticipantMedia,
} from '../../types'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from '../Profile/ProfileName'

const CameraRenderer = ({
  isLocal,
  track,
}: {
  isLocal: boolean
  track: LocalVideoTrack | RemoteVideoTrack
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)

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
  }, [track])

  return (
    <video
      autoPlay
      className={isLocal ? 'is-local' : ''}
      muted
      playsInline
      ref={videoRef}
    />
  )
}

interface ParticipantGalleryProps {
  participants: ParticipantMedia[]
  activeSpeakerIds: Set<string>
  compact?: boolean
  layoutMode?: GalleryLayoutMode
  onParticipantMenu: (participantId: string, point: ContextMenuPoint) => void
  focusedId?: string
  onFocus?: (id: string) => void
  children?: ReactNode
}

export const ParticipantGallery = ({
  participants,
  activeSpeakerIds,
  compact = false,
  layoutMode = 'expanded',
  onParticipantMenu,
  focusedId = '',
  onFocus,
  children,
}: ParticipantGalleryProps) => (
  <section
    aria-label="Pessoas na call"
    className={`participant-gallery ${compact ? 'participant-gallery--compact' : `participant-gallery--${layoutMode}`} ${focusedId ? 'participant-gallery--focused' : ''}`}
    data-count={Math.min(participants.length + Children.count(children), 6)}
  >
    <div className="participant-gallery__grid">
      {participants.map((participant) => {
        const speaking = activeSpeakerIds.has(participant.id)
        return (
          <div
            role="button"
            tabIndex={0}
            aria-label={
              onFocus
                ? `Focar ${participant.name}`
                : `Abrir controles de ${participant.name}`
            }
            className={`gallery-person ${focusedId === participant.id ? 'is-focused' : ''} ${speaking ? 'gallery-person--speaking' : ''} ${participant.cameraTrack && participant.cameraEnabled ? 'gallery-person--camera' : ''}`}
            style={
              !(participant.cameraTrack && participant.cameraEnabled) &&
              cosmeticAsset('background', participant.appearance.backgroundId)
                ? {
                    backgroundImage: `linear-gradient(#11192333,#11192388),url("${cosmeticAsset('background', participant.appearance.backgroundId)}")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : undefined
            }
            key={participant.id}
            onClick={(event) => {
              if (onFocus) {
                onFocus(focusedId === participant.id ? '' : participant.id)
                return
              }
              const rect = event.currentTarget.getBoundingClientRect()
              onParticipantMenu(participant.id, {
                x: event.clientX || rect.right - 10,
                y: event.clientY || rect.top + 10,
              })
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (onFocus)
                  onFocus(focusedId === participant.id ? '' : participant.id)
                else {
                  const r = event.currentTarget.getBoundingClientRect()
                  onParticipantMenu(participant.id, {
                    x: r.right - 10,
                    y: r.top + 10,
                  })
                }
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onParticipantMenu(participant.id, {
                x: event.clientX,
                y: event.clientY,
              })
            }}
            title="Clique para focar · botão direito para controles"
          >
            {participant.cameraTrack && participant.cameraEnabled ? (
              <CameraRenderer
                isLocal={participant.isLocal}
                track={participant.cameraTrack}
              />
            ) : (
              <ProfileAvatar
                appearance={participant.appearance}
                avatarDataUrl={participant.avatarDataUrl}
                className="gallery-person__avatar"
                name={participant.name}
              />
            )}
            <div className="gallery-person__meta">
              <ProfileName
                appearance={participant.appearance}
                name={participant.name}
              />
              <span className={participant.microphoneMuted ? 'is-muted' : ''}>
                <Icon name={participant.microphoneMuted ? 'micOff' : 'mic'} />
              </span>
            </div>
            <button
              className="gallery-person__menu"
              aria-label={`Controles de ${participant.name}`}
              onClick={(e) => {
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                onParticipantMenu(participant.id, { x: r.right, y: r.bottom })
              }}
              type="button"
            >
              <Icon name="controls" />
            </button>
          </div>
        )
      })}
      {children}
    </div>
  </section>
)
