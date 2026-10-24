import { useCallback, useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol, type RoomGameProtocolContext } from './useRoomGameProtocol'
import { gameMembers, gameStartError, type RoomGameParticipation } from './useRoomGameParticipation'
import {
  applyCoupMove,
  coupPrivateFor,
  createCoupMatch,
  defaultCoupSettings,
  emptyCoupState,
  expireCoupDecision,
  readCoupSettings,
  syncCoupMembers,
} from '../games/coup'
import type { CoupEngine, CoupMove, CoupPrivate, CoupSettings, CoupState } from '../games/coup'
import { parseCoupMove, parseCoupPrivate, parseCoupState } from '../games/coupWire'

export const COUP_TOPIC = 'ford-kall.coup.v2'
export { parseCoupState } from '../games/coupWire'
type Command =
  | { type: 'start'; gameId: string; settings: CoupSettings }
  | { type: 'move'; gameId: string; stepId: string; move: CoupMove }
  | { type: 'timeout'; gameId: string; stepId: string }
  | { type: 'sync'; gameId: string }
  | { type: 'reset' }
const emptyPrivate: CoupPrivate = { hand: [], exchange: [] }
const id = (value: unknown): value is string => typeof value === 'string' && value.length <= 128
const parseCommand = (value: unknown): Command | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'reset') return { type: 'reset' }
  if (!id(raw.gameId)) return null
  if (raw.type === 'start') {
    const settings = readCoupSettings(raw.settings)
    return settings ? { type: 'start', gameId: raw.gameId, settings } : null
  }
  if (!raw.gameId) return null
  if (raw.type === 'sync') return { type: 'sync', gameId: raw.gameId }
  if (!id(raw.stepId) || !raw.stepId) return null
  if (raw.type === 'timeout') return { type: 'timeout', gameId: raw.gameId, stepId: raw.stepId }
  const move = parseCoupMove(raw.move)
  return raw.type === 'move' && move ? { type: 'move', gameId: raw.gameId, stepId: raw.stepId, move } : null
}
export const useRoomCoup = (room: Room, participation?: RoomGameParticipation) => {
  const engineRef = useRef<CoupEngine | null>(null)
  const handleCommand = useCallback(
    (
      command: Command,
      sender: string,
      context: RoomGameProtocolContext<CoupState, CoupPrivate>,
    ): string | null => {
      const current = context.state,
        connected = new Set(gameMembers(room, 'coup', participation).map((member) => member.identity))
      if (sender !== room.localParticipant.identity && !room.remoteParticipants.has(sender)) return 'Você não está nesta sala.'
      if (!connected.has(sender) && !['sync', 'timeout', 'reset'].includes(command.type)) return 'Você está só assistindo.'
      const save = (engine: CoupEngine) => {
        engine.state.controllerIdentity = room.localParticipant.identity
        engine.state.revision = current.revision
        if (!context.commit(() => engine.state)) return 'A mesa está sincronizando. Tente novamente.'
        engineRef.current = engine
        context.replaceSecrets(
          engine.state.gameId,
          Object.fromEntries(
            engine.state.players.map((p) => [p.identity, coupPrivateFor(engine, p.identity)]),
          ),
        )
        return null
      }
      try {
        if (command.type === 'reset') {
          engineRef.current = null
          context.commit(() => emptyCoupState(room.localParticipant.identity))
          context.replaceSecrets('', {})
          return null
        }
        if (command.type === 'start') {
          const startError = gameStartError('coup', sender, participation)
          if (startError) return startError
          if (command.gameId !== current.gameId || !['lobby', 'finished'].includes(current.phase))
            return 'Já existe uma partida em andamento.'
          const members = gameMembers(room, 'coup', participation).map((p) => ({
            identity: p.identity,
            name:
              (p.name || p.identity)
                .replace(/[\u0000-\u001f\u007f]/g, '')
                .trim()
                .slice(0, 80) || 'Jogador',
          }))
          return save(
            createCoupMatch(members, command.settings, {
              starter: members.some((p) => p.identity === current.winner) ? current.winner : undefined,
            }),
          )
        }
        if (command.gameId !== current.gameId) return 'Essa partida já mudou.'
        const previous = engineRef.current
        if (!previous || previous.state.gameId !== current.gameId)
          return 'Quem distribuía as cartas saiu. Iniciem outra partida.'
        const engine = { ...previous, state: current }
        if (command.type === 'sync')
          return sender === room.localParticipant.identity
            ? save(syncCoupMembers(engine, connected))
            : 'Ação reservada à mesa.'
        if (command.stepId !== current.stepId) return 'Essa decisão já foi resolvida. Confira a mesa.'
        if (command.type === 'timeout')
          return sender === room.localParticipant.identity
            ? save(expireCoupDecision(engine))
            : 'Ação reservada à mesa.'
        return save(applyCoupMove(engine, sender, command.move))
      } catch (cause) {
        return cause instanceof Error ? cause.message : 'Não foi possível concluir sua jogada.'
      }
    },
    [room, participation],
  )
  const protocol = useRoomGameProtocol<CoupState, Command, CoupPrivate>({
    room,
    topic: COUP_TOPIC,
    emptyState: emptyCoupState,
    parseState: parseCoupState,
    parsePrivate: parseCoupPrivate,
    parseCommand,
    emptyPrivate,
    handleCommand,
    captureAuthority: () => engineRef.current,
    restoreAuthority: value => { engineRef.current = value as CoupEngine | null },
    strictAuthority: true,
  })
  const { state, dispatch, isController, participantRevision } = protocol
  useEffect(() => {
    if (isController && state.gameId) dispatch({ type: 'sync', gameId: state.gameId })
  }, [isController, participantRevision, state.gameId, dispatch, participation?.state.revision])
  useEffect(() => {
    if (!isController || !state.expiresAt) return
    const timer = window.setTimeout(
      () => dispatch({ type: 'timeout', gameId: state.gameId, stepId: state.stepId }),
      Math.max(1, state.expiresAt - Date.now() + 100),
    )
    return () => window.clearTimeout(timer)
  }, [isController, state.expiresAt, state.stepId, state.gameId, dispatch])
  return {
    state,
    ...protocol.localPrivate,
    error: protocol.error,
    clearError: protocol.clearError,
    isController,
    participantCount: gameMembers(room, 'coup', participation).length,
    start: (settings: CoupSettings = defaultCoupSettings) =>
      dispatch({ type: 'start', gameId: state.gameId, settings }),
    move: (move: CoupMove) => dispatch({ type: 'move', gameId: state.gameId, stepId: state.stepId, move }),
    reset: () => dispatch({ type: 'reset' }),
  }
}
