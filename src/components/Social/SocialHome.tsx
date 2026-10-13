import { useEffect, useMemo, useState } from 'react'
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
import type { AccountProfile, ConnectionStatus, LocalProfile } from '../../types'
import type { SocialConversation, SocialPresenceEntry, SocialUser } from '../../types/social'
import { ProfileEditorModal } from '../Profile/ProfileEditorModal'
import { ProfileName } from '../Profile/ProfileName'
import { IconButton } from '../ui/Button'
import { DesktopUpdateControl } from '../ui/DesktopUpdateControl'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import './SocialHome.css'
import { SocialMessageView } from './SocialMessageView'
import { SocialPeopleView } from './SocialPeopleView'
import { SocialRoomsView } from './SocialRoomsView'
import { SocialSidebar, type SocialSection } from './SocialSidebar'

interface SocialHomeProps {
  account: AccountProfile
  activeRoomCode: string
  status: ConnectionStatus
  connectionError: string
  initialRoomCode: string
  onlineUsers: SocialPresenceEntry[]
  onJoin: (profile: LocalProfile, roomCode: string) => Promise<boolean>
  onLeaveCall: () => Promise<void>
  onOpenAdmin: () => void
  onProfileChange: (profile: LocalProfile) => Promise<AccountProfile>
  onReturnToCall: () => void
  onSignOut: () => Promise<void>
}

const toSocialUser = (account: AccountProfile): SocialUser => ({
  id: account.id,
  displayName: account.displayName || account.email,
  avatarDataUrl: account.avatarDataUrl,
  bio: account.bio,
  appearance: normalizeProfileAppearance(account.appearance),
})

