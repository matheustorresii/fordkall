import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types'

// This document only lives in the room's memory. No database or browser storage.
export const MAX_BOARD_ELEMENTS = 3_000
export const MAX_BOARD_FILE_BYTES = 2 * 1024 * 1024
export const MAX_BOARD_FILES_BYTES = 8 * 1024 * 1024
export const MAX_BOARD_SCENE_BYTES = 4 * 1024 * 1024
export const MAX_BOARD_MESSAGE_BYTES = 16 * 1024 * 1024
export type BoardEpoch = { counter: number; actor: string }
export type BoardDelta = { epoch: BoardEpoch; elements: readonly ExcalidrawElement[]; files: BinaryFiles }

const types = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame'])
const mimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const encoder = new TextEncoder()
export const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(value)
export const validEpoch = (value: unknown): value is BoardEpoch => record(value) && Number.isSafeInteger(value.counter) && Number(value.counter) >= 0 && Number(value.counter) < 1e9 && typeof value.actor === 'string' && value.actor.length <= 128
export const compareEpoch = (a: BoardEpoch, b: BoardEpoch) => a.counter - b.counter || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0)
export const elementStamp = (element: ExcalidrawElement) => `${element.version}:${element.versionNonce}`
const newer = (a: ExcalidrawElement, b: ExcalidrawElement) => a.version > b.version || (a.version === b.version && a.versionNonce < b.versionNonce)

export const validBoardElement = (value: unknown): value is ExcalidrawElement => {
  if (!record(value) || !safeId(value.id) || !types.has(String(value.type))) return false
  if (!['x', 'y', 'width', 'height', 'angle'].every((key) => finite(value[key]))) return false
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1 || Number(value.version) > 1e9 || !Number.isSafeInteger(value.versionNonce) || Number(value.versionNonce) < 0 || Number(value.versionNonce) > 0xffffffff) return false
  if (typeof value.isDeleted !== 'boolean' || typeof value.strokeColor !== 'string' || value.strokeColor.length > 100) return false
  if (typeof value.backgroundColor !== 'string' || value.backgroundColor.length > 100 || !finite(value.opacity)) return false
  if (!Array.isArray(value.groupIds) || value.groupIds.length > 100 || !value.groupIds.every(safeId)) return false
  if (value.index != null && (typeof value.index !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(value.index))) return false
  if (value.link != null && (typeof value.link !== 'string' || value.link.length > 2_000 || !/^https?:\/\//i.test(value.link))) return false
  if (value.type === 'text' && (typeof value.text !== 'string' || value.text.length > 20_000 || !finite(value.fontSize) || !finite(value.fontFamily))) return false
  if (value.type === 'image' && value.fileId != null && !safeId(value.fileId)) return false
  if (['line', 'arrow', 'freedraw'].includes(String(value.type)) && (!Array.isArray(value.points) || value.points.length > 30_000 || !value.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite)))) return false
  return jsonBytes(value) <= 1024 * 1024
}

export const validBoardFile = (value: unknown): value is BinaryFileData => {
  if (!record(value) || !safeId(value.id) || !mimes.has(String(value.mimeType)) || typeof value.created !== 'number' || !Number.isFinite(value.created) || value.created < 0) return false
  if (typeof value.dataURL !== 'string' || !value.dataURL.startsWith(`data:${value.mimeType};base64,`)) return false
  const base64 = value.dataURL.slice(value.dataURL.indexOf(',') + 1)
  return base64.length > 0 && base64.length * 0.75 <= MAX_BOARD_FILE_BYTES + 2 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64)
}

export class BoardReplica {
  epoch: BoardEpoch = { counter: 0, actor: '' }
  private elements = new Map<string, ExcalidrawElement>()
  private files: BinaryFiles = Object.create(null)
  private sizes = new Map<string, number>()
  private sceneBytes = 0
  private fileBytes = 0

  snapshot(): BoardDelta {
    return { epoch: { ...this.epoch }, elements: [...this.elements.values()].sort((a, b) => {
      const ai = a.index || '', bi = b.index || ''
      return ai < bi ? -1 : ai > bi ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }), files: { ...this.files } }
  }

