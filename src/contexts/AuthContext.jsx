import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getProfile, upsertProfile } from '../services/db'
import { clearDataCache } from '../hooks/useData'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined) // undefined=loading, null=no auth, obj=loaded

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (!session?.user?.id) { setProfile(null); return }
    getProfile(session.user.id)
      .then(p => setProfile(p || {}))
      .catch(() => setProfile({}))
  }, [session?.user?.id])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signUp = (email, password) =>
    supabase.auth.signUp({ email, password })

  const signOut = () => {
    setProfile(null)
    clearDataCache()
    return supabase.auth.signOut()
  }

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })

  const updateProfile = async (updates) => {
    if (!session?.user?.id) return
    const merged = { ...(profile || {}), ...updates }
    setProfile(merged)
    await upsertProfile(session.user.id, merged)
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      isAuthenticated: !!session,
      loading: session === undefined || (!!session && profile === undefined),
      profile,
      updateProfile,
      signIn,
      signUp,
      signOut,
      signInWithGoogle,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
