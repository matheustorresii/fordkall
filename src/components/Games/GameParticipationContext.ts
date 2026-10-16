import { createContext, useContext } from 'react'
import type { ParticipantMedia } from '../../types'
import type { GameKind } from '../../games/gameParticipation'
export interface GameParticipationUi {
  kind: GameKind
  participating: boolean
  count: number
  canStart: boolean
  members: ParticipantMedia[]
  open: () => void
}
export const GameParticipationContext = createContext<GameParticipationUi | null>(null)
export const useGameParticipationUi = () => useContext(GameParticipationContext)
