import { useCallback, useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import {
  useRoomGameProtocol,
  type RoomGameProtocolContext,
} from './useRoomGameProtocol'
import {
  gameMembers,
  gameStartError,
  type RoomGameParticipation,
} from './useRoomGameParticipation'
import {
  advanceOdinHand,
  applyOdinMove,
  createOdinMatch,
  defaultOdinSettings,
  emptyOdinState,
  expireOdinTurn,
  odinPrivateFor,
  readOdinSettings,
  syncOdinMembers,
} from '../games/odin'
import type {
  OdinEngine,
  OdinMove,
  OdinPrivate,
  OdinSettings,
  OdinState,
} from '../games/odin'
import {
  parseOdinMove,
  parseOdinPrivate,
  parseOdinState,
} from '../games/odinWire'
export const ODIN_TOPIC = 'ford-kall.odin.v1'
type Command =
  | { type: 'start'; gameId: string; settings: OdinSettings }
  | { type: 'move'; gameId: string; stepId: string; move: OdinMove }
  | { type: 'sync'; gameId: string }
  | { type: 'next' | 'timeout'; gameId: string; stepId: string }
  | { type: 'reset'; gameId: string }
const text = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 80
export function parseOdinCommand(value: unknown): Command | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Command
  if (!text(raw.gameId)) return null
  if (raw.type === 'reset') return { type: 'reset', gameId: raw.gameId }
  if (raw.type === 'start') {
    const settings = readOdinSettings(raw.settings)
    return settings ? { type: 'start', gameId: raw.gameId, settings } : null
  }
  if (!raw.gameId) return null
  if (raw.type === 'sync') return { type: 'sync', gameId: raw.gameId }
  if (!text(raw.stepId) || !raw.stepId) return null
  if (raw.type === 'timeout' || raw.type === 'next')
    return { type: raw.type, gameId: raw.gameId, stepId: raw.stepId }
  const move = raw.type === 'move' && parseOdinMove(raw.move)
  return move
    ? { type: 'move', gameId: raw.gameId, stepId: raw.stepId, move }
    : null
}
const emptyPrivate: OdinPrivate = { hand: [] }
export function useRoomOdin(room: Room, participation?: RoomGameParticipation) {
  const engineRef = useRef<OdinEngine | null>(null)
  const handleCommand = useCallback(
    (
      command: Command,
      sender: string,
      context: RoomGameProtocolContext<OdinState, OdinPrivate>,
    ): string | null => {
      const current = context.state,
        connected = new Set(
          gameMembers(room, 'odin', participation).map((p) => p.identity),
        )
      if (
        sender !== room.localParticipant.identity &&
        !room.remoteParticipants.has(sender)
      )
        return 'Você não está nesta call.'
      if (
        !connected.has(sender) &&
        !['reset', 'sync', 'timeout'].includes(command.type)
      )
        return 'Você está só assistindo.'
      const save = (engine: OdinEngine) => {
        engine.state.controllerIdentity = room.localParticipant.identity
        engine.state.revision = current.revision
        if (!context.commit(() => engine.state))
          return 'A mesa está sincronizando. Tente novamente.'
        engineRef.current = engine
        context.replaceSecrets(
          engine.state.gameId,
          Object.fromEntries(
            engine.state.players.map((p) => [
              p.identity,
              odinPrivateFor(engine, p.identity),
            ]),
          ),
        )
        return null
      }
      try {
        if (command.type === 'reset') {
          if (command.gameId !== current.gameId) return 'Essa partida já mudou.'
          engineRef.current = null
          context.commit(() => emptyOdinState(room.localParticipant.identity))
          context.replaceSecrets('', {})
          return null
        }
        if (command.type === 'start') {
          const error = gameStartError('odin', sender, participation)
          if (error) return error
          if (
            command.gameId !== current.gameId ||
            !['lobby', 'finished'].includes(current.phase)
          )
            return 'Já existe uma partida em andamento.'
          return save(
            createOdinMatch(
              gameMembers(room, 'odin', participation).map((p) => ({
                identity: p.identity,
                name: p.name || 'Jogador',
              })),
              command.settings,
            ),
          )
        }
        if (command.gameId !== current.gameId) return 'Essa partida já mudou.'
        const previous = engineRef.current
        if (!previous || previous.state.gameId !== current.gameId)
          return 'Aguardando recuperar as cartas da mesa.'
        const engine = { ...previous, state: current }
        if (command.type === 'sync') {
          if (sender !== room.localParticipant.identity)
            return 'Ação reservada à mesa.'
          const next = syncOdinMembers(engine, connected)
          return next === engine ? null : save(next)
        }
        if (command.stepId !== current.stepId)
          return 'Essa jogada já foi resolvida. Confira a mesa.'
        if (command.type === 'timeout') {
          if (sender !== room.localParticipant.identity)
            return 'Ação reservada à mesa.'
          const next =
            current.phase === 'hand-result' &&
            current.transitionAt <= Date.now()
              ? advanceOdinHand(engine)
              : expireOdinTurn(engine)
          return next === engine ? null : save(next)
        }
        if (command.type === 'next') return save(advanceOdinHand(engine))
        if (command.type === 'move')
          return save(applyOdinMove(engine, sender, command.move))
        return 'Ação de ODIN inválida.'
      } catch (cause) {
        return cause instanceof Error
          ? cause.message
          : 'Não foi possível concluir sua jogada.'
      }
    },
    [room, participation],
  )
  const protocol = useRoomGameProtocol<OdinState, Command, OdinPrivate>({
    room,
    topic: ODIN_TOPIC,
    emptyState: emptyOdinState,
    parseState: parseOdinState,
    parseCommand: parseOdinCommand,
    parsePrivate: parseOdinPrivate,
    emptyPrivate,
    handleCommand,
    captureAuthority: () => engineRef.current,
    restoreAuthority: (value) => {
      engineRef.current = value as OdinEngine | null
    },
    strictAuthority: true,
  })
  const { state, dispatch, isController, participantRevision } = protocol
  useEffect(() => {
    if (isController && state.gameId)
      dispatch({ type: 'sync', gameId: state.gameId })
  }, [
    isController,
    state.gameId,
    participantRevision,
    dispatch,
    participation?.state.revision,
  ])
  useEffect(() => {
    const deadline = state.transitionAt || state.turnExpiresAt
    if (!isController || !deadline) return
    const timer = window.setTimeout(
      () =>
        dispatch({
          type: 'timeout',
          gameId: state.gameId,
          stepId: state.stepId,
        }),
      Math.max(1, deadline - Date.now() + 100),
    )
    return () => window.clearTimeout(timer)
  }, [
    isController,
    state.gameId,
    state.stepId,
    state.turnExpiresAt,
    state.transitionAt,
    dispatch,
  ])
  return {
    state,
    hand: protocol.localPrivate.hand,
    error: protocol.error,
    clearError: protocol.clearError,
    isController,
    participantCount: gameMembers(room, 'odin', participation).length,
    start: (settings: OdinSettings = defaultOdinSettings) =>
      dispatch({ type: 'start', gameId: state.gameId, settings }),
    move: (move: OdinMove) =>
      dispatch({
        type: 'move',
        gameId: state.gameId,
        stepId: state.stepId,
        move,
      }),
    nextHand: () =>
      dispatch({ type: 'next', gameId: state.gameId, stepId: state.stepId }),
    reset: () => dispatch({ type: 'reset', gameId: state.gameId }),
  }
}
