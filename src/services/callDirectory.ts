import { supabase, invokeFunction } from './supabase'
import { normalizeCallDirectory } from './roomDirectoryPolicy'

export async function getCallDirectory() {
  try {
    return normalizeCallDirectory(
      await invokeFunction<unknown>('call-directory', {}),
    )
  } catch {
    // Compatibility during a rolling deploy; still authenticated, never use global Presence
    // to infer rooms (Presence must not disclose private room codes).
    const [rooms, recent] = await Promise.all([
      supabase.rpc('list_public_call_rooms'),
      supabase.rpc('list_my_call_rooms'),
    ])
    if (rooms.error) throw rooms.error
    return normalizeCallDirectory({
      rooms: rooms.data,
      recentRooms: recent.data,
      degraded: true,
      checkedAt: new Date().toISOString(),
    })
  }
}
