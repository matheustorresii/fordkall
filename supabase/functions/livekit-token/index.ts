import { AccessToken } from 'npm:livekit-server-sdk@2'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import { requireActiveProfile } from '../_shared/supabase.ts'
import { normalizeRoomCode } from '../_shared/validation.ts'

type TokenBody = { roomCode?: string }

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { admin, user, profile } = await requireActiveProfile(request)
    const { roomCode } = await readJson<TokenBody>(request)
    const roomName = normalizeRoomCode(roomCode)
    if (!roomName || roomName.length > 64) throw new HttpError(400, 'INVALID_ROOM')

    const liveKitUrl = Deno.env.get('LIVEKIT_URL')
    const apiKey = Deno.env.get('LIVEKIT_API_KEY')
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
    const developmentTokenServerId = Deno.env.get('LIVEKIT_TOKEN_SERVER_ID')
    if ((!liveKitUrl || !apiKey || !apiSecret) && !developmentTokenServerId) {
      throw new Error('LIVEKIT_NOT_CONFIGURED')
    }

    const since = new Date(Date.now() - 60_000).toISOString()
    const { count } = await admin.from('livekit_token_issuances')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('issued_at', since)
    if ((count || 0) >= 10) throw new HttpError(429, 'TOKEN_RATE_LIMIT')

    const metadata = JSON.stringify({
      fordKallProfile: {
        version: 2,
        avatarDataUrl: profile.avatar_data_url || undefined,
        bio: profile.bio || undefined,
        appearance: {
          nameColor: profile.name_color,
          nameFont: profile.name_font,
          theme: profile.profile_theme,
          avatarFrame: profile.avatar_frame,
          badge: profile.profile_badge,
        },
      },
      fordKallAccount: { userId: user.id, role: profile.role },
    })
    let participantToken = ''
    let serverUrl = liveKitUrl || ''
    if (liveKitUrl && apiKey && apiSecret) {
      const token = new AccessToken(apiKey, apiSecret, {
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
          'X-Sandbox-ID': developmentTokenServerId || '',
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

    const { error } = await admin.from('livekit_token_issuances').insert({ user_id: user.id, room_name: roomName })
    if (error) throw error
    await admin.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id)

    return json({ serverUrl, participantToken })
  } catch (error) {
    return errorResponse(error)
  }
})
