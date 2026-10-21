import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import ExcalitowerStage from '../components/Excalitower/ExcalitowerStage'
import { useRoomExcalitower } from '../hooks/useRoomExcalitower'
import { createExcalitowerTestMesh } from './excalitowerTestMesh'
import type { Element } from '../whiteboard/core/types/model'

const shape = (x: number, label: string): Element => ({
  id: crypto.randomUUID(),
  type: 'rectangle',
  x,
  y: 240,
  w: 240,
  h: 140,
  rotation: 0,
  strokeColor: '#9ad7bd',
  fillColor: '#234f4e',
  strokeWidth: 2,
  opacity: 1,
  zIndex: 1,
  seed: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  label,
})
export const ExcalitowerPreview = () => {
  const mesh = useMemo(createExcalitowerTestMesh, []),
    alice = useRoomExcalitower(mesh.rooms[0]!),
    bia = useRoomExcalitower(mesh.rooms[1]!)
  const a = useSyncExternalStore(
      alice.session.subscribe,
      alice.session.getView,
    ),
    b = useSyncExternalStore(bia.session.subscribe, bia.session.getView)
  const [who, setWho] = useState(false),
    [open, setOpen] = useState(true),
    [result, setResult] = useState(''),
    [offline, setOffline] = useState(false)
  const [collaborating, setCollaborating] = useState(false)
  const session = who ? bia.session : alice.session
  useEffect(() => {
    if (!collaborating) return
    let n = 0
    const interval = window.setInterval(() => {
      bia.session.update([
        {
          ...shape(800, 'Bia desenha'),
          id: 'remote-live',
          y: 180,
          w: 120 + (++n % 20) * 2,
        },
      ])
    }, 70)
    return () => window.clearInterval(interval)
  }, [collaborating, bia.session])
  const check = async () => {
    try {
      const wait = () => new Promise((r) => setTimeout(r, 1400))
      alice.session.clear()
      await wait()
      alice.session.update([shape(160, 'Alice')])
      bia.session.update([shape(500, 'Bia')])
      await wait()
      if (
        a.count < 0 ||
        alice.session.replica.count !== 2 ||
        alice.session.replica.digest() !== bia.session.replica.digest()
      )
        throw Error('Concorrência')
      mesh.disconnect()
      alice.session.update([shape(200, 'Reconectar')])
      await wait()
      mesh.reconnect()
      await wait()
      if (alice.session.replica.digest() !== bia.session.replica.digest())
        throw Error('Reconexão')
      alice.session.open()
      await wait()
      if (alice.session.getView().openId !== bia.session.getView().openId)
        throw Error('Abertura para todos')
      setResult('Rede: concorrência, reconexão e abertura compartilhada OK')
    } catch (e) {
      setResult(String(e))
    }
  }
  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      {open ? (
        <ExcalitowerStage
          key={String(who)}
          session={session}
          names={{ alice: 'Alice', bia: 'Bia' }}
          onExit={() => setOpen(false)}
          onOpenHub={() => location.assign('?game-preview=hub')}
        />
      ) : (
        <button onClick={() => setOpen(true)}>Reabrir Excalitower</button>
      )}
      {!new URLSearchParams(location.search).has('clean') && (
        <details
          style={{
            position: 'absolute',
            right: 15,
            bottom: 80,
            zIndex: 20,
            background: '#202c41',
            padding: 12,
            color: 'white',
            maxWidth: 360,
          }}
        >
          <summary>Teste Excalitower</summary>
          <p role="status">
            Alice {a.count} · Bia {b.count} · {mesh.packets()} pacotes ·{' '}
            {alice.session.replica.digest() === bia.session.replica.digest()
              ? 'Sincronizados'
              : 'Sincronizando'}
          </p>
          <button onClick={() => setWho(!who)}>
            Ver como {who ? 'Alice' : 'Bia'}
          </button>
          <button
            onClick={() => {
              ;(who ? alice : bia).session.update([
                shape(400, 'Outro participante'),
              ])
            }}
          >
            Outro participante desenha
          </button>
          <button
            onClick={() =>
              session.update([
                shape(200, 'Excalitower'),
                shape(550, 'Mesma sessão'),
              ])
            }
          >
            Criar exemplo
          </button>
          <button
            onClick={() => {
              if (offline) mesh.reconnect()
              else mesh.disconnect()
              setOffline(!offline)
            }}
          >
            {offline ? 'Reconectar' : 'Simular queda'}
          </button>
          <button onClick={() => void check()}>Rodar testes de rede</button>
          <p>{result}</p>
        </details>
      )}
      {!new URLSearchParams(location.search).has('clean') && (
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 10,
            zIndex: 20,
            background: '#202c41',
            padding: 8,
            color: 'white',
            fontSize: 10,
            maxWidth: 440,
          }}
        >
          <button onClick={() => setCollaborating(!collaborating)}>
            {collaborating
              ? 'Parar colaboração'
              : 'Simular colaboração contínua'}
          </button>
          <output aria-label="Diagnóstico do desenho">
            {session.replica
              .scene()
              .filter((e) => e.id !== 'remote-live')
              .map(
                (e) =>
                  `${e.type}: ${Math.round(e.w)}×${Math.round(e.h)} ${'points' in e ? e.points.length + ' pontos' : ''}`,
              )
              .join(' · ')}
          </output>
        </div>
      )}
    </main>
  )
}
