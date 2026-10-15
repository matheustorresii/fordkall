import {
  MAX_MUSIC_PACKET_BYTES,
  MUSIC_TOPIC,
  applyDriverReport,
  currentMusicItem,
  emptyMusicState,
  musicNow,
  musicStateIsNewer,
  musicText,
  readMusicCommand,
  readMusicReport,
  readMusicState,
  reduceMusicCommand,
  roomMusicPosition,
  serializedMusicState,
  type MusicCommand,
  type MusicPlayerReport,
  type RoomMusicState,
} from './model.ts'

export interface MusicTransport {
  identity: string
  name: string
  send: (payload: Uint8Array, destination?: string) => Promise<void>
}
type Peer = { enabled: boolean; report?: MusicPlayerReport; at: number; playedPlayback?: string }
type ClockSample = { offset: number; rtt: number; at: number }
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const REPORT_TTL = 7_000

/** The room protocol never depends on a YouTube iframe or a local autoplay permission. */
export class RoomMusicSession {
  state = emptyMusicState()
  error = ''
  enabled = true
  ready = false
  private connected = new Set<string>()
  private peers = new Map<string, Peer>()
  private clocks = new Map<string, ClockSample>()
  private pings = new Map<string, { peer: string; at: number }>()
  private pending = new Map<string, number>()
  private handled = new Map<string, string>()
  private stopped = false
  private startedAt = 0
  private bootstrapUntil = 0
  private lastHeartbeat = 0
  private lastFullState = 0
  private lastHello = 0
  private lastPing = 0
  private lastRequest = 0
  private resyncing = false
  readonly transport: MusicTransport
  private changed: () => void
  private now: () => number
  constructor(transport: MusicTransport, changed: () => void, now = musicNow) {
    this.transport = transport
    this.changed = changed
    this.now = now
  }

  start(identities: string[], enabled: boolean) {
    this.stopped = false
    this.enabled = enabled
    this.startedAt = this.now()
    this.bootstrapUntil = this.now() + 2_000
    this.setPeers(identities)
    this.hello()
    this.request()
  }

  stop() {
    this.stopped = true
    this.pending.clear()
    this.pings.clear()
  }
  private notify() {
    if (!this.stopped) this.changed()
  }
  clearError() {
    this.error = ''
    this.notify()
  }
  get isController() {
    return this.ready && this.state.controllerIdentity === this.transport.identity
  }

  private send(message: object, destination?: string) {
    if (this.stopped) return
    const bytes = encoder.encode(JSON.stringify(message))
    if (bytes.byteLength > MAX_MUSIC_PACKET_BYTES) {
      this.error = 'A fila ficou grande demais. Remova um link antes de continuar.'
      this.notify()
      return
    }
    void this.transport.send(bytes, destination).catch(() => {
      if (!this.stopped) {
        this.error = 'Sem contato com o player da sala. Tentando reconectar…'
        this.notify()
      }
    })
  }
  private hello(destination?: string) {
    this.send({ type: 'hello', enabled: this.enabled }, destination)
    this.lastHello = this.now()
  }
  private request(destination?: string) {
    this.send({ type: 'request' }, destination)
    this.lastRequest = this.now()
  }
  private sendState(destination?: string) {
    const now = this.now()
    this.send(
      {
        type: 'state',
        state: serializedMusicState({
          ...this.state,
          positionSeconds: roomMusicPosition(this.state, now),
          updatedAt: now,
        }),
      },
      destination,
    )
    this.lastFullState = now
  }
  private peerIdentities() {
    return [this.transport.identity, ...[...this.peers.keys()].filter((id) => this.connected.has(id))].sort()
  }
  private expectedController() {
    const current = this.state.controllerIdentity
    return current && this.peerIdentities().includes(current) ? current : this.peerIdentities()[0]!
  }

