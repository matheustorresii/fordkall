import type { Element } from './core/types/model'

// Session-only document. A commit is an element patch, never a replacement of a live gesture.
export const MAX_BOARD_ELEMENTS = 3_000
export const MAX_BOARD_FILE_BYTES = 2 * 1024 * 1024
export const MAX_BOARD_MESSAGE_BYTES = 16 * 1024 * 1024
export type BoardEpoch = { counter: number; actor: string }
export type BoardElement = {
  id: string
  version: number
  actor: string
  element: Element | null
}
export type BoardDelta = { epoch: BoardEpoch; elements: BoardElement[] }
export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v))
const finite = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e9
const safeId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[\w-]{1,128}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v)
export const validEpoch = (v: unknown): v is BoardEpoch =>
  record(v) &&
  Number.isSafeInteger(v.counter) &&
  Number(v.counter) >= 0 &&
  Number(v.counter) < 1e9 &&
  typeof v.actor === 'string' &&
  v.actor.length <= 128
export const compareEpoch = (a: BoardEpoch, b: BoardEpoch) =>
  a.counter - b.counter || a.actor.localeCompare(b.actor)
export const elementStamp = (e: BoardElement) => `${e.version}:${e.actor}`
export const validBoardElement = (v: unknown): v is Element => {
  if (
    !record(v) ||
    !safeId(v.id) ||
    ![
      'rectangle',
      'diamond',
      'ellipse',
      'line',
      'arrow',
      'freehand',
      'text',
      'image',
      'icon',
    ].includes(String(v.type))
  )
    return false
  if (
    !['x', 'y', 'w', 'h', 'rotation', 'strokeWidth', 'opacity', 'zIndex'].every(
      (k) => finite(v[k]),
    )
  )
    return false
  if (
    !['createdAt', 'updatedAt'].every(
      (k) =>
        typeof v[k] === 'number' &&
        Number.isSafeInteger(v[k]) &&
        Number(v[k]) >= 0,
    )
  )
    return false
  if (
    !['strokeColor', 'fillColor'].every(
      (k) => typeof v[k] === 'string' && String(v[k]).length < 100,
    )
  )
    return false
  if (
    v.type === 'text' &&
    (typeof v.text !== 'string' ||
      v.text.length > 20_000 ||
      !finite(v.fontSize))
  )
    return false
  if (
    v.label != null &&
    (typeof v.label !== 'string' || v.label.length > 20_000)
  )
    return false
  if (
    v.type === 'icon' &&
    (typeof v.iconId !== 'string' || v.iconId.length > 128)
  )
    return false
  if (
    ['arrow', 'line', 'freehand'].includes(String(v.type)) &&
    (!Array.isArray(v.points) ||
      v.points.length > 30_000 ||
      !v.points.every((p) => record(p) && finite(p.x) && finite(p.y)))
  )
    return false
  if (
    v.type === 'image' &&
    (typeof v.src !== 'string' ||
      !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(
        v.src,
      ) ||
      v.src.length * 0.75 > MAX_BOARD_FILE_BYTES + 100)
  )
    return false
  return jsonBytes(v) <= 3 * 1024 * 1024
}

export class BoardReplica {
  epoch: BoardEpoch = { counter: 0, actor: '' }
  private elements = new Map<string, BoardElement>()
  snapshot(): BoardDelta {
    return {
      epoch: { ...this.epoch },
      elements: [...this.elements.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    }
  }
  scene(): Element[] {
    return this.snapshot()
      .elements.flatMap((e) => (e.element ? [structuredClone(e.element)] : []))
      .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
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
  localDelta(changed: Element[], removed: string[], actor: string): BoardDelta {
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
  apply(value: unknown): BoardDelta | null {
    if (
      !record(value) ||
      !validEpoch(value.epoch) ||
      !Array.isArray(value.elements) ||
      value.elements.length > MAX_BOARD_ELEMENTS ||
      jsonBytes(value) > MAX_BOARD_MESSAGE_BYTES
    )
      throw new Error('Lousa recebida em formato inválido ou muito grande.')
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
            (validBoardElement(e.element) && e.element.id === e.id)),
      )
    )
      throw new Error('Esta alteração da lousa não é válida.')
    const next =
      order > 0 ? new Map<string, BoardElement>() : new Map(this.elements)
    const changes: BoardElement[] = []
    for (const e of value.elements as BoardElement[]) {
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
      next.size > MAX_BOARD_ELEMENTS ||
      jsonBytes([...next.values()]) > 12 * 1024 * 1024
    )
      throw new Error('A lousa está cheia. Exporte e limpe para continuar.')
    if (!changes.length && !order) return null
    this.elements = next
    this.epoch = { ...value.epoch }
    return { epoch: { ...this.epoch }, elements: changes }
  }
  clear(actor: string): BoardDelta {
    const delta = {
      epoch: { counter: this.epoch.counter + 1, actor },
      elements: [],
    }
    this.apply(delta)
    return delta
  }
}
