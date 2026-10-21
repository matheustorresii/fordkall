import type { Element, Viewport } from './core/types/model'
import {
  BoardReplica,
  compareEpoch,
  type BoardDelta,
  type BoardElement,
} from './replica.ts'

export const BOARD_CONTROL_TOPIC = 'ford-kall.excalitower.control.v2'
export const BOARD_SCENE_TOPIC = 'ford-kall.excalitower.scene.v2'
export interface BoardTransport {
  identity: string
  peers: () => string[]
  control: (
    message: unknown,
    to?: string,
    reliable?: boolean,
  ) => Promise<unknown>
  scene: (message: BoardDelta, to?: string) => Promise<unknown>
}
export type BoardCursor = {
  x: number
  y: number
  tool: 'pointer' | 'laser'
  button: 'up' | 'down'
}
export type BoardPresence = {
  identity: string
  editing: boolean
  cursor: BoardCursor | null
  seen: number
}
export type BoardView = {
  revision: number
  sceneRevision: number
  count: number
  presence: BoardPresence[]
  pending: boolean
  error: string
  openId: string
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Reliable scene streams + lossy cursors. Every peer retains a replica, even with the UI closed. */
export class ExcalitowerSession {
  readonly replica = new BoardReplica()
  // Per-viewer camera/tool preferences are memory-only and never sent to other participants.
  localViewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }
  readOnly = false
  private listeners = new Set<() => void>()
  private presence = new Map<string, BoardPresence>()
  private pendingElements = new Map<string, BoardElement>()
  private pendingClear = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private running = false
  private sending = false
  private sendFailed = false
  private retryAfter = 0
  private visible = false
  private editing = true
  private lastCursor = 0
  private requests = new Map<string, number>()
  private lastSnapshot = new Map<string, number>()
  // Keep closed activities as tombstones too: a delayed hello/open must not
  // bring the board back over a game that the room has already started.
  private activityId = ''
  private sendWaiters = new Set<() => void>()
  private view: BoardView = {
    revision: 0,
    sceneRevision: 0,
    count: 0,
    presence: [],
    pending: false,
    error: '',
    openId: '',
  }

  readonly transport: BoardTransport
  constructor(transport: BoardTransport) {
    this.transport = transport
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getView = () => this.view
  private emit(sceneChanged = false) {
    const peers = [...this.presence.values()]
    const presence =
      peers.length === this.view.presence.length &&
      peers.every((peer, i) => peer === this.view.presence[i])
        ? this.view.presence
        : peers
    this.view = {
      ...this.view,
      revision: this.view.revision + 1,
      sceneRevision: this.view.sceneRevision + Number(sceneChanged),
      count: this.replica.count,
      presence,
      pending:
        this.sending || this.pendingClear || this.pendingElements.size > 0,
    }
    for (const listener of this.listeners) listener()
  }
  setError = (error: string) => {
    if (this.view.error === error) return
    this.view = { ...this.view, error }
    this.emit()
  }
  open = () => {
    this.activityId = this.nextActivityId()
    this.view = {
      ...this.view,
      openId: this.activityId,
    }
    this.safeControl({ kind: 'open', id: this.view.openId })
    this.emit()
  }
  closeForAll = () => {
    this.activityId = this.nextActivityId()
    this.view = { ...this.view, openId: '' }
    this.safeControl({ kind: 'close', id: this.activityId })
    this.emit()
  }
  private nextActivityId() {
    const previousTime = Number(this.activityId.split(':')[0]) || 0
    return `${Math.max(Date.now(), previousTime + 1)}:${this.transport.identity}`
  }
  private safeControl(message: unknown, to?: string, reliable = true) {
    if (!this.running) return
    void this.transport.control(message, to, reliable).catch(() => {
      /* reconnect handshake repairs missed controls */
    })
  }
  start() {
    if (this.running) return
    this.running = true
    this.sync()
    this.retry = setTimeout(() => this.sync(), 1_200)
    this.heartbeat = setInterval(() => {
      const now = Date.now()
      for (const [id, peer] of this.presence)
        if (now - peer.seen > 20_000 || !this.transport.peers().includes(id))
          this.presence.delete(id)
      if (this.visible) this.sendPresence()
      if (this.replica.hasContent) this.sync()
      if (this.presence.size || this.view.presence.length) this.emit()
    }, 8_000)
  }
  stop() {
    this.setVisible(false)
    this.running = false
    clearTimeout(this.timer)
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    this.timer = undefined
    this.heartbeat = undefined
    this.retry = undefined
  }
  sync = () => {
    this.retryAfter = 0
    this.requests.clear()
    this.safeControl({ kind: 'hello', digest: this.replica.digest() })
    if (this.visible) this.sendPresence()
    this.schedule()
  }
  peersChanged = () => {
    const peers = this.transport.peers()
    for (const id of this.presence.keys())
      if (!peers.includes(id)) this.presence.delete(id)
    this.requests.clear()
    this.emit()
    this.sync()
  }
  setVisible = (visible: boolean, editing = this.editing) => {
    this.visible = visible
    this.editing = editing
    this.sendPresence()
    if (visible) this.sync()
  }
  private sendPresence(cursor?: BoardCursor | null) {
    this.safeControl(
      {
        kind: 'presence',
        visible: this.visible,
        editing: this.editing,
        ...(cursor === undefined ? {} : { cursor }),
      },
      undefined,
      false,
    )
  }
  pointer = (cursor: BoardCursor | null) => {
    if (!this.visible || Date.now() - this.lastCursor < 80) return
    this.lastCursor = Date.now()
    this.sendPresence(cursor)
  }

  receiveControl = (sender: string, message: unknown) => {
    if (
      !this.running ||
      !this.transport.peers().includes(sender) ||
      !isRecord(message)
    )
      return
    if (message.kind === 'hello') {
      if (this.view.openId)
        this.safeControl({ kind: 'open', id: this.view.openId }, sender)
      else if (this.activityId)
        this.safeControl({ kind: 'close', id: this.activityId }, sender)
      if (this.visible) this.sendPresence()
      if (message.digest !== this.replica.digest() && this.replica.hasContent)
        this.safeControl(
          { kind: 'offer', digest: this.replica.digest() },
          sender,
        )
    } else if (
      message.kind === 'offer' &&
      typeof message.digest === 'string' &&
      message.digest.length < 80 &&
      message.digest !== this.replica.digest()
    ) {
      if (Date.now() - (this.requests.get(message.digest) || 0) < 25_000) return
      this.requests.set(message.digest, Date.now())
      this.safeControl({ kind: 'request' }, sender)
    } else if (message.kind === 'request') {
      if (Date.now() - (this.lastSnapshot.get(sender) || 0) < 2_000) return
      this.lastSnapshot.set(sender, Date.now())
      void this.transport
        .scene(this.replica.snapshot(), sender)
        .catch(() =>
          this.setError(
            'Não foi possível sincronizar a lousa. Tentaremos novamente.',
          ),
        )
    } else if (
      (message.kind === 'open' || message.kind === 'close') &&
      typeof message.id === 'string' &&
      /^\d{13}:.{1,180}$/.test(message.id)
    ) {
      if (message.id > this.activityId) {
        this.activityId = message.id
        this.view = {
          ...this.view,
          openId: message.kind === 'open' ? message.id : '',
        }
        this.emit()
      }
    } else if (message.kind === 'presence') {
      if (message.visible !== true) this.presence.delete(sender)
      else {
        let cursor: BoardCursor | null =
          message.cursor === null
            ? null
            : this.presence.get(sender)?.cursor || null
        if (
          isRecord(message.cursor) &&
          typeof message.cursor.x === 'number' &&
          typeof message.cursor.y === 'number' &&
          Number.isFinite(message.cursor.x) &&
          Number.isFinite(message.cursor.y) &&
          Math.abs(message.cursor.x) < 1e9 &&
          Math.abs(message.cursor.y) < 1e9
        ) {
          cursor = {
            x: message.cursor.x,
            y: message.cursor.y,
            tool: message.cursor.tool === 'laser' ? 'laser' : 'pointer',
            button: message.cursor.button === 'down' ? 'down' : 'up',
          }
        }
        this.presence.set(sender, {
          identity: sender,
          editing: message.editing === true,
          cursor,
          seen: Date.now(),
        })
      }
      this.emit()
    }
  }
  receiveScene = (sender: string, value: unknown) => {
    if (!this.running || !this.transport.peers().includes(sender)) return
    try {
      const oldEpoch = { ...this.replica.epoch }
      const changed = this.replica.apply(value)
      if (!changed) return
      if (compareEpoch(this.replica.epoch, oldEpoch) > 0) {
        this.pendingElements.clear()
        this.pendingClear = false
      }
      this.emit(true)
    } catch (error) {
      this.setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível ler a lousa.',
      )
    }
  }
  update = (
    elements: Element[],
    removed: string[] = [],
    epoch = this.replica.epoch,
  ) => {
    // An old mounted editor must not resurrect a document that another peer just cleared.
    if (compareEpoch(epoch, this.replica.epoch) !== 0) return
    try {
      const local = this.replica.localDelta(
        elements,
        removed,
        this.transport.identity,
      )
      if (!local.elements.length) return
      const delta = this.replica.apply(local)
      if (!delta) return
      for (const element of delta.elements)
        this.pendingElements.set(element.id, element)
      this.emit(true)
      this.schedule()
    } catch (error) {
      this.setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível compartilhar a alteração.',
      )
    }
  }
  clear = () => {
    this.replica.clear(this.transport.identity)
    this.pendingElements.clear()
    this.pendingClear = true
    this.emit(true)
    this.schedule()
  }
  flushNow = async () => {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.sending)
      await new Promise<void>((resolve) => this.sendWaiters.add(resolve))
    await this.flush()
    if (this.sendFailed)
      throw new Error(
        this.view.error || 'Não foi possível enviar o último traço.',
      )
  }
  private schedule() {
    if (
      !this.running ||
      this.timer ||
      this.sending ||
      Date.now() < this.retryAfter ||
      (!this.pendingClear && !this.pendingElements.size)
    )
      return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, 120)
  }
  private async flush() {
    if (!this.running || this.sending) return
    const delta: BoardDelta = {
      epoch: { ...this.replica.epoch },
      elements: [...this.pendingElements.values()],
    }
    const wasClear = this.pendingClear
    this.pendingClear = false
    this.pendingElements.clear()
    // No remote peers? Keep the local replica; a newcomer obtains it through the handshake.
    if (!this.transport.peers().length) {
      this.emit()
      return
    }
    this.sending = true
    this.emit()
    try {
      await this.transport.scene(delta)
      if (this.sendFailed) {
        this.sendFailed = false
        this.view = { ...this.view, error: '' }
      }
    } catch {
      this.sendFailed = true
      this.retryAfter = Date.now() + 2_000
      if (compareEpoch(delta.epoch, this.replica.epoch) === 0) {
        for (const element of delta.elements)
          if (!this.pendingElements.has(element.id))
            this.pendingElements.set(element.id, element)
        this.pendingClear ||= wasClear
      }
      this.setError(
        'Sem conexão com a lousa. Suas alterações estão nesta sessão; tente sincronizar novamente.',
      )
    } finally {
      this.sending = false
      for (const resolve of this.sendWaiters) resolve()
      this.sendWaiters.clear()
      this.emit()
      if (!this.sendFailed) this.schedule()
    }
  }
}
