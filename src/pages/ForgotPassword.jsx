import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthLayout, { CheckInbox } from '../components/AuthLayout'

// Step 1 of "forgot password"  ->  route: /forgot-password
// Type your email -> "Check your email" screen (with the same 60s resend countdown as sign up).
export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Same screen whether or not the email has an account, so nobody can probe for accounts.
  const sendResetEmail = (address) => requestPasswordReset(address)

  const submit = async (e) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.')
    setError('')
    setSubmitting(true)
    try {
      await sendResetEmail(email.trim())
      setSent(true)
    } catch (err) {
      setError(err?.message || 'Unable to send the reset link. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      variant="login"
      title={sent ? 'Check your email' : 'Forgot password?'}
      message={
        sent
          ? <>If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way.</>
          : 'Enter your email and we’ll send you a link to reset your password.'
      }
    >
      {!sent ? (
        <form className="auth__form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="fp-email">Email</label>
            <input id="fp-email" type="email" className="input" placeholder="Enter your email (you@umak.edu.ph)"
              value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>

          {error && <p className="auth__error" role="alert">{error}</p>}

          <button type="submit" className="auth__submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send reset link'}</button>

          <p className="auth__alt"><Link to="/login">← Back to log in</Link></p>
        </form>
      ) : (
        <>
          <CheckInbox
            text="Open the link in the email to reset your password. Can’t find it? Check your spam folder."
            onResend={() => sendResetEmail(email.trim())}
            onChangeEmail={() => { setSent(false); setError('') }}
          />
          <p className="auth__alt"><Link to="/login">← Back to log in</Link></p>
        </>
      )}
    </AuthLayout>
  )
}
