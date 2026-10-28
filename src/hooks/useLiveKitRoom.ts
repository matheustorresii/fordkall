import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Room,
} from 'livekit-client'
import {
  createLiveKitRoom,
  fetchConnectionDetails,
  friendlyConnectionError,
  friendlyMicrophoneError,
  reportLiveKitConnection,
} from '../services/livekit'
import { saveLocalProfile } from '../storage/preferences'
import type { ConnectionStatus, LocalProfile } from '../types'
import { microphoneCaptureOptions } from '../services/microphoneCapture'
import { startRoomHeartbeat } from '../services/roomHeartbeat'
import { supabase } from '../services/supabase'

const toConnectionStatus = (state: ConnectionState): ConnectionStatus => {
  if (state === ConnectionState.Connecting) return 'connecting'
  if (
    state === ConnectionState.Reconnecting ||
    state === ConnectionState.SignalReconnecting
  ) {
    return 'reconnecting'
  }
  if (state === ConnectionState.Connected) return 'connected'
  return 'disconnected'
}

const stopRoomLocalTracks = (room: Room) => {
  room.localParticipant.trackPublications.forEach((publication) => {
    publication.track?.detach()
    publication.track?.stop()
    publication.track?.mediaStreamTrack.stop()
  })
}

export const useLiveKitRoom = () => {
  const [room, setRoom] = useState<Room | null>(null)
  const [activeRoomCode, setActiveRoomCode] = useState('')
  const [privateRoom, setPrivateRoom] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState('')
  const [microphoneError, setMicrophoneError] = useState('')
  const [microphoneStarting, setMicrophoneStarting] = useState(false)
  const roomRef = useRef<Room | null>(null)
  const leavingRef = useRef(false)
  const microphoneRequestRef = useRef(0)
  const heartbeatRef = useRef<ReturnType<typeof startRoomHeartbeat> | null>(
    null,
  )

  const leave = useCallback(async () => {
    const activeRoom = roomRef.current
    heartbeatRef.current?.stop()
    heartbeatRef.current = null
    microphoneRequestRef.current += 1
    leavingRef.current = true
    roomRef.current = null
    setRoom(null)
    setActiveRoomCode('')
    setStatus('disconnected')
    setError('')
    setMicrophoneError('')
    setMicrophoneStarting(false)

    if (activeRoom) {
      stopRoomLocalTracks(activeRoom)
      activeRoom.removeAllListeners()
      await activeRoom.disconnect(true)
      stopRoomLocalTracks(activeRoom)
    }

    leavingRef.current = false
  }, [])

  const join = useCallback(
    async (
      roomCode: string,
      profile: LocalProfile,
      requestedPrivate = false,
    ) => {
      setError('')
      setMicrophoneError('')
      setStatus('connecting')
      leavingRef.current = false

      let lastConnectionFailure: unknown = null
      const failedBackendIds: string[] = []
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const nextRoom = createLiveKitRoom()
        roomRef.current = nextRoom
        let connectionAccepted = false
        const handleConnectionState = (state: ConnectionState) => {
          setStatus(toConnectionStatus(state))
        }
        const handleDisconnected = (reason?: DisconnectReason) => {
          if (!connectionAccepted || roomRef.current !== nextRoom) return
          heartbeatRef.current?.stop()
          heartbeatRef.current = null
          microphoneRequestRef.current += 1
          stopRoomLocalTracks(nextRoom)
          setMicrophoneStarting(false)
          setMicrophoneError('')
          if (!leavingRef.current) {
            setError(
              reason === DisconnectReason.PARTICIPANT_REMOVED
                ? 'Você foi desconectado desta call pelo owner.'
                : 'A conexão com a call foi encerrada. Entre novamente para continuar.',
            )
          }
          if (roomRef.current === nextRoom) {
            roomRef.current = null
            setRoom(null)
            setActiveRoomCode('')
          }
          setStatus('disconnected')
        }

        nextRoom.on(RoomEvent.ConnectionStateChanged, handleConnectionState)
        nextRoom.on(RoomEvent.Disconnected, handleDisconnected)

        let connectionDetails: Awaited<
          ReturnType<typeof fetchConnectionDetails>
        > | null = null
        try {
          connectionDetails = await fetchConnectionDetails(
            roomCode,
            profile,
            requestedPrivate,
            failedBackendIds,
          )
          await nextRoom.connect(
            connectionDetails.serverUrl,
            connectionDetails.participantToken,
          )
          connectionAccepted = true
          const sessionId = connectionDetails.connectionAttemptId
          heartbeatRef.current?.stop()
          const heartbeat = startRoomHeartbeat({
            window,
            document,
            connected: () => nextRoom.state === ConnectionState.Connected,
            send: async (leave) => {
              const { error } = await supabase.rpc('touch_call_room', {
                p_room_code: roomCode,
                p_leave: leave,
                p_session_id: sessionId,
              })
              if (error) throw error
            },
          })
          heartbeatRef.current = heartbeat
          nextRoom.on(RoomEvent.Reconnected, () => {
            void heartbeat.refresh()
          })
          void reportLiveKitConnection(roomCode, connectionDetails, true)
            .then(() => heartbeat.refresh())
            .catch(() => undefined)
          saveLocalProfile(profile)
          setRoom(nextRoom)
          setActiveRoomCode(roomCode)
          setPrivateRoom(connectionDetails.privateRoom === true)
          setStatus('connected')

          // Microphone permission belongs to the call controls, not to the room
          // connection. Keeping it detached prevents a native browser prompt from
          // leaving the lobby locked even though LiveKit is already connected.
          const microphoneRequest = ++microphoneRequestRef.current
          setMicrophoneStarting(true)
          const handleInitialMicrophonePublished = (
            publication: LocalTrackPublication,
          ) => {
            if (publication.source !== Track.Source.Microphone) return
            nextRoom.off(
              RoomEvent.LocalTrackPublished,
              handleInitialMicrophonePublished,
            )
            if (
              microphoneRequestRef.current === microphoneRequest &&
              roomRef.current === nextRoom
            ) {
              setMicrophoneStarting(false)
              setMicrophoneError('')
            }
          }
          nextRoom.on(
            RoomEvent.LocalTrackPublished,
            handleInitialMicrophonePublished,
          )
          const microphoneTimer = window.setTimeout(() => {
            nextRoom.off(
              RoomEvent.LocalTrackPublished,
              handleInitialMicrophonePublished,
            )
            if (
              microphoneRequestRef.current === microphoneRequest &&
              roomRef.current === nextRoom
            ) {
              setMicrophoneStarting(false)
              setMicrophoneError(
                'A permissão do microfone continua aberta no navegador. Feche o aviso e tente novamente pelo botão da call.',
              )
            }
          }, 12_000)
          void nextRoom.localParticipant
            .setMicrophoneEnabled(true, microphoneCaptureOptions())
            .then((publication) => {
              if (
                microphoneRequestRef.current !== microphoneRequest ||
                roomRef.current !== nextRoom
              ) {
                publication?.track?.detach()
                publication?.track?.stop()
                publication?.track?.mediaStreamTrack.stop()
                stopRoomLocalTracks(nextRoom)
                return
              }
              if (
                microphoneRequestRef.current === microphoneRequest &&
                roomRef.current === nextRoom
              ) {
                setMicrophoneError('')
              }
            })
            .catch((microphoneFailure) => {
              if (
                microphoneRequestRef.current === microphoneRequest &&
                roomRef.current === nextRoom
              ) {
                setMicrophoneError(friendlyMicrophoneError(microphoneFailure))
              }
            })
            .finally(() => {
              window.clearTimeout(microphoneTimer)
              nextRoom.off(
                RoomEvent.LocalTrackPublished,
                handleInitialMicrophonePublished,
              )
              if (
                microphoneRequestRef.current !== microphoneRequest ||
                roomRef.current !== nextRoom
              ) {
                stopRoomLocalTracks(nextRoom)
                return
              }
              if (
                microphoneRequestRef.current === microphoneRequest &&
                roomRef.current === nextRoom
              ) {
                setMicrophoneStarting(false)
              }
            })

          return true
        } catch (connectionFailure) {
          lastConnectionFailure = connectionFailure
          nextRoom.removeAllListeners()
          await nextRoom.disconnect(true)
          if (roomRef.current === nextRoom) {
            roomRef.current = null
            setActiveRoomCode('')
          }
          setRoom(null)

          if (connectionDetails) {
            if (connectionDetails.backendId && !failedBackendIds.includes(connectionDetails.backendId)) failedBackendIds.push(connectionDetails.backendId)
            try {
              const report = await reportLiveKitConnection(
                roomCode,
                connectionDetails,
                false,
                connectionFailure,
                failedBackendIds,
              )
              if (report.errorCode) lastConnectionFailure = new Error(report.errorCode)
              if (report.retry && attempt < 2) {
                setStatus('connecting')
                continue
              }
              if (report.retry) lastConnectionFailure = new Error('LIVEKIT_CLIENT_CONNECTION_FAILED')
            } catch {
              // Keep the original connection error as the user-facing failure.
            }
          }
          break
        }
      }

      setStatus('error')
      setError(friendlyConnectionError(lastConnectionFailure))
      return false
    },
    [],
  )

  useEffect(
    () => () => {
      const activeRoom = roomRef.current
      heartbeatRef.current?.stop()
      heartbeatRef.current = null
      if (activeRoom) {
        microphoneRequestRef.current += 1
        stopRoomLocalTracks(activeRoom)
        activeRoom.removeAllListeners()
        void activeRoom
          .disconnect(true)
          .finally(() => stopRoomLocalTracks(activeRoom))
        roomRef.current = null
      }
    },
    [],
  )

  return {
    room,
    activeRoomCode,
    privateRoom,
    status,
    error,
    microphoneError,
    microphoneStarting,
    setMicrophoneError,
    join,
    leave,
  }
}
