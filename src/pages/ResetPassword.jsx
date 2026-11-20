import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthLayout, { PasswordField, AuthToast, isStrongPassword } from '../components/AuthLayout'

// Step 2 of "forgot password"  ->  route: /reset-password
// The link in the reset email opens this page (e.g. /reset-password?token=...).
export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') // TODO: send this with the new password once there is a backend

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)             
  const [submitting, setSubmitting] = useState(false) 
  const timerRef = useRef(null)                    

  useEffect(() => () => clearTimeout(timerRef.current), [])

  // TODO (when auth exists): update the password using `token` here.
  const updatePassword = async (token, password) => {}

  const update = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); if (error) setError('') }

  const submit = async (e) => {
    e.preventDefault()

    if (!isStrongPassword(form.password)) return setError('Your password doesn’t meet all the requirements.')
    if (form.password !== form.confirm) return setError('The two passwords don’t match.')
    setError('')
    setSubmitting(true)
    try {
      await updatePassword(token, form.password)
      setToast({ title: 'Password updated', text: 'Redirecting you to log in…' })
      timerRef.current = setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setError(err?.message || 'Unable to update your password. The link may have expired.')
      setSubmitting(false)
    }
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

        <button type="submit" className="auth__submit" disabled={submitting}>Update password</button>

        <p className="auth__alt"><Link to="/login">← Back to log in</Link></p>
      </form>
      {toast && <AuthToast {...toast} icon="user" />}
    </AuthLayout>
  )
}