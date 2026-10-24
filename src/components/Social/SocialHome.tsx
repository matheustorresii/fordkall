import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { normalizeProfileAppearance } from '../../services/profile'
import {
  describeSocialError,
  getRecentDirectConversations,
  getSocialProfileCards,
  subscribeToDirectInbox,
} from '../../services/social'
import { generateRoomCode, roomCodeFromInput } from '../../services/livekit'
import { primeCallSounds } from '../../services/callSounds'
import { saveLocalProfile } from '../../storage/preferences'
import { useCallDirectory } from '../../hooks/useCallDirectory'
import type {
  AccountProfile,
  ConnectionStatus,
  LocalProfile,
} from '../../types'
import type {
  SocialConversation,
  SocialPresenceEntry,
  SocialUser,
} from '../../types/social'
import type {
  PublicCallRoom,
  RecentCallRoom,
} from '../../services/roomDirectoryPolicy'
import { ProfileEditorModal } from '../Profile/ProfileEditorModal'
import { IconButton } from '../ui/Button'
import { DesktopUpdateControl } from '../ui/DesktopUpdateControl'
import { Icon } from '../ui/Icon'
import { BrandMark } from '../ui/BrandMark'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { SocialMessageView } from './SocialMessageView'
import { SocialPeopleView } from './SocialPeopleView'
import { SocialRoomsView } from './SocialRoomsView'
import { SocialInbox } from './SocialInbox'
import { GameModal } from '../Games/GameTable'
import { DesktopDownloads } from '../ui/DesktopDownloads'
import './SocialHome.css'

type Section = 'rooms' | 'messages' | 'people'
interface SocialHomeProps {
  account: AccountProfile
  activeRoomCode: string
  activeRoomPrivate?: boolean
  status: ConnectionStatus
  connectionError: string
  initialRoomCode: string
  onlineUsers: SocialPresenceEntry[]
  onJoin: (
    profile: LocalProfile,
    roomCode: string,
    privateRoom?: boolean,
  ) => Promise<boolean>
  onLeaveCall: () => Promise<void>
  onOpenAdmin: () => void
  onProfileChange: (profile: LocalProfile) => Promise<AccountProfile>
  onReturnToCall: () => void
  onSignOut: () => Promise<void>
  previewData?: {
    users: SocialUser[]
    conversations: SocialConversation[]
    rooms: PublicCallRoom[]
    recentRooms?: RecentCallRoom[]
    messages: import('../../types/social').SocialMessage[]
  }
}
const destinations = [
  { id: 'rooms', label: 'Salas', icon: 'headphones' },
  { id: 'messages', label: 'Conversas', icon: 'chat' },
  { id: 'people', label: 'Pessoas', icon: 'users' },
] as const

