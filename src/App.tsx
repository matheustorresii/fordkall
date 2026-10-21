import { useEffect, useState } from 'react'
import { AdminDashboard } from './components/Admin/AdminDashboard'
import { AuthScreen } from './components/Auth/AuthScreen'
import { CallScreen } from './components/Call/CallScreen'
import { SocialHome } from './components/Social/SocialHome'
import { useAccount } from './hooks/useAccount'
import { useLiveKitRoom } from './hooks/useLiveKitRoom'
import { useSocialPresence } from './hooks/useSocialPresence'
import {
  getRoomCodeFromUrl,
  replaceRoomCodeInCurrentUrl,
} from './services/livekit'
import type { LocalProfile } from './types'
import { supabase } from './services/supabase'

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

  useEffect(() => {
    if (!liveKit.room || !liveKit.activeRoomCode) return
    const code = liveKit.activeRoomCode
    const touch = () => {
      void supabase.rpc('touch_call_room', { p_room_code: code })
    }
    touch()
    const timer = window.setInterval(touch, 25_000)
    return () => {
      window.clearInterval(timer)
      void supabase.rpc('touch_call_room', { p_room_code: code, p_leave: true })
    }
  }, [liveKit.room, liveKit.activeRoomCode])
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
    }
    return connected
  }

  const leaveCall = async () => {
    await liveKit.leave()
    setActiveView('home')
  }

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
      <AdminDashboard
        currentRole={account.profile.role}
        onClose={() => setAdminOpen(false)}
      />
    )
  }

  return (
    <div className="app-routes">
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
          activeRoomCode={liveKit.room ? liveKit.activeRoomCode : ''}
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
    </div>
  )
}

export default App
