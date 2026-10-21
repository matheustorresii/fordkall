import { useEffect, useRef, useState } from 'react'
import { CanvasRoot } from '../../whiteboard/core/canvas/CanvasRoot'
import { SceneStore } from '../../whiteboard/core/canvas/SceneStore'
import { draw } from '../../whiteboard/core/canvas/Renderer'
import type { Element } from '../../whiteboard/core/types/model'
import type { ExcalitowerSession } from '../../whiteboard/session'
import { Icon } from '../ui/Icon'

export const SketchCanvas = ({
  session,
  editable,
}: {
  session: ExcalitowerSession
  editable: boolean
}) => {
  const host = useRef<HTMLDivElement>(null),
    rootRef = useRef<CanvasRoot | null>(null),
    editableRef = useRef(editable)
  editableRef.current = editable
  const [color, setColor] = useState('#263445'),
    [width, setWidth] = useState(4)
  useEffect(() => {
    if (!host.current) return
    const container = host.current
    const drawingHost = document.createElement('div')
    drawingHost.className = 'sketch-board'
    container.appendChild(drawingHost)
    const fit = () => {
      const w = Math.min(
        container.clientWidth,
        (container.clientHeight * 5) / 3,
      )
      if (w <= 0) return
      drawingHost.style.width = `${w}px`
      drawingHost.style.height = `${(w * 3) / 5}px`
      rootRef.current?.scene.setViewport({
        scale: w / 1000,
        offsetX: 0,
        offsetY: 0,
      })
    }
    fit()
    const root = new CanvasRoot(drawingHost)
    rootRef.current = root
    root.sketchOnly = true
    root.setSnap(false)
    root.setTool('freehand')
    root.style.strokeColor = '#263445'
    root.style.strokeWidth = 4
    root.scene.setViewport({
      scale: root.size.w / 1000,
      offsetX: 0,
      offsetY: 0,
    })
    root.readonly = !editableRef.current
    let baseline = new Map<string, string>(),
      drawing = false
    const apply = () => {
      if (drawing) return
      const scene = session.replica.scene()
      root.scene.elements = scene
      root.scene.markDirty()
      baseline = new Map(scene.map((e) => [e.id, JSON.stringify(e)]))
    }
    root.onChange = () => {
      if (!editableRef.current) return
      const items = root.scene.elements
      const ids = new Set(items.map((e) => e.id))
      const changed = items.filter(
        (e) => baseline.get(e.id) !== JSON.stringify(e),
      )
      session.update(
        changed,
        [...baseline.keys()].filter((id) => !ids.has(id)),
      )
      baseline = new Map(items.map((e) => [e.id, JSON.stringify(e)]))
    }
    const down = () => {
        drawing = true
      },
      up = () => {
        drawing = false
        queueMicrotask(apply)
      }
    root.canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    const unsubscribe = session.subscribe(apply)
    apply()
    const resize = new ResizeObserver(fit)
    resize.observe(container)
    return () => {
      unsubscribe()
      root.canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      resize.disconnect()
      root.destroy()
      drawingHost.remove()
      rootRef.current = null
    }
  }, [session])
  useEffect(() => {
    if (rootRef.current) rootRef.current.readonly = !editable
    session.setVisible(true, editable)
    return () => session.setVisible(false)
  }, [editable, session])
  return (
    <div className="sketch-surface">
      <div
        className="sketch-surface__canvas"
        ref={host}
        aria-label={editable ? 'Área para desenhar' : 'Desenho da rodada'}
      />
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
              onClick={() => {
                setColor(c)
                rootRef.current?.setStyle({ strokeColor: c })
              }}
            />
          ))}
          <input
            aria-label="Tamanho do pincel"
            type="range"
            min="2"
            max="24"
            value={width}
            onChange={(e) => {
              setWidth(+e.target.value)
              rootRef.current?.setStyle({ strokeWidth: +e.target.value })
            }}
          />
          <button
            type="button"
            title="Desfazer traço"
            aria-label="Desfazer traço"
            onClick={() => rootRef.current?.undo()}
          >
            ↶
          </button>
          <button
            type="button"
            title="Limpar desenho"
            aria-label="Limpar desenho"
            onClick={() => session.clear()}
          >
            <Icon name="trash" />
          </button>
        </div>
      )}
    </div>
  )
}
export const SketchThumbnail = ({ elements }: { elements: Element[] }) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const scene = new SceneStore()
    scene.elements = elements
    scene.viewport = { scale: c.width / 1000, offsetX: 0, offsetY: 0 }
    draw(ctx, scene, c.width, c.height, 1, null, false)
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