  setPeers(identities: string[]) {
    this.connected = new Set(identities.filter((id) => id && id !== this.transport.identity))
    for (const id of this.peers.keys())
      if (id !== this.transport.identity && !this.connected.has(id)) {
        this.peers.delete(id)
        this.clocks.delete(id)
      }
    if (this.ready && this.state.controllerIdentity && !this.peerIdentities().includes(this.state.controllerIdentity)) {
      this.ready = false
      this.startedAt = this.now() - 500
      this.tick()
    } else if (this.isController) this.refreshDriver()
  }

  reconnect(identities: string[]) {
    this.ready = false
    this.resyncing = identities.some(id => id && id !== this.transport.identity)
    this.state = {
      ...this.state,
      controllerIdentity: '',
      positionSeconds: roomMusicPosition(this.state, this.now()),
      updatedAt: this.now(),
      status: this.state.playing ? 'waiting' : this.state.status,
      driverIdentity: '',
    }
    this.clocks.clear()
    this.pings.clear()
    this.pending.clear()
    for (const peer of this.peers.values()) peer.report = undefined
    this.startedAt = this.now()
    this.bootstrapUntil = this.now() + 2_000
    this.setPeers(identities)
    this.hello()
    this.request()
    this.notify()
  }

  setListening(enabled: boolean) {
    if (this.enabled === enabled) return
    this.enabled = enabled
    const own = this.peers.get(this.transport.identity)
    if (own) {
      own.enabled = enabled
      if (!enabled) own.report = undefined
    }
    this.hello()
    if (this.isController) this.refreshDriver()
    this.notify()
  }

  private commit(next: RoomMusicState) {
    if (!this.isController || next === this.state) return
    const result = {
      ...next,
      revision: this.state.revision + 1,
      syncSequence: 0,
      controllerIdentity: this.transport.identity,
    }
    // Check the entire state before mutating it; LiveKit reliable packets are size limited.
    if (
      encoder.encode(JSON.stringify({ type: 'state', state: serializedMusicState(result) })).byteLength >
      MAX_MUSIC_PACKET_BYTES
    ) {
      this.error = 'A fila ficou grande demais. Remova um link antes de continuar.'
      this.notify()
      return
    }
    const newPlayback = result.playbackId !== this.state.playbackId
    this.state = result
    if (newPlayback) for (const peer of this.peers.values()) peer.report = undefined
    this.sendState()
    this.notify()
  }

  private perform(command: MusicCommand, identity: string, name: string) {
    try {
      this.error = ''
      this.commit(reduceMusicCommand(this.state, command, { identity, name }, this.now()))
      return this.error
    } catch (error) {
      return error instanceof Error ? error.message : 'Não foi possível alterar a fila.'
    }
  }

  command(command: MusicCommand) {
    const validated = readMusicCommand(command)
    if (!validated) {
      this.error = 'Comando inválido para o player.'
      this.notify()
      return false
    }
    command = validated
    if (!this.ready) {
      this.error = 'Sincronizando o player com a sala. Tente novamente em um instante.'
      this.notify()
      return false
    }
    this.error = ''
    if (this.isController) {
      this.error = this.perform(command, this.transport.identity, this.transport.name)
      this.notify()
      return !this.error
    }
    const id = crypto.randomUUID()
    this.pending.set(id, this.now())
    this.send({ type: 'command', id, command }, this.state.controllerIdentity)
    this.notify()
    return true
  }

  report(report: MusicPlayerReport) {
    const validated = readMusicReport(report)
    if (!validated) return
    report = validated
    if (this.stopped || !this.enabled || report.playbackId !== this.state.playbackId) return
    if (this.isController) this.receiveReport(this.transport.identity, report, this.now())
    else if (this.ready) this.send({ type: 'report', report, sentAt: this.now() }, this.state.controllerIdentity)
  }

