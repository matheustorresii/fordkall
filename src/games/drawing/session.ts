import type { DrawingStroke } from './model.ts'
import {
  DrawingReplica,
  compareEpoch,
  type DrawingDelta,
  type DrawingElement,
} from './replica.ts'

export interface DrawingTransport {
  identity: string
  peers: () => string[]
  control: (
    message: unknown,
    to?: string,
    reliable?: boolean,
  ) => Promise<unknown>
  scene: (message: DrawingDelta, to?: string) => Promise<unknown>
}
export type DrawingView = {
  revision: number
  sceneRevision: number
  count: number
  pending: boolean
  error: string
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Session-only Gartic strokes. No document tools, cursors or shared activity controls. */
export class DrawingSession {
  readonly replica = new DrawingReplica()
  private listeners = new Set<() => void>()
  private pendingElements = new Map<string, DrawingElement>()
  private pendingClear = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private running = false
  private sending = false
  private sendFailed = false
  private retryAfter = 0
  private requests = new Map<string, number>()
  private lastSnapshot = new Map<string, number>()
  private sendWaiters = new Set<() => void>()
  private view: DrawingView = {
    revision: 0,
    sceneRevision: 0,
    count: 0,
    pending: false,
    error: '',
  }

  readonly transport: DrawingTransport
  constructor(transport: DrawingTransport) {
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
    this.view = {
      ...this.view,
      revision: this.view.revision + 1,
      sceneRevision: this.view.sceneRevision + Number(sceneChanged),
      count: this.replica.count,
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
      if (this.replica.hasContent) this.sync()
    }, 8_000)
  }
  stop() {
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
    this.schedule()
  }
  peersChanged = () => {
    this.requests.clear()
    this.emit()
    this.sync()
  }
  receiveControl = (sender: string, message: unknown) => {
    if (
      !this.running ||
      !this.transport.peers().includes(sender) ||
      !isRecord(message)
    )
      return
    if (message.kind === 'hello') {
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
        .catch(() => this.setError('Não foi possível sincronizar o desenho.'))
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
          : 'Não foi possível ler o desenho.',
      )
    }
  }
  update = (
    elements: DrawingStroke[],
    removed: string[] = [],
    epoch = this.replica.epoch,
  ) => {
    // A gesture from before clear must not resurrect the previous drawing.
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
      return true
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
    const delta: DrawingDelta = {
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
        'Sem conexão com o desenho. Suas alterações estão nesta sessão; tente sincronizar novamente.',
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
