import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type RemoteParticipant, type Room } from 'livekit-client'
import type { RoomMusicQueueItem, RoomMusicState } from '../types'
import type { YouTubeSource } from '../services/youtube'

const MUSIC_TOPIC = 'ford-kall.music.v2'
export const MAX_ROOM_MUSIC_QUEUE = 20
const MAX_POSITION_SECONDS = 86_400
const REQUEST_TIMEOUT_MS = 12_000
const HEARTBEAT_INTERVAL_MS = 1_750
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,100}$/

type MusicCommand =
  | { type: 'add'; source: YouTubeSource }
  | { type: 'toggle'; positionSeconds?: number }
  | { type: 'advance'; expectedItemId?: string }
  | {
      type: 'advance-playlist'
      expectedItemId: string
      expectedPlaylistIndex: number
      nextPlaylistIndex: number
    }
  | { type: 'play-item'; itemId: string }
  | { type: 'remove'; itemId: string }
  | { type: 'clear' }

type MusicWireMessage =
  | { type: 'hello' }
  | { type: 'request' }
  | { type: 'state'; state: RoomMusicState }
  | { type: 'command'; commandId: string; command: MusicCommand }
  | { type: 'command-result'; commandId: string; error?: string }

const emptyState = (): RoomMusicState => ({
  version: 2,
  revision: 0,
  syncSequence: 0,
  controllerIdentity: '',
  queue: [],
  currentIndex: -1,
  playlistIndex: 0,
  playing: false,
  positionSeconds: 0,
  updatedAt: Date.now(),
})

const cleanText = (value: unknown, maximum: number) =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : ''

const parseSource = (value: unknown): YouTubeSource | null => {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<YouTubeSource>
  if (source.kind !== 'video' && source.kind !== 'playlist') return null
  const sourceId = cleanText(source.sourceId, 100)
  if (source.kind === 'video' && !VIDEO_ID.test(sourceId)) return null
  if (source.kind === 'playlist' && !PLAYLIST_ID.test(sourceId)) return null
  return {
    kind: source.kind,
    sourceId,
    url: source.kind === 'playlist'
      ? `https://www.youtube.com/playlist?list=${sourceId}`
      : `https://www.youtube.com/watch?v=${sourceId}`,
    label: cleanText(source.label, 160) || (source.kind === 'playlist' ? 'Playlist do YouTube' : 'Vídeo do YouTube'),
  }
}

const parseQueueItem = (value: unknown): RoomMusicQueueItem | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<RoomMusicQueueItem>
  const source = parseSource(item)
  const id = cleanText(item.id, 64)
  if (!source || !id) return null
  return {
    ...source,
    id,
    addedBy: cleanText(item.addedBy, 128),
    addedAt: typeof item.addedAt === 'number' && Number.isFinite(item.addedAt)
      ? item.addedAt
      : Date.now(),
  }
}

const parseState = (value: unknown): RoomMusicState | null => {
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<RoomMusicState>
  if (state.version !== 2 || !Array.isArray(state.queue) || state.queue.length > MAX_ROOM_MUSIC_QUEUE) {
    return null
  }
  const queue = state.queue.map(parseQueueItem)
  if (queue.some((item) => !item)) return null
  const currentIndex = Number.isInteger(state.currentIndex) ? Number(state.currentIndex) : -1
  if (currentIndex < -1 || currentIndex >= queue.length) return null
  return {
    version: 2,
    revision: Number.isSafeInteger(state.revision) && Number(state.revision) >= 0
      ? Number(state.revision)
      : 0,
    syncSequence: Number.isSafeInteger(state.syncSequence) && Number(state.syncSequence) >= 0
      ? Number(state.syncSequence)
      : 0,
    controllerIdentity: cleanText(state.controllerIdentity, 128),
    queue: queue as RoomMusicQueueItem[],
    currentIndex,
    playlistIndex: Number.isInteger(state.playlistIndex)
      ? Math.min(10_000, Math.max(0, Number(state.playlistIndex)))
      : 0,
    playing: state.playing === true && currentIndex >= 0,
    positionSeconds: typeof state.positionSeconds === 'number' && Number.isFinite(state.positionSeconds)
      ? Math.min(MAX_POSITION_SECONDS, Math.max(0, state.positionSeconds))
      : 0,
    updatedAt: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt)
      ? state.updatedAt
      : Date.now(),
  }
}

