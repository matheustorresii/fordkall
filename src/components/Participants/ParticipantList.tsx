import { Track, type Participant, type Room } from 'livekit-client'
import type { ContextMenuPoint, RemoteVoice } from '../../types'
import { participantProfileFromMetadata } from '../../services/profile'
import type { ProfileAppearance } from '../../types'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from '../Profile/ProfileName'

interface ParticipantListProps {
  room: Room
  participants: Participant[]
  remoteVoices: RemoteVoice[]
  activeSpeakerIds: Set<string>
  open: boolean
  onClose: () => void
  onParticipantMenu: (participantId: string, point: ContextMenuPoint) => void
}

const menuPoint = (element: HTMLElement): ContextMenuPoint => {
  const rect = element.getBoundingClientRect()
  return { x: rect.left - 306, y: rect.top }
}

const ParticipantRow = ({
  id,
  name,
  avatarDataUrl,
  detail,
  muted,
  speaking,
  appearance,
  onParticipantMenu,
}: {
  id: string
  name: string
  avatarDataUrl?: string
  detail: string
  muted: boolean
  speaking: boolean
  appearance: ProfileAppearance
  onParticipantMenu: (participantId: string, point: ContextMenuPoint) => void
}) => (
  <li className={`participant ${speaking ? 'participant--speaking' : ''}`}>
    <button
      className="participant__summary"
      onClick={(event) => onParticipantMenu(id, menuPoint(event.currentTarget))}
      onContextMenu={(event) => {
        event.preventDefault()
        onParticipantMenu(id, { x: event.clientX, y: event.clientY })
      }}
      title="Abrir controles · clique ou botão direito"
      type="button"
    >
      <ProfileAvatar appearance={appearance} avatarDataUrl={avatarDataUrl} className="participant__avatar" name={name} />
      <span className="participant__identity"><ProfileName appearance={appearance} name={name} /><small>{speaking ? 'Falando agora' : detail}</small></span>
      <span className={`participant__mic ${muted ? 'participant__mic--muted' : ''}`}><Icon name={muted ? 'micOff' : 'mic'} /></span>
    </button>
  </li>
)

export const ParticipantList = ({
  room,
  participants,
  remoteVoices,
  activeSpeakerIds,
  open,
  onClose,
  onParticipantMenu,
}: ParticipantListProps) => {
  const local = room.localParticipant
  const localName = local.name || local.identity
  const localPublication = local.getTrackPublication(Track.Source.Microphone)
  const localMuted = !local.isMicrophoneEnabled || localPublication?.isMuted === true
  const localProfile = participantProfileFromMetadata(local.metadata)

  return (
    <aside aria-hidden={!open} aria-label="Participantes da call" className={`participants-panel ${open ? 'is-open' : ''}`}>
      <div className="panel-heading">
        <span><Icon name="users" /> Pessoas na call</span>
        <div><b>{participants.length}</b><button aria-label="Fechar participantes" className="icon-button" onClick={onClose} type="button"><Icon name="x" /></button></div>
      </div>

      <p className="participants-panel__hint">Toque ou use o botão direito para abrir o mixer.</p>

      <ul className="participants-list">
        <ParticipantRow
          detail="Você"
          appearance={localProfile.appearance}
          avatarDataUrl={localProfile.avatarDataUrl}
          id={local.identity}
          muted={localMuted}
          name={localName}
          onParticipantMenu={onParticipantMenu}
          speaking={activeSpeakerIds.has(local.identity)}
        />
        {remoteVoices.map((voice) => {
          const name = voice.participant.name || voice.participant.identity
          const publicProfile = participantProfileFromMetadata(voice.participant.metadata)
          return (
            <ParticipantRow
              appearance={publicProfile.appearance}
              detail={voice.track ? 'Na call' : 'Sem microfone'}
              avatarDataUrl={publicProfile.avatarDataUrl}
              id={voice.participant.identity}
              key={voice.id}
              muted={voice.muted}
              name={name}
              onParticipantMenu={onParticipantMenu}
              speaking={activeSpeakerIds.has(voice.participant.identity)}
            />
          )
        })}
      </ul>

      {participants.length === 1 && (
        <div className="participants-empty"><span className="signal-bars" aria-hidden="true"><i /><i /><i /></span><p>Só você por enquanto.</p><small>Copie o link da sala para chamar alguém.</small></div>
      )}
    </aside>
  )
}
