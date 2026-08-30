import { useEffect, useRef } from 'react'
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

  return <video autoPlay className={isLocal ? 'is-local' : ''} muted playsInline ref={videoRef} />
}

interface ParticipantGalleryProps {
  participants: ParticipantMedia[]
  activeSpeakerIds: Set<string>
  compact?: boolean
  layoutMode?: GalleryLayoutMode
  onParticipantMenu: (participantId: string, point: ContextMenuPoint) => void
}

export const ParticipantGallery = ({
  participants,
  activeSpeakerIds,
  compact = false,
  layoutMode = 'expanded',
  onParticipantMenu,
}: ParticipantGalleryProps) => (
  <section
    aria-label="Pessoas na call"
    className={`participant-gallery ${compact ? 'participant-gallery--compact' : `participant-gallery--${layoutMode}`}`}
    data-count={Math.min(participants.length, 6)}
  >
    <div className="participant-gallery__grid">
      {participants.map((participant) => {
        const speaking = activeSpeakerIds.has(participant.id)
        return (
          <button
            aria-label={`Abrir controles de ${participant.name}`}
            className={`gallery-person ${speaking ? 'gallery-person--speaking' : ''} ${participant.cameraTrack && participant.cameraEnabled ? 'gallery-person--camera' : ''}`}
            key={participant.id}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onParticipantMenu(participant.id, {
                x: event.clientX || rect.right - 10,
                y: event.clientY || rect.top + 10,
              })
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onParticipantMenu(participant.id, { x: event.clientX, y: event.clientY })
            }}
            title="Abrir controles · clique ou botão direito"
            type="button"
          >
            {participant.cameraTrack && participant.cameraEnabled ? (
              <CameraRenderer isLocal={participant.isLocal} track={participant.cameraTrack} />
            ) : (
              <ProfileAvatar
                appearance={participant.appearance}
                avatarDataUrl={participant.avatarDataUrl}
                className="gallery-person__avatar"
                name={participant.name}
              />
            )}
            <div className="gallery-person__meta">
              <ProfileName appearance={participant.appearance} name={participant.name} />
              <span className={participant.microphoneMuted ? 'is-muted' : ''}>
                <Icon name={participant.microphoneMuted ? 'micOff' : 'mic'} />
              </span>
            </div>
          </button>
        )
      })}
    </div>
  </section>
)
