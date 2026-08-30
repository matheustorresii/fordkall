import { useEffect, useRef } from 'react'
import { useParticipantVolume } from '../../hooks/useParticipantVolume'
import type { ContextMenuPoint, ParticipantMedia, RemoteVoice } from '../../types'
import { VolumeControl } from '../AudioControls/VolumeControl'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from '../Profile/ProfileName'

export const ParticipantContextMenu = ({
  participant,
  voice,
  point,
  onClose,
}: {
  participant: ParticipantMedia
  voice?: RemoteVoice
  point: ContextMenuPoint
  onClose: () => void
}) => {
  const [volume, setVolume] = useParticipantVolume(participant.id, 'voice')
  const previousVolume = useRef(volume > 0 ? volume : 0.8)
  const menuWidth = 300
  const menuHeight = participant.isLocal ? 132 : 208
  const left = Math.max(8, Math.min(point.x, window.innerWidth - menuWidth - 8))
  const top = Math.max(8, Math.min(point.y, window.innerHeight - menuHeight - 8))

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const closeOnResize = () => onClose()
    window.addEventListener('keydown', close)
    window.addEventListener('resize', closeOnResize)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [onClose])

  const toggleMute = () => {
    if (volume > 0) {
      previousVolume.current = volume
      setVolume(0)
    } else {
      setVolume(previousVolume.current || 0.8)
    }
  }

  return (
    <>
      <button aria-label="Fechar menu do participante" className="context-menu-backdrop" onClick={onClose} type="button" />
      <section
        aria-label={`Controles de ${participant.name}`}
        className="context-menu participant-context-menu"
        onContextMenu={(event) => event.preventDefault()}
        role="dialog"
        style={{ left, top }}
      >
        <header>
          <ProfileAvatar
            appearance={participant.appearance}
            avatarDataUrl={participant.avatarDataUrl}
            className="context-menu__avatar"
            name={participant.name}
          />
          <span><ProfileName appearance={participant.appearance} name={participant.name} /><small>{participant.bio || (participant.isLocal ? 'Você' : voice?.track ? 'Na call' : 'Sem microfone ativo')}</small></span>
          <Icon name={participant.microphoneMuted ? 'micOff' : 'mic'} />
        </header>
        {participant.isLocal ? (
          <p>Seus controles de voz e câmera ficam no dock.</p>
        ) : (
          <div className="context-menu__section">
            <div><span>Áudio só para você</span><small>Até 400% de ganho local</small></div>
            <VolumeControl
              label={`Volume do microfone de ${participant.name}`}
              muted={volume === 0}
              onChange={(nextVolume) => {
                if (nextVolume > 0) previousVolume.current = nextVolume
                setVolume(nextVolume)
              }}
              onMuteToggle={toggleMute}
              value={volume}
            />
          </div>
        )}
      </section>
    </>
  )
}
