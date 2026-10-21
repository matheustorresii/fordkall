import { validStroke, safeId, type DrawingStroke } from './model.ts'

// Session-only document. A commit is an element patch, never a replacement of a live gesture.
export const MAX_DRAWING_ELEMENTS = 1_000
export const MAX_DRAWING_MESSAGE_BYTES = 8 * 1024 * 1024
export type DrawingEpoch = { counter: number; actor: string }
export type DrawingElement = {
  id: string
  version: number
  actor: string
  element: DrawingStroke | null
}
export type DrawingDelta = { epoch: DrawingEpoch; elements: DrawingElement[] }
export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v))
export const validEpoch = (v: unknown): v is DrawingEpoch =>
  record(v) &&
  Number.isSafeInteger(v.counter) &&
  Number(v.counter) >= 0 &&
  Number(v.counter) < 1e9 &&
  typeof v.actor === 'string' &&
  v.actor.length <= 128
export const compareEpoch = (a: DrawingEpoch, b: DrawingEpoch) =>
  a.counter - b.counter || a.actor.localeCompare(b.actor)
export const elementStamp = (e: DrawingElement) => `${e.version}:${e.actor}`
export class DrawingReplica {
  epoch: DrawingEpoch = { counter: 0, actor: '' }
  private elements = new Map<string, DrawingElement>()
  snapshot(): DrawingDelta {
    return {
      epoch: { ...this.epoch },
      elements: [...this.elements.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    }
  }
  scene(): DrawingStroke[] {
    return this.snapshot()
      .elements.flatMap((e) => (e.element ? [structuredClone(e.element)] : []))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }
  get count() {
    return [...this.elements.values()].filter((e) => e.element).length
  }
  get hasContent() {
    return this.elements.size > 0 || this.epoch.counter > 0
  }
  digest() {
    let hash = 2166136261
    const value = `${this.epoch.counter}:${this.epoch.actor}|${this.snapshot()
      .elements.map((e) => `${e.id}:${elementStamp(e)}`)
      .join('|')}`
    for (let i = 0; i < value.length; i++)
      hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
    return `${value.length}:${hash >>> 0}`
  }
  localDelta(
    changed: DrawingStroke[],
    removed: string[],
    actor: string,
  ): DrawingDelta {
    return {
      epoch: { ...this.epoch },
      elements: [
        ...changed.map((element) => ({ id: element.id, element })),
        ...removed.map((id) => ({ id, element: null })),
      ].map((e) => ({
        ...e,
        version: (this.elements.get(e.id)?.version || 0) + 1,
        actor,
      })),
    }
  }
  apply(value: unknown): DrawingDelta | null {
    if (
      !record(value) ||
      !validEpoch(value.epoch) ||
      !Array.isArray(value.elements) ||
      value.elements.length > MAX_DRAWING_ELEMENTS ||
      jsonBytes(value) > MAX_DRAWING_MESSAGE_BYTES
    )
      throw new Error('Desenho recebida em formato inválido ou muito grande.')
    const order = compareEpoch(value.epoch, this.epoch)
    if (order < 0) return null
    if (
      !value.elements.every(
        (e) =>
          record(e) &&
          safeId(e.id) &&
          safeId(e.actor) &&
          Number.isSafeInteger(e.version) &&
          Number(e.version) > 0 &&
          Number(e.version) < 1e9 &&
          (e.element === null ||
            (validStroke(e.element) && e.element.id === e.id)),
      )
    )
      throw new Error('Esta alteração do desenho não é válida.')
    const next =
      order > 0 ? new Map<string, DrawingElement>() : new Map(this.elements)
    const changes: DrawingElement[] = []
    for (const e of value.elements as DrawingElement[]) {
      const old = next.get(e.id)
      if (
        old &&
        (e.version < old.version ||
          (e.version === old.version && e.actor <= old.actor))
      )
        continue
      const copy = structuredClone(e)
      next.set(e.id, copy)
      changes.push(copy)
    }
    if (
      next.size > MAX_DRAWING_ELEMENTS ||
      jsonBytes([...next.values()]) > 6 * 1024 * 1024
    )
      throw new Error('O desenho está cheio. Limpe para continuar.')
    if (!changes.length && !order) return null
    this.elements = next
    this.epoch = { ...value.epoch }
    return { epoch: { ...this.epoch }, elements: changes }
  }
  clear(actor: string): DrawingDelta {
    const delta = {
      epoch: { counter: this.epoch.counter + 1, actor },
      elements: [],
    }
    this.apply(delta)
    return delta
  }
}
