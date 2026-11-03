import { useMemo, useRef, useState } from 'react'
import { ODIN_TOPIC, useRoomOdin } from '../hooks/useRoomOdin'
import {
  defaultOdinSettings,
  odinLegalPlays,
  odinValue,
  type OdinMove,
} from '../games/odin'
import { parseOdinState } from '../games/odinWire'
import { createGameTestMesh } from './gameTestMesh'

const pause = (ms = 20) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms))
export const OdinNetworkChecks = () => {
  const mesh = useMemo(() => createGameTestMesh(ODIN_TOPIC, 6), [])
  const a = useRoomOdin(mesh.rooms[0]!),
    b = useRoomOdin(mesh.rooms[1]!),
    c = useRoomOdin(mesh.rooms[2]!),
    d = useRoomOdin(mesh.rooms[3]!),
    e = useRoomOdin(mesh.rooms[4]!),
    f = useRoomOdin(mesh.rooms[5]!)
  const latest = useRef([a, b, c, d, e, f])
  latest.current = [a, b, c, d, e, f]
  const [results, setResults] = useState<string[]>([]),
    [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    setResults([])
    const game = (id = 'p0') => latest.current[Number(id.slice(1))]!,
      state = () => game().state
    const check = (ok: unknown, label: string) => {
      if (!ok) throw Error(label)
      setResults((previous) => [...previous, `PASS · ${label}`])
    }
    const wait = async (test: () => boolean, label: string) => {
      const deadline = Date.now() + 5000
      while (!test()) {
        if (Date.now() > deadline) throw Error(`Timeout: ${label}`)
        await pause()
      }
    }
    try {
      let captures = 0,
        passes = 0
      for (let count = 2; count <= 6; count++) {
        mesh.membership(Array.from({ length: count }, (_, i) => `p${i}`))
        await pause(60)
        game().reset()
        await wait(
          () =>
            latest.current
              .slice(0, count)
              .every((g) => g.state.phase === 'lobby'),
          'reset',
        )
        game('p1').start({ ...defaultOdinSettings, singleHand: true })
        const clients = () => latest.current.slice(0, count)
        await wait(
          () =>
            clients().every(
              (g) =>
                g.state.phase === 'playing' &&
                g.state.gameId === state().gameId &&
                g.hand.length === 9,
            ),
          'distribuição',
        )
        check(
          new Set(clients().flatMap((g) => g.hand.map((c) => c.id))).size ===
            count * 9,
          `${count} jogadores recebem nove cartas diferentes, privadas e sincronizadas`,
        )
        const before = state().stepId,
          wrong = state().players.find(
            (p) => p.identity !== state().current,
          )!.identity
        game(wrong).move({ type: 'pass' })
        await pause(45)
        check(
          Boolean(game(wrong).error) && state().stepId === before,
          `${count}: jogar fora da vez não altera a mesa`,
        )
        for (let step = 0; state().phase === 'playing' && step < 3000; step++) {
          const s = state(),
            actor = s.current,
            hand = game(actor).hand
          const plays = odinLegalPlays(hand, s.center).sort(
            (a, b) =>
              b.length - a.length ||
              odinValue(hand.filter((c) => a.includes(c.id))) -
                odinValue(hand.filter((c) => b.includes(c.id))),
          )
          const ids = plays[0],
            takeId =
              ids && ids.length < hand.length && s.center.length > 1
                ? s.center[0]!.id
                : undefined
          const move: OdinMove = ids
            ? { type: 'play', cardIds: ids, takeId }
            : { type: 'pass' }
          game(actor).clearError()
          await pause()
          game(actor).move(move)
          await wait(
            () =>
              clients().every(
                (g, i) =>
                  g.state.stepId !== s.stepId &&
                  g.state.stepId === state().stepId &&
                  g.hand.length ===
                    g.state.players.find((p) => p.identity === `p${i}`)
                      ?.cardsRemaining,
              ) || Boolean(game(actor).error),
            'jogada e mãos atualizadas',
          )
          if (game(actor).error) throw Error(game(actor).error)
          if (move.type === 'pass') passes++
          else if (s.center.length && ids!.length < hand.length) captures++
          if (step === 1) {
            const revision = state().revision
            mesh.deliver(actor, 'p0', {
              type: 'command',
              commandId: crypto.randomUUID(),
              command: {
                type: 'move',
                gameId: s.gameId,
                stepId: s.stepId,
                move,
              },
            })
            await pause(35)
            check(
              state().revision === revision,
              `${count}: repetir um comando antigo não joga nem captura duas vezes`,
            )
          }
        }
        check(
          state().phase === 'finished' &&
            clients().every(
              (g) =>
                JSON.stringify(g.state.winners) ===
                JSON.stringify(state().winners),
            ),
          `${count}: a partida termina com o mesmo vencedor e placar em todos`,
        )
        check(
          clients().every(
            (g, i) => g.hand.length === state().players[i]!.cardsRemaining,
          ),
          `${count}: placar e mãos privadas continuam coerentes até o fim`,
        )
      }
      check(
        captures > 0 && passes > 0,
        'Jogadas com captura e passes reais foram exercitados pelo protocolo',
      )
      check(
        mesh.packets
          .filter((p) => p.message.type === 'private')
          .every((p) => p.directed),
        'Todas as mãos são enviadas a um destino privado',
      )
      check(
        mesh.packets
          .filter((p) => p.message.type === 'state')
          .every(
            (p) =>
              Boolean(parseOdinState(p.message.state)) &&
              !Object.hasOwn(p.message.state as object, 'hands') &&
              !Object.hasOwn(p.message.state as object, 'aside'),
          ),
        'Estados públicos nunca carregam mãos nem cartas fora da partida',
      )
      const revision = game('p2').state.revision
      mesh.deliver('p1', 'p2', {
        type: 'state',
        state: {
          ...state(),
          controllerIdentity: 'p1',
          revision: revision + 500,
        },
      })
      await pause(50)
      check(
        game('p2').state.controllerIdentity === 'p0',
        'Um jogador não consegue substituir o controlador com um snapshot falso',
      )
      const oldGame = state().gameId
      game().reset()
      await wait(
        () => latest.current.every((g) => g.state.phase === 'lobby'),
        'reset final',
      )
      game('p1').start({ ...defaultOdinSettings, singleHand: true })
      await wait(
        () =>
          latest.current.every(
            (g) => g.state.phase === 'playing' && g.hand.length === 9,
          ),
        'nova partida',
      )
      const newGame = state().gameId
      mesh.deliver('p1', 'p0', {
        type: 'command',
        commandId: crypto.randomUUID(),
        command: { type: 'reset', gameId: oldGame },
      })
      await pause(50)
      check(
        newGame !== oldGame &&
          latest.current.every((g) => g.state.gameId === newGame),
        'Um encerramento atrasado de uma partida anterior não encerra a nova mesa',
      )
      setResults((previous) => [
        ...previous,
        'COMPLETE · Integração ODIN aprovada',
      ])
    } catch (cause) {
      setResults((previous) => [
        ...previous,
        `FAIL · ${cause instanceof Error ? cause.message : String(cause)}`,
      ])
    } finally {
      setRunning(false)
    }
  }
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 30,
        background: '#142831',
        color: '#e4ebdb',
        font: '14px system-ui',
      }}
    >
      <h1>ODIN · validação multiplayer</h1>
      <p>
        Seis hooks reais, transporte com atraso, mãos privadas e partidas
        completas. Sem microfone ou produção.
      </p>
      <button type="button" disabled={running} onClick={() => void run()}>
        {running ? 'Testando…' : 'Executar testes ODIN'}
      </button>
      <pre
        aria-live="polite"
        style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}
      >
        {results.join('\n')}
      </pre>
    </main>
  )
}
