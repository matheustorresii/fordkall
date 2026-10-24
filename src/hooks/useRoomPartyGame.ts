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
  createGartic,
  createImpostor,
  emptyGarticState,
  emptyImpostorState,
  moveGartic,
  moveImpostor,
  parseGarticState,
  parseImpostorState,
  readGarticSettings,
  readImpostorSettings,
  syncGartic,
  syncImpostor,
  type GarticEngine,
  type GarticMove,
  type GarticSettings,
  type GarticState,
  type ImpostorEngine,
  type ImpostorSettings,
  type ImpostorState,
} from '../games/partyGames'

type Kind = 'gartic' | 'impostor'
type State = GarticState | ImpostorState
type Secret = { word: string; choices?: string[] }
type Command = {
  type: 'start' | 'move' | 'reset' | 'sync'
  gameId: string
  stepId?: string
  settings?: GarticSettings | ImpostorSettings
  move?:
    | GarticMove
    | { type: 'request-vote' }
    | { type: 'vote'; target: string }
}
const emptyPrivate: Secret = { word: '', choices: [] }
const parsePrivate = (v: unknown): Secret | null => {
  if (!v || typeof v !== 'object') return null
  const p = v as Secret
  return typeof p.word === 'string' &&
    p.word.length <= 120 &&
    (!p.choices ||
      (Array.isArray(p.choices) &&
        p.choices.length <= 3 &&
        p.choices.every((w) => typeof w === 'string' && w.length <= 60)))
    ? p
    : null
}
const configs = {
  gartic: { empty: emptyGarticState, parse: parseGarticState },
  impostor: { empty: emptyImpostorState, parse: parseImpostorState },
}
const readCommand = (kind: Kind, v: unknown): Command | null => {
  if (!v || typeof v !== 'object') return null
  const c = v as Command
  if (typeof c.gameId !== 'string' || c.gameId.length > 128) return null
  if (c.type === 'reset' || c.type === 'sync')
    return { type: c.type, gameId: c.gameId }
  if (c.type === 'start') {
    const settings =
      kind === 'gartic'
        ? readGarticSettings(c.settings)
        : readImpostorSettings(c.settings)
    return settings ? { type: 'start', gameId: c.gameId, settings } : null
  }
  if (
    c.type !== 'move' ||
    typeof c.stepId !== 'string' ||
    c.stepId.length > 128 ||
    !c.move ||
    typeof c.move !== 'object'
  )
    return null
  const m = c.move
  if (kind === 'impostor') {
    if (m.type === 'request-vote') return c
    if (
      m.type === 'vote' &&
      typeof m.target === 'string' &&
      m.target.length <= 128
    )
      return c
  } else if (
    ['finish-drawing', 'tick', 'next'].includes(m.type) ||
    (m.type === 'choose' &&
      typeof m.word === 'string' &&
      m.word.length <= 60) ||
    (m.type === 'guess' && typeof m.text === 'string' && m.text.length <= 120)
  )
    return c
  return null
}
export const useRoomPartyGame = (
  room: Room,
  kind: Kind,
  participation?: RoomGameParticipation,
) => {
  const engineRef = useRef<GarticEngine | ImpostorEngine | null>(null)
  const handleCommand = useCallback(
    (
      c: Command,
      sender: string,
      ctx: RoomGameProtocolContext<State, Secret>,
    ) => {
      const current = ctx.state,
        members = gameMembers(room, kind, participation)
          .slice(0, 12)
          .map((p) => ({
            identity: p.identity,
            name: (p.name || p.identity).slice(0, 80),
          }))
      if (c.gameId !== current.gameId) return 'Essa partida já mudou.'
      const save = (engine: GarticEngine | ImpostorEngine) => {
        engine.state.controllerIdentity = room.localParticipant.identity
        engine.state.revision = current.revision
        if (!ctx.commit(() => engine.state)) return 'O jogo está sincronizando.'
        engineRef.current = engine
        ctx.replaceSecrets(engine.state.gameId, engine.secrets)
        return null
      }
      try {
        if (c.type === 'reset') {
          if (gameStartError(kind, sender, participation))
            return 'Só quem organiza pode encerrar a partida.'
          engineRef.current = null
          ctx.commit(() => configs[kind].empty(room.localParticipant.identity))
          ctx.replaceSecrets('', {})
          return null
        }
        if (c.type === 'start') {
          const error = gameStartError(kind, sender, participation)
          if (error) return error
          if (!members.some((p) => p.identity === sender))
            return 'Você está só assistindo.'
          return save(
            kind === 'gartic'
              ? createGartic(
                  room.localParticipant.identity,
                  members,
                  c.settings as GarticSettings,
                )
              : createImpostor(
                  room.localParticipant.identity,
                  members,
                  c.settings as ImpostorSettings,
                ),
          )
        }
        const old = engineRef.current
        if (!current.gameId) return null
        if (!old || old.state.gameId !== current.gameId)
          return 'Quem guardava a rodada saiu. Iniciem outra partida.'
        const engine = { ...old, state: current }
        if (c.type === 'sync') {
          if (sender !== room.localParticipant.identity)
            return 'Ação reservada à mesa.'
          return save(
            kind === 'gartic'
              ? syncGartic(engine as GarticEngine, members)
              : syncImpostor(engine as ImpostorEngine, members),
          )
        }
        if (c.stepId !== current.stepId)
          return 'A rodada já mudou. Confira e tente novamente.'
        return save(
          kind === 'gartic'
            ? moveGartic(engine as GarticEngine, sender, c.move as GarticMove)
            : moveImpostor(
                engine as ImpostorEngine,
                sender,
                c.move as
                  | { type: 'request-vote' }
                  | { type: 'vote'; target: string },
              ),
        )
      } catch (e) {
        return e instanceof Error ? e.message : 'Não foi possível jogar.'
      }
    },
    [room, kind, participation],
  )
  const config = configs[kind]
  const parseCommand = useCallback((v: unknown) => readCommand(kind, v), [kind])
  const protocol = useRoomGameProtocol<State, Command, Secret>({
    room,
    topic: `ford-kall.${kind}.v1`,
    emptyState: config.empty,
    parseState: config.parse,
    parsePrivate,
    emptyPrivate,
    parseCommand,
    handleCommand,
    captureAuthority: () => engineRef.current,
    restoreAuthority: value => { engineRef.current = value as GarticEngine | ImpostorEngine | null },
    strictAuthority: true,
  })
  const { state, dispatch, isController, participantRevision } = protocol
  useEffect(() => {
    if (isController) dispatch({ type: 'sync', gameId: state.gameId })
  }, [
    isController,
    participantRevision,
    state.gameId,
    participation?.state.revision,
  ])
  useEffect(() => {
    if (kind !== 'gartic' || !isController) return
    const timer = window.setInterval(() => {
      const s = protocol.getState() as GarticState
      if (
        s.gameId &&
        s.deadline &&
        s.deadline <= Date.now() &&
        s.phase !== 'finished'
      )
        dispatch({
          type: 'move',
          gameId: s.gameId,
          stepId: s.stepId,
          move: { type: 'tick' },
        })
    }, 500)
    return () => window.clearInterval(timer)
  }, [kind, isController, dispatch, protocol.getState])
  return {
    ...protocol,
    identity: room.localParticipant.identity,
    secret: protocol.localPrivate,
    participantCount: gameMembers(room, kind, participation).length,
    start: (settings: GarticSettings | ImpostorSettings) =>
      dispatch({ type: 'start', gameId: state.gameId, settings }),
    move: (move: NonNullable<Command['move']>) =>
      dispatch({
        type: 'move',
        gameId: state.gameId,
        stepId: state.stepId,
        move,
      }),
    reset: () => dispatch({ type: 'reset', gameId: state.gameId }),
  }
}
export type PartyGameController = ReturnType<typeof useRoomPartyGame>
