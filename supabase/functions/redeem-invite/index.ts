import { handleCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/supabase.ts'
import {
  assertEmail,
  normalizeDisplayName,
  normalizeEmail,
  normalizeInviteCode,
  normalizeProfileAppearance,
  sha256,
} from '../_shared/validation.ts'

type RedeemBody = {
  code?: string
  email?: string
  password?: string
  displayName?: string
  avatarDataUrl?: string
  bio?: string
  appearance?: Record<string, unknown>
}

Deno.serve(async (request) => {
  const preflight = handleCors(request)
  if (preflight) return preflight
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const body = await readJson<RedeemBody>(request)
    const code = normalizeInviteCode(body.code)
    const email = normalizeEmail(body.email)
    const displayName = normalizeDisplayName(body.displayName)
    const password = String(body.password || '')
    const avatarDataUrl = typeof body.avatarDataUrl === 'string' ? body.avatarDataUrl : null
    const bio = typeof body.bio === 'string' ? body.bio.trim().replace(/\s+/g, ' ').slice(0, 96) : null
    const appearance = normalizeProfileAppearance(body.appearance)

    if (code.length !== 18) throw new HttpError(400, 'INVALID_INVITE')
    assertEmail(email)
    if (password.length < 8 || password.length > 128) throw new HttpError(400, 'WEAK_PASSWORD')
    if (!displayName) throw new HttpError(400, 'DISPLAY_NAME_REQUIRED')
    if (avatarDataUrl && avatarDataUrl.length > 430_000) throw new HttpError(400, 'AVATAR_TOO_LARGE')

    const admin = createAdminClient()
    const codeHash = await sha256(code)
    const { data: availableInvite } = await admin
      .from('invites')
      .select('id')
      .eq('code_hash', codeHash)
      .is('revoked_at', null)
      .is('redeemed_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    let isOwnerBootstrap = false
    if (!availableInvite) {
      const ownerEmail = (Deno.env.get('FORDKALL_OWNER_EMAIL') || '').trim().toLowerCase()
      const bootstrapHash = Deno.env.get('FORDKALL_OWNER_INVITE_HASH') || ''
      if (!ownerEmail || email !== ownerEmail || !bootstrapHash || codeHash !== bootstrapHash) {
        throw new HttpError(400, 'INVALID_INVITE')
      }

      const { count, error: ownerError } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'owner')
      if (ownerError) throw ownerError
      if ((count || 0) > 0) throw new HttpError(400, 'INVALID_INVITE')
      isOwnerBootstrap = true
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })
    if (createError || !created.user) {
      if (/already|registered|exists/i.test(createError?.message || '')) {
        throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED')
      }
      throw createError || new Error('USER_CREATION_FAILED')
    }

    if (isOwnerBootstrap) {
      const { error: ownerProfileError } = await admin.from('profiles').update({
        email,
        display_name: displayName,
        avatar_data_url: avatarDataUrl,
        bio,
        name_color: appearance.nameColor,
        name_font: appearance.nameFont,
        profile_theme: appearance.theme,
        avatar_frame: appearance.avatarFrame,
        profile_badge: appearance.badge,
        role: 'owner',
        status: 'active',
      }).eq('id', created.user.id)
      if (ownerProfileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        throw ownerProfileError
      }
    } else {
      const { data: redeemed, error: redeemError } = await admin.rpc('redeem_invite', {
        p_code_hash: codeHash,
        p_user_id: created.user.id,
        p_email: email,
        p_display_name: displayName,
        p_avatar_data_url: avatarDataUrl,
        p_bio: bio,
        p_name_color: appearance.nameColor,
        p_name_font: appearance.nameFont,
        p_profile_theme: appearance.theme,
        p_avatar_frame: appearance.avatarFrame,
        p_profile_badge: appearance.badge,
      })

      if (redeemError || redeemed !== true) {
        await admin.auth.admin.deleteUser(created.user.id)
        if (redeemError) throw redeemError
        throw new HttpError(409, 'INVITE_ALREADY_USED')
      }
    }

    return json({ ok: true, role: isOwnerBootstrap ? 'owner' : 'member' })
  } catch (error) {
    return errorResponse(error)
  }
})
