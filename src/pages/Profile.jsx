import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import EmptyState from '../components/EmptyState'
import VendorCard from '../components/VendorCard'
import { vendors as ALL_VENDORS } from '../data/vendors'
import { useAuth } from '../context/AuthContext'
import { useVendors } from '../context/VendorContext'
import { ACTIVE_ORDERS, PAST_ORDERS, FAVORITES, PENDING_REVIEWS, PAST_REVIEWS } from '../data/studentSample'
import './Profile.css'

// TODO: set these to your real logo image and routes
const LOGO_SRC = '/images/logo.jpg'

// TODO: frontend preview only. Shown when nobody is logged in so the page can be designed/viewed.
// Delete this and restore the redirect to /login (see Profile() below) once login works.
const PREVIEW_USER = { name: 'Student Preview', email: 'student@example.com', mobile: '', role: 'Student', avatar: '' }

const phDigits = (v = '') => {
  let d = String(v).replace(/\D/g, '')
  if (d.startsWith('63')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}
const phFormat = (d) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ')
const phValid = (d) => /^9\d{9}$/.test(d)

const initials = (name) => (name || 'Student').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'S'

function toVendor(v, lookup) {
  const fromStore = lookup?.(v.id)
  const real = fromStore && String(fromStore.id) === String(v.id)
    ? fromStore
    : ALL_VENDORS.find((x) => String(x.id) === String(v.id))
  if (real) return real
  const [open, close] = (v.hours || '').split(/\s*[-–]\s*/)
  return {
    id: v.id,
    name: v.name,
    description: v.description || '',
    locationArea: v.locationArea || v.location || '',
    hoursOpen: v.hoursOpen || open || '',
    hoursClose: v.hoursClose || close || '',
    isOpen: v.isOpen ?? v.status === 'Open',
    rating: v.rating ?? '—',
    reviews: v.reviews ?? 0,
    preorderEnabled: v.preorderEnabled ?? !!v.preOrder,
    coverTint: v.coverTint || 'var(--orange-soft)',
    category: v.category ?? v.tag,
    cover: v.cover,
  }
}

/* ---------- small pieces ---------- */

// Photo with an orange placeholder (used for avatars, order/review thumbnails and favorite covers)
function Photo({ src, className = '' }) {
  return src
    ? <img className={`pf-photo ${className}`} src={src} alt="" />
    : <span className={`pf-photo ${className}`} aria-hidden="true" />
}

function Heading({ title, text }) {
  return (
    <header className="pf-head">
      <h1>{title}</h1>
      <p>{text}</p>
    </header>
  )
}

function Stars({ value, onChange, size = 16 }) {
  return (
    <span className="pf-stars" role={onChange ? 'radiogroup' : 'img'} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Icon name={n <= value ? 'star' : 'starOutline'} size={size} />
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)}>{icon}</button>
        ) : (
          <span key={n}>{icon}</span>
        )
      })}
    </span>
  )
}

function Field({ label, children }) {
  return <label className="pf-field"><span>{label}</span>{children}</label>
}

/* ---------- Header (logo, pill nav, avatar) ---------- */

function Header({ user, view, onOpen, onProfile, onGo }) {
  const inActivity = ['orders', 'favorites', 'reviews'].includes(view)
  const items = [
    { key: 'orders', icon: 'cart', label: 'Orders', on: view === 'orders', go: () => onOpen('orders') },
    { key: 'favorites', icon: 'heart', label: 'Favorites', on: view === 'favorites', go: () => onOpen('favorites') },
    { key: 'reviews', icon: 'review', label: 'Reviews', on: view === 'reviews', go: () => onOpen('reviews') },
  ]

  return (
    <header className="pf-header">
      <button type="button" className="pf-logo" onClick={() => onGo('/')} aria-label="Food Herons home">
        {LOGO_SRC ? <img className="pf-logo__mark" src={LOGO_SRC} alt="" /> : <span className="pf-logo__mark" aria-hidden="true" />}
        <span className="pf-logo__text">Food Herons</span>
      </button>

      <nav className="pf-nav" aria-label="Student">
        {items.map((it) => (
          <button key={it.key} type="button" className={`pf-nav__item ${it.on ? 'is-on' : ''}`} aria-current={it.on ? 'page' : undefined} onClick={it.go}>
            <Icon name={it.icon} size={16} />
            <span className="pf-nav__label">{it.label}</span>
          </button>
        ))}
      </nav>

      <button type="button" className={`pf-me ${inActivity ? '' : 'is-on'}`} onClick={onProfile} aria-label="Your profile">
        {user.avatar ? <img src={user.avatar} alt="" /> : initials(user.name)}
      </button>
    </header>
  )
}

