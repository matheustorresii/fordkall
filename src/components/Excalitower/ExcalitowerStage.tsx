import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  CanvasRoot,
  type TextEditRequest,
} from '../../whiteboard/core/canvas/CanvasRoot'
import type { Tool } from '../../whiteboard/core/types/model'
import { aabb } from '../../whiteboard/core/canvas/geometry'
import { AWS_ICONS } from '../../whiteboard/core/canvas/awsIcons'
import { DEV_ICONS } from '../../whiteboard/core/canvas/devIcons'
import type { ExcalitowerSession } from '../../whiteboard/session'
import { GameModal } from '../Games/GameTable'
import { Icon } from '../ui/Icon'
import './ExcalitowerStage.css'

const tools: [Tool, string, string][] = [
  ['select', 'Selecionar', '↖'],
  ['rectangle', 'Retângulo', '▭'],
  ['diamond', 'Losango', '◇'],
  ['ellipse', 'Elipse', '○'],
  ['line', 'Linha', '╱'],
  ['arrow', 'Seta', '↗'],
  ['freehand', 'Desenhar', '〰'],
  ['text', 'Texto', 'T'],
]
const colors = [
  '#e8ecd9',
  '#91c4b5',
  '#a4b4f8',
  '#e8acb7',
  '#e9c17f',
  '#ef876e',
]
interface Props {
  session: ExcalitowerSession
  names: Record<string, string>
  onExit: () => void
  onOpenHub: () => void
  active?: boolean
}

