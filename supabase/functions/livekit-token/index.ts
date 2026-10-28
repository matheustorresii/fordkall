import { AccessToken, RoomServiceClient } from 'npm:livekit-server-sdk@2'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import {
  liveKitHttpUrl,
  loadLiveKitBackends,
  type DirectLiveKitBackend,
  type SandboxLiveKitBackend,
} from '../_shared/livekit.ts'
import { requireActiveProfile } from '../_shared/supabase.ts'
import { normalizeRoomCode } from '../_shared/validation.ts'
import {
  AdmissionFailure,
  admitIssuedConnection,
  classifyAdmission,
  failureDecision,
  inspectRoomOccupancy,
  normalizeFailedBackends,
  probeLiveKitAdmission,
} from '../_shared/livekitFailover.ts'

type TokenBody = {
  action?: 'token' | 'report'
  roomCode?: string
  backendId?: string
  connectionAttemptId?: number
  succeeded?: boolean
  error?: string
  privateRoom?: boolean
  failedBackendIds?: string[]
  errorStatus?: number
}

const inspectLiveKitRoom = (backend: DirectLiveKitBackend, roomName: string) =>
  inspectRoomOccupancy(async () => {
    const service = new RoomServiceClient(
      liveKitHttpUrl(backend.url),
      backend.apiKey,
      backend.apiSecret,
    )
    return service.listParticipants(roomName)
  })

