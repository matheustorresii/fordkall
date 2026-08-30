import {
  createClient,
  FunctionsHttpError,
  type Session,
} from '@supabase/supabase-js'
import type { AccountProfile, LocalProfile } from '../types'
import { normalizeProfileAppearance } from './profile'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = createClient(
  supabaseUrl || 'https://configuration.invalid',
  supabasePublishableKey || 'sb_publishable_missing',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: 'ford-kall:auth',
    },
  },
)

const functionErrorMessage = async (error: unknown) => {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json() as { error?: string }
      if (payload.error) return payload.error
    } catch {
      // Use the SDK message when the response isn't JSON.
    }
  }
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR'
}

export const invokeFunction = async <T>(name: string, body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error) throw new Error(await functionErrorMessage(error))
  return data as T
}

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export const redeemInvite = async (values: {
  code: string
  email: string
  password: string
  displayName: string
  avatarDataUrl?: string
  bio?: string
  appearance?: LocalProfile['appearance']
}) => {
  await invokeFunction<{ ok: true }>('redeem-invite', values)
  try {
    return await signIn(values.email, values.password)
  } catch {
    throw new Error('ACCOUNT_CREATED_LOGIN_REQUIRED')
  }
}

export const validateInvite = async (code: string) =>
  invokeFunction<{ valid: true; emailLocked: boolean }>('validate-invite', { code })

export const bootstrapOwner = async () => {
  try {
    await invokeFunction<{ ok: true }>('bootstrap-owner', {})
  } catch (error) {
    if (error instanceof Error && error.message === 'OWNER_ACCOUNT_REQUIRED') return
    throw error
  }
}

export const loadAccountProfile = async (): Promise<AccountProfile> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,display_name,avatar_data_url,bio,name_color,name_font,profile_theme,profile_accent_color,avatar_frame,role,status,invited_by,created_at,last_seen_at')
    .single()
  if (error || !data) throw error || new Error('PROFILE_NOT_FOUND')
  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name,
    avatarDataUrl: data.avatar_data_url || undefined,
    bio: data.bio || undefined,
    appearance: normalizeProfileAppearance({
      nameColor: data.name_color,
      nameFont: data.name_font,
      theme: data.profile_theme,
      accentColor: data.profile_accent_color,
      avatarFrame: data.avatar_frame,
    }),
    role: data.role,
    status: data.status,
    invitedBy: data.invited_by || undefined,
    createdAt: data.created_at,
    lastSeenAt: data.last_seen_at || undefined,
  }
}

export const updateAccountProfile = async (profile: LocalProfile) => {
  const { error } = await supabase.from('profiles').update({
    display_name: profile.displayName,
    avatar_data_url: profile.avatarDataUrl || null,
    bio: profile.bio || null,
    name_color: normalizeProfileAppearance(profile.appearance).nameColor,
    name_font: normalizeProfileAppearance(profile.appearance).nameFont,
    profile_theme: normalizeProfileAppearance(profile.appearance).theme,
    profile_accent_color: normalizeProfileAppearance(profile.appearance).accentColor,
    avatar_frame: normalizeProfileAppearance(profile.appearance).avatarFrame,
  }).eq('id', (await supabase.auth.getUser()).data.user?.id || '')
  if (error) throw error
  return loadAccountProfile()
}

export const onAuthChange = (callback: (session: Session | null) => void) => {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
}

export const getInitialSession = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export const friendlyAuthError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '')
  const known: Record<string, string> = {
    INVALID_INVITE: 'Esse convite não existe, expirou ou já foi utilizado.',
    INVITE_ALREADY_USED: 'Esse convite acabou de ser utilizado em outro cadastro.',
    EMAIL_ALREADY_REGISTERED: 'Esse e-mail já possui uma conta. Entre com sua senha.',
    ACCOUNT_CREATED_LOGIN_REQUIRED: 'Sua conta foi criada. Entre com o e-mail e a senha que você acabou de escolher.',
    INVALID_EMAIL: 'Digite um e-mail válido.',
    WEAK_PASSWORD: 'A senha precisa ter pelo menos 8 caracteres.',
    DISPLAY_NAME_REQUIRED: 'Digite o nome que aparecerá nas calls.',
    ACCOUNT_SUSPENDED: 'Essa conta foi suspensa por um administrador.',
    PROFILE_NOT_FOUND: 'Sua conta ainda não possui acesso ao Ford Kall.',
  }
  if (known[message]) return known[message]
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.'
  if (/failed to fetch|network/i.test(message)) return 'Não foi possível alcançar o servidor. Confira sua conexão.'
  return 'Não foi possível concluir essa ação. Tente novamente.'
}
