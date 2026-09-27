export type DirectLiveKitBackend = {
  id: string
  label: string
  kind: 'direct'
  url: string
  apiKey: string
  apiSecret: string
}

export type SandboxLiveKitBackend = {
  id: string
  label: string
  kind: 'sandbox'
  sandboxId: string
}

export type LiveKitBackend = DirectLiveKitBackend | SandboxLiveKitBackend

type StoredLiveKitBackend = Partial<DirectLiveKitBackend>

const normalizeBackend = (value: StoredLiveKitBackend): DirectLiveKitBackend | null => {
  const id = value.id?.trim().toLowerCase() || ''
  const label = value.label?.trim() || id
  const url = value.url?.trim() || ''
  const apiKey = value.apiKey?.trim() || ''
  const apiSecret = value.apiSecret?.trim() || ''

  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) return null
  if (!/^wss:\/\//i.test(url)) return null
  if (!apiKey || !apiSecret) return null
  return { id, label, kind: 'direct', url, apiKey, apiSecret }
}

export const loadLiveKitBackends = (): LiveKitBackend[] => {
  const backends: LiveKitBackend[] = []
  const primary = normalizeBackend({
    id: 'primary',
    label: 'Principal',
    url: Deno.env.get('LIVEKIT_URL'),
    apiKey: Deno.env.get('LIVEKIT_API_KEY'),
    apiSecret: Deno.env.get('LIVEKIT_API_SECRET'),
  })
  if (primary) {
    backends.push(primary)
  } else {
    const sandboxId = Deno.env.get('LIVEKIT_TOKEN_SERVER_ID')?.trim()
    if (sandboxId) {
      backends.push({
        id: 'primary',
        label: 'Principal',
        kind: 'sandbox',
        sandboxId,
      })
    }
  }

  const storedPool = Deno.env.get('LIVEKIT_BACKENDS_JSON')
  if (storedPool) {
    try {
      const parsed = JSON.parse(storedPool) as unknown
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (!value || typeof value !== 'object') continue
          const backend = normalizeBackend(value as StoredLiveKitBackend)
          if (backend && !backends.some(({ id }) => id === backend.id)) {
            backends.push(backend)
          }
        }
      }
    } catch {
      throw new Error('LIVEKIT_POOL_INVALID')
    }
  }

  return backends
}

export const liveKitHttpUrl = (url: string) => url.replace(/^wss:/i, 'https:')
