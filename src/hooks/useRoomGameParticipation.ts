import { useCallback, useMemo } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol } from './useRoomGameProtocol'
import { recoverableGameMembers } from './useGameRecovery'
import { changeGameAttendance, emptyGameAttendance, GAME_KINDS, readGameAttendance, type GameAttendanceMap, type GameKind } from '../games/gameParticipation'

export const GAME_PARTICIPATION_TOPIC = 'ford-kall.game-participation.v1'
interface State { gameId: string; controllerIdentity: string; revision: number; games: GameAttendanceMap }
type Command = { type: 'participation'; game: GameKind; target: string; playing: boolean; revision: number } | { type: 'organize'; game: GameKind }
const emptyPrivate: never[] = []
const parsePrivate = () => emptyPrivate
const emptyState = (controllerIdentity: string, revision = 0): State => ({ gameId: '', controllerIdentity, revision, games: emptyGameAttendance() })
const parseState = (value: unknown): State | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as State, games = readGameAttendance(raw.games)
  return games && raw.gameId === '' && typeof raw.controllerIdentity === 'string' && Number.isSafeInteger(raw.revision) && raw.revision >= 0
    ? { gameId: '', controllerIdentity: raw.controllerIdentity, revision: raw.revision, games } : null
}
const parseCommand = (value: unknown): Command | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Command
  if (!GAME_KINDS.includes(raw.game)) return null
  if (raw.type === 'organize') return { type: 'organize', game: raw.game }
  return raw.type === 'participation' && typeof raw.target === 'string' && raw.target.length > 0 && raw.target.length <= 128 && typeof raw.playing === 'boolean' && Number.isSafeInteger(raw.revision)
    ? { type: 'participation', game: raw.game, target: raw.target, playing: raw.playing, revision: raw.revision } : null
}
export const useRoomGameParticipation = (room: Room) => {
  const handleCommand = useCallback((command: Command, sender: string, context: import('./useRoomGameProtocol').RoomGameProtocolContext<State, never[]>): string | null => {
    const connected = [room.localParticipant.identity, ...room.remoteParticipants.keys()]
    if (!connected.includes(sender)) return 'Você não está nesta call.'
    try {
      const current = context.state.games[command.game]
      if (command.type === 'organize') {
        if (current.spectators.includes(sender)) return 'Você escolheu só assistir. Volte a participar antes de iniciar.'
        if (current.organizer && connected.includes(current.organizer) && current.organizer !== sender) return 'Só quem organiza esta mesa pode iniciar.'
        if (current.organizer !== sender) context.commit((state) => ({ ...state, games: { ...state.games, [command.game]: { ...current, organizer: sender } } }))
        return null
      }
      if (command.target !== sender && command.revision !== context.state.revision) return 'A lista mudou. Confira os participantes e tente novamente.'
      const games = changeGameAttendance(context.state.games, command.game, sender, command.target, command.playing, connected)
      if (new TextEncoder().encode(JSON.stringify(games)).length > 13_000) return 'A lista de participantes está cheia.'
      context.commit((state) => ({ ...state, games }))
      return null
    } catch (cause) { return cause instanceof Error ? cause.message : 'Não foi possível alterar a participação.' }
  }, [room])
  const protocol = useRoomGameProtocol<State, Command, never[]>({ room, topic: GAME_PARTICIPATION_TOPIC, emptyState, parseState, parseCommand, parsePrivate, emptyPrivate, handleCommand, strictAuthority: true, preserveStateOnControllerChange: true })
  const allowed = useCallback((kind: GameKind, identity: string) => !protocol.getState().games[kind].spectators.includes(identity), [protocol.getState])
  const members = useCallback((kind: GameKind) => recoverableGameMembers(room, kind).filter((person) => allowed(kind, person.identity)), [allowed, room])
  const canStart = useCallback((kind: GameKind, identity: string) => {
    if (!allowed(kind, identity)) return false
    const host = protocol.getState().games[kind].organizer
    return !host || host === identity || ![room.localParticipant.identity, ...room.remoteParticipants.keys()].includes(host)
  }, [allowed, protocol.getState, room])
  const setPlaying = useCallback((kind: GameKind, playing: boolean) => protocol.dispatch({ type: 'participation', game: kind, target: room.localParticipant.identity, playing, revision: protocol.getState().revision }), [protocol.dispatch, protocol.getState, room])
  const remove = useCallback((kind: GameKind, identity: string) => protocol.dispatch({ type: 'participation', game: kind, target: identity, playing: false, revision: protocol.getState().revision }), [protocol.dispatch, protocol.getState])
  const organize = useCallback((kind: GameKind) => protocol.dispatch({ type: 'organize', game: kind }), [protocol.dispatch])
  return useMemo(() => ({ ...protocol, allowed, members, canStart, setPlaying, remove, organize }), [protocol.state, protocol.error, protocol.isController, protocol.participantCount, protocol.participantRevision, protocol.clearError, protocol.dispatch, protocol.getState, allowed, members, canStart, setPlaying, remove, organize])
}
export type RoomGameParticipation = ReturnType<typeof useRoomGameParticipation>
export const gameMembers = (room: Room, game: GameKind, participation?: RoomGameParticipation) => participation?.members(game) ?? recoverableGameMembers(room, game)
export const gameStartError = (game: GameKind, sender: string, participation?: RoomGameParticipation) => participation && !participation.canStart(game, sender) ? 'Você está assistindo ou esta mesa tem outro organizador.' : null