  digest() {
    // Includes nonces and tombstones, not just a sum of versions (which can collide).
    let hash = 2166136261
    const value = `${this.epoch.counter}:${this.epoch.actor}|${this.snapshot().elements.map((e) => `${e.id}:${elementStamp(e)}`).join('|')}|${Object.keys(this.files).sort().join('|')}`
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
    return `${value.length}:${hash >>> 0}`
  }

  get count() { return [...this.elements.values()].filter((e) => !e.isDeleted).length }
  get hasContent() { return this.elements.size > 0 || this.epoch.counter > 0 }

  localDelta(elements: readonly ExcalidrawElement[], files: BinaryFiles): BoardDelta {
    // Do not reserialize/revalidate every image on every pointer movement.
    const referencedFiles = new Set<string>()
    for (const element of elements) if (element.type === 'image' && element.fileId) referencedFiles.add(element.fileId)
    return {
      epoch: { ...this.epoch },
      elements: elements.filter((element) => { const previous = this.elements.get(element.id); return !previous || newer(element, previous) }),
      files: Object.fromEntries(Object.entries(files).filter(([id]) => referencedFiles.has(id) && !this.files[id])),
    }
  }

  apply(value: unknown): BoardDelta | null {
    if (!record(value) || !validEpoch(value.epoch) || !Array.isArray(value.elements) || !record(value.files)) throw new Error('Lousa recebida em um formato inválido.')
    if (value.elements.length > MAX_BOARD_ELEMENTS || Object.keys(value.files).length > 100 || jsonBytes(value) > MAX_BOARD_MESSAGE_BYTES) throw new Error('A lousa excedeu o limite desta sessão.')
    const epochOrder = compareEpoch(value.epoch, this.epoch)
    if (epochOrder < 0) return null
    // Validate before applying any part; invalid packets must never clear a scene.
    if (!value.elements.every(validBoardElement) || !Object.entries(value.files).every(([id, file]) => validBoardFile(file) && file.id === id)) throw new Error('Use desenhos, texto e imagens PNG, JPG, WebP ou GIF de até 2 MB.')
    const nextElements = epochOrder > 0 ? new Map<string, ExcalidrawElement>() : new Map(this.elements)
    const nextFiles: BinaryFiles = epochOrder > 0 ? Object.create(null) : { ...this.files }
    const nextSizes = epochOrder > 0 ? new Map<string, number>() : new Map(this.sizes)
    let sceneBytes = epochOrder > 0 ? 0 : this.sceneBytes
    let fileBytes = epochOrder > 0 ? 0 : this.fileBytes
    const elements: ExcalidrawElement[] = [], files: BinaryFiles = Object.create(null)
    for (const incoming of value.elements as ExcalidrawElement[]) {
      const previous = nextElements.get(incoming.id)
      if (previous && !newer(incoming, previous)) continue
      const size = jsonBytes(incoming)
      sceneBytes += size - (nextSizes.get(incoming.id) || 0)
      // Detach from the editor's mutable references.
      const element = JSON.parse(JSON.stringify(incoming)) as ExcalidrawElement
      nextElements.set(element.id, element)
      nextSizes.set(element.id, size)
      elements.push(element)
    }
    for (const file of Object.values(value.files) as BinaryFileData[]) {
      if (nextFiles[file.id]) continue // content-addressed immutable file IDs
      const copy = { ...file }
      fileBytes += copy.dataURL.length * 0.75
      nextFiles[copy.id] = copy
      files[copy.id] = copy
    }
    if (nextElements.size > MAX_BOARD_ELEMENTS || sceneBytes > MAX_BOARD_SCENE_BYTES || fileBytes > MAX_BOARD_FILES_BYTES) throw new Error('Lousa cheia. Exporte uma cópia e limpe a lousa para continuar (máximo de 8 MB em imagens).')
    if (!elements.length && !Object.keys(files).length && epochOrder === 0) return null
    this.epoch = { ...value.epoch }
    this.elements = nextElements
    this.files = nextFiles
    this.sizes = nextSizes
    this.sceneBytes = sceneBytes
    this.fileBytes = fileBytes
    return { epoch: { ...this.epoch }, elements, files }
  }

  clear(actor: string): BoardDelta {
    const delta: BoardDelta = { epoch: { counter: this.epoch.counter + 1, actor }, elements: [], files: {} }
    this.apply(delta)
    return delta
  }
}
