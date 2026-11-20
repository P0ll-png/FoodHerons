import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { useVendors } from '../context/VendorContext'
import { supabase } from '../lib/supabase'
import { transitionOrder } from '../lib/api'
import './Admin.css'

// Nav tabs
const TABS = [
  { key: 'vendors', label: 'Vendors', icon: 'home', sub: 'Approve stores, assign owners, and edit store info.' },
  { key: 'reviews', label: 'Reviews', icon: 'star', sub: 'Moderate student reviews. Delete only, never edit.' },
  {
    key: 'orders',
    label: 'Orders',
    icon: 'cart',
    sub: "Read-only, except GCash payment verification. Verify a submitted payment to send the order into the vendor's queue.",
  },
]

// Formatters
const PESO = (n) =>
  '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Peso amount with icon
const AdminPeso = ({ value }) => (
  <span className="admin-price">
    <Icon name="peso" className="admin-price__icon" />
    <span className="admin-price__num">
      {Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  </span>
)

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

// Short date, no year
const fmtShort = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Avatar initials
const initials = (name) =>
  (name || '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

// Readable status text
const statusLabel = (s) => {
  const t = String(s || '').replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// PH phone: 10 local digits
const phoneDigits = (raw) => {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.startsWith('63') && d.length > 10) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}
const fmtPhone = (d) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ')
// Time input format
const hhmm = (s) => String(s || '').slice(0, 5)

// Orders per page
const ORDERS_PAGE_SIZE = 8

// Editable store fields
const EMPTY_STORE = {
  name: '',
  category: '',
  location_area: '',
  hours_open: '',
  hours_close: '',
  phone: '',
  logo_url: '',
  cover_url: '',
}

// Reject reasons
const VENDOR_REJECT_REASONS = ['Incomplete details', 'Does not meet requirements', 'Duplicate store', 'Other']
const PAYMENT_REJECT_REASONS = ['Amount does not match', 'Reference number does not match', 'Screenshot is unclear', 'Other']

// Shared confirm pop-up
function ConfirmModal({ title, text, select, children, confirmLabel, tone = 'primary', onConfirm, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="admin-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
        <h2 id="admin-modal-title" className="admin-modal__title">{title}</h2>
        {text && <p className="admin-modal__text">{text}</p>}
        {children}
        {select && (
          <label className="admin-modal__field">
            <span>{select.label}</span>
            <select
              className="admin-modal__select"
              value={select.value}
              onChange={(e) => select.onChange(e.target.value)}
            >
              {select.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className="admin-modal__actions">
          <button type="button" className="admin-modal__btn" onClick={onClose}>Close</button>
          {onConfirm && (
            <button
              type="button"
              className={`admin-modal__btn admin-modal__btn--${tone}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Admin page root
export default function Admin() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { categories, locationAreas, categoryName } = useVendors()

  // State
  const [tab, setTab] = useState('vendors')

  const [vendors, setVendors] = useState([])
  const [profiles, setProfiles] = useState([])
  const [reviews, setReviews] = useState([])
  const [orders, setOrders] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Load data (silent = no loading screen)
  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')
    const [vRes, pRes, rRes, oRes] = await Promise.all([
      supabase.from('vendors').select('*').order('name'),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
      supabase
        .from('reviews')
        .select('id, vendor_id, author_name, ordered_summary, rating, text, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('id, code, vendor_id, status, pickup_name, subtotal, total, placed_at, gcash_reference, payment_screenshot_path')
        .order('placed_at', { ascending: false }),
    ])
    const firstErr = vRes.error || pRes.error || rRes.error || oRes.error
    if (firstErr) {
      console.error('Admin load failed:', firstErr)
      setError(firstErr.message || 'Could not load admin data.')
    }
    setVendors(vRes.data || [])
    setProfiles(pRes.data || [])
    setReviews(rRes.data || [])
    setOrders(oRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Reload after an action
  const refresh = useCallback(() => loadAll(), [loadAll])

  const vendorName = useCallback(
    (id) => vendors.find((v) => v.id === id)?.name ?? id,
    [vendors],
  )

  // Sign out, then leave the admin area
  const handleLogout = async () => {
    try {
      await logout()
    } catch (e) {
      setError(e.message || 'Could not log out.')
      return
    }
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="container admin">
        <p className="admin-state">Loading admin console…</p>
      </div>
    )
  }

  // Header info
  const activeTab = TABS.find((x) => x.key === tab)
  const who = user?.full_name || user?.email || 'Admin'

  return (
    <div className="admin">
      {/* Top bar */}
      <header className="admin-top">
        <Link to="/" className="admin-top__brand" aria-label="Food Herons home">
          <span className="admin-top__logo" aria-hidden="true">
            <img src="/images/logo.jpg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          </span>
          <span className="admin-top__name">Food Herons</span>
        </Link>

        {/* Tab nav */}
        <nav className="admin-nav" role="tablist" aria-label="Admin sections">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              className={`admin-nav__item${tab === x.key ? ' is-active' : ''}`}
              onClick={() => setTab(x.key)}
            >
              <Icon name={x.icon} size={16} />
              <span className="admin-nav__label">{x.label}</span>
            </button>
          ))}
        </nav>

        {/* Refresh + avatar */}
        <div className="admin-top__tools">
          <button
            type="button"
            className="admin-iconbtn"
            onClick={refresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <Icon name="history" size={16} />
          </button>
          <button
            type="button"
            className="admin-iconbtn"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
          >
            <Icon name="logout" size={16} />
          </button>
          <span className="admin-avatar" title={`Signed in as ${who}`}>
            {initials(who) || 'AD'}
          </span>
        </div>
      </header>

      {/* Page title */}
      <main className="container admin-main">
        <div className="admin-head">
          <h1 className="admin-head__title">{activeTab.label}</h1>
          <p className="admin-head__sub">{activeTab.sub}</p>
        </div>

        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}

      {/* Active panel */}
      {tab === 'vendors' && (
        <VendorsPanel
          vendors={vendors}
          profiles={profiles}
          categories={categories}
          locationAreas={locationAreas}
          categoryName={categoryName}
          onChanged={refresh}
          setError={setError}
        />
      )}

      {tab === 'reviews' && (
        <ReviewsPanel
          reviews={reviews}
          vendorName={vendorName}
          onChanged={refresh}
          setError={setError}
        />
      )}

      {tab === 'orders' && (
        <OrdersPanel orders={orders} vendorName={vendorName} onChanged={refresh} setError={setError} />
      )}
      </main>
    </div>
  )
}

// Vendor status filters
const APPROVAL_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
]

// Vendors tab
function VendorsPanel({ vendors, profiles, categories, locationAreas, categoryName, onChanged, setError }) {
  const [editingId, setEditingId] = useState(null)
  // Filters + paging state
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [menuId, setMenuId] = useState(null)

  useEffect(() => {
    if (!menuId) return
    const onDoc = (e) => {
      if (!e.target.closest?.('.admin-vmenu')) setMenuId(null)
    }
    const onKey = (e) => e.key === 'Escape' && setMenuId(null)
    const close = () => setMenuId(null)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuId])

  // Filtered list
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vendors.filter((v) => {
      if (statusFilter !== 'all' && (v.approval_status || 'pending') !== statusFilter) return false
      if (!q) return true
      // Derived values
      const owner = profiles.find((p) => p.id === v.owner_id)
      return [v.name, owner?.full_name, owner?.email].some((s) => String(s || '').toLowerCase().includes(q))
    })
  }, [vendors, profiles, statusFilter, query])

  // Count by status
  const countBy = (key) => vendors.filter((v) => (v.approval_status || 'pending') === key).length
  const pendingCount = countBy('pending')

  if (!vendors.length) {
    return <p className="admin-state">No vendors yet.</p>
  }

  return (
    <>
      {/* Stat cards */}
      <div className="admin-stats">
        {[
          { key: 'all', label: 'Total vendors', value: vendors.length, sub: 'On the platform', featured: true },
          { key: 'pending', label: 'Pending', value: countBy('pending'), sub: 'Waiting for approval' },
          { key: 'approved', label: 'Approved', value: countBy('approved'), sub: 'Live and ordering' },
          { key: 'suspended', label: 'Suspended', value: countBy('suspended'), sub: 'Hidden from students' },
        ].map((st) => (
          <div key={st.key} className={`admin-stat${st.featured ? ' admin-stat--featured' : ''}`}>
            <span className="admin-stat__label">{st.label}</span>
            <span className="admin-stat__value">{st.value}</span>
            <span className="admin-stat__sub">{st.sub}</span>
          </div>
        ))}
      </div>

      {/* Pending banner */}
      {pendingCount > 0 && (
        <div className="admin-banner" role="status">
          <span>
            <strong>{pendingCount}</strong> {pendingCount === 1 ? 'store is' : 'stores are'} waiting for approval.
          </span>
          <button type="button" className="admin-link-btn" onClick={() => setStatusFilter('pending')}>
            Review now
          </button>
        </div>
      )}

      {/* Filters + search */}
      <div className="admin-toolbar">
        <div className="admin-filter" role="group" aria-label="Filter vendors by approval status">
          {APPROVAL_FILTERS.map((f) => {
            const count = f.key === 'all' ? vendors.length : countBy(f.key)
            return (
              <button
                key={f.key}
                type="button"
                className={`chip${statusFilter === f.key ? ' chip--active' : ''}`}
                onClick={() => setStatusFilter(f.key)}
                aria-pressed={statusFilter === f.key}
              >
                {f.label} <span className="admin-filter__count">{count}</span>
              </button>
            )
          })}
        </div>
        <label className="admin-search">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Search vendors</span>
          <input
            className="admin-search__input"
            type="search"
            placeholder="Search store or owner"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {/* Vendor table */}
      {shown.length ? (
        <div className="admin-scroll">
        <div className="admin-vtable" role="table" aria-label="Vendors">
          <div className="admin-vtable__head" role="row">
            <span role="columnheader">Store</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Owner</span>
            <span role="columnheader">Pre-order</span>
            <span role="columnheader" className="admin-vtable__actions-h">Actions</span>
          </div>
          {shown.map((v) => (
            <VendorRow
              key={v.id}
              vendor={v}
              profiles={profiles}
              categories={categories}
              locationAreas={locationAreas}
              categoryName={categoryName}
              editing={editingId === v.id}
              onEdit={() => setEditingId(v.id)}
              onDone={() => setEditingId(null)}
              menuOpen={menuId === v.id}
              onMenu={() => setMenuId((cur) => (cur === v.id ? null : v.id))}
              closeMenu={() => setMenuId(null)}
              onChanged={onChanged}
              setError={setError}
            />
          ))}
        </div>
        </div>
      ) : (
        <p className="admin-state admin-empty">No vendors with this status.</p>
      )}
    </>
  )
}

// Open now? (handles overnight hours)
function isOpenNow(open, close) {
  if (!open || !close) return false
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  const toMin = (s) => {
    const [h, m] = String(s).split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const o = toMin(open)
  const c = toMin(close)
  if (o === c) return false
  return o < c ? mins >= o && mins < c : mins >= o || mins < c
}

// Time picker input
function TimeField({ value, onChange, label }) {
  const ref = useRef(null)
  const openPicker = () => {
    const el = ref.current
    if (!el) return
    el.focus()
    try {
      el.showPicker?.()
    } catch {
    }
  }
  return (
    <span className="admin-time">
      <input
        ref={ref}
        className="admin-modal__input admin-time__input"
        type="time"
        value={value}
        onChange={onChange}
        aria-label={label}
      />
      <button type="button" className="admin-time__btn" onClick={openPicker} aria-label={`Pick ${label.toLowerCase()} time`}>
        <Icon name="clockOutline" size={20} />
      </button>
    </span>
  )
}

// Edit store form pop-up
function EditStoreModal({ vendorName, store, field, onPhone, phoneError, categories, locationAreas, busy, onSubmit, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="admin-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="admin-modal admin-modal--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-edit-title"
        onSubmit={onSubmit}
      >
        <h2 id="admin-edit-title" className="admin-modal__title">Edit store</h2>
        <p className="admin-modal__text">Update the details students see for {vendorName}.</p>

        <div className="admin-modal__grid">
          <label className="admin-modal__field">
            <span>Store name</span>
            <input className="admin-modal__input" value={store.name} onChange={field('name')} placeholder="e.g. Ate Len Noodle House" required />
          </label>

          <label className="admin-modal__field">
            <span>Category</span>
            <select className="admin-modal__select" value={store.category} onChange={field('category')}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label className="admin-modal__field">
            <span>Location area</span>
            <select className="admin-modal__select" value={store.location_area} onChange={field('location_area')}>
              {locationAreas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>

          <label className="admin-modal__field">
            <span>Contact number</span>
            <span className={`admin-phone${phoneError ? ' has-error' : ''}`}>
              <span className="admin-phone__prefix">+63</span>
              <input
                className="admin-phone__input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="912 345 6789"
                maxLength={12}
                value={fmtPhone(store.phone)}
                onChange={onPhone}
                aria-invalid={!!phoneError}
              />
            </span>
            {phoneError && <small className="admin-modal__error" role="alert">{phoneError}</small>}
          </label>

          <label className="admin-modal__field">
            <span>Opens</span>
            <TimeField label="Opens" value={store.hours_open} onChange={field('hours_open')} />
          </label>

          <label className="admin-modal__field">
            <span>Closes</span>
            <TimeField label="Closes" value={store.hours_close} onChange={field('hours_close')} />
          </label>

          <label className="admin-modal__field admin-modal__field--wide">
            <span>Logo URL</span>
            <input className="admin-modal__input" value={store.logo_url} onChange={field('logo_url')} placeholder="https://example.com/logo.png" />
          </label>

          <label className="admin-modal__field admin-modal__field--wide">
            <span>Cover URL</span>
            <input className="admin-modal__input" value={store.cover_url} onChange={field('cover_url')} placeholder="https://example.com/cover.jpg" />
          </label>
        </div>

        <div className="admin-modal__actions">
          <button type="button" className="admin-modal__btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="admin-modal__btn admin-modal__btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save store'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

// One vendor row
function VendorRow({
  vendor,
  profiles,
  categories,
  locationAreas,
  categoryName,
  editing,
  onEdit,
  onDone,
  menuOpen,
  onMenu,
  closeMenu,
  onChanged,
  setError,
}) {
  // Row state
  const [busy, setBusy] = useState(false)
  const [ownerChoice, setOwnerChoice] = useState('')
  const [store, setStore] = useState(EMPTY_STORE)
  const [dialog, setDialog] = useState(null)
  const [rejectReason, setRejectReason] = useState(VENDOR_REJECT_REASONS[0])
  const [phoneError, setPhoneError] = useState('')
  const menuBtnRef = useRef(null)
  const [menuPos, setMenuPos] = useState(null)
  // Actions menu
  const toggleMenu = () => {
    const r = menuBtnRef.current?.getBoundingClientRect()
    if (r) {
      const right = Math.max(8, window.innerWidth - r.right)
      setMenuPos(
        r.bottom + 170 > window.innerHeight
          ? { top: 'auto', bottom: window.innerHeight - r.top + 8, right }
          : { top: r.bottom + 8, bottom: 'auto', right },
      )
    }
    onMenu()
  }

  useEffect(() => {
    if (!editing) return
    setPhoneError('')
    setStore({
      name: vendor.name ?? '',
      category: vendor.category ?? '',
      location_area: vendor.location_area ?? '',
      hours_open: hhmm(vendor.hours_open),
      hours_close: hhmm(vendor.hours_close),
      phone: phoneDigits(vendor.phone),
      logo_url: vendor.logo_url ?? '',
      cover_url: vendor.cover_url ?? '',
    })
  }, [editing, vendor])

  const owner = profiles.find((p) => p.id === vendor.owner_id)
  const open = isOpenNow(vendor.hours_open, vendor.hours_close)
  const status = vendor.approval_status || 'pending'
  const inactive = status === 'suspended' || status === 'rejected'
  const locationName = locationAreas?.find((a) => a.id === vendor.location_area)?.name ?? vendor.location_area
  const availability =
    status === 'suspended' ? 'Hidden from students' : status === 'rejected' ? 'Not listed' : open ? 'Open now' : 'Closed'

  // Run action, then refresh
  const run = async (fn) => {
    setBusy(true)
    setError('')
    const { error } = await fn()
    if (error) {
      console.error('Admin vendor write failed:', error)
      setError(error.message || 'Update failed.')
      setBusy(false)
      return false
    }
    await onChanged()
    setBusy(false)
    return true
  }

  // Assign owner
  const claimOwner = async () => {
    if (!ownerChoice) return
    const ok = await run(() =>
      supabase.from('vendors').update({ owner_id: ownerChoice }).eq('id', vendor.id),
    )
    if (ok) {
      setOwnerChoice('')
    }
  }

  const openClaim = () => {
    closeMenu()
    setOwnerChoice(vendor.owner_id || profiles[0]?.id || '')
    setDialog('claim')
  }
  const openReject = () => {
    setRejectReason(VENDOR_REJECT_REASONS[0])
    setDialog('reject')
  }

  // Pre-order switch
  const togglePreorder = () =>
    run(() =>
      supabase.from('vendors').update({ preorder_enabled: !vendor.preorder_enabled }).eq('id', vendor.id),
    )

  // Approve / reject / suspend
  const setApproval = (next) =>
    run(() => supabase.from('vendors').update({ approval_status: next }).eq('id', vendor.id))

  // Save store info
  const saveStore = async (e) => {
    e.preventDefault()
    if (store.phone && !/^9\d{9}$/.test(store.phone)) {
      setPhoneError('Enter a PH mobile number: 10 digits starting with 9 (e.g. 912 345 6789).')
      return
    }
    const patch = {
      name: store.name,
      category: store.category,
      location_area: store.location_area,
      hours_open: store.hours_open,
      hours_close: store.hours_close,
      phone: store.phone ? `+63${store.phone}` : null,
      logo_url: store.logo_url || null,
      cover_url: store.cover_url || null,
    }
    const ok = await run(() =>
      supabase.from('vendors').update(patch).eq('id', vendor.id),
    )
    if (ok) onDone()
  }

  // Form field helper
  const field = (key) => (e) => setStore((s) => ({ ...s, [key]: e.target.value }))
  // Phone input
  const onPhone = (e) => {
    setPhoneError('')
    setStore((s) => ({ ...s, phone: phoneDigits(e.target.value) }))
  }

  return (
    <div className={`admin-vtable__row${inactive ? ' is-dim' : ''}`} role="row">
      <div role="cell" data-label="Store" className="admin-vstore">
        <strong className="admin-vstore__name">{vendor.name}</strong>
        <span className="admin-vstore__sub">
          {categoryName(vendor.category)}
          {locationName ? ` · ${locationName}` : ''} · {availability}
        </span>
      </div>

      <div role="cell" data-label="Status">
        <span className={`admin-vpill admin-vpill--${status}`}>{statusLabel(status)}</span>
      </div>

      <div role="cell" data-label="Owner" className="admin-vowner">
        {owner ? (
          <>
            <strong className="admin-vowner__name">{owner.full_name || owner.email}</strong>
            {owner.full_name && <span className="admin-vowner__email">{owner.email}</span>}
          </>
        ) : (
          <>
            <span className="admin-vowner__none">Not assigned</span>
            <button type="button" className="admin-vowner__assign" onClick={openClaim} disabled={busy}>
              Assign owner
            </button>
          </>
        )}
      </div>

      <div role="cell" data-label="Pre-order">
        <button
          type="button"
          role="switch"
          aria-checked={!!vendor.preorder_enabled}
          aria-label={`Pre-order for ${vendor.name}`}
          className={`admin-switch${vendor.preorder_enabled ? ' is-on' : ''}`}
          onClick={togglePreorder}
          disabled={busy || inactive}
        >
          <span className="admin-switch__knob" />
        </button>
      </div>

      <div role="cell" data-label="Actions" className="admin-vactions">
        {status === 'pending' && (
          <>
            <button
              type="button"
              className="btn btn--primary admin-btn-sm"
              onClick={() => setDialog('approve')}
              disabled={busy}
            >
              Approve
            </button>
            <button
              type="button"
              className="admin-vactions__reject"
              onClick={openReject}
              disabled={busy}
            >
              Reject
            </button>
          </>
        )}

        {status === 'approved' && (
          <button type="button" className="btn btn--ghost admin-btn-sm" onClick={onEdit} disabled={busy}>
            Edit store
          </button>
        )}

        {inactive && (
          <button
            type="button"
            className="btn btn--primary admin-btn-sm"
            onClick={() => setApproval('approved')}
            disabled={busy}
          >
            Re-activate
          </button>
        )}

        <div className="admin-vmenu">
          <button
            type="button"
            ref={menuBtnRef}
            className="admin-vmenu__btn"
            onClick={toggleMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`More actions for ${vendor.name}`}
            disabled={busy}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menuOpen && (
            <div className="admin-vmenu__list" role="menu" style={menuPos || undefined}>
              {status !== 'approved' && (
                <button
                  type="button"
                  role="menuitem"
                  className="admin-vmenu__item"
                  onClick={() => {
                    closeMenu()
                    onEdit()
                  }}
                >
                  Edit store
                </button>
              )}
              <button type="button" role="menuitem" className="admin-vmenu__item" onClick={openClaim}>
                {owner ? 'Change owner' : 'Assign owner'}
              </button>
              {status === 'approved' && (
                <>
                  <hr className="admin-vmenu__sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="admin-vmenu__item admin-vmenu__item--danger"
                    onClick={() => {
                      closeMenu()
                      setDialog('suspend')
                    }}
                  >
                    Suspend store
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit pop-up */}
      {editing && (
        <EditStoreModal
          vendorName={vendor.name}
          store={store}
          field={field}
          onPhone={onPhone}
          phoneError={phoneError}
          categories={categories}
          locationAreas={locationAreas}
          busy={busy}
          onSubmit={saveStore}
          onClose={onDone}
        />
      )}

      {/* Confirm pop-ups */}
      {dialog === 'claim' && (
        <ConfirmModal
          title={`${owner ? 'Change' : 'Assign'} owner for ${vendor.name}`}
          text="Choose the account that owns this store."
          select={{
            label: 'Owner account',
            value: ownerChoice,
            onChange: setOwnerChoice,
            options: profiles.map((p) => ({ value: p.id, label: p.full_name || p.email })),
          }}
          confirmLabel="Assign owner"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            claimOwner()
          }}
        />
      )}
      {dialog === 'approve' && (
        <ConfirmModal
          title={`Approve ${vendor.name}?`}
          text="The store goes live and students can start ordering."
          confirmLabel="Approve"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            setApproval('approved')
          }}
        />
      )}
      {dialog === 'reject' && (
        <ConfirmModal
          title={`Reject ${vendor.name}?`}
          text="The owner will be notified."
          select={{
            label: 'Reason',
            value: rejectReason,
            onChange: setRejectReason,
            options: VENDOR_REJECT_REASONS.map((r) => ({ value: r, label: r })),
          }}
          tone="danger"
          confirmLabel="Reject"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            setApproval('rejected')
          }}
        />
      )}
      {dialog === 'suspend' && (
        <ConfirmModal
          title={`Suspend ${vendor.name}?`}
          text="The store is hidden from students until you restore it."
          tone="danger"
          confirmLabel="Suspend"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            setApproval('suspended')
          }}
        />
      )}
    </div>
  )
}

// Reviews tab
function ReviewsPanel({ reviews, vendorName, onChanged, setError }) {
  const [busyId, setBusyId] = useState(null)
  const [ratingFilter, setRatingFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [confirmReview, setConfirmReview] = useState(null)

  // Rating filters
  const REVIEW_FILTERS = [
    { key: 'all', label: 'All', test: () => true },
    { key: 'low', label: 'Low ratings', test: (r) => r.rating <= 2 },
    { key: 'high', label: 'High ratings', test: (r) => r.rating >= 4 },
  ]

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const test = REVIEW_FILTERS.find((f) => f.key === ratingFilter).test
    return reviews.filter(
      (r) =>
        test(r) &&
        (!q || [r.author_name, r.text, r.ordered_summary].some((s) => String(s || '').toLowerCase().includes(q))),
    )
  }, [reviews, ratingFilter, query])

  if (!reviews.length) {
    return <p className="admin-state">No reviews to moderate.</p>
  }

  // Delete review
  const remove = async (id) => {
    setBusyId(id)
    setError('')
    const { error } = await supabase.from('reviews').delete().eq('id', id)
    if (error) {
      console.error('Admin review delete failed:', error)
      setError(error.message || 'Delete failed.')
      setBusyId(null)
      return
    }
    await onChanged()
    setBusyId(null)
  }

  return (
    <>
      <div className="admin-toolbar">
        <div className="admin-filter" role="group" aria-label="Filter reviews by rating">
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip${ratingFilter === f.key ? ' chip--active' : ''}`}
              onClick={() => setRatingFilter(f.key)}
              aria-pressed={ratingFilter === f.key}
            >
              {f.label} <span className="admin-filter__count">{reviews.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <label className="admin-search">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Search reviews</span>
          <input
            className="admin-search__input"
            type="search"
            placeholder="Search author or review text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {!shown.length && <p className="admin-state admin-empty">No reviews match this filter.</p>}
    {/* Review cards */}
    <ul className="admin-list">
      {shown.map((r) => (
        <li key={r.id} className="admin-review card">
          <div className="admin-review__main">
            <div className="admin-review__head">
              <strong className="admin-review__vendor">{vendorName(r.vendor_id)}</strong>
              <span className="admin-review__rating">
                <Icon name="starSolid" size={14} /> {r.rating}
              </span>
              <span className="admin-review__date">{fmtShort(r.created_at)}</span>
            </div>
            <p className="admin-review__author">{r.author_name}</p>
            {r.ordered_summary && <p className="admin-review__ordered">Ordered: {r.ordered_summary}</p>}
            {r.text && <p className="admin-review__text">{r.text}</p>}
          </div>
          <button
            type="button"
            className="btn btn--ghost admin-btn-sm admin-danger"
            onClick={() => setConfirmReview(r)}
            disabled={busyId === r.id}
          >
            {busyId === r.id ? 'Deleting…' : 'Delete'}
          </button>
        </li>
      ))}
    </ul>

    {/* Delete confirm */}
    {confirmReview && (
      <ConfirmModal
        title={`Delete ${confirmReview.author_name}'s review?`}
        text={`This review of ${vendorName(confirmReview.vendor_id)} is removed for everyone. This cannot be undone.`}
        tone="danger"
        confirmLabel="Delete review"
        onClose={() => setConfirmReview(null)}
        onConfirm={() => {
          const id = confirmReview.id
          setConfirmReview(null)
          remove(id)
        }}
      />
    )}
    </>
  )
}

// Orders tab
function OrdersPanel({ orders, vendorName, onChanged, setError }) {
  const [busyId, setBusyId] = useState(null)

  const [statusF, setStatusF] = useState('all')
  const [vendorF, setVendorF] = useState('all')
  const [rangeF, setRangeF] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null)
  const [payReason, setPayReason] = useState(PAYMENT_REJECT_REASONS[0])

  // Vendor filter options
  const vendorIds = useMemo(() => [...new Set(orders.map((o) => o.vendor_id))], [orders])

  // Apply filters
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const since =
      rangeF === 'today' ? startOfToday : rangeF === '7d' ? new Date(now - 7 * 864e5) : rangeF === '30d' ? new Date(now - 30 * 864e5) : null
    return orders.filter((o) => {
      if (statusF !== 'all' && o.status !== statusF) return false
      if (vendorF !== 'all' && o.vendor_id !== vendorF) return false
      if (since && new Date(o.placed_at) < since) return false
      if (!q) return true
      return [o.code, o.pickup_name, o.gcash_reference].some((s) => String(s || '').toLowerCase().includes(q))
    })
  }, [orders, statusF, vendorF, rangeF, query])

  // Paging
  const pageCount = Math.max(1, Math.ceil(filtered.length / ORDERS_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * ORDERS_PAGE_SIZE, safePage * ORDERS_PAGE_SIZE)
  const onFilter = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }
  // Clear filters
  const filtersActive = statusF !== 'all' || vendorF !== 'all' || rangeF !== 'all' || query !== ''
  const clearFilters = () => {
    setStatusF('all'); setVendorF('all'); setRangeF('all'); setQuery(''); setPage(1)
  }

  if (!orders.length) {
    return <p className="admin-state">No orders yet.</p>
  }

  // Order action wrapper
  const run = async (uuid, fn) => {
    setBusyId(uuid)
    setError('')
    try {
      await fn()
      await onChanged()
    } catch (err) {
      console.error('Admin order transition failed:', err)
      setError(
        err?.code === 'ILLEGAL_TRANSITION'
          ? 'That order has already moved on — refresh to see its current status.'
          : err?.message || 'Could not update the order.',
      )
    } finally {
      setBusyId(null)
    }
  }

  // Verify / reject payment
  const verify = (uuid) => run(uuid, () => transitionOrder(uuid, { to: 'pending' }))

  const reject = (uuid, reason) =>
    run(uuid, () => transitionOrder(uuid, { to: 'awaiting_payment', reason }))

  // Open payment proof
  const openVerify = async (o) => {
    const path = o.payment_screenshot_path
    setDialog({ kind: 'verify', order: o, url: null, loading: !!path })
    if (!path) return
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300)
    setDialog((d) =>
      d && d.kind === 'verify' && d.order.id === o.id ? { ...d, url: error ? null : data?.signedUrl ?? null, loading: false } : d,
    )
  }

  return (
    <div className="admin-orders">

      {/* Filters */}
      <div className="admin-orders__filters">
        <label className="admin-search">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Search orders</span>
          <input
            className="admin-search__input"
            type="search"
            placeholder="Search code, name or GCash ref"
            value={query}
            onChange={onFilter(setQuery)}
          />
        </label>
        <select
          className="select admin-filter-select"
          aria-label="Status"
          value={statusF}
          onChange={onFilter(setStatusF)}
        >
          <option value="all">All statuses</option>
          <option value="payment_submitted">Needs verification</option>
          <option value="pending">Pending</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="select admin-filter-select"
          aria-label="Vendor"
          value={vendorF}
          onChange={onFilter(setVendorF)}
        >
          <option value="all">All vendors</option>
          {vendorIds.map((id) => (
            <option key={id} value={id}>
              {vendorName(id)}
            </option>
          ))}
        </select>
        <select
          className="select admin-filter-select"
          aria-label="Date range"
          value={rangeF}
          onChange={onFilter(setRangeF)}
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <button
          type="button"
          className="admin-link-btn"
          onClick={clearFilters}
          disabled={!filtersActive}
        >
          Clear filters
        </button>
      </div>
      {/* Result count + sort */}
      <div className="admin-orders__meta">
        <span>
          Showing {rows.length} of {filtered.length} orders
        </span>
        <span>Sorted by Placed, newest first</span>
      </div>

      <div className="admin-scroll">
      {/* Orders table */}
      <div className="admin-table admin-table--orders" role="table" aria-label="All orders">
        <div className="admin-table__head" role="row">
          <span role="columnheader">Code</span>
          <span role="columnheader">Vendor</span>
          <span role="columnheader">Pickup</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Total</span>
          <span role="columnheader" className="admin-table__sorted" aria-sort="descending">Placed ↓</span>
          <span role="columnheader">Payment</span>
        </div>
        {!rows.length && <p className="admin-state admin-empty">No orders match these filters.</p>}
        {rows.map((o) => {
          const busy = busyId === o.id
          const isSubmitted = o.status === 'payment_submitted'
          return (
            <div className="admin-table__row" role="row" key={o.id}>
              <span role="cell" data-label="Code" className="admin-table__code">
                {o.code}
              </span>
              <span role="cell" data-label="Vendor">
                {vendorName(o.vendor_id)}
              </span>
              <span role="cell" data-label="Pickup">
                {o.pickup_name}
              </span>
              <span role="cell" data-label="Status">
                <span className={`admin-status admin-status--${o.status}`}>{statusLabel(o.status)}</span>
              </span>
              <span role="cell" data-label="Total">
                <AdminPeso value={o.total} />
              </span>
              <span role="cell" data-label="Placed">
                {fmtDate(o.placed_at)}
              </span>
              <span role="cell" data-label="Payment" className="admin-orders__pay">
                {isSubmitted ? (
                  <>
                    <span className="admin-orders__ref">
                      Ref: {o.gcash_reference || '—'}
                    </span>
                    <button
                      type="button"
                      className="btn btn--primary admin-btn-sm"
                      onClick={() => openVerify(o)}
                      disabled={busy}
                    >
                      Verify
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost admin-btn-sm admin-danger"
                      onClick={() => {
                        setPayReason(PAYMENT_REJECT_REASONS[0])
                        setDialog({ kind: 'reject', order: o })
                      }}
                      disabled={busy}
                    >
                      Reject
                    </button>
                  </>
                ) : (
                  <span className="admin-orders__dash">—</span>
                )}
              </span>
            </div>
          )
        })}
      </div>
      </div>

      {/* Pager */}
      <div className="admin-pager">
        <span>
          Page {safePage} of {pageCount}
        </span>
        <div className="admin-pager__btns">
          <button
            type="button"
            className="btn btn--ghost admin-btn-sm"
            onClick={() => setPage(safePage - 1)}
            disabled={safePage <= 1}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn btn--ghost admin-btn-sm"
            onClick={() => setPage(safePage + 1)}
            disabled={safePage >= pageCount}
          >
            Next
          </button>
        </div>
      </div>

      {/* Verify pop-up */}
      {dialog?.kind === 'verify' && (
        <ConfirmModal
          title="Verify this payment?"
          text={
            [
              dialog.order.code,
              vendorName(dialog.order.vendor_id),
              PESO(dialog.order.total),
              `GCash ref ${dialog.order.gcash_reference || '—'}`,
            ].join(' · ') + ". The order will go into the vendor's queue."
          }
          confirmLabel="Verify payment"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.order.id
            setDialog(null)
            verify(id)
          }}
        >
          <div className="admin-modal__proof">
            {dialog.loading ? (
              'Loading…'
            ) : dialog.url ? (
              <img src={dialog.url} alt="GCash payment screenshot" />
            ) : (
              'GCash screenshot placeholder'
            )}
          </div>
        </ConfirmModal>
      )}
      {/* Reject pop-up */}
      {dialog?.kind === 'reject' && (
        <ConfirmModal
          title="Reject this payment?"
          text={`${dialog.order.code} · ${PESO(dialog.order.total)}. The student will be told the payment was not accepted.`}
          select={{
            label: 'Reason',
            value: payReason,
            onChange: setPayReason,
            options: PAYMENT_REJECT_REASONS.map((r) => ({ value: r, label: r })),
          }}
          tone="danger"
          confirmLabel="Reject payment"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.order.id
            setDialog(null)
            reject(id, payReason)
          }}
        />
      )}
    </div>
  )
}