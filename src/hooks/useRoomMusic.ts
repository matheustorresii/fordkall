import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type RemoteParticipant, type Room } from 'livekit-client'
import type { RoomMusicQueueItem, RoomMusicState } from '../types'
import type { YouTubeSource } from '../services/youtube'

const MUSIC_TOPIC = 'ford-kall.music.v1'
export const MAX_ROOM_MUSIC_QUEUE = 20
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,100}$/

type MusicWireMessage =
  | { type: 'request' }
  | { type: 'state'; state: RoomMusicState }

const emptyState = (): RoomMusicState => ({
  version: 1,
  revision: 0,
  controllerIdentity: '',
  queue: [],
  currentIndex: -1,
  playlistIndex: 0,
  playing: false,
  positionSeconds: 0,
  updatedAt: Date.now(),
})

const cleanText = (value: unknown, maximum: number) =>
  typeof value === 'string' ? value.slice(0, maximum) : ''

const parseQueueItem = (value: unknown): RoomMusicQueueItem | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<RoomMusicQueueItem>
  if (item.kind !== 'video' && item.kind !== 'playlist') return null
  const sourceId = cleanText(item.sourceId, 100)
  const id = cleanText(item.id, 64)
  if (
    !id ||
    (item.kind === 'video' && !VIDEO_ID.test(sourceId)) ||
    (item.kind === 'playlist' && !PLAYLIST_ID.test(sourceId))
  ) return null
  return {
    id,
    kind: item.kind,
    sourceId,
    url: cleanText(item.url, 300),
    label: cleanText(item.label, 160) || (item.kind === 'playlist' ? 'Playlist do YouTube' : 'Vídeo do YouTube'),
    addedBy: cleanText(item.addedBy, 128),
    addedAt: typeof item.addedAt === 'number' && Number.isFinite(item.addedAt)
      ? item.addedAt
      : Date.now(),
  }
}

const parseState = (value: unknown): RoomMusicState | null => {
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<RoomMusicState>
  if (state.version !== 1 || !Array.isArray(state.queue) || state.queue.length > MAX_ROOM_MUSIC_QUEUE) {
    return null
  }
  const queue = state.queue.map(parseQueueItem)
  if (queue.some((item) => !item)) return null
  const currentIndex = Number.isInteger(state.currentIndex) ? Number(state.currentIndex) : -1
  if (currentIndex < -1 || currentIndex >= queue.length) return null
  return {
    version: 1,
    revision: Number.isSafeInteger(state.revision) && Number(state.revision) >= 0
      ? Number(state.revision)
      : 0,
    controllerIdentity: cleanText(state.controllerIdentity, 128),
    queue: queue as RoomMusicQueueItem[],
    currentIndex,
    playlistIndex: Number.isInteger(state.playlistIndex)
      ? Math.min(10_000, Math.max(0, Number(state.playlistIndex)))
      : 0,
    playing: Boolean(state.playing) && currentIndex >= 0,
    positionSeconds: typeof state.positionSeconds === 'number' && Number.isFinite(state.positionSeconds)
      ? Math.min(86_400, Math.max(0, state.positionSeconds))
      : 0,
    updatedAt: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt)
      ? state.updatedAt
      : Date.now(),
  }
}

const isNewerState = (candidate: RoomMusicState, current: RoomMusicState) => {
  if (candidate.revision !== current.revision) return candidate.revision > current.revision
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt
  return candidate.controllerIdentity > current.controllerIdentity
}

export const roomMusicPosition = (state: RoomMusicState) =>
  Math.min(
    86_400,
    Math.max(
      0,
      state.positionSeconds + (state.playing ? Math.max(0, Date.now() - state.updatedAt) / 1_000 : 0),
    ),
  )

