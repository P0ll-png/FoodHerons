import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import '../pages/auth.css'

export const PASSWORD_RULES = [
  { id: 'len',   label: 'At least 8 characters',        test: (p) => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter',         test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'One lowercase letter',         test: (p) => /[a-z]/.test(p) },
  { id: 'num',   label: 'One number',                   test: (p) => /\d/.test(p) },
  { id: 'sym',   label: 'One special character (!@#$)', test: (p) => /[^A-Za-z0-9]/.test(p) },
]
export const isStrongPassword = (p) => PASSWORD_RULES.every((r) => r.test(p))

/* ---------- Philippine mobile numbers (+63 9XX XXX XXXX) ---------- */
export const cleanPHMobile = (raw) => {
  let d = String(raw).replace(/\D/g, '')
  if (d.startsWith('63')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}

const formatPHMobile = (d) =>
  [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ')
export const isValidPHMobile = (d) => /^9\d{9}$/.test(d)

// value defaults to '' so an undefined value can't crash formatPHMobile
export function PhoneField({ id = 'phone', label = 'Contact number', value = '', onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field__wrap">
        <span className="field__prefix" aria-hidden="true">+63</span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          className="input input--phone"
          placeholder="9XX XXX XXXX"
          value={formatPHMobile(value)}
          onChange={(e) => onChange(cleanPHMobile(e.target.value))}
          autoComplete="tel-national"
          aria-label={`${label}, Philippine mobile number starting with +63`}
          required
        />
      </div>
    </div>
  )
}

/* ---------- "or" divider + Continue with Facebook ---------- */
export function AuthDivider({ children = 'or' }) {
  return (
    <div className="auth__divider" role="separator">
      <span>{children}</span>
    </div>
  )
}

// Frontend-only stub: wire `onClick` to Facebook Login (via the backend) later.
export function FacebookButton({ onClick, label = 'Continue with Facebook' }) {
  return (
    <button type="button" className="auth__fb" onClick={onClick}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="12" fill="#1877F2" />
        <path
          d="M13.4 19v-6h2l.4-2.5h-2.4V9c0-.7.3-1.2 1.3-1.2h1.2V5.6c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.7H8.8V13h2v6h2.6Z"
          fill="#fff"
        />
      </svg>
      <span>{label}</span>
    </button>
  )
}

export function AuthTerms() {
  return (
    <p className="auth__terms"> {/* The links are placeholder for now */}
      By continuing, you agree to the <Link to="/">Terms</Link> and <Link to="/">Privacy Policy</Link>.
    </p>
  )
}

// value defaults to '' so the rules checklist can't crash on an undefined value
export function PasswordField({ id = 'password', label = 'Password', placeholder = 'Enter your password', value = '', onChange, autoComplete, showRules = false }) {
  const [show, setShow] = useState(false)
  return (
    <div className={`field ${showRules ? 'field--rules' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field__wrap">
        <input id={id} type={show ? 'text' : 'password'} className="input input--pw"
          placeholder={placeholder} value={value} onChange={onChange}
          autoComplete={autoComplete} maxLength={64} required
          aria-describedby={showRules ? `${id}-rules` : undefined} />
        <button type="button" className="field__eye" onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <Icon name="eyeOff" size={18} /> : <Icon name="eye" size={18} />}
        </button>

        {showRules && (
          <div className="pw-pop" id={`${id}-rules`} role="tooltip">
            <p className="pw-pop__title">Password must have:</p>
            <ul>
              {PASSWORD_RULES.map((r) => {
                const ok = r.test(value)
                return (
                  <li key={r.id} className={ok ? 'pw-pop__ok' : ''}>
                    <span aria-hidden="true">{ok ? '✓' : '•'}</span> {r.label}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

const hideBroken = (e) => { e.currentTarget.style.display = 'none' }

export default function AuthLayout({ variant = 'login', title, message, children }) {
  return (
    <div className={`auth auth--${variant}`}>
      
      {/* FLOATING WHITE CARD */}
      <section className="auth__body">
        <div className="auth__content">
          <span className="auth__logo" aria-hidden="true">
            <img src="/images/logo.jpg" alt="" onError={hideBroken} />
          </span>
          <h1 className="auth__title">{title}</h1>
          {message && <p className="auth__message">{message}</p>}
          {children}
        </div>
      </section>
    </div>
  )
}