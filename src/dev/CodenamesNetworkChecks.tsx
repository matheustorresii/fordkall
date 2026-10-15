import { useMemo, useRef, useState } from 'react'
import { CODENAMES_TOPIC, useRoomCodenames } from '../hooks/useRoomCodenames'
import { codenamesPauseReason, otherCodenamesTeam } from '../games/codenames'
import type { CodenamesMove } from '../games/codenames'
import { createGameTestMesh } from './gameTestMesh'
import { parseCodenamesState } from '../games/codenamesWire'

const pause = (ms = 90) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
export const CodenamesNetworkChecks = () => {
  const mesh = useMemo(() => createGameTestMesh(CODENAMES_TOPIC), [])
  const p0 = useRoomCodenames(mesh.rooms[0]!),
    p1 = useRoomCodenames(mesh.rooms[1]!),
    p2 = useRoomCodenames(mesh.rooms[2]!),
    p3 = useRoomCodenames(mesh.rooms[3]!),
    p4 = useRoomCodenames(mesh.rooms[4]!),
    p5 = useRoomCodenames(mesh.rooms[5]!),
    p6 = useRoomCodenames(mesh.rooms[6]!),
    p7 = useRoomCodenames(mesh.rooms[7]!),
    p8 = useRoomCodenames(mesh.rooms[8]!),
    p9 = useRoomCodenames(mesh.rooms[9]!),
    p10 = useRoomCodenames(mesh.rooms[10]!),
    p11 = useRoomCodenames(mesh.rooms[11]!)
  const latest = useRef([p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11])
  latest.current = [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11]
  const [results, setResults] = useState<string[]>([]),
    [running, setRunning] = useState(false)
  const run = async () => {
    setResults([])
    setRunning(true)
    const game = (id = 'p0') => latest.current[Number(id.slice(1))]!,
      state = () => game().state
    const assert = (ok: unknown, label: string) => {
      if (!ok) throw new Error(label)
      setResults((r) => [...r, `PASS · ${label}`])
    }
    const move = async (id: string, command: CodenamesMove) => {
      game(id).move(command)
      await pause()
    }
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)
    const master = () =>
      state().players.find((p) => p.team === state().turnTeam && p.role === 'spymaster')!.identity
    const operative = () =>
      state().players.find((p) => p.team === state().turnTeam && p.role === 'operative')!.identity
    const secret = () => (game('p0').key.length ? game('p0').key : game('p1').key)
    const choose = (kind: string) => state().board.find((c, i) => !c.revealed && secret()[i] === kind)!.id
    const sendClue = async (count: number | 'unlimited' = 3) =>
      move(master(), { type: 'clue', word: 'CONEXÃO', count })
    const same = (n: number) =>
      ids(n).every(
        (id) =>
          JSON.stringify(parseCodenamesState(game(id).state)) ===
          JSON.stringify(parseCodenamesState(state())),
      )
    try {
      await pause(250)
      for (const n of [4, 6, 8, 12]) {
        mesh.membership(ids(n))
        await pause(200)
        game().reset()
        await pause(150)
        for (const [i, id] of ids(n).entries())
          await move(id, {
            type: 'seat',
            team: i % 2 ? 'blue' : 'red',
            role: i < 2 ? 'spymaster' : 'operative',
          })
        game('p2').start()
        await pause(180)
        assert(
          state().phase === 'clue' && state().board.length === 25 && same(n),
          `${n} pessoas recebem o mesmo tabuleiro e equipes`,
        )
        assert(
          ids(n).every((id, i) => game(id).key.length === (i < 2 ? 25 : 0)),
          `${n} pessoas: somente mestres recebem a chave privada`,
        )
        assert(
          !JSON.stringify(state()).includes('"key"') && !state().solution.length,
          `${n} pessoas: broadcast não contém a chave`,
        )
        const packets = mesh.packets.filter(
          (p) => p.message.type === 'private' && (p.message.data as { key?: unknown[] })?.key?.length,
        )
        assert(
          packets.every((p) => p.directed && ['p0', 'p1'].includes(p.to)),
          `${n} pessoas: chaves só em pacotes direcionados aos mestres`,
        )
        const previous = state().revision
        const wrong = state().players.find((p) => p.role === 'operative')!.identity
        await move(wrong, { type: 'clue', word: 'INVÁLIDA', count: 2 })
        assert(
          state().revision === previous && Boolean(game(wrong).error),
          `${n} pessoas: agente não envia pista`,
        )
        await sendClue()
        assert(state().phase === 'guess' && same(n), `${n} pessoas recebem a mesma pista`)
        const who = operative(),
          good = choose(state().turnTeam)
        await move(who, { type: 'suggest', cardId: good })
        assert(
          state().suggestions[who] === good && state().board.every((c) => !c.revealed) && same(n),
          `${n} pessoas: sugestões sincronizam sem revelar cartas`,
        )
        const teammate = state().players.find(
          (p) => p.team === state().turnTeam && p.role === 'operative' && p.identity !== who,
        )
        if (teammate) {
          await move(teammate.identity, { type: 'suggest', cardId: good })
          await move(teammate.identity, { type: 'suggest', cardId: good })
          assert(
            state().suggestions[teammate.identity] === good &&
              state().board.every((c) => !c.revealed) &&
              same(n),
            `${n} pessoas: sugestões repetidas ou unânimes não revelam automaticamente`,
          )
        }
        const oldStep = state().stepId,
          oldId = state().gameId
        await move(who, { type: 'guess', cardId: good })
        assert(
          state().board.filter((c) => c.revealed).length === 1 && same(n),
          `${n} pessoas: um palpite revela exatamente uma carta`,
        )
        const revision = state().revision
        mesh.deliver(who, 'p0', {
          type: 'command',
          commandId: 'replayed',
          command: {
            type: 'move',
            gameId: oldId,
            stepId: oldStep,
            move: { type: 'guess', cardId: choose(state().turnTeam) },
          },
        })
        await pause()
        assert(
          state().revision === revision && state().board.filter((c) => c.revealed).length === 1,
          `${n} pessoas: comando atrasado não revela outra carta`,
        )
        const forged = { ...state(), controllerIdentity: who, revision: state().revision + 100 }
        mesh.deliver(who, 'p3', { type: 'state', state: forged })
        await pause()
        assert(
          game('p3').state.controllerIdentity === 'p0' && same(n),
          `${n} pessoas: outro participante não assume autoridade`,
        )
        await move(who, { type: 'pass' })
        await sendClue(0)
        assert(state().phase === 'guess' && same(n), `${n} pessoas: nova equipe recebe pista zero`)
        const losing = state().turnTeam
        await move(operative(), { type: 'guess', cardId: choose('assassin') })
        assert(
          state().phase === 'finished' &&
            state().winner === otherCodenamesTeam(losing) &&
            state().solution.length === 25 &&
            same(n),
          `${n} pessoas: assassino resolve e revela resultado para todos`,
        )
        game().reset()
        await pause(150)
        assert(
          !state().gameId && ids(n).every((id) => !game(id).key.length),
          `${n} pessoas: encerrar apaga chaves antigas`,
        )
        const lobbyRevision = state().revision
        mesh.deliver('p2', 'p0', {
          type: 'command',
          commandId: `stale-reset-${n}`,
          command: { type: 'reset', gameId: oldId },
        })
        await pause()
        assert(
          state().revision === lobbyRevision && same(n),
          `${n} pessoas: encerrar atrasado não afeta outra mesa`,
        )
      }
      mesh.membership(ids(4))
      await pause(160)
      game().reset()
      await pause(120)
      for (const [i, id] of ids(4).entries())
        await move(id, {
          type: 'seat',
          team: i % 2 ? 'blue' : 'red',
          role: i < 2 ? 'spymaster' : 'operative',
        })
      game().start()
      await pause(160)
      const originalKey = JSON.stringify(secret())
      mesh.membership(ids(5))
      await pause(180)
      assert(
        !game('p4').state.players.some((p) => p.identity === 'p4' && p.team) && !game('p4').key.length,
        'entrada tardia recebe tabuleiro, mas não uma equipe ou chave',
      )
      mesh.membership(ids(5).filter((id) => id !== 'p1'))
      await pause(160)
      assert(Boolean(codenamesPauseReason(state())), 'saída de mestre pausa sem expor a chave')
      mesh.membership(ids(5))
      await pause(200)
      assert(
        !codenamesPauseReason(state()) && JSON.stringify(game('p1').key) === originalKey,
        'reconexão do mestre restaura sua chave e papel',
      )
      mesh.membership(ids(5).filter((id) => id !== 'p0'))
      await pause(200)
      assert(
        !game('p1').state.gameId && !game('p1').key.length && !game('p2').key.length,
        'saída da autoridade encerra a rodada e limpa segredos',
      )
      setResults((r) => [...r, 'DONE · TODOS OS TESTES PASSARAM'])
    } catch (cause) {
      setResults((r) => [...r, `FAIL · ${cause instanceof Error ? cause.message : String(cause)}`])
    } finally {
      setRunning(false)
    }
  }
  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: 28,
        background: '#1c2532',
        color: '#e4eae8',
        font: '14px/1.7 system-ui',
      }}
    >
      <h1>Integração Codenames · 12 clientes</h1>
      <button disabled={running} onClick={() => void run()} type="button">
        {running ? 'Testando…' : 'Executar testes Codenames'}
      </button>
      <pre style={{ whiteSpace: 'pre-wrap', marginTop: 20 }}>{results.join('\n')}</pre>
    </main>
  )
}
