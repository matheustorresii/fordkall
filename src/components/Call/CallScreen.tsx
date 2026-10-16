import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RoomEvent, type Room } from 'livekit-client'
import { useAudioDevices } from '../../hooks/useAudioDevices'
import { useAppUpdater } from '../../hooks/useAppUpdater'
import { useCallShortcuts } from '../../hooks/useCallShortcuts'
import { useDesktopGameOverlay } from '../../hooks/useDesktopGameOverlay'
import { useDesktopPerformanceMode } from '../../hooks/useDesktopPerformanceMode'
import { useMicrophoneMonitor } from '../../hooks/useMicrophoneMonitor'
import { useRoomSnapshot } from '../../hooks/useRoomSnapshot'
import { useMicrophoneProcessing } from '../../hooks/useMicrophoneProcessing'
import { microphoneCaptureOptions } from '../../services/microphoneCapture'
import { useRoomChat } from '../../hooks/useRoomChat'
import { useRoomExcalitower } from '../../hooks/useRoomExcalitower'
import { useRoomIto } from '../../hooks/useRoomIto'
import { useRoomExplodingKiwi } from '../../hooks/useRoomExplodingKiwi'
import { useRoomTruco } from '../../hooks/useRoomTruco'
import { useRoomMind } from '../../hooks/useRoomMind'
import { useRoomPoker } from '../../hooks/useRoomPoker'
import { useRoomCoup } from '../../hooks/useRoomCoup'
import { useRoomCodenames } from '../../hooks/useRoomCodenames'
import { useRoomMusic } from '../../hooks/useRoomMusic'
import { useScreenShare } from '../../hooks/useScreenShare'
import { playCallSound, primeCallSounds } from '../../services/callSounds'
import { createRoomInviteUrl, streamQualityPresets } from '../../services/livekit'
import { disconnectCallParticipant } from '../../services/moderation'
import {
  getCallSoundsEnabled,
  getGameOverlayEnabled,
  getGalleryLayout,
  getStreamQuality,
  saveCallSoundsEnabled,
  saveGameOverlayEnabled,
  saveGalleryLayout,
  saveStreamQuality,
} from '../../storage/preferences'
import type {
  ConnectionStatus,
  AppRole,
  ContextMenuPoint,
  GalleryLayoutMode,
  StreamQualityId,
} from '../../types'
import { ChatPanel } from '../Chat/ChatPanel'
import { ItoGameStage } from '../Games/ItoGameStage'
import { useRoomGameParticipation } from '../../hooks/useRoomGameParticipation'
import { GameParticipationContext } from '../Games/GameParticipationContext'
import { GameParticipationPanel } from '../Games/GameParticipationPanel'
import type { GameKind } from '../../games/gameParticipation'
import { ExplodingKiwiStage } from '../Games/ExplodingKiwiStage'
import { TrucoMineiroStage } from '../Games/TrucoMineiroStage'
import { TheMindStage } from '../Games/TheMindStage'
import { PokerStage } from '../Games/PokerStage'
import { CoupStage } from '../Games/CoupStage'
import { CodenamesStage } from '../Games/CodenamesStage'
import { RoomGamesHub } from '../Games/RoomGamesHub'
import { ExcalitowerBoundary } from '../Excalitower/ExcalitowerBoundary'
import { MusicPanel } from '../Music/MusicPanel'
import { ParticipantAudioLayer } from '../Participants/ParticipantAudioLayer'
import { ParticipantContextMenu } from '../Participants/ParticipantContextMenu'
import { ParticipantDisconnectDialog } from '../Participants/ParticipantDisconnectDialog'
import { GalleryLayoutMenu } from '../Participants/GalleryLayoutMenu'
import { ParticipantList } from '../Participants/ParticipantList'
import { ScreenShareStage } from '../ScreenShare/ScreenShareStage'
import { SettingsModal } from '../Settings/SettingsModal'
import { BrandMark } from '../ui/BrandMark'
import { Icon, type IconName } from '../ui/Icon'

const ExcalitowerStage = lazy(() => import('../Excalitower/ExcalitowerStage'))

interface CallScreenProps {
  accountRole: AppRole
  room: Room
  roomCode: string
  status: ConnectionStatus
  microphoneError: string
  microphoneStarting: boolean
  onMicrophoneErrorChange: (message: string) => void
  onNavigateHome: () => void
  active?: boolean
  onNavigateCall?: () => void
  onLeave: () => Promise<void>
}

interface ControlButtonProps {
  icon: IconName
  label: string
  detail: string
  active?: boolean
  muted?: boolean
  danger?: boolean
  disabled?: boolean
  error?: boolean
  onClick: () => void
}