  private receiveReport(identity: string, report: MusicPlayerReport, sampledAt: number) {
    if (!this.isController || report.playbackId !== this.state.playbackId) return
    const peer =
      identity === this.transport.identity
        ? (this.peers.get(identity) ?? { enabled: this.enabled, at: this.now() })
        : this.peers.get(identity)
    if (!peer?.enabled) return
    if (report.status === 'playing') peer.playedPlayback = report.playbackId
    peer.report = report
    peer.at = this.now()
    this.peers.set(identity, peer)
    const offset = identity === this.transport.identity ? 0 : this.clocks.get(identity)?.offset
    const transit = offset === undefined ? 0 : Math.min(1, Math.max(0, (this.now() + offset - sampledAt) / 1_000))
    const timed = {
      ...report,
      position: Math.min(86_400, report.position + (report.status === 'playing' ? transit : 0)),
    }
    const before = this.state
    const finishing =
      report.status === 'ended' &&
      report.duration > 0 &&
      report.position >= report.duration - 1.5 &&
      !before.driverIdentity &&
      peer.playedPlayback === report.playbackId
    const next = applyDriverReport(
      finishing ? { ...before, driverIdentity: identity } : before,
      timed,
      identity,
      this.now(),
    )
    if (next !== before) {
      const structural =
        next.playbackId !== before.playbackId ||
        next.status !== before.status ||
        next.driverIdentity !== before.driverIdentity ||
        next.metadata.title !== before.metadata.title ||
        Math.abs(next.metadata.duration - before.metadata.duration) > 0.5
      if (structural) this.commit(next)
      else {
        this.state = { ...next, syncSequence: before.syncSequence + 1 }
        this.notify()
      }
    }
    this.refreshDriver()
  }

  private refreshDriver() {
    if (!this.isController || !currentMusicItem(this.state)) return
    const current = this.state,
      now = this.now()
    const active = [...this.peers.entries()].filter(
      ([id, peer]) =>
        (id === this.transport.identity ? this.enabled : this.connected.has(id) && peer.enabled) &&
        peer.report?.playbackId === current.playbackId &&
        now - peer.at < REPORT_TTL,
    )
    const listeners = active
      .filter(([, peer]) => peer.report!.status === 'playing')
      .map(([id]) => id)
      .sort()
    if (!current.playing) {
      if (current.listeners.length) this.commit({ ...current, listeners: [] })
      return
    }
    const driver = listeners.includes(current.driverIdentity) ? current.driverIdentity : listeners[0] || ''
    if (driver !== current.driverIdentity) {
      const sample = this.peers.get(driver)
      const position = sample?.report
        ? Math.min(86_400, sample.report.position + Math.max(0, now - sample.at) / 1_000)
        : roomMusicPosition(current, now)
      this.commit({
        ...current,
        listeners,
        driverIdentity: driver,
        status: driver ? 'playing' : 'waiting',
        positionSeconds: position,
        updatedAt: now,
      })
    } else if (listeners.join('|') !== current.listeners.join('|')) this.commit({ ...current, listeners })

    const enabled = [
      this.enabled ? this.transport.identity : '',
      ...[...this.peers.entries()]
        .filter(([id, p]) => id !== this.transport.identity && this.connected.has(id) && p.enabled)
        .map(([id]) => id),
    ].filter(Boolean)
    const allFailed =
      enabled.length > 0 &&
      enabled.every((id) => active.some(([peerId, p]) => peerId === id && p.report?.status === 'error'))
    if (allFailed && this.state.playing) {
      const item = currentMusicItem(this.state)!
      this.commit({
        ...this.state,
        playing: false,
        status: 'unavailable',
        driverIdentity: '',
        listeners: [],
        positionSeconds: roomMusicPosition(this.state, now),
        updatedAt: now,
        error: item.videoIds.length
          ? 'O YouTube não conseguiu reproduzir esta faixa nos dispositivos conectados. Você pode tentar novamente ou avançar.'
          : 'Não foi possível abrir essa playlist. Confira se ela é pública e se permite reprodução incorporada.',
        queue: this.state.queue.map((p) =>
          p.id === item.id && !p.videoIds.length ? { ...p, resolutionError: 'Playlist indisponível' } : p,
        ),
      })
    }
  }

