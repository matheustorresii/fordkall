import { supabase } from './supabase'
import { normalizeProfileAppearance } from './profile'
import type {
  SocialConversation,
  SocialMessage,
  SocialUser,
} from '../types/social'

interface SocialProfileRow {
  id: string
  display_name: string
  avatar_data_url?: string | null
  bio?: string | null
  name_color?: string | null
  name_font?: string | null
  profile_theme?: string | null
  profile_accent_color?: string | null
  avatar_frame?: string | null
}

interface MessageRow {
  id: string
  user_low?: string
  user_high?: string
  sender_id: string
  body: string
  created_at: string
  read_at?: string | null
}

const failOnError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}
const hydrateCosmetics = async (users: SocialUser[]) => {
  if(!users.length)return users
  const {data,error}=await supabase.rpc('get_profile_cosmetics',{p_user_ids:users.map(u=>u.id)})
  if(error)return users
  return users.map(u=>{const c=(data as {id:string;decoration_id:string;call_background_id:string}[]).find(x=>x.id===u.id);return c?{...u,appearance:{...u.appearance,decorationId:c.decoration_id,backgroundId:c.call_background_id}}:u})
}

const toSocialUser = (row: SocialProfileRow): SocialUser => ({
  id: row.id,
  displayName: row.display_name || 'Pessoa sem nome',
  avatarDataUrl: row.avatar_data_url || undefined,
  bio: row.bio || undefined,
  appearance: normalizeProfileAppearance({
    nameColor: row.name_color || undefined,
    nameFont: row.name_font as SocialUser['appearance']['nameFont'] | undefined,
    theme: row.profile_theme as SocialUser['appearance']['theme'] | undefined,
    accentColor: row.profile_accent_color || undefined,
    avatarFrame: row.avatar_frame as SocialUser['appearance']['avatarFrame'] | undefined,
  }),
})

const pairFor = (first: string, second: string) =>
  first < second
    ? { user_low: first, user_high: second }
    : { user_low: second, user_high: first }

export const describeSocialError = (error: unknown, action: 'load' | 'send') => {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/PGRST205|relation ["']?public?\.?direct_messages|does not exist|schema cache/i.test(message)) {
    return 'As mensagens diretas ainda não estão configuradas no banco deste servidor. A migration social_hub precisa ser aplicada.'
  }
  if (/row-level security|permission denied|42501/i.test(message)) {
    return 'O servidor recusou o acesso às mensagens desta conta. Verifique se a migration social_hub e as permissões estão atualizadas.'
  }
  if (/failed to fetch|network|websocket|timeout/i.test(message)) {
    return 'Sem conexão com o serviço de mensagens. Confira sua internet e tente novamente.'
  }
  const detail = message.trim().replace(/\s+/g, ' ').slice(0, 180)
  return action === 'load'
    ? `Não foi possível carregar as mensagens${detail ? ` (${detail})` : ''}.`
    : `A mensagem não foi enviada${detail ? ` (${detail})` : ''}.`
}

export const getSocialProfileCards = async (ids: string[], includeAvatar = true) => {
  const uniqueIds = [...new Set(ids)]
  const users = new Map<string, SocialUser>()
  for (let index = 0; index < uniqueIds.length; index += 20) {
    const { data, error } = await supabase.rpc('get_social_profile_cards', {
      p_user_ids: uniqueIds.slice(index, index + 20),
      p_include_avatar: includeAvatar,
    })
    failOnError(error)
    for (const user of await hydrateCosmetics(((data || []) as SocialProfileRow[]).map(toSocialUser))) users.set(user.id,user)
  }
  return users
}

export const searchSocialUsers = async (query: string) => {
  const { data, error } = await supabase.rpc('search_social_users', {
    p_query: query.trim().slice(0, 48),
  })
  failOnError(error)
  return hydrateCosmetics(((data || []) as SocialProfileRow[]).map(toSocialUser))
}

const hydrateMessages = async (rows: MessageRow[]): Promise<SocialMessage[]> => {
  const users = await getSocialProfileCards(rows.map((row) => row.sender_id), false)
  return rows.map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    sender: users.get(row.sender_id) || {
      id: row.sender_id,
      displayName: 'Conta indisponível',
      appearance: normalizeProfileAppearance(),
    },
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at || undefined,
  }))
}

