import { useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import type { SocialPresenceEntry } from '../types/social'

interface PresencePayload {
  user_id?: unknown
  display_name?: unknown
  active_room?: unknown
}

const collectPresence = (channel: ReturnType<typeof supabase.channel>) => {
  const state = channel.presenceState() as Record<string, PresencePayload[]>
  const byUser = new Map<string, SocialPresenceEntry>()

  Object.values(state).flat().forEach((payload) => {
    if (typeof payload.user_id !== 'string') return
    const entry: SocialPresenceEntry = {
      userId: payload.user_id,
      displayName: typeof payload.display_name === 'string' ? payload.display_name : 'Pessoa',
      activeRoom: typeof payload.active_room === 'string' && payload.active_room
        ? payload.active_room
        : undefined,
    }
    const existing = byUser.get(entry.userId)
    if (!existing || (!existing.activeRoom && entry.activeRoom)) byUser.set(entry.userId, entry)
  })

  return [...byUser.values()]
}

export const useSocialPresence = (
  userId?: string,
  displayName = '',
  activeRoom?: string,
) => {
  const [onlineUsers, setOnlineUsers] = useState<SocialPresenceEntry[]>([])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const joinedRef = useRef(false)
  const payloadRef = useRef({ userId, displayName, activeRoom })

  payloadRef.current = { userId, displayName, activeRoom }

  useEffect(() => {
    if (!userId) {
      setOnlineUsers([])
      return
    }

    const channel = supabase.channel('fordkall:online', {
      config: {
        private: true,
        presence: { key: `${userId}:${crypto.randomUUID()}` },
      },
    })
    channelRef.current = channel
    joinedRef.current = false

    channel.on('presence', { event: 'sync' }, () => {
      setOnlineUsers(collectPresence(channel))
    })
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      joinedRef.current = true
      const current = payloadRef.current
      void channel.track({
        user_id: current.userId,
        display_name: current.displayName,
        active_room: current.activeRoom || null,
      })
      setOnlineUsers(collectPresence(channel))
    })

    return () => {
      joinedRef.current = false
      if (channelRef.current === channel) channelRef.current = null
      setOnlineUsers([])
      void supabase.removeChannel(channel)
    }
  }, [userId])

  useEffect(() => {
    const channel = channelRef.current
    if (!channel || !joinedRef.current) return
    void channel.track({
      user_id: userId,
      display_name: displayName,
      active_room: activeRoom || null,
    })
  }, [userId, displayName, activeRoom])

  return { onlineUsers }
}
