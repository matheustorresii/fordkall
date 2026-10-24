export interface DirectoryRoom {
  code: string
  user_ids: string[]
}
export interface DirectoryBackend {
  id: string
  kind: string
}
export interface DirectoryDependencies {
  claim(backendId: string): Promise<string | null>
  inspect(backendId: string, publicCodes: string[]): Promise<DirectoryRoom[]>
  finish(
    backendId: string,
    lease: string,
    rooms: DirectoryRoom[] | null,
  ): Promise<void>
}

// Shared cache/lease limits all accounts to one inspection per project per 20 seconds.
// Every boundary filters against the PUBLIC registry, not against browser presence.
export async function refreshCallDirectory(
  backends: DirectoryBackend[],
  publicCodes: string[],
  deps: DirectoryDependencies,
) {
  const allowed = new Set(publicCodes)
  return Promise.all(
    backends
      .filter((backend) => backend.kind === 'direct')
      .map(async (backend) => {
        let lease: string | null = null
        try {
          lease = await deps.claim(backend.id)
          if (!lease) return true
          const rooms = await deps.inspect(backend.id, publicCodes)
          const sanitized = rooms
            .filter((room) => allowed.has(room.code))
            .map((room) => ({
              code: room.code,
              user_ids: [
                ...new Set(
                  room.user_ids.filter((id) =>
                    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
                  ),
                ),
              ],
            }))
          await deps.finish(backend.id, lease, sanitized)
          return true
        } catch {
          // Never replace a valid snapshot with [] because an upstream server timed out.
          if (lease)
            await deps.finish(backend.id, lease, null).catch(() => undefined)
          return false
        }
      }),
  )
}
