import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthLayout, { PasswordField, AuthDivider, AuthTerms, FacebookButton, GoogleButton, AuthToast } from '../components/AuthLayout'   // [CHANGE] added AuthToast, GoogleButton

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)             // [ADD] { title, text }
  const [submitting, setSubmitting] = useState(false)  // [ADD] stops double-clicks while the toast shows
  const timerRef = useRef(null)                        // [ADD] redirect timer

  // [ADD] clear the redirect timer if the page unmounts early
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)   // [ADD]
    try {
      await login({ email: form.email, password: form.password })
      //  show the toast, then redirect after a short delay (was: navigate('/') immediately)
      setToast({
        title: 'Logged in successfully',
        text: 'Redirecting you now…',
      })
      timerRef.current = setTimeout(() => navigate('/'), 1500)
    } catch (err) {
      setError(err?.message || 'Unable to log in. Check your email and password.')
      setSubmitting(false)   //  re-enable the button on failure
    }
  }

  // Facebook login is a deferred stub.
  const loginWithFacebook = () => {}

  // [ADD] Google login is a deferred stub too.
  const loginWithGoogle = () => {}

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <AuthLayout
      variant="login"
      title="Welcome Back!"
      message="Log in to order or manage your store."
    >
      <form className="auth__form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" className="input" placeholder="Enter your email (you@umak.edu.ph)"
            value={form.email} onChange={update('email')} autoComplete="email" required />
        </div>

        <PasswordField placeholder="Enter your password" value={form.password} onChange={update('password')} autoComplete="current-password" />

        {error && <p className="auth__error" role="alert">{error}</p>}

        <div className="auth__row">
          <label className="auth__check">
            <input type="checkbox" /> Remember me
          </label>
          <a href="#" className="auth__forgot" onClick={(e) => e.preventDefault()}>Forgot password?</a>
        </div>

       <button type="submit" className="auth__submit" disabled={submitting}>Log in</button>  

        <AuthDivider />
        <FacebookButton onClick={loginWithFacebook} />
        {/* [ADD] Continue with Google, right below Facebook */}
        <GoogleButton onClick={loginWithGoogle} />
        <AuthTerms />

        <p className="auth__alt">New here? <Link to="/signup">Sign up</Link></p>
      </form>
            {toast && <AuthToast {...toast} icon="user" />} 
    </AuthLayout>
  )
}