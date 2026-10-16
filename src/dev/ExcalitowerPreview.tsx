import { useMemo, useState, useSyncExternalStore } from 'react'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import ExcalitowerStage from '../components/Excalitower/ExcalitowerStage'
import { useRoomExcalitower } from '../hooks/useRoomExcalitower'
import { createExcalitowerTestMesh } from './excalitowerTestMesh'
import { Icon } from '../components/ui/Icon'
import { BrandMark } from '../components/ui/BrandMark'

const names = { alice: 'Alice', bia: 'Bia' }
export const ExcalitowerPreview = () => {
  const mesh = useMemo(createExcalitowerTestMesh, [])
  const alice = useRoomExcalitower(mesh.rooms[0]!), bia = useRoomExcalitower(mesh.rooms[1]!)
  const [who, setWho] = useState<'alice' | 'bia'>('alice')
  const [open, setOpen] = useState(true)
  const [muted, setMuted] = useState(false)
  const [offline, setOffline] = useState(false)
  const [result, setResult] = useState('')
  const a = useSyncExternalStore(alice.session.subscribe, alice.session.getView)
  const b = useSyncExternalStore(bia.session.subscribe, bia.session.getView)
  const session = who === 'alice' ? alice.session : bia.session
  const add = (peer: 'alice' | 'bia') => {
    const s = peer === 'alice' ? alice.session : bia.session
    const elements = convertToExcalidrawElements([{ type: 'rectangle', x: peer === 'alice' ? 140 : 460, y: 230, width: 220, height: 120, strokeColor: peer === 'alice' ? '#397b7b' : '#b98640', backgroundColor: peer === 'alice' ? '#cde9e4' : '#f4dfb4', fillStyle: 'solid', label: { text: peer === 'alice' ? 'Ideias da Alice' : 'Ideias da Bia', fontSize: 20, fontFamily: 5 } }])
    s.update([...s.replica.snapshot().elements, ...elements], {})
  }
  const sample = () => {
    session.clear()
    const elements = convertToExcalidrawElements([
      { type: 'text', x: 130, y: 110, text: 'Uma ideia puxa outra.', fontSize: 34, fontFamily: 5, strokeColor: '#263445' },
      { type: 'rectangle', x: 130, y: 240, width: 220, height: 110, strokeColor: '#427b78', backgroundColor: '#d4e9e4', fillStyle: 'solid', label: { text: 'Rabiscar', fontFamily: 5, fontSize: 24 } },
      { type: 'ellipse', x: 470, y: 220, width: 210, height: 150, strokeColor: '#ab8042', backgroundColor: '#f4e5c8', fillStyle: 'solid', label: { text: 'Conectar ideias', fontFamily: 5, fontSize: 21 } },
      { type: 'arrow', x: 355, y: 295, width: 110, height: 0, strokeColor: '#60878c', strokeWidth: 2 },
      { type: 'text', x: 190, y: 430, text: 'Todo mundo na mesma página. ✦', fontSize: 22, fontFamily: 5, strokeColor: '#577d88' },
    ])
    session.update(elements, {})
  }
  const check = async () => {
    setResult('Testando…')
    const wait = (ms = 1_100) => new Promise((resolve) => setTimeout(resolve, Math.max(1_100, ms)))
    try {
      alice.session.clear(); await wait()
      add('alice'); add('bia'); await wait(450)
      if (alice.session.replica.digest() !== bia.session.replica.digest() || alice.session.replica.count < 4) throw new Error('edição concorrente')
      alice.session.setVisible(false); bia.session.setVisible(false)
      add('bia'); await wait()
      if (alice.session.replica.digest() !== bia.session.replica.digest()) throw new Error('sincronização minimizada')
      mesh.disconnect(); add('alice'); await wait(400)
      mesh.reconnect(); await wait(450)
      if (alice.session.replica.digest() !== bia.session.replica.digest()) throw new Error('reconexão')
      alice.session.clear(); await wait()
      if (bia.session.replica.count) throw new Error('limpeza')
      const text = convertToExcalidrawElements([{ type: 'text', text: 'Sincronizado!', x: 330, y: 240 }])
      bia.session.update(text, {}); await wait()
      if (alice.session.replica.count !== 1) throw new Error('texto')
      setResult('6/6: edições concorrentes, texto, lousa minimizada, reconexão, limpeza e convergência passaram.')
    } catch (error) { setResult(`Falhou: ${String(error)}`) }
  }
  return <main className="call-shell call-shell--games-open">
    <header className="call-header"><button className="brand brand--compact call-home-button" aria-label="Home da prévia" onClick={() => setOpen(false)} type="button"><BrandMark /><h1>FORD KALL</h1></button><div className="call-header__actions">{(['users', 'music', 'gamepad', 'chat'] as const).map((name) => <button className="participants-toggle" title={name} aria-label={name} key={name} type="button" onClick={() => name === 'gamepad' && setOpen(true)}><Icon name={name} /></button>)}<div className="connection-pill connection-pill--connected"><i /></div></div></header>
    <div className="call-workspace">{open ? <ExcalitowerStage key={who} session={session} names={names} onExit={() => setOpen(false)} onOpenHub={() => window.location.assign(`${window.location.pathname}?game-preview=hub&clean`)} /> : <div style={{ display: 'grid', height: '100%', placeContent: 'center' }}><h2>Call continua conectada</h2><button onClick={() => setOpen(true)} type="button">Reabrir Excalitower</button></div>}</div>
    <footer className="call-dock"><div className="call-dock__group">{(['mic', 'cameraOff', 'headphones', 'screen', 'settings', 'leave'] as const).map((name) => <button aria-label={name} className={`call-control ${name === 'mic' && muted || name === 'cameraOff' ? 'call-control--muted' : ''}`} key={name} onClick={() => name === 'mic' && setMuted((value) => !value)} type="button"><span className="call-control__icon"><Icon name={name === 'mic' && muted ? 'micOff' : name} /></span><span>{name}</span></button>)}</div></footer>
    {!new URLSearchParams(window.location.search).has('clean') && <details style={{ position: 'fixed', bottom: 4, left: 10, zIndex: 150, maxWidth: 330, borderRadius: 8, background: '#1a2539f5', padding: 9, font: '12px system-ui', color: '#e3e9f1' }}><summary>Teste Excalitower</summary><p role="status">Alice: {a.count} · Bia: {b.count} · {alice.session.replica.digest() === bia.session.replica.digest() ? 'Sincronizados' : 'Sincronizando'} · {mesh.packets()} pacotes</p><p>Imagens: Alice {Object.keys(alice.session.replica.snapshot().files).length} · Bia {Object.keys(bia.session.replica.snapshot().files).length}</p><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}><button onClick={() => setWho(who === 'alice' ? 'bia' : 'alice')} type="button">Ver como {who === 'alice' ? 'Bia' : 'Alice'}</button><button onClick={() => add(who === 'alice' ? 'bia' : 'alice')} type="button">Outro participante desenha</button><button onClick={sample} type="button">Criar exemplo</button><button onClick={() => { if (offline) mesh.reconnect(); else mesh.disconnect(); setOffline(!offline) }} type="button">{offline ? 'Reconectar' : 'Simular queda'}</button><button onClick={() => void check()} type="button">Rodar 6 testes de rede</button></div><p>{result}</p></details>}
  </main>
}
