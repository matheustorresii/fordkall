import { WebhookReceiver } from 'npm:livekit-server-sdk@2'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, json } from '../_shared/http.ts'
import { loadLiveKitBackends } from '../_shared/livekit.ts'
import { createAdminClient } from '../_shared/supabase.ts'

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const backends = loadLiveKitBackends().filter((backend) => backend.kind === 'direct')
    if (backends.length === 0) throw new Error('LIVEKIT_NOT_CONFIGURED')

    const body = await request.text()
    const authorization = request.headers.get('Authorization') || ''
    let accepted: { backendId: string; event: Awaited<ReturnType<WebhookReceiver['receive']>> } | null = null
    for (const backend of backends) {
      try {
        const receiver = new WebhookReceiver(backend.apiKey, backend.apiSecret)
        accepted = { backendId: backend.id, event: await receiver.receive(body, authorization) }
        break
      } catch {
        // A shared webhook endpoint receives events signed by any pool member.
      }
    }
    if (!accepted) throw new Error('LIVEKIT_WEBHOOK_INVALID')
    const { backendId, event } = accepted
    const occurredAt = event.createdAt
      ? new Date(Number(event.createdAt) * 1000).toISOString()
      : new Date().toISOString()
    const admin = createAdminClient()
    const { error } = await admin.from('call_events').upsert({
      webhook_id: event.id || crypto.randomUUID(),
      event_type: event.event || 'unknown',
      room_sid: event.room?.sid || null,
      room_name: event.room?.name || null,
      participant_identity: event.participant?.identity || null,
      participant_name: event.participant?.name || null,
      backend_id: backendId,
      occurred_at: occurredAt,
    }, { onConflict: 'webhook_id', ignoreDuplicates: true })
    if (error) throw error
    if (event.event === 'room_finished' && event.room?.name) {
      await admin.from('livekit_room_routes')
        .delete()
        .eq('room_name', event.room.name)
        .eq('backend_id', backendId)
    }
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
})
