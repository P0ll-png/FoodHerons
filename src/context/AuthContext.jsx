import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/*
  Auth store backed by Supabase Auth.
  - Hydrates from supabase.auth.getSession() on mount and stays in sync via
    onAuthStateChange.
  - `user` is a flattened profile: { id, email, role, full_name, mobile, avatar_url }
    with a lowercase role, or null when signed out.
  - `loading` is true until the first session resolves.
*/

const AuthContext = createContext(null)

async function fetchProfile(session) {
  if (!session?.user) return null
  const uid = session.user.id
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, mobile, avatar_url')
    .eq('id', uid)
    .single()

  if (error || !data) {
    // Fall back to the auth session so a logged-in user is still recognized.
    return {
      id: uid,
      email: session.user.email ?? '',
      role: '',
      full_name: '',
      mobile: '',
      avatar_url: '',
    }
  }

  return {
    id: data.id,
    email: data.email ?? session.user.email ?? '',
    role: (data.role ?? '').toLowerCase(),
    full_name: data.full_name ?? '',
    mobile: data.mobile ?? '',
    avatar_url: data.avatar_url ?? '',
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const profile = await fetchProfile(session)
      if (!mounted.current) return
      setUser(profile)
      setLoading(false)
    })

   const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(async () => {
        const profile = await fetchProfile(session)
        if (!mounted.current) return
        setUser(profile)
        setLoading(false)
      }, 0)
    })

    return () => {
      mounted.current = false
      subscription?.unsubscribe()
    }
  }, [])

  const login = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUser(null)
  }, [])

  const signup = useCallback(async ({ name, email, phone, password, role, store }) => {
    const { data, error } = await supabase.auth.signUp({ //  now also reads `data`
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirmed`,   // [ADD] where the email link lands
        data: {
          full_name: name,
          role,
          mobile: phone,
          store_name: role === 'vendor' ? store : null,
        },
      },
    })
    if (error) throw error
    // [ADD] with "Confirm email" on, an already-registered email returns a fake user with no identities
    if (data.user && data.user.identities?.length === 0) {
      throw new Error('An account with this email already exists. Try logging in.')
    }

    // [ADD] 'confirmed' = already signed in (confirmation disabled), 'pending' = email sent
    return { status: data.session ? 'confirmed' : 'pending' }
  }, [])

    // [ADD] used by the Resend button on the "Check your inbox" screen
  const resendVerification = useCallback(async (email) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirmed` },
    })
    if (error) throw error
  }, [])
  const updateUser = useCallback(async (patch) => {
    if (!user?.id) throw new Error('Not signed in.')
    const columns = {}
    if ('name' in patch) columns.full_name = patch.name
    if ('full_name' in patch) columns.full_name = patch.full_name
    if ('avatar' in patch) columns.avatar_url = patch.avatar
    if ('avatar_url' in patch) columns.avatar_url = patch.avatar_url
    if ('mobile' in patch) columns.mobile = patch.mobile

    const { error } = await supabase.from('profiles').update(columns).eq('id', user.id)
    if (error) throw error

    const { data } = await supabase
      .from('profiles')
      .select('id, role, full_name, email, mobile, avatar_url')
      .eq('id', user.id)
      .single()
    if (data) {
      setUser({
        id: data.id,
        email: data.email ?? user.email ?? '',
        role: (data.role ?? '').toLowerCase(),
        full_name: data.full_name ?? '',
        mobile: data.mobile ?? '',
        avatar_url: data.avatar_url ?? '',
      })
    }
  }, [user])

  const changePassword = useCallback(async ({ next }) => {
    const { error } = await supabase.auth.updateUser({ password: next })
    if (error) throw error
  }, [])

  const deleteAccount = useCallback(() => {
    throw new Error('Account deletion is not available yet.')
  }, [])

   // added `resendVerification` to both the object and the dependency array
  const value = useMemo(
    () => ({ user, loading, login, logout, signup, resendVerification, updateUser, changePassword, deleteAccount }),
    [user, loading, login, logout, signup, resendVerification, updateUser, changePassword, deleteAccount]
  )
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
