// Deliberately independent of React, LiveKit and Supabase for deterministic failure tests.
export const GAME_RECONNECT_GRACE_MS = 90_000
export interface RecoverableState {
  gameId: string
  revision: number
  controllerIdentity: string
  phase?: string
  players?: Array<{
    identity: string
    name?: string
    alive?: boolean
    away?: boolean
    influence?: number
    stack?: number
    inHand?: boolean
    team?: unknown
  }>
}
export interface GameCheckpoint {
  state: RecoverableState
  secrets: Record<string, unknown>
  authority: unknown
}
export interface CheckpointRecord {
  serverNow?: string
  clockAt?: number
  topic: string
  owner: string
  epoch: number
  owns: boolean
  leaseUntil: string
  heartbeatAt: string
  previousHeartbeatAt?: string
  revision: number
  state: RecoverableState | null
  savedAt: string
  ownPrivate?: unknown
  payload?: { secrets?: Record<string, unknown>; authority?: unknown } | null
}
export type GameRecoveryRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>
export interface RecoveryBinding {
  capture: () => GameCheckpoint
  restore: (checkpoint: GameCheckpoint, authoritative: boolean) => void
  ownPrivate: (value: unknown) => void
  committed: (checkpoint: GameCheckpoint, epoch: number) => void
  changed: () => void
}
const clone = <T>(value: T): T => structuredClone(value)
const deadlines = new Set([
  'turnExpiresAt',
  'transitionAt',
  'deadline',
  'expiresAt',
  'resolvesAt',
])
export function shiftGameDeadlines<T>(value: T, elapsed: number): T {
  if (Array.isArray(value))
    return value.map((item) => shiftGameDeadlines(item, elapsed)) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      deadlines.has(key) && typeof child === 'number' && child > 0
        ? child + (Number.isFinite(elapsed) ? elapsed : 0)
        : shiftGameDeadlines(child, elapsed),
    ]),
  ) as T
}

