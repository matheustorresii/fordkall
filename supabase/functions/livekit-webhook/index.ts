import { WebhookReceiver } from 'npm:livekit-server-sdk@2'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse, json } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/supabase.ts'

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const apiKey = Deno.env.get('LIVEKIT_API_KEY')
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
    if (!apiKey || !apiSecret) throw new Error('LIVEKIT_NOT_CONFIGURED')

    const body = await request.text()
    const receiver = new WebhookReceiver(apiKey, apiSecret)
    const event = await receiver.receive(body, request.headers.get('Authorization') || '')
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
      occurred_at: occurredAt,
    }, { onConflict: 'webhook_id', ignoreDuplicates: true })
    if (error) throw error
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
})