export const getCommunityMessages = async () => {
  const { data, error } = await supabase.from('community_messages')
    .select('id,sender_id,body,created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  failOnError(error)
  return hydrateMessages(((data || []) as MessageRow[]).reverse())
}

export const sendCommunityMessage = async (senderId: string, body: string) => {
  const { data, error } = await supabase.from('community_messages')
    .insert({ sender_id: senderId, body: body.trim() })
    .select('id,sender_id,body,created_at')
    .single()
  failOnError(error)
  return (await hydrateMessages([data as MessageRow]))[0]
}

export const getDirectMessages = async (currentUserId: string, otherUserId: string) => {
  const pair = pairFor(currentUserId, otherUserId)
  const { data, error } = await supabase.from('direct_messages')
    .select('id,user_low,user_high,sender_id,body,created_at,read_at')
    .eq('user_low', pair.user_low)
    .eq('user_high', pair.user_high)
    .order('created_at', { ascending: false })
    .limit(100)
  failOnError(error)

  const rows = ((data || []) as MessageRow[]).reverse()
  if (rows.some((message) => message.sender_id !== currentUserId && !message.read_at)) {
    const { error: readError } = await supabase.from('direct_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('user_low', pair.user_low)
      .eq('user_high', pair.user_high)
      .neq('sender_id', currentUserId)
      .is('read_at', null)
    // Failing to mark a thread as read must never hide its messages.
    if (readError) console.warn('Could not mark direct messages as read:', readError.message)
  }
  return hydrateMessages(rows)
}

export const sendDirectMessage = async (
  currentUserId: string,
  otherUserId: string,
  body: string,
) => {
  const pair = pairFor(currentUserId, otherUserId)
  const { data, error } = await supabase.from('direct_messages')
    .insert({ ...pair, sender_id: currentUserId, body: body.trim() })
    .select('id,user_low,user_high,sender_id,body,created_at,read_at')
    .single()
  failOnError(error)
  return (await hydrateMessages([data as MessageRow]))[0]
}

export const getRecentDirectConversations = async (
  currentUserId: string,
): Promise<SocialConversation[]> => {
  const { data, error } = await supabase.from('direct_messages')
    .select('id,user_low,user_high,sender_id,body,created_at,read_at')
    .or(`user_low.eq.${currentUserId},user_high.eq.${currentUserId}`)
    .order('created_at', { ascending: false })
    .limit(300)
  failOnError(error)

  const conversations = new Map<string, {
    lastMessage: SocialConversation['lastMessage']
    unreadCount: number
  }>()
  for (const row of (data || []) as MessageRow[]) {
    if (!row.user_low || !row.user_high) continue
    const otherId = row.user_low === currentUserId ? row.user_high : row.user_low
    const existing = conversations.get(otherId)
    if (!existing) {
      conversations.set(otherId, {
        lastMessage: { senderId: row.sender_id, body: row.body, createdAt: row.created_at },
        unreadCount: row.sender_id !== currentUserId && !row.read_at ? 1 : 0,
      })
    } else if (row.sender_id !== currentUserId && !row.read_at) {
      existing.unreadCount += 1
    }
  }

  const sortedConversations = [...conversations.entries()]
    .sort((first, second) => second[1].lastMessage.createdAt.localeCompare(first[1].lastMessage.createdAt))
    .slice(0, 30)
  const users = await getSocialProfileCards(sortedConversations.map(([id]) => id))
  return sortedConversations
    .flatMap(([id, conversation]) => {
      const user = users.get(id)
      return user ? [{ user, ...conversation }] : []
    })
    .sort((first, second) =>
      second.lastMessage.createdAt.localeCompare(first.lastMessage.createdAt),
    )
}

export const subscribeToCommunityMessages = (onMessage: (message: SocialMessage) => void) => {
  const channel = supabase.channel('fk:community-messages')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'community_messages',
    }, (payload) => {
      void hydrateMessages([payload.new as MessageRow]).then(([message]) => onMessage(message))
    })
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export const subscribeToDirectMessages = (
  currentUserId: string,
  otherUserId: string,
  onMessage: (message: SocialMessage) => void,
) => {
  const pair = pairFor(currentUserId, otherUserId)
  const channel = supabase.channel(`fk:dm:${pair.user_low}:${pair.user_high}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'direct_messages',
    }, (payload) => {
      const row = payload.new as MessageRow
      if (row.user_low !== pair.user_low || row.user_high !== pair.user_high) return
      void hydrateMessages([row]).then(([message]) => onMessage(message))
    })
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export const subscribeToDirectInbox = (onChange: () => void) => {
  const channel = supabase.channel('fk:dm-inbox')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'direct_messages',
    }, onChange)
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
