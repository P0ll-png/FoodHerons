import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthLayout, { PasswordField, AuthToast, isStrongPassword } from '../components/AuthLayout'

// Step 2 of "forgot password"  ->  route: /reset-password
// The link in the reset email signs the user in with a recovery session (Supabase reads it from the URL),
// so this page waits for that session, then lets them set a new password.
export default function ResetPassword() {
  const navigate = useNavigate()
  const { user, completePasswordReset } = useAuth()
  // Supabase puts error details in the URL when the link is expired or invalid
  const [linkFailed, setLinkFailed] = useState(() =>
    /error=|error_code=/.test(window.location.hash + window.location.search)
  )
  const [ready, setReady] = useState(false)          // latched once the recovery session is seen

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)             
  const [submitting, setSubmitting] = useState(false) 
  const timerRef = useRef(null)                    

  useEffect(() => () => clearTimeout(timerRef.current), [])

  useEffect(() => { if (user) setReady(true) }, [user])

  // No recovery session after 8 seconds -> treat the link as invalid
  useEffect(() => {
    if (user) return
    const t = setTimeout(() => setLinkFailed(true), 8000)
    return () => clearTimeout(t)
  }, [user])


  const update = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); if (error) setError('') }

  const submit = async (e) => {
    e.preventDefault()

    if (!isStrongPassword(form.password)) return setError('Your password doesn’t meet all the requirements.')
    if (form.password !== form.confirm) return setError('The two passwords don’t match.')
    setError('')
    setSubmitting(true)
    try {
      await completePasswordReset(form.password)
      setToast({ title: 'Password updated', text: 'Redirecting you to log in…' })
      timerRef.current = setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setError(err?.message || 'Unable to update your password. The link may have expired.')
      setSubmitting(false)
    }
  }

  if (!user && !ready) {
    return (
      <AuthLayout
        variant="recovery"
        title={linkFailed ? 'Link expired or invalid' : 'Checking your link…'}
        message={linkFailed ? 'Request a new reset link to continue.' : 'Hang tight, verifying your reset link.'}
      >
        {linkFailed && (
          <>
            <p className="auth__alt"><Link to="/forgot-password">Request a new link</Link></p>
            <p className="auth__alt"><Link to="/login">← Back to log in</Link></p>
          </>
        )}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      variant="recovery"
      title="Set a new password"
      message="Choose a new password for your Food Herons account."
    >
      <form className="auth__form" onSubmit={submit}>
        <PasswordField id="rp-password" label="New password" placeholder="Enter your new password"
          value={form.password} onChange={update('password')} autoComplete="new-password" showRules />
        <PasswordField id="rp-confirm" label="Confirm new password" placeholder="Re-enter your new password"
          value={form.confirm} onChange={update('confirm')} autoComplete="new-password" />

        {error && <p className="auth__error" role="alert">{error}</p>}

        <button type="submit" className="auth__submit" disabled={submitting}>{submitting ? 'Updating…' : 'Update password'}</button>

        <p className="auth__alt"><Link to="/login">← Back to log in</Link></p>
      </form>
      {toast && <AuthToast {...toast} icon="user" />}
    </AuthLayout>
  )
}