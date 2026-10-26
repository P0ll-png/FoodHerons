import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import AuthLayout, {
  PasswordField,
  PhoneField,
  AuthDivider,
  AuthTerms,
  FacebookButton,
  isStrongPassword,
  isValidPHMobile,
} from '../components/AuthLayout'

export default function Signup() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [role, setRole] = useState(params.get('role') === 'vendor' ? 'vendor' : 'student')
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', store: '' })
  const [error, setError] = useState('')

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const goNext = () => navigate(role === 'vendor' ? '/dashboard' : '/')

  const submit = (e) => {
    e.preventDefault()
    if (!isValidPHMobile(form.phone)) {
      setError('Enter a valid Philippine mobile number, e.g. +63 917 123 4567.')
      return
    }
    if (!isStrongPassword(form.password)) {
      setError('Please meet all the password requirements.')
      return
    }
    setError('')
    goNext()
  }

  const signupWithFacebook = () => goNext()

  return (
    <AuthLayout
      variant="signup"
      title="Join Food Herons"
      message="Order from campus vendors, or open your own store."
    >
      <div className="role-switch" role="radiogroup" aria-label="Account type">
        <button type="button" role="radio" aria-checked={role === 'student'}
          className={`role-switch__btn ${role === 'student' ? 'role-switch__btn--active' : ''}`}
          onClick={() => setRole('student')}>
          <Icon name="user" size={16} /> Student
        </button>
        <button type="button" role="radio" aria-checked={role === 'vendor'}
          className={`role-switch__btn ${role === 'vendor' ? 'role-switch__btn--active' : ''}`}
          onClick={() => setRole('vendor')}>
          <Icon name="store" size={16} /> Vendor
        </button>
      </div>

      <form className="auth__form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="name">Full name</label>
          <input id="name" className="input" placeholder="Enter your full name (e.g. Juan Dela Cruz)"
            value={form.name} onChange={update('name')} autoComplete="name" required />
        </div>

        {role === 'vendor' && (
          <div className="field">
            <label htmlFor="store">Store name</label>
            <input id="store" className="input" placeholder="Enter your store name (e.g. Tita Nena's Silog)"
              value={form.store} onChange={update('store')} required />
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" className="input" placeholder="you@umak.edu.ph"
              value={form.email} onChange={update('email')} autoComplete="email" required />
          </div>

          <PhoneField
            label="Contact number"
            value={form.phone}
            onChange={(phone) => setForm((f) => ({ ...f, phone }))}
          />
        </div>

        <PasswordField placeholder="Create a password" value={form.password} onChange={update('password')} autoComplete="new-password" showRules />

        {error && <p className="auth__error" role="alert">{error}</p>}

        <button type="submit" className="auth__submit">
          {role === 'vendor' ? 'Create store' : 'Sign up'}
        </button>

        <AuthDivider />
        <FacebookButton onClick={signupWithFacebook} label="Continue with Facebook" />
        <AuthTerms />

        <p className="auth__alt">Already have an account? <Link to="/login">Log in</Link></p>
      </form>
    </AuthLayout>
  )
}