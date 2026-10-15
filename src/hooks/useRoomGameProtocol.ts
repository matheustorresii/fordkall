import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RoomEvent, type RemoteParticipant, type Room } from 'livekit-client'

export interface RoomGameBaseState {
  gameId: string
  controllerIdentity: string
  revision: number
}

export interface RoomGameProtocolContext<TState, TPrivate> {
  state: TState
  commit: (build: (current: TState) => TState) => boolean
  getSecrets: () => Record<string, TPrivate>
  replaceSecrets: (gameId: string, secrets: Record<string, TPrivate>) => void
  setSecret: (gameId: string, identity: string, secret: TPrivate) => void
}

interface RoomGameProtocolOptions<TState extends RoomGameBaseState, TCommand, TPrivate> {
  room: Room
  topic: string
  emptyState: (controllerIdentity: string, revision?: number) => TState
  parseState: (value: unknown) => TState | null
  parseCommand: (value: unknown) => TCommand | null
  parsePrivate: (value: unknown) => TPrivate | null
  emptyPrivate: TPrivate
  strictAuthority?: boolean
  handleCommand: (
    command: TCommand,
    senderIdentity: string,
    context: RoomGameProtocolContext<TState, TPrivate>,
  ) => string | null
}

type RoomGameMessage<TState, TPrivate> =
  | { type: 'hello' | 'request' }
  | { type: 'state'; state: TState }
  | { type: 'command'; commandId: string; command: unknown }
  | { type: 'command-result'; commandId: string; error: string }
  | { type: 'private'; gameId: string; data: TPrivate }
  | { type: 'private-request'; gameId: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const cleanIdentity = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 128) : ''

const roomIdentities = (room: Room) => [room.localParticipant.identity, ...room.remoteParticipants.keys()].filter(Boolean)