const parseCommand = (value: unknown): MusicCommand | null => {
  if (!value || typeof value !== 'object') return null
  const command = value as Record<string, unknown>
  switch (command.type) {
    case 'add': {
      const source = parseSource(command.source)
      return source ? { type: 'add', source } : null
    }
    case 'toggle':
      return {
        type: 'toggle',
        positionSeconds: typeof command.positionSeconds === 'number' && Number.isFinite(command.positionSeconds)
          ? Math.min(MAX_POSITION_SECONDS, Math.max(0, command.positionSeconds))
          : undefined,
      }
    case 'advance':
      return {
        type: 'advance',
        expectedItemId: cleanText(command.expectedItemId, 64) || undefined,
      }
    case 'advance-playlist': {
      const expectedItemId = cleanText(command.expectedItemId, 64)
      const expectedPlaylistIndex = command.expectedPlaylistIndex
      const nextPlaylistIndex = command.nextPlaylistIndex
      if (
        !expectedItemId ||
        typeof expectedPlaylistIndex !== 'number' ||
        expectedPlaylistIndex < 0 ||
        typeof nextPlaylistIndex !== 'number' ||
        !Number.isInteger(expectedPlaylistIndex) ||
        !Number.isInteger(nextPlaylistIndex) ||
        nextPlaylistIndex <= expectedPlaylistIndex ||
        nextPlaylistIndex > 10_000
      ) return null
      return {
        type: 'advance-playlist',
        expectedItemId,
        expectedPlaylistIndex,
        nextPlaylistIndex,
      }
    }
    case 'play-item':
      return cleanText(command.itemId, 64)
        ? { type: 'play-item', itemId: cleanText(command.itemId, 64) }
        : null
    case 'remove':
      return cleanText(command.itemId, 64)
        ? { type: 'remove', itemId: cleanText(command.itemId, 64) }
        : null
    case 'clear':
      return { type: 'clear' }
    default:
      return null
  }
}

const isNewerState = (candidate: RoomMusicState, current: RoomMusicState) => {
  if (candidate.revision !== current.revision) return candidate.revision > current.revision
  if (candidate.syncSequence !== current.syncSequence) {
    return candidate.syncSequence > current.syncSequence
  }
  return candidate.controllerIdentity > current.controllerIdentity
}

/**
 * `updatedAt` is normalized to the receiving device's clock when a state
 * packet arrives. Position therefore advances using a local monotonic-enough
 * reference rather than comparing wall clocks from different computers.
 */
export const roomMusicPosition = (state: RoomMusicState) =>
  Math.min(
    MAX_POSITION_SECONDS,
    Math.max(
      0,
      state.positionSeconds + (state.playing ? Math.max(0, Date.now() - state.updatedAt) / 1_000 : 0),
    ),
  )

