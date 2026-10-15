export const MUSIC_TOPIC = 'ford-kall.music.v3'
export const MAX_ROOM_MUSIC_QUEUE = 20
export const MAX_ROOM_MUSIC_TRACKS = 200
export const MAX_MUSIC_PACKET_BYTES = 14_000
export const MAX_MUSIC_SECONDS = 86_400
export const musicNow = () => performance.timeOrigin + performance.now()
export const isYouTubeVideoId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value)
export const isYouTubePlaylistId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(value)
export const musicText = (value: unknown, limit: number) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, limit)
    : ''
const integer = (value: unknown, max: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
const seconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MUSIC_SECONDS
export interface YouTubeSource {
  kind: 'video' | 'playlist'
  provider: 'youtube' | 'youtube-music'
  sourceId: string
  url: string
  label: string
  startIndex: number
  startSeconds: number
  initialVideoId: string
}
export interface RoomMusicQueueItem extends YouTubeSource {
  id: string
  addedBy: string
  addedByIdentity: string
  addedAt: number
  videoIds: string[]
  playlistOffset: number
  totalTracks: number
  resolutionError: string
}
export type RoomMusicStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'waiting' | 'ended' | 'unavailable'
export interface RoomMusicState {
  version: 3
  revision: number
  syncSequence: number
  controllerIdentity: string
  queue: RoomMusicQueueItem[]
  currentIndex: number
  playlistIndex: number
  playbackId: string
  playing: boolean
  status: RoomMusicStatus
  positionSeconds: number
  updatedAt: number
  driverIdentity: string
  listeners: string[]
  metadata: { videoId: string; title: string; duration: number }
  repeat: 'off' | 'all' | 'one'
  error: string
}
export type LocalMusicStatus =
  | 'off'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'buffering'
  | 'blocked'
  | 'paused'
  | 'ended'
  | 'error'
export interface MusicPlayerReport {
  playbackId: string
  videoId: string
  status: LocalMusicStatus
  position: number
  duration: number
  title: string
  errorCode: number
}
export type MusicCommand =
  | { type: 'add'; source: YouTubeSource }
  | { type: 'set-playing'; playbackId: string; playing: boolean }
  | { type: 'next' | 'previous'; playbackId: string }
  | { type: 'seek'; playbackId: string; position: number }
  | { type: 'play-item'; itemId: string; trackIndex: number }
  | { type: 'remove'; itemId: string }
  | { type: 'clear' }
  | { type: 'repeat'; repeat: RoomMusicState['repeat'] }
  | { type: 'resolve'; playbackId: string; itemId: string; videoIds: string[]; offset: number; total: number }
  | { type: 'retry'; playbackId: string }

export const sourceUrl = (source: Pick<YouTubeSource, 'provider' | 'kind' | 'sourceId'>) => {
  const host = source.provider === 'youtube-music' ? 'music.youtube.com' : 'www.youtube.com'
  return `https://${host}/${source.kind === 'playlist' ? `playlist?list=${source.sourceId}` : `watch?v=${source.sourceId}`}`
}
export const readYouTubeSource = (value: unknown): YouTubeSource | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<YouTubeSource>
  if (raw.kind !== 'video' && raw.kind !== 'playlist') return null
  if (raw.kind === 'video' ? !isYouTubeVideoId(raw.sourceId) : !isYouTubePlaylistId(raw.sourceId)) return null
  const provider = raw.provider === 'youtube-music' ? 'youtube-music' : 'youtube'
  const source = { kind: raw.kind, sourceId: raw.sourceId!, provider } as const
  return {
    ...source,
    url: sourceUrl(source),
    label:
      musicText(raw.label, 96) ||
      `${source.kind === 'playlist' ? 'Playlist' : 'Vídeo'} do ${provider === 'youtube-music' ? 'YouTube Music' : 'YouTube'}`,
    startIndex: integer(raw.startIndex, 10000) ? raw.startIndex : 0,
    startSeconds: seconds(raw.startSeconds) ? raw.startSeconds : 0,
    initialVideoId:
      source.kind === 'video' ? source.sourceId : isYouTubeVideoId(raw.initialVideoId) ? raw.initialVideoId : '',
  }
}
const readTime = (value: string | null) => {
  if (!value) return 0
  if (/^\d+(\.\d+)?$/.test(value)) return Math.min(MAX_MUSIC_SECONDS, Number(value))
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  return match
    ? Math.min(MAX_MUSIC_SECONDS, Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0))
    : 0
}
export const parseYouTubeSource = (
  value: string,
  preference: 'auto' | 'video' | 'playlist' = 'auto',
): YouTubeSource | null => {
  let input = value.trim()
  if (isYouTubeVideoId(input)) return readYouTubeSource({ kind: 'video', sourceId: input })
  if (/^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i.test(input)) input = `https://${input}`
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase().replace(/^www\./, ''),
    parts = url.pathname.split('/').filter(Boolean)
  if (
    !(host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host === 'youtube-nocookie.com')
  )
    return null
  const video =
    host === 'youtu.be'
      ? parts[0]
      : ['shorts', 'embed', 'live'].includes(parts[0] ?? '')
        ? parts[1]
        : url.searchParams.get('v')
  const list = url.searchParams.get('list')
  const hasVideo = isYouTubeVideoId(video),
    hasList = isYouTubePlaylistId(list)
  // Music watch links often include a personalized radio. Treat the shared song as a song.
  const useList =
    hasList && (preference === 'playlist' || (preference !== 'video' && (!hasVideo || !list.startsWith('RD'))))
  const provider = host === 'music.youtube.com' ? 'youtube-music' : 'youtube'
  const source = useList
    ? {
        kind: 'playlist',
        sourceId: list,
        initialVideoId: hasVideo ? video : '',
        startIndex: Math.max(0, Number(url.searchParams.get('index') || 1) - 1),
      }
    : hasVideo && preference !== 'playlist'
      ? { kind: 'video', sourceId: video }
      : null
  return source
    ? readYouTubeSource({
        ...source,
        provider,
        startSeconds: readTime(
          url.searchParams.get('t') ||
            url.searchParams.get('start') ||
            url.hash.match(/(?:^#|[&])t=([^&]+)/)?.[1] ||
            null,
        ),
      })
    : null
}
export const emptyMusicState = (): RoomMusicState => ({
  version: 3,
  revision: 0,
  syncSequence: 0,
  controllerIdentity: '',
  queue: [],
  currentIndex: -1,
  playlistIndex: 0,
  playbackId: '',
  playing: false,
  status: 'idle',
  positionSeconds: 0,
  updatedAt: musicNow(),
  driverIdentity: '',
  listeners: [],
  metadata: { videoId: '', title: '', duration: 0 },
  repeat: 'off',
  error: '',
})
export const currentMusicItem = (state: RoomMusicState) => state.queue[state.currentIndex]
export const currentMusicVideo = (state: RoomMusicState) => currentMusicItem(state)?.videoIds[state.playlistIndex] ?? ''
export const roomMusicPosition = (state: RoomMusicState, now = musicNow()) =>
  Math.min(
    state.metadata.duration || MAX_MUSIC_SECONDS,
    Math.max(
      0,
      state.positionSeconds +
        (state.playing && state.status === 'playing' ? Math.max(0, now - state.updatedAt) / 1000 : 0),
    ),
  )
const begin = (
  state: RoomMusicState,
  index: number,
  track: number,
  playing: boolean,
  now: number,
  position = 0,
): RoomMusicState => {
  const item = state.queue[index]
  if (!item)
    return {
      ...state,
      currentIndex: -1,
      playlistIndex: 0,
      playbackId: '',
      playing: false,
      status: 'idle',
      positionSeconds: 0,
      updatedAt: now,
      driverIdentity: '',
      listeners: [],
      metadata: { videoId: '', title: '', duration: 0 },
      error: '',
    }
  const playlistIndex = Math.max(0, Math.min(track, Math.max(0, item.videoIds.length - 1)))
  return {
    ...state,
    currentIndex: index,
    playlistIndex,
    playbackId: crypto.randomUUID(),
    playing,
    status: playing ? 'loading' : 'paused',
    positionSeconds: position,
    updatedAt: now,
    driverIdentity: '',
    listeners: [],
    metadata: {
      videoId: item.videoIds[playlistIndex] ?? '',
      title: item.kind === 'video' && !item.label.startsWith('Vídeo do ') ? item.label : '',
      duration: 0,
    },
    error: '',
  }
}
export const advanceMusic = (state: RoomMusicState, automatic: boolean, now = musicNow()): RoomMusicState => {
  const item = currentMusicItem(state)
  if (!item) return state
  if (automatic && state.repeat === 'one') return begin(state, state.currentIndex, state.playlistIndex, true, now)
  if (state.playlistIndex + 1 < item.videoIds.length)
    return begin(state, state.currentIndex, state.playlistIndex + 1, true, now)
  if (state.currentIndex + 1 < state.queue.length) return begin(state, state.currentIndex + 1, 0, true, now)
  if (state.repeat === 'all') return begin(state, 0, 0, true, now)
  return {
    ...state,
    playing: false,
    status: 'ended',
    positionSeconds: state.metadata.duration || roomMusicPosition(state, now),
    updatedAt: now,
    driverIdentity: '',
    listeners: [],
  }
}
export const reduceMusicCommand = (
  state: RoomMusicState,
  command: MusicCommand,
  sender: { identity: string; name: string },
  now = musicNow(),
): RoomMusicState => {
  if ('playbackId' in command && command.playbackId !== state.playbackId) return state
  switch (command.type) {
    case 'add': {
      if (state.queue.length >= MAX_ROOM_MUSIC_QUEUE)
        throw new Error(`A fila aceita até ${MAX_ROOM_MUSIC_QUEUE} links.`)
      if (state.queue.reduce((n, p) => n + p.videoIds.length, 0) >= MAX_ROOM_MUSIC_TRACKS)
        throw new Error(`A fila aceita até ${MAX_ROOM_MUSIC_TRACKS} faixas. Remova um item antes de adicionar outro.`)
      const source = readYouTubeSource(command.source)
      if (!source) throw new Error('Use um link de vídeo ou playlist pública do YouTube ou YouTube Music.')
      const item: RoomMusicQueueItem = {
        ...source,
        id: crypto.randomUUID(),
        addedBy: musicText(sender.name, 64) || 'Alguém',
        addedByIdentity: sender.identity,
        addedAt: now,
        videoIds: source.kind === 'video' ? [source.sourceId] : [],
        playlistOffset: 0,
        totalTracks: source.kind === 'video' ? 1 : 0,
        resolutionError: '',
      }
      const next = { ...state, queue: [...state.queue, item] }
      return state.currentIndex < 0 ? begin(next, 0, 0, true, now, item.startSeconds) : next
    }
    case 'set-playing': {
      if (!currentMusicItem(state)) throw new Error('Adicione uma música à fila primeiro.')
      if (command.playing && ['ended', 'unavailable'].includes(state.status))
        return begin(state, state.currentIndex, state.playlistIndex, true, now)
      if (command.playing === state.playing) return state
      return {
        ...state,
        playing: command.playing,
        status: command.playing ? 'loading' : 'paused',
        positionSeconds: roomMusicPosition(state, now),
        updatedAt: now,
        driverIdentity: '',
        listeners: [],
        error: '',
      }
    }
    case 'next':
      return advanceMusic(state, false, now)
    case 'previous': {
      if (!currentMusicItem(state)) return state
      if (roomMusicPosition(state, now) > 3 || state.playlistIndex > 0)
        return begin(
          state,
          state.currentIndex,
          roomMusicPosition(state, now) > 3 ? state.playlistIndex : state.playlistIndex - 1,
          true,
          now,
        )
      if (state.currentIndex === 0 && state.repeat !== 'all') return begin(state, 0, 0, true, now)
      const index = state.currentIndex > 0 ? state.currentIndex - 1 : state.queue.length - 1
      return begin(state, index, state.queue[index]!.videoIds.length - 1, true, now)
    }
    case 'seek': {
      if (!currentMusicVideo(state)) return state
      return {
        ...begin(
          state,
          state.currentIndex,
          state.playlistIndex,
          state.playing,
          now,
          Math.min(state.metadata.duration || MAX_MUSIC_SECONDS, command.position),
        ),
        metadata: state.metadata,
      }
    }
    case 'play-item': {
      const index = state.queue.findIndex((item) => item.id === command.itemId)
      return index < 0 ? state : begin(state, index, command.trackIndex, true, now)
    }
    case 'remove': {
      const index = state.queue.findIndex((item) => item.id === command.itemId)
      if (index < 0) return state
      const queue = state.queue.filter((item) => item.id !== command.itemId),
        next = { ...state, queue }
      if (index === state.currentIndex) return begin(next, Math.min(index, queue.length - 1), 0, state.playing, now)
      return { ...next, currentIndex: index < state.currentIndex ? state.currentIndex - 1 : state.currentIndex }
    }
    case 'clear':
      return {
        ...emptyMusicState(),
        controllerIdentity: state.controllerIdentity,
        revision: state.revision,
        repeat: state.repeat,
        updatedAt: now,
      }
    case 'repeat':
      return command.repeat === state.repeat ? state : { ...state, repeat: command.repeat }
    case 'resolve': {
      const item = currentMusicItem(state)
      if (
        !item ||
        item.id !== command.itemId ||
        item.kind !== 'playlist' ||
        item.videoIds.length ||
        item.resolutionError
      )
        return state
      const available = MAX_ROOM_MUSIC_TRACKS - state.queue.reduce((n, p) => n + p.videoIds.length, 0)
      const preferred = item.startIndex - command.offset
      const found = item.initialVideoId
        ? command.videoIds[preferred] === item.initialVideoId
          ? preferred
          : command.videoIds.indexOf(item.initialVideoId)
        : -1
      const selected =
        found >= 0 ? found : Math.max(0, Math.min(command.videoIds.length - 1, item.startIndex - command.offset))
      const windowOffset = Math.max(
        0,
        Math.min(command.videoIds.length - available, selected - Math.floor(available / 2)),
      )
      const videoIds = command.videoIds.slice(windowOffset, windowOffset + available)
      if (!videoIds.length) throw new Error('A playlist não trouxe faixas públicas reproduzíveis.')
      const track = selected - windowOffset
      const queue = state.queue.map((p) =>
        p.id === item.id
          ? { ...p, videoIds, playlistOffset: command.offset + windowOffset, totalTracks: command.total }
          : p,
      )
      return begin({ ...state, queue }, state.currentIndex, track, state.playing, now, item.startSeconds)
    }
    case 'retry': {
      const item = currentMusicItem(state)
      if (!item) return state
      return begin(
        { ...state, queue: state.queue.map((p) => (p.id === item.id ? { ...p, resolutionError: '' } : p)) },
        state.currentIndex,
        state.playlistIndex,
        true,
        now,
        roomMusicPosition(state, now),
      )
    }
  }
}
export const readMusicCommand = (value: unknown): MusicCommand | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>,
    playbackId = musicText(raw.playbackId, 80),
    itemId = musicText(raw.itemId, 80)
  if (raw.type === 'clear') return { type: 'clear' }
  if (raw.type === 'add') {
    const source = readYouTubeSource(raw.source)
    return source ? { type: 'add', source } : null
  }
  if (raw.type === 'repeat' && ['off', 'all', 'one'].includes(String(raw.repeat)))
    return { type: 'repeat', repeat: raw.repeat as RoomMusicState['repeat'] }
  if (raw.type === 'remove' && itemId) return { type: 'remove', itemId }
  if (raw.type === 'play-item' && itemId && integer(raw.trackIndex, MAX_ROOM_MUSIC_TRACKS))
    return { type: 'play-item', itemId, trackIndex: raw.trackIndex }
  if (!playbackId) return null
  if (raw.type === 'set-playing' && typeof raw.playing === 'boolean')
    return { type: 'set-playing', playbackId, playing: raw.playing }
  if (raw.type === 'next' || raw.type === 'previous' || raw.type === 'retry') return { type: raw.type, playbackId }
  if (raw.type === 'seek' && seconds(raw.position)) return { type: 'seek', playbackId, position: raw.position }
  if (
    raw.type === 'resolve' &&
    itemId &&
    Array.isArray(raw.videoIds) &&
    raw.videoIds.length > 0 &&
    raw.videoIds.length <= MAX_ROOM_MUSIC_TRACKS &&
    raw.videoIds.every(isYouTubeVideoId) &&
    integer(raw.offset, 10000) &&
    integer(raw.total, 10000) &&
    raw.total >= raw.offset + raw.videoIds.length
  )
    return { type: 'resolve', playbackId, itemId, videoIds: [...raw.videoIds], offset: raw.offset, total: raw.total }
  return null
}
export const readMusicReport = (value: unknown): MusicPlayerReport | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as MusicPlayerReport
  if (
    !musicText(raw.playbackId, 80) ||
    (raw.videoId && !isYouTubeVideoId(raw.videoId)) ||
    !['off', 'loading', 'ready', 'playing', 'buffering', 'blocked', 'paused', 'ended', 'error'].includes(raw.status) ||
    !seconds(raw.position) ||
    !seconds(raw.duration) ||
    !integer(raw.errorCode, 999)
  )
    return null
  return {
    playbackId: musicText(raw.playbackId, 80),
    videoId: raw.videoId || '',
    status: raw.status,
    position: raw.position,
    duration: raw.duration,
    title: musicText(raw.title, 160),
    errorCode: raw.errorCode,
  }
}
export const readMusicState = (value: unknown): RoomMusicState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as RoomMusicState
  if (
    raw.version !== 3 ||
    !integer(raw.revision, Number.MAX_SAFE_INTEGER) ||
    !integer(raw.syncSequence, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(raw.queue) ||
    raw.queue.length > MAX_ROOM_MUSIC_QUEUE ||
    !Number.isInteger(raw.currentIndex) ||
    raw.currentIndex < -1 ||
    raw.currentIndex >= raw.queue.length ||
    !integer(raw.playlistIndex, MAX_ROOM_MUSIC_TRACKS) ||
    !['idle', 'loading', 'playing', 'paused', 'waiting', 'ended', 'unavailable'].includes(raw.status) ||
    typeof raw.playing !== 'boolean' ||
    !seconds(raw.positionSeconds) ||
    !(
      typeof raw.updatedAt === 'number' &&
      Number.isFinite(raw.updatedAt) &&
      raw.updatedAt >= 0 &&
      raw.updatedAt <= Number.MAX_SAFE_INTEGER
    ) ||
    !['off', 'all', 'one'].includes(raw.repeat) ||
    !Array.isArray(raw.listeners) ||
    raw.listeners.length > 200 ||
    !raw.metadata ||
    typeof raw.metadata !== 'object' ||
    !seconds(raw.metadata.duration) ||
    (raw.metadata.videoId && !isYouTubeVideoId(raw.metadata.videoId))
  )
    return null
  const queue: RoomMusicQueueItem[] = []
  for (const p of raw.queue) {
    const source = readYouTubeSource(p)
    if (
      !source ||
      !musicText(p.id, 80) ||
      !Array.isArray(p.videoIds) ||
      p.videoIds.length > MAX_ROOM_MUSIC_TRACKS ||
      !p.videoIds.every(isYouTubeVideoId) ||
      !integer(p.playlistOffset, 10000) ||
      !integer(p.totalTracks, 10000) ||
      p.totalTracks < p.playlistOffset + p.videoIds.length ||
      !Number.isFinite(p.addedAt) ||
      (p.kind === 'video' && (p.videoIds.length !== 1 || p.videoIds[0] !== p.sourceId))
    )
      return null
    queue.push({
      ...source,
      id: musicText(p.id, 80),
      addedBy: musicText(p.addedBy, 64),
      addedByIdentity: musicText(p.addedByIdentity, 128),
      addedAt: p.addedAt,
      videoIds: [...p.videoIds],
      playlistOffset: p.playlistOffset,
      totalTracks: p.totalTracks,
      resolutionError: musicText(p.resolutionError, 160),
    })
  }
  if (
    new Set(queue.map((p) => p.id)).size !== queue.length ||
    queue.reduce((n, p) => n + p.videoIds.length, 0) > MAX_ROOM_MUSIC_TRACKS ||
    (queue.length === 0) !== (raw.currentIndex === -1) ||
    (!queue.length && (raw.playing || raw.status !== 'idle' || raw.playbackId || raw.driverIdentity)) ||
    (raw.status === 'playing' && (!raw.playing || !raw.driverIdentity)) ||
    (raw.currentIndex >= 0 &&
      (!musicText(raw.playbackId, 80) ||
        (queue[raw.currentIndex]!.videoIds.length > 0 &&
          raw.playlistIndex >= queue[raw.currentIndex]!.videoIds.length)))
  )
    return null
  const metadata = {
    videoId: raw.metadata.videoId || '',
    title: musicText(raw.metadata.title, 160),
    duration: raw.metadata.duration,
  }
  if (raw.currentIndex >= 0 && metadata.videoId !== (queue[raw.currentIndex]!.videoIds[raw.playlistIndex] || ''))
    return null
  return {
    version: 3,
    revision: raw.revision,
    syncSequence: raw.syncSequence,
    controllerIdentity: musicText(raw.controllerIdentity, 128),
    queue,
    currentIndex: raw.currentIndex,
    playlistIndex: raw.playlistIndex,
    playbackId: musicText(raw.playbackId, 80),
    playing: raw.playing,
    status: raw.status,
    positionSeconds: raw.positionSeconds,
    updatedAt: raw.updatedAt,
    driverIdentity: musicText(raw.driverIdentity, 128),
    listeners: [...new Set(raw.listeners.map((id) => musicText(id, 128)).filter(Boolean))],
    metadata,
    repeat: raw.repeat,
    error: musicText(raw.error, 200),
  }
}
export const musicStateIsNewer = (candidate: RoomMusicState, current: RoomMusicState) =>
  candidate.revision !== current.revision
    ? candidate.revision > current.revision
    : candidate.syncSequence > current.syncSequence
