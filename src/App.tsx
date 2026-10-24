import { lazy, Suspense, useEffect, useState } from 'react'
import { AuthScreen } from './components/Auth/AuthScreen'
import { useAccount } from './hooks/useAccount'
import { useLiveKitRoom } from './hooks/useLiveKitRoom'
import { useSocialPresence } from './hooks/useSocialPresence'
import { useDirectCalls } from './hooks/useDirectCalls'
import { DirectCallOverlay } from './components/Social/DirectCallOverlay'
import {
  getRoomCodeFromUrl,
  replaceRoomCodeInCurrentUrl,
} from './services/livekit'
import type { LocalProfile } from './types'
import { setPwaCallActive } from './pwa/store'
const AdminDashboard = lazy(() => import('./components/Admin/AdminDashboard').then(module => ({ default: module.AdminDashboard })))
const CallScreen = lazy(() => import('./components/Call/CallScreen').then(module => ({ default: module.CallScreen })))
const SocialHome = lazy(() => import('./components/Social/SocialHome').then(module => ({ default: module.SocialHome })))
const loadingView = <main className="app-loading"><span className="spinner" /><span>Abrindo Ford Kall…</span></main>

function App() {
  const account = useAccount()
  const liveKit = useLiveKitRoom()
  const socialPresence = useSocialPresence(
    account.profile?.id,
    account.profile?.displayName || '',
  )
  const [roomCode, setRoomCode] = useState(getRoomCodeFromUrl)
  const [adminOpen, setAdminOpen] = useState(false)
  const [activeView, setActiveView] = useState<'home' | 'call'>('home')

  useEffect(() => {
    setPwaCallActive(Boolean(liveKit.room) || liveKit.status === 'connecting' || liveKit.status === 'reconnecting')
    return () => setPwaCallActive(false)
  }, [liveKit.room, liveKit.status])

  useEffect(() => {
    const desktop = window.fordKallDesktop
    if (!desktop) return
    desktop.setInCall(Boolean(liveKit.room))
    return () => desktop.setInCall(false)
  }, [liveKit.room])

  useEffect(() => {
    const desktop = window.fordKallDesktop
    if (!desktop) return
    return desktop.onOpenRoom((nextRoomCode) => {
      if (liveKit.room) return
      setRoomCode(nextRoomCode)
      replaceRoomCodeInCurrentUrl(nextRoomCode)
    })
  }, [liveKit.room])

  const join = async (
    profile: LocalProfile,
    nextRoomCode: string,
    privateRoom = false,
  ) => {
    await account.updateProfile(profile)
    const connected = await liveKit.join(nextRoomCode, profile, privateRoom)
    if (connected) {
      setRoomCode(nextRoomCode)
      replaceRoomCodeInCurrentUrl(nextRoomCode)
      setActiveView('call')
      setAdminOpen(false)
    }
    return connected
  }

  const leaveCall = async () => {
    void calls.endRoomCalls(liveKit.activeRoomCode)
    await liveKit.leave()
    setActiveView('home')
  }

  const calls = useDirectCalls({
    account: account.profile || null,
    activeRoom: liveKit.room ? liveKit.activeRoomCode : '',
    connecting: liveKit.status === 'connecting' || liveKit.status === 'reconnecting',
    join: code => account.profile ? join(account.profile, code, true) : Promise.resolve(false),
    returnToCall: () => setActiveView('call'),
    leaveIdleRoom: code => liveKit.room && liveKit.activeRoomCode === code && liveKit.room.remoteParticipants.size === 0 ? leaveCall() : Promise.resolve(),
  })

  const signOut = async () => {
    if (liveKit.room) await leaveCall()
    await account.logout()
  }

  if (account.loading && !account.profile) {
    return (
      <main className="app-loading">
        <span className="spinner" />
        <span>Carregando…</span>
      </main>
    )
  }

  if (!account.session || !account.profile) {
    return (
      <AuthScreen
        busy={account.loading}
        configured={account.configured}
        error={account.error}
        onActivate={account.activate}
        onClearError={account.clearError}
        onLogin={account.login}
        onValidateInvite={account.validateInvite}
      />
    )
  }

  const canOpenAdmin =
    account.profile.role === 'owner' || account.profile.role === 'admin'
  if (adminOpen && canOpenAdmin && !liveKit.room) {
    return (
      <><Suspense fallback={loadingView}><AdminDashboard
        currentRole={account.profile.role}
        onClose={() => setAdminOpen(false)}
      /></Suspense>
      <DirectCallOverlay calls={calls} userId={account.profile.id} /></>
    )
  }

  return (
    <><Suspense fallback={loadingView}><div className="app-routes">
      {liveKit.room && (
        <div
          aria-hidden={activeView !== 'call' || adminOpen}
          className={`app-route ${activeView === 'call' && !adminOpen ? '' : 'app-route--hidden'}`}
        >
          <CallScreen
            accountRole={account.profile.role}
            active={activeView === 'call' && !adminOpen}
            onNavigateCall={() => setActiveView('call')}
            microphoneError={liveKit.microphoneError}
            microphoneStarting={liveKit.microphoneStarting}
            onLeave={leaveCall}
            onMicrophoneErrorChange={liveKit.setMicrophoneError}
            onNavigateHome={() => setActiveView('home')}
            room={liveKit.room}
            roomCode={roomCode}
            privateRoom={liveKit.privateRoom}
            status={liveKit.status}
          />
        </div>
      )}
      <div
        aria-hidden={(liveKit.room && activeView === 'call') || adminOpen}
        className={`app-route ${(liveKit.room && activeView === 'call') || adminOpen ? 'app-route--hidden' : ''}`}
      >
        <SocialHome
          account={account.profile}
          calls={calls}
          active={(!liveKit.room || activeView === 'home') && !adminOpen}
          activeRoomCode={liveKit.room ? liveKit.activeRoomCode : ''}
          activeRoomPrivate={liveKit.privateRoom}
          connectionError={liveKit.error}
          initialRoomCode={roomCode}
          onlineUsers={socialPresence.onlineUsers}
          onJoin={join}
          onLeaveCall={leaveCall}
          onOpenAdmin={() => setAdminOpen(true)}
          onProfileChange={account.updateProfile}
          onReturnToCall={() => setActiveView('call')}
          onSignOut={signOut}
          status={liveKit.status}
        />
      </div>
      {adminOpen && canOpenAdmin && liveKit.room && (
        <div className="app-route">
          <AdminDashboard
            currentRole={account.profile.role}
            onClose={() => setAdminOpen(false)}
          />
        </div>
      )}
    </div></Suspense>
    <DirectCallOverlay calls={calls} userId={account.profile.id} /></>
  )
}

export default App
