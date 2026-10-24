import { supabase } from './supabase'
export interface SocialPreferences {
  do_not_disturb: boolean
  favorite_users: string[]
  favorite_rooms: string[]
}
export const emptySocialPreferences = (): SocialPreferences => ({
  do_not_disturb: false,
  favorite_users: [],
  favorite_rooms: [],
})
export async function loadSocialPreferences(
  userId: string,
): Promise<SocialPreferences> {
  const { data, error } = await supabase
    .from('social_preferences')
    .select('do_not_disturb,favorite_users,favorite_rooms')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || emptySocialPreferences()
}
export async function saveSocialPreferences(
  userId: string,
  preferences: SocialPreferences,
) {
  const { error } = await supabase
    .from('social_preferences')
    .upsert({ user_id: userId, ...preferences })
  if (error) throw error
}
