import { useEffect, useState, type FormEvent } from 'react'
import {
  generateRoomCode,
  getRoomCodeFromUrl,
  normalizeDisplayName,
  roomCodeFromInput,
} from '../../services/livekit'
import { primeCallSounds } from '../../services/callSounds'
import { getLocalProfile, saveLocalProfile } from '../../storage/preferences'
import type { AccountProfile, ConnectionStatus, LocalProfile } from '../../types'
import { BrandMark } from '../ui/BrandMark'
import { DesktopUpdateControl } from '../ui/DesktopUpdateControl'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileEditorModal } from '../Profile/ProfileEditorModal'
import { ProfileName } from '../Profile/ProfileName'

interface LobbyProps {
  account: AccountProfile
  status: ConnectionStatus
  connectionError: string
  initialRoomCode: string
  onJoin: (profile: LocalProfile, roomCode: string) => Promise<boolean>
  onOpenAdmin: () => void
  onProfileChange: (profile: LocalProfile) => Promise<AccountProfile>
  onSignOut: () => Promise<void>
}

export const Lobby = ({
  account,
  status,
  connectionError,
  initialRoomCode,
  onJoin,
  onOpenAdmin,
  onProfileChange,
  onSignOut,
}: LobbyProps) => {
  const [initialProfile] = useState(() => account.displayName ? account : getLocalProfile())
  const [displayName, setDisplayName] = useState(initialProfile.displayName)
  const [avatarDataUrl, setAvatarDataUrl] = useState(initialProfile.avatarDataUrl)
  const [roomCode, setRoomCode] = useState(() => initialRoomCode || getRoomCodeFromUrl())
  const [validationError, setValidationError] = useState('')
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const connecting = status === 'connecting' || status === 'reconnecting'

  useEffect(() => {
    if (initialRoomCode) setRoomCode(initialRoomCode)
  }, [initialRoomCode])

  const joinRoom = async (nextRoomCode: string) => {
    const normalizedName = normalizeDisplayName(displayName)
    const normalizedRoom = roomCodeFromInput(nextRoomCode)

    if (!normalizedName) {
      setRoomCode(normalizedRoom)
      setValidationError('Seu perfil precisa de um nome antes de entrar.')
      setProfileEditorOpen(true)
      return
    }

    setValidationError('')
    setDisplayName(normalizedName)
    setRoomCode(normalizedRoom)
    const profile = {
      displayName: normalizedName,
      avatarDataUrl,
      bio: account.bio,
      appearance: account.appearance,
    }
    saveLocalProfile(profile)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
    primeCallSounds()
    await onJoin(profile, normalizedRoom)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedRoom = roomCodeFromInput(roomCode)

    if (!normalizedRoom) {
      setValidationError('Digite o código da sala.')
      return
    }

    await joinRoom(normalizedRoom)
  }

  const createRoom = async () => joinRoom(generateRoomCode())
  const roomFromInvite = getRoomCodeFromUrl()
  const normalizedRoomInput = roomCodeFromInput(roomCode)

  return (
    <main className="lobby-shell lobby-shell--welcome lobby-shell--v2">
      <div className="lobby-grid" aria-hidden="true" />
      <header className="lobby-topbar">
        <div className="brand brand--welcome">
          <BrandMark />
          <div>
            <p className="brand__eyebrow">PRIVATE COMMS</p>
            <h1 id="lobby-title">FORD KALL</h1>
          </div>
        </div>
        <div className="lobby-account">
          <DesktopUpdateControl variant="lobby" />
          {(account.role === 'owner' || account.role === 'admin') && (
            <button className="lobby-account__admin" onClick={onOpenAdmin} type="button">
              <Icon name="controls" /> Painel
            </button>
          )}
          <button
            aria-label="Editar perfil"
            className="lobby-account__identity"
            onClick={() => setProfileEditorOpen(true)}
            title="Editar perfil"
            type="button"
          >
            <ProfileAvatar appearance={account.appearance} avatarDataUrl={avatarDataUrl} name={displayName || account.email} />
            <div>
              <ProfileName appearance={account.appearance} name={displayName || account.displayName} />
              <small>Editar perfil</small>
            </div>
          </button>
          <button aria-label="Sair da conta" className="lobby-account__logout" onClick={() => void onSignOut()} title="Sair da conta" type="button">
            <Icon name="leave" />
          </button>
        </div>
      </header>

      <section className="lobby-v2" aria-labelledby="lobby-title">
        <header className="lobby-v2__heading">
          <h2>Entrar na call</h2>
          <p>Use um código ou crie uma sala nova.</p>
        </header>

        <form className="lobby-v2__card lobby-v2__card--direct" onSubmit={submit} noValidate>
          <section className="lobby-v2__step lobby-v2__room" aria-labelledby="room-step-title">
            <header className="lobby-v2__step-heading">
              <span><Icon name="users" /></span>
              <div>
                <h3 id="room-step-title">Código da sala</h3>
                <p>Cole um convite ou digite o código.</p>
              </div>
            </header>

            <label className="lobby-v2__room-field">
              <span><Icon name="users" /></span>
              <input
                aria-label="Código ou link da sala"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
                maxLength={240}
                onChange={(event) => setRoomCode(event.target.value)}
                placeholder="KIWI-7294"
                spellCheck={false}
                value={roomCode}
              />
            </label>

            {normalizedRoomInput && (
              <div className={`lobby-v2__room-ready ${roomFromInvite === normalizedRoomInput ? 'is-invite' : ''}`}>
                <span className="status-dot" />
                <span>{roomFromInvite === normalizedRoomInput ? 'Convite pronto' : 'Sala pronta'}</span>
                <strong>{normalizedRoomInput}</strong>
              </div>
            )}

            {(validationError || connectionError) && (
              <div className="inline-error" role="alert"><Icon name="warning" /><span>{validationError || connectionError}</span></div>
            )}

            <button className="lobby-v2__join" disabled={connecting} type="submit">
              {connecting ? <><span className="spinner" /> Entrando</> : <>Entrar na sala <Icon name="chevron" /></>}
            </button>

            <button className="lobby-v2__create" disabled={connecting} onClick={() => void createRoom()} type="button">
              <Icon name="users" /> Criar uma sala nova
            </button>
          </section>
        </form>
      </section>
      {profileEditorOpen && (
        <ProfileEditorModal
          onClose={() => setProfileEditorOpen(false)}
          onSave={async (nextProfile) => {
            await onProfileChange(nextProfile)
            setDisplayName(nextProfile.displayName)
            setAvatarDataUrl(nextProfile.avatarDataUrl)
          }}
          profile={account}
        />
      )}
    </main>
  )
}
