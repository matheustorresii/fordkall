import { useCallback, useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol, type RoomGameProtocolContext } from './useRoomGameProtocol'
import {
  applyCodenamesMove,
  codenamesPrivateFor,
  createCodenamesMatch,
  defaultCodenamesSettings,
  emptyCodenamesState,
  readCodenamesSettings,
  syncCodenamesMembers,
} from '../games/codenames'
import type {
  CodenamesEngine,
  CodenamesMove,
  CodenamesPrivate,
  CodenamesSettings,
  CodenamesState,
} from '../games/codenames'
import { parseCodenamesMove, parseCodenamesPrivate, parseCodenamesState } from '../games/codenamesWire'

export const CODENAMES_TOPIC = 'ford-kall.codenames.v2'
type Command =
  | { type: 'start'; gameId: string; settings: CodenamesSettings }
  | { type: 'move'; gameId: string; stepId: string; move: CodenamesMove }
  | { type: 'sync'; gameId: string }
  | { type: 'reset'; gameId: string }
const emptyPrivate: CodenamesPrivate = { key: [] }
const id = (v: unknown): v is string => typeof v === 'string' && v.length <= 128
const parseCommand = (v: unknown): Command | null => {
  if (!v || typeof v !== 'object') return null
  const raw = v as Record<string, unknown>
  if (!id(raw.gameId)) return null
  if (raw.type === 'reset') return { type: 'reset', gameId: raw.gameId }
  if (raw.type === 'sync') return { type: 'sync', gameId: raw.gameId }
  if (raw.type === 'start') {
    const settings = readCodenamesSettings(raw.settings)
    return settings ? { type: 'start', gameId: raw.gameId, settings } : null
  }
  const move = parseCodenamesMove(raw.move)
  return raw.type === 'move' && id(raw.stepId) && move
    ? { type: 'move', gameId: raw.gameId, stepId: raw.stepId, move }
    : null
}
export const useRoomCodenames = (room: Room) => {
  const engineRef = useRef<CodenamesEngine | null>(null)
  const handleCommand = useCallback(
    (
      command: Command,
      sender: string,
      context: RoomGameProtocolContext<CodenamesState, CodenamesPrivate>,
    ): string | null => {
      const current = context.state
      const members = [room.localParticipant, ...room.remoteParticipants.values()].map((p) => ({
        identity: p.identity,
        name:
          (p.name || p.identity)
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 80) || 'Jogador',
      }))
      if (!members.some((p) => p.identity === sender)) return 'Você não está nesta sala.'
      const save = (engine: CodenamesEngine) => {
        engine.state.controllerIdentity = room.localParticipant.identity
        engine.state.revision = current.revision
        if (!context.commit(() => engine.state)) return 'A mesa está sincronizando. Tente novamente.'
        engineRef.current = engine
        context.replaceSecrets(
          engine.state.gameId,
          Object.fromEntries(
            engine.state.players.map((p) => [p.identity, codenamesPrivateFor(engine, p.identity)]),
          ),
        )
        return null
      }
      try {
        if (command.gameId !== current.gameId) return 'Essa partida já mudou.'
        if (command.type === 'reset') {
          // Return to team selection; discard the old key, including for former spymasters.
          const lobby = emptyCodenamesState(room.localParticipant.identity)
          lobby.clueMode = current.clueMode
          lobby.players = current.players
            .filter((p) => members.some((m) => m.identity === p.identity))
            .map((p) => ({ ...p, connected: true }))
          return save(syncCodenamesMembers({ state: lobby, key: [] }, members))
        }
        if (command.type === 'start')
          return save(
            createCodenamesMatch(
              syncCodenamesMembers({ state: current, key: [] }, members).state,
              command.settings,
            ),
          )
        const previous = engineRef.current
        if (current.gameId && (!previous || previous.state.gameId !== current.gameId))
          return 'Quem guardava a chave saiu. Iniciem outra partida.'
        const engine = { state: current, key: previous?.key ?? [] }
        if (command.type === 'sync')
          return sender === room.localParticipant.identity
            ? save(syncCodenamesMembers(engine, members))
            : 'Ação reservada à mesa.'
        if (command.stepId !== current.stepId) return 'A mesa já mudou. Confira a pista e tente novamente.'
        return save(applyCodenamesMove(engine, sender, command.move))
      } catch (cause) {
        return cause instanceof Error ? cause.message : 'Não foi possível concluir sua jogada.'
      }
    },
    [room],
  )
  const protocol = useRoomGameProtocol<CodenamesState, Command, CodenamesPrivate>({
    room,
    topic: CODENAMES_TOPIC,
    emptyState: emptyCodenamesState,
    parseState: parseCodenamesState,
    parsePrivate: parseCodenamesPrivate,
    parseCommand,
    emptyPrivate,
    handleCommand,
    strictAuthority: true,
  })
  const { state, dispatch, isController, participantRevision } = protocol
  useEffect(() => {
    if (isController) dispatch({ type: 'sync', gameId: state.gameId })
  }, [isController, participantRevision, state.gameId, dispatch])
  return {
    state,
    key: protocol.localPrivate.key,
    error: protocol.error,
    clearError: protocol.clearError,
    isController,
    participantCount: protocol.participantCount,
    start: (settings: CodenamesSettings = defaultCodenamesSettings) =>
      dispatch({ type: 'start', gameId: state.gameId, settings }),
    move: (move: CodenamesMove) =>
      dispatch({ type: 'move', gameId: state.gameId, stepId: state.stepId, move }),
    reset: () => dispatch({ type: 'reset', gameId: state.gameId }),
  }
}
