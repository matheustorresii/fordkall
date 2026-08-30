import { handleCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/supabase.ts'
import { assertEmail, createInviteCode, normalizeEmail, sha256 } from '../_shared/validation.ts'

type AdminBody = {
  action?: string
  assignedEmail?: string
  expiresInDays?: number
  inviteId?: string
  userId?: string
  status?: 'active' | 'suspended'
  role?: 'admin' | 'member'
}

const audit = async (
  admin: Awaited<ReturnType<typeof requireAdmin>>['admin'],
  actorId: string,
  action: string,
  values: { userId?: string; inviteId?: string; details?: Record<string, unknown> } = {},
) => {
  const { error } = await admin.from('admin_audit_log').insert({
    actor_id: actorId,
    action,
    target_user_id: values.userId || null,
    target_invite_id: values.inviteId || null,
    details: values.details || {},
  })
  if (error) throw error
}

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { admin, user, profile } = await requireAdmin(request)
    const body = await readJson<AdminBody>(request)

    if (body.action === 'dashboard') {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [profilesResult, invitesResult, eventsResult, issuancesResult] = await Promise.all([
        admin.from('profiles').select('id,email,display_name,role,status,invited_by,created_at,last_seen_at').order('created_at', { ascending: false }),
        admin.from('invites').select('id,code_hint,assigned_email,expires_at,revoked_at,redeemed_at,redeemed_by,created_by,created_at').order('created_at', { ascending: false }).limit(200),
        admin.from('call_events').select('id,event_type,room_sid,room_name,participant_identity,participant_name,occurred_at').gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(300),
        admin.from('livekit_token_issuances').select('id,user_id,room_name,issued_at').gte('issued_at', since).order('issued_at', { ascending: false }).limit(500),
      ])
      const failure = [profilesResult, invitesResult, eventsResult, issuancesResult].find((result) => result.error)
      if (failure?.error) throw failure.error
      return json({
        profiles: profilesResult.data,
        invites: invitesResult.data,
        events: eventsResult.data,
        issuances: issuancesResult.data,
      })
    }

    if (body.action === 'create_invite') {
      const days = Math.min(90, Math.max(1, Math.round(Number(body.expiresInDays) || 7)))
      const assignedEmail = normalizeEmail(body.assignedEmail)
      if (assignedEmail) assertEmail(assignedEmail)
      const code = createInviteCode()
      const normalizedCode = code.replace(/[^A-Z0-9]/g, '')
      const { data: invite, error } = await admin.from('invites').insert({
        code_hash: await sha256(normalizedCode),
        code_hint: code.slice(-4),
        assigned_email: assignedEmail || null,
        created_by: user.id,
        expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
      }).select('id,expires_at').single()
      if (error) throw error
      await audit(admin, user.id, 'invite.create', { inviteId: invite.id, details: { assignedEmail: assignedEmail || null, days } })
      return json({ code, invite })
    }

    if (body.action === 'revoke_invite') {
      if (!body.inviteId) throw new HttpError(400, 'INVITE_REQUIRED')
      const { error } = await admin.from('invites').update({ revoked_at: new Date().toISOString() })
        .eq('id', body.inviteId).is('redeemed_at', null)
      if (error) throw error
      await audit(admin, user.id, 'invite.revoke', { inviteId: body.inviteId })
      return json({ ok: true })
    }

    if (body.action === 'set_status') {
      if (!body.userId || !['active', 'suspended'].includes(String(body.status))) {
        throw new HttpError(400, 'INVALID_STATUS_UPDATE')
      }
      const { data: target, error: targetError } = await admin.from('profiles').select('role').eq('id', body.userId).single()
      if (targetError) throw targetError
      if (target.role === 'owner') throw new HttpError(403, 'OWNER_IS_PROTECTED')
      const { error } = await admin.from('profiles').update({ status: body.status }).eq('id', body.userId)
      if (error) throw error
      await audit(admin, user.id, `user.${body.status}`, { userId: body.userId })
      return json({ ok: true })
    }

    if (body.action === 'set_role') {
      if (profile.role !== 'owner') throw new HttpError(403, 'OWNER_REQUIRED')
      if (!body.userId || !['admin', 'member'].includes(String(body.role))) {
        throw new HttpError(400, 'INVALID_ROLE_UPDATE')
      }
      const { data: target, error: targetError } = await admin.from('profiles').select('role').eq('id', body.userId).single()
      if (targetError) throw targetError
      if (target.role === 'owner') throw new HttpError(403, 'OWNER_IS_PROTECTED')
      const { error } = await admin.from('profiles').update({ role: body.role }).eq('id', body.userId)
      if (error) throw error
      await audit(admin, user.id, `user.role.${body.role}`, { userId: body.userId })
      return json({ ok: true })
    }

    throw new HttpError(400, 'UNKNOWN_ACTION')
  } catch (error) {
    return errorResponse(error)
  }
})
