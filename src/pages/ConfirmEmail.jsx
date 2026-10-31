import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthLayout from '../components/AuthLayout'

// Landing page for the Supabase confirmation link (/auth/confirmed).
// Supabase reads the session from the URL on its own, which triggers
// onAuthStateChange in AuthContext, so this page only waits and redirects.
export default function ConfirmEmail() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  // Supabase puts error details in the URL when the link is expired or invalid
  const [failed, setFailed] = useState(() =>
    /error=|error_code=/.test(window.location.hash + window.location.search)
  )

  // Confirmed and signed in -> dashboard
  useEffect(() => {
     if (!loading && user) navigate(user.role === 'vendor' ? '/dashboard' : '/', { replace: true })   // [CHANGE] role-based
  }, [user, loading, navigate])

  // No session after 8 seconds -> treat the link as invalid
  useEffect(() => {
    if (user) return
    const t = setTimeout(() => setFailed(true), 8000)
    return () => clearTimeout(t)
  }, [user])

  return (
    <AuthLayout
      variant="signup"
      title={failed ? 'Link expired or invalid' : 'Confirming your email…'}
      message={failed ? 'Sign up again to get a new link.' : 'Hang tight, signing you in.'}
    >
      {failed && (
        <p className="auth__alt">
          <Link to="/signup">Back to sign up</Link>
        </p>
      )}
    </AuthLayout>
  )
}