// This is the imperative canvas from 11A3/github.io, not the Excalidraw SDK.
// Remote patches wait until the local gesture/text transaction commits. They never call loadBoard().
export default function ExcalitowerStage({
  session,
  names,
  onExit,
  onOpenHub,
  active = true,
}: Props) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const host = useRef<HTMLDivElement>(null),
    rootRef = useRef<CanvasRoot | null>(null)
  const [root, setRoot] = useState<CanvasRoot | null>(null),
    [tool, setTool] = useState<Tool>('select')
  const [readOnly, setReadOnly] = useState(session.readOnly),
    [dialog, setDialog] = useState<'clear' | 'help' | 'icons' | null>(null)
  const [edit, setEdit] = useState<TextEditRequest | null>(null),
    [zoom, setZoom] = useState(100),
    [query, setQuery] = useState('')
  const [style, setStyle] = useState({
    strokeColor: '#e8ecd9',
    fillColor: 'transparent',
    strokeWidth: 2,
    fontSize: 20,
    mono: false,
  })
  useEffect(() => {
    if (!host.current) return
    const canvas = new CanvasRoot(host.current)
    rootRef.current = canvas
    setRoot(canvas)
    canvas.loadBoard(session.replica.scene(), session.localViewport)
    let baseline = new Map(
      canvas.scene.elements.map((e) => [e.id, JSON.stringify(e)]),
    )
    let epoch = { ...session.replica.epoch },
      pointer = false,
      editing = false,
      disposed = false
    const applyRemote = () => {
      if (disposed || pointer || editing) return
      const cleared =
        epoch.counter !== session.replica.epoch.counter ||
        epoch.actor !== session.replica.epoch.actor
      if (cleared) canvas.history.clear()
      epoch = { ...session.replica.epoch }
      const scene = session.replica.scene()
      if (JSON.stringify(scene) === JSON.stringify(canvas.scene.elements))
        return
      canvas.scene.elements = scene
      for (const id of canvas.scene.selectedIds)
        if (!scene.some((e) => e.id === id)) canvas.scene.selectedIds.delete(id)
      baseline = new Map(scene.map((e) => [e.id, JSON.stringify(e)]))
      canvas.scene.markDirty()
    }
    canvas.onChange = () => {
      const elements = canvas.scene.elements
      const changed = elements.filter(
        (e) => baseline.get(e.id) !== JSON.stringify(e),
      )
      const ids = new Set(elements.map((e) => e.id))
      const removed = [...baseline.keys()].filter((id) => !ids.has(id))
      baseline = new Map(elements.map((e) => [e.id, JSON.stringify(e)]))
      session.update(changed, removed, epoch)
    }
    canvas.onUiSync = () => {
      session.localViewport = { ...canvas.scene.viewport }
      setZoom(Math.round(canvas.scene.viewport.scale * 100))
    }
    canvas.onToolChange = setTool
    canvas.onTextEdit = (req) => {
      editing = Boolean(req)
      setEdit(req)
      if (!req) queueMicrotask(applyRemote)
    }
    const down = () => {
      pointer = true
    }
    const up = () => {
      pointer = false
      queueMicrotask(applyRemote)
    }
    canvas.canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    const unsubscribe = session.subscribe(applyRemote)
    return () => {
      disposed = true
      unsubscribe()
      canvas.canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      canvas.destroy()
      rootRef.current = null
    }
  }, [session])
  useEffect(() => {
    session.setVisible(active, !readOnly)
    if (root) root.readonly = readOnly
    return () => session.setVisible(false)
  }, [session, active, readOnly, root])
  const fit = () => {
    if (!root) return
    const items = root.scene.elements.map(aabb)
    if (!items.length) {
      root.resetView()
      return
    }
    const x = Math.min(...items.map((b) => b.x)),
      y = Math.min(...items.map((b) => b.y)),
      right = Math.max(...items.map((b) => b.x + b.w)),
      bottom = Math.max(...items.map((b) => b.y + b.h))
    const scale = Math.min(
      2,
      (root.size.w - 160) / Math.max(1, right - x),
      (root.size.h - 260) / Math.max(1, bottom - y),
    )
    root.scene.setViewport({
      scale,
      offsetX: (root.size.w - (right + x) * scale) / 2,
      offsetY: (root.size.h - (bottom + y) * scale) / 2,
    })
    setZoom(Math.round(scale * 100))
  }
  const exportPng = () => {
    if (root) {
      root.scene.clearSelection()
      root.scene.markDirty()
      requestAnimationFrame(() => {
        const a = document.createElement('a')
        a.download = 'excalitower.png'
        a.href = root.canvas.toDataURL('image/png')
        a.click()
      })
    }
  }
  const library = [
    ...DEV_ICONS.map((x) => ({ ...x, id: `dev:${x.id}` })),
    ...AWS_ICONS.map((x) => ({ ...x, id: `aws-svc:${x.id}` })),
  ].filter((x) => x.label.toLowerCase().includes(query.toLowerCase()))
  return (
    <section
      className="excalitower"
      aria-label="Excalitower, lousa compartilhada"
    >
      <div
        className="excalitower__canvas"
        ref={host}
        onPointerMove={(e) => {
          if (!root) return
          const b = e.currentTarget.getBoundingClientRect(),
            v = root.scene.viewport
          session.pointer({
            x: (e.clientX - b.left - v.offsetX) / v.scale,
            y: (e.clientY - b.top - v.offsetY) / v.scale,
            tool: 'pointer',
            button: e.buttons ? 'down' : 'up',
          })
        }}
        onPointerLeave={() => session.pointer(null)}
      >
        {root &&
          view.presence
            .filter((p) => p.cursor)
            .map((p) => {
              const v = root.scene.viewport,
                c = p.cursor!
              return (
                <span
                  className="excalitower__cursor"
                  key={p.identity}
                  style={{
                    left: c.x * v.scale + v.offsetX,
                    top: c.y * v.scale + v.offsetY,
                  }}
                >
                  ↖<small>{names[p.identity] || 'Pessoa'}</small>
                </span>
              )
            })}
        {edit && root && (
          <TextEditor
            key={`${edit.id}:${edit.worldX}:${edit.worldY}`}
            root={root}
            request={edit}
          />
        )}
      </div>
      <div className="excalitower__identity">
        <button
          title="Central de jogos"
          aria-label="Voltar à central de jogos"
          onClick={onOpenHub}
        >
          <Icon name="chevron" />
        </button>
        <span>
          <strong>Excalitower</strong>
          <small>
            <i />
            {view.presence.length + 1} na lousa
          </small>
        </span>
      </div>
      <div
        className="excalitower__tools"
        role="toolbar"
        aria-label="Ferramentas da lousa"
      >
        {tools.map(([id, label, glyph], index) => (
          <button
            key={id}
            aria-label={label}
            title={`${label} (${index + 1})`}
            aria-pressed={tool === id}
            disabled={readOnly && id !== 'select'}
            onClick={() => root?.setTool(id)}
          >
            <b>{glyph}</b>
            <small>{index + 1}</small>
          </button>
        ))}
        <button
          title="Biblioteca de ícones"
          aria-label="Biblioteca de ícones"
          disabled={readOnly}
          onClick={() => setDialog('icons')}
        >
          <Icon name="plus" />
        </button>
      </div>
      <details className="excalitower__styles">
        <summary>
          <Icon name="controls" />
          <span>Estilo</span>
        </summary>
        <div>
          <label>
            Traço
            <div className="excalitower__swatches">
              {colors.map((color) => (
                <button
                  key={color}
                  aria-label={`Cor ${color}`}
                  aria-pressed={style.strokeColor === color}
                  style={{ background: color }}
                  onClick={() => {
                    setStyle({ ...style, strokeColor: color })
                    root?.setStyle({ strokeColor: color })
                  }}
                />
              ))}
              <input
                aria-label="Cor personalizada da lousa"
                type="color"
                value={style.strokeColor}
                onChange={(e) => {
                  setStyle({ ...style, strokeColor: e.target.value })
                  root?.setStyle({ strokeColor: e.target.value })
                }}
              />
            </div>
          </label>
          <label>
            Preenchimento
            <select
              value={style.fillColor}
              onChange={(e) => {
                setStyle({ ...style, fillColor: e.target.value })
                root?.setStyle({ fillColor: e.target.value })
              }}
            >
              <option value="transparent">Sem preenchimento</option>
              {colors.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Espessura
            <input
              type="range"
              aria-label="Espessura do traço"
              min="1"
              max="12"
              value={style.strokeWidth}
              onChange={(e) => {
                setStyle({ ...style, strokeWidth: +e.target.value })
                root?.setStyle({ strokeWidth: +e.target.value })
              }}
            />
          </label>
          <label>
            Tamanho do texto
            <input
              type="number"
              min="10"
              max="120"
              value={style.fontSize}
              onChange={(e) => {
                setStyle({ ...style, fontSize: +e.target.value })
                root?.setStyle({ fontSize: +e.target.value })
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={style.mono}
              onChange={(e) => {
                setStyle({ ...style, mono: e.target.checked })
                root?.setStyle({ mono: e.target.checked })
                root?.setTextMono(e.target.checked)
              }}
            />
            Bloco de código
          </label>
          <label>
            Conectores
            <select
              onChange={(e) =>
                root?.setRouting(
                  e.target.value as 'straight' | 'curve' | 'elbow',
                )
              }
            >
              <option value="straight">Reto</option>
              <option value="curve">Curvo</option>
              <option value="elbow">Ortogonal</option>
            </select>
          </label>
          <button onClick={() => root?.duplicateSelection()}>
            Duplicar seleção
          </button>
          <button onClick={() => root?.deleteSelection()}>
            Apagar seleção
          </button>
        </div>
      </details>
      <div className="excalitower__bottom">
        <div>
          <button
            title="Desfazer"
            aria-label="Desfazer"
            onClick={() => root?.undo()}
          >
            ↶
          </button>
          <button
            title="Refazer"
            aria-label="Refazer"
            onClick={() => root?.redo()}
          >
            ↷
          </button>
          <button aria-label="Diminuir zoom" onClick={() => root?.zoomBy(0.8)}>
            −
          </button>
          <button title="Restaurar zoom" onClick={() => root?.resetView()}>
            {zoom}%
          </button>
          <button aria-label="Aumentar zoom" onClick={() => root?.zoomBy(1.25)}>
            +
          </button>
          <button
            title="Enquadrar desenho"
            aria-label="Enquadrar desenho"
            onClick={fit}
          >
            <Icon name="expand" />
          </button>
        </div>
        <div>
          <button
            aria-pressed={readOnly}
            title="Só assistir"
            aria-label="Só assistir"
            onClick={() => {
              session.readOnly = !readOnly
              setReadOnly(!readOnly)
            }}
          >
            <Icon name={readOnly ? 'eye' : 'edit'} />
          </button>
          <button
            title="Exportar imagem"
            aria-label="Exportar imagem"
            onClick={exportPng}
          >
            <Icon name="image" />
          </button>
          <button
            title="Limpar lousa"
            aria-label="Limpar lousa"
            disabled={readOnly}
            onClick={() => setDialog('clear')}
          >
            <Icon name="trash" />
          </button>
          <button
            title="Ajuda"
            aria-label="Ajuda da lousa"
            onClick={() => setDialog('help')}
          >
            <Icon name="info" />
          </button>
          <button
            title="Minimizar lousa"
            aria-label="Minimizar lousa"
            onClick={onExit}
          >
            <Icon name="collapse" />
          </button>
        </div>
      </div>
      {view.error && (
        <div className="excalitower__error" role="alert">
          <span>{view.error}</span>
          <button onClick={session.sync}>Tentar novamente</button>
          <button
            aria-label="Fechar aviso"
            onClick={() => session.setError('')}
          >
            <Icon name="x" />
          </button>
        </div>
      )}
      {dialog === 'clear' && (
        <GameModal
          title="Limpar a lousa?"
          detail="O desenho será apagado para toda a sala."
          onClose={() => setDialog(null)}
        >
          <button
            className="game-action game-action--danger"
            onClick={() => {
              session.clear()
              setDialog(null)
            }}
          >
            Limpar para todos
          </button>
        </GameModal>
      )}
      {dialog === 'icons' && (
        <GameModal
          title="Biblioteca de ícones"
          detail="Escolha e clique na lousa para inserir."
          onClose={() => setDialog(null)}
        >
          <input
            aria-label="Buscar ícones"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tecnologia…"
          />
          <div className="excalitower__library">
            {library.slice(0, 100).map((x) => (
              <button
                key={x.id}
                onClick={() => {
                  root?.setIcon(x.id)
                  setDialog(null)
                }}
              >
                {x.label}
              </button>
            ))}
          </div>
        </GameModal>
      )}
      {dialog === 'help' && (
        <GameModal
          title="Excalitower"
          detail="O canvas do 11A3, compartilhado nesta sessão."
          onClose={() => setDialog(null)}
        >
          <p>
            Desenho, formas, conectores, texto, código e ícones. Cole ou arraste
            uma imagem de até 2 MB.
          </p>
          <p>
            Espaço + arrastar move a lousa; Ctrl/Cmd + scroll ajusta o zoom.
            Ctrl/Cmd + Z desfaz apenas suas ações. Cada pessoa tem seu próprio
            enquadramento.
          </p>
          <p>
            Ao abrir, toda a sala vem para a lousa. Qualquer pessoa pode
            minimizar sem interromper as outras. O desenho desaparece quando a
            última pessoa sai.
          </p>
        </GameModal>
      )}
    </section>
  )
}

function TextEditor({
  root,
  request,
}: {
  root: CanvasRoot
  request: TextEditRequest
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const commit = () => {
    if (done.current) return
    done.current = true
    root.commitText(request, ref.current?.value || '')
  }
  const v = root.scene.viewport
  return (
    <textarea
      ref={ref}
      className="excalitower__text"
      aria-label="Texto na lousa"
      defaultValue={request.initial}
      style={{
        left: request.worldX * v.scale + v.offsetX,
        top: request.worldY * v.scale + v.offsetY,
        fontSize: request.fontSize * v.scale,
        color: request.color,
        fontFamily: request.mono ? 'monospace' : 'system-ui',
        width: Math.max(180, request.boxWidth * v.scale),
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (
          e.key === 'Escape' ||
          (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
        ) {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}
