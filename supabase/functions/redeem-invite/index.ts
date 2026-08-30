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

const findUserByEmail = async (admin: ReturnType<typeof createAdminClient>, email: string) => {
  const perPage = 200

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (user) return user
    if (data.users.length < perPage) return null
  }

  return null
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

    let account = created.user
    let createdAccount = Boolean(created.user && !createError)

    if (createError || !account) {
      const emailAlreadyExists = /already|registered|exists/i.test(createError?.message || '')
      if (!emailAlreadyExists || !isOwnerBootstrap) {
        if (emailAlreadyExists) throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED')
        throw createError || new Error('USER_CREATION_FAILED')
      }

      // The owner may have an auth record left by an interrupted bootstrap.
      // Possession of the one-time owner invite safely completes that account.
      const existingUser = await findUserByEmail(admin, email)
      if (!existingUser) throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED')

      const { data: recovered, error: recoveryError } = await admin.auth.admin.updateUserById(
        existingUser.id,
        {
          password,
          email_confirm: true,
          user_metadata: { ...existingUser.user_metadata, display_name: displayName },
        },
      )
      if (recoveryError || !recovered.user) {
        throw recoveryError || new Error('USER_RECOVERY_FAILED')
      }
      account = recovered.user
      createdAccount = false
    }

    if (isOwnerBootstrap) {
      const { error: ownerProfileError } = await admin.from('profiles').upsert({
        id: account.id,
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
      }, { onConflict: 'id' })
      if (ownerProfileError) {
        if (createdAccount) await admin.auth.admin.deleteUser(account.id)
        throw ownerProfileError
      }
    } else {
      const { data: redeemed, error: redeemError } = await admin.rpc('redeem_invite', {
        p_code_hash: codeHash,
        p_user_id: account.id,
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
        if (createdAccount) await admin.auth.admin.deleteUser(account.id)
        if (redeemError) throw redeemError
        throw new HttpError(409, 'INVITE_ALREADY_USED')
      }
    }

    return json({ ok: true, role: isOwnerBootstrap ? 'owner' : 'member' })
  } catch (error) {
    return errorResponse(error)
  }
})
