import { invokeFunction } from './supabase'

export const disconnectCallParticipant = (roomCode: string, userId: string, participantSid: string) =>
  invokeFunction<{ ok: true }>('admin', {
    action: 'disconnect_participant',
    roomCode,
    userId,
    participantSid,
  })

export const friendlyModerationError = (error: unknown) => {
  const code = error instanceof Error ? error.message : ''
  if (code === 'OWNER_REQUIRED' || code === 'ADMIN_REQUIRED')
    return 'Somente o owner pode desconectar participantes.'
  if (code === 'OWNER_NOT_IN_ROOM') return 'Entre nesta call antes de desconectar alguém.'
  if (code === 'PARTICIPANT_NOT_IN_ROOM') return 'Essa pessoa já saiu da call.'
  if (code === 'PARTICIPANT_CHANGED')
    return 'Essa pessoa reconectou. Feche este aviso e abra os controles dela novamente.'
  if (code === 'AUTH_REQUIRED' || code === 'INVALID_SESSION') return 'Sua sessão expirou. Entre novamente.'
  if (code === 'ACCOUNT_SUSPENDED') return 'Sua conta não pode realizar essa ação.'
  return 'Não foi possível desconectar essa pessoa. Tente novamente.'
}
