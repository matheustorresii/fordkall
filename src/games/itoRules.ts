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

export const isItoOrderCorrect = (order: string[], numbers: Record<string, number>) =>
  order.length > 0 && order.every((id, index) => Number.isInteger(numbers[id]) && (index === 0 || numbers[order[index - 1]!]! < numbers[id]!))
