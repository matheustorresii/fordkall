import type { PokerCard } from './poker'

/** Own examples, strongest first. These are also checked against our evaluator. */
export const pokerHandGuide: Array<{ name: string; detail: string; cards: PokerCard[] }> = [
  { name: 'Royal flush', detail: '10, J, Q, K e A do mesmo naipe.', cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'] },
  { name: 'Straight flush', detail: 'Cinco em sequência, todas do mesmo naipe.', cards: ['9h', '8h', '7h', '6h', '5h'] },
  { name: 'Quadra', detail: 'Quatro cartas do mesmo valor.', cards: ['Qs', 'Qh', 'Qd', 'Qc', '7s'] },
  { name: 'Full house', detail: 'Uma trinca e um par.', cards: ['Ks', 'Kh', 'Kd', '9c', '9s'] },
  { name: 'Flush', detail: 'Cinco do mesmo naipe, sem sequência.', cards: ['Ad', 'Jd', '8d', '5d', '2d'] },
  { name: 'Sequência', detail: 'Cinco valores consecutivos. A também vale em A–2–3–4–5.', cards: ['9s', '8h', '7c', '6d', '5s'] },
  { name: 'Trinca', detail: 'Três cartas do mesmo valor.', cards: ['8s', '8h', '8d', 'Kc', '3s'] },
  { name: 'Dois pares', detail: 'Dois pares de valores diferentes.', cards: ['Js', 'Jh', '4d', '4c', 'As'] },
  { name: 'Um par', detail: 'Duas cartas do mesmo valor.', cards: ['Ts', 'Th', 'Ad', '8c', '3s'] },
  { name: 'Carta alta', detail: 'Sem combinação: compare as cartas mais altas.', cards: ['As', 'Jd', '9h', '6c', '2s'] },
]
