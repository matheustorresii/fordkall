export type ItoRevealRule = 'majority' | 'unanimous' | 'anyone'
export type ItoLossRule = 'keep' | 'remove-one' | 'reset'

export interface ItoSettings {
  revealRule: ItoRevealRule
  lossRule: ItoLossRule
  targetCards: number
}

export const defaultItoSettings: ItoSettings = {
  revealRule: 'majority',
  lossRule: 'keep',
  targetCards: 2,
}

export const readItoSettings = (value: unknown): ItoSettings | null => {
  if (value === undefined) return { ...defaultItoSettings }
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ItoSettings>
  if (!['majority', 'unanimous', 'anyone'].includes(raw.revealRule ?? '') ||
    !['keep', 'remove-one', 'reset'].includes(raw.lossRule ?? '') ||
    !Number.isInteger(raw.targetCards) || raw.targetCards! < 2 || raw.targetCards! > 5) return null
  return { revealRule: raw.revealRule!, lossRule: raw.lossRule!, targetCards: raw.targetCards! }
}

/** Strict majority: 2/2, 2/3, 3/4, 3/5, 4/6, 4/7, 5/8. */
export const itoRequiredVotes = (rule: ItoRevealRule, players: number) =>
  rule === 'anyone' ? 1 : rule === 'unanimous' ? players : Math.floor(players / 2) + 1

/** Extra cards go around the table one at a time; hands never differ by more than one. */
export const itoCardCounts = (players: number, extras: number, targetCards: number): number[] => {
  if (players < 1) return []
  const bounded = Math.max(0, Math.min(Math.trunc(extras), players * (targetCards - 1)))
  return Array.from({ length: players }, (_, index) => 1 + Math.floor(bounded / players) + Number(index < bounded % players))
}

export const itoNextProgress = (extras: number, succeeded: boolean, rule: ItoLossRule, maximum: number) =>
  succeeded ? Math.min(maximum, extras + 1) : rule === 'reset' ? 0 : rule === 'remove-one' ? Math.max(0, extras - 1) : extras

export type ItoOrder = Array<string | null>
export const ITO_TOPIC_MAX_LENGTH = 120
export const itoSuggestedTopics = [
  'De quase nada urgente a precisa resolver agora', 'De péssima a ótima ideia para um domingo',
  'De pouco a muito constrangedor', 'De superpoder inútil a indispensável',
  'De nada assustador a dá medo de verdade', 'De lanche sem graça a lanche perfeito',
  'De tarefa fácil a missão impossível', 'De pouco a muito difícil de explicar',
  'De rolê tranquilo a história para contar', 'De pequeno incômodo a caos completo',
] as const

export const itoWrittenTopic = (topic: string) => topic.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ITO_TOPIC_MAX_LENGTH)

/** A suggestion is a fallback, never a replacement for a topic written by the table. */
export const itoRoundTopic = (topic: string, previous = '', random = Math.random) => {
  const custom = itoWrittenTopic(topic)
  if (custom) return custom
  const available = itoSuggestedTopics.filter((suggestion) => suggestion !== previous)
  return available[Math.floor(random() * available.length)]!
}

/** One visible slot per card. Moving a placed card swaps; an unplaced card can displace another. */
export const itoPlaceCard = (order: ItoOrder, cardId: string, slot: number): ItoOrder | null => {
  if (!cardId || !Number.isInteger(slot) || slot < 0 || slot >= order.length) return null
  const source = order.indexOf(cardId)
  if (source === slot) return order
  const next = [...order]
  if (source >= 0) next[source] = next[slot]!
  next[slot] = cardId
  return next
}

export const itoTableReady = (cards: Array<{ id: string; clue: string }>, order: ItoOrder) =>
  cards.length > 0 && cards.length === order.length && cards.every((card) => card.clue.trim() && order.includes(card.id)) &&
  new Set(order).size === cards.length && order.every((id) => id !== null)

export const isItoOrderCorrect = (order: ItoOrder, numbers: Record<string, number>) =>
  order.length > 0 && order.every((id, index) => typeof id === 'string' && Number.isInteger(numbers[id]) &&
    (index === 0 || numbers[order[index - 1]!]! < numbers[id]!))
