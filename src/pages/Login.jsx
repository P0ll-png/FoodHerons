import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import HeronMascot from '../components/HeronMascot'
import BlobField from '../components/BlobField'
import './auth.css'

export default function Login() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })

  const submit = (e) => {
    e.preventDefault()
    // Frontend-only demo: no real auth. Route to dashboard.
    navigate('/dashboard')
  }

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="auth">
      <BlobField className="auth__blobs" />
      <div className="auth__card">
        <span className="auth__logo" aria-hidden="true">
          <HeronMascot className="logo-mascot" />
          <img src="/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </span>
        <h1 className="auth__title">Welcome back</h1>
        <p className="auth__sub">Log in to order or manage your store.</p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@umak.edu.ph"
              value={form.email}
              onChange={update('email')}
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={form.password}
              onChange={update('password')}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn btn--primary btn--block">
            Log in
          </button>
        </form>

        <p className="auth__alt">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  )
}
