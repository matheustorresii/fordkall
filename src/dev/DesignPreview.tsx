import { useState } from 'react'
import { SocialHome } from '../components/Social/SocialHome'
import { ScreenShareStage } from '../components/ScreenShare/ScreenShareStage'
import { Icon } from '../components/ui/Icon'
import type { AccountProfile, ParticipantMedia } from '../types'
import { normalizeProfileAppearance } from '../services/profile'
import { cosmeticAsset } from '../services/cosmetics'

const users = [
  {
    id: 'p0',
    displayName: 'Torres',
    avatarDataUrl: undefined,
    bio: 'Bora pra call.',
    appearance: normalizeProfileAppearance({
      decorationId: 'frangoelho',
      backgroundId: 'frangoelho',
      avatarFrame: 'none',
    }),
  },
  {
    id: 'p1',
    displayName: 'Kaori',
    appearance: normalizeProfileAppearance({
      decorationId: 'barbie-mermaid',
      backgroundId: 'barbie-coral',
      avatarFrame: 'none',
      nameColor: '#e8c3e0',
    }),
  },
  {
    id: 'p2',
    displayName: 'Filipe',
    appearance: normalizeProfileAppearance({
      decorationId: 'avatar-water',
      backgroundId: 'avatar-water',
      avatarFrame: 'none',
    }),
  },
]
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)
const twoDaysAgo = new Date()
twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
const messages = [
  {
    id: 'm1',
    senderId: 'p1',
    sender: users[1]!,
    body: 'Bora testar os jogos hoje à noite?',
    createdAt: twoDaysAgo.toISOString(),
  },
  {
    id: 'm2',
    senderId: 'p0',
    sender: users[0]!,
    body: 'Bora! Quero ver quem vai disfarçar melhor no Impostor 👀',
    createdAt: twoDaysAgo.toISOString(),
  },
  {
    id: 'm3',
    senderId: 'p2',
    sender: users[2]!,
    body: 'Criei uma sala. É só chegar.',
    createdAt: yesterday.toISOString(),
  },
  {
    id: 'm4',
    senderId: 'p1',
    sender: users[1]!,
    body: 'O fundo de sereia ficou lindo demais 🫧',
    createdAt: new Date().toISOString(),
  },
]
const fixture = {
  users,
  conversations: users
    .slice(1)
    .map((user) => ({
      user,
      lastMessage: {
        senderId: user.id,
        body:
          user.id === 'p1'
            ? 'Bora testar os jogos hoje?'
            : 'Criei uma sala. É só chegar.',
        createdAt: new Date().toISOString(),
      },
      unreadCount: user.id === 'p1' ? 2 : 0,
    })),
  rooms: [{ code: 'KIW-7204-ABC', user_ids: ['p1', 'p2'] }, { code: 'ITO-4837-FK2', user_ids: ['p0'] }],
  recentRooms: [{ code: 'KIW-7204-ABC', is_private: false, last_joined_at: new Date().toISOString() }, { code: 'AMG-9132-TWR', is_private: true, last_joined_at: yesterday.toISOString() }, { code: 'GAM-2471-XP3', is_private: false, last_joined_at: twoDaysAgo.toISOString() }],
  messages,
}
const fakeCamera = {
  attach(el: HTMLVideoElement) {
    el.poster = cosmeticAsset('background', 'dusk') || ''
    return el
  },
  detach() {
    return []
  },
}
export const DesignPreview = () => {
  const [account, setAccount] = useState<AccountProfile>({
      ...users[0]!,
      id: 'p0',
      email: 'preview@example.invalid',
      role: 'owner',
      status: 'active',
      createdAt: new Date().toISOString(),
    }),
    [inCall, setInCall] = useState(false),
    [connected, setConnected] = useState(false),
    [camera, setCamera] = useState(false),
    [share, setShare] = useState(false)
  const params = new URLSearchParams(location.search),
    solo = params.has('solo')
  const participants: ParticipantMedia[] = (
    solo ? [account] : [account, ...users.slice(1)]
  ).map((u, i) => ({
    id: u.id,
    name: u.displayName,
    appearance: u.appearance!,
    isLocal: i === 0,
    cameraEnabled: i === 0 && camera,
    cameraTrack: i === 0 && camera ? (fakeCamera as never) : undefined,
    microphoneMuted: false,
  }))
  return inCall ? (
    <main className="call-shell">
      <header className="call-header">
        <button
          className="icon-button"
          onClick={() => setInCall(false)}
          aria-label="Voltar à home"
        >
          <Icon name="home" />
        </button>
        <div>Prévia da galeria</div>
        <div className="call-header__actions">
          <button onClick={() => setCamera(!camera)}>
            {camera ? 'Desligar câmera' : 'Ligar câmera'}
          </button>
          <button onClick={() => setShare(!share)}>Alternar transmissão</button>
        </div>
      </header>
      <div className="call-workspace">
        <ScreenShareStage
          lives={
            share
              ? [
                  {
                    id: 'screen-p0',
                    participantIdentity: 'p0',
                    participantName: 'Torres',
                    isLocal: true,
                    videoTrack: fakeCamera as never,
                    subscribed: true,
                    hasAudio: false,
                    muted: false,
                  },
                ]
              : []
          }
          participants={participants}
          activeSpeakerIds={new Set(['p0'])}
          deafened={false}
          screenOutputId=""
          galleryLayout="expanded"
          onParticipantMenu={() => {}}
        />
      </div>
    </main>
  ) : (
    <SocialHome
      account={account}
      activeRoomCode={connected ? 'KIW-7204-ABC' : ''}
      status={connected ? 'connected' : 'disconnected'}
      connectionError=""
      initialRoomCode=""
      onlineUsers={users.map((u) => ({
        userId: u.id,
        displayName: u.displayName,
      }))}
      onJoin={async () => {
        setConnected(true)
        setInCall(true)
        return true
      }}
      onLeaveCall={async () => { setConnected(false); setInCall(false) }}
      onOpenAdmin={() => {}}
      onProfileChange={async (p) => {
        const next = { ...account, ...p }
        setAccount(next)
        return next
      }}
      onReturnToCall={() => setInCall(true)}
      onSignOut={async () => {}}
      previewData={fixture}
    />
  )
}
