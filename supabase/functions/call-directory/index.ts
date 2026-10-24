import { RoomServiceClient } from 'npm:livekit-server-sdk@2'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, json } from '../_shared/http.ts'
import { requireActiveProfile } from '../_shared/supabase.ts'
import { liveKitHttpUrl, loadLiveKitBackends } from '../_shared/livekit.ts'
import { refreshCallDirectory } from '../_shared/callDirectory.ts'

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST')
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const { admin } = await requireActiveProfile(request)
    const backends = loadLiveKitBackends()
    const publicCodes: string[] = []
    let cursor = ''
    // PostgREST has a row cap. Never silently exclude newer rooms once the registry grows.
    for (;;) {
      const page = await admin.from('call_rooms').select('code').eq('is_private', false)
        .gt('code', cursor).order('code').limit(500)
      if (page.error) throw page.error
      const codes = (page.data || []).map((room) => String(room.code))
      publicCodes.push(...codes)
      if (codes.length < 500) break
      cursor = codes[codes.length - 1]
    }
    const checks = await refreshCallDirectory(
      backends,
      publicCodes,
      {
        async claim(id) {
          const { data, error } = await admin.rpc(
            'claim_call_directory_refresh',
            { p_backend_id: id },
          )
          if (error) throw error
          return data
        },
        async inspect(id, codes) {
          const backend = backends.find((item) => item.id === id)
          if (!backend || backend.kind !== 'direct' || !codes.length) return []
          const service = new RoomServiceClient(
            liveKitHttpUrl(backend.url),
            backend.apiKey,
            backend.apiSecret,
            {
              requestTimeout: 6,
            },
          )
          const allowed = new Set(codes)
          const live = (await service.listRooms()).filter(
            (room) => room.numParticipants > 0 && allowed.has(room.name),
          )
          const rooms: { code: string; user_ids: string[] }[] = []
          // Bounded concurrency and complete publication: a failed partial batch keeps the old snapshot.
          for (let index = 0; index < live.length; index += 4) {
            rooms.push(
              ...(await Promise.all(
                live.slice(index, index + 4).map(async (room) => ({
                  code: room.name,
                  user_ids: (await service.listParticipants(room.name)).map(
                    (person) => person.identity,
                  ),
                })),
              )),
            )
          }
          return rooms
        },
        async finish(id, lease, rooms) {
          const { error } = await admin.rpc('finish_call_directory_refresh', {
            p_backend_id: id,
            p_lease_token: lease,
            p_rooms: rooms,
          })
          if (error) throw error
        },
      },
    )
    // Authenticated RPCs preserve RLS semantics and derive history from this exact account.
    const [rooms, recent, sync] = await Promise.all([
      admin
        .rpc('list_public_call_rooms')
        .setHeader('Authorization', request.headers.get('Authorization') || ''),
      admin
        .rpc('list_my_call_rooms')
        .setHeader('Authorization', request.headers.get('Authorization') || ''),
      admin.from('call_directory_sync').select('checked_at,failed'),
    ])
    if (rooms.error || recent.error || sync.error)
      throw rooms.error || recent.error || sync.error
    return json({
      rooms: rooms.data || [],
      recentRooms: recent.data || [],
      degraded:
        backends.length === 0 ||
        backends.some((item) => item.kind !== 'direct') ||
        checks.some((ok) => !ok) ||
        (sync.data || []).some((item) => item.failed),
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    return errorResponse(error)
  }
})
