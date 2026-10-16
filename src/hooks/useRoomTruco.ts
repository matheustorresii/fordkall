import { useCallback, useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol, type RoomGameProtocolContext } from './useRoomGameProtocol'
import { applyTrucoMove, createTrucoMatch, dealNextTrucoHand, emptyTrucoState, syncTrucoMembers } from '../games/truco'
import type { TrucoCard, TrucoEngine, TrucoMove, TrucoRoomState } from '../games/truco'
import { parseTrucoHand, parseTrucoMove, parseTrucoState } from '../games/trucoWire'
export type { TrucoCard, TrucoPlay, TrucoPlayer, TrucoRaise, TrucoRank, TrucoRoomState, TrucoStake, TrucoSuit, TrucoTeam } from '../games/truco'

// v1 clients mutate the card turn during raises. Never mix the two engines at one table.
export const TRUCO_TOPIC = 'ford-kall.truco-mineiro.v2'
type Command =
  | { type: 'start' | 'next-hand'; gameId: string; stepId: string }
  | { type: 'reset'; matchId: string }
  | { type: 'move'; gameId: string; stepId: string; move: TrucoMove }
  | { type: 'sync'; gameId: string }
const emptyHand: TrucoCard[] = []
const id = (v: unknown): v is string => typeof v === 'string' && v.length <= 128
const parseCommand = (v: unknown): Command | null => {
  if (!v || typeof v !== 'object') return null
  const raw = v as Record<string, unknown>
  if (raw.type === 'reset') return id(raw.matchId) ? { type: 'reset', matchId: raw.matchId } : null
  if (!id(raw.gameId)) return null
  if (raw.type === 'sync') return { type: 'sync', gameId: raw.gameId }
  if (!id(raw.stepId)) return null
  if (raw.type === 'start' || raw.type === 'next-hand')
    return { type: raw.type, gameId: raw.gameId, stepId: raw.stepId }
  const move = parseTrucoMove(raw.move)
  return raw.type === 'move' && raw.gameId && raw.stepId && move ? { type: 'move', gameId: raw.gameId, stepId: raw.stepId, move } : null
}
export const useRoomTruco = (room: Room) => {
  const engineRef = useRef<TrucoEngine | null>(null)
  const handleCommand = useCallback((command: Command, sender: string, context: RoomGameProtocolContext<TrucoRoomState, TrucoCard[]>): string | null => {
    const current = context.state, connected = new Set([room.localParticipant.identity, ...room.remoteParticipants.keys()])
    if (!connected.has(sender)) return 'Você não está nesta sala.'
    if (command.type === 'reset') {
      if (command.matchId !== current.matchId) return 'Essa partida já mudou.'
      engineRef.current = null
      context.commit(() => emptyTrucoState(room.localParticipant.identity))
      context.replaceSecrets('', {})
      return null
    }
    if (command.gameId !== current.gameId) return 'Essa mão já terminou. Confira a mesa.'
    if (command.type !== 'sync' && command.stepId !== current.stepId) return 'Essa decisão já foi resolvida. Confira a mesa.'
    const save = (engine: TrucoEngine) => {
      engine.state.controllerIdentity = room.localParticipant.identity
      engine.state.revision = current.revision
      if (!context.commit(() => engine.state)) return 'A mesa está sincronizando. Tente novamente.'
      const previous = engineRef.current
      engineRef.current = engine
      if (previous?.state.gameId !== engine.state.gameId) context.replaceSecrets(engine.state.gameId, engine.hands)
      else for (const [identity, hand] of Object.entries(engine.hands)) {
        if (hand.map((c) => c.id).join() !== previous.hands[identity]?.map((c) => c.id).join()) context.setSecret(engine.state.gameId, identity, hand)
      }
      return null
    }
    try {
      if (command.type === 'start') {
        if (!['lobby', 'finished'].includes(current.phase)) return 'Já há uma partida em andamento nesta sala.'
        return save(createTrucoMatch([room.localParticipant, ...room.remoteParticipants.values()]
          .sort((a, b) => a.identity.localeCompare(b.identity)).map((p) => ({ identity: p.identity, name: p.name || p.identity }))))
      }
      const previous = engineRef.current
      if (!previous || previous.state.gameId !== current.gameId) return 'Quem distribuía as cartas saiu. Iniciem outra partida.'
      const engine = { ...previous, state: current }
      if (command.type === 'sync') {
        if (sender !== room.localParticipant.identity) return 'Ação reservada à mesa.'
        const next = syncTrucoMembers(engine, connected)
        return next === engine ? null : save(next)
      }
      if (!current.players.some((p) => p.identity === sender)) return 'Você está assistindo à partida.'
      if (command.type === 'next-hand') return save(dealNextTrucoHand(syncTrucoMembers(engine, connected)))
      if (command.type === 'move') return save(applyTrucoMove(syncTrucoMembers(engine, connected), sender, command.move))
      return 'Ação inválida.'
    } catch (cause) { return cause instanceof Error ? cause.message : 'Não foi possível concluir sua jogada.' }
  }, [room])
  const game = useRoomGameProtocol<TrucoRoomState, Command, TrucoCard[]>({
    room, topic: TRUCO_TOPIC, emptyState: emptyTrucoState, parseState: parseTrucoState,
    parseCommand, parsePrivate: parseTrucoHand, emptyPrivate: emptyHand, handleCommand, strictAuthority: true,
  })
  const { state, dispatch, isController, participantRevision } = game
  useEffect(() => {
    if (isController && state.gameId) dispatch({ type: 'sync', gameId: state.gameId })
  }, [isController, participantRevision, state.gameId, dispatch])
  const move = useCallback((action: TrucoMove) => dispatch({ type: 'move', gameId: state.gameId, stepId: state.stepId, move: action }), [dispatch, state.gameId, state.stepId])
  const control = useCallback((type: 'start' | 'next-hand' | 'reset') => type === 'reset'
    ? dispatch({ type: 'reset', matchId: state.matchId })
    : dispatch({ type, gameId: state.gameId, stepId: state.stepId }), [dispatch, state.gameId, state.matchId, state.stepId])
  return {
    ...game, hand: game.localPrivate,
    start: () => control('start'), play: (cardId: string) => move({ type: 'play', cardId }),
    callTruco: () => move({ type: 'call-truco' }), acceptRaise: () => move({ type: 'accept-raise' }),
    refuseRaise: () => move({ type: 'refuse-raise' }), nextHand: () => control('next-hand'), reset: () => control('reset'),
  }
}
