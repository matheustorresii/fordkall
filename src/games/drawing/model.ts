export const DRAWING_WIDTH = 1000
export const DRAWING_HEIGHT = 600
export const MAX_STROKE_POINTS = 10_000
export interface DrawingPoint {
  x: number
  y: number
}
export interface DrawingStroke {
  id: string
  color: string
  width: number
  order: number
  points: DrawingPoint[]
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
export const safeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[\w-]{1,128}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value)
export const validStroke = (value: unknown): value is DrawingStroke =>
  isRecord(value) &&
  safeId(value.id) &&
  typeof value.color === 'string' &&
  /^#[\da-f]{6}$/i.test(value.color) &&
  typeof value.width === 'number' &&
  value.width >= 2 &&
  value.width <= 24 &&
  Number.isFinite(value.width) &&
  Number.isSafeInteger(value.order) &&
  Number(value.order) >= 0 &&
  Array.isArray(value.points) &&
  value.points.length >= 1 &&
  value.points.length <= MAX_STROKE_POINTS &&
  value.points.every(
    (p) =>
      isRecord(p) &&
      typeof p.x === 'number' &&
      typeof p.y === 'number' &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.x <= DRAWING_WIDTH &&
      p.y >= 0 &&
      p.y <= DRAWING_HEIGHT,
  )

/** A fixed-size Gartic surface, not a document editor. */
export const paintDrawing = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: DrawingStroke[],
) => {
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.scale(width / DRAWING_WIDTH, height / DRAWING_HEIGHT)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    const first = stroke.points[0]
    if (!first) continue
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.beginPath()
    if (stroke.points.length === 1) {
      ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.moveTo(first.x, first.y)
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }
  ctx.restore()
}
