import type { KiwiCard, KiwiCardType } from '../hooks/useRoomExplodingKiwi'

type CardInfo = { title: string; description: string; art: string; color: string; family: string }
const info = (title: string, description: string, art: string, color = '#b3ce8a', family = 'AÇÃO'): CardInfo => ({ title, description, art: `/assets/exploding-kiwi/${art}.png`, color, family })
export const kiwiCards: Record<KiwiCardType, CardInfo> = {
  'kiwi-burst': info('Kiwi Explosivo', 'Se comprar, você explode. Use uma Folha-Segura para se defender.', 'kiwi-burst', '#f28d69', 'PERIGO'),
  'leaf-helmet': info('Folha-Segura', 'Guarde na mão. Ao comprar um Kiwi Explosivo, use esta carta e esconda o perigo de volta no monte.', 'leaf-helmet', '#b5db83', 'DEFESA'),
  attack: info('Ataque', 'Encerre seu turno sem comprar. A próxima pessoa recebe dois turnos, mais os turnos de ataque que você ainda devia.', 'double-turn', '#efa575'),
  favor: info('Favor', 'Escolha outra pessoa. Ela escolhe uma carta da própria mão para entregar a você.', 'kiwi-gift', '#e5ba85'),
  nope: info('Não!', 'Anule uma ação durante a janela de resposta. Outro Não! pode devolver o efeito da ação.', 'kiwi-burst', '#e37d80', 'REAÇÃO'),
  shuffle: info('Embaralhar', 'Embaralhe o monte de compra. Seu turno continua.', 'shuffle', '#ab93d2'),
  skip: info('Pular', 'Encerre um turno sem comprar. Se você deve mais turnos, eles continuam valendo.', 'skip-nap', '#8ac5bd'),
  'see-future-3': info('Ver o Futuro · 3', 'Veja em segredo as próximas três cartas. A ordem continua igual e a primeira será a próxima compra.', 'spyglass', '#82bdd9', 'FUTURO'),
  'see-future-5': info('Ver o Futuro · 5', 'Veja em segredo as próximas cinco cartas, sem mudar a ordem do monte.', 'spyglass', '#82bdd9', 'FUTURO'),
  'alter-future-3': info('Mudar o Futuro · 3', 'Veja e reorganize as próximas três cartas. A primeira da sua ordem será a próxima compra.', 'spyglass', '#b09ddb', 'FUTURO'),
  'alter-future-5': info('Mudar o Futuro · 5', 'Veja e reorganize as próximas cinco cartas.', 'spyglass', '#b09ddb', 'FUTURO'),
  'alter-future-now': info('Mudar o Futuro · Agora', 'Reorganize o topo do monte, inclusive fora do seu turno.', 'spyglass', '#b09ddb', 'AGORA'),
  'kiwi-cat-a': info('Kiwi Generoso', 'Combine duas cartas iguais para roubar uma carta. Três iguais permitem pedir uma carta pelo nome.', 'kiwi-gift', '#e2bf8c', 'COMBO'),
  'kiwi-cat-b': info('Kiwi Aventureiro', 'Combine duas cartas iguais para roubar uma carta. Três iguais permitem pedir uma carta pelo nome.', 'leaf-helmet', '#afd279', 'COMBO'),
  'kiwi-cat-c': info('Kiwi Tranquilo', 'Combine duas cartas iguais para roubar uma carta. Três iguais permitem pedir uma carta pelo nome.', 'skip-nap', '#7fbcad', 'COMBO'),
  'kiwi-cat-d': info('Kiwi Malabarista', 'Combine duas cartas iguais para roubar uma carta. Três iguais permitem pedir uma carta pelo nome.', 'shuffle', '#b3a0dc', 'COMBO'),
  'kiwi-cat-e': info('Kiwi Explorador', 'Combine duas cartas iguais para roubar uma carta. Três iguais permitem pedir uma carta pelo nome.', 'spyglass', '#83bed5', 'COMBO'),
  imploding: info('Kiwi Implosivo', 'Na primeira compra, volta aberto ao monte. Quem comprar de novo explode sem poder se defender.', 'kiwi-burst', '#ee786f', 'PERIGO'),
  'feral-kiwi': info('Kiwi Selvagem', 'Curinga para combinar com as outras cartas de Kiwi.', 'kiwi-burst', '#c5c58b', 'COMBO'),
  'targeted-attack': info('Ataque Direcionado', 'Escolha uma pessoa viva, inclusive você. Ela recebe dois turnos mais os turnos de ataque pendentes.', 'double-turn', '#efa575'),
  reverse: info('Reverter', 'Inverta o sentido da rodada. Com duas pessoas, funciona como Pular.', 'shuffle', '#af9bd1'),
  'draw-bottom': info('Comprar por Baixo', 'Compre a carta do fundo do monte e encerre o turno.', 'shuffle', '#95b8c9'),
  streaking: info('Kiwi Persistente', 'Enquanto estiver na sua mão, permite guardar um Kiwi Explosivo sem explodir.', 'skip-nap', '#b9ce90', 'PROTEÇÃO'),
  'catomic-bomb': info('Kiwi Atômico', 'Reúna todos os Kiwis Explosivos no topo do monte e encerre seu turno.', 'kiwi-burst', '#ee8d6f'),
  mark: info('Marcar', 'Marque e revele uma carta aleatória da mão de outra pessoa.', 'spyglass', '#bca0d4'),
  curse: info('Maldição do Bumbum', 'A pessoa escolhida fica sem olhar a mão até comprar uma carta segura.', 'kiwi-burst', '#bca0d4'),
  'super-skip': info('Super Pulo', 'Encerre todos os seus turnos pendentes sem comprar.', 'skip-nap', '#7cc6bd'),
  'swap-top-bottom': info('Trocar Topo e Fundo', 'Troque as cartas do topo e do fundo do monte.', 'shuffle', '#bba0d9'),
  'garbage-collection': info('Coleta de Descartes', 'Cada pessoa viva devolve uma carta ao monte. Depois, o monte é embaralhado.', 'shuffle', '#b4c593'),
  barking: info('Kiwi Latidor', 'Revele esta carta. Se outra pessoa tiver o par, ela precisa se defender.', 'kiwi-burst', '#e4ae7b'),
  'tower-of-power': info('Torre do Poder', 'Receba a reserva da torre e proteja sua mão contra roubos.', 'leaf-helmet', '#c4ce94'),
  'take-that': info('Eu Fico com Essa', 'Escolha outra pessoa. A próxima carta que ela comprar vai para você.', 'kiwi-gift', '#e5ba85'),
  potluck: info('Cada Um Dá um', 'Cada pessoa viva escolhe uma carta para colocar no topo do monte.', 'kiwi-gift', '#c9c694'),
  bury: info('Enterrar', 'Veja uma carta comprada e devolva-a em qualquer posição do monte.', 'leaf-helmet', '#c9ba83'),
  'personal-attack': info('Ataque Pessoal', 'Você recebe dois turnos adicionais. Não é preciso escolher um alvo.', 'double-turn', '#efa575'),
  'share-future': info('Compartilhar o Futuro', 'Veja e reorganize o topo do monte. A próxima pessoa também pode ver essas cartas.', 'spyglass', '#89c1d5', 'FUTURO'),
  zombie: info('Kiwi Zumbi', 'Use na defesa de um Kiwi Explosivo para sobreviver e reviver uma pessoa eliminada.', 'leaf-helmet', '#9dc8ad', 'DEFESA'),
  'attack-of-dead': info('Ataque dos Mortos', 'A próxima pessoa recebe três turnos por pessoa eliminada.', 'double-turn', '#c799ba'),
  'grave-robber': info('Ladrão de Túmulos', 'Cada pessoa eliminada devolve uma carta da mão ao monte. Depois, embaralhe.', 'shuffle', '#a7a0d0'),
  'feed-dead': info('Alimentar os Mortos', 'Escolha uma pessoa eliminada. As outras pessoas vivas entregam uma carta a ela.', 'kiwi-gift', '#c1accc', 'AGORA'),
  'dig-deeper': info('Cavar Mais Fundo', 'Veja a carta do topo. Fique com ela ou compre a seguinte e devolva a primeira ao topo.', 'spyglass', '#9cc5c2'),
  clone: info('Clone', 'Repita o efeito compatível da última carta jogada.', 'shuffle', '#baabd9'),
  clairvoyance: info('Clarividência', 'Veja em segredo a próxima carta do monte, inclusive fora do seu turno.', 'spyglass', '#8fbfd9', 'AGORA'),
  'shuffle-now': info('Embaralhar · Agora', 'Embaralhe o monte, inclusive fora do seu turno.', 'shuffle', '#ab93d2', 'AGORA'),
}

