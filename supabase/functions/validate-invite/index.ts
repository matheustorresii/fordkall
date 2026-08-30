import { handleCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/supabase.ts'
import { normalizeInviteCode, sha256 } from '../_shared/validation.ts'

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { code } = await readJson<{ code?: string }>(request)
    const normalizedCode = normalizeInviteCode(code)
    if (normalizedCode.length !== 18) throw new HttpError(400, 'INVALID_INVITE')

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('invites')
      .select('id,assigned_email')
      .eq('code_hash', await sha256(normalizedCode))
      .is('revoked_at', null)
      .is('redeemed_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (error) throw error
    if (!data) {
      const bootstrapHash = Deno.env.get('FORDKALL_OWNER_INVITE_HASH') || ''
      if (!bootstrapHash || bootstrapHash !== await sha256(normalizedCode)) {
        throw new HttpError(400, 'INVALID_INVITE')
      }

      const { count, error: ownerError } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'owner')
      if (ownerError) throw ownerError
      if ((count || 0) > 0) throw new HttpError(400, 'INVALID_INVITE')

      return json({ valid: true, emailLocked: true, bootstrap: true })
    }

    return json({ valid: true, emailLocked: Boolean(data.assigned_email) })
  } catch (error) {
    return errorResponse(error)
  }
})