/* ---------- Profile overview ---------- */

function Overview({ user, onEdit, onSettings, onLogout }) {
  return (
    <>
      <Heading title="Your Profile" text="Manage your student account." />
      <div className="pf-profile">
        <section className="pf-card pf-identity">
          <Photo src={user.avatar} className="pf-photo--avatar" />
          <h2 className="pf-identity__name">{user.name || 'Student'}</h2>
          <p className="pf-identity__mail">
            <span>{user.email}</span>
            <span className="pf-badge">{user.role || 'Student'}</span>
          </p>
          <button type="button" className="pf-btn pf-btn--soft pf-btn--wide" onClick={onEdit}>Edit Profile</button>
        </section>

        <div className="pf-side">
          <section className="pf-card">
            <h2 className="pf-card__title">Account Details</h2>
            <dl className="pf-details">
              <div><dt>Email</dt><dd>{user.email || '—'}</dd></div>
              <div><dt>Contact Number</dt><dd>{user.mobile || '—'}</dd></div>
            </dl>
          </section>

          <section className="pf-card pf-menu">
            <button type="button" className="pf-menu__row" onClick={onSettings}>
              <span className="pf-menu__icon">
                <Icon name="settings" size={20} />
              </span>
              Account Settings
            </button>
            <button type="button" className="pf-menu__row" onClick={onLogout}>
              <span className="pf-menu__icon"><Icon name="logout" size={20} /></span>
              Log out
            </button>
          </section>
        </div>
      </div>
    </>
  )
}

/* ---------- Edit profile ---------- */

