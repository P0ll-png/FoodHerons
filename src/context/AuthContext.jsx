import { createContext, useContext, useState, useCallback } from 'react'

/*
  Minimal auth store so the Header and Profile page share one student.
  - Your Login/Signup pages should call login({ name, email, role: 'Student' }).
  - DEMO_MODE seeds a sample student so the header/profile are visible
    before real auth exists. Set it to false when your backend is ready.
*/
const DEMO_MODE = true
const KEY = 'fh_user'
const DEMO_STUDENT = { name: 'Student Name', email: 'email@school.edu', mobile: '', role: 'Student', avatar: '' }

const AuthContext = createContext(null)

function readUser() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEMO_MODE ? DEMO_STUDENT : null
    return raw ? JSON.parse(raw) : null // '' = explicitly logged out
  } catch {
    return DEMO_MODE ? DEMO_STUDENT : null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readUser)

  const persist = (u) => {
    try { localStorage.setItem(KEY, u ? JSON.stringify(u) : '') } catch { /* storage full or blocked */ }
  }

  const login = useCallback((u) => {
    const next = { role: 'Student', mobile: '', avatar: '', ...u }
    setUser(next); persist(next)
  }, [])

  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }, [])

  const logout = useCallback(() => { setUser(null); persist(null) }, [])

  return (
    <AuthContext.Provider value={{ user, login, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
