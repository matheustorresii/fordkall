import { useCallback, useEffect, useRef, useState } from 'react'
import { getCallDirectory } from '../services/callDirectory'
import {
  normalizeCallDirectory,
  type CallDirectory,
} from '../services/roomDirectoryPolicy'

export function useCallDirectory(
  accountId: string,
  preview?: Partial<CallDirectory>,
  active = true,
) {
  const [ownerId, setOwnerId] = useState(accountId)
  const [directory, setDirectory] = useState<CallDirectory>(() =>
    normalizeCallDirectory(preview),
  )
  const [loading, setLoading] = useState(!preview)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const visibleRef = useRef(active); visibleRef.current = active
  const refresh = useCallback(() => refreshRef.current(), [])
  useEffect(() => {
    setOwnerId(accountId)
    if (preview) {
      setDirectory(normalizeCallDirectory(preview))
      setLoading(false)
      refreshRef.current = async () => {}
      return
    }
    let stopped = false,
      pending = false
    setDirectory(normalizeCallDirectory({}))
    setLoading(true)
    const load = async () => {
      if (stopped || pending || !visibleRef.current) return
      pending = true
      setRefreshing(true)
      try {
        const result = await getCallDirectory()
        if (!stopped) {
          setDirectory(result)
          setError('')
        }
      } catch {
        // Never turn an intermittent failure into an empty directory.
        if (!stopped)
          setError(
            'Não foi possível atualizar as salas. Sua última lista foi mantida.',
          )
      } finally {
        pending = false
        if (!stopped) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const resume = () => {
      void load()
    }
    refreshRef.current = load
    void load()
    const timer = window.setInterval(visible, 15000)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', visible)
    return () => {
      stopped = true
      refreshRef.current = async () => {}
      window.clearInterval(timer)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [accountId, preview])
  useEffect(() => { if (active) void refreshRef.current() }, [active])
  const belongsToAccount = ownerId === accountId
  return {
    ...(belongsToAccount ? directory : normalizeCallDirectory({})),
    loading: !belongsToAccount || loading,
    refreshing,
    error: belongsToAccount ? error : '',
    refresh,
  }
}