function EditProfile({ user, updateUser, onBack }) {
  const fileRef = useRef(null)
  const [form, setForm] = useState({ name: user.name || '', email: user.email || '', mobile: user.mobile || '' })
  const [photo, setPhoto] = useState(null) 
  const [err, setErr] = useState('')
  const [photoMenu, setPhotoMenu] = useState(false)
  const photoWrap = useRef(null)
  const [fb, setFb] = useState(false) // TODO: read/write the real Facebook link status from your API
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Mobile number: fixed +63 prefix, the student types the 10-digit number (saved as "+63 917 123 4567").
  const phoneDigits = phDigits(form.mobile)
  const phoneBad = phoneDigits.length > 0 && !phValid(phoneDigits)
  const onPhone = (e) => {
    const raw = e.target.value
    let d = phDigits(raw)

    if (raw.length < phFormat(phoneDigits).length && d === phoneDigits) d = d.slice(0, -1)
    setForm((f) => ({ ...f, mobile: d ? `+63 ${phFormat(d)}` : '' }))
  }


  const original = useRef({ name: user.name, email: user.email, mobile: user.mobile, avatar: user.avatar })
  const firstRun = useRef(true)
  const initialForm = useRef(form)
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm.current) || photo !== null
  const committed = useRef(false) 
  useEffect(() => () => { if (!committed.current) updateUser(original.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    const patch = { mobile: form.mobile.trim() }
    if (form.name.trim()) patch.name = form.name.trim()
    if (/^\S+@\S+\.\S+$/.test(form.email.trim())) patch.email = form.email.trim()
    if (photo !== null) patch.avatar = photo // '' means the photo was removed
    updateUser(patch) // TODO: call your API here (e.g. on Save) if you also want to persist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, photo])

  // Close the photo menu on outside click or Escape.
  useEffect(() => {
    if (!photoMenu) return
    const onDoc = (e) => { if (!photoWrap.current?.contains(e.target)) setPhotoMenu(false) }
    const onKey = (e) => e.key === 'Escape' && setPhotoMenu(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [photoMenu])

  const shownPhoto = photo !== null ? photo : user.avatar
  const discard = () => { updateUser(original.current); onBack() }

  const onPhoto = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('Choose an image file.')
    if (file.size > 2 * 1024 * 1024) return setErr('Photo must be under 2 MB.')
    setErr('')
    const reader = new FileReader()
    reader.onload = () => { setPhoto(reader.result); setPhotoMenu(false) } // TODO: upload to your storage instead of a data URL
    reader.readAsDataURL(file)
  }

  const save = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setErr('Enter your full name.')
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setErr('Enter a valid email address.')
    if (phoneBad) return setErr('Enter a 10-digit mobile number starting with 9.')
    committed.current = true
    updateUser({ name: form.name.trim(), email: form.email.trim(), mobile: form.mobile.trim(), ...(photo !== null && { avatar: photo }) }) // TODO: call your API here
    onBack()
  }

  return (
    <>
      <button type="button" className="pf-back" onClick={onBack}>
        <Icon name="arrowLeft" size={18} /> Back to profile
      </button>
      <Heading title="Edit Profile" text="Update your photo and personal details." />

      <form className="pf-card pf-edit" onSubmit={save} noValidate>
        <div className="pf-edit__photo">
          <Photo src={shownPhoto} className="pf-photo--avatar" />
          {/* No photo yet: uploads right away. With a photo: opens Change / Remove. */}
          <div className="pf-photobtn" ref={photoWrap}>
            <button type="button" className="pf-btn pf-btn--soft"
              aria-haspopup={shownPhoto ? 'menu' : undefined}
              aria-expanded={shownPhoto ? photoMenu : undefined}
              onClick={() => (shownPhoto ? setPhotoMenu((o) => !o) : fileRef.current?.click())}>
              <Icon name="upload" size={16} /> {shownPhoto ? 'Change photo' : 'Upload a photo'}
            </button>
            {photoMenu && shownPhoto && (
              <div className="pf-popover" role="menu">
                <button type="button" role="menuitem" className="pf-popover__item"
                  onClick={() => { setPhotoMenu(false); fileRef.current?.click() }}>
                  Change photo
                </button>
                <button type="button" role="menuitem" className="pf-popover__item"
                  onClick={() => { setPhoto(''); setPhotoMenu(false); setErr('') }}>
                  Remove photo
                </button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
        </div>

        <div className="pf-edit__fields">
          <h2 className="pf-card__title">Personal Details</h2>
          <Field label="Full Name">
            <input value={form.name} onChange={set('name')} placeholder="e.g. Juan Dela Cruz" autoComplete="name" />
          </Field>
          <div className="pf-row">
            <Field label="Email">
              <input type="email" value={form.email} onChange={set('email')} placeholder="e.g. juan@school.edu" autoComplete="email" />
            </Field>
            <Field label="Mobile number">
              {/* +63 is fixed; the student types the 10-digit mobile number */}
              <div className={`pf-phone ${phoneBad ? 'is-invalid' : ''}`}>
                <span className="pf-phone__prefix" aria-hidden="true">+63</span>
                <input type="tel" inputMode="numeric" autoComplete="tel-national" value={phFormat(phoneDigits)} onChange={onPhone}
                  placeholder="917 123 4567" aria-label="Mobile number, after +63" aria-invalid={phoneBad || undefined} />
              </div>
            </Field>
          </div>
          {phoneBad && !err && <p className="pf-msg" role="alert">Enter a 10-digit mobile number starting with 9.</p>}
          {err && <p className="pf-msg" role="alert">{err}</p>}
          {dirty && (
            <div className="pf-actions">
              <button type="button" className="pf-btn pf-btn--ghost" onClick={discard}>Discard</button>
              <button type="submit" className="pf-btn pf-btn--primary">Save Changes</button>
            </div>
          )}
        </div>
      </form>

      <section className="pf-card pf-accounts">
        <h2 className="pf-card__title">Connected Accounts</h2>
        <div className="pf-connect">
          <span className="pf-connect__icon"><Icon name="facebook" size={18} /></span>
          <span className="pf-connect__name">Facebook</span>
          <button type="button" className="pf-link" onClick={() => setFb((v) => !v)}>{fb ? 'Disconnect' : 'Connect'}</button>
        </div>
      </section>
    </>
  )
}

/* ---------- Orders ---------- */

// Pill colours match the OrderStatus page: pending = amber, accepted/preparing = blue, ready/completed = green.
const STATUS_PILL = {
  Pending: 'pending',
  Accepted: 'accepted',
  Preparing: 'accepted',
  Ready: 'ready',
  'Ready for pickup': 'ready',
  Completed: 'completed',
}

function Orders({ onReorder }) {
  const [tab, setTab] = useState('past')
  const list = tab === 'active' ? ACTIVE_ORDERS : PAST_ORDERS
  return (
    <>
      <Heading title="My Orders" text="Track active deliveries, view past meals, and quickly reorder your favorites." />
      <div className="pf-panel">
        <div className="pf-tabs" role="tablist">
          {[['active', 'Active'], ['past', 'Past Orders']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`pf-tab ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {list.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={tab === 'active' ? 'No active orders' : 'No past orders yet'}
            text={tab === 'active' ? 'Orders you’re waiting on will show up here with live status.' : 'Once you’ve picked up an order, it’s saved here so you can reorder in a tap.'}
            action={{ label: 'Find something to eat', to: '/' }}
          />
        ) : (
          <ul className="pf-list">
            {list.map((o) => (
              <li key={o.id} className="pf-row-card pf-order">
                <Photo src={o.image} className="pf-photo--thumb" />
                <div className="pf-order__main">
                  <h3>{o.vendor}</h3>
                  <p className="pf-muted">{o.id} &nbsp;•&nbsp; {o.date}</p>
                  <p className="pf-order__items">
                    {o.items.map((it, i) => <span key={i}><b>{it.qty}×</b> {it.name}{i < o.items.length - 1 ? ', ' : ''}</span>)}
                  </p>
                </div>
                <strong className="pf-order__total">₱{o.total}</strong>
                <div className="pf-order__actions">
                  <span className={`pf-pill pf-pill--${STATUS_PILL[o.status] || 'bad'}`}>{o.status}</span>
                  <button type="button" className="pf-btn pf-btn--reorder" onClick={() => onReorder(o.vendorId)}>Reorder</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/* ---------- Favorites ---------- */

// Uses the same VendorCard as the browse pages. The heart is filled; clicking it removes the favorite.
function Favorites({ items, onRemove }) {
  const { getVendor } = useVendors()
  return (
    <>
      <Heading title="My Favorites" text="Your go-to meals and favorite campus stalls, ready to order in one tap." />
      {!items.length ? (
        <EmptyState icon="heart" title="No favorites yet" text="Tap the heart on a stall to keep it close for next time." action={{ label: 'Discover stalls', to: '/' }} />
      ) : (
        <ul className="pf-grid">
          {items.map((v) => (
            <li key={v.id}>
              <VendorCard vendor={toVendor(v, getVendor)} showLogo={false} isFavorite onToggleFavorite={(id, next) => { if (!next) onRemove(id) }} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ---------- Reviews ---------- */

function ReviewForm({ initial, onSave, onCancel, write = false }) {
  const [rating, setRating] = useState(initial?.rating || 0)
  const [text, setText] = useState(initial?.text || '')
  return (
    <form className={`pf-reviewform ${write ? 'pf-reviewform--write' : ''}`} onSubmit={(e) => { e.preventDefault(); if (rating) onSave({ rating, text: text.trim() }) }}>
      <Stars value={rating} onChange={setRating} size={write ? 20 : 26} />
      <textarea rows={write ? 4 : 3} value={text} onChange={(e) => setText(e.target.value)} placeholder="How was the food and pickup? (optional)" maxLength={280} />
      <div className="pf-actions pf-actions--left">
        <button className="pf-btn pf-btn--primary" type="submit" disabled={!rating}>{write ? 'Save Review' : 'Save review'}</button>
        <button type="button" className="pf-btn pf-btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// Popup (same look as the dashboard's Edit Menu Item dialog)
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pf-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pf-modal" role="dialog" aria-modal="true" aria-labelledby="pf-modal-title">
        <h2 id="pf-modal-title" className="pf-modal__title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function Reviews({ pending, past, setPending, setPast }) {
  const [editing, setEditing] = useState(null)
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const writing = pending.find((p) => p.id === editing) // the order whose "Write a review" popup is open
  const changing = past.find((p) => p.id === editing)     // the review whose "Edit" popup is open

  const savePending = (p, data) => {
    setPast((l) => [{ id: `r-${p.id}`, vendor: p.vendor, image: p.image, date: today, ...data }, ...l])
    setPending((l) => l.filter((x) => x.id !== p.id)); setEditing(null)
  }
  const savePast = (r, data) => { setPast((l) => l.map((x) => (x.id === r.id ? { ...x, ...data } : x))); setEditing(null) }

  return (
    <>
      <Heading title="My Reviews" text="Share your dining experiences and help fellow students find the best meals on campus." />

      <div className="pf-panel">
        <h2 className="pf-sub">Pending</h2>
        {pending.length === 0 ? (
          <EmptyState compact icon="check" title="You’re all caught up" text="Completed orders waiting for a rating will appear here." />
        ) : (
          <ul className="pf-list">
            {pending.map((p) => (
              <li key={p.id} className="pf-row-card pf-review pf-review--pending">
                <Photo src={p.image} className="pf-photo--thumb" />
                <div className="pf-review__main">
                  <h3>How was {p.vendor}?</h3>
                  <p className="pf-muted">Order {p.id} is ready to rate.</p>
                </div>
                <button type="button" className="pf-btn pf-btn--outline pf-btn--sm" onClick={() => setEditing(p.id)}>Write a review</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pf-panel">
        <h2 className="pf-sub">Past Reviews</h2>
        {past.length === 0 ? (
          <EmptyState compact icon="review" title="No reviews yet" text="Your ratings help other students pick where to eat." />
        ) : (
          <ul className="pf-list">
            {past.map((r) => (
              <li key={r.id} className="pf-row-card pf-review">
                <Photo src={r.image} className="pf-photo--thumb" />
                <div className="pf-review__main">
                  <div className="pf-review__head">
                    <h3>{r.vendor}</h3>
                    <span className="pf-review__meta">
                      <span className="pf-muted">{r.date}</span>
                      <button type="button" className="pf-btn pf-btn--outline pf-btn--sm" onClick={() => setEditing(r.id)}>Edit</button>
                    </span>
                  </div>
                  <Stars value={r.rating} />
                  {r.text && <p>{r.text}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {changing && (
        <Modal title="Edit Review" onClose={() => setEditing(null)}>
          <div className="pf-modal__top">
            <Photo src={changing.image} className="pf-photo--thumb pf-photo--modal" />
            <div className="pf-modal__who">
              <h3>{changing.vendor}</h3>
              <p>Reviewed on {changing.date}</p>
            </div>
          </div>
          <ReviewForm write initial={changing} onSave={(d) => savePast(changing, d)} onCancel={() => setEditing(null)} />
        </Modal>
      )}

      {writing && (
        <Modal title="Write a Review" onClose={() => setEditing(null)}>
          <div className="pf-modal__top">
            <Photo src={writing.image} className="pf-photo--thumb pf-photo--modal" />
            <div className="pf-modal__who">
              <h3>How was {writing.vendor}?</h3>
              <p>Order {writing.id} is ready to rate.</p>
            </div>
          </div>
          <ReviewForm write onSave={(d) => savePending(writing, d)} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </>
  )
}

/* ---------- Account settings (change password, security tips, delete account) ---------- */

const pwRules = (p) => [
  { ok: p.length >= 8, text: 'At least 8 characters' },
  { ok: /[A-Z]/.test(p) && /\d/.test(p), text: 'One uppercase letter and one number' },
  { ok: /[^A-Za-z0-9]/.test(p), text: 'One special character (e.g. ! @ #)', optional: true },
]

function PasswordField({ id, label, value, onChange, show, onToggle, placeholder, autoComplete, onFocus, onBlur }) {
  return (
    <div className="pf-field">
      <label htmlFor={id}>{label}</label>
      <div className="pf-pass">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} autoComplete={autoComplete} onFocus={onFocus} onBlur={onBlur} />
        {onToggle && (
          <button type="button" className="pf-pass__eye" onClick={onToggle} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
            <Icon name={show ? 'passEyeOff' : 'passEye'} size={18} />
          </button>
        )}
      </div>
    </div>
  )
}

// Confirmation popup for deleting the account: the student re-enters their password first.
function DeleteDialog({ onClose, onConfirm }) {
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    if (!pass) return
    setBusy(true)
    try {
      await onConfirm(pass)
    } catch (err) {
      setError(err?.message || 'Could not delete your account. Check your password and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="pf-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pf-modal pf-modal--white" role="dialog" aria-modal="true" aria-labelledby="pf-del-title">
        <button type="button" className="pf-dialog__x" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
        <span className="pf-dialog__icon" aria-hidden="true">
          <Icon name="warning" size={22} />
        </span>
        <h2 id="pf-del-title" className="pf-dialog__title">Delete your account?</h2>
        <p className="pf-dialog__text">This permanently deletes your profile, order history, favorites and reviews. This can’t be undone.</p>
        <form onSubmit={submit}>
          <PasswordField id="del-pass" label="Enter your password to confirm" value={pass} onChange={(e) => { setPass(e.target.value); setError('') }}
            show={show} onToggle={() => setShow((s) => !s)} placeholder="Your password" autoComplete="current-password" />
          {error && <p className="pf-msg" role="alert">{error}</p>}
          <div className="pf-actions pf-dialog__actions">
            <button type="button" className="pf-btn pf-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="pf-btn pf-btn--danger" disabled={!pass || busy}>Delete account</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AccountSettings({ onBack, onDeleted, changePassword, deleteAccount }) {
  const blank = { current: '', next: '', confirm: '' }
  const [form, setForm] = useState(blank)
  const [show, setShow] = useState({ current: false, next: false })
  const [others, setOthers] = useState(true)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newFocus, setNewFocus] = useState(false)
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErr(''); setOk('') }

  const rules = pwRules(form.next)
  const score = [form.next.length >= 8, /[A-Z]/.test(form.next) && /\d/.test(form.next), /[^A-Za-z0-9]/.test(form.next), form.next.length >= 12].filter(Boolean).length

  // The strength bar + checklist only appear once the New password box is clicked (and stay while it has text).
  const showRules = newFocus || form.next.length > 0

  const pwDirty = Boolean(form.current || form.next || form.confirm) || !others // anything changed?
  const discard = () => { setForm(blank); setShow({ current: false, next: false }); setOthers(true); setErr(''); setOk('') }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.current) return setErr('Enter your current password.')
    if (!rules[0].ok || !rules[1].ok) return setErr('Your new password does not meet the requirements.')
    if (form.next === form.current) return setErr('Choose a password you have not used before.')
    if (form.next !== form.confirm) return setErr('The new passwords do not match.')
    setBusy(true)
    try {
      // TODO: connect your API. Pass logoutOthers so other devices are signed out.
      if (changePassword) await changePassword({ current: form.current, next: form.next, logoutOthers: others })
      setForm(blank)
      setOk('Password updated.')
    } catch (error) {
      setErr(error?.message || 'Could not update your password. Check your current password and try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (password) => {
    // TODO: connect your API to delete the account permanently (it should check the password).
    if (deleteAccount) await deleteAccount({ password })
    onDeleted()
  }

  return (
    <>
      <button type="button" className="pf-back" onClick={onBack}>
        <Icon name="arrowLeft" size={16} /> Back to profile
      </button>
      <Heading title="Account Settings" text="Keep your student account secure." />

      <div className="pf-settings">
        <form className="pf-card pf-pwform" onSubmit={submit} noValidate>
          <div>
            <h2 className="pf-card__title">Change Password</h2>
            <p className="pf-muted">Use a strong password you don’t use anywhere else.</p>
          </div>

          <PasswordField id="pw-current" label="Current password" value={form.current} onChange={set('current')}
            show={show.current} onToggle={() => setShow((s) => ({ ...s, current: !s.current }))}
            placeholder="Enter current password" autoComplete="current-password" />

          <div className="pf-field-group">
            <PasswordField id="pw-new" label="New password" value={form.next} onChange={set('next')}
              show={show.next} onToggle={() => setShow((s) => ({ ...s, next: !s.next }))}
              onFocus={() => setNewFocus(true)} onBlur={() => setNewFocus(false)}
              placeholder="Enter new password" autoComplete="new-password" />
            {showRules && <>
            <div className="pf-meter" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <span key={i} className={i < score ? 'is-on' : ''} />)}
            </div>
            <ul className="pf-rules" aria-label="Password requirements">
              {rules.map((rule) => (
                <li key={rule.text} className={rule.ok ? 'is-ok' : ''}>
                  <span className="pf-rules__dot" aria-hidden="true">
                    {rule.ok && <Icon name="checkBold" size={10} />}
                  </span>
                  {rule.text}
                </li>
              ))}
            </ul>
            </>}
          </div>

          <PasswordField id="pw-confirm" label="Confirm new password" value={form.confirm} onChange={set('confirm')}
            placeholder="Re-enter new password" autoComplete="new-password" />

          <label className="pf-check">
            <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
            Log me out of other devices
          </label>

          {err && <p className="pf-msg" role="alert">{err}</p>}
          {ok && <p className="pf-msg pf-msg--ok" role="status">{ok}</p>}

          {pwDirty && (
            <div className="pf-actions">
              <button type="button" className="pf-btn pf-btn--ghost" onClick={discard}>Discard</button>
              <button type="submit" className="pf-btn pf-btn--primary" disabled={busy}>Update Password</button>
            </div>
          )}
        </form>

        <div className="pf-side">
          <section className="pf-card pf-danger">
            <h2 className="pf-card__title">
              <Icon name="warning" size={18} />
              Delete Account
            </h2>
            <p className="pf-muted">Permanently delete your account along with your order history, favorites and reviews. This action can’t be undone.</p>
            <button type="button" className="pf-btn pf-btn--dangerline" onClick={() => setDeleteOpen(true)}>Delete my account</button>
          </section>
        </div>
      </div>
      {deleteOpen && <DeleteDialog onClose={() => setDeleteOpen(false)} onConfirm={remove} />}
    </>
  )
}

/* ---------- Page ---------- */

export default function Profile() {
  const auth = useAuth()
  const user = auth.user || PREVIEW_USER
  const { updateUser, logout } = auth
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [favorites, setFavorites] = useState(FAVORITES)
  const [pending, setPending] = useState(PENDING_REVIEWS)
  const [past, setPast] = useState(PAST_REVIEWS)

  // if (!auth.user) return <Navigate to="/login" replace />   // re-enable once login works
  if (user.role === 'Vendor') return <Navigate to="/dashboard" replace />

  const view = params.get('view')
  const open = (v) => setParams({ view: v })
  const close = () => setParams({})
  const leave = () => { logout(); navigate('/') }

  const views = {
    edit: <EditProfile user={user} updateUser={updateUser} onBack={close} />,
    settings: <AccountSettings onBack={close} onDeleted={leave} changePassword={auth.changePassword} deleteAccount={auth.deleteAccount} />,
    orders: <Orders onReorder={(id) => navigate(`/vendor/${id}`)} />,
    favorites: <Favorites items={favorites} onRemove={(id) => setFavorites((l) => l.filter((v) => v.id !== id))} />,
    reviews: <Reviews pending={pending} past={past} setPending={setPending} setPast={setPast} />,
  }

  return (
    <div className="pf">
      {/* No top bar on the focused pages (Edit Profile, Account Settings): they have their own Back link */}
      {view !== 'edit' && view !== 'settings' && (
        <Header user={user} view={view} onOpen={open} onProfile={close} onGo={(to) => navigate(to)} />
      )}
      <div className="pf-page">
        {views[view] || <Overview user={user} onEdit={() => open('edit')} onSettings={() => open('settings')} onLogout={leave} />}
      </div>
    </div>
  )
}