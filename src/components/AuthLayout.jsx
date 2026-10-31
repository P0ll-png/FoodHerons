import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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

/* [ADD] "Continue with Google" button. Same look as FacebookButton (reuses the .auth__fb class), plus .auth__google for spacing. */
// Frontend-only stub: wire `onClick` to Google Login (via the backend) later.
export function GoogleButton({ onClick, label = 'Continue with Google' }) {
  return (
    <button type="button" className="auth__fb auth__google" onClick={onClick}>
      {/* [CHANGE] Google "G" icon (flat style with shaded segments). viewBox is cropped tight to the G (185 50 320 320)
          so it fills the full 24px, the same size as the Facebook circle. */}
      <svg width="24" height="24" viewBox="185 50 320 320" aria-hidden="true" focusable="false">
        <path fill="#FF4B26" d="M345 50A160 160 0 0 0 207 130L261 161A97 97 0 0 1 345 113Z" />   {/* top-left red */}
        <path fill="#D93F21" d="M345 50A160 160 0 0 1 452 92L413 139A97 97 0 0 0 345 113Z" />   {/* top-right dark red */}
        <path fill="#FFD500" d="M207 130A160 160 0 0 0 207 290L261 260A97 97 0 0 1 261 161Z" />  {/* left yellow */}
        <path fill="#14B54A" d="M207 290A160 160 0 0 0 345 370L345 307A97 97 0 0 1 261 260Z" />  {/* bottom-left green */}
        <path fill="#0F9D45" d="M345 370A160 160 0 0 0 425 348L395 295A97 97 0 0 1 345 307Z" />  {/* bottom dark green */}
        <path fill="#1A7FE8" d="M425 348A160 160 0 0 0 505 210L505 195Q505 183 493 183L364 183Q352 183 352 195L352 233Q352 245 364 245L437 245A97 97 0 0 1 395 295Z" />  {/* right blue + bar */}
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
export function AuthToast({ title, text, icon = 'mail', onClose }) {
  return createPortal(
    <div className="toast" role="status" aria-live="polite">
      <Icon name={icon} size={20} />
      <div className="toast__body">
        {title && <strong className="toast__title">{title}</strong>}
        {text && <span className="toast__text">{text}</span>}
      </div>
      {onClose && (
        <button type="button" className="toast__close" aria-label="Dismiss" onClick={onClose}>
          ×
        </button>
      )}
    </div>,
    document.body
  )
}
/* ---------- [ADD] "Check your inbox" body: message, resend countdown, go back ---------- */
const RESEND_COOLDOWN = 60   // seconds. Matches Supabase's 60s resend limit.

export function CheckInbox({ onResend, onChangeEmail }) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN)   
  const [status, setStatus] = useState('')                    // '', 'sending', 'sent', 'error'

  // ticks the countdown down once per second
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const resend = async () => {
    setStatus('sending')
    try {
      await onResend()
      setStatus('sent')
      setCooldown(RESEND_COOLDOWN)   // restart the countdown after a successful resend
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="inbox" role="status" aria-live="polite">
      <p className="inbox__text">
        Open the link in the email to activate your account. Can’t find it? Check your spam folder.
      </p>

      {/* disabled (faded) while counting down, e.g. "Resend in 42s" */}
      <button type="button" className="auth__submit inbox__resend"
        onClick={resend} disabled={cooldown > 0 || status === 'sending'}>
        {status === 'sending' ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
      </button>

      {status === 'sent' && <p className="inbox__ok">A new link is on its way.</p>}
      {status === 'error' && <p className="auth__error" role="alert">Couldn’t resend. Please try again.</p>}

      <p className="inbox__wrong">
        Wrong email address? <button type="button" className="inbox__link" onClick={onChangeEmail}>Go back</button>
      </p>
    </div>
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