import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  generateRoomCode,
  getRoomCodeFromUrl,
  normalizeDisplayName,
  roomCodeFromInput,
} from '../../services/livekit'
import { primeCallSounds } from '../../services/callSounds'
import { prepareProfileAvatar } from '../../services/profile'
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
  const [profileError, setProfileError] = useState('')
  const [preparingAvatar, setPreparingAvatar] = useState(false)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const connecting = status === 'connecting' || status === 'reconnecting'

  useEffect(() => {
    if (initialRoomCode) setRoomCode(initialRoomCode)
  }, [initialRoomCode])

  const joinRoom = async (nextRoomCode: string) => {
    const normalizedName = normalizeDisplayName(displayName)
    const normalizedRoom = roomCodeFromInput(nextRoomCode)

    if (!normalizedName) {
      setRoomCode(normalizedRoom)
      setValidationError('Diga como seus amigos devem chamar você.')
      nameInputRef.current?.focus()
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

  const selectAvatar = async (file: File) => {
    setPreparingAvatar(true)
    setProfileError('')
    try {
      const nextAvatar = await prepareProfileAvatar(file)
      setAvatarDataUrl(nextAvatar)
      saveLocalProfile({
        displayName,
        avatarDataUrl: nextAvatar,
        bio: account.bio,
        appearance: account.appearance,
      })
      await onProfileChange({
        displayName: normalizeDisplayName(displayName) || account.displayName,
        avatarDataUrl: nextAvatar,
        bio: account.bio,
        appearance: account.appearance,
      })
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Não foi possível usar essa imagem.')
    } finally {
      setPreparingAvatar(false)
    }
  }

  const removeAvatar = () => {
    setAvatarDataUrl(undefined)
    setProfileError('')
    saveLocalProfile({
      displayName,
      bio: account.bio,
      appearance: account.appearance,
    })
    void onProfileChange({
      displayName: normalizeDisplayName(displayName) || account.displayName,
      bio: account.bio,
      appearance: account.appearance,
    })
  }

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
          <div className="lobby-account__identity">
            <ProfileAvatar appearance={account.appearance} avatarDataUrl={avatarDataUrl} name={displayName || account.email} />
            <div>
              <ProfileName appearance={account.appearance} name={displayName || account.displayName} />
              <small>{account.role === 'owner' ? 'Owner' : account.role === 'admin' ? 'Admin' : account.email}</small>
            </div>
          </div>
          <button aria-label="Sair da conta" className="lobby-account__logout" onClick={() => void onSignOut()} title="Sair da conta" type="button">
            <Icon name="leave" />
          </button>
        </div>
      </header>

      <section className="lobby-v2" aria-labelledby="lobby-title">
        <header className="lobby-v2__heading">
          <p className="eyebrow">ENTRAR NA CALL</p>
          <h2>Você e sua sala.<br /><em>Só isso.</em></h2>
        </header>

        <form className="lobby-v2__card" onSubmit={submit} noValidate>
          <section className="lobby-v2__step lobby-v2__profile" aria-labelledby="profile-step-title">
            <header className="lobby-v2__step-heading">
              <span>1</span>
              <div>
                <h3 id="profile-step-title">Seu perfil</h3>
                <p>É assim que você aparece na call.</p>
              </div>
            </header>

            <input
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-label="Escolher foto de perfil"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void selectAvatar(file)
                event.target.value = ''
              }}
              ref={avatarInputRef}
              type="file"
            />

            <div className="lobby-v2__identity">
              <button
                aria-label={avatarDataUrl ? 'Trocar foto de perfil' : 'Adicionar foto de perfil'}
                className="lobby-v2__avatar"
                disabled={connecting || preparingAvatar}
                onClick={() => avatarInputRef.current?.click()}
                type="button"
              >
                <ProfileAvatar appearance={account.appearance} avatarDataUrl={avatarDataUrl} name={displayName || 'Você'} />
                <span><Icon name="image" /></span>
              </button>

              <div className="lobby-v2__profile-fields">
                <label className="lobby-v2__name-field">
                  <span>Nome exibido</span>
                  <input
                    autoComplete="nickname"
                    autoFocus={!displayName}
                    maxLength={48}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Como podemos te chamar?"
                    ref={nameInputRef}
                    value={displayName}
                  />
                </label>
                <div className="lobby-v2__photo-actions">
                  <button disabled={connecting || preparingAvatar} onClick={() => avatarInputRef.current?.click()} type="button">
                    {preparingAvatar ? 'Preparando…' : avatarDataUrl ? 'Trocar foto' : 'Adicionar foto'}
                  </button>
                  {avatarDataUrl && <button onClick={removeAvatar} type="button">Remover</button>}
                  <button className="lobby-v2__customize" onClick={() => setProfileEditorOpen(true)} type="button">Personalizar perfil</button>
                </div>
              </div>
            </div>

            {profileError && (
              <div className="inline-error" role="alert"><Icon name="warning" /><span>{profileError}</span></div>
            )}
          </section>

          <div className="lobby-v2__divider" aria-hidden="true"><Icon name="chevron" /></div>

          <section className="lobby-v2__step lobby-v2__room" aria-labelledby="room-step-title">
            <header className="lobby-v2__step-heading">
              <span>2</span>
              <div>
                <h3 id="room-step-title">Sala</h3>
                <p>Cole um convite ou digite o código.</p>
              </div>
            </header>

            <label className="lobby-v2__room-field">
              <span><Icon name="users" /></span>
              <input
                aria-label="Código ou link da sala"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus={Boolean(displayName)}
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

        <p className="lobby-v2__local-note"><span className="status-dot" /> Perfil sincronizado · acesso individual</p>
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
