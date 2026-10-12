import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type RemoteParticipant, type Room } from 'livekit-client'

const ITO_TOPIC = 'ford-kall.ito.v1'
const MAX_PLAYERS = 8
const MAX_CLUE_LENGTH = 80
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type ItoPhase = 'lobby' | 'clue' | 'order' | 'revealed'

export interface ItoPlayer {
  identity: string
  name: string
  clue: string
}

export interface ItoRoomState {
  gameId: string
  controllerIdentity: string
  revision: number
  phase: ItoPhase
  topic: string
  players: ItoPlayer[]
  order: string[]
  numbers?: Record<string, number>
  succeeded?: boolean
}

type ItoCommand =
  | { type: 'start' }
  | { type: 'clue'; clue: string }
  | { type: 'move'; identity: string; offset: -1 | 1 }
  | { type: 'reveal' }
  | { type: 'reset' }

type ItoMessage =
  | { type: 'hello' | 'request' }
  | { type: 'state'; state: ItoRoomState }
  | { type: 'command'; commandId: string; command: ItoCommand }
  | { type: 'command-result'; commandId: string; error: string }
  | { type: 'number'; gameId: string; value: number }
  | { type: 'number-request'; gameId: string }

const topics = [
  'De quase nada urgente a precisa resolver agora',
  'De péssima a ótima ideia para um domingo',
  'De pouco a muito constrangedor',
  'De superpoder inútil a indispensável',
  'De nada assustador a dá medo de verdade',
  'De lanche sem graça a lanche perfeito',
  'De tarefa fácil a missão impossível',
  'De pouco a muito difícil de explicar',
  'De rolê tranquilo a história para contar',
  'De pequeno incômodo a caos completo',
]

const cleanText = (value: unknown, maxLength: number) =>
  typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
    : ''

const identitiesInRoom = (room: Room) => [
  room.localParticipant.identity,
  ...room.remoteParticipants.keys(),
].filter(Boolean)

const emptyState = (controllerIdentity: string, revision = 0): ItoRoomState => ({
  gameId: '',
  controllerIdentity,
  revision,
  phase: 'lobby',
  topic: '',
  players: [],
  order: [],
})

const parseState = (value: unknown): ItoRoomState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ItoRoomState>
  if (
    typeof raw.gameId !== 'string' ||
    typeof raw.controllerIdentity !== 'string' ||
    !Number.isInteger(raw.revision) ||
    !['lobby', 'clue', 'order', 'revealed'].includes(raw.phase ?? '') ||
    !Array.isArray(raw.players) || raw.players.length > MAX_PLAYERS ||
    !Array.isArray(raw.order)
  ) return null

  const players = raw.players.flatMap((player) => {
    if (!player || typeof player !== 'object') return []
    const candidate = player as Partial<ItoPlayer>
    const identity = cleanText(candidate.identity, 128)
    const name = cleanText(candidate.name, 80)
    if (!identity || !name || typeof candidate.clue !== 'string') return []
    return [{ identity, name, clue: cleanText(candidate.clue, MAX_CLUE_LENGTH) }]
  })
  if (players.length !== raw.players.length) return null

  const playerIds = new Set(players.map((player) => player.identity))
  const order = raw.order.map((identity) => cleanText(identity, 128))
  if (
    order.length !== players.length ||
    order.some((identity) => !playerIds.has(identity)) ||
    new Set(order).size !== order.length
  ) return null

  let numbers: Record<string, number> | undefined
  if (raw.numbers && typeof raw.numbers === 'object') {
    numbers = {}
    for (const [identity, value] of Object.entries(raw.numbers)) {
      if (!playerIds.has(identity) || !Number.isInteger(value) || value < 1 || value > 100) return null
      numbers[identity] = value
    }
  }

  return {
    gameId: cleanText(raw.gameId, 80),
    controllerIdentity: cleanText(raw.controllerIdentity, 128),
    revision: raw.revision as number,
    phase: raw.phase as ItoPhase,
    topic: cleanText(raw.topic, 120),
    players,
    order,
    ...(numbers ? { numbers } : {}),
    ...(typeof raw.succeeded === 'boolean' ? { succeeded: raw.succeeded } : {}),
  }
}

const shuffle = <T,>(values: T[]) => {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

const parseCommand = (value: unknown): ItoCommand | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ItoCommand> & Record<string, unknown>
  if (raw.type === 'start' || raw.type === 'reveal' || raw.type === 'reset') return { type: raw.type }
  if (raw.type === 'clue') {
    const clue = cleanText(raw.clue, MAX_CLUE_LENGTH)
    return clue ? { type: 'clue', clue } : null
  }
  if (raw.type === 'move') {
    const identity = cleanText(raw.identity, 128)
    return identity && (raw.offset === -1 || raw.offset === 1)
      ? { type: 'move', identity, offset: raw.offset }
      : null
  }
  return null
}