export class GameRecoveryCoordinator {
  readonly session: string
  records = new Map<string, CheckpointRecord>()
  bindings = new Map<string, RecoveryBinding>()
  ready = false
  error = ''
  private loading: Promise<void> | null = null
  private queues = new Map<string, Promise<unknown>>()
  private missing = new Map<string, number>()
  private pauses = new Map<string, number>()
  private ownTopics = new Set<string>()
  private lastRefresh = 0
  private claims = new Map<string, Promise<CheckpointRecord>>()
  private serverOffset = 0
  private serverNow() {
    return this.now() + this.serverOffset
  }
  private observeServer(value?: string) {
    if (value && Number.isFinite(Date.parse(value)))
      this.serverOffset = Date.parse(value) - this.now()
  }
  private normalizeState(record: CheckpointRecord) {
    if (!record.state) return null
    if (typeof record.clockAt !== 'number') return record.state
    const elapsed = Math.max(0, this.serverNow() - Date.parse(record.savedAt))
    return shiftGameDeadlines(
      record.state,
      this.now() - record.clockAt - elapsed,
    )
  }
  readonly room: string
  readonly identity: string
  readonly rpc: GameRecoveryRpc
  readonly connected: () => string[]
  private now: () => number
  constructor(
    room: string,
    identity: string,
    rpc: GameRecoveryRpc,
    connected: () => string[],
    now = () => Date.now(),
    session = crypto.randomUUID(),
  ) {
    this.room = room
    this.identity = identity
    this.rpc = rpc
    this.connected = connected
    this.now = now
    this.session = session
  }
  private notify() {
    for (const binding of this.bindings.values()) binding.changed()
  }
  bind(topic: string, binding: RecoveryBinding) {
    this.bindings.set(topic, binding)
    return () => {
      this.bindings.delete(topic)
    }
  }
  authority(topic: string, fallback: string) {
    const record = this.records.get(topic)
    return record ? record.owner : fallback
  }
  owns(topic: string) {
    const row = this.records.get(topic)
    return Boolean(row?.owns && Date.parse(row.leaseUntil) > this.serverNow())
  }
  accepts(topic: string, identity: string, epoch: number | undefined) {
    const record = this.records.get(topic)
    return Boolean(
      record &&
      record.owner === identity &&
      record.epoch === epoch &&
      Date.parse(record.leaseUntil) > this.serverNow(),
    )
  }
  epoch(topic: string) {
    return this.records.get(topic)?.epoch || 0
  }
  missingPlayers(state: RecoverableState) {
    if (
      !state.gameId ||
      ['lobby', 'finished', 'won', 'lost'].includes(state.phase || '')
    )
      return []
    const connected = new Set(this.connected())
    const players = (state.players || []).filter(
      (player) =>
        player.alive !== false &&
        !player.away &&
        player.influence !== 0 &&
        player.team !== null &&
        !(player.stack === 0 && player.inHand !== true),
    )
    for (const player of players) {
      if (connected.has(player.identity)) this.missing.delete(player.identity)
      else if (!this.missing.has(player.identity))
        this.missing.set(player.identity, this.now())
    }
    return players.filter(
      (player) =>
        !connected.has(player.identity) &&
        this.now() - (this.missing.get(player.identity) || 0) <
          GAME_RECONNECT_GRACE_MS,
    )
  }
  hasGrace(identity: string) {
    const since = this.missing.get(identity)
    return since !== undefined && this.now() - since < GAME_RECONNECT_GRACE_MS
  }
  paused(topic: string) {
    const state = this.bindings.get(topic)?.capture().state
    const paused =
      !this.ready ||
      Boolean(this.error) ||
      Boolean(state?.gameId && this.missingPlayers(state).length)
    if (paused && !this.pauses.has(topic)) this.pauses.set(topic, this.now())
    return paused
  }
  rosterChanged() {
    for (const [topic] of this.bindings) this.paused(topic)
    this.notify()
  }
  private apply(record: CheckpointRecord) {
    this.observeServer(record.serverNow)
    this.records.set(record.topic, record)
    const binding = this.bindings.get(record.topic)
    if (!binding || !record.state || this.queues.has(record.topic)) return
    const current = binding.capture().state
    if (
      record.revision < current.revision &&
      current.controllerIdentity === record.owner
    )
      return
    if (record.owns && record.payload) {
      this.ownTopics.add(record.topic)
      binding.restore(
        {
          state: this.normalizeState(record)!,
          secrets: record.payload.secrets || {},
          authority: record.payload.authority ?? null,
        },
        true,
      )
    } else {
      this.ownTopics.delete(record.topic)
      binding.restore(
        { state: this.normalizeState(record)!, secrets: {}, authority: null },
        false,
      )
      binding.ownPrivate(record.ownPrivate)
    }
  }
  async refresh() {
    if (this.loading) return this.loading
    this.loading = (async () => {
      try {
        const rows = (await this.rpc('list_game_checkpoints', {
          p_room: this.room,
          p_session: this.session,
        })) as CheckpointRecord[]
        for (const row of rows) this.apply(row)
        this.ready = true
        this.error = ''
        this.lastRefresh = this.now()
        this.rosterChanged()
      } catch {
        this.error =
          'Não foi possível sincronizar a recuperação da mesa. Tentando novamente…'
        this.notify()
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }
  async heartbeat() {
    const topics = [...this.ownTopics]
    if (topics.length) {
      try {
        const renewed = (await this.rpc('renew_game_checkpoints', {
          p_room: this.room,
          p_session: this.session,
          p_topics: topics,
        })) as Array<{ topic: string; leaseUntil: string; serverNow?: string }>
        this.observeServer(renewed[0]?.serverNow)
        const valid = new Map(renewed.map((row) => [row.topic, row.leaseUntil]))
        for (const topic of topics) {
          const row = this.records.get(topic)
          if (row && valid.has(topic)) row.leaseUntil = valid.get(topic)!
          else this.ownTopics.delete(topic)
        }
        this.error = ''
      } catch {
        this.error =
          'A mesa está aguardando conexão com o servidor. Suas cartas foram preservadas.'
      }
    }
    if (!this.ready || this.error || this.now() - this.lastRefresh > 24_000)
      await this.refresh()
    for (const [topic, binding] of this.bindings) {
      if (this.queues.has(topic) || this.claims.has(topic)) continue
      const record = this.records.get(topic),
        state = binding.capture().state
      if (!record?.state && !state.gameId) continue
      if (record && Date.parse(record.leaseUntil) <= this.serverNow()) {
        const peers = this.connected()
          .filter((id) => id !== record.owner)
          .sort()
        if ((peers[0] || this.connected().sort()[0]) === this.identity)
          await this.claim(topic).catch(() => {})
      }
      if (this.owns(topic) && this.pauses.has(topic) && !this.paused(topic)) {
        await this.transact(topic, () => null, true).catch(() => {})
      }
    }
    this.rosterChanged()
  }
  private async acquire(topic: string) {
    const binding = this.bindings.get(topic)
    if (!binding) throw Error('GAME_NOT_MOUNTED')
    const previous = this.records.get(topic)
    const record = (await this.rpc('claim_game_checkpoint', {
      p_room: this.room,
      p_topic: topic,
      p_session: this.session,
    })) as CheckpointRecord
    this.observeServer(record.serverNow)
    this.records.set(topic, record)
    if (!record.owns) {
      this.ownTopics.delete(topic)
      this.notify()
      throw Error('GAME_LEASE_LOST')
    }
    this.ownTopics.add(topic)
    if (
      record.state &&
      record.payload &&
      (previous?.epoch !== record.epoch || !previous?.owns)
    ) {
      const heartbeat = Date.parse(
        record.previousHeartbeatAt || record.heartbeatAt,
      )
      const elapsed =
        typeof record.clockAt === 'number'
          ? this.now() -
            record.clockAt -
            Math.max(0, heartbeat - Date.parse(record.savedAt))
          : Math.max(0, this.serverNow() - heartbeat)
      const recovered = shiftGameDeadlines(
        {
          state: { ...record.state, controllerIdentity: this.identity },
          secrets: record.payload.secrets || {},
          authority: record.payload.authority ?? null,
        },
        elapsed,
      )
      recovered.state.revision = record.revision + 1
      const saved = (await this.rpc('save_game_checkpoint', {
        p_room: this.room,
        p_topic: topic,
        p_session: this.session,
        p_epoch: record.epoch,
        p_state: recovered.state,
        p_private: {
          clockAt: this.now(),
          secrets: recovered.secrets,
          authority: recovered.authority,
        },
      }).catch((failure) => {
        this.error =
          'Não foi possível confirmar a retomada. As cartas continuam salvas; aguardando conexão.'
        this.ownTopics.delete(topic)
        this.notify()
        throw failure
      })) as { savedAt: string; leaseUntil: string }
      record.state = clone(recovered.state)
      record.revision = recovered.state.revision
      record.savedAt = saved.savedAt
      record.clockAt = this.now()
      this.observeServer(saved.savedAt)
      record.leaseUntil = saved.leaseUntil
      record.payload = {
        secrets: recovered.secrets,
        authority: recovered.authority,
      }
      this.pauses.delete(topic)
      binding.restore(recovered, true)
      binding.committed(recovered, record.epoch)
      this.notify()
    }
    return record
  }
  private claim(topic: string) {
    const existing = this.claims.get(topic)
    if (existing) return existing
    const promise = this.acquire(topic).finally(() => this.claims.delete(topic))
    this.claims.set(topic, promise)
    return promise
  }
  async transact(
    topic: string,
    action: () => string | null,
    resumeOnly = false,
    allowPaused = false,
  ): Promise<string | null> {
    const previous = this.queues.get(topic) || Promise.resolve()
    const task = previous
      .catch(() => {})
      .then(async () => {
        if (!this.ready) {
          await this.refresh()
          if (!this.ready) throw Error('GAME_NOT_READY')
        }
        const binding = this.bindings.get(topic)
        if (!binding) throw Error('GAME_NOT_MOUNTED')
        const record = this.claims.has(topic)
          ? await this.claims.get(topic)!
          : this.owns(topic)
            ? this.records.get(topic)!
            : await this.claim(topic)
        if (this.paused(topic) && !allowPaused)
          return 'A partida está pausada para reconexão. As cartas foram preservadas.'
        const before = clone(binding.capture())
        const pausedAt = this.pauses.get(topic)
        if (pausedAt) {
          binding.restore(
            shiftGameDeadlines(before, this.now() - pausedAt),
            true,
          )
          this.pauses.delete(topic)
        }
        let result: string | null
        try {
          result = action()
          const next = binding.capture()
          // A recovered authority and a resumed timer need a new monotonic revision even without a player action.
          if (
            (resumeOnly ||
              record.owner !== before.state.controllerIdentity ||
              (next.state.revision <= record.revision && pausedAt)) &&
            next.state.revision <= record.revision
          )
            next.state = {
              ...next.state,
              controllerIdentity: this.identity,
              revision: record.revision + 1,
            }
          if (next.state.revision <= record.revision) return result
          next.state = { ...next.state, controllerIdentity: this.identity }
          const saved = (await this.rpc('save_game_checkpoint', {
            p_room: this.room,
            p_topic: topic,
            p_session: this.session,
            p_epoch: record.epoch,
            p_state: next.state,
            p_private: {
              clockAt: this.now(),
              secrets: next.secrets,
              authority: next.authority,
            },
          })) as { savedAt: string; leaseUntil: string }
          record.state = clone(next.state)
          record.revision = next.state.revision
          record.savedAt = saved.savedAt
          record.clockAt = this.now()
          this.observeServer(saved.savedAt)
          record.leaseUntil = saved.leaseUntil
          record.payload = {
            secrets: clone(next.secrets),
            authority: clone(next.authority),
          }
          this.error = ''
          binding.restore(next, true)
          binding.committed(next, record.epoch)
          this.notify()
          return result
        } catch (failure) {
          binding.restore(before, true)
          this.error =
            'Não foi possível confirmar a jogada. A mesa foi preservada; aguardando conexão.'
          this.ownTopics.delete(topic)
          this.notify()
          void this.refresh()
          throw failure
        }
      })
    this.queues.set(topic, task)
    try {
      return await task
    } finally {
      if (this.queues.get(topic) === task) this.queues.delete(topic)
    }
  }
}