export const useRoomMusic = (room: Room) => {
  const [state, setState] = useState<RoomMusicState>(emptyState)
  const [error, setError] = useState('')
  const stateRef = useRef(state)

  const applyState = useCallback((next: RoomMusicState) => {
    stateRef.current = next
    setState(next)
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

  const commit = useCallback((build: (current: RoomMusicState) => RoomMusicState) => {
    const current = stateRef.current
    const next = build(current)
    if (next === current) return false
    applyState(next)
    setError('')
    void publish({ type: 'state', state: next }).catch(() => {
      setError('A alteração ficou só neste dispositivo. Tente novamente.')
    })
    return true
  }, [applyState, publish])

  const nextRevision = useCallback((current: RoomMusicState) => ({
    revision: current.revision + 1,
    controllerIdentity: room.localParticipant.identity,
    updatedAt: Date.now(),
  }), [room])

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

      if (message.type === 'request') {
        if (stateRef.current.queue.length > 0) {
          void publish(
            { type: 'state', state: stateRef.current },
            participant.identity,
          ).catch(() => undefined)
        }
        return
      }

      if (message.type !== 'state') return
      const candidate = parseState(message.state)
      if (candidate && isNewerState(candidate, stateRef.current)) applyState(candidate)
    }

    const electController = () => {
      const current = stateRef.current
      if (!current.queue.length || !current.controllerIdentity) return
      const connected = [
        room.localParticipant.identity,
        ...room.remoteParticipants.keys(),
      ].filter(Boolean).sort()
      if (connected.includes(current.controllerIdentity) || connected[0] !== room.localParticipant.identity) {
        return
      }
      const next = {
        ...current,
        ...nextRevision(current),
        positionSeconds: roomMusicPosition(current),
      }
      applyState(next)
      void publish({ type: 'state', state: next }).catch(() => undefined)
    }

    room.on(RoomEvent.DataReceived, receive)
    room.on(RoomEvent.ParticipantDisconnected, electController)
    const requestTimer = window.setTimeout(() => {
      void publish({ type: 'request' }).catch(() => undefined)
    }, 650)
    return () => {
      window.clearTimeout(requestTimer)
      room.off(RoomEvent.DataReceived, receive)
      room.off(RoomEvent.ParticipantDisconnected, electController)
    }
  }, [applyState, nextRevision, publish, room])

  const addSource = useCallback((source: YouTubeSource) => {
    let accepted = false
    commit((current) => {
      if (current.queue.length >= MAX_ROOM_MUSIC_QUEUE) return current
      accepted = true
      const queue = [
        ...current.queue,
        {
          ...source,
          id: crypto.randomUUID(),
          addedBy: room.localParticipant.name || room.localParticipant.identity,
          addedAt: Date.now(),
        },
      ]
      const wasEmpty = current.currentIndex < 0
      return {
        ...current,
        ...nextRevision(current),
        queue,
        currentIndex: wasEmpty ? 0 : current.currentIndex,
        playlistIndex: wasEmpty ? 0 : current.playlistIndex,
        positionSeconds: wasEmpty ? 0 : roomMusicPosition(current),
        playing: wasEmpty ? true : current.playing,
      }
    })
    if (!accepted) setError(`A fila aceita até ${MAX_ROOM_MUSIC_QUEUE} itens.`)
    return accepted
  }, [commit, nextRevision, room])

  const togglePlayback = useCallback((positionSeconds?: number) => {
    commit((current) => {
      if (current.currentIndex < 0) return current
      return {
        ...current,
        ...nextRevision(current),
        playing: !current.playing,
        positionSeconds: Number.isFinite(positionSeconds)
          ? Math.max(0, Number(positionSeconds))
          : roomMusicPosition(current),
      }
    })
  }, [commit, nextRevision])

  const advance = useCallback((expectedItemId?: string) => {
    commit((current) => {
      const item = current.queue[current.currentIndex]
      if (!item || (expectedItemId && item.id !== expectedItemId)) return current
      const nextIndex = current.currentIndex + 1
      const hasNext = nextIndex < current.queue.length
      return {
        ...current,
        ...nextRevision(current),
        currentIndex: hasNext ? nextIndex : current.currentIndex,
        playlistIndex: 0,
        positionSeconds: 0,
        playing: hasNext,
      }
    })
  }, [commit, nextRevision])

  const playItem = useCallback((itemId: string) => {
    commit((current) => {
      const currentIndex = current.queue.findIndex((item) => item.id === itemId)
      if (currentIndex < 0) return current
      return {
        ...current,
        ...nextRevision(current),
        currentIndex,
        playlistIndex: 0,
        positionSeconds: 0,
        playing: true,
      }
    })
  }, [commit, nextRevision])

  const advancePlaylist = useCallback((
    expectedItemId: string,
    expectedPlaylistIndex: number,
    nextPlaylistIndex: number,
  ) => {
    commit((current) => {
      const item = current.queue[current.currentIndex]
      if (
        !item ||
        item.id !== expectedItemId ||
        current.playlistIndex !== expectedPlaylistIndex ||
        nextPlaylistIndex <= expectedPlaylistIndex
      ) return current
      return {
        ...current,
        ...nextRevision(current),
        playlistIndex: nextPlaylistIndex,
        positionSeconds: 0,
        playing: true,
      }
    })
  }, [commit, nextRevision])

  const remove = useCallback((itemId: string) => {
    commit((current) => {
      const removedIndex = current.queue.findIndex((item) => item.id === itemId)
      if (removedIndex < 0) return current
      const queue = current.queue.filter((item) => item.id !== itemId)
      if (!queue.length) {
        return {
          ...emptyState(),
          ...nextRevision(current),
        }
      }
      const removedCurrent = removedIndex === current.currentIndex
      const currentIndex = removedIndex < current.currentIndex
        ? current.currentIndex - 1
        : Math.min(current.currentIndex, queue.length - 1)
      return {
        ...current,
        ...nextRevision(current),
        queue,
        currentIndex,
        playlistIndex: removedCurrent ? 0 : current.playlistIndex,
        positionSeconds: removedCurrent ? 0 : roomMusicPosition(current),
        playing: removedCurrent ? true : current.playing,
      }
    })
  }, [commit, nextRevision])

  const clear = useCallback(() => {
    commit((current) => ({
      ...emptyState(),
      ...nextRevision(current),
    }))
  }, [commit, nextRevision])

  return {
    state,
    error,
    currentItem: state.queue[state.currentIndex],
    addSource,
    togglePlayback,
    playItem,
    advance,
    advancePlaylist,
    remove,
    clear,
    clearError: () => setError(''),
  }
}