export const kiwiCardTypes = Object.keys(kiwiCards) as KiwiCardType[]
export const kiwiCardTitle = (type: KiwiCardType) => kiwiCards[type].title
export type KiwiTarget = 'none' | 'other-living' | 'living' | 'dead'
export const getKiwiPlayTarget = (cards: ReadonlyArray<Pick<KiwiCard, 'type'>>): KiwiTarget => {
  if (cards.length === 2 || cards.length === 3) return 'other-living'
  if (cards.length !== 1) return 'none'
  switch (cards[0]!.type) {
    case 'targeted-attack': return 'living'
    case 'feed-dead': return 'dead'
    case 'favor': case 'curse': case 'mark': case 'take-that': return 'other-living'
    default: return 'none'
  }
}

export const isKiwiImmediate = (type: KiwiCardType) => ['alter-future-now', 'clairvoyance', 'feed-dead', 'shuffle-now'].includes(type)

export const getKiwiCombo = (cards: ReadonlyArray<Pick<KiwiCard, 'type'>>, zombieRules: boolean): 'pair' | 'triple' | 'five' | null => {
  if (cards.length === 5 && new Set(cards.map((card) => card.type)).size === 5) return 'five'
  if (cards.length !== 2 && cards.length !== 3) return null
  const isCat = (type: KiwiCardType) => type.startsWith('kiwi-cat-') || type === 'feral-kiwi'
  const first = cards[0]!.type
  const sameTitle = cards.every((card) => card.type === first)
  const wildSet = cards.every((card) => isCat(card.type)) && cards.some((card) => card.type === 'feral-kiwi')
  const nonWild = cards.filter((card) => card.type !== 'feral-kiwi')
  const validWild = wildSet && nonWild.every((card) => card.type === nonWild[0]?.type)
  return sameTitle && (zombieRules || isCat(first)) || validWild ? cards.length === 2 ? 'pair' : 'triple' : null
}