  private ping(peer: string) {
    const id = crypto.randomUUID(),
      at = this.now()
    this.pings.set(id, { peer, at })
    this.send({ type: 'ping', id, at }, peer)
  }

  receive(payload: Uint8Array, identity: string, name = identity, topic = MUSIC_TOPIC) {
    if (
      this.stopped ||
      topic !== MUSIC_TOPIC ||
      !this.connected.has(identity) ||
      payload.byteLength > MAX_MUSIC_PACKET_BYTES
    )
      return
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(decoder.decode(payload)) as Record<string, unknown>
    } catch {
      return
    }
    if (!raw || typeof raw !== 'object') return
    if (!this.peers.has(identity)) this.peers.set(identity, { enabled: true, at: this.now() })
    if (raw.type === 'hello') {
      this.peers.get(identity)!.enabled = raw.enabled === true
      if (raw.enabled !== true) this.peers.get(identity)!.report = undefined
      if (this.isController) {
        this.sendState(identity)
        this.refreshDriver()
      }
      this.ping(identity)
      return
    }
    if (
      raw.type === 'ping' &&
      typeof raw.id === 'string' &&
      raw.id.length <= 80 &&
      typeof raw.at === 'number' &&
      Number.isFinite(raw.at)
    ) {
      this.send({ type: 'pong', id: raw.id, receivedAt: this.now(), sentAt: this.now() }, identity)
      return
    }
    if (
      raw.type === 'pong' &&
      typeof raw.id === 'string' &&
      typeof raw.receivedAt === 'number' &&
      typeof raw.sentAt === 'number' &&
      Number.isFinite(raw.receivedAt) &&
      Number.isFinite(raw.sentAt)
    ) {
      const ping = this.pings.get(raw.id)
      if (!ping || ping.peer !== identity) return
      this.pings.delete(raw.id)
      const rtt = this.now() - ping.at - (raw.sentAt - raw.receivedAt)
      if (!Number.isFinite(rtt) || rtt < 0 || rtt > 5_000) return
      const previous = this.clocks.get(identity)
      if (!previous || rtt <= previous.rtt || this.now() - previous.at > 30_000)
        this.clocks.set(identity, {
          offset: (raw.receivedAt - ping.at + (raw.sentAt - this.now())) / 2,
          rtt,
          at: this.now(),
        })
      return
    }
    if (raw.type === 'request') {
      if (this.isController) {
        this.hello(identity)
        this.sendState(identity)
      }
      return
    }
    if (raw.type === 'state') {
      const next = readMusicState(raw.state)
      if (!next || next.controllerIdentity !== identity) return
      const currentController = this.state.controllerIdentity
      const authorityKnown =
        !this.resyncing && this.ready && currentController && this.peerIdentities().includes(currentController)
      const collision =
        this.now() < this.bootstrapUntil &&
        ((next.revision === this.state.revision && identity < currentController) ||
          (next.revision > this.state.revision && next.queue.length > 0 && !this.state.queue.length))
      if (authorityKnown && currentController !== identity && !collision) return
      if (currentController === identity && this.ready && !musicStateIsNewer(next, this.state)) return
      // Offline revisions are not authority: the surviving room may have cleared/replaced the queue.
      if (!this.resyncing && !authorityKnown && next.revision < this.state.revision && this.state.queue.length) return
      const clock = this.clocks.get(identity)
      const transit = clock ? Math.min(2, Math.max(0, (this.now() + clock.offset - next.updatedAt) / 1_000)) : 0
      this.state = {
        ...next,
        positionSeconds: Math.min(
          next.metadata.duration || 86_400,
          next.positionSeconds + (next.status === 'playing' && next.playing ? transit : 0),
        ),
        updatedAt: this.now(),
      }
      this.ready = true
      this.resyncing = false
      this.error = ''
      this.notify()
      return
    }
    if (raw.type === 'sync') {
      if (
        !this.ready ||
        identity !== this.state.controllerIdentity ||
        raw.playbackId !== this.state.playbackId ||
        raw.revision !== this.state.revision ||
        !Number.isSafeInteger(raw.syncSequence) ||
        typeof raw.syncSequence !== 'number' ||
        raw.syncSequence <= this.state.syncSequence ||
        typeof raw.position !== 'number' ||
        !Number.isFinite(raw.position) ||
        raw.position < 0 ||
        raw.position > 86_400 ||
        typeof raw.at !== 'number' ||
        !Number.isFinite(raw.at)
      )
        return
      const clock = this.clocks.get(identity)
      const transit = clock ? Math.min(2, Math.max(0, (this.now() + clock.offset - raw.at) / 1_000)) : 0
      this.state = {
        ...this.state,
        positionSeconds: Math.min(
          this.state.metadata.duration || 86_400,
          raw.position + (this.state.status === 'playing' ? transit : 0),
        ),
        updatedAt: this.now(),
        syncSequence: raw.syncSequence,
      }
      this.notify()
      return
    }
    if (raw.type === 'command' && this.isController && typeof raw.id === 'string' && raw.id.length <= 80) {
      const command = readMusicCommand(raw.command)
      if (!command) return
      const key = `${identity}:${raw.id}`
      let error = this.handled.get(key)
      if (error === undefined) {
        error = this.perform(command, identity, name)
        this.handled.set(key, error)
        if (this.handled.size > 256) this.handled.delete(this.handled.keys().next().value!)
      }
      this.send({ type: 'result', id: raw.id, error }, identity)
      return
    }
    if (
      raw.type === 'result' &&
      identity === this.state.controllerIdentity &&
      typeof raw.id === 'string' &&
      this.pending.has(raw.id)
    ) {
      this.pending.delete(raw.id)
      this.error = musicText(raw.error, 200)
      this.notify()
      return
    }
    if (raw.type === 'report' && this.isController && typeof raw.sentAt === 'number' && Number.isFinite(raw.sentAt)) {
      const report = readMusicReport(raw.report)
      if (report) this.receiveReport(identity, report, raw.sentAt)
    }
  }

  tick() {
    if (this.stopped) return
    const now = this.now()
    const electionDelay = this.resyncing && this.connected.size ? 2_000 : 450
    if (!this.ready && now - this.startedAt > electionDelay && this.expectedController() === this.transport.identity) {
      this.ready = true
      this.state = {
        ...this.state,
        controllerIdentity: this.transport.identity,
        revision: this.state.revision + 1,
        syncSequence: 0,
        driverIdentity: '',
        positionSeconds: roomMusicPosition(this.state, now),
        updatedAt: now,
        status: this.state.playing ? 'waiting' : this.state.status,
      }
      this.sendState()
      this.notify()
    }
    if ((!this.ready || this.resyncing) && now - this.lastRequest > 2_000) {
      this.hello()
      this.request()
    }
    if (now - this.lastHello > 15_000) this.hello()
    if (now - this.lastPing > 10_000) {
      for (const id of this.peerIdentities()) if (id !== this.transport.identity) this.ping(id)
      this.lastPing = now
    }
    for (const [id, ping] of this.pings) if (now - ping.at > 10_000) this.pings.delete(id)
    for (const [id, at] of this.pending)
      if (now - at > 10_000) {
        this.pending.delete(id)
        this.error = 'A sala não confirmou a alteração. Tente novamente.'
        this.request()
        this.notify()
      }
    if (!this.isController) return
    this.refreshDriver()
    if (now - this.lastHeartbeat >= 1_500 && this.state.queue.length) {
      this.lastHeartbeat = now
      this.state = { ...this.state, syncSequence: this.state.syncSequence + 1 }
      this.send({
        type: 'sync',
        revision: this.state.revision,
        syncSequence: this.state.syncSequence,
        playbackId: this.state.playbackId,
        position: roomMusicPosition(this.state, now),
        at: now,
      })
    }
    if (now - this.lastFullState > 10_000) this.sendState()
  }
}
