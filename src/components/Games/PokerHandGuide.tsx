import { pokerHandGuide } from '../../games/pokerGuide'
import { PokerCardFace } from './PokerCardFace'

export const PokerHandGuide = ({ current }: { current?: string }) => (
  <div className="poker-guide">
    <p className="poker-guide__direction">MAIS FORTE <span aria-hidden="true">↓</span> MAIS FRACA</p>
    <p className="poker-guide__legend"><i aria-hidden="true" />Dourado: cartas que formam a combinação. As demais são as cartas de desempate.</p>
    <ol className="poker-guide__list">
      {pokerHandGuide.map((hand, index) => (
        <li className={current === hand.name ? 'is-current' : ''} key={hand.name}>
          <span className="poker-guide__rank">{index + 1}</span>
          <span className="poker-guide__example" aria-label={`Exemplo de ${hand.name}`}>
            <span className="poker-guide__cards">
              {hand.cards.map((card, cardIndex) => {
                let cursor = 0
                const group = hand.groups.find((group) => { cursor += group.count; return cardIndex < cursor })
                return <PokerCardFace card={card} emphasis={group?.kicker ? 'kicker' : 'made'} key={card} />
              })}
            </span>
            <span className="poker-guide__groups" aria-hidden="true">{hand.groups.map((group, index) => <small className={group.kicker ? 'is-kicker' : ''} key={index} style={{ gridColumn: `span ${group.count}` }}>{group.label}</small>)}</span>
          </span>
          <span className="poker-guide__copy"><strong>{hand.name}{current === hand.name && <small>Sua mão</small>}</strong><span>{hand.detail}</span></span>
        </li>
      ))}
    </ol>
    <details className="poker-guide__tie">
      <summary>Como funciona uma carta de desempate?</summary>
      <p>Os dois jogos têm os mesmos dois pares: ases e reis. Quem tem a dama ganha, porque Q é maior que 9.</p>
      <div className="poker-guide__comparison">
        <div><strong>Vence</strong><span className="poker-guide__cards">{(['As', 'Ad', 'Kc', 'Kh', 'Qs'] as const).map((card, index) => <PokerCardFace card={card} emphasis={index === 4 ? 'made' : 'kicker'} key={card} />)}</span><small>A A K K <b>Q</b></small></div>
        <div><strong>Perde</strong><span className="poker-guide__cards">{(['As', 'Ad', 'Kc', 'Kh', '9s'] as const).map((card) => <PokerCardFace card={card} emphasis="kicker" key={card} />)}</span><small>A A K K <b>9</b></small></div>
      </div>
    </details>
    <p className="poker-guide__note">Empatou a combinação? Compare os valores e depois as cartas de desempate (kickers), até completar cinco cartas. Naipes não desempatam; cinco cartas iguais em valor dividem o pote.</p>
  </div>
)
