import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../services/supabase'
import { getSocialProfileCards } from '../services/social'
import {
  callError,
  isRinging,
  type DirectCall,
} from '../services/directCallsPolicy'
import {
  emptySocialPreferences,
  loadSocialPreferences,
  saveSocialPreferences,
  type SocialPreferences,
} from '../services/socialPreferences'
import { playCallSound, primeCallSounds } from '../services/callSounds'
import type { AccountProfile } from '../types'
import type { SocialUser } from '../types/social'

interface Options {
  account: AccountProfile | null
  activeRoom: string
  connecting: boolean
  join: (room: string) => Promise<boolean>
  returnToCall: () => void
  leaveIdleRoom: (room: string) => Promise<void>
}
const savedNotifications = (userId: string, value?: boolean) => {
  try {
    const key = `ford-kall:notifications:${userId}`
    if (value !== undefined) localStorage.setItem(key, String(value))
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}
export function useDirectCalls(options: Options) {
  const userId = options.account?.id || ''
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [owner, setOwner] = useState(userId)
  const [calls, setCalls] = useState<DirectCall[]>([])
  const [people, setPeople] = useState(new Map<string, SocialUser>())
  const [preferences, setPreferences] = useState<SocialPreferences>(
    emptySocialPreferences,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  const [notifications, setNotifications] = useState(false)
  const pending = useRef(false),
    mounted = useRef(false),
    refreshRef = useRef(async () => {}),
    notified = useRef(new Set<string>())
  const accountGeneration = useRef(0)
  const createdCall = useRef('')
  const cancelledCalls = useRef(new Set<string>())
  const currentCalls = owner === userId ? calls : []
  const ringing = currentCalls.find((call) => isRinging(call, now))
  const incoming = ringing?.recipient_id === userId ? ringing : null
  const outgoing = ringing?.caller_id === userId ? ringing : null
  const latest = currentCalls.at(0)
  const respond = useCallback(async (call: DirectCall, action: string) => {
    const { data, error: failure } = await supabase.rpc('respond_direct_call', {
      p_call_id: call.id,
      p_action: action,
    })
    if (failure) throw failure
    return data as DirectCall
  }, [])
  useEffect(() => {
    const generation = ++accountGeneration.current
    mounted.current = true
    pending.current = false
    setOwner(userId)
    setCalls([])
    setPeople(new Map())
    setPreferences(emptySocialPreferences())
    setError('')
    setBusy(false)
    notified.current.clear()
    createdCall.current = ''
    setNotifications(savedNotifications(userId))
    if (!userId || !isSupabaseConfigured) return
    let stopped = false,
      loading = false
    const refresh = async () => {
      if (stopped || loading) return
      loading = true
      try {
        const { data, error: failure } = await supabase.rpc(
          'list_my_direct_calls',
        )
        if (failure) throw failure
        const next = (data || []) as DirectCall[]
        const ids = [
          ...new Set(
            next.map((call) =>
              call.caller_id === userId ? call.recipient_id : call.caller_id,
            ),
          ),
        ].slice(0, 20)
        const profiles = ids.length
          ? await getSocialProfileCards(ids).catch(
              () => new Map<string, SocialUser>(),
            )
          : new Map<string, SocialUser>()
        if (!stopped) {
          setCalls(next)
          setPeople(profiles)
          setNow(Date.now())
        }
      } catch {
        /* A later realtime/focus/poll retries; do not erase a ringing call on transient network failure. */
      } finally {
        loading = false
      }
    }
    refreshRef.current = refresh
    void loadSocialPreferences(userId)
      .then((value) => {
        if (!stopped) setPreferences(value)
      })
      .catch(() => {})
    void refresh()
    const channel = supabase.channel(`fk:calls:${userId}`)
    for (const filter of [
      `caller_id=eq.${userId}`,
      `recipient_id=eq.${userId}`,
    ])
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_calls', filter },
        () => void refresh(),
      )
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void refresh()
    })
    const resume = () => {
      if (!document.hidden) void refresh()
    }
    const timer = window.setInterval(resume, 15000)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    return () => {
      stopped = true
      if (accountGeneration.current === generation) {
        mounted.current = false
        refreshRef.current = async () => {}
      }
      window.clearInterval(timer)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      void supabase.removeChannel(channel)
    }
  }, [userId])
  useEffect(() => {
    if (!ringing) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
      if (Date.parse(ringing.expires_at) <= Date.now())
        void refreshRef.current()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [ringing?.id])
  useEffect(() => {
    if (!latest?.ended_at) return
    if (
      latest.id === createdCall.current &&
      ['missed', 'declined', 'cancelled', 'busy'].includes(latest.status)
    ) {
      cancelledCalls.current.add(latest.id)
      createdCall.current = ''
      void optionsRef.current.leaveIdleRoom(latest.room_code)
    }
    const timer = window.setTimeout(() => setNow(Date.now()), 10100)
    return () => window.clearTimeout(timer)
  }, [latest?.id, latest?.status])
  useEffect(() => {
    if (!incoming || preferences.do_not_disturb) return
    if (optionsRef.current.activeRoom || optionsRef.current.connecting) {
      void respond(incoming, 'decline')
        .then(() => refreshRef.current())
        .catch(() => {})
      return
    }
    playCallSound('ring')
    let webNotification: Notification | null = null
    const interval = window.setInterval(() => {
      if (Date.parse(incoming.expires_at) > Date.now()) playCallSound('ring')
    }, 3500)
    if (!notified.current.has(incoming.id)) {
      notified.current.add(incoming.id)
      const name = people.get(incoming.caller_id)?.displayName || 'Alguém'
      if (notifications && document.hidden) {
        if (window.fordKallDesktop?.notifyCall)
          window.fordKallDesktop.notifyCall(name)
        else if (
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          const notification = new Notification(`${name} está ligando`, {
            body: 'Abra o Ford Kall para atender.',
            tag: `fk-call-${incoming.id}`,
            icon: '/icons/icon-192.png',
          })
          webNotification = notification
          notification.onclick = () => {
            window.focus()
            notification.close()
          }
          window.setTimeout(
            () => notification.close(),
            Math.max(1, Date.parse(incoming.expires_at) - Date.now()),
          )
        }
      }
    }
    return () => {
      window.clearInterval(interval)
      webNotification?.close()
      window.fordKallDesktop?.dismissCallNotification?.()
    }
  }, [
    incoming?.id,
    preferences.do_not_disturb,
    notifications,
    options.activeRoom,
    options.connecting,
  ])
  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    const generation = accountGeneration.current
    try {
      await action()
    } catch (cause) {
      if (accountGeneration.current === generation && mounted.current)
        setError(callError(cause))
    } finally {
      if (accountGeneration.current === generation && mounted.current) {
        pending.current = false
        setBusy(false)
        void refreshRef.current()
      }
    }
  }, [])
  const dial = useCallback(
    (person: SocialUser) =>
      run(async () => {
        primeCallSounds()
        const current = optionsRef.current
        if (!current.account || current.connecting) return
        const { data, error: failure } = await supabase.rpc(
          'start_direct_call',
          { p_recipient: person.id, p_room_code: current.activeRoom || null },
        )
        if (failure) throw failure
        const call = data as DirectCall
        if (optionsRef.current.account?.id !== current.account.id) return
        setCalls((previous) => [
          call,
          ...previous.filter((item) => item.id !== call.id),
        ])
        setPeople((previous) => new Map(previous).set(person.id, person))
        setNow(Date.now())
        if (current.activeRoom) return
        createdCall.current = call.id
        if (!(await current.join(call.room_code))) {
          await respond(call, 'cancel')
          throw Error('JOIN_FAILED')
        }
        if (cancelledCalls.current.has(call.id))
          await optionsRef.current.leaveIdleRoom(call.room_code)
      }),
    [respond, run],
  )
  const accept = useCallback(
    () =>
      incoming &&
      run(async () => {
        primeCallSounds()
        const current = optionsRef.current
        if (current.activeRoom || current.connecting) {
          await respond(incoming, 'decline')
          return
        }
        const accepted = await respond(incoming, 'accept')
        if (optionsRef.current.account?.id !== current.account?.id) return
        if (accepted.status !== 'accepted') return
        if (!(await current.join(accepted.room_code))) {
          await respond(accepted, 'end')
          throw Error('JOIN_FAILED')
        }
      }),
    [incoming, respond, run],
  )
  const decline = useCallback(
    () =>
      incoming &&
      run(async () => {
        await respond(incoming, 'decline')
      }),
    [incoming, respond, run],
  )
  const cancel = useCallback(async () => {
    if (!outgoing) return
    cancelledCalls.current.add(outgoing.id)
    try {
      await respond(outgoing, 'cancel')
      void optionsRef.current.leaveIdleRoom(outgoing.room_code)
      await refreshRef.current()
    } catch (cause) {
      setError(callError(cause))
    }
  }, [outgoing, respond])
  const endRoomCalls = useCallback(
    async (room: string) => {
      for (const call of calls.filter(
        (item) =>
          item.room_code === room &&
          (item.status === 'ringing' || item.status === 'accepted'),
      ))
        await respond(
          call,
          call.status === 'accepted'
            ? 'end'
            : call.caller_id === userId
              ? 'cancel'
              : 'decline',
        ).catch(() => {})
      void refreshRef.current()
    },
    [calls, respond, userId],
  )
  const updatePreferences = useCallback(
    (patch: Partial<SocialPreferences>) =>
      run(async () => {
        const next = { ...preferences, ...patch }
        await saveSocialPreferences(userId, next)
        setPreferences(next)
      }),
    [preferences, run, userId],
  )
  const enableNotifications = useCallback(
    () =>
      run(async () => {
        if (
          window.fordKallDesktop?.notifyCall ||
          ('Notification' in window &&
            (await Notification.requestPermission()) === 'granted')
        ) {
          savedNotifications(userId, true)
          setNotifications(true)
        } else
          setError(
            'Notificações bloqueadas. Você ainda recebe as chamadas dentro do app.',
          )
      }),
    [run, userId],
  )
  const toggleNotifications = useCallback(() => {
    if (notifications) {
      savedNotifications(userId, false)
      setNotifications(false)
    } else void enableNotifications()
  }, [notifications, enableNotifications, userId])
  return {
    incoming,
    outgoing,
    latest,
    calls: currentCalls,
    people,
    preferences: owner === userId ? preferences : emptySocialPreferences(),
    busy,
    error,
    clearError: () => setError(''),
    dial,
    accept,
    decline,
    cancel,
    endRoomCalls,
    updatePreferences,
    notifications,
    toggleNotifications,
    returnToCall: options.returnToCall,
  }
}
export type DirectCallsController = ReturnType<typeof useDirectCalls>
