import { useRef, useState } from 'react'
import type { ParticipantMedia } from '../types'
import { TrucoMineiroStage } from '../components/Games/TrucoMineiroStage'
import { applyTrucoMove, createTrucoMatch, dealNextTrucoHand, trucoCanRespond, trucoPlayerAt } from '../games/truco'
import type { TrucoEngine } from '../games/truco'

/** Interactive preview uses the production reducer, not a second mock ruleset. */
export const TrucoPreview = ({ participants, onOpenGameHub }: { participants: ParticipantMedia[]; onOpenGameHub: () => void }) => {
  const create = () => createTrucoMatch(participants.slice(0, 4).map((p) => ({ identity: p.id, name: p.name })), { dealerSeat: 3 })
  const [engine, setEngine] = useState(create), ref = useRef(engine)
  const [local, setLocal] = useState(participants[0]!.id), [error, setError] = useState('')
  const update = (build: (previous: TrucoEngine) => TrucoEngine) => {
    try { const next = build(ref.current); ref.current = next; setEngine(next); setError(''); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro na prévia.'); return false }
  }
  const action = (type: 'call-truco' | 'accept-raise' | 'refuse-raise') => update((e) => applyTrucoMove(e, local, { type }))
  return <>
    <TrucoMineiroStage participants={participants.slice(0, 4).map((p) => ({ ...p, isLocal: p.id === local }))} onExit={onOpenGameHub} onOpenGameHub={onOpenGameHub} game={{
      state: engine.state, hand: engine.hands[local] ?? [], error, clearError: () => setError(''), participantCount: 4,
      start: () => update(create), reset: () => update(create), nextHand: () => update(dealNextTrucoHand),
      play: (cardId) => update((e) => applyTrucoMove(e, local, { type: 'play', cardId })),
      callTruco: () => action('call-truco'), acceptRaise: () => action('accept-raise'), refuseRaise: () => action('refuse-raise'),
    }} />
    {!new URLSearchParams(window.location.search).has('clean') && <details style={{ position: 'fixed', left: 12, top: 72, zIndex: 100, maxWidth: 270, background: '#15231ef5', color: '#e7eddf', borderRadius: 10, padding: 10, font: '12px system-ui' }}>
      <summary>Prévia do Truco · engine real</summary>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', paddingTop: 8 }}>
        {engine.state.players.map((p) => <button key={p.identity} onClick={() => setLocal(p.identity)} type="button">Visão {p.name}</button>)}
        <button onClick={() => update((e) => { const id = trucoPlayerAt(e.state)!.identity; return applyTrucoMove(e, id, { type: 'play', cardId: e.hands[id]![0]!.id }) })} type="button">Jogar carta da vez</button>
        <button onClick={() => update((e) => applyTrucoMove(e, trucoPlayerAt(e.state)!.identity, { type: 'call-truco' }))} type="button">Pedido da vez</button>
        <button onClick={() => update((e) => applyTrucoMove(e, e.state.players.find((p) => trucoCanRespond(e.state, p.identity))!.identity, { type: 'accept-raise' }))} type="button">Adversário aceita</button>
        <button onClick={() => update(create)} type="button">Restaurar Truco</button>
      </div>
      <output style={{ display: 'block', paddingTop: 6 }}>Carta: {trucoPlayerAt(engine.state)?.name} · {engine.state.trickPlays.length}/4 jogadas</output>
    </details>}
  </>
}
