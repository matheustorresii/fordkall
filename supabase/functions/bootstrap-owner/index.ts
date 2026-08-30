import { handleCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json } from '../_shared/http.ts'
import { requireUser } from '../_shared/supabase.ts'

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { admin, user } = await requireUser(request)
    const ownerEmail = (Deno.env.get('FORDKALL_OWNER_EMAIL') || '').trim().toLowerCase()
    if (!ownerEmail || user.email?.toLowerCase() !== ownerEmail) {
      throw new HttpError(403, 'OWNER_ACCOUNT_REQUIRED')
    }

    const { data: currentOwner } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'owner')
      .maybeSingle()

    if (currentOwner && currentOwner.id !== user.id) throw new HttpError(409, 'OWNER_ALREADY_EXISTS')

    const { error } = await admin.from('profiles').upsert({
      id: user.id,
      email: user.email || ownerEmail,
      display_name: String(user.user_metadata?.display_name || '').slice(0, 48),
      role: 'owner',
      status: 'active',
    }, { onConflict: 'id' })
    if (error) throw error

    return json({ ok: true, role: 'owner' })
  } catch (error) {
    return errorResponse(error)
  }
})
