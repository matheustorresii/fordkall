import { useEffect, useState } from 'react'
import { AdminDashboard } from './components/Admin/AdminDashboard'
import { AuthScreen } from './components/Auth/AuthScreen'
import { CallScreen } from './components/Call/CallScreen'
import { Lobby } from './components/Lobby/Lobby'
import { useAccount } from './hooks/useAccount'
import { useLiveKitRoom } from './hooks/useLiveKitRoom'
import { getRoomCodeFromUrl, replaceRoomCodeInCurrentUrl } from './services/livekit'
import type { LocalProfile } from './types'

function App() {
  const account = useAccount()
  const liveKit = useLiveKitRoom()
  const [roomCode, setRoomCode] = useState(getRoomCodeFromUrl)
  const [adminOpen, setAdminOpen] = useState(false)

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

  const join = async (profile: LocalProfile, nextRoomCode: string) => {
    await account.updateProfile(profile)
    const connected = await liveKit.join(nextRoomCode, profile)
    if (connected) {
      setRoomCode(nextRoomCode)
      replaceRoomCodeInCurrentUrl(nextRoomCode)
    }
    return connected
  }

  if (account.loading && !account.profile) {
    return <main className="app-loading"><span className="spinner" /><span>Preparando sua garagem…</span></main>
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

  if (adminOpen && (account.profile.role === 'owner' || account.profile.role === 'admin')) {
    return <AdminDashboard currentRole={account.profile.role} onClose={() => setAdminOpen(false)} />
  }

  if (liveKit.room) {
    return (
      <CallScreen
        microphoneError={liveKit.microphoneError}
        microphoneStarting={liveKit.microphoneStarting}
        onLeave={liveKit.leave}
        onMicrophoneErrorChange={liveKit.setMicrophoneError}
        room={liveKit.room}
        roomCode={roomCode}
        status={liveKit.status}
      />
    )
  }

  return (
    <Lobby
      account={account.profile}
      connectionError={liveKit.error}
      initialRoomCode={roomCode}
      onJoin={join}
      onOpenAdmin={() => setAdminOpen(true)}
      onProfileChange={account.updateProfile}
      onSignOut={account.logout}
      status={liveKit.status}
    />
  )
}

export default App
