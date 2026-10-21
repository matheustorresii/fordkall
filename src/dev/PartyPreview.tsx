import { useMemo, useRef, useState } from 'react'
import { createGameTestMesh } from './gameTestMesh'
import { useRoomPartyGame } from '../hooks/useRoomPartyGame'
import { useRoomGameParticipation } from '../hooks/useRoomGameParticipation'
import { useRoomSketch } from '../hooks/useRoomSketch'
import { GarticStage } from '../components/Games/GarticStage'
import { ImpostorStage } from '../components/Games/ImpostorStage'
import {
  defaultGarticSettings,
  defaultImpostorSettings,
  type GarticState,
  type ImpostorState,
} from '../games/partyGames'
import type { ParticipantMedia } from '../types'
import { normalizeProfileAppearance } from '../services/profile'
import { GameParticipationContext } from '../components/Games/GameParticipationContext'
import { GameParticipationPanel } from '../components/Games/GameParticipationPanel'
import type { Room } from 'livekit-client'
const useClient = (room: Room) => {
  const participation = useRoomGameParticipation(room)
  const gartic = useRoomPartyGame(room, 'gartic', participation)
  return {
    participation,
    gartic,
    sketch: useRoomSketch(room, gartic.state as GarticState),
    impostor: useRoomPartyGame(room, 'impostor', participation),
  }
}
const pause = (ms = 80) => new Promise((r) => window.setTimeout(r, ms))
export const PartyPreview = () => {
  const mesh = useMemo(() => createGameTestMesh('*', 4), []),
    a = useClient(mesh.rooms[0]!),
    b = useClient(mesh.rooms[1]!),
    c = useClient(mesh.rooms[2]!),
    d = useClient(mesh.rooms[3]!)
  const latest = useRef([a, b, c, d])
  latest.current = [a, b, c, d]
  const [who, setWho] = useState(0),
    [kind, setKind] = useState<'gartic' | 'impostor'>(
      new URLSearchParams(location.search).get('party-preview') === 'impostor'
        ? 'impostor'
        : 'gartic',
    ),
    [result, setResult] = useState(''),
    [rosterOpen, setRosterOpen] = useState(false)
  const client = latest.current[who]!,
    game = client[kind]
  const people: ParticipantMedia[] = mesh.rooms.map((r, i) => ({
    id: r.localParticipant.identity,
    name: r.localParticipant.name || '',
    appearance: normalizeProfileAppearance({
      decorationId: ['frangoelho', 'barbie-mermaid', 'avatar-water', 'orbit'][
        i
      ],
      backgroundId: ['grove', 'barbie-coral', 'avatar-water', 'dusk'][i],
      avatarFrame: 'none',
    }),
    isLocal: i === who,
    microphoneMuted: false,
    cameraEnabled: false,
  }))
  const run = async () => {
    try {
      setResult('Testando quatro clientes…')
      a.participation.setPlaying('impostor', false)
      await pause()
      b.participation.organize('impostor')
      await pause()
      b.impostor.start(defaultImpostorSettings)
      await pause(150)
      if (
        latest.current.some((x) =>
          x.impostor.state.players.some((p) => p.identity === 'p0'),
        )
      )
        throw Error('Controlador espectador recebeu palavra')
      if (latest.current[0]!.impostor.secret.word)
        throw Error('Espectador recebeu segredo')
      const words = latest.current.slice(1).map((x) => x.impostor.secret.word)
      if (!words.every(Boolean) || new Set(words).size !== 2)
        throw Error('Palavras privadas')
      latest.current[1]!.impostor.move({ type: 'request-vote' })
      latest.current[2]!.impostor.move({ type: 'request-vote' })
      await pause()
      if (
        latest.current.some(
          (x) => (x.impostor.state as ImpostorState).phase !== 'vote',
        )
      )
        throw Error('Maioria')
      for (const x of latest.current.slice(1))
        x.impostor.move({ type: 'vote', target: 'p1' })
      await pause()
      if (
        latest.current.some(
          (x) => (x.impostor.state as ImpostorState).phase !== 'result',
        )
      )
        throw Error('Votos')
      latest.current[1]!.impostor.reset()
      a.participation.setPlaying('gartic', false)
      await pause()
      b.participation.organize('gartic')
      await pause()
      latest.current[1]!.gartic.start({
        ...defaultGarticSettings,
        customWords: 'Kiwi',
      })
      await pause()
      const draw = latest.current[1]!.gartic
      draw.move({ type: 'choose', word: draw.secret.choices![0]! })
      await pause()
      if (
        latest.current[2]!.gartic.secret.word ||
        !latest.current[1]!.gartic.secret.word
      )
        throw Error('Palavra do desenho vazou')
      latest.current[2]!.gartic.move({ type: 'guess', text: 'kiwi' })
      latest.current[3]!.gartic.move({ type: 'guess', text: 'kiwi' })
      await pause()
      if (
        latest.current.some(
          (x) => (x.gartic.state as GarticState).phase !== 'roundEnd',
        )
      )
        throw Error('Resultado do desenho')
      const leaked = mesh.packets.some(
        (p) =>
          p.message.type === 'state' &&
          JSON.stringify(p.message).includes('"choices":["Kiwi"]'),
      )
      if (leaked) throw Error('Segredo em broadcast')
      setResult(
        'PASS: quatro clientes · optout · palavras privadas · maioria · voto · palpites · resultado · nenhum segredo em broadcast',
      )
    } catch (e) {
      setResult(`FAIL: ${String(e)}`)
    }
  }
  const participationUi = {
    kind,
    participating: client.participation.allowed(kind, game.identity),
    count: client.participation.members(kind).length,
    canStart: client.participation.canStart(kind, game.identity),
    members: people.filter((p) => client.participation.allowed(kind, p.id)),
    open: () => setRosterOpen(true),
  }
  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <GameParticipationContext.Provider value={participationUi}>
        {kind === 'gartic' ? (
          <GarticStage
            sketch={client.sketch}
            game={game}
            participants={people}
            onExit={() => {}}
            onOpenGameHub={() => location.assign('?game-preview=hub')}
          />
        ) : (
          <ImpostorStage
            game={game}
            participants={people}
            onExit={() => {}}
            onOpenGameHub={() => location.assign('?game-preview=hub')}
          />
        )}
      </GameParticipationContext.Provider>
      {rosterOpen && (
        <GameParticipationPanel
          kind={kind}
          participation={client.participation}
          participants={people}
          activeIds={game.state.players.map((p) => p.identity)}
          active={Boolean(game.state.gameId)}
          onClose={() => setRosterOpen(false)}
        />
      )}
      {!new URLSearchParams(location.search).has('clean') && (
        <details
          style={{
            position: 'fixed',
            left: 10,
            bottom: 5,
            zIndex: 100,
            padding: 8,
            background: '#1d2a3e',
            maxWidth: 650,
            font: '11px system-ui',
            color: 'white',
          }}
        >
          <summary>Teste dos novos jogos</summary>
          <div>
            {people.map((p, i) => (
              <button key={p.id} onClick={() => setWho(i)}>
                {p.name}
              </button>
            ))}
            <button
              onClick={() => setKind(kind === 'gartic' ? 'impostor' : 'gartic')}
            >
              Trocar jogo
            </button>
            <button onClick={() => void run()}>Rodar teste de rede</button>
          </div>
          <output>{result}</output>
          <output aria-label="Réplicas do desenho">
            {latest.current
              .map((x, i) => `p${i}: ${x.sketch.view.count}`)
              .join(' · ')}
          </output>
        </details>
      )}
    </main>
  )
}
