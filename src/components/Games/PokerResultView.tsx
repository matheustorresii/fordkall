import type { PokerState } from '../../games/poker'
import { PokerCardFace } from './PokerCardFace'

export const PokerResultView = ({ state }: { state: PokerState }) => {
  const result = state.result
  if (!result) return null
  const chips = (value: number) => value.toLocaleString('pt-BR')
  return (
    <div className="poker-results">
      {state.board.length > 0 && (
        <div aria-label="Cartas comunitárias" className="poker-result-board">
          {state.board.map((card) => (
            <PokerCardFace card={card} key={card} />
          ))}
        </div>
      )}
      {result.pots.map((pot, index) => (
        <div key={index}>
          <small>
            {index ? `Pote paralelo ${index}` : 'Pote principal'} · {chips(pot.amount)} fichas
          </small>
          {pot.winners.map((id) => (
            <p key={id}>
              <strong>{state.players.find((p) => p.identity === id)?.name}</strong>
              <span>{result.hands[id] ?? 'Adversários deram fold'}</span>
            </p>
          ))}
        </div>
      ))}
      {Object.keys(state.revealed).length > 0 && (
        <section aria-label="Mãos reveladas" className="poker-showdown-hands">
          {Object.entries(state.revealed).map(([id, hand]) => (
            <div key={id}>
              <span>
                {hand.map((card) => (
                  <PokerCardFace
                    card={card}
                    highlighted={Boolean(result.payouts[id]) && Boolean(result.bestCards[id]?.includes(card))}
                    key={card}
                  />
                ))}
              </span>
              <p>
                <strong>{state.players.find((p) => p.identity === id)?.name}</strong>
                <small>{result.hands[id]}</small>
              </p>
              {Boolean(result.payouts[id]) && <b>+{chips(result.payouts[id]!)}</b>}
            </div>
          ))}
        </section>
      )}
      {Object.entries(result.refunds).map(([id, amount]) => (
        <p className="game-modal__hint" key={id}>
          {chips(amount)} fichas não disputadas devolvidas para {state.players.find((p) => p.identity === id)?.name}.
        </p>
      ))}
    </div>
  )
}