const joinToken = async (
  backend: DirectLiveKitBackend,
  roomName: string,
  identity: string,
  name?: string,
  metadata?: string,
) => {
  const token = new AccessToken(backend.apiKey, backend.apiSecret, {
    identity,
    name,
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
  return token.toJwt()
}

const sandboxConnection = async (
  backend: SandboxLiveKitBackend,
  roomName: string,
  identity: string,
  name = 'Driver',
  metadata?: string,
) => {
  const response = await fetch(
    'https://cloud-api.livekit.io/api/v2/sandbox/connection-details',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sandbox-ID': backend.sandboxId,
      },
      body: JSON.stringify({
        room_name: roomName,
        participant_identity: identity,
        participant_name: name,
        participant_metadata: metadata,
      }),
      signal: AbortSignal.timeout(4000),
    },
  )
  if (!response.ok)
    throw new AdmissionFailure(
      classifyAdmission(response.status, await response.text()),
    )
  const connection = (await response.json()) as Record<string, unknown>
  const participantToken = String(
    connection.participant_token || connection.participantToken || '',
  )
  const serverUrl = String(connection.server_url || connection.serverUrl || '')
  if (!participantToken || !/^wss:\/\//i.test(serverUrl))
    throw Error('LIVEKIT_TOKEN_SERVER_INVALID_RESPONSE')
  return { participantToken, serverUrl }
}

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST')
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { admin, user, profile } = await requireActiveProfile(request)
    const body = await readJson<TokenBody>(request)
    const { roomCode } = body
    const roomName = normalizeRoomCode(roomCode)
    if (!roomName || roomName.length > 64)
      throw new HttpError(400, 'INVALID_ROOM')

    const backends = loadLiveKitBackends()
    if (backends.length === 0) {
      throw new HttpError(503, 'LIVEKIT_NOT_CONFIGURED')
    }
    const failedBackendIds = normalizeFailedBackends(
      body.failedBackendIds,
      backends.map((backend) => backend.id),
    )

    if (body.action === 'report') {
      const backend = backends.find(({ id }) => id === body.backendId)
      const connectionAttemptId = Number(body.connectionAttemptId)
      if (
        !backend ||
        !Number.isSafeInteger(connectionAttemptId) ||
        connectionAttemptId <= 0
      ) {
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
      // Consume the report atomically, before any upstream await. Two tabs cannot
      // count the same failed attempt twice or race success against failure.
      const { data: claimed, error: claimError } = await admin
        .from('livekit_token_issuances')
        .update({
          connection_succeeded: succeeded,
          reported_at: new Date().toISOString(),
        })
        .eq('id', connectionAttemptId)
        .is('reported_at', null)
        .select('id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) throw new HttpError(409, 'CONNECTION_ALREADY_REPORTED')
      let retry = false
      let failureCode: string | null = null
      let admissionStatus: number | null = null
      let preserveRoom = false
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
        let markBackendFailed = false
        if (backend.kind === 'direct') {
          const token = await joinToken(backend, roomName, user.id)
          const [admission, occupancy, routeResult] = await Promise.all([
            probeLiveKitAdmission(backend.url, token),
            inspectLiveKitRoom(backend, roomName),
            admin
              .from('livekit_room_routes')
              .select('confirmed_at')
              .eq('room_name', roomName)
              .eq('backend_id', backend.id)
              .maybeSingle(),
          ])
          if (routeResult.error) throw routeResult.error
          const decision = failureDecision(
            admission,
            occupancy,
            Boolean(routeResult.data?.confirmed_at),
          )
          failureCode = decision.code
          admissionStatus = admission.httpStatus
          markBackendFailed = decision.markBackendFailed
          preserveRoom = decision.preserveRoom
        } else {
          const { data: route, error: routeError } = await admin
            .from('livekit_room_routes')
            .select('confirmed_at')
            .eq('room_name', roomName)
            .eq('backend_id', backend.id)
            .maybeSingle()
          if (routeError) throw routeError
          preserveRoom = Boolean(route?.confirmed_at)
          try {
            const connection = await sandboxConnection(
              backend,
              roomName,
              user.id,
            )
            const admission = await probeLiveKitAdmission(
              connection.serverUrl,
              connection.participantToken,
            )
            const decision = failureDecision(admission, 'unknown', preserveRoom)
            failureCode = decision.code
            admissionStatus = admission.httpStatus
            markBackendFailed = decision.markBackendFailed
          } catch (error) {
            failureCode =
              error instanceof AdmissionFailure
                ? error.admission.code
                : 'BACKEND_UNAVAILABLE'
            admissionStatus =
              error instanceof AdmissionFailure
                ? error.admission.httpStatus
                : null
            markBackendFailed = true
          }
        }

        if (markBackendFailed) {
          const { data, error: reportError } = await admin.rpc(
            'report_livekit_backend_connection',
            {
              p_room_name: roomName,
              p_backend_id: backend.id,
              p_succeeded: false,
              p_room_has_participants: preserveRoom,
              p_error: failureCode,
            },
          )
          if (reportError) throw reportError
          retry = data === true
        } else if (!preserveRoom) {
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
        .update({
          connection_error_code: failureCode,
          connection_http_status: admissionStatus,
          connection_client_status:
            typeof body.errorStatus === 'number' &&
            Number.isInteger(body.errorStatus) &&
            body.errorStatus >= 400 &&
            body.errorStatus <= 599
              ? body.errorStatus
              : null,
        })
        .eq('id', connectionAttemptId)
      if (updateError) throw updateError
      if (succeeded) {
        const { data: attendance, error: attendanceError } = await admin
          .from('livekit_token_issuances')
          .update({ room_seen_at: new Date().toISOString() })
          .eq('id', connectionAttemptId)
          .is('room_left_at', null)
          .select('id')
          .maybeSingle()
        if (attendanceError) throw attendanceError
        if (attendance) {
          const { error: memberError } = await admin
            .from('call_room_members')
            .upsert({
              room_code: roomName,
              user_id: user.id,
              seen_at: new Date().toISOString(),
            })
          if (memberError) throw memberError
        }
      }
      let errorCode: string | null = null
      if (!succeeded) {
        if (!retry && !preserveRoom) {
          const { data: currentRoute, error: routeError } = await admin
            .from('livekit_room_routes')
            .select('backend_id')
            .eq('room_name', roomName)
            .maybeSingle()
          if (routeError) throw routeError
          // Another report may already have released/moved the empty route.
          if (!currentRoute || currentRoute.backend_id !== backend.id)
            retry = true
        }
        if (!retry) errorCode = 'LIVEKIT_ROOM_UNAVAILABLE'
        else {
          const excluded = new Set([...failedBackendIds, backend.id])
          const { data: options, error: optionsError } = await admin
            .from('livekit_backends')
            .select('id,enabled,cooldown_until')
            .in(
              'id',
              backends.map((item) => item.id),
            )
          if (optionsError) throw optionsError
          retry = (options || []).some(
            (item) =>
              item.enabled &&
              !excluded.has(item.id) &&
              (!item.cooldown_until ||
                Date.parse(item.cooldown_until) <= Date.now()),
          )
          if (!retry)
            errorCode =
              failureCode === 'CLIENT_SIGNAL_FAILED' ||
              failureCode === 'VALIDATION_UNAVAILABLE' ||
              failureCode === 'REGION_UNAVAILABLE'
                ? 'LIVEKIT_CLIENT_CONNECTION_FAILED'
                : 'LIVEKIT_POOL_UNAVAILABLE'
        }
      }
      return json({ ok: true, retry, errorCode, failureCode })
    }

    const since = new Date(Date.now() - 60_000).toISOString()
    const { count } = await admin
      .from('livekit_token_issuances')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('issued_at', since)
    if ((count || 0) >= 10) throw new HttpError(429, 'TOKEN_RATE_LIMIT')

    // First creation fixes visibility; joining must never turn a private room public.
    const { error: roomError } = await admin.from('call_rooms').upsert(
      {
        code: roomName,
        is_private: body.privateRoom === true,
        created_by: user.id,
      },
      { onConflict: 'code', ignoreDuplicates: true },
    )
    if (roomError) throw roomError
    const { data: roomPrivacy, error: privacyError } = await admin
      .from('call_rooms')
      .select('is_private')
      .eq('code', roomName)
      .single()
    if (privacyError) throw privacyError

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
          decorationId: profile.decoration_id,
          backgroundId: profile.call_background_id,
        },
      },
      fordKallAccount: { userId: user.id, role: profile.role },
    })
    let participantToken = ''
    let serverUrl = ''
    let backendId: string | null = null
    let provisioningError: unknown = null
    let admissionResult: unknown = null
    const attempted = new Set(failedBackendIds)
    for (let attempt = 0; attempt < backends.length; attempt += 1) {
      const { data: selectedBackendId, error: assignmentError } =
        await admin.rpc('assign_livekit_backend_v2', {
          p_room_name: roomName,
          p_available_backend_ids: backends.map(({ id }) => id),
          p_excluded_backend_ids: [...attempted],
        })
      if (assignmentError || typeof selectedBackendId !== 'string') {
        if (assignmentError?.message?.includes('LIVEKIT_ROOM_UNAVAILABLE'))
          throw new HttpError(503, 'LIVEKIT_ROOM_UNAVAILABLE')
        if (
          !assignmentError ||
          assignmentError.message?.includes('LIVEKIT_POOL_UNAVAILABLE')
        )
          throw new HttpError(503, 'LIVEKIT_POOL_UNAVAILABLE')
        throw assignmentError
      }
      const backend = backends.find(({ id }) => id === selectedBackendId)
      if (!backend) throw new Error('LIVEKIT_POOL_UNAVAILABLE')
      backendId = backend.id
      try {
        if (backend.kind === 'direct') {
          serverUrl = backend.url
          participantToken = await joinToken(
            backend,
            roomName,
            user.id,
            profile.display_name || user.email?.split('@')[0] || 'Driver',
            metadata,
          )
        } else {
          const connection = await sandboxConnection(
            backend,
            roomName,
            user.id,
            profile.display_name || user.email?.split('@')[0] || 'Driver',
            metadata,
          )
          participantToken = connection.participantToken
          serverUrl = connection.serverUrl
        }
        // A broker returning a JWT is not evidence that the project's gateway accepts it.
        // Direct credentials and sandbox/token-server projects MUST share this path.
        admissionResult = await admitIssuedConnection({
          serverUrl,
          participantToken,
        })
        provisioningError = null
        break
      } catch (error) {
        provisioningError = error
        attempted.add(backend.id)
        const { error: diagnosticError } = await admin
          .from('livekit_token_issuances')
          .insert({
            user_id: user.id,
            room_name: roomName,
            backend_id: backend.id,
            connection_succeeded: false,
            reported_at: new Date().toISOString(),
            connection_error_code:
              error instanceof AdmissionFailure
                ? error.admission.code
                : 'TOKEN_PROVISION_FAILED',
            connection_http_status:
              error instanceof AdmissionFailure
                ? error.admission.httpStatus
                : null,
          })
        if (diagnosticError) throw diagnosticError
        const { data: route } = await admin
          .from('livekit_room_routes')
          .select('confirmed_at')
          .eq('room_name', roomName)
          .eq('backend_id', backend.id)
          .maybeSingle()
        let preserveRoom = Boolean(route?.confirmed_at)
        if (error instanceof AdmissionFailure && backend.kind === 'direct') {
          preserveRoom = failureDecision(
            error.admission,
            await inspectLiveKitRoom(backend, roomName),
            preserveRoom,
          ).preserveRoom
        }
        const { data: retry, error: reportError } = await admin.rpc(
          'report_livekit_backend_connection',
          {
            p_room_name: roomName,
            p_backend_id: backend.id,
            p_succeeded: false,
            p_room_has_participants: preserveRoom,
            p_error:
              error instanceof AdmissionFailure
                ? error.admission.code
                : 'TOKEN_PROVISION_FAILED',
          },
        )
        if (reportError) throw reportError
        if (retry !== true) throw new HttpError(503, 'LIVEKIT_ROOM_UNAVAILABLE')
      }
    }
    if (provisioningError || !participantToken || !serverUrl || !backendId) {
      throw new HttpError(503, 'LIVEKIT_POOL_UNAVAILABLE')
    }

    const { data: issuance, error } = await admin
      .from('livekit_token_issuances')
      .insert({ user_id: user.id, room_name: roomName, backend_id: backendId })
      .select('id')
      .single()
    if (error) throw error
    await admin
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', user.id)

    return json({
      admissionPolicy: 'rtc-gateway-v1',
      admission: admissionResult,
      serverUrl,
      participantToken,
      backendId,
      connectionAttemptId: issuance.id,
      privateRoom: roomPrivacy.is_private,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
