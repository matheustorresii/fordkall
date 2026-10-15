import { HttpError } from './http.ts'
import { normalizeRoomCode } from './validation.ts'
import type { DirectLiveKitBackend, LiveKitBackend } from './livekit.ts'

type Actor = { id: string; role: string; status: string }
export type DisconnectParticipantBody = {
  roomCode?: unknown
  userId?: unknown
  participantSid?: unknown
}
type Participant = { identity: string; sid: string }
export interface ModerationRoomService {
  getParticipant: (room: string, identity: string) => Promise<Participant>
  removeParticipant: (room: string, identity: string) => Promise<unknown>
}
export interface DisconnectAudit {
  actorId: string
  userId: string
  roomName: string
  participantSid: string
  backendId: string
}
interface Dependencies {
  getRoomService: (roomName: string) => Promise<{ backendId: string; service: ModerationRoomService }>
  audit: (event: DisconnectAudit) => Promise<void>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const moderationBackendForRoute = (
  backends: LiveKitBackend[],
  backendId: string | null,
): DirectLiveKitBackend => {
  // Only the persisted room route chooses a backend. Never use a client URL/key or rotate on a kick.
  const backend = backends.find((item) => item.id === backendId)
  if (!backend || backend.kind !== 'direct') throw new HttpError(503, 'CALL_MODERATION_UNAVAILABLE')
  return backend
}

export const disconnectRoomParticipant = async (
  actor: Actor,
  body: DisconnectParticipantBody,
  dependencies: Dependencies,
) => {
  // This actor must come from the authenticated DB profile, not participant metadata or request JSON.
  if (actor.role !== 'owner' || actor.status !== 'active') throw new HttpError(403, 'OWNER_REQUIRED')
  if (typeof body.roomCode !== 'string' || body.roomCode.length > 128)
    throw new HttpError(400, 'INVALID_ROOM')
  const roomName = normalizeRoomCode(body.roomCode)
  if (!roomName || roomName.length > 64) throw new HttpError(400, 'INVALID_ROOM')
  if (typeof body.userId !== 'string' || !uuid.test(body.userId))
    throw new HttpError(400, 'INVALID_PARTICIPANT')
  const userId = body.userId.toLowerCase()
  if (userId === actor.id.toLowerCase()) throw new HttpError(400, 'CANNOT_DISCONNECT_SELF')
  if (typeof body.participantSid !== 'string' || !/^PA_[A-Za-z0-9_-]{1,96}$/.test(body.participantSid)) {
    throw new HttpError(400, 'INVALID_PARTICIPANT')
  }
  const { service, backendId } = await dependencies.getRoomService(roomName)
  let owner: Participant
  try {
    owner = await service.getParticipant(roomName, actor.id)
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'not_found') throw new HttpError(403, 'OWNER_NOT_IN_ROOM')
    throw new HttpError(503, 'CALL_MODERATION_UNAVAILABLE')
  }
  if (owner.identity !== actor.id) throw new HttpError(403, 'OWNER_NOT_IN_ROOM')
  let target: Participant
  try {
    target = await service.getParticipant(roomName, userId)
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'not_found')
      throw new HttpError(404, 'PARTICIPANT_NOT_IN_ROOM')
    throw new HttpError(503, 'CALL_MODERATION_UNAVAILABLE')
  }
  if (target.identity !== userId || target.sid !== body.participantSid) {
    throw new HttpError(409, 'PARTICIPANT_CHANGED')
  }
  try {
    await service.removeParticipant(roomName, userId)
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'not_found')
      throw new HttpError(404, 'PARTICIPANT_NOT_IN_ROOM')
    throw new HttpError(503, 'CALL_MODERATION_UNAVAILABLE')
  }
  try {
    await dependencies.audit({ actorId: actor.id, userId, roomName, participantSid: target.sid, backendId })
  } catch {
    // The participant is already removed: an audit outage must not report the kick as failed.
    console.error('CALL_DISCONNECT_AUDIT_FAILED')
  }
  return { ok: true as const }
}
