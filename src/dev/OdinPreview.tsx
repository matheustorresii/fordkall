import { useEffect, useState } from 'react'
import type { ParticipantMedia } from '../types'
import { OdinStage } from '../components/Games/OdinStage'
import {
  advanceOdinHand,
  applyOdinMove,
  createOdinMatch,
  defaultOdinSettings,
  emptyOdinState,
  odinDeck,
  odinLegalPlays,
  type OdinCard,
  type OdinEngine,
  type OdinMove,
  type OdinSettings,
} from '../games/odin'

const sample = (people: ParticipantMedia[], scenario = ''): OdinEngine => {
  const engine = createOdinMatch(
    people.map((p) => ({ identity: p.id, name: p.name })),
  )
  engine.state.current = 'p0'
  engine.state.starter = 'p0'
  if (
    scenario === 'capture' ||
    scenario === 'result' ||
    scenario === 'finish'
  ) {
    const pack = odinDeck(),
      card = (id: string) => pack.find((c) => c.id === id)!
    engine.state.center = ['leaf-1', 'leaf-2'].map(card)
    engine.state.lastPlayer = 'p1'
    engine.state.lastPlay = {
      id: 'sample-play',
      actor: 'p1',
      cards: engine.state.center,
      taken: null,
      value: 21,
    }
    engine.hands.p0 = [
      'leaf-8',
      'leaf-7',
      'leaf-3',
      'tide-9',
      'tide-5',
      'sun-8',
      'ember-6',
      'moon-4',
      'bloom-2',
    ].map(card)
    const used = new Set(
      [...engine.hands.p0!, ...engine.state.center].map((c) => c.id),
    )
    const remaining = pack.filter((c) => !used.has(c.id))
    people.slice(1).forEach((p) => {
      engine.hands[p.id] = remaining.splice(0, 8)
    })
    engine.aside = remaining
    engine.discarded = []
    engine.state.deckSize = 54
    engine.state.asideCount = remaining.length
    engine.state.discardedCount = 0
    engine.state.players.forEach((p) => {
      p.cardsRemaining = engine.hands[p.identity]!.length
    })
    if (scenario === 'result' || scenario === 'finish') {
      engine.discarded.push(...engine.hands.p0!)
      engine.hands.p0 = []
      engine.state.players[0]!.cardsRemaining = 0
      engine.state.discardedCount = engine.discarded.length
      engine.state.players.forEach((p, index) => {
        p.score = index ? index * 3 : 0
      })
      engine.state.result = {
        winner: 'p0',
        entries: engine.state.players.map((p) => ({
          identity: p.identity,
          penalty: p.cardsRemaining,
          total: p.score,
        })),
      }
      engine.state.phase = scenario === 'finish' ? 'finished' : 'hand-result'
      engine.state.current = ''
      engine.state.transitionAt = scenario === 'finish' ? 0 : Date.now() + 8000
      if (scenario === 'finish') {
        engine.state.winners = ['p0']
        engine.state.finishReason = 'single-hand'
      }
    }
  }
  return engine
}

export const OdinPreview = ({
  participants,
  onOpenGameHub,
}: {
  participants: ParticipantMedia[]
  onOpenGameHub: () => void
}) => {
  const query = new URLSearchParams(location.search),
    countParam = Number(query.get('players'))
  const [count, setCount] = useState(
    countParam >= 2 && countParam <= 6 ? countParam : 4,
  )
  const [engine, setEngine] = useState(() =>
    sample(participants.slice(0, count), query.get('case') || 'capture'),
  )
  const [error, setError] = useState(''),
    [auto, setAuto] = useState(false)
  const change = (fn: (previous: OdinEngine) => OdinEngine) => {
    try {
      setEngine((previous) => {
        const next = fn(previous)
        next.state.revision = previous.state.revision + 1
        return next
      })
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  const start = (settings: OdinSettings = defaultOdinSettings) =>
    change(() =>
      createOdinMatch(
        participants
          .slice(0, count)
          .map((p) => ({ identity: p.id, name: p.name })),
        settings,
      ),
    )
  useEffect(() => {
    if (
      !auto ||
      engine.state.phase !== 'playing' ||
      engine.state.current === 'p0'
    )
      return
    const timer = window.setTimeout(() => {
      const hand = engine.hands[engine.state.current]!,
        legal = odinLegalPlays(hand, engine.state.center).sort(
          (a, b) => b.length - a.length,
        )
      const ids = legal[0],
        takeId =
          engine.state.center.length > 1 && ids && ids.length < hand.length
            ? engine.state.center[0]!.id
            : undefined
      change((previous) =>
        applyOdinMove(
          previous,
          engine.state.current,
          ids ? { type: 'play', cardIds: ids, takeId } : { type: 'pass' },
        ),
      )
    }, 1100)
    return () => clearTimeout(timer)
  }, [engine, auto])
  useEffect(() => {
    if (engine.state.phase !== 'hand-result') return
    const timer = window.setTimeout(
      () => change((previous) => advanceOdinHand(previous)),
      Math.max(1, engine.state.transitionAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [engine])
  const hand: OdinCard[] = engine.hands.p0 || []
  return (
    <>
      <OdinStage
        game={{
          state: engine.state,
          hand,
          error,
          clearError: () => setError(''),
          participantCount: count,
          isController: true,
          start,
          move: (move: OdinMove) =>
            change((previous) => applyOdinMove(previous, 'p0', move)),
          nextHand: () => change((previous) => advanceOdinHand(previous)),
          reset: () =>
            change(() => ({
              state: emptyOdinState('p0'),
              hands: {},
              discarded: [],
              aside: [],
            })),
        }}
        participants={participants.slice(0, count)}
        onExit={onOpenGameHub}
        onOpenGameHub={onOpenGameHub}
      />
      {!query.has('clean') && (
        <details
          style={{
            position: 'fixed',
            bottom: 12,
            right: 12,
            zIndex: 110,
            background: '#10242eee',
            borderRadius: 8,
            padding: 8,
            color: '#e5ecdb',
            font: '12px system-ui',
          }}
        >
          <summary>Prévia ODIN</summary>
          <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
            <label>
              Pessoas{' '}
              <select
                aria-label="Pessoas na prévia"
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setCount(n)
                  setEngine(sample(participants.slice(0, n), 'capture'))
                }}
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
              />
              Jogadas automáticas dos outros
            </label>
            <button
              type="button"
              onClick={() =>
                setEngine(sample(participants.slice(0, count), 'capture'))
              }
            >
              Escolha de captura
            </button>
            <button
              type="button"
              onClick={() =>
                setEngine(sample(participants.slice(0, count), 'result'))
              }
            >
              Fim da mão
            </button>
            <button
              type="button"
              onClick={() =>
                setEngine(sample(participants.slice(0, count), 'finish'))
              }
            >
              Fim da partida
            </button>
          </div>
        </details>
      )}
    </>
  )
}
