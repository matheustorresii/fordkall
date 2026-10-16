import { pokerHandGuide } from '../../games/pokerGuide'
import { PokerCardFace } from './PokerCardFace'

export const PokerHandGuide = ({ current }: { current?: string }) => (
  <div className="poker-guide">
    <p className="poker-guide__direction">MAIS FORTE <span aria-hidden="true">↓</span> MAIS FRACA</p>
    <ol className="poker-guide__list">
      {pokerHandGuide.map((hand, index) => (
        <li className={current === hand.name ? 'is-current' : ''} key={hand.name}>
          <span className="poker-guide__rank">{index + 1}</span>
          <span className="poker-guide__cards" aria-label={`Exemplo de ${hand.name}`}>
            {hand.cards.map((card) => <PokerCardFace card={card} key={card} />)}
          </span>
          <span className="poker-guide__copy"><strong>{hand.name}{current === hand.name && <small>Sua mão</small>}</strong><span>{hand.detail}</span></span>
        </li>
      ))}
    </ol>
    <p className="poker-guide__note">Empatou a combinação? Compare os valores e depois as cartas de desempate (kickers), até completar cinco cartas. Naipes não desempatam; cinco cartas iguais em valor dividem o pote.</p>
  </div>
)
