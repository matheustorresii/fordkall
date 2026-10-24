export type DirectCallStatus =
  | 'ringing'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'missed'
  | 'busy'
  | 'ended'
export interface DirectCall {
  id: string
  caller_id: string
  recipient_id: string
  room_code: string
  status: DirectCallStatus
  created_at: string
  expires_at: string
  answered_at: string | null
  ended_at: string | null
}
export const isRinging = (call: DirectCall, now = Date.now()) =>
  call.status === 'ringing' && Date.parse(call.expires_at) > now
export const callError = (cause: unknown) => {
  const message =
    cause instanceof Error
      ? cause.message
      : String((cause as { message?: unknown })?.message || '')
  if (message.includes('CALL_DO_NOT_DISTURB'))
    return 'Essa pessoa está em Não perturbe.'
  if (message.includes('CALL_BUSY'))
    return 'Essa pessoa já está em uma chamada.'
  if (message.includes('CALL_RATE_LIMIT'))
    return 'Você ligou várias vezes. Aguarde um pouco antes de tentar de novo.'
  if (message.includes('CALL_UNAVAILABLE'))
    return 'Não foi possível ligar para essa pessoa.'
  if (message.includes('CALL_ROOM_REQUIRED'))
    return 'Sua conexão com a sala mudou. Tente novamente.'
  if (message.includes('CALL_ALREADY_ANSWERED'))
    return 'Essa chamada já foi atendida ou encerrada em outro dispositivo.'
  return 'Não foi possível completar a chamada. Confira sua conexão e tente novamente.'
}
export const directCallLabel = (call: DirectCall, userId: string) => {
  if (call.status === 'ringing')
    return call.caller_id === userId ? 'Chamando…' : 'Chamada recebida'
  return (
    {
      accepted: 'Em chamada',
      declined: 'Chamada recusada',
      cancelled: 'Chamada cancelada',
      missed: 'Chamada não atendida',
      busy: 'Pessoa ocupada',
      ended: 'Chamada encerrada',
    } as const
  )[call.status]
}
