import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { HttpError } from './http.ts'

type Profile = {
  id: string
  email: string
  display_name: string
  avatar_data_url?: string | null
  bio?: string | null
  name_color: string
  name_font: string
  profile_theme: string
  profile_accent_color: string
  avatar_frame: string
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'suspended'
}

const getAdminKey = () => {
  const currentKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys) as Record<string, string>
      const secret = Object.values(parsed).find((value) => value.startsWith('sb_secret_'))
      if (secret) return secret
    } catch {
      // Fall back to the legacy service role key injected by Supabase.
    }
  }

  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey
  throw new Error('SUPABASE_ADMIN_KEY_NOT_CONFIGURED')
}

export const createAdminClient = (): SupabaseClient => {
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('SUPABASE_URL_NOT_CONFIGURED')
  return createClient(url, getAdminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const bearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new HttpError(401, 'AUTH_REQUIRED')
  return match[1]
}

export const requireUser = async (request: Request, admin = createAdminClient()) => {
  const { data, error } = await admin.auth.getUser(bearerToken(request))
  if (error || !data.user) throw new HttpError(401, 'INVALID_SESSION')
  return { admin, user: data.user }
}

export const requireActiveProfile = async (
  request: Request,
): Promise<{ admin: SupabaseClient; user: User; profile: Profile }> => {
  const { admin, user } = await requireUser(request)
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id,email,display_name,avatar_data_url,bio,name_color,name_font,profile_theme,profile_accent_color,avatar_frame,role,status')
    .eq('id', user.id)
    .single()

  if (error || !profile) throw new HttpError(403, 'PROFILE_NOT_FOUND')
  if (profile.status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED')
  return { admin, user, profile: profile as Profile }
}

export const requireAdmin = async (request: Request) => {
  const context = await requireActiveProfile(request)
  if (context.profile.role !== 'owner' && context.profile.role !== 'admin') {
    throw new HttpError(403, 'ADMIN_REQUIRED')
  }
  return context
}