const ControlButton = ({
  icon,
  label,
  detail,
  active,
  muted,
  danger,
  disabled,
  error,
  onClick,
}: ControlButtonProps) => (
  <button
    aria-label={`${label}: ${detail}`}
    className={`call-control ${active ? 'call-control--active' : ''} ${muted ? 'call-control--muted' : ''} ${danger ? 'call-control--danger' : ''} ${error ? 'call-control--error' : ''}`}
    disabled={disabled}
    onClick={onClick}
    title={`${label} · ${detail}`}
    type="button"
  >
    <span className="call-control__icon"><Icon name={icon} /></span>
    <span>
      <strong>{label}</strong>
      <small>{detail}</small>
    </span>
  </button>
)

const Notice = ({
  children,
  warning = false,
  actionLabel,
  onAction,
  onClose,
}: {
  children: React.ReactNode
  warning?: boolean
  actionLabel?: string
  onAction?: () => void
  onClose: () => void
}) => (
  <div className={`notice ${warning ? 'notice--warning' : ''}`} role={warning ? 'alert' : 'status'}>
    <Icon name="warning" />
    <span>{children}</span>
    {actionLabel && onAction && (
      <button className="notice__action" onClick={onAction} type="button">{actionLabel}</button>
    )}
    <button aria-label="Fechar aviso" onClick={onClose} title="Fechar aviso" type="button">
      <Icon name="x" />
    </button>
  </div>
)

const connectionLabel: Record<ConnectionStatus, string> = {
  connecting: 'Conectando',
  connected: 'Conectado',
  reconnecting: 'Reconectando',
  disconnected: 'Desconectado',
  error: 'Erro',
}