export const applyDriverReport = (
  state: RoomMusicState,
  report: MusicPlayerReport,
  identity: string,
  now = musicNow(),
): RoomMusicState => {
  if (
    report.playbackId !== state.playbackId ||
    report.videoId !== currentMusicVideo(state) ||
    !report.videoId ||
    (state.driverIdentity && state.driverIdentity !== identity)
  )
    return state
  const metadata = {
    videoId: report.videoId,
    title: report.title || state.metadata.title,
    duration: report.duration || state.metadata.duration,
  }
  const queue = state.queue.map((item, index) =>
    index === state.currentIndex && item.kind === 'video' && report.title
      ? { ...item, label: report.title.slice(0, 96) }
      : item,
  )
  if (!state.playing) return { ...state, metadata, queue }
  if (report.status === 'ended') {
    if (state.driverIdentity !== identity || !report.duration || report.position < report.duration - 1.5) return state
    return advanceMusic({ ...state, metadata, queue }, true, now)
  }
  if (report.status === 'playing')
    return {
      ...state,
      metadata,
      queue,
      status: 'playing',
      driverIdentity: identity,
      positionSeconds: Math.min(report.position, metadata.duration || MAX_MUSIC_SECONDS),
      updatedAt: now,
      error: '',
    }
  if (state.driverIdentity === identity && ['buffering', 'blocked', 'paused', 'error', 'off'].includes(report.status))
    return {
      ...state,
      metadata,
      queue,
      status: 'waiting',
      driverIdentity: '',
      positionSeconds: report.position,
      updatedAt: now,
    }
  return { ...state, metadata, queue }
}
export const serializedMusicState = (state: RoomMusicState) => ({
  ...state,
  queue: state.queue.map(({ url, ...item }) => {
    void url
    return item
  }),
})
