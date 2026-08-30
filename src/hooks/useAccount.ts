import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  friendlyAuthError,
  getInitialSession,
  isSupabaseConfigured,
  loadAccountProfile,
  onAuthChange,
  redeemInvite,
  signIn,
  signOut,
  updateAccountProfile,
  validateInvite,
} from '../services/supabase'
import { saveLocalProfile } from '../storage/preferences'
import type { AccountProfile, LocalProfile } from '../types'

export const useAccount = () => {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const loadProfile = useCallback(async (nextSession: Session | null) => {
    const request = ++requestRef.current
    setSession(nextSession)
    if (!nextSession) {
      setProfile(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const nextProfile = await loadAccountProfile()
      if (nextProfile.status !== 'active') throw new Error('ACCOUNT_SUSPENDED')
      if (request !== requestRef.current) return
      setProfile(nextProfile)
      saveLocalProfile(nextProfile)
    } catch (profileError) {
      if (request !== requestRef.current) return
      setProfile(null)
      setError(friendlyAuthError(profileError))
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError('O acesso privado ainda não foi configurado neste build.')
      setLoading(false)
      return
    }

    void getInitialSession().then(loadProfile).catch((sessionError) => {
      setError(friendlyAuthError(sessionError))
      setLoading(false)
    })
    return onAuthChange((nextSession) => void loadProfile(nextSession))
  }, [loadProfile])

  const login = useCallback(async (email: string, password: string) => {
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      return true
    } catch (loginError) {
      setError(friendlyAuthError(loginError))
      setLoading(false)
      return false
    }
  }, [])

  const activate = useCallback(async (values: {
    code: string
    email: string
    password: string
    displayName: string
    avatarDataUrl?: string
    bio?: string
    appearance?: LocalProfile['appearance']
  }) => {
    setError('')
    setLoading(true)
    try {
      await redeemInvite(values)
      return true
    } catch (activationError) {
      setError(friendlyAuthError(activationError))
      setLoading(false)
      return false
    }
  }, [])

  const logout = useCallback(async () => {
    setLoading(true)
    try {
      await signOut()
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const updateProfile = useCallback(async (nextProfile: LocalProfile) => {
    const account = await updateAccountProfile(nextProfile)
    setProfile(account)
    saveLocalProfile(account)
    return account
  }, [])

  return {
    configured: isSupabaseConfigured,
    session,
    profile,
    loading,
    error,
    clearError: () => setError(''),
    validateInvite: async (code: string) => {
      setError('')
      try {
        await validateInvite(code)
        return true
      } catch (inviteError) {
        setError(friendlyAuthError(inviteError))
        return false
      }
    },
    login,
    activate,
    logout,
    updateProfile,
  }
}