export const CallScreen = ({
  accountRole,
  room,
  roomCode,
  status,
  microphoneError,
  microphoneStarting,
  onMicrophoneErrorChange,
  onNavigateHome,
  active = true,
  onNavigateCall,
  onLeave,
}: CallScreenProps) => {
  const snapshot = useRoomSnapshot(room)
  useDesktopPerformanceMode(room)
  const devices = useAudioDevices(room)
  const microphoneProcessing = useMicrophoneProcessing(room)
  const microphoneMonitor = useMicrophoneMonitor(
    room,
    devices.preferences.voiceOutputId,
    `${devices.selectedInput}:${microphoneProcessing.processorRevision}`,
  )
  const chat = useRoomChat(room)
  const whiteboard = useRoomExcalitower(room)
  const whiteboardNames = useMemo(() => Object.fromEntries(snapshot.participants.map((person) => [person.identity, person.name || person.identity])), [snapshot.participants])
  const gameParticipation = useRoomGameParticipation(room)
  const itoGame = useRoomIto(room, gameParticipation)
  const explodingKiwi = useRoomExplodingKiwi(room, gameParticipation)
  const trucoGame = useRoomTruco(room, gameParticipation)
  const mindGame = useRoomMind(room, gameParticipation)
  const pokerGame = useRoomPoker(room, gameParticipation)
  const coupGame = useRoomCoup(room, gameParticipation)
  const codenamesGame = useRoomCodenames(room, gameParticipation)
  const music = useRoomMusic(room)
  const [deafened, setDeafened] = useState(false)
  const [callSoundsEnabled, setCallSoundsEnabled] = useState(getCallSoundsEnabled)
  const [gameOverlayEnabled, setGameOverlayEnabled] = useState(getGameOverlayEnabled)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [quality, setQuality] = useState<StreamQualityId>(getStreamQuality)
  const [galleryLayout, setGalleryLayout] = useState<GalleryLayoutMode>(getGalleryLayout)
  const [layoutMenuPoint, setLayoutMenuPoint] = useState<ContextMenuPoint | null>(null)
  const [micBusy, setMicBusy] = useState(false)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [copyState, setCopyState] = useState('Copiar link')
  const [audioBlocked, setAudioBlocked] = useState(!room.canPlaybackAudio)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [musicOpen, setMusicOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)
  const [gameParticipationOpen, setGameParticipationOpen] = useState(false)
  const pendingGameStart = useRef<{ kind: GameKind; start: () => boolean } | null>(null)
  const [gameMode, setGameMode] = useState<'hub' | 'excalitower' | 'ito' | 'kiwi' | 'truco' | 'mind' | 'poker' | 'coup' | 'codenames'>('hub')
  const [unreadMessages, setUnreadMessages] = useState(0)
  const lastSeenMessageId = useRef('')
  const [participantMenu, setParticipantMenu] = useState<{
    participantId: string
    point: ContextMenuPoint
  } | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<{ identity: string; sid: string; name: string } | null>(null)
  const [moderationNotice, setModerationNotice] = useState('')
  const screenShare = useScreenShare(room, quality)
  const updater = useAppUpdater()
  const micEnabled = room.localParticipant.isMicrophoneEnabled
  const cameraEnabled = room.localParticipant.isCameraEnabled
  useDesktopGameOverlay(room, gameOverlayEnabled)

  useEffect(() => {
    if (active) return
    setParticipantMenu(null)
    setDisconnectTarget(null)
  }, [active])

  useEffect(() => {
    if (!moderationNotice) return
    const timer = window.setTimeout(() => setModerationNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [moderationNotice])

  useEffect(() => {
    if (!gamesOpen) return
    for (const live of snapshot.lives) {
      if (live.isLocal) continue
      if (live.videoPublication?.isDesired) live.videoPublication.setSubscribed(false)
      if (live.audioPublication?.isDesired) live.audioPublication.setSubscribed(false)
    }
  }, [gamesOpen, snapshot.lives])

  useEffect(() => {
    if (!itoGame.state.gameId || !gameParticipation.allowed('ito', room.localParticipant.identity) || !itoGame.state.players.some((player) => player.identity === room.localParticipant.identity)) return
    setLayoutMenuPoint(null)
    setParticipantsOpen(false)
    setChatOpen(false)
    setMusicOpen(false)
    setGameMode('ito')
    setGamesOpen(true)
  }, [itoGame.state.gameId])

  useEffect(() => {
    if (!explodingKiwi.state.gameId || !gameParticipation.allowed('kiwi', room.localParticipant.identity) || !explodingKiwi.state.players.some((player) => player.identity === room.localParticipant.identity)) return
    setLayoutMenuPoint(null)
    setParticipantsOpen(false)
    setChatOpen(false)
    setMusicOpen(false)
    setGameMode('kiwi')
    setGamesOpen(true)
  }, [explodingKiwi.state.gameId])

  useEffect(() => {
    if (!trucoGame.state.matchId || !gameParticipation.allowed('truco', room.localParticipant.identity) || !trucoGame.state.players.some((player) => player.identity === room.localParticipant.identity)) return
    setLayoutMenuPoint(null)
    setParticipantsOpen(false)
    setChatOpen(false)
    setMusicOpen(false)
    setGameMode('truco')
    setGamesOpen(true)
  }, [trucoGame.state.matchId])

  useEffect(() => {
    if (!mindGame.state.gameId || !gameParticipation.allowed('mind', room.localParticipant.identity) || !mindGame.state.players.some((player) => player.identity === room.localParticipant.identity)) return
    setLayoutMenuPoint(null)
    setParticipantsOpen(false)
    setChatOpen(false)
    setMusicOpen(false)
    setGameMode('mind')
    setGamesOpen(true)
  }, [mindGame.state.gameId])

  useEffect(() => {
    if (!pokerGame.state.matchId || !gameParticipation.allowed('poker', room.localParticipant.identity) || !pokerGame.state.players.some((player) => player.identity === room.localParticipant.identity)) return
    setLayoutMenuPoint(null)
    setParticipantsOpen(false)
    setChatOpen(false)
    setMusicOpen(false)
    setGameMode('poker')
    setGamesOpen(true)
  }, [pokerGame.state.matchId])

  useEffect(() => {
    if (!coupGame.state.gameId || !gameParticipation.allowed('coup', room.localParticipant.identity) || !coupGame.state.players.some((player) => player.identity === room.localParticipant.identity)) return
    setLayoutMenuPoint(null)
    setParticipantsOpen(false)
    setChatOpen(false)
    setMusicOpen(false)
    setGameMode('coup')
    setGamesOpen(true)
  }, [coupGame.state.gameId])

  useEffect(() => {
    if (!codenamesGame.state.gameId || !gameParticipation.allowed('codenames', room.localParticipant.identity) || !codenamesGame.state.players.some((player) => player.identity === room.localParticipant.identity && player.team)) return
    setLayoutMenuPoint(null)
    setParticipantsOpen(false)
    setChatOpen(false)
    setMusicOpen(false)
    setGameMode('codenames')
    setGamesOpen(true)
  }, [codenamesGame.state.gameId])

  useEffect(() => {
    const handleParticipantConnected = () => playCallSound('join')
    const handleParticipantDisconnected = () => playCallSound('leave')

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    playCallSound('join')

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    }
  }, [room])

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return

    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Sala ${roomCode}`,
      artist: 'Ford Kall',
      album: 'Call em andamento',
    })
    try {
      navigator.mediaSession.playbackState = 'playing'
    } catch {
      // Some mobile browsers expose Media Session without a writable state.
    }

    return () => {
      navigator.mediaSession.metadata = null
      try {
        navigator.mediaSession.playbackState = 'none'
      } catch {
        // The call teardown still disconnects every LiveKit track.
      }
    }
  }, [roomCode])

  useEffect(() => {
    const previousIndex = lastSeenMessageId.current
      ? chat.messages.findIndex((message) => message.id === lastSeenMessageId.current)
      : -1
    const added = chat.messages.slice(previousIndex + 1)
    if (!chatOpen) {
      setUnreadMessages((current) => current + added.filter((message) => !message.isLocal).length)
    }
    lastSeenMessageId.current = chat.messages.at(-1)?.id ?? ''
  }, [chat.messages, chatOpen])

  useEffect(() => {
    const handlePlayback = (playing: boolean) => setAudioBlocked(!playing)
    room.on(RoomEvent.AudioPlaybackStatusChanged, handlePlayback)
    setAudioBlocked(!room.canPlaybackAudio)
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, handlePlayback)
    }
  }, [room])

  const toggleMicrophone = useCallback(async () => {
    if (micBusy || status === 'reconnecting') return
    setMicBusy(true)
    try {
      const enabling = !room.localParticipant.isMicrophoneEnabled
      await room.localParticipant.setMicrophoneEnabled(
        enabling,
        microphoneCaptureOptions(),
      )
      onMicrophoneErrorChange('')
      playCallSound(enabling ? 'unmute' : 'mute')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        onMicrophoneErrorChange(
          window.fordKallDesktop?.platform === 'win32'
            ? 'Permissão do microfone negada. Libere o acesso no Windows e tente novamente.'
            : 'Permissão do microfone negada. Libere o acesso no navegador.',
        )
      } else {
        onMicrophoneErrorChange('Não foi possível alterar o estado do microfone.')
      }
    } finally {
      setMicBusy(false)
    }
  }, [micBusy, onMicrophoneErrorChange, room, status])

  const toggleCamera = useCallback(async () => {
    if (cameraBusy || status === 'reconnecting') return
    setCameraBusy(true)
    setCameraError('')
    try {
      await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setCameraError('Permissão da câmera negada. Libere o acesso no navegador.')
      } else if (error instanceof DOMException && error.name === 'NotFoundError') {
        setCameraError('Nenhuma câmera foi encontrada neste dispositivo.')
      } else {
        setCameraError('Não foi possível alterar o estado da câmera.')
      }
    } finally {
      setCameraBusy(false)
    }
  }, [cameraBusy, room, status])

  const changeQuality = (nextQuality: StreamQualityId) => {
    setQuality(nextQuality)
    saveStreamQuality(nextQuality)
  }

  const changeCallSounds = (enabled: boolean) => {
    if (!enabled) playCallSound('mute')
    saveCallSoundsEnabled(enabled)
    setCallSoundsEnabled(enabled)
    if (enabled) {
      primeCallSounds()
      playCallSound('unmute')
    }
  }

  const changeGameOverlay = (enabled: boolean) => {
    saveGameOverlayEnabled(enabled)
    setGameOverlayEnabled(enabled)
  }

  const toggleDeafen = useCallback(() => {
    setDeafened((current) => {
      const next = !current
      playCallSound(next ? 'deafen' : 'undeafen')
      return next
    })
  }, [])

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(createRoomInviteUrl(roomCode))
      setCopyState('Link copiado')
      window.setTimeout(() => setCopyState('Copiar link'), 1600)
    } catch {
      setCopyState('Copie pela barra do navegador')
    }
  }

  const enableAudio = async () => {
    try {
      await room.startAudio()
      setAudioBlocked(false)
    } catch {
      setAudioBlocked(true)
    }
  }

  const leaveCall = useCallback(async () => {
    try {
      if (screenShare.isSharing) await screenShare.stop()
    } finally {
      await onLeave()
    }
  }, [onLeave, screenShare])

  const shortcuts = useCallShortcuts({
    microphone: () => void toggleMicrophone(),
    deafen: toggleDeafen,
    camera: () => void toggleCamera(),
    screenShare: () => {
      if (screenShare.isStarting || status === 'reconnecting') return
      void (screenShare.isSharing ? screenShare.stop() : screenShare.start())
    },
    leave: () => void leaveCall(),
  }, !settingsOpen)

  const openParticipantMenu = (participantId: string, point: ContextMenuPoint) => {
    setLayoutMenuPoint(null)
    setParticipantMenu({ participantId, point })
  }

  const changeGalleryLayout = (layout: GalleryLayoutMode) => {
    setGalleryLayout(layout)
    saveGalleryLayout(layout)
  }

  const selectedParticipant = participantMenu
    ? snapshot.participantMedia.find((participant) => participant.id === participantMenu.participantId)
    : undefined
  const selectedVoice = participantMenu
    ? snapshot.remoteVoices.find((voice) => voice.id === participantMenu.participantId)
    : undefined

  const resetOtherGames = (selected: 'ito' | 'kiwi' | 'truco' | 'mind' | 'poker' | 'coup' | 'codenames') => {
    if (selected !== 'ito' && itoGame.state.gameId) void itoGame.reset()
    if (selected !== 'kiwi' && explodingKiwi.state.gameId) void explodingKiwi.reset()
    if (selected !== 'truco' && trucoGame.state.gameId) void trucoGame.reset()
    if (selected !== 'mind' && mindGame.state.gameId) void mindGame.reset()
    if (selected !== 'poker' && pokerGame.state.gameId) void pokerGame.reset()
    if (selected !== 'coup' && coupGame.state.gameId) void coupGame.reset()
    if (selected !== 'codenames' && codenamesGame.state.gameId) void codenamesGame.reset()
  }
  const startGame = (selected: GameKind, start: () => boolean) => {
    if (!gameParticipation.canStart(selected, room.localParticipant.identity)) { gameParticipation.organize(selected); setGameParticipationOpen(true); return false }
    pendingGameStart.current = { kind: selected, start }
    if (!gameParticipation.organize(selected)) { pendingGameStart.current = null; return false }
    // Wait for the shared organizer claim before touching another active game.
    if (gameParticipation.getState().games[selected].organizer === room.localParticipant.identity) {
      pendingGameStart.current = null
      resetOtherGames(selected)
      return start()
    }
    return true
  }
  useEffect(() => {
    const pending = pendingGameStart.current
    if (!pending) return
    if (gameParticipation.error) { pendingGameStart.current = null; setGameParticipationOpen(true); return }
    if (gameParticipation.state.games[pending.kind].organizer !== room.localParticipant.identity) return
    pendingGameStart.current = null
    resetOtherGames(pending.kind)
    pending.start()
  }, [gameParticipation.state.revision, gameParticipation.error])
  const selectedGameState = gameMode === 'hub' || gameMode === 'excalitower' ? null : { ito: itoGame.state, kiwi: explodingKiwi.state, truco: trucoGame.state, mind: mindGame.state, poker: pokerGame.state, coup: coupGame.state, codenames: codenamesGame.state }[gameMode]
  const gameParticipationUi = gameMode === 'hub' || gameMode === 'excalitower' ? null : {
    kind: gameMode,
    participating: gameParticipation.allowed(gameMode, room.localParticipant.identity),
    count: gameParticipation.members(gameMode).length,
    canStart: gameParticipation.canStart(gameMode, room.localParticipant.identity),
    members: snapshot.participantMedia.filter((person) => gameParticipation.allowed(gameMode, person.id)),
    open: () => setGameParticipationOpen(true),
  }

  return (
    <main className={`call-shell ${chatOpen || musicOpen ? 'call-shell--chat-open' : ''} ${musicOpen ? 'call-shell--music-open' : ''} ${gamesOpen ? 'call-shell--games-open' : ''}`}>
      <header className="call-header">
        <button
          aria-label="Voltar para a comunidade sem sair da call"
          className="brand brand--compact call-home-button"
          onClick={onNavigateHome}
          title="Voltar para a comunidade"
          type="button"
        >
          <BrandMark />
          <h1>FORD KALL</h1>
        </button>

        <div className="room-plate">
          <strong>{roomCode}</strong>
          <button
            aria-label="Copiar link de convite"
            onClick={() => void copyRoomCode()}
            title={copyState}
            type="button"
          >
            <Icon name="copy" />
          </button>
          <output
            aria-live="polite"
            className={`room-copy-feedback ${copyState !== 'Copiar link' ? 'is-visible' : ''}`}
          >
            {copyState}
          </output>
        </div>

        <div className="call-header__actions">
          <button
            aria-label={`Layout da galeria: ${galleryLayout === 'cinema' ? 'Priorizar 16:9' : 'Preencher'}`}
            className={`participants-toggle layout-toggle ${layoutMenuPoint ? 'is-active' : ''}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setParticipantMenu(null)
              setChatOpen(false)
              setMusicOpen(false)
              setGamesOpen(false)
              setParticipantsOpen(false)
              setLayoutMenuPoint((current) => current ? null : { x: rect.right - 310, y: rect.bottom + 8 })
            }}
            title="Layout da galeria"
            type="button"
          >
            <Icon name="layout" />
          </button>
          <button
            aria-label={`Abrir participantes, ${snapshot.participants.length} na call`}
            className="participants-toggle"
            onClick={() => {
              setLayoutMenuPoint(null)
              setChatOpen(false)
              setMusicOpen(false)
              setGamesOpen(false)
              setParticipantsOpen(true)
            }}
            type="button"
          >
            <Icon name="users" />
            <span>{snapshot.participants.length}</span>
          </button>
          <button
            aria-label={`Abrir player da sala${music.state.queue.length ? `, ${music.state.queue.length} na fila` : ''}`}
            className={`participants-toggle music-toggle ${musicOpen ? 'is-active' : ''} ${music.state.status === 'playing' ? 'is-playing' : ''}`}
            onClick={() => {
              setLayoutMenuPoint(null)
              setParticipantsOpen(false)
              setChatOpen(false)
              setGamesOpen(false)
              setMusicOpen((current) => !current)
            }}
            title="Player da sala"
            type="button"
          >
            <Icon name="music" />
            {music.state.queue.length > 0 && <span>{Math.min(music.state.queue.length, 99)}</span>}
          </button>
          <button
            aria-label={`${gamesOpen ? 'Fechar jogos' : 'Abrir central de jogos'}`}
            className={`participants-toggle games-toggle ${gamesOpen ? 'is-active' : ''} ${itoGame.state.gameId || explodingKiwi.state.gameId || trucoGame.state.gameId || mindGame.state.gameId || pokerGame.state.gameId || coupGame.state.gameId || codenamesGame.state.gameId ? 'has-game' : ''}`}
            onClick={() => {
              setLayoutMenuPoint(null)
              setParticipantsOpen(false)
              setChatOpen(false)
              setMusicOpen(false)
              if (gamesOpen) {
                setGamesOpen(false)
              } else {
                setGameMode('hub')
                setGamesOpen(true)
              }
            }}
            title="Central de jogos"
            type="button"
          >
            <Icon name="gamepad" />
          </button>
          <button
            aria-label={`Abrir chat${unreadMessages ? `, ${unreadMessages} novas mensagens` : ''}`}
            className={`participants-toggle chat-toggle ${chatOpen ? 'is-active' : ''}`}
            onClick={() => {
              setLayoutMenuPoint(null)
              setParticipantsOpen(false)
              setMusicOpen(false)
              setGamesOpen(false)
              setChatOpen((current) => !current)
              setUnreadMessages(0)
            }}
            type="button"
          >
            <Icon name="chat" />
            {unreadMessages > 0 && <span>{Math.min(unreadMessages, 99)}</span>}
          </button>
          <div className={`connection-pill connection-pill--${status}`} title={connectionLabel[status]}>
            <i /> <span>{connectionLabel[status]}</span>
          </div>
        </div>
      </header>

      {audioBlocked && (
        <button className="audio-gate" onClick={() => void enableAudio()} type="button">
          <Icon name="audio" />
          <span><strong>Clique para ativar o áudio da call</strong>O navegador bloqueou a reprodução automática.</span>
          <Icon name="chevron" />
        </button>
      )}

      {status === 'reconnecting' && (
        <div className="reconnect-banner" role="status">
          <span className="spinner" /> Sinal instável. Tentando reconectar sem sair da sala…
        </div>
      )}

      <GameParticipationContext.Provider value={gameParticipationUi}>
      <div className="call-workspace">
        {gamesOpen ? (
          gameMode === 'hub' ? (
            <RoomGamesHub
              itoActive={Boolean(itoGame.state.gameId)}
              itoPlayers={itoGame.state.players.length}
              kiwiActive={Boolean(explodingKiwi.state.gameId)}
              kiwiPlayers={explodingKiwi.state.players.filter((player) => player.alive).length}
              trucoActive={Boolean(trucoGame.state.gameId)}
              trucoPlayers={trucoGame.state.players.length}
              mindActive={Boolean(mindGame.state.gameId)}
              mindPlayers={mindGame.state.players.length}
              pokerActive={Boolean(pokerGame.state.gameId)}
              pokerPlayers={pokerGame.state.players.length}
              coupActive={Boolean(coupGame.state.gameId)}
              coupPlayers={coupGame.state.players.filter((p) => p.influence).length}
              codenamesActive={Boolean(codenamesGame.state.gameId)}
              codenamesPlayers={codenamesGame.state.players.filter((p) => p.team).length}
              excalitowerActive={whiteboard.view.count > 0}
              excalitowerPeople={whiteboard.view.people}
              onSelectExcalitower={() => setGameMode('excalitower')}
              onExit={() => setGamesOpen(false)}
              onSelectIto={() => setGameMode('ito')}
              onSelectKiwi={() => setGameMode('kiwi')}
              onSelectTruco={() => setGameMode('truco')}
              onSelectMind={() => setGameMode('mind')}
              onSelectPoker={() => setGameMode('poker')}
              onSelectCoup={() => setGameMode('coup')}
              onSelectCodenames={() => setGameMode('codenames')}
            />
          ) : gameMode === 'excalitower' ? (
            <ExcalitowerBoundary onExit={() => setGamesOpen(false)}>
              <Suspense fallback={<div className="excalitower-loading" role="status"><span className="spinner" />Abrindo Excalitower…</div>}>
                <ExcalitowerStage session={whiteboard.session} names={whiteboardNames} active={active} onExit={() => setGamesOpen(false)} onOpenHub={() => setGameMode('hub')} />
              </Suspense>
            </ExcalitowerBoundary>
          ) : gameMode === 'codenames' ? (
            <CodenamesStage
              game={{ ...codenamesGame, start: (...args) => startGame('codenames', () => codenamesGame.start(...args)) }}
              onExit={() => setGamesOpen(false)}
              onOpenGameHub={() => setGameMode('hub')}
              participants={snapshot.participantMedia}
            />
          ) : gameMode === 'coup' ? (
            <CoupStage
              game={{ ...coupGame, start: (...args) => startGame('coup', () => coupGame.start(...args)) }}
              onExit={() => setGamesOpen(false)}
              onOpenGameHub={() => setGameMode('hub')}
              participants={snapshot.participantMedia}
            />
          ) : gameMode === 'poker' ? (
            <PokerStage
              game={{ ...pokerGame, start: (...args) => startGame('poker', () => pokerGame.start(...args)) }}
              onExit={() => setGamesOpen(false)}
              onOpenGameHub={() => setGameMode('hub')}
              participants={snapshot.participantMedia}
            />
          ) : gameMode === 'kiwi' ? (
            <ExplodingKiwiStage
              game={{ ...explodingKiwi, start: (...args) => startGame('kiwi', () => explodingKiwi.start(...args)) }}
              onExit={() => setGamesOpen(false)}
              onOpenGameHub={() => setGameMode('hub')}
              participants={snapshot.participantMedia}
            />
          ) : gameMode === 'truco' ? (
            <TrucoMineiroStage
              game={{ ...trucoGame, start: () => startGame('truco', () => trucoGame.start()) }}
              onExit={() => setGamesOpen(false)}
              onOpenGameHub={() => setGameMode('hub')}
              participants={snapshot.participantMedia}
            />
          ) : gameMode === 'mind' ? (
            <TheMindStage
              game={{ ...mindGame, start: () => startGame('mind', () => mindGame.start()) }}
              onExit={() => setGamesOpen(false)}
              onOpenGameHub={() => setGameMode('hub')}
              participants={snapshot.participantMedia}
            />
          ) : (
            <ItoGameStage
              game={{ ...itoGame, start: (...args) => startGame('ito', () => itoGame.start(...args)) }}
              onExit={() => setGamesOpen(false)}
              onOpenGameHub={() => setGameMode('hub')}
              participants={snapshot.participantMedia}
            />
          )
        ) : (
          <ScreenShareStage
            activeSpeakerIds={snapshot.activeSpeakerIds}
            deafened={deafened}
            galleryLayout={galleryLayout}
            lives={snapshot.lives}
            onParticipantMenu={openParticipantMenu}
            participants={snapshot.participantMedia}
            screenOutputId={devices.preferences.screenOutputId}
          />
        )}
      </div>

      {gamesOpen && gameParticipationOpen && gameParticipationUi && selectedGameState && <GameParticipationPanel
        active={Boolean(selectedGameState.gameId)} activeIds={selectedGameState.players.map((player) => player.identity)} kind={gameParticipationUi.kind}
        onClose={() => setGameParticipationOpen(false)} participants={snapshot.participantMedia} participation={gameParticipation}
      />}
      </GameParticipationContext.Provider>

      {participantsOpen && (
        <button
          aria-label="Fechar participantes"
          className="participant-drawer-backdrop"
          onClick={() => setParticipantsOpen(false)}
          type="button"
        />
      )}
      <ParticipantList
        activeSpeakerIds={snapshot.activeSpeakerIds}
        onClose={() => setParticipantsOpen(false)}
        onParticipantMenu={openParticipantMenu}
        open={participantsOpen}
        participants={snapshot.participants}
        remoteVoices={snapshot.remoteVoices}
        room={room}
      />

      <ParticipantAudioLayer
        deafened={deafened}
        outputDeviceId={devices.preferences.voiceOutputId}
        voices={snapshot.remoteVoices}
      />

      {layoutMenuPoint && (
        <GalleryLayoutMenu
          layout={galleryLayout}
          onChange={changeGalleryLayout}
          onClose={() => setLayoutMenuPoint(null)}
          point={layoutMenuPoint}
        />
      )}

      {selectedParticipant && participantMenu && (
        <ParticipantContextMenu
          onClose={() => setParticipantMenu(null)}
          onDisconnect={accountRole === 'owner' && !selectedParticipant.isLocal ? () => {
            const target = room.remoteParticipants.get(selectedParticipant.id)
            if (target?.sid) setDisconnectTarget({ identity: target.identity, sid: target.sid, name: selectedParticipant.name })
            else setModerationNotice('Essa pessoa já saiu da call.')
            setParticipantMenu(null)
          } : undefined}
          participant={selectedParticipant}
          point={participantMenu.point}
          voice={selectedVoice}
        />
      )}

      {disconnectTarget && accountRole === 'owner' && active && (
        <ParticipantDisconnectDialog
          name={disconnectTarget.name}
          connected={room.remoteParticipants.get(disconnectTarget.identity)?.sid === disconnectTarget.sid}
          onClose={() => setDisconnectTarget(null)}
          onConfirm={async () => {
            await disconnectCallParticipant(roomCode, disconnectTarget.identity, disconnectTarget.sid)
            setDisconnectTarget(null)
            setModerationNotice(`${disconnectTarget.name} foi desconectado da call.`)
          }}
        />
      )}

      <ChatPanel
        error={chat.error}
        messages={chat.messages}
        onClose={() => setChatOpen(false)}
        onErrorClose={chat.clearError}
        onSendImage={chat.sendImage}
        onSendText={chat.sendText}
        open={chatOpen}
      />

      {createPortal(
        <MusicPanel
          music={music}
          deafened={deafened}
          onClose={() => setMusicOpen(false)}
          onOpen={() => {
            onNavigateCall?.()
            setMusicOpen(true)
          }}
          open={musicOpen && active}
        />,
        document.body,
      )}

      <div className="call-notices" aria-live="polite">
        {moderationNotice && <Notice onClose={() => setModerationNotice('')}>{moderationNotice}</Notice>}
        {microphoneError && (
          <Notice
            actionLabel={
              window.fordKallDesktop?.platform === 'win32' &&
              microphoneError.includes('Permissão')
                ? 'Abrir permissões'
                : undefined
            }
            onAction={
              microphoneError.includes('Permissão')
                ? window.fordKallDesktop?.openMicrophoneSettings
                : undefined
            }
            onClose={() => onMicrophoneErrorChange('')}
            warning
          >
            {microphoneError}
          </Notice>
        )}
        {cameraError && (
          <Notice onClose={() => setCameraError('')} warning>{cameraError}</Notice>
        )}
        {microphoneProcessing.error && (
          <Notice onClose={microphoneProcessing.clearError} warning>{microphoneProcessing.error}</Notice>
        )}
        {microphoneMonitor.error && (
          <Notice onClose={microphoneMonitor.clearError} warning>{microphoneMonitor.error}</Notice>
        )}
        {screenShare.error && (
          <Notice onClose={screenShare.clearError} warning>{screenShare.error}</Notice>
        )}
      </div>

      <footer className="call-dock">
        <div className="call-dock__group">
          <ControlButton
            detail={micBusy ? 'Aguarde' : microphoneStarting && !micEnabled ? 'Iniciando' : micEnabled ? 'Transmitindo' : 'Silenciado'}
            disabled={micBusy || status === 'reconnecting'}
            error={Boolean(microphoneError)}
            icon={micEnabled ? 'mic' : 'micOff'}
            label="Microfone"
            muted={!micEnabled}
            onClick={() => void toggleMicrophone()}
          />
          <ControlButton
            detail={cameraBusy ? 'Aguarde' : cameraEnabled ? 'Câmera ligada' : 'Câmera desligada'}
            disabled={cameraBusy || status === 'reconnecting'}
            error={Boolean(cameraError)}
            icon={cameraEnabled ? 'camera' : 'cameraOff'}
            label="Câmera"
            muted={!cameraEnabled}
            onClick={() => void toggleCamera()}
          />
          <ControlButton
            detail={deafened ? 'Áudio remoto mudo' : 'Áudio remoto ativo'}
            icon={deafened ? 'deafen' : 'headphones'}
            label="Deafen"
            muted={deafened}
            onClick={toggleDeafen}
          />
        </div>

        <div className="call-dock__group call-dock__group--center">
          <ControlButton
            active={screenShare.isSharing}
            detail={
              screenShare.isStarting
                ? 'Aguarde'
                : screenShare.isSharing
                  ? 'Transmitindo agora'
                  : screenShare.isSupported
                    ? streamQualityPresets[quality].label
                    : 'Indisponível neste navegador'
            }
            disabled={screenShare.isStarting || status === 'reconnecting'}
            icon="screen"
            label={screenShare.isSharing ? 'Parar transmissão' : 'Compartilhar tela'}
            onClick={() =>
              void (screenShare.isSharing ? screenShare.stop() : screenShare.start())
            }
          />
          <ControlButton
            detail="Áudio e qualidade"
            icon="settings"
            label="Configurações"
            onClick={() => setSettingsOpen(true)}
          />
        </div>

        <div className="call-dock__group call-dock__group--end">
          <ControlButton
            danger
            detail="Encerrar conexão"
            icon="leave"
            label="Sair da call"
            onClick={() => void leaveCall()}
          />
        </div>
      </footer>

      {settingsOpen && (
        <SettingsModal
          callSoundsEnabled={callSoundsEnabled}
          devices={devices}
          gameOverlayEnabled={gameOverlayEnabled}
          microphoneMonitor={microphoneMonitor}
          microphoneProcessing={microphoneProcessing}
          onCallSoundsChange={changeCallSounds}
          onClose={() => setSettingsOpen(false)}
          onGameOverlayChange={changeGameOverlay}
          onQualityChange={changeQuality}
          quality={quality}
          shortcuts={shortcuts}
          updater={updater}
        />
      )}
    </main>
  )
}
