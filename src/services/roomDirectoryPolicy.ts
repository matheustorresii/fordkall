export interface PublicCallRoom {
  code: string
  user_ids: string[]
}
export interface RecentCallRoom {
  code: string
  is_private: boolean
  last_joined_at: string
}
export interface CallDirectory {
  rooms: PublicCallRoom[]
  recentRooms: RecentCallRoom[]
  degraded: boolean
  checkedAt: string
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const codeOf = (value: unknown) =>
  typeof value === 'string' && /^[A-Z0-9_-]{1,64}$/.test(value) ? value : ''
export function normalizeCallDirectory(value: unknown): CallDirectory {
  const data = object(value)
  const publicRooms = new Map<string, PublicCallRoom>()
  for (const value of Array.isArray(data.rooms) ? data.rooms : []) {
    const room = object(value),
      code = codeOf(room.code)
    if (!code || room.is_private === true || !Array.isArray(room.user_ids))
      continue
    const ids = [
      ...new Set(
        room.user_ids.filter(
          (id): id is string =>
            typeof id === 'string' && id.length > 0 && id.length < 80,
        ),
      ),
    ]
    if (ids.length) publicRooms.set(code, { code, user_ids: ids })
  }
  const recentRooms = new Map<string, RecentCallRoom>()
  for (const value of Array.isArray(data.recentRooms) ? data.recentRooms : []) {
    const room = object(value),
      code = codeOf(room.code)
    if (
      !code ||
      typeof room.is_private !== 'boolean' ||
      typeof room.last_joined_at !== 'string' ||
      !Number.isFinite(Date.parse(room.last_joined_at))
    )
      continue
    if (!recentRooms.has(code))
      recentRooms.set(code, {
        code,
        is_private: room.is_private,
        last_joined_at: room.last_joined_at,
      })
  }
  return {
    rooms: [...publicRooms.values()].sort(
      (a, b) =>
        b.user_ids.length - a.user_ids.length || a.code.localeCompare(b.code),
    ),
    recentRooms: [...recentRooms.values()]
      .sort((a, b) => b.last_joined_at.localeCompare(a.last_joined_at))
      .slice(0, 30),
    degraded: data.degraded === true,
    checkedAt: typeof data.checkedAt === 'string' ? data.checkedAt : '',
  }
}
