import type { PokerCard } from './poker'

/** Own examples, strongest first. These are also checked against our evaluator. */
export const pokerHandGuide: Array<{
  name: string
  detail: string
  cards: PokerCard[]
  groups: Array<{ count: number; label: string; kicker?: boolean }>
}> = [
  { name: 'Royal flush', detail: '10 até Ás, em sequência e do mesmo naipe. É a mão mais forte.', cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'], groups: [{ count: 5, label: '10 ATÉ ÁS · MESMO NAIPE' }] },
  { name: 'Straight flush', detail: 'Aqui, 5 até 9: cinco cartas seguidas, todas de copas.', cards: ['9h', '8h', '7h', '6h', '5h'], groups: [{ count: 5, label: 'SEQUÊNCIA + MESMO NAIPE' }] },
  { name: 'Quadra', detail: 'Quatro damas. A quinta carta só desempata quadras iguais.', cards: ['Qs', 'Qh', 'Qd', 'Qc', '7s'], groups: [{ count: 4, label: '4 IGUAIS' }, { count: 1, label: 'ALTA', kicker: true }] },
  { name: 'Full house', detail: 'Três reis e dois 9: uma trinca junto com um par.', cards: ['Ks', 'Kh', 'Kd', '9c', '9s'], groups: [{ count: 3, label: 'TRINCA' }, { count: 2, label: 'PAR' }] },
  { name: 'Flush', detail: 'Cinco cartas de ouros. Não precisam estar em sequência.', cards: ['Ad', 'Jd', '8d', '5d', '2d'], groups: [{ count: 5, label: 'MESMO NAIPE' }] },
  { name: 'Sequência', detail: '5 até 9; os naipes podem ser diferentes. Ás também vale em A–2–3–4–5.', cards: ['9s', '8h', '7c', '6d', '5s'], groups: [{ count: 5, label: '5 VALORES SEGUIDOS' }] },
  { name: 'Trinca', detail: 'Três 8. As outras duas cartas servem para desempatar.', cards: ['8s', '8h', '8d', 'Kc', '3s'], groups: [{ count: 3, label: '3 IGUAIS' }, { count: 2, label: 'DESEMPATE', kicker: true }] },
  { name: 'Dois pares', detail: 'Dois valetes e dois 4. O Ás é a carta de desempate.', cards: ['Js', 'Jh', '4d', '4c', 'As'], groups: [{ count: 2, label: 'PAR' }, { count: 2, label: 'PAR' }, { count: 1, label: 'ALTA', kicker: true }] },
  { name: 'Um par', detail: 'Dois 10 formam o par. As três cartas restantes desempatam.', cards: ['Ts', 'Th', 'Ad', '8c', '3s'], groups: [{ count: 2, label: '2 IGUAIS' }, { count: 3, label: 'DESEMPATE', kicker: true }] },
  { name: 'Carta alta', detail: 'Sem par ou outra combinação. Compare Ás, depois J, 9, 6 e 2.', cards: ['As', 'Jd', '9h', '6c', '2s'], groups: [{ count: 1, label: 'ALTA' }, { count: 4, label: 'DESEMPATE', kicker: true }] },
]