export const SocialHome = (props: SocialHomeProps) => {
  const { account, activeRoomCode, onlineUsers, previewData } = props
  const [section, setSection] = useState<Section>('rooms')
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(Boolean(props.initialRoomCode))
  const [privateRoom, setPrivateRoom] = useState(false)
  const [code, setCode] = useState(props.initialRoomCode)
  const [peer, setPeer] = useState<SocialUser | null>(null)
  const [threadOpen, setThreadOpen] = useState(false)
  const [conversations, setConversations] = useState<SocialConversation[]>([])
  const [onlineCards, setOnlineCards] = useState<SocialUser[]>([])
  const [profileOpen, setProfileOpen] = useState(false)
  const [error, setError] = useState('')
  const [dmError, setDmError] = useState('')
  const [joining, setJoining] = useState(false)
  const [lastAttempt, setLastAttempt] = useState(props.initialRoomCode)
  const [dismissedConnectionError, setDismissedConnectionError] = useState('')
  const connecting =
    joining || props.status === 'connecting' || props.status === 'reconnecting'
  const currentUser = useMemo<SocialUser>(
    () => ({
      ...account,
      appearance: normalizeProfileAppearance(account.appearance),
    }),
    [account],
  )
  const previewDirectory = useMemo(
    () =>
      previewData
        ? {
            rooms: previewData.rooms,
            recentRooms: previewData.recentRooms || [],
          }
        : undefined,
    [previewData],
  )
  const directory = useCallDirectory(account.id, previewDirectory)
  const onlineIds = useMemo(
    () => new Set(onlineUsers.map((user) => user.userId)),
    [onlineUsers],
  )
  const onlineKey = onlineUsers
    .map((user) => user.userId)
    .filter((id) => id !== account.id)
    .sort()
    .slice(0, 8)
    .join(',')
  const unread = conversations.reduce((sum, item) => sum + item.unreadCount, 0)

  useEffect(() => {
    if (props.initialRoomCode) setCode(props.initialRoomCode)
  }, [props.initialRoomCode])
  useEffect(() => {
    if (previewData) {
      setConversations(previewData.conversations)
      return
    }
    let stopped = false,
      pending = false
    const load = async () => {
      if (stopped || pending) return
      pending = true
      try {
        const items = await getRecentDirectConversations(account.id)
        if (!stopped) {
          setConversations(items)
          setDmError('')
        }
      } catch (cause) {
        if (!stopped) setDmError(describeSocialError(cause, 'load'))
      } finally {
        pending = false
      }
    }
    const resume = () => {
      if (document.visibilityState === 'visible') void load()
    }
    void load()
    const unsubscribe = subscribeToDirectInbox(resume)
    const timer = window.setInterval(resume, 15000)
    window.addEventListener('focus', resume)
    return () => {
      stopped = true
      unsubscribe()
      window.clearInterval(timer)
      window.removeEventListener('focus', resume)
    }
  }, [account.id, previewData])
  useEffect(() => {
    if (previewData) {
      setOnlineCards(previewData.users.filter((user) => user.id !== account.id))
      return
    }
    let stopped = false
    const ids = onlineKey ? onlineKey.split(',') : []
    if (!ids.length) {
      setOnlineCards([])
      return
    }
    void getSocialProfileCards(ids)
      .then((users) => {
        if (!stopped) setOnlineCards(ids.flatMap((id) => users.get(id) || []))
      })
      .catch(() => {
        if (!stopped) setOnlineCards([])
      })
    return () => {
      stopped = true
    }
  }, [onlineKey, previewData, account.id])

  const navigate = (next: Section) => {
    setSection(next)
    setError('')
  }
  const openConversation = (user: SocialUser | null) => {
    setPeer(user)
    setThreadOpen(true)
    navigate('messages')
  }
  const openJoin = () => {
    setError('')
    setJoinOpen(true)
  }
  const openCreate = () => {
    setError('')
    setPrivateRoom(false)
    setCreateOpen(true)
  }
  const join = async (value: string, privacy = false) => {
    if (connecting) return
    const roomCode = roomCodeFromInput(value)
    if (!roomCode) {
      setError('Digite um código de sala ou cole o link do convite.')
      return
    }
    if (activeRoomCode) {
      if (roomCode === activeRoomCode) {
        props.onReturnToCall()
        return
      }
      setError(
        'Você já está em uma call. Desconecte dela antes de entrar em outra sala.',
      )
      return
    }
    setError('')
    setJoining(true)
    setLastAttempt(roomCode)
    setDismissedConnectionError('')
    try {
      const profile: LocalProfile = {
        displayName: account.displayName,
        avatarDataUrl: account.avatarDataUrl,
        bio: account.bio,
        appearance: account.appearance,
      }
      saveLocalProfile(profile)
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur()
      primeCallSounds()
      if (await props.onJoin(profile, roomCode, privacy)) {
        setCreateOpen(false)
        setJoinOpen(false)
        void directory.refresh()
      }
    } catch {
      setError('Não foi possível entrar na sala. Tente novamente.')
    } finally {
      setJoining(false)
    }
  }
  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    void join(code)
  }

  return (
    <main className="home-shell">
      <header className="home-header">
        <button
          className="home-brand"
          aria-label="Ford Kall — Salas"
          type="button"
          onClick={() => navigate('rooms')}
        >
          <BrandMark />
          <span>Ford Kall</span>
        </button>
        <nav className="home-navigation" aria-label="Navegação principal">
          {destinations.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === 'messages' && unread > 0 && (
                <small aria-label={`${unread} não lidas`}>
                  {Math.min(unread, 99)}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="home-account-actions">
          <details className="home-more">
            <summary aria-label="Mais opções">
              <Icon name="more" />
            </summary>
            <div className="home-more__menu">
              <DesktopDownloads />
              <DesktopUpdateControl variant="lobby" />
              {(account.role === 'owner' || account.role === 'admin') && (
                <button type="button" onClick={props.onOpenAdmin}>
                  <Icon name="controls" />
                  Administração
                </button>
              )}
              <button type="button" onClick={() => void props.onSignOut()}>
                <Icon name="leave" />
                Sair da conta
              </button>
            </div>
          </details>
          <button
            className="home-account"
            aria-label="Editar meu perfil"
            title="Meu perfil"
            type="button"
            onClick={() => setProfileOpen(true)}
          >
            <ProfileAvatar
              appearance={account.appearance}
              avatarDataUrl={account.avatarDataUrl}
              name={account.displayName}
              className="social-avatar"
            />
            <span>{account.displayName}</span>
            <Icon name="chevron" />
          </button>
        </div>
      </header>
      {activeRoomCode && (
        <aside className="home-call-strip" aria-label="Sua call em andamento">
          <span className="home-live-dot" />
          <Icon name={props.activeRoomPrivate ? 'lock' : 'headphones'} />
          <div>
            <strong>
              {props.status === 'reconnecting'
                ? 'Reconectando…'
                : 'Você está em uma call'}
            </strong>
            <span>
              {activeRoomCode}
              {props.activeRoomPrivate ? ' · Privada' : ' · Pública'}
            </span>
          </div>
          <button type="button" onClick={props.onReturnToCall}>
            Voltar à call <Icon name="chevron" />
          </button>
          <IconButton
            aria-label="Desconectar da call"
            variant="danger"
            type="button"
            onClick={() => void props.onLeaveCall()}
          >
            <Icon name="leave" />
          </IconButton>
        </aside>
      )}
      {(error ||
        (props.connectionError &&
          props.connectionError !== dismissedConnectionError)) &&
        !createOpen &&
        !joinOpen && (
          <div className="home-error" role="alert">
            <span>{error || props.connectionError}</span>
            {!activeRoomCode && lastAttempt && (
              <button
                type="button"
                onClick={() => void join(lastAttempt)}
                disabled={connecting}
              >
                Entrar novamente
              </button>
            )}
            <button
              type="button"
              aria-label="Fechar aviso"
              onClick={() => {
                setError('')
                setDismissedConnectionError(props.connectionError)
              }}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
      <div className="home-content">
        {section === 'rooms' ? (
          <div className="home-rooms-layout">
            <SocialRoomsView
              {...directory}
              activeRoomCode={activeRoomCode}
              connecting={connecting}
              onlineUsers={onlineUsers}
              previewUsers={previewData?.users}
              onCreateRoom={openCreate}
              onJoinByCode={openJoin}
              onJoinRoom={(value) => void join(value)}
            />
            <aside
              className="home-social-glance"
              aria-label="Conversas e pessoas online"
            >
              <header>
                <h2>Conversas</h2>
                <button type="button" onClick={() => navigate('messages')}>
                  Ver todas <Icon name="chevron" />
                </button>
              </header>
              <button
                className="home-general-link"
                type="button"
                onClick={() => openConversation(null)}
              >
                <span>
                  <Icon name="hash" />
                </span>
                <div>
                  <strong>Conversa geral</strong>
                  <small>Todo mundo por aqui</small>
                </div>
                <Icon name="chevron" />
              </button>
              {conversations.slice(0, 4).map((item) => (
                <button
                  key={item.user.id}
                  className="home-glance-person"
                  type="button"
                  onClick={() => openConversation(item.user)}
                >
                  <ProfileAvatar
                    appearance={item.user.appearance}
                    avatarDataUrl={item.user.avatarDataUrl}
                    className="social-avatar"
                    name={item.user.displayName}
                  />
                  <div>
                    <strong>{item.user.displayName}</strong>
                    <small>{item.lastMessage.body}</small>
                  </div>
                  {item.unreadCount > 0 && (
                    <span className="home-unread-count">
                      {item.unreadCount}
                    </span>
                  )}
                </button>
              ))}
              <header className="home-online-heading">
                <h2>
                  Online agora <span>{onlineUsers.filter(user => user.userId !== account.id).length}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('people')}
                  aria-label="Ver todas as pessoas"
                >
                  <Icon name="chevron" />
                </button>
              </header>
              <div className="home-online-faces">
                {onlineCards.map((user) => (
                  <button
                    type="button"
                    key={user.id}
                    title={`Conversar com ${user.displayName}`}
                    onClick={() => openConversation(user)}
                  >
                    <ProfileAvatar
                      appearance={user.appearance}
                      avatarDataUrl={user.avatarDataUrl}
                      className="social-avatar"
                      name={user.displayName}
                    />
                    <span>{user.displayName}</span>
                  </button>
                ))}
              </div>
              {!onlineCards.length && (
                <p className="home-muted">As pessoas online aparecem aqui.</p>
              )}
            </aside>
          </div>
        ) : section === 'people' ? (
          <SocialPeopleView
            currentUserId={account.id}
            onMessage={openConversation}
            onlineUsers={onlineUsers}
            previewUsers={previewData?.users}
          />
        ) : (
          <div
            className={`home-messages ${threadOpen ? 'home-messages--thread-open' : ''}`}
          >
            <SocialInbox
              conversations={conversations}
              peer={peer}
              selected={threadOpen}
              onlineIds={onlineIds}
              onSelect={openConversation}
              onNew={() => navigate('people')}
              error={dmError}
            />
            <div className="home-thread">
              <button
                className="home-inbox-back"
                type="button"
                onClick={() => setThreadOpen(false)}
              >
                <Icon name="chevron" style={{ transform: 'rotate(180deg)' }} />
                Todas as conversas
              </button>
              {threadOpen ? (
                peer ? (
                  <SocialMessageView
                    key={peer.id}
                    currentUser={currentUser}
                    mode="direct"
                    peer={peer}
                    peerOnline={onlineIds.has(peer.id)}
                    previewMessages={previewData?.messages}
                  />
                ) : (
                  <SocialMessageView
                    currentUser={currentUser}
                    mode="community"
                    onlineCount={onlineUsers.length}
                    previewMessages={previewData?.messages}
                  />
                )
              ) : (
                <div className="home-thread-empty">
                  <Icon name="chat" />
                  <h1>Suas conversas, num só lugar.</h1>
                  <p>Escolha uma conversa ou mande uma mensagem para alguém.</p>
                  <button
                    className="home-button"
                    type="button"
                    onClick={() => navigate('people')}
                  >
                    <Icon name="plus" />
                    Nova conversa
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {profileOpen && (
        <ProfileEditorModal
          profile={account}
          onClose={() => setProfileOpen(false)}
          onSave={async (profile) => {
            await props.onProfileChange(profile)
          }}
        />
      )}
      {joinOpen && (
        <GameModal
          className="home-dialog"
          title="Entrar com código"
          detail="Cole o link ou o código de uma sala pública ou privada."
          onClose={() => setJoinOpen(false)}
        >
          <form className="home-room-form" onSubmit={submitCode}>
            <label htmlFor="home-room-code">Código ou link da sala</label>
            <input
              id="home-room-code"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={240}
              placeholder="KIW-7294-ABC"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <p>
              <Icon name="lock" />
              Salas privadas não aparecem na lista pública. Você precisa receber
              o código de alguém.
            </p>
            {(error || props.connectionError) && (
              <p className="home-form-error" role="alert">
                {error || props.connectionError}
              </p>
            )}
            <button
              className="home-button home-button--primary"
              type="submit"
              disabled={connecting}
            >
              {connecting ? 'Conectando…' : 'Entrar na sala'}
              <Icon name="chevron" />
            </button>
          </form>
        </GameModal>
      )}
      {createOpen && (
        <GameModal
          className="home-dialog"
          title="Criar sala"
          detail="Escolha quem pode encontrar sua call."
          onClose={() => setCreateOpen(false)}
        >
          <form
            className="home-room-form"
            onSubmit={(event) => {
              event.preventDefault()
              void join(generateRoomCode(), privateRoom)
            }}
          >
            <fieldset className="home-privacy-options">
              <legend>Visibilidade da sala</legend>
              {[false, true].map((privacy) => (
                <label
                  key={String(privacy)}
                  className={privateRoom === privacy ? 'is-selected' : ''}
                >
                  <input
                    type="radio"
                    name="room-visibility"
                    checked={privateRoom === privacy}
                    onChange={() => setPrivateRoom(privacy)}
                  />
                  <Icon name={privacy ? 'lock' : 'users'} />
                  <span>
                    <strong>{privacy ? 'Privada' : 'Pública'}</strong>
                    <small>
                      {privacy
                        ? 'Só entra quem receber o código ou link.'
                        : 'Todas as pessoas do Ford Kall podem encontrar e entrar.'}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <p>
              O código é curto e gerado automaticamente.{' '}
              {privateRoom
                ? 'Não será divulgado na lista pública.'
                : 'A sala aparece enquanto houver pessoas conectadas.'}
            </p>
            {(error || props.connectionError) && (
              <p className="home-form-error" role="alert">
                {error || props.connectionError}
              </p>
            )}
            {activeRoomCode && (
              <p>Você já está em uma call. Desconecte antes de criar outra.</p>
            )}
            <button
              className="home-button home-button--primary"
              type="submit"
              disabled={connecting || Boolean(activeRoomCode)}
            >
              {connecting
                ? 'Criando…'
                : `Criar sala ${privateRoom ? 'privada' : 'pública'}`}
              <Icon name="plus" />
            </button>
          </form>
        </GameModal>
      )}
    </main>
  )
}
