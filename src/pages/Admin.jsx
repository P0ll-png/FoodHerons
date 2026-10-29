import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { useVendors } from '../context/VendorContext'
import { supabase } from '../lib/supabase'
import './Admin.css'

/* ---------------------------------------------------------------------------
   Admin console (FEAT-004)
   Three panels, all direct-to-Supabase under the admin RLS policies:
     (a) Manage vendors  — claim owner, toggle pre-order, edit store info.
     (b) Moderate reviews — list + delete (never edits content).
     (c) All orders       — READ-ONLY (Phase C owns every order write).
   Never sends rating/review_count on a vendor update; never mutates an order.
   --------------------------------------------------------------------------- */

const TABS = [
  { key: 'vendors', label: 'Vendors' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'orders', label: 'Orders' },
]

const PESO = (n) =>
  '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

/* The columns Edit-store writes. rating/review_count/owner_id are NEVER here. */
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

export default function Admin() {
  const { user } = useAuth()
  const { categories, locationAreas, categoryName } = useVendors()

  const [tab, setTab] = useState('vendors')

  // Vendors come from a direct admin SELECT (not VendorContext) so the admin
  // list is independent of the owner-scoped currentVendorId wiring.
  const [vendors, setVendors] = useState([])
  const [profiles, setProfiles] = useState([])
  const [reviews, setReviews] = useState([])
  const [orders, setOrders] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
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
        .select('code, vendor_id, status, pickup_name, subtotal, total, placed_at')
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

  // id -> vendor name, for the reviews/orders panels.
  const vendorName = useCallback(
    (id) => vendors.find((v) => v.id === id)?.name ?? id,
    [vendors],
  )

  if (loading) {
    return (
      <div className="container admin">
        <p className="admin-state">Loading admin console…</p>
      </div>
    )
  }

  return (
    <div className="container admin">
      <header className="admin-head">
        <div>
          <h1 className="admin-head__title">Admin console</h1>
          <p className="admin-head__sub">Signed in as {user?.full_name || user?.email}</p>
        </div>
        <button type="button" className="btn btn--ghost admin-refresh" onClick={loadAll}>
          <Icon name="history" size={16} /> Refresh
        </button>
      </header>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`admin-tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="admin-tab__count">
              {t.key === 'vendors' ? vendors.length : t.key === 'reviews' ? reviews.length : orders.length}
            </span>
          </button>
        ))}
      </nav>

      {tab === 'vendors' && (
        <VendorsPanel
          vendors={vendors}
          profiles={profiles}
          categories={categories}
          locationAreas={locationAreas}
          categoryName={categoryName}
          onChanged={loadAll}
          setError={setError}
        />
      )}

      {tab === 'reviews' && (
        <ReviewsPanel
          reviews={reviews}
          vendorName={vendorName}
          onChanged={loadAll}
          setError={setError}
        />
      )}

      {tab === 'orders' && <OrdersPanel orders={orders} vendorName={vendorName} />}
    </div>
  )
}

/* =========================================================================
   (a) Manage vendors
   ========================================================================= */
const APPROVAL_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
]

function VendorsPanel({ vendors, profiles, categories, locationAreas, categoryName, onChanged, setError }) {
  const [editingId, setEditingId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')

  const shown = useMemo(
    () =>
      statusFilter === 'all'
        ? vendors
        : vendors.filter((v) => (v.approval_status || 'pending') === statusFilter),
    [vendors, statusFilter],
  )

  if (!vendors.length) {
    return <p className="admin-state">No vendors yet.</p>
  }

  return (
    <>
      <div className="admin-filter" role="group" aria-label="Filter vendors by approval status">
        {APPROVAL_FILTERS.map((f) => {
          const count =
            f.key === 'all'
              ? vendors.length
              : vendors.filter((v) => (v.approval_status || 'pending') === f.key).length
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

      {shown.length ? (
        <ul className="admin-list">
          {shown.map((v) => (
            <VendorRow
              key={v.id}
              vendor={v}
              profiles={profiles}
              categories={categories}
              locationAreas={locationAreas}
              categoryName={categoryName}
              editing={editingId === v.id}
              onEdit={() => setEditingId((cur) => (cur === v.id ? null : v.id))}
              onDone={() => setEditingId(null)}
              onChanged={onChanged}
              setError={setError}
            />
          ))}
        </ul>
      ) : (
        <p className="admin-state">No vendors with this status.</p>
      )}
    </>
  )
}

// isOpenNow mirrors VendorContext's client-side open/closed derivation so the
// admin row can show the same badge without importing the whole vendor shape.
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

function VendorRow({
  vendor,
  profiles,
  categories,
  locationAreas,
  categoryName,
  editing,
  onEdit,
  onDone,
  onChanged,
  setError,
}) {
  const [busy, setBusy] = useState(false)
  const [ownerChoice, setOwnerChoice] = useState('')
  const [store, setStore] = useState(EMPTY_STORE)

  // Seed the edit form from the DB row whenever the panel opens for this vendor.
  useEffect(() => {
    if (!editing) return
    setStore({
      name: vendor.name ?? '',
      category: vendor.category ?? '',
      location_area: vendor.location_area ?? '',
      hours_open: vendor.hours_open ?? '',
      hours_close: vendor.hours_close ?? '',
      phone: vendor.phone ?? '',
      logo_url: vendor.logo_url ?? '',
      cover_url: vendor.cover_url ?? '',
    })
  }, [editing, vendor])

  const owner = profiles.find((p) => p.id === vendor.owner_id)
  const open = isOpenNow(vendor.hours_open, vendor.hours_close)
  const status = vendor.approval_status || 'pending'
  // Reuse existing badge tints; no new colors.
  const statusBadge =
    status === 'approved'
      ? 'badge--open'
      : status === 'pending'
      ? 'badge--preorder'
      : 'badge--closed'

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

  const claimOwner = async () => {
    if (!ownerChoice) return
    const ok = await run(() =>
      supabase.from('vendors').update({ owner_id: ownerChoice }).eq('id', vendor.id),
    )
    if (ok) setOwnerChoice('')
  }

  const togglePreorder = () =>
    run(() =>
      supabase.from('vendors').update({ preorder_enabled: !vendor.preorder_enabled }).eq('id', vendor.id),
    )

  // Approval transitions — admin-only, enforced server-side by
  // guard_vendor_columns + the vendors admin UPDATE RLS branch.
  const setApproval = (next) =>
    run(() => supabase.from('vendors').update({ approval_status: next }).eq('id', vendor.id))

  const saveStore = async (e) => {
    e.preventDefault()
    // Only the editable columns — NEVER rating/review_count, NEVER owner_id.
    const patch = {
      name: store.name,
      category: store.category,
      location_area: store.location_area,
      hours_open: store.hours_open,
      hours_close: store.hours_close,
      phone: store.phone || null,
      logo_url: store.logo_url || null,
      cover_url: store.cover_url || null,
    }
    const ok = await run(() =>
      // Parameterized by THIS row's id — not any currentVendorId.
      supabase.from('vendors').update(patch).eq('id', vendor.id),
    )
    if (ok) onDone()
  }

  const field = (key) => (e) => setStore((s) => ({ ...s, [key]: e.target.value }))

  return (
    <li className="admin-vrow card">
      <div className="admin-vrow__main">
        <div className="admin-vrow__head">
          <h3 className="admin-vrow__name">{vendor.name}</h3>
          {/* Reuse VendorCard's open/closed + pre-order badge styles (global). */}
          <span className={`badge ${open ? 'badge--open' : 'badge--closed'}`}>
            {open ? 'Open now' : 'Closed'}
          </span>
          {vendor.preorder_enabled && <span className="badge badge--preorder">Pre-order</span>}
          <span className={`badge ${statusBadge} admin-approval admin-approval--${status}`}>{status}</span>
          <span className="chip chip--active">{categoryName(vendor.category)}</span>
        </div>
        <p className="admin-vrow__owner">
          Owner:{' '}
          {owner ? (
            <strong>{owner.full_name || owner.email}</strong>
          ) : (
            <em>unassigned</em>
          )}
          {owner?.email && <span className="admin-vrow__email"> · {owner.email}</span>}
        </p>
      </div>

      <div className="admin-vrow__controls">
        <label className="admin-claim">
          <span className="visually-hidden">Assign owner for {vendor.name}</span>
          <select
            className="select admin-claim__select"
            value={ownerChoice}
            onChange={(e) => setOwnerChoice(e.target.value)}
            disabled={busy}
          >
            <option value="">Assign owner…</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.full_name || '(no name)') + ' · ' + p.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--ghost admin-btn-sm"
            onClick={claimOwner}
            disabled={busy || !ownerChoice}
          >
            Claim
          </button>
        </label>

        <button
          type="button"
          className="btn btn--ghost admin-btn-sm"
          onClick={togglePreorder}
          disabled={busy}
        >
          {vendor.preorder_enabled ? 'Disable pre-order' : 'Enable pre-order'}
        </button>

        {status === 'pending' && (
          <>
            <button
              type="button"
              className="btn btn--primary admin-btn-sm"
              onClick={() => setApproval('approved')}
              disabled={busy}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn btn--ghost admin-btn-sm admin-danger"
              onClick={() => setApproval('rejected')}
              disabled={busy}
            >
              Reject
            </button>
          </>
        )}

        {status === 'approved' && (
          <button
            type="button"
            className="btn btn--ghost admin-btn-sm admin-danger"
            onClick={() => setApproval('suspended')}
            disabled={busy}
          >
            Suspend
          </button>
        )}

        {(status === 'rejected' || status === 'suspended') && (
          <button
            type="button"
            className="btn btn--primary admin-btn-sm"
            onClick={() => setApproval('approved')}
            disabled={busy}
          >
            Re-activate
          </button>
        )}

        <button type="button" className="btn btn--ghost admin-btn-sm" onClick={onEdit} disabled={busy}>
          {editing ? 'Close' : 'Edit store'}
        </button>
      </div>

      {editing && (
        <form className="admin-edit" onSubmit={saveStore}>
          <div className="admin-edit__grid">
            <label className="admin-edit__field">
              <span>Name</span>
              <input className="input" value={store.name} onChange={field('name')} required />
            </label>

            <label className="admin-edit__field">
              <span>Category</span>
              <select className="select" value={store.category} onChange={field('category')}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-edit__field">
              <span>Location area</span>
              <select className="select" value={store.location_area} onChange={field('location_area')}>
                {locationAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-edit__field">
              <span>Phone</span>
              <input className="input" value={store.phone} onChange={field('phone')} />
            </label>

            <label className="admin-edit__field">
              <span>Opens</span>
              <input className="input" value={store.hours_open} onChange={field('hours_open')} placeholder="08:00" />
            </label>

            <label className="admin-edit__field">
              <span>Closes</span>
              <input className="input" value={store.hours_close} onChange={field('hours_close')} placeholder="20:00" />
            </label>

            <label className="admin-edit__field admin-edit__field--wide">
              <span>Logo URL</span>
              <input className="input" value={store.logo_url} onChange={field('logo_url')} />
            </label>

            <label className="admin-edit__field admin-edit__field--wide">
              <span>Cover URL</span>
              <input className="input" value={store.cover_url} onChange={field('cover_url')} />
            </label>
          </div>

          <div className="admin-edit__actions">
            <button type="submit" className="btn btn--primary admin-btn-sm" disabled={busy}>
              Save store
            </button>
            <button type="button" className="btn btn--ghost admin-btn-sm" onClick={onDone} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  )
}

/* =========================================================================
   (b) Moderate reviews
   ========================================================================= */
function ReviewsPanel({ reviews, vendorName, onChanged, setError }) {
  const [busyId, setBusyId] = useState(null)

  if (!reviews.length) {
    return <p className="admin-state">No reviews to moderate.</p>
  }

  const remove = async (id) => {
    setBusyId(id)
    setError('')
    // Admin DELETE policy. The reviews->vendor aggregate trigger self-corrects
    // the vendor's rating/review_count, so a re-fetch reflects the new totals.
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
    <ul className="admin-list">
      {reviews.map((r) => (
        <li key={r.id} className="admin-review card">
          <div className="admin-review__main">
            <div className="admin-review__head">
              <strong className="admin-review__vendor">{vendorName(r.vendor_id)}</strong>
              <span className="admin-review__rating">
                <Icon name="starSolid" size={14} /> {r.rating}
              </span>
              <span className="admin-review__date">{fmtDate(r.created_at)}</span>
            </div>
            <p className="admin-review__author">{r.author_name}</p>
            {r.ordered_summary && <p className="admin-review__ordered">Ordered: {r.ordered_summary}</p>}
            {r.text && <p className="admin-review__text">{r.text}</p>}
          </div>
          <button
            type="button"
            className="btn btn--ghost admin-btn-sm admin-danger"
            onClick={() => remove(r.id)}
            disabled={busyId === r.id}
          >
            {busyId === r.id ? 'Deleting…' : 'Delete'}
          </button>
        </li>
      ))}
    </ul>
  )
}

/* =========================================================================
   (c) All orders — READ ONLY (Phase C owns every order write)
   ========================================================================= */
function OrdersPanel({ orders, vendorName }) {
  const rows = useMemo(() => orders, [orders])

  if (!rows.length) {
    return <p className="admin-state">No orders yet.</p>
  }

  return (
    <div className="admin-orders">
      <p className="admin-orders__note">
        Read-only view. Order status is managed by the order service (coming soon).
      </p>
      <div className="admin-table" role="table" aria-label="All orders">
        <div className="admin-table__head" role="row">
          <span role="columnheader">Code</span>
          <span role="columnheader">Vendor</span>
          <span role="columnheader">Pickup</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Subtotal</span>
          <span role="columnheader">Total</span>
          <span role="columnheader">Placed</span>
        </div>
        {rows.map((o) => (
          <div className="admin-table__row" role="row" key={o.code}>
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
              <span className={`admin-status admin-status--${o.status}`}>{o.status}</span>
            </span>
            <span role="cell" data-label="Subtotal">
              {PESO(o.subtotal)}
            </span>
            <span role="cell" data-label="Total">
              {PESO(o.total)}
            </span>
            <span role="cell" data-label="Placed">
              {fmtDate(o.placed_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
