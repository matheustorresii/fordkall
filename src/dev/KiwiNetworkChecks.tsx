import { useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { useRoomExplodingKiwi, type KiwiExpansion } from '../hooks/useRoomExplodingKiwi'
import { getKiwiCombo, getKiwiPlayTarget, kiwiCardTypes } from '../games/kiwiCards'

type Listener = (payload: Uint8Array, participant: { identity: string; name: string }, kind: undefined, topic: string) => void
interface Packet { from: string; to: string; payload: Uint8Array; topic: string }
const decoder = new TextDecoder()
const createRoomPair = () => {
  const names = ['host', 'peer']
  const listeners = names.map(() => new Map<string, Set<Listener>>())
  const packets: Packet[] = []
  const deliver = (packet: Packet) => {
    const index = names.indexOf(packet.to)
    listeners[index]?.get(RoomEvent.DataReceived)?.forEach((listener) => listener(packet.payload, { identity: packet.from, name: packet.from }, undefined, packet.topic))
  }
  const participants = names.map((identity) => ({ identity, name: identity, publishData: async (payload: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
    for (const to of names.filter((name) => name !== identity && (!options.destinationIdentities || options.destinationIdentities.includes(name)))) {
      const packet = { from: identity, to, payload: new Uint8Array(payload), topic: options.topic }
      packets.push(packet); queueMicrotask(() => deliver(packet))
    }
  } }))
  const rooms = participants.map((participant, index) => ({
    localParticipant: participant,
    remoteParticipants: new Map(participants.filter((person) => person.identity !== participant.identity).map((person) => [person.identity, person])),
    on(event: string, listener: Listener) { if (!listeners[index]!.has(event)) listeners[index]!.set(event, new Set()); listeners[index]!.get(event)!.add(listener); return this },
    off(event: string, listener: Listener) { listeners[index]!.get(event)?.delete(listener); return this },
  }) as unknown as Room)
  return { host: rooms[0]!, peer: rooms[1]!, packets, deliver }
}
const pause = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

/** Runs the real hook twice over an in-memory reliable transport, without an external room. */
export const KiwiNetworkChecks = () => {
  const pair = useMemo(createRoomPair, [])
  const host = useRoomExplodingKiwi(pair.host)
  const peer = useRoomExplodingKiwi(pair.peer)
  const latest = useRef({ host, peer }); latest.current = { host, peer }
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const run = async () => {
    if (running) return
    setRunning(true); setResults([])
    const record = (description: string) => setResults((items) => [...items, `PASS · ${description}`])
    const assert = (condition: unknown, description: string) => { if (!condition) throw new Error(description); record(description) }
    const prepare = async (expansions: KiwiExpansion[], predicate: (game: typeof peer) => boolean) => {
      for (let seed = 1; seed <= 180; seed += 1) {
        latest.current.host.reset(); await pause(5)
        const random = Math.random
        let value = seed
        Math.random = () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296 }
        try { latest.current.host.start(expansions) } finally { Math.random = random }
        await pause(12)
        if (latest.current.peer.isMyTurn && predicate(latest.current.peer)) return
      }
      throw new Error('Não foi possível preparar a mão determinística para o teste.')
    }
    try {
      const noTargets = ['attack','personal-attack','see-future-3','see-future-5','shuffle','skip','share-future','alter-future-3']
      assert(kiwiCardTypes.filter((type) => noTargets.includes(type)).every((type) => getKiwiPlayTarget([{ type }]) === 'none'), 'Ataque, Ataque Pessoal, futuro, embaralhar e pular não pedem alvo')
      assert(getKiwiPlayTarget([{ type: 'favor' }]) === 'other-living' && getKiwiPlayTarget([{ type: 'targeted-attack' }]) === 'living' && getKiwiPlayTarget([{ type: 'feed-dead' }]) === 'dead', 'Regras de alvo distinguem Favor, Ataque Direcionado e mortos')
      assert(getKiwiCombo([{ type: 'kiwi-cat-a' }, { type: 'kiwi-cat-a' }], false) === 'pair' && getKiwiCombo([{ type: 'attack' }, { type: 'favor' }], false) === null && getKiwiCombo([{ type: 'kiwi-cat-a' }, { type: 'kiwi-cat-b' }, { type: 'feral-kiwi' }], false) === null, 'Combos rejeitam combinações incompatíveis antes de pedir alvo')
      await prepare([], (game) => game.hand.filter((card) => card.type === 'see-future-3').length >= 2)
      assert(latest.current.host.state.gameId === latest.current.peer.state.gameId, 'Dois clientes recebem a mesma partida')
      assert(latest.current.host.hand.filter((card) => card.type === 'leaf-helmet').length === 1 && latest.current.peer.hand.filter((card) => card.type === 'leaf-helmet').length === 1, 'Cada pessoa começa com exatamente uma defesa')
      const oldPrivate = [...pair.packets].reverse().find((packet) => packet.to === 'peer' && JSON.parse(decoder.decode(packet.payload)).type === 'private')!
      const first = latest.current.peer.hand.find((card) => card.type === 'see-future-3')!
      latest.current.peer.play([first.id]); await pause(4250)
      assert(latest.current.peer.peek.length === 3, 'Ver o Futuro revela três cartas no cliente remoto')
      assert(latest.current.host.peek.length === 0, 'A revelação não vaza para o outro cliente')
      const firstId = latest.current.peer.peekId
      const firstOrder = latest.current.peer.peek.map((card) => card.id).join(':')
      const second = latest.current.peer.hand.find((card) => card.type === 'see-future-3')!
      latest.current.peer.play([second.id]); await pause(4250)
      assert(latest.current.peer.peekId !== firstId && latest.current.peer.peekId !== '', 'Repetir o futuro nas mesmas cartas cria uma nova revelação')
      assert(latest.current.peer.peek.map((card) => card.id).join(':') === firstOrder, 'Ver o Futuro preserva a ordem do monte')
      pair.deliver(oldPrivate); await pause(20)
      assert(latest.current.peer.peek.length === 3 && latest.current.peer.peek.map((card) => card.id).join(':') === firstOrder, 'Pacote privado antigo não apaga a revelação mais nova')
      await prepare(['imploding'], (game) => game.hand.some((card) => card.type === 'alter-future-3') && game.hand.some((card) => card.type === 'see-future-3'))
      const alter = latest.current.peer.hand.find((card) => card.type === 'alter-future-3')!
      latest.current.peer.play([alter.id]); await pause(4250)
      assert(latest.current.peer.state.prompt?.kind === 'reorder' && latest.current.peer.peek.length === 3, 'Mudar o Futuro abre a escolha com cartas privadas')
      const reordered = latest.current.peer.peek.map((card) => card.id).reverse()
      latest.current.peer.choose({ cardIds: reordered }); await pause(40)
      assert(latest.current.peer.state.prompt === null && latest.current.peer.peek.length === 0, 'Confirmar a ordem encerra a escolha sem bloquear a mesa')
      const see = latest.current.peer.hand.find((card) => card.type === 'see-future-3')!
      latest.current.peer.play([see.id]); await pause(4250)
      assert(latest.current.peer.peek.map((card) => card.id).join(':') === reordered.join(':'), 'A próxima revelação confirma a nova ordem real do monte')
      await prepare([], (game) => game.hand.some((card) => card.type === 'favor'))
      const favor = latest.current.peer.hand.find((card) => card.type === 'favor')!
      latest.current.peer.play([favor.id], 'host'); await pause(4250)
      assert(latest.current.host.state.prompt?.targetIdentity === 'host', 'Favor solicita a escolha somente da pessoa correta')
      const donated = latest.current.host.hand[0]!
      latest.current.host.choose({ cardId: donated.id }); await pause(40)
      assert(!latest.current.host.hand.some((card) => card.id === donated.id) && latest.current.peer.hand.some((card) => card.id === donated.id), 'A carta escolhida no Favor troca de mão nos dois clientes')
      assert(!latest.current.host.error && !latest.current.peer.error, 'A partida termina os fluxos de teste sem erro de sincronização')
      record('Todos os testes de integração concluídos')
    } catch (error) { setResults((items) => [...items, `FAIL · ${error instanceof Error ? error.message : String(error)}`]) }
    finally { setRunning(false) }
  }
  return <section style={{ height: '100%', overflow: 'auto', padding: '85px 28px 110px', color: '#e0edda', background: '#17251f', font: '14px system-ui' }}><h1>Integração do Exploding Kiwi</h1><p>Dois clientes reais do hook, transporte confiável em memória e mãos determinísticas. Sem serviços externos.</p><button className="game-action game-action--primary" disabled={running} onClick={() => void run()} type="button">{running ? 'Testando…' : 'Executar verificações'}</button><ol aria-live="polite" style={{ display: 'grid', gap: 10, marginTop: 24 }}>{results.map((result, index) => <li key={index}>{result}</li>)}</ol><p>{running ? 'Aguardando as janelas de resposta de 4 segundos das cartas.' : `${results.filter((result) => result.startsWith('PASS')).length} verificações passaram.`}</p></section>
}
