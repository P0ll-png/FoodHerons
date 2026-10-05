import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import './auth.css'

export default function Signup() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [role, setRole] = useState(params.get('role') === 'vendor' ? 'vendor' : 'student')
  const [form, setForm] = useState({ name: '', email: '', password: '', store: '' })

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    // Self-service signup — no admin approval step (per spec).
    navigate(role === 'vendor' ? '/dashboard' : '/')
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <span className="auth__logo" aria-hidden="true">
          <img src="/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </span>
        <h1 className="auth__title">Join Food Herons</h1>
        <p className="auth__sub">Order from campus vendors, or open your own store.</p>

        {/* Role selection — student vs vendor self-service */}
        <div className="role-switch" role="radiogroup" aria-label="Account type">
          <button
            type="button"
            role="radio"
            aria-checked={role === 'student'}
            className={`role-switch__btn ${role === 'student' ? 'role-switch__btn--active' : ''}`}
            onClick={() => setRole('student')}
          >
            <Icon name="user" size={20} />
            Student
            <small>Browse & pre-order</small>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={role === 'vendor'}
            className={`role-switch__btn ${role === 'vendor' ? 'role-switch__btn--active' : ''}`}
            onClick={() => setRole('vendor')}
          >
            <Icon name="store" size={20} />
            Vendor
            <small>Sell on campus</small>
          </button>
        </div>

        {role === 'vendor' && (
          <p className="auth__note">
            <Icon name="check" size={16} />
            No approval needed — your store goes live right away.
          </p>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              className="input"
              placeholder="Juan Dela Cruz"
              value={form.name}
              onChange={update('name')}
              autoComplete="name"
              required
            />
          </div>

          {role === 'vendor' && (
            <div className="field">
              <label htmlFor="store">Store name</label>
              <input
                id="store"
                className="input"
                placeholder="e.g. Tita Nena's Silog"
                value={form.store}
                onChange={update('store')}
                required
              />
            </div>
          )}

          <div className="auth__row">
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
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn--primary btn--block">
            {role === 'vendor' ? 'Create store account' : 'Create account'}
          </button>
        </form>

        <p className="auth__alt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}
