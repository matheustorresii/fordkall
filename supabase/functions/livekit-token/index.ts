import { AccessToken, RoomServiceClient } from 'npm:livekit-server-sdk@2'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import {
  liveKitHttpUrl,
  loadLiveKitBackends,
  type DirectLiveKitBackend,
} from '../_shared/livekit.ts'
import { requireActiveProfile } from '../_shared/supabase.ts'
import { normalizeRoomCode } from '../_shared/validation.ts'

type TokenBody = {
  action?: 'token' | 'report'
  roomCode?: string
  backendId?: string
  connectionAttemptId?: number
  succeeded?: boolean
  error?: string
}

const inspectLiveKitRoom = async (backend: DirectLiveKitBackend, roomName: string) => {
  try {
    const service = new RoomServiceClient(
      liveKitHttpUrl(backend.url),
      backend.apiKey,
      backend.apiSecret,
    )
    return { reachable: true, hasParticipants: (await service.listParticipants(roomName)).length > 0 }
  } catch {
    return { reachable: false, hasParticipants: false }
  }
}

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { admin, user, profile } = await requireActiveProfile(request)
    const body = await readJson<TokenBody>(request)
    const { roomCode } = body
    const roomName = normalizeRoomCode(roomCode)
    if (!roomName || roomName.length > 64) throw new HttpError(400, 'INVALID_ROOM')

    const backends = loadLiveKitBackends()
    if (backends.length === 0) {
      throw new Error('LIVEKIT_NOT_CONFIGURED')
    }

    if (body.action === 'report') {
      const backend = backends.find(({ id }) => id === body.backendId)
      const connectionAttemptId = Number(body.connectionAttemptId)
      if (!backend || !Number.isSafeInteger(connectionAttemptId) || connectionAttemptId <= 0) {
        throw new HttpError(400, 'INVALID_CONNECTION_REPORT')
      }

      const { data: issuance, error: issuanceError } = await admin
        .from('livekit_token_issuances')
        .select('id,backend_id,issued_at,reported_at')
        .eq('id', connectionAttemptId)
        .eq('user_id', user.id)
        .eq('room_name', roomName)
        .eq('backend_id', backend.id)
        .gte('issued_at', new Date(Date.now() - 5 * 60_000).toISOString())
        .maybeSingle()
      if (issuanceError || !issuance || issuance.reported_at) {
        throw new HttpError(400, 'INVALID_CONNECTION_REPORT')
      }

      const succeeded = body.succeeded === true
      let retry = false
      if (succeeded) {
        const { error: reportError } = await admin.rpc(
          'report_livekit_backend_connection',
          {
            p_room_name: roomName,
            p_backend_id: backend.id,
            p_succeeded: true,
            p_room_has_participants: true,
            p_error: null,
          },
        )
        if (reportError) throw reportError
      } else {
        let backendReachable = true
        let hasParticipants = false
        if (backend.kind === 'direct') {
          const inspection = await inspectLiveKitRoom(backend, roomName)
          backendReachable = inspection.reachable
          hasParticipants = inspection.hasParticipants
        } else {
          const { data: route } = await admin
            .from('livekit_room_routes')
            .select('confirmed_at')
            .eq('room_name', roomName)
            .eq('backend_id', backend.id)
            .maybeSingle()
          hasParticipants = Boolean(route?.confirmed_at)
        }

        if (!backendReachable) {
          const { data, error: reportError } = await admin.rpc(
            'report_livekit_backend_connection',
            {
              p_room_name: roomName,
              p_backend_id: backend.id,
              p_succeeded: false,
              p_room_has_participants: false,
              p_error: String(body.error || 'CONNECTION_FAILED'),
            },
          )
          if (reportError) throw reportError
          retry = data === true
        } else if (!hasParticipants) {
          const { data, error: releaseError } = await admin.rpc(
            'release_livekit_room_route',
            { p_room_name: roomName, p_backend_id: backend.id },
          )
          if (releaseError) throw releaseError
          retry = data === true
        }
      }

      const { error: updateError } = await admin
        .from('livekit_token_issuances')
        .update({ connection_succeeded: succeeded, reported_at: new Date().toISOString() })
        .eq('id', connectionAttemptId)
        .is('reported_at', null)
      if (updateError) throw updateError
      return json({ ok: true, retry })
    }

    const since = new Date(Date.now() - 60_000).toISOString()
    const { count } = await admin.from('livekit_token_issuances')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('issued_at', since)
    if ((count || 0) >= 10) throw new HttpError(429, 'TOKEN_RATE_LIMIT')

    const metadata = JSON.stringify({
      fordKallProfile: {
        version: 3,
        avatarDataUrl: profile.avatar_data_url || undefined,
        bio: profile.bio || undefined,
        appearance: {
          nameColor: profile.name_color,
          nameFont: profile.name_font,
          theme: profile.profile_theme,
          accentColor: profile.profile_accent_color,
          avatarFrame: profile.avatar_frame,
        },
      },
      fordKallAccount: { userId: user.id, role: profile.role },
    })
    let participantToken = ''
    let serverUrl = ''
    let backendId: string | null = null
    let provisioningError: unknown = null
    for (let attempt = 0; attempt < backends.length; attempt += 1) {
      const { data: selectedBackendId, error: assignmentError } = await admin.rpc(
        'assign_livekit_backend',
        {
          p_room_name: roomName,
          p_available_backend_ids: backends.map(({ id }) => id),
        },
      )
      if (assignmentError || typeof selectedBackendId !== 'string') {
        throw assignmentError || new Error('LIVEKIT_POOL_UNAVAILABLE')
      }
      const backend = backends.find(({ id }) => id === selectedBackendId)
      if (!backend) throw new Error('LIVEKIT_POOL_UNAVAILABLE')
      backendId = backend.id
      try {
        if (backend.kind === 'direct') {
          serverUrl = backend.url
          const token = new AccessToken(backend.apiKey, backend.apiSecret, {
            identity: user.id,
            name: profile.display_name || user.email?.split('@')[0] || 'Driver',
            metadata,
            ttl: '15m',
          })
          token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
          })
          participantToken = await token.toJwt()
        } else {
          const response = await fetch('https://cloud-api.livekit.io/api/v2/sandbox/connection-details', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Sandbox-ID': backend.sandboxId,
            },
            body: JSON.stringify({
              room_name: roomName,
              participant_identity: user.id,
              participant_name: profile.display_name || user.email?.split('@')[0] || 'Driver',
              participant_metadata: metadata,
            }),
          })
          if (!response.ok) throw new Error(`LIVEKIT_TOKEN_SERVER_${response.status}`)
          const connection = await response.json() as Record<string, unknown>
          participantToken = String(connection.participant_token || connection.participantToken || '')
          serverUrl = String(connection.server_url || connection.serverUrl || '')
          if (!participantToken || !serverUrl) throw new Error('LIVEKIT_TOKEN_SERVER_INVALID_RESPONSE')
        }
        provisioningError = null
        break
      } catch (error) {
        provisioningError = error
        const { data: route } = await admin
          .from('livekit_room_routes')
          .select('confirmed_at')
          .eq('room_name', roomName)
          .eq('backend_id', backend.id)
          .maybeSingle()
        const { data: retry } = await admin.rpc('report_livekit_backend_connection', {
          p_room_name: roomName,
          p_backend_id: backend.id,
          p_succeeded: false,
          p_room_has_participants: Boolean(route?.confirmed_at),
          p_error: error instanceof Error ? error.message : 'TOKEN_PROVISION_FAILED',
        })
        if (retry !== true) throw error
      }
    }
    if (provisioningError || !participantToken || !serverUrl || !backendId) {
      throw provisioningError || new Error('LIVEKIT_POOL_UNAVAILABLE')
    }

    const { data: issuance, error } = await admin
      .from('livekit_token_issuances')
      .insert({ user_id: user.id, room_name: roomName, backend_id: backendId })
      .select('id')
      .single()
    if (error) throw error
    await admin.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id)

    return json({
      serverUrl,
      participantToken,
      backendId,
      connectionAttemptId: issuance.id,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
