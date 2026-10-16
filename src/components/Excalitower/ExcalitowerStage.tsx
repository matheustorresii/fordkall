import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CaptureUpdateAction, Excalidraw, MainMenu, restoreElements } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, Collaborator, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types'
import { elementStamp, compareEpoch, MAX_BOARD_FILE_BYTES, validBoardFile, type BoardEpoch } from '../../whiteboard/replica'
import type { ExcalitowerSession } from '../../whiteboard/session'
import { Icon } from '../ui/Icon'
import { GameModal } from '../Games/GameTable'
import '@excalidraw/excalidraw/index.css'
import './ExcalitowerStage.css'

declare global { interface Window { EXCALIDRAW_ASSET_PATH: string } }
window.EXCALIDRAW_ASSET_PATH = new URL('./excalitower/', document.baseURI).href
const sceneKey = (elements: readonly ExcalidrawElement[]) => elements.map((element) => `${element.id}:${elementStamp(element)}`).join('|')

interface Props {
  session: ExcalitowerSession
  names: Record<string, string>
  onExit: () => void
  onOpenHub: () => void
  active?: boolean
}

function ExcalitowerEditor({ session, names, onExit, onOpenHub, active = true }: Props) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [readOnly, setReadOnly] = useState(session.readOnly)
  const [dialog, setDialog] = useState<'clear' | 'help' | null>(null)
  const applying = useRef(false)
  const sceneEpoch = useRef<BoardEpoch>({ ...session.replica.epoch })
  const receivedFiles = useRef(new Set<string>())
  const [initial] = useState(() => structuredClone(session.replica.snapshot()))
  const pending = useRef<{ elements: readonly ExcalidrawElement[]; files: BinaryFiles; epoch: BoardEpoch } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flush = useCallback(() => {
    clearTimeout(timer.current); timer.current = undefined
    const next = pending.current; pending.current = null
    if (next) session.update(next.elements, next.files, next.epoch)
  }, [session])

  useEffect(() => {
    session.setVisible(active, !readOnly)
    return () => { flush(); session.setVisible(false) }
  }, [active, flush, readOnly, session])

  useEffect(() => {
    if (!api) return
    const next = session.replica.snapshot()
    const cleared = compareEpoch(next.epoch, sceneEpoch.current) !== 0
    if (cleared) return // the keyed editor will remount with an empty file cache and history
    applying.current = true
    const files = Object.values(next.files).filter((file) => !receivedFiles.current.has(file.id))
    if (files.length) {
      api.addFiles(files)
      for (const file of files) receivedFiles.current.add(file.id)
    }
    const current = api.getSceneElementsIncludingDeleted()
    if (sceneKey(current) !== sceneKey(next.elements)) {
      // Merge by ID without ever replacing an in-progress newer local stroke with an older network echo.
      const merged = new Map(next.elements.map((element) => [element.id, element]))
      for (const local of current) {
        const remote = merged.get(local.id)
        if (!remote || local.version > remote.version || local.version === remote.version && local.versionNonce < remote.versionNonce) merged.set(local.id, local)
      }
      const elements = [...merged.values()].sort((a, b) => (a.index || '') < (b.index || '') ? -1 : (a.index || '') > (b.index || '') ? 1 : a.id.localeCompare(b.id))
      api.updateScene({ elements: restoreElements(structuredClone(elements), null, { repairBindings: true }), captureUpdate: CaptureUpdateAction.NEVER })
    }
    applying.current = false
  }, [api, session, view.sceneRevision])

  useEffect(() => {
    if (!api) return
    const collaborators = new Map<SocketId, Collaborator>()
    for (const peer of view.presence) collaborators.set(peer.identity as SocketId, {
      id: peer.identity, username: names[peer.identity] || peer.identity,
      ...(peer.cursor ? { pointer: { x: peer.cursor.x, y: peer.cursor.y, tool: peer.cursor.tool }, button: peer.cursor.button } : {}),
    })
    api.updateScene({ collaborators, captureUpdate: CaptureUpdateAction.NEVER })
  }, [api, names, view.presence])

  const changed = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    session.localAppState = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: { ...appState.zoom }, currentItemStrokeColor: appState.currentItemStrokeColor, currentItemBackgroundColor: appState.currentItemBackgroundColor, currentItemFontFamily: appState.currentItemFontFamily, currentItemFontSize: appState.currentItemFontSize, gridSize: appState.gridSize }
    // Use one dismissible inline notice, instead of stacking the editor's error modal over the canvas.
    if (appState.errorMessage) {
      session.setError(typeof appState.errorMessage === 'string' ? appState.errorMessage : 'Não foi possível concluir esta ação no editor.')
      queueMicrotask(() => api?.updateScene({ appState: { errorMessage: null }, captureUpdate: CaptureUpdateAction.NEVER }))
    }
    if (applying.current || readOnly) return
    // A viewport/selection change must not produce a scene broadcast.
    if (sceneKey(elements) === sceneKey(session.replica.snapshot().elements) && Object.keys(files).every((id) => receivedFiles.current.has(id))) return
    pending.current = { elements, files, epoch: { ...sceneEpoch.current } }
    if (!timer.current) timer.current = setTimeout(flush, 90)
  }, [api, flush, readOnly, session])

  return <section className="excalitower" aria-label="Excalitower, lousa compartilhada">
    <header className="excalitower__header">
      <button className="excalitower__back" aria-label="Voltar à central de jogos" onClick={onOpenHub} title="Central de jogos" type="button"><Icon name="chevron" /></button>
      <div className="excalitower__title"><strong>Excalitower</strong><span>Lousa da sessão</span></div>
    </header>
    <div className="excalitower__bar">
      <div className="excalitower__people" aria-label={`${view.presence.length + 1} na lousa`}>
        <span className="excalitower__live-dot" /><span>{view.presence.length + 1} na lousa</span>
        <small role="status">{view.pending ? 'Sincronizando…' : 'Ao vivo'}</small>
      </div>
      <div className="excalitower__actions">
        <button aria-pressed={readOnly} onClick={() => { session.readOnly = !readOnly; setReadOnly(!readOnly) }} title={readOnly ? 'Voltar a editar' : 'Só assistir, sem editar'} type="button"><Icon name={readOnly ? 'eye' : 'edit'} /><span>{readOnly ? 'Só assistir' : 'Editando'}</span></button>
        <button aria-label="Enquadrar desenho" onClick={() => api?.scrollToContent(undefined, { fitToContent: true, animate: true })} title="Enquadrar desenho" type="button"><Icon name="expand" /></button>
        <button aria-label="Sobre a lousa da sessão" onClick={() => setDialog('help')} title="Sobre a lousa" type="button"><Icon name="info" /></button>
        <button aria-label="Minimizar lousa e voltar à call" onClick={onExit} title="Voltar à call" type="button"><Icon name="collapse" /></button>
      </div>
    </div>
    {view.error && <div className="excalitower__error" role="alert"><Icon name="warning" /><span>{view.error}</span><button onClick={session.sync} type="button">Sincronizar</button><button aria-label="Fechar aviso da lousa" onClick={() => session.setError('')} type="button"><Icon name="x" /></button></div>}
    <div className="excalitower__canvas" onPointerLeave={() => session.pointer(null)}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{ elements: initial.elements, files: initial.files, appState: { viewBackgroundColor: '#f7f8fa', currentItemStrokeColor: '#263445', currentItemFontFamily: 5, exportBackground: true, exportEmbedScene: false, ...session.localAppState } }}
        onChange={changed}
        onPaste={(data, event) => {
          if (event?.clipboardData && [...event.clipboardData.files].some((file) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > MAX_BOARD_FILE_BYTES)) { session.setError('Use uma imagem PNG, JPG, WebP ou GIF de até 2 MB.'); return false }
          if (data.files && !Object.values(data.files).every(validBoardFile)) { session.setError('Use uma imagem PNG, JPG, WebP ou GIF de até 2 MB.'); return false }
          if (data.elements?.some((element) => ['embeddable', 'iframe', 'magicframe'].includes(element.type))) { session.setError('Esta lousa aceita desenhos, texto e imagens, sem páginas incorporadas.'); return false }
          return true
        }}
        onPointerUpdate={({ pointer, button }) => { if (active) session.pointer({ ...pointer, button }) }}
        langCode="pt-BR"
        name="Excalitower"
        theme="light"
        viewModeEnabled={readOnly}
        isCollaborating
        handleKeyboardGlobally={false}
        aiEnabled={false}
        generateIdForFile={async (file) => {
          if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > MAX_BOARD_FILE_BYTES) {
            const message = 'Use uma imagem PNG, JPG, WebP ou GIF de até 2 MB.'
            session.setError(message)
            throw new Error(message)
          }
          const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
          return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        }}
        validateEmbeddable={false}
        UIOptions={{ canvasActions: { clearCanvas: false, loadScene: false, saveToActiveFile: false, toggleTheme: false, changeViewBackgroundColor: false, export: false, saveAsImage: true } }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.Item icon={<Icon name="trash" />} disabled={readOnly} onSelect={() => setDialog('clear')}>Limpar lousa para todos</MainMenu.Item>
          <MainMenu.Item icon={<Icon name="info" />} onSelect={() => setDialog('help')}>Sobre o Excalitower</MainMenu.Item>
        </MainMenu>
      </Excalidraw>
    </div>
    {dialog === 'clear' && <GameModal onClose={() => setDialog(null)} title="Limpar a lousa?" detail="Isso apaga o desenho para todas as pessoas da sessão. Exporte uma imagem antes se quiser guardar uma cópia."><div className="game-modal__actions"><button className="game-action" onClick={() => setDialog(null)} type="button">Cancelar</button><button className="game-action game-action--danger" onClick={() => { pending.current = null; session.clear(); setDialog(null) }} type="button">Limpar para todos</button></div></GameModal>}
    {dialog === 'help' && <GameModal onClose={() => setDialog(null)} title="Uma lousa. Toda a sala." detail="Desenhem, escrevam e organizem ideias juntos, sem sair da call."><div className="excalitower__help"><p>A lousa existe só nesta sessão. Minimizar, trocar de tela ou voltar para a home não apaga nada. Quando a última pessoa sair da call, ela é descartada.</p><p>Quem chegar depois recebe o desenho atual. Cada pessoa controla seu próprio zoom e pode escolher <strong>Só assistir</strong>.</p><p>Use <strong>Ctrl/Cmd + Z</strong> para desfazer suas alterações. No menu, exporte uma imagem ou limpe a lousa para todos. Imagens PNG, JPG, WebP e GIF: até 2 MB cada, 8 MB no total.</p><small>Editor por <a href="https://excalidraw.com" target="_blank" rel="noreferrer">Excalidraw</a> · <a href={new URL('./excalitower/NOTICE.txt', document.baseURI).href} target="_blank" rel="noreferrer">Licenças</a></small></div></GameModal>}
  </section>
}

export default function ExcalitowerStage(props: Props) {
  const epoch = useSyncExternalStore(props.session.subscribe, () => `${props.session.replica.epoch.counter}:${props.session.replica.epoch.actor}`)
  // resetScene() keeps Excalidraw's files cache. Remount only the editor on a shared clear,
  // otherwise an old image can re-enter the new epoch through a later onChange callback.
  return <ExcalitowerEditor key={epoch} {...props} />
}