export const useRoomIto = (room: Room) => {
  const [participantRevision, setParticipantRevision] = useState(0)
  const [state, setState] = useState<ItoRoomState>(() => {
    const initialController = identitiesInRoom(room).sort()[0] || room.localParticipant.identity
    return emptyState(initialController)
  })
  const [localNumber, setLocalNumber] = useState<number | null>(null)
  const [error, setError] = useState('')
  const stateRef = useRef(state)
  const numbersRef = useRef<{ gameId: string; values: Record<string, number> }>({ gameId: '', values: {} })
  const pendingCommandsRef = useRef(new Map<string, number>())

  const applyState = useCallback((next: ItoRoomState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const publish = useCallback(async (message: ItoMessage, destinationIdentity?: string) => {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(message)), {
      reliable: true,
      topic: ITO_TOPIC,
      destinationIdentities: destinationIdentity ? [destinationIdentity] : undefined,
    })
  }, [room])

  const getControllerIdentity = useCallback((candidate = stateRef.current) => {
    const connected = identitiesInRoom(room)
    if (
      candidate.gameId &&
      candidate.controllerIdentity &&
      connected.includes(candidate.controllerIdentity)
    ) {
      return candidate.controllerIdentity
    }
    return connected.sort()[0] || room.localParticipant.identity
  }, [room])

  const sendCurrentState = useCallback((destinationIdentity: string) => {
    void publish({ type: 'state', state: stateRef.current }, destinationIdentity).catch(() => undefined)
    const current = stateRef.current
    const privateNumber = numbersRef.current
    if (
      current.gameId &&
      current.phase !== 'revealed' &&
      privateNumber.gameId === current.gameId &&
      current.players.some((player) => player.identity === destinationIdentity) &&
      Number.isInteger(privateNumber.values[destinationIdentity])
    ) {
      void publish({
        type: 'number',
        gameId: current.gameId,
        value: privateNumber.values[destinationIdentity],
      }, destinationIdentity).catch(() => undefined)
    }
  }, [publish])

  const commit = useCallback((build: (current: ItoRoomState) => ItoRoomState) => {
    if (getControllerIdentity() !== room.localParticipant.identity) return false
    const current = stateRef.current
    const next = {
      ...build(current),
      controllerIdentity: room.localParticipant.identity,
      revision: current.revision + 1,
    }
    applyState(next)
    setError('')
    void publish({ type: 'state', state: next }).catch(() => {
      setError('A sala perdeu contato com o jogo. A rodada pode demorar para sincronizar.')
    })
    return true
  }, [applyState, getControllerIdentity, publish, room])

  const performCommand = useCallback((command: ItoCommand, senderIdentity: string) => {
    const current = stateRef.current
    const player = current.players.find((candidate) => candidate.identity === senderIdentity)

    switch (command.type) {
      case 'start': {
        if (current.phase !== 'lobby' && current.phase !== 'revealed') return 'Termine ou reinicie a rodada atual antes de começar outra.'
        const members = [room.localParticipant, ...room.remoteParticipants.values()]
        if (members.length < 2) return 'O ITO precisa de pelo menos duas pessoas na sala.'
        if (members.length > MAX_PLAYERS) return `Esta primeira versão aceita até ${MAX_PLAYERS} pessoas por rodada.`

        const shuffledNumbers = shuffle(Array.from({ length: 100 }, (_, index) => index + 1))
        const values = Object.fromEntries(members.map((member, index) => [member.identity, shuffledNumbers[index]]))
        const players = members.map((member) => ({
          identity: member.identity,
          name: cleanText(member.name || member.identity, 80),
          clue: '',
        }))
        const gameId = crypto.randomUUID()
        numbersRef.current = { gameId, values }
        setLocalNumber(values[room.localParticipant.identity] ?? null)
        commit(() => ({
          ...emptyState(room.localParticipant.identity),
          gameId,
          phase: 'clue',
          topic: topics[Math.floor(Math.random() * topics.length)],
          players,
          order: players.map((candidate) => candidate.identity),
        }))
        for (const member of members) {
          if (member.identity === room.localParticipant.identity) continue
          void publish({ type: 'number', gameId, value: values[member.identity] }, member.identity).catch(() => {
            setError(`Não foi possível entregar o número secreto para ${member.name || 'uma pessoa'}.`)
          })
        }
        return null
      }
      case 'clue': {
        if (current.phase !== 'clue') return 'A rodada não está recebendo dicas agora.'
        if (!player) return 'Você não participa desta rodada.'
        if (
          numbersRef.current.gameId !== current.gameId ||
          !Number.isInteger(numbersRef.current.values[senderIdentity])
        ) return 'Aguarde receber seu número secreto antes de enviar uma dica.'
        const clue = cleanText(command.clue, MAX_CLUE_LENGTH)
        if (!clue) return 'Escreva uma dica antes de enviar.'
        commit((latest) => {
          const players = latest.players.map((candidate) =>
            candidate.identity === senderIdentity ? { ...candidate, clue } : candidate,
          )
          return {
            ...latest,
            players,
            phase: players.every((candidate) => candidate.clue) ? 'order' : 'clue',
          }
        })
        return null
      }
      case 'move': {
        if (current.phase !== 'order') return 'A ordem só pode ser ajustada depois que todos enviarem uma dica.'
        if (!player) return 'Você não participa desta rodada.'
        const index = current.order.indexOf(command.identity)
        const nextIndex = index + command.offset
        if (index < 0 || nextIndex < 0 || nextIndex >= current.order.length) return null
        commit((latest) => {
          const order = [...latest.order]
          ;[order[index], order[nextIndex]] = [order[nextIndex], order[index]]
          return { ...latest, order }
        })
        return null
      }
      case 'reveal': {
        if (!player) return 'Você não participa desta rodada.'
        if (current.phase !== 'order' || current.players.some((candidate) => !candidate.clue)) {
          return 'Esperem todas as dicas antes de revelar os números.'
        }
        if (numbersRef.current.gameId !== current.gameId) return 'O controle da rodada foi perdido; iniciem uma nova partida.'
        const numbers = Object.fromEntries(current.players.map((candidate) => [
          candidate.identity,
          numbersRef.current.values[candidate.identity],
        ]))
        if (Object.values(numbers).some((number) => !Number.isInteger(number))) {
          return 'Faltou recuperar um número secreto. Iniciem uma nova partida.'
        }
        const orderedNumbers = current.order.map((identity) => numbers[identity])
        const succeeded = orderedNumbers.every((number, index) => index === 0 || orderedNumbers[index - 1] < number)
        commit((latest) => ({ ...latest, phase: 'revealed', numbers, succeeded }))
        return null
      }
      case 'reset':
        numbersRef.current = { gameId: '', values: {} }
        setLocalNumber(null)
        commit((latest) => emptyState(room.localParticipant.identity, latest.revision))
        return null
    }
  }, [commit, publish, room])

  const ensureController = useCallback(() => {
    if (getControllerIdentity() !== room.localParticipant.identity) return false
    if (stateRef.current.controllerIdentity === room.localParticipant.identity) return true

    const wasActive = Boolean(stateRef.current.gameId)
    numbersRef.current = { gameId: '', values: {} }
    setLocalNumber(null)
    const next = emptyState(room.localParticipant.identity, stateRef.current.revision + 1)
    applyState(next)
    if (wasActive) setError('A pessoa que iniciou a partida saiu. A rodada foi encerrada.')
    void publish({ type: 'state', state: next }).catch(() => undefined)
    return true
  }, [applyState, getControllerIdentity, publish, room])

  const dispatch = useCallback((command: ItoCommand) => {
    setError('')
    const controllerIdentity = getControllerIdentity()
    if (controllerIdentity === room.localParticipant.identity) {
      ensureController()
      const result = performCommand(command, room.localParticipant.identity)
      if (result) setError(result)
      return !result
    }

    const commandId = crypto.randomUUID()
    const timeout = window.setTimeout(() => {
      pendingCommandsRef.current.delete(commandId)
      setError('O jogo não respondeu na sala. Tente novamente.')
    }, 5_000)
    pendingCommandsRef.current.set(commandId, timeout)
    void publish({ type: 'command', commandId, command }, controllerIdentity).catch(() => {
      window.clearTimeout(timeout)
      pendingCommandsRef.current.delete(commandId)
      setError('Não foi possível enviar sua ação para o jogo da sala.')
    })
    return true
  }, [ensureController, getControllerIdentity, performCommand, publish, room])

  useEffect(() => {
    const receive = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== ITO_TOPIC || !participant) return
      let message: ItoMessage
      try {
        message = JSON.parse(decoder.decode(payload)) as ItoMessage
      } catch {
        return
      }

      if (message.type === 'hello' || message.type === 'request') {
        if (ensureController()) sendCurrentState(participant.identity)
        else if (getControllerIdentity() !== room.localParticipant.identity) {
          void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
        }
        return
      }

      if (message.type === 'state') {
        const candidate = parseState(message.state)
        if (!candidate || participant.identity !== candidate.controllerIdentity) return
        const current = stateRef.current
        if (
          candidate.controllerIdentity === current.controllerIdentity &&
          candidate.revision <= current.revision
        ) return
        if (candidate.gameId !== current.gameId) setLocalNumber(null)
        applyState(candidate)
        if (
          candidate.gameId &&
          candidate.phase !== 'revealed' &&
          candidate.players.some((player) => player.identity === room.localParticipant.identity)
        ) {
          void publish({ type: 'number-request', gameId: candidate.gameId }, participant.identity).catch(() => undefined)
        }
        return
      }

      if (message.type === 'number') {
        const current = stateRef.current
        if (
          participant.identity !== current.controllerIdentity ||
          message.gameId !== current.gameId ||
          !current.players.some((player) => player.identity === room.localParticipant.identity) ||
          !Number.isInteger(message.value) || message.value < 1 || message.value > 100
        ) return
        setLocalNumber(message.value)
        return
      }

      if (message.type === 'number-request') {
        if (!ensureController()) return
        const current = stateRef.current
        const value = numbersRef.current.values[participant.identity]
        if (
          current.gameId === message.gameId &&
          numbersRef.current.gameId === current.gameId &&
          Number.isInteger(value)
        ) {
          void publish({ type: 'number', gameId: current.gameId, value }, participant.identity).catch(() => undefined)
        }
        return
      }

      if (message.type === 'command') {
        if (getControllerIdentity() !== room.localParticipant.identity || !ensureController()) return
        const command = parseCommand(message.command)
        const commandId = cleanText(message.commandId, 64)
        if (!command || !commandId) return
        const commandError = performCommand(command, participant.identity)
        void publish({ type: 'command-result', commandId, error: commandError ?? '' }, participant.identity)
          .catch(() => undefined)
        return
      }

      if (message.type === 'command-result') {
        const commandId = cleanText(message.commandId, 64)
        const timeout = pendingCommandsRef.current.get(commandId)
        if (timeout === undefined || participant.identity !== getControllerIdentity()) return
        window.clearTimeout(timeout)
        pendingCommandsRef.current.delete(commandId)
        setError(cleanText(message.error, 240))
      }
    }

    const onParticipantConnected = (participant?: RemoteParticipant) => {
      void publish({ type: 'hello' }).catch(() => undefined)
      if (participant && ensureController()) sendCurrentState(participant.identity)
      else if (getControllerIdentity() !== room.localParticipant.identity) {
        void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
      }
      setParticipantRevision((revision) => revision + 1)
    }

    const onParticipantDisconnected = (participant?: RemoteParticipant) => {
      setParticipantRevision((revision) => revision + 1)
      if (!participant || participant.identity !== stateRef.current.controllerIdentity) return
      ensureController()
    }

    room.on(RoomEvent.DataReceived, receive)
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    room.on(RoomEvent.Reconnected, onParticipantConnected)
    void publish({ type: 'hello' }).catch(() => undefined)
    const requestTimer = window.setTimeout(() => {
      if (ensureController()) return
      void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
    }, 700)

    return () => {
      window.clearTimeout(requestTimer)
      room.off(RoomEvent.DataReceived, receive)
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      room.off(RoomEvent.Reconnected, onParticipantConnected)
      for (const timeout of pendingCommandsRef.current.values()) window.clearTimeout(timeout)
      pendingCommandsRef.current.clear()
    }
  }, [applyState, ensureController, getControllerIdentity, performCommand, publish, room, sendCurrentState])

  const submitClue = useCallback((clue: string) => dispatch({ type: 'clue', clue }), [dispatch])
  const movePlayer = useCallback((identity: string, offset: -1 | 1) => dispatch({ type: 'move', identity, offset }), [dispatch])
  const start = useCallback(() => dispatch({ type: 'start' }), [dispatch])
  const reveal = useCallback(() => dispatch({ type: 'reveal' }), [dispatch])
  const reset = useCallback(() => dispatch({ type: 'reset' }), [dispatch])
  const clearError = useCallback(() => setError(''), [])
  const controllerIdentity = getControllerIdentity(state)

  // Re-render the game after roster changes even before a data packet arrives.
  void participantRevision

  return {
    state,
    localNumber,
    error,
    clearError,
    isController: controllerIdentity === room.localParticipant.identity,
    participantCount: identitiesInRoom(room).length,
    isParticipating: state.players.some((player) => player.identity === room.localParticipant.identity),
    start,
    submitClue,
    movePlayer,
    reveal,
    reset,
  }
}