export const useRoomGameProtocol = <TState extends RoomGameBaseState, TCommand, TPrivate>({
  room,
  topic,
  emptyState,
  parseState,
  parseCommand,
  parsePrivate,
  emptyPrivate,
  strictAuthority = false,
  handleCommand,
}: RoomGameProtocolOptions<TState, TCommand, TPrivate>) => {
  const [state, setState] = useState<TState>(() => {
    const initialController = roomIdentities(room).sort()[0] || room.localParticipant.identity
    return emptyState(initialController)
  })
  const [localPrivate, setLocalPrivate] = useState<TPrivate>(emptyPrivate)
  const [error, setError] = useState('')
  const [participantRevision, setParticipantRevision] = useState(0)
  const stateRef = useRef(state)
  const privateRef = useRef<{ gameId: string; values: Record<string, TPrivate> }>({ gameId: '', values: {} })
  const pendingRef = useRef(new Map<string, number>())
  const handlerRef = useRef(handleCommand)
  handlerRef.current = handleCommand

  const applyState = useCallback((next: TState) => {
    if (next.gameId !== stateRef.current.gameId) setLocalPrivate(emptyPrivate)
    stateRef.current = next
    setState(next)
  }, [emptyPrivate])

  const publish = useCallback(async (message: RoomGameMessage<TState, TPrivate>, destinationIdentity?: string) => {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(message)), {
      reliable: true,
      topic,
      destinationIdentities: destinationIdentity ? [destinationIdentity] : undefined,
    })
  }, [room, topic])

  const getControllerIdentity = useCallback((candidate = stateRef.current) => {
    const connected = roomIdentities(room)
    if (candidate.gameId && candidate.controllerIdentity && connected.includes(candidate.controllerIdentity)) {
      return candidate.controllerIdentity
    }
    return connected.sort()[0] || room.localParticipant.identity
  }, [room])

  const publishPrivate = useCallback((gameId: string, identity: string, data: TPrivate) => {
    void publish({ type: 'private', gameId, data }, identity).catch(() => undefined)
  }, [publish])

  const getSecrets = useCallback(() => {
    const current = stateRef.current
    return privateRef.current.gameId === current.gameId ? privateRef.current.values : {}
  }, [])

  const setSecret = useCallback((gameId: string, identity: string, secret: TPrivate) => {
    if (privateRef.current.gameId !== gameId) privateRef.current = { gameId, values: {} }
    privateRef.current = {
      gameId,
      values: { ...privateRef.current.values, [identity]: secret },
    }
    if (identity === room.localParticipant.identity) setLocalPrivate(secret)
    publishPrivate(gameId, identity, secret)
  }, [publishPrivate, room])

  const replaceSecrets = useCallback((gameId: string, secrets: Record<string, TPrivate>) => {
    privateRef.current = { gameId, values: secrets }
    setLocalPrivate(secrets[room.localParticipant.identity] ?? emptyPrivate)
    for (const [identity, secret] of Object.entries(secrets)) publishPrivate(gameId, identity, secret)
  }, [emptyPrivate, publishPrivate, room])

  const commit = useCallback((build: (current: TState) => TState) => {
    if (getControllerIdentity() !== room.localParticipant.identity) return false
    const current = stateRef.current
    const next = {
      ...build(current),
      controllerIdentity: room.localParticipant.identity,
      revision: current.revision + 1,
    }
    applyState(next)
    setError('')
    void publish({ type: 'state', state: next }).catch(() => {
      setError('A sala perdeu contato com o jogo. A rodada pode demorar para sincronizar.')
    })
    return true
  }, [applyState, getControllerIdentity, publish, room])

  const sendCurrentState = useCallback((identity: string) => {
    const current = stateRef.current
    void publish({ type: 'state', state: current }, identity).catch(() => undefined)
    const data = privateRef.current.gameId === current.gameId ? privateRef.current.values[identity] : undefined
    if (current.gameId && data !== undefined) publishPrivate(current.gameId, identity, data)
  }, [publish, publishPrivate])

  const context = useMemo<RoomGameProtocolContext<TState, TPrivate>>(() => ({
    get state() { return stateRef.current },
    commit,
    getSecrets,
    replaceSecrets,
    setSecret,
  }), [commit, getSecrets, replaceSecrets, setSecret])

  const performCommand = useCallback((command: TCommand, senderIdentity: string) =>
    handlerRef.current(command, senderIdentity, context),
  [context, commit, getSecrets, replaceSecrets, setSecret])

  const ensureController = useCallback(() => {
    if (getControllerIdentity() !== room.localParticipant.identity) return false
    if (stateRef.current.controllerIdentity === room.localParticipant.identity) return true
    const wasActive = Boolean(stateRef.current.gameId)
    privateRef.current = { gameId: '', values: {} }
    setLocalPrivate(emptyPrivate)
    const next = emptyState(room.localParticipant.identity, stateRef.current.revision + 1)
    applyState(next)
    if (wasActive) setError('Quem iniciou a partida saiu. A rodada foi encerrada.')
    void publish({ type: 'state', state: next }).catch(() => undefined)
    return true
  }, [applyState, emptyPrivate, emptyState, getControllerIdentity, publish, room])

  const dispatch = useCallback((command: TCommand) => {
    setError('')
    const controllerIdentity = getControllerIdentity()
    if (controllerIdentity === room.localParticipant.identity) {
      ensureController()
      const result = performCommand(command, room.localParticipant.identity)
      if (result) setError(result)
      return !result
    }

    const commandId = crypto.randomUUID()
    const timeout = window.setTimeout(() => {
      pendingRef.current.delete(commandId)
      setError('O jogo não respondeu na sala. Tente novamente.')
    }, 5_000)
    pendingRef.current.set(commandId, timeout)
    void publish({ type: 'command', commandId, command }, controllerIdentity).catch(() => {
      window.clearTimeout(timeout)
      pendingRef.current.delete(commandId)
      setError('Não foi possível enviar sua ação para o jogo da sala.')
    })
    return true
  }, [ensureController, getControllerIdentity, performCommand, publish, room])

  useEffect(() => {
    const receive = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, receivedTopic?: string) => {
      if (receivedTopic !== topic || !participant) return
      let message: RoomGameMessage<TState, TPrivate>
      try { message = JSON.parse(decoder.decode(payload)) as RoomGameMessage<TState, TPrivate> } catch { return }

      if (message.type === 'hello' || message.type === 'request') {
        if (ensureController()) sendCurrentState(participant.identity)
        else if (getControllerIdentity() !== room.localParticipant.identity) {
          void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
        }
        return
      }

      if (message.type === 'state') {
        const candidate = parseState(message.state)
        if (!candidate || participant.identity !== candidate.controllerIdentity) return
        const current = stateRef.current
        if (strictAuthority && participant.identity !== getControllerIdentity(current)) return
        if (candidate.controllerIdentity === current.controllerIdentity && candidate.revision <= current.revision) return
        applyState(candidate)
        if (candidate.gameId) void publish({ type: 'private-request', gameId: candidate.gameId }, participant.identity).catch(() => undefined)
        return
      }

      if (message.type === 'private') {
        const current = stateRef.current
        const data = parsePrivate(message.data)
        if (participant.identity !== current.controllerIdentity || message.gameId !== current.gameId || !data) return
        if (privateRef.current.gameId !== current.gameId) privateRef.current = { gameId: current.gameId, values: {} }
        privateRef.current = { gameId: current.gameId, values: { ...privateRef.current.values, [room.localParticipant.identity]: data } }
        setLocalPrivate(data)
        return
      }

      if (message.type === 'private-request') {
        if (ensureController()) sendCurrentState(participant.identity)
        return
      }

      if (message.type === 'command') {
        if (getControllerIdentity() !== room.localParticipant.identity || !ensureController()) return
        const command = parseCommand(message.command)
        const commandId = cleanIdentity(message.commandId)
        if (!command || !commandId) return
        const commandError = performCommand(command, participant.identity)
        void publish({ type: 'command-result', commandId, error: commandError ?? '' }, participant.identity).catch(() => undefined)
        return
      }

      if (message.type === 'command-result') {
        const commandId = cleanIdentity(message.commandId)
        const timeout = pendingRef.current.get(commandId)
        if (timeout === undefined || participant.identity !== getControllerIdentity()) return
        window.clearTimeout(timeout)
        pendingRef.current.delete(commandId)
        setError(typeof message.error === 'string' ? message.error.slice(0, 240) : '')
      }
    }

    const onParticipantConnected = (participant?: RemoteParticipant) => {
      setParticipantRevision((revision) => revision + 1)
      void publish({ type: 'hello' }).catch(() => undefined)
      if (participant && ensureController()) sendCurrentState(participant.identity)
      else if (getControllerIdentity() !== room.localParticipant.identity) {
        void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
      }
    }

    const onParticipantDisconnected = () => {
      setParticipantRevision((revision) => revision + 1)
      ensureController()
    }
    room.on(RoomEvent.DataReceived, receive)
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    void publish({ type: 'hello' }).catch(() => undefined)
    if (getControllerIdentity() !== room.localParticipant.identity) {
      void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
    }

    return () => {
      room.off(RoomEvent.DataReceived, receive)
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    }
  }, [applyState, ensureController, getControllerIdentity, parseCommand, parsePrivate, parseState, publish, room, sendCurrentState, topic, performCommand, strictAuthority])

  useEffect(() => () => {
    for (const timeout of pendingRef.current.values()) window.clearTimeout(timeout)
    pendingRef.current.clear()
  }, [])

  const clearError = useCallback(() => setError(''), [])

  return {
    state,
    localPrivate,
    error,
    participantRevision,
    clearError,
    dispatch,
    isController: getControllerIdentity() === room.localParticipant.identity,
    participantCount: roomIdentities(room).length,
  }
}