export const useRoomMusic = (room: Room) => {
  const [state, setState] = useState<RoomMusicState>(emptyState)
  const [error, setError] = useState('')
  const [, setPeerCapabilityRevision] = useState(0)
  const stateRef = useRef(state)
  const supportedPeersRef = useRef(new Set<string>())
  const pendingCommandsRef = useRef(new Map<string, number>())
  const handledCommandsRef = useRef(new Map<string, string>())
  const lastHeartbeatAtRef = useRef(0)

  const applyState = useCallback((next: RoomMusicState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const markPeerSupported = useCallback((identity: string) => {
    if (!identity || supportedPeersRef.current.has(identity)) return
    supportedPeersRef.current.add(identity)
    setPeerCapabilityRevision((revision) => revision + 1)
  }, [])

  const publish = useCallback(async (
    message: MusicWireMessage,
    destinationIdentity?: string,
  ) => {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(message)), {
      reliable: true,
      topic: MUSIC_TOPIC,
      destinationIdentities: destinationIdentity ? [destinationIdentity] : undefined,
    })
  }, [room])

  const getControllerIdentity = useCallback((candidate = stateRef.current) => {
    const localIdentity = room.localParticipant.identity
    const connected = [...new Set([
      localIdentity,
      ...[...room.remoteParticipants.keys()].filter((identity) => supportedPeersRef.current.has(identity)),
    ].filter(Boolean))].sort()
    if (
      candidate.controllerIdentity &&
      connected.includes(candidate.controllerIdentity) &&
      (candidate.controllerIdentity === localIdentity || supportedPeersRef.current.has(candidate.controllerIdentity))
    ) {
      return candidate.controllerIdentity
    }
    return connected[0] || localIdentity
  }, [room])

  const nextRevision = useCallback(() => ({
    revision: stateRef.current.revision + 1,
    syncSequence: 0,
    controllerIdentity: room.localParticipant.identity,
    updatedAt: Date.now(),
  }), [room])

  const commit = useCallback((build: (current: RoomMusicState) => RoomMusicState) => {
    const current = stateRef.current
    if (getControllerIdentity(current) !== room.localParticipant.identity) return false
    const built = build(current)
    if (built === current) return false
    const next = { ...built, ...nextRevision() }
    applyState(next)
    setError('')
    void publish({ type: 'state', state: next }).catch(() => {
      setError('A sala perdeu contato com o player. As alterações podem demorar a sincronizar.')
    })
    return true
  }, [applyState, getControllerIdentity, nextRevision, publish, room])

  const performCommand = useCallback((command: MusicCommand, senderName: string) => {
    const current = stateRef.current
    switch (command.type) {
      case 'add': {
        if (current.queue.length >= MAX_ROOM_MUSIC_QUEUE) {
          return `A fila aceita até ${MAX_ROOM_MUSIC_QUEUE} itens.`
        }
        const queue = [...current.queue, {
          ...command.source,
          id: crypto.randomUUID(),
          addedBy: cleanText(senderName, 128),
          addedAt: Date.now(),
        }]
        const wasEmpty = current.currentIndex < 0
        commit((latest) => ({
          ...latest,
          queue,
          currentIndex: wasEmpty ? 0 : latest.currentIndex,
          playlistIndex: wasEmpty ? 0 : latest.playlistIndex,
          positionSeconds: wasEmpty ? 0 : roomMusicPosition(latest),
          playing: wasEmpty ? true : latest.playing,
        }))
        return null
      }
      case 'toggle':
        if (current.currentIndex < 0) return 'Adicione algo à fila antes de iniciar a reprodução.'
        commit((latest) => ({
          ...latest,
          playing: !latest.playing,
          positionSeconds: command.positionSeconds ?? roomMusicPosition(latest),
        }))
        return null
      case 'advance': {
        const item = current.queue[current.currentIndex]
        if (!item || (command.expectedItemId && item.id !== command.expectedItemId)) return null
        const nextIndex = current.currentIndex + 1
        const hasNext = nextIndex < current.queue.length
        commit((latest) => ({
          ...latest,
          currentIndex: hasNext ? nextIndex : latest.currentIndex,
          playlistIndex: 0,
          positionSeconds: 0,
          playing: hasNext,
        }))
        return null
      }
      case 'advance-playlist': {
        const item = current.queue[current.currentIndex]
        if (
          !item ||
          item.kind !== 'playlist' ||
          item.id !== command.expectedItemId ||
          current.playlistIndex !== command.expectedPlaylistIndex
        ) return null
        commit((latest) => ({
          ...latest,
          playlistIndex: command.nextPlaylistIndex,
          positionSeconds: 0,
          playing: true,
        }))
        return null
      }
      case 'play-item': {
        const currentIndex = current.queue.findIndex((item) => item.id === command.itemId)
        if (currentIndex < 0) return null
        commit((latest) => ({
          ...latest,
          currentIndex,
          playlistIndex: 0,
          positionSeconds: 0,
          playing: true,
        }))
        return null
      }
      case 'remove': {
        const removedIndex = current.queue.findIndex((item) => item.id === command.itemId)
        if (removedIndex < 0) return null
        const queue = current.queue.filter((item) => item.id !== command.itemId)
        if (!queue.length) {
          commit(() => ({ ...emptyState() }))
          return null
        }
        const removedCurrent = removedIndex === current.currentIndex
        const currentIndex = removedIndex < current.currentIndex
          ? current.currentIndex - 1
          : Math.min(current.currentIndex, queue.length - 1)
        commit((latest) => ({
          ...latest,
          queue,
          currentIndex,
          playlistIndex: removedCurrent ? 0 : latest.playlistIndex,
          positionSeconds: removedCurrent ? 0 : roomMusicPosition(latest),
          playing: removedCurrent ? true : latest.playing,
        }))
        return null
      }
      case 'clear':
        commit(() => ({ ...emptyState() }))
        return null
    }
  }, [commit])

  const ensureController = useCallback(() => {
    const current = stateRef.current
    const localIdentity = room.localParticipant.identity
    if (getControllerIdentity(current) !== localIdentity) return false
    if (current.controllerIdentity === localIdentity) return true
    const next = {
      ...current,
      ...nextRevision(),
      positionSeconds: roomMusicPosition(current),
    }
    applyState(next)
    void publish({ type: 'state', state: next }).catch(() => {
      setError('Não foi possível escolher o controlador da música nesta sala.')
    })
    return true
  }, [applyState, getControllerIdentity, nextRevision, publish, room])

  const dispatchCommand = useCallback((command: MusicCommand) => {
    setError('')
    const localIdentity = room.localParticipant.identity
    const controllerIdentity = getControllerIdentity(stateRef.current)
    if (!controllerIdentity) {
      setError('A sala ainda não está pronta para controlar a música.')
      return false
    }
    if (controllerIdentity === localIdentity) {
      ensureController()
      const localName = room.localParticipant.name || localIdentity
      const commandError = performCommand(command, localName)
      if (commandError) {
        setError(commandError)
        return false
      }
      return true
    }

    const commandId = crypto.randomUUID()
    const timeout = window.setTimeout(() => {
      pendingCommandsRef.current.delete(commandId)
      setError('O controlador da música não respondeu. Tente novamente.')
    }, REQUEST_TIMEOUT_MS)
    pendingCommandsRef.current.set(commandId, timeout)
    void publish({ type: 'command', commandId, command }, controllerIdentity).catch(() => {
      window.clearTimeout(timeout)
      pendingCommandsRef.current.delete(commandId)
      setError('Não foi possível enviar o comando para o player da sala.')
    })
    return true
  }, [ensureController, getControllerIdentity, performCommand, publish, room])

  const requestRoomState = useCallback(() => {
    ensureController()
    const controllerIdentity = getControllerIdentity(stateRef.current)
    if (controllerIdentity && controllerIdentity !== room.localParticipant.identity) {
      void publish({ type: 'request' }, controllerIdentity).catch(() => undefined)
    }
  }, [ensureController, getControllerIdentity, publish, room])

  const announceMusicProtocol = useCallback(() => {
    void publish({ type: 'hello' }).catch(() => undefined)
  }, [publish])

  const handleParticipantConnected = useCallback((participant?: RemoteParticipant) => {
    announceMusicProtocol()
    if (participant && ensureController()) {
      void publish({ type: 'state', state: stateRef.current }, participant.identity).catch(() => undefined)
    }
    requestRoomState()
  }, [announceMusicProtocol, ensureController, publish, requestRoomState])

  const handleParticipantDisconnected = useCallback((participant?: RemoteParticipant) => {
    if (participant) {
      supportedPeersRef.current.delete(participant.identity)
      setPeerCapabilityRevision((revision) => revision + 1)
    }
    requestRoomState()
  }, [requestRoomState])

  useEffect(() => {
    const receive = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== MUSIC_TOPIC || !participant) return
      let message: MusicWireMessage
      try {
        message = JSON.parse(decoder.decode(payload)) as MusicWireMessage
      } catch {
        return
      }

      if (message.type === 'hello') {
        markPeerSupported(participant.identity)
        if (ensureController()) {
          void publish({ type: 'state', state: stateRef.current }, participant.identity).catch(() => undefined)
        } else {
          requestRoomState()
        }
        return
      }

      // Any recognized v2 packet also proves that the sender understands
      // this protocol; legacy Electron clients must never be elected to
      // control a protocol they cannot receive.
      markPeerSupported(participant.identity)

      if (message.type === 'request') {
        if (!ensureController()) return
        void publish({ type: 'state', state: stateRef.current }, participant.identity).catch(() => undefined)
        return
      }

      if (message.type === 'command') {
        if (getControllerIdentity(stateRef.current) !== room.localParticipant.identity) return
        const commandId = cleanText(message.commandId, 64)
        const command = parseCommand(message.command)
        if (!commandId || !command) return

        const previousResult = handledCommandsRef.current.get(commandId)
        if (previousResult !== undefined) {
          void publish({ type: 'command-result', commandId, error: previousResult }, participant.identity)
            .catch(() => undefined)
          return
        }

        ensureController()
        const commandError = performCommand(command, participant.name || participant.identity)
        handledCommandsRef.current.set(commandId, commandError ?? '')
        if (handledCommandsRef.current.size > 256) {
          handledCommandsRef.current.delete(handledCommandsRef.current.keys().next().value ?? '')
        }
        void publish({ type: 'command-result', commandId, error: commandError ?? '' }, participant.identity)
          .catch(() => undefined)
        return
      }

      if (message.type === 'command-result') {
        const commandId = cleanText(message.commandId, 64)
        const timeout = pendingCommandsRef.current.get(commandId)
        if (timeout === undefined || participant.identity !== getControllerIdentity(stateRef.current)) return
        window.clearTimeout(timeout)
        pendingCommandsRef.current.delete(commandId)
        setError(cleanText(message.error, 240))
        return
      }

      if (message.type !== 'state' || participant.identity !== message.state?.controllerIdentity) return
      const candidate = parseState(message.state)
      if (!candidate || !isNewerState(candidate, stateRef.current)) return
      // Do not compare Date.now() between participants: anchor each received
      // snapshot to this device when it arrives, then extrapolate locally.
      applyState({ ...candidate, updatedAt: Date.now() })
    }

    room.on(RoomEvent.DataReceived, receive)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.Reconnected, handleParticipantConnected)
    announceMusicProtocol()
    const requestTimer = window.setTimeout(requestRoomState, 900)
    return () => {
      window.clearTimeout(requestTimer)
      room.off(RoomEvent.DataReceived, receive)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.Reconnected, handleParticipantConnected)
      for (const timeout of pendingCommandsRef.current.values()) window.clearTimeout(timeout)
      pendingCommandsRef.current.clear()
    }
  }, [applyState, announceMusicProtocol, ensureController, getControllerIdentity, handleParticipantConnected, handleParticipantDisconnected, markPeerSupported, performCommand, publish, requestRoomState, room])

  const addSource = useCallback((source: YouTubeSource) => {
    const current = stateRef.current
    if (current.queue.length >= MAX_ROOM_MUSIC_QUEUE) {
      setError(`A fila aceita até ${MAX_ROOM_MUSIC_QUEUE} itens.`)
      return false
    }
    const validatedSource = parseSource(source)
    if (!validatedSource) {
      setError('Não reconheci esse vídeo ou playlist do YouTube.')
      return false
    }
    return dispatchCommand({ type: 'add', source: validatedSource })
  }, [dispatchCommand])

  const togglePlayback = useCallback((positionSeconds?: number) => {
    const isLocalController = getControllerIdentity(stateRef.current) === room.localParticipant.identity
    dispatchCommand({
      type: 'toggle',
      // The controller's own player has the best position estimate. A remote
      // member should ask the controller to pause at its last heartbeat.
      positionSeconds: isLocalController && Number.isFinite(positionSeconds)
        ? Math.min(MAX_POSITION_SECONDS, Math.max(0, Number(positionSeconds)))
        : undefined,
    })
  }, [dispatchCommand, getControllerIdentity, room])

  const advance = useCallback((expectedItemId?: string) => {
    dispatchCommand({ type: 'advance', expectedItemId })
  }, [dispatchCommand])

  const playItem = useCallback((itemId: string) => {
    dispatchCommand({ type: 'play-item', itemId })
  }, [dispatchCommand])

  const advancePlaylist = useCallback((
    expectedItemId: string,
    expectedPlaylistIndex: number,
    nextPlaylistIndex: number,
  ) => {
    dispatchCommand({
      type: 'advance-playlist',
      expectedItemId,
      expectedPlaylistIndex,
      nextPlaylistIndex,
    })
  }, [dispatchCommand])

  const remove = useCallback((itemId: string) => {
    dispatchCommand({ type: 'remove', itemId })
  }, [dispatchCommand])

  const clear = useCallback(() => {
    dispatchCommand({ type: 'clear' })
  }, [dispatchCommand])

  const reportProgress = useCallback((positionSeconds: number, playlistIndex?: number) => {
    const current = stateRef.current
    if (
      getControllerIdentity(current) !== room.localParticipant.identity ||
      !current.playing ||
      !Number.isFinite(positionSeconds)
    ) return

    const normalizedPosition = Math.min(MAX_POSITION_SECONDS, Math.max(0, positionSeconds))
    const currentItem = current.queue[current.currentIndex]
    if (
      currentItem?.kind === 'playlist' &&
      Number.isInteger(playlistIndex) &&
      Number(playlistIndex) !== current.playlistIndex
    ) return

    const now = Date.now()
    if (now - lastHeartbeatAtRef.current < HEARTBEAT_INTERVAL_MS) return
    lastHeartbeatAtRef.current = now
    const next: RoomMusicState = {
      ...current,
      syncSequence: current.syncSequence + 1,
      positionSeconds: normalizedPosition,
      updatedAt: now,
    }
    applyState(next)
    void publish({ type: 'state', state: next }).catch(() => {
      setError('A sincronização do áudio está instável; tentando recuperar.')
    })
  }, [applyState, getControllerIdentity, publish, room])

  const controllerIdentity = getControllerIdentity(state)
  const localIdentity = room.localParticipant.identity

  return {
    state,
    error,
    controllerIdentity,
    isController: Boolean(localIdentity && controllerIdentity === localIdentity),
    currentItem: state.queue[state.currentIndex],
    addSource,
    togglePlayback,
    playItem,
    advance,
    advancePlaylist,
    remove,
    clear,
    reportProgress,
    clearError: () => setError(''),
  }
}