export const SocialHome = ({
  account,
  activeRoomCode,
  status,
  connectionError,
  initialRoomCode,
  onlineUsers,
  onJoin,
  onLeaveCall,
  onOpenAdmin,
  onProfileChange,
  onReturnToCall,
  onSignOut,
}: SocialHomeProps) => {
  const [section, setSection] = useState<SocialSection>(initialRoomCode ? 'rooms' : 'general')
  const [selectedConversation, setSelectedConversation] = useState<SocialUser | null>(null)
  const [conversations, setConversations] = useState<SocialConversation[]>([])
  const [onlineCards, setOnlineCards] = useState<SocialUser[]>([])
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [topError, setTopError] = useState('')
  const [dmError, setDmError] = useState('')
  const currentUser = useMemo(() => toSocialUser(account), [account])
  const onlineIdSet = useMemo(() => new Set(onlineUsers.map((user) => user.userId)), [onlineUsers])
  const connecting = status === 'connecting' || status === 'reconnecting'
  const onlineKey = onlineUsers.map((user) => user.userId)
    .filter((id) => id !== account.id).slice(0, 6).sort().join(',')

  useEffect(() => {
    if (!initialRoomCode) return
    setSelectedConversation(null)
    setSection('rooms')
  }, [initialRoomCode])

  useEffect(() => {
    let cancelled = false
    const load = () => getRecentDirectConversations(account.id)
      .then((items) => {
        if (!cancelled) {
          setConversations(items)
          setDmError('')
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setDmError(describeSocialError(cause, 'load'))
      })

    void load()
    const unsubscribe = subscribeToDirectInbox(() => { void load() })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [account.id])

  useEffect(() => {
    let cancelled = false
    const ids = onlineKey ? onlineKey.split(',') : []
    if (ids.length === 0) {
      setOnlineCards([])
      return
    }
    void getSocialProfileCards(ids).then((cards) => {
      if (!cancelled) setOnlineCards(ids.flatMap((id) => cards.get(id) || []))
    }).catch(() => {
      if (!cancelled) setOnlineCards([])
    })
    return () => { cancelled = true }
  }, [onlineKey])

  const setMainSection = (nextSection: SocialSection) => {
    setSelectedConversation(null)
    setSection(nextSection)
    setMobileMenuOpen(false)
    setTopError('')
  }

  const openConversation = (user: SocialUser) => {
    setSelectedConversation(user)
    setSection('people')
    setMobileMenuOpen(false)
    setTopError('')
    setDmError('')
  }

  const joinRoom = async (roomCode: string) => {
    const normalizedCode = roomCodeFromInput(roomCode)
    if (!normalizedCode) {
      setSection('rooms')
      setTopError('Digite um código de sala ou cole o link do convite.')
      return
    }
    if (activeRoomCode) {
      if (normalizedCode === activeRoomCode) {
        onReturnToCall()
        return
      }
      setTopError('Você já está em uma call. Volte para ela ou encerre a conexão antes de entrar em outra sala.')
      return
    }
    setTopError('')
    const profile: LocalProfile = {
      displayName: account.displayName,
      avatarDataUrl: account.avatarDataUrl,
      bio: account.bio,
      appearance: account.appearance,
    }
    saveLocalProfile(profile)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo({ top: 0, behavior: 'instant' })
    primeCallSounds()
    await onJoin(profile, normalizedCode)
  }

  const createRoom = () => {
    if (!connecting) void joinRoom(generateRoomCode())
  }

  const title = selectedConversation
    ? selectedConversation.displayName
    : section === 'general' ? 'Geral' : section === 'people' ? 'Pessoas' : 'Salas'

  return (
    <main className="social-shell">
      <SocialSidebar
        conversations={conversations}
        mobileOpen={mobileMenuOpen}
        onlineCards={onlineCards}
        onlineUsers={onlineUsers}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onCreateRoom={createRoom}
        onNewMessage={() => setMainSection('people')}
        onSelectConversation={openConversation}
        onSelectSection={setMainSection}
        section={section}
        selectedConversationId={selectedConversation?.id || ''}
      />

      <div className="social-main">
        <header className="social-topbar">
          <IconButton
            aria-label="Abrir navegação"
            variant="secondary"
            className="social-topbar__menu"
            onClick={() => setMobileMenuOpen(true)}
            type="button"
          ><Icon name="menu" /></IconButton>
          <div className="social-topbar__breadcrumb">
            <span>COMUNIDADE</span>
            <Icon name="chevron" />
            <strong>{title}</strong>
          </div>
          <div className="social-topbar__actions">
            {activeRoomCode && (
              <button
                className="social-return-call"
                onClick={onReturnToCall}
                title={`Voltar à call ${activeRoomCode}`}
                type="button"
              >
                <Icon name="headphones" />
                <span>Voltar à call</span>
              </button>
            )}
            <span className="social-topbar__connected"><i /> Conectado</span>
            <DesktopUpdateControl variant="lobby" />
            {(account.role === 'owner' || account.role === 'admin') && (
              <IconButton aria-label="Abrir painel administrativo" onClick={onOpenAdmin} title="Painel administrativo" type="button">
                <Icon name="controls" />
              </IconButton>
            )}
            <button
              aria-label="Editar perfil"
              className="social-account-button"
              onClick={() => setProfileEditorOpen(true)}
              title="Editar perfil"
              type="button"
            >
              <ProfileAvatar
                appearance={account.appearance}
                avatarDataUrl={account.avatarDataUrl}
                className="social-avatar social-avatar--small"
                name={currentUser.displayName}
              />
              <span><ProfileName appearance={account.appearance} name={currentUser.displayName} /><small>Meu perfil</small></span>
            </button>
            <IconButton aria-label="Sair da conta" className="social-icon-button--logout" onClick={() => void onSignOut()} title="Sair da conta" type="button" variant="danger">
              <Icon name="leave" />
            </IconButton>
          </div>
        </header>

        {activeRoomCode && (
          <aside className="social-call-banner" role="status">
            <span className="social-call-banner__status"><i />Call em andamento</span>
            <strong>{activeRoomCode}</strong>
            <div>
              <button className="social-call-banner__return" onClick={onReturnToCall} type="button">Voltar à call</button>
              <button className="social-call-banner__leave" onClick={() => void onLeaveCall()} type="button">Desconectar</button>
            </div>
          </aside>
        )}

        {(topError || dmError) && <p className="social-top-error" role="alert">{topError || dmError}</p>}
        <div className="social-content" key={selectedConversation?.id || section}>
          {selectedConversation ? (
            <SocialMessageView
              currentUser={currentUser}
              mode="direct"
              peer={selectedConversation}
              peerOnline={onlineIdSet.has(selectedConversation.id)}
            />
          ) : section === 'general' ? (
            <SocialMessageView currentUser={currentUser} mode="community" onlineCount={onlineUsers.length} />
          ) : section === 'people' ? (
            <SocialPeopleView currentUserId={account.id} onMessage={openConversation} onlineUsers={onlineUsers} />
          ) : (
            <SocialRoomsView
              connectionError={connectionError}
              connecting={connecting}
              initialRoomCode={initialRoomCode}
              onCreateRoom={createRoom}
              onJoinRoom={(code) => void joinRoom(code)}
              onlineUsers={onlineUsers}
            />
          )}
        </div>
      </div>

      {profileEditorOpen && (
        <ProfileEditorModal
          onClose={() => setProfileEditorOpen(false)}
          onSave={async (profile) => { await onProfileChange(profile) }}
          profile={account}
        />
      )}
    </main>
  )
}
