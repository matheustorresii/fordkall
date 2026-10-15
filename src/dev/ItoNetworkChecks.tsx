import { useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { ITO_TOPIC, useRoomIto } from '../hooks/useRoomIto'
import { defaultItoSettings, itoCardCounts, type ItoLossRule, type ItoSettings } from '../games/itoRules'

type Listener = (payload: Uint8Array, participant: { identity: string; name: string }, kind: undefined, topic: string) => void
interface Packet { from: string; to: string; payload: Uint8Array; topic: string }
const decoder = new TextDecoder()
const createMesh = () => {
  const identities = ['p0', 'p1', 'p2', 'p3', 'p4']
  const listeners = identities.map(() => new Map<string, Set<Listener>>())
  const packets: Packet[] = []
  const deliver = (packet: Packet) => listeners[identities.indexOf(packet.to)]?.get(RoomEvent.DataReceived)?.forEach((listener) => listener(packet.payload, { identity: packet.from, name: packet.from }, undefined, packet.topic))
  const people = identities.map((identity) => ({ identity, name: identity, publishData: async (payload: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
    for (const to of identities.filter((id) => id !== identity && (!options.destinationIdentities || options.destinationIdentities.includes(id)))) {
      const packet = { from: identity, to, payload: new Uint8Array(payload), topic: options.topic }
      packets.push(packet); queueMicrotask(() => deliver(packet))
    }
  } }))
  const rooms = people.map((person, index) => ({
    localParticipant: person,
    remoteParticipants: new Map(people.filter((candidate) => candidate.identity !== person.identity).map((candidate) => [candidate.identity, candidate])),
    on(event: string, listener: Listener) { if (!listeners[index]!.has(event)) listeners[index]!.set(event, new Set()); listeners[index]!.get(event)!.add(listener); return this },
    off(event: string, listener: Listener) { listeners[index]!.get(event)?.delete(listener); return this },
  }) as unknown as Room)
  return { rooms, packets, deliver }
}
const pause = (ms = 20) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
type Game = ReturnType<typeof useRoomIto>

export const ItoNetworkChecks = () => {
  const mesh = useMemo(createMesh, [])
  const a = useRoomIto(mesh.rooms[0]!), b = useRoomIto(mesh.rooms[1]!), c = useRoomIto(mesh.rooms[2]!), d = useRoomIto(mesh.rooms[3]!), e = useRoomIto(mesh.rooms[4]!)
  const latest = useRef<Game[]>([]); latest.current = [a,b,c,d,e]
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const run = async () => {
    if (running) return
    setRunning(true); setResults([])
    const game = (index = 0) => latest.current[index]!
    const record = (text: string) => setResults((items) => [...items, `PASS · ${text}`])
    const assert = (condition: unknown, text: string) => { if (!condition) throw new Error(text); record(text) }
    const start = async (settings: ItoSettings = defaultItoSettings) => { game().reset(); await pause(); game().start(settings); await pause() }
    const allSecrets = () => Object.fromEntries(latest.current.flatMap((client) => client.localCards).map((card) => [card.cardId, card.value]))
    const clues = async () => {
      for (let index = 0; index < 5; index++) for (const card of game(index).localCards) {
        game(index).submitClue(card.cardId, `Dica de p${index}, carta ${card.cardId.slice(0, 4)}`); await pause()
      }
    }
    const arrange = async (ascending: boolean) => {
      const numbers = allSecrets()
      const ids = [...game().state.order].sort((x,y) => ascending ? numbers[x]! - numbers[y]! : numbers[y]! - numbers[x]!)
      for (let position = 0; position < ids.length; position++) {
        let index = game().state.order.indexOf(ids[position]!)
        while (index > position) { game().moveCard(ids[position]!, -1); await pause(); index = game().state.order.indexOf(ids[position]!) }
      }
    }
    const finish = async (ascending = true) => {
      await clues(); await arrange(ascending)
      for (let index = 0; index < 5 && game().state.phase === 'order'; index++) { game(index).voteReveal(true); await pause() }
      if (game().state.phase !== 'revealed') throw new Error('A rodada não foi revelada após os votos.')
    }
    try {
      await start()
      assert(latest.current.every((client) => client.state.gameId === game().state.gameId && client.localCards.length === 1), 'Cinco clientes recebem uma carta cada na mesma rodada')
      assert(new Set(Object.values(allSecrets())).size === 5 && latest.current.every((client) => client.state.numbers === undefined), 'Números são únicos e ficam privados antes da revelação')
      const hostCard = game().localCards[0]!
      game(1).submitClue(hostCard.cardId, 'Tentativa com carta alheia'); await pause()
      assert(Boolean(game(1).error) && game().state.cards.every((card) => !card.clue), 'Uma pessoa não consegue enviar dica por uma carta de outra pessoa')
      game(1).clearError()
      await clues()
      assert(latest.current.every((client) => client.state.phase === 'order'), 'A mesa só abre a ordenação quando todas as cartas têm dica')
      game().voteReveal(true); await pause(); game(1).voteReveal(true); await pause()
      const staleVote = [...mesh.packets].reverse().find((packet) => packet.from === 'p1' && packet.to === 'p0' && JSON.parse(decoder.decode(packet.payload)).command?.type === 'vote')!
      assert(game().state.phase === 'order' && game().state.revealVotes.length === 2, 'Dois votos em cinco não revelam; a maioria exigida é três')
      game(1).voteReveal(true); await pause()
      assert(game().state.revealVotes.length === 2, 'Repetir o mesmo voto não aumenta a contagem')
      game(1).voteReveal(false); await pause()
      assert(game().state.revealVotes.length === 1, 'É possível retirar o voto antes de atingir a maioria')
      game().moveCard(game().state.order[0]!, 1); await pause()
      assert(latest.current.every((client) => client.state.revealVotes.length === 0), 'Mover qualquer carta cancela os votos em todos os clientes')
      mesh.deliver(staleVote); await pause()
      assert(game().state.revealVotes.length === 0, 'Voto atrasado da ordem anterior é recusado')
      await arrange(true)
      game().voteReveal(true); await pause(); game(1).voteReveal(true); await pause(); game(2).voteReveal(true); await pause()
      assert(latest.current.every((client) => client.state.phase === 'revealed' && client.state.succeeded), 'O terceiro voto revela e avalia a ordem em todos os clientes')
      const oldPrivate = [...mesh.packets].reverse().find((packet) => packet.to === 'p1' && JSON.parse(decoder.decode(packet.payload)).type === 'private')!
      const staleNext = game(1).nextRound
      game().nextRound(); staleNext(); await pause()
      assert(game().state.roundNumber === 2 && game().state.extraCards === 1 && game().state.players.map((player) => player.cardCount).join() === '2,1,1,1,1', 'Uma vitória adiciona somente uma carta, sem duplicar a próxima rodada')
      mesh.deliver(oldPrivate); await pause()
      assert(game(1).localCards.every((card) => game().state.cards.some((publicCard) => publicCard.id === card.cardId)), 'Pacotes privados da rodada anterior não substituem a mão nova')
      const twoCardPlayer = game().state.players.find((player) => player.cardCount === 2)!
      const twoCardIndex = Number(twoCardPlayer.identity.slice(1))
      const pending = game(twoCardIndex).localCards[1]!
      for (let index = 0; index < 5; index++) for (const card of game(index).localCards.filter((card) => card.cardId !== pending.cardId)) { game(index).submitClue(card.cardId, `Dica ${card.value}`); await pause() }
      assert(game().state.phase === 'clue', 'A segunda carta da mesma pessoa também precisa receber uma dica')
      game(twoCardIndex).submitClue(pending.cardId, 'Segunda dica independente'); await pause()
      game(twoCardIndex).voteReveal(true); await pause()
      assert(game().state.revealVotes.length === 1, 'Ter duas cartas continua valendo apenas um voto')
      await arrange(true)
      for (let index = 0; index < 3; index++) { game(index).voteReveal(true); await pause() }
      game().nextRound(); await pause()
      assert(game().state.players.map((player) => player.cardCount).join() === '2,2,1,1,1', 'A segunda vitória passa a carta extra à próxima pessoa do rodízio')
      for (let extras = 2; extras < 5; extras++) {
        await finish(); game().nextRound(); await pause()
        assert(game().state.players.map((player) => player.cardCount).join() === itoCardCounts(5, extras + 1, 2).join(), `Progressão equilibrada com ${extras + 1} cartas extras`)
      }
      assert(latest.current.every((client) => client.localCards.length === 2) && game().state.cards.length === 10, 'Ao completar o rodízio, existem dez cartas e cada pessoa recebe duas')
      await finish()
      assert(latest.current.every((client) => client.state.campaignWon), 'Vencer com duas cartas por pessoa conclui a partida')
      for (const lossRule of ['keep', 'remove-one', 'reset'] as ItoLossRule[]) {
        await start({ ...defaultItoSettings, revealRule: 'anyone', lossRule })
        await finish(); game().nextRound(); await pause(); await finish(); game().nextRound(); await pause()
        await finish(false)
        assert(!game().state.succeeded, `Ordem invertida é derrota com regra ${lossRule}`)
        game().nextRound(); await pause()
        const expected = lossRule === 'keep' ? 2 : lossRule === 'remove-one' ? 1 : 0
        assert(latest.current.every((client) => client.state.extraCards === expected && client.state.settings.lossRule === lossRule), `Derrota aplica ${lossRule} e mantém as configurações nos cinco clientes`)
      }
      await start({ ...defaultItoSettings, revealRule: 'unanimous', targetCards: 3 })
      await clues(); await arrange(true)
      for (let index = 0; index < 4; index++) { game(index).voteReveal(true); await pause() }
      assert(game().state.phase === 'order', 'Unanimidade não revela com quatro de cinco votos')
      game(4).voteReveal(true); await pause()
      assert(game().state.phase === 'revealed' && game().state.settings.targetCards === 3, 'O quinto voto revela e a meta personalizada permanece sincronizada')
      const observer = { identity: 'spectator', name: 'Visitante' }
      mesh.rooms[0]!.remoteParticipants.set(observer.identity, observer as never)
      mesh.deliver({ from: 'spectator', to: 'p0', topic: ITO_TOPIC, payload: new TextEncoder().encode(JSON.stringify({ type: 'command', commandId: crypto.randomUUID(), command: { type: 'next-round', gameId: game().state.gameId } })) })
      await pause()
      assert(game().state.phase === 'revealed', 'Espectador não consegue avançar a rodada de quem está jogando')
      mesh.rooms[0]!.remoteParticipants.delete('spectator')
      record('Todos os cenários de integração do ITO concluídos')
    } catch (error) { setResults((items) => [...items, `FAIL · ${error instanceof Error ? error.message : String(error)}`]) }
    finally { setRunning(false) }
  }
  return <section style={{ height: '100%', overflow: 'auto', padding: '70px 28px 100px', color: '#ddecdf', background: '#17362a', font: '14px system-ui' }}><h1>Integração do ITO</h1><p>Cinco hooks reais, transporte confiável em memória, votação, privacidade e partidas de várias rodadas.</p><button className="game-action game-action--primary" disabled={running} onClick={() => void run()} type="button">{running ? 'Testando…' : 'Executar verificações do ITO'}</button><ol aria-live="polite" style={{ display: 'grid', gap: 10 }}>{results.map((result, index) => <li key={index}>{result}</li>)}</ol><p>{running ? 'Partidas em andamento…' : `${results.filter((result) => result.startsWith('PASS')).length} verificações passaram.`}</p></section>
}
