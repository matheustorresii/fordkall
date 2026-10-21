import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  MAX_STROKE_POINTS,
  paintDrawing,
  type DrawingPoint,
  type DrawingStroke,
} from '../../games/drawing/model'
import type { DrawingSession } from '../../games/drawing/session'
import { Icon } from '../ui/Icon'

export const SketchCanvas = ({
  session,
  editable,
}: {
  session: DrawingSession
  editable: boolean
}) => {
  const host = useRef<HTMLDivElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#263445'),
    [width, setWidth] = useState(4)
  const settings = useRef({ color, width, editable })
  settings.current = { color, width, editable }
  const actions = useRef({ undo: () => {}, clear: () => {} })
  const error = useSyncExternalStore(
    session.subscribe,
    () => session.getView().error,
  )
  useEffect(() => {
    const canvas = canvasRef.current,
      container = host.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !container || !ctx) return
    let scene = session.replica.scene(),
      revision = -1,
      epoch = { ...session.replica.epoch },
      raf = 0
    let draft: {
      stroke: DrawingStroke
      pointerId: number
      epoch: typeof epoch
    } | null = null
    const redo: DrawingStroke[] = []
    const render = () => {
      raf = 0
      paintDrawing(
        ctx,
        canvas.width,
        canvas.height,
        draft ? [...scene, draft.stroke] : scene,
      )
    }
    const invalidate = () => {
      if (!raf) raf = requestAnimationFrame(render)
    }
    const receive = () => {
      const next = session.getView().sceneRevision
      if (next === revision) return
      revision = next
      if (
        epoch.counter !== session.replica.epoch.counter ||
        epoch.actor !== session.replica.epoch.actor
      ) {
        epoch = { ...session.replica.epoch }
        draft = null
        redo.length = 0
      }
      scene = session.replica.scene()
      invalidate()
    }
    const fit = () => {
      const w = Math.min(
        container.clientWidth,
        (container.clientHeight * 5) / 3,
      )
      if (w <= 0) return
      canvas.style.width = `${w}px`
      canvas.style.height = `${(w * 3) / 5}px`
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(((w * 3) / 5) * dpr)
      invalidate()
    }
    const point = (event: PointerEvent): DrawingPoint => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: Math.max(
          0,
          Math.min(
            DRAWING_WIDTH,
            ((event.clientX - rect.left) / rect.width) * DRAWING_WIDTH,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            DRAWING_HEIGHT,
            ((event.clientY - rect.top) / rect.height) * DRAWING_HEIGHT,
          ),
        ),
      }
    }
    const finish = () => {
      if (!draft) return
      const stroke = draft.stroke,
        gestureEpoch = draft.epoch
      draft = null
      if (
        settings.current.editable &&
        session.update([stroke], [], gestureEpoch)
      )
        redo.length = 0
      invalidate()
    }
    const down = (event: PointerEvent) => {
      if (!settings.current.editable || event.button !== 0 || draft) return
      event.preventDefault()
      canvas.focus({ preventScroll: true })
      canvas.setPointerCapture(event.pointerId)
      draft = {
        pointerId: event.pointerId,
        epoch: { ...epoch },
        stroke: {
          id: crypto.randomUUID(),
          color: settings.current.color,
          width: settings.current.width,
          order: Math.max(Date.now(), (scene.at(-1)?.order || 0) + 1),
          points: [point(event)],
        },
      }
      invalidate()
    }
    const move = (event: PointerEvent) => {
      if (!draft || draft.pointerId !== event.pointerId) return
      const samples = event.getCoalescedEvents?.() || []
      for (const sample of samples.length ? samples : [event]) {
        const p = point(sample),
          last = draft.stroke.points.at(-1)!
        if (
          draft.stroke.points.length < MAX_STROKE_POINTS &&
          Math.hypot(p.x - last.x, p.y - last.y) > 0.3
        )
          draft.stroke.points.push(p)
      }
      invalidate()
    }
    const up = (event: PointerEvent) => {
      if (draft?.pointerId === event.pointerId) {
        move(event)
        finish()
      }
    }
    const undo = () => {
      if (!settings.current.editable || draft) return
      const last = scene.at(-1)
      if (last && session.update([], [last.id])) redo.push(last)
    }
    const clear = () => {
      if (settings.current.editable) {
        draft = null
        redo.length = 0
        session.clear()
      }
    }
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !settings.current.editable ||
        !(event.ctrlKey || event.metaKey)
      )
        return
      const name = event.key.toLowerCase()
      if (name !== 'z' && name !== 'y') return
      event.preventDefault()
      if (name === 'y' || event.shiftKey) {
        const stroke = redo.pop()
        if (stroke) session.update([stroke])
      } else undo()
    }
    actions.current = { undo, clear }
    const unsubscribe = session.subscribe(receive),
      resize = new ResizeObserver(fit)
    resize.observe(container)
    fit()
    receive()
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('lostpointercapture', up)
    canvas.addEventListener('keydown', key)
    return () => {
      finish()
      unsubscribe()
      resize.disconnect()
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('lostpointercapture', up)
      canvas.removeEventListener('keydown', key)
      actions.current = { undo: () => {}, clear: () => {} }
    }
  }, [session])
  return (
    <div className="sketch-surface">
      <div className="sketch-surface__canvas" ref={host}>
        <canvas
          className="sketch-board"
          ref={canvasRef}
          tabIndex={editable ? 0 : -1}
          aria-label={editable ? 'Área para desenhar' : 'Desenho da rodada'}
          style={{
            touchAction: 'none',
            cursor: editable ? 'crosshair' : 'default',
          }}
        />
      </div>
      {editable && (
        <div
          className="sketch-tools"
          role="toolbar"
          aria-label="Ferramentas de desenho"
        >
          {[
            '#263445',
            '#d45558',
            '#e6ad43',
            '#4eaa86',
            '#4773c9',
            '#a170c9',
            '#ffffff',
          ].map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Pincel ${c}`}
              aria-pressed={color === c}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
          <input
            aria-label="Tamanho do pincel"
            type="range"
            min="2"
            max="24"
            value={width}
            onChange={(e) => setWidth(+e.target.value)}
          />
          <button
            type="button"
            aria-label="Desfazer traço"
            title="Desfazer traço"
            onClick={() => actions.current.undo()}
          >
            ↶
          </button>
          <button
            type="button"
            aria-label="Limpar desenho"
            title="Limpar desenho"
            onClick={() => actions.current.clear()}
          >
            <Icon name="trash" />
          </button>
        </div>
      )}
      {error && (
        <div className="sketch-error" role="status">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              session.setError('')
              session.sync()
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  )
}
export const SketchThumbnail = ({
  elements,
}: {
  elements: DrawingStroke[]
}) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas?.getContext('2d')
    if (canvas && ctx) paintDrawing(ctx, canvas.width, canvas.height, elements)
  }, [elements])
  return (
    <canvas
      className="sketch-thumbnail"
      ref={ref}
      width="600"
      height="360"
      aria-label="Desenho do álbum"
    />
  )
}
