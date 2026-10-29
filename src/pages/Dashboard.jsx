import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useVendors } from '../context/VendorContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { transitionOrder } from '../lib/api'
import { aggregateByDay, buildRevenuePdf } from '../lib/revenuePdf'
import './Dashboard.css'

/* ------------------------------------------------------------------ */
/*  Orders are READ-ONLY from the client (status is read direct from   */
/*  Supabase under RLS). Status transitions (accept/ready/complete/     */
/*  reject) are WRITES that go only through the C# order service — the  */
/*  client never writes orders/order_items to Supabase.                 */
/* ------------------------------------------------------------------ */

// Order of an order's life. A status can only move forward.
const STATUS_ORDER = ['pending', 'preparing', 'ready', 'completed']
// Tab labels say where an order lives.
const PILL_LABEL = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
}
// Card buttons say what to do next, and which stage the order moves to.
const ACTION = {
  pending: { label: 'Accept', next: 'preparing' },
  preparing: { label: 'Mark Ready', next: 'ready' },
  ready: { label: 'Handed Over', next: 'completed' },
}
const EMPTY_TITLE = {
  pending: 'No new orders',
  preparing: 'Nothing is being prepared',
  ready: 'No orders waiting for pickup',
  completed: 'No completed orders yet',
}
// Labels used in history badges.
const STATUS = {
  pending: { label: 'Pending' },
  preparing: { label: 'Preparing' },
  ready: { label: 'Ready for pickup' },
  completed: { label: 'Completed' },
  cancelled: { label: 'Canceled' },
}
const REJECT_REASONS = ['Out of stock', 'Closing soon', 'Too busy', 'Other']
const RANGES = [
  { id: 'today', label: 'Today', max: 0 },
  { id: '7', label: 'Last 7 days', max: 6 },
  { id: '30', label: 'Last 30 days', max: 29 },
  { id: 'all', label: 'All time', max: Infinity },
]

/* Price display: peso icon + number on one line, vertically aligned (styles: .price in Dashboard.css) */
const Peso = ({ value }) => (
  <span className="price">
    <Icon name="peso" className="price__icon" />
    <span className="price__num">{Number(value).toLocaleString('en-PH')}</span>
  </span>
)

// Orders waiting longer than this (and not yet handed over) are flagged.
const LATE_MINUTES = 20

function timeAgo(mins) {
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return `${h} hr${h > 1 ? 's' : ''} ago`
}

// Re-renders every 30s so "3 min ago" stays current.
function useNow(interval = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}
const toMin = (t) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const isOpenNow = (open, close) => {
  if (!open || !close) return false
  const now = new Date()
  const m = now.getHours() * 60 + now.getMinutes()
  const start = toMin(open)
  const end = toMin(close)
  // Hours that run past midnight (e.g. 22:00 to 02:00) wrap around.
  return start <= end ? m >= start && m < end : m >= start || m < end
}
// Reads an uploaded image, shrinks it, and returns a data URL (or null if the file can't be used).
// (A data URL survives page refresh; the old blob: URL did not.)
const readImage = (file, max = 900) =>
  new Promise((resolve) => {
    if (!file || !file.type.startsWith('image/')) return resolve(null) // not an image
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff' // PNGs with transparency would turn black as JPEG, so paint white first
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = () => resolve(null) // e.g. HEIC or a broken file
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })

const PHOTO_ERROR = 'That file can’t be used as a photo. Please choose a JPG, PNG or WebP image.'

const initials = (name) =>
  (name || '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

// Philippine mobile numbers: +63 followed by 10 digits starting with 9 (e.g. 917 123 4567).
// Accepts pasted values like 0917..., 63917... or +63 917... and keeps only the 10 digits.
const phDigits = (v = '') => {
  let d = String(v).replace(/\D/g, '')
  if (d.startsWith('63')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}
const phFormat = (d) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ')
const phValid = (d) => /^9\d{9}$/.test(d)

function dayLabel(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const full = d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
  if (daysAgo === 0) return `Today · ${full}`
  if (daysAgo === 1) return `Yesterday · ${full}`
  return full
}

/* ------------------------------------------------------------------ */
/*  Small shared pieces                                                */
/* ------------------------------------------------------------------ */
function Switch({ checked, onChange, label, large = false, disabled = false }) {
  return (
    <label className={`dashboard-switch ${large ? 'dashboard-switch--lg' : ''} ${disabled ? 'dashboard-switch--disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="dashboard-switch__track" aria-hidden="true"><span className="dashboard-switch__thumb" /></span>
    </label>
  )
}

function Pill({ active, count, tone, onClick, children }) {
  return (
    <button type="button" aria-pressed={active}
      className={`dashboard-pill ${tone ? `dashboard-pill--${tone}` : ''} ${active ? 'is-active' : ''}`}
      onClick={onClick}>
      {children}
      {count !== undefined && <span className="dashboard-pill__count">{count}</span>}
    </button>
  )
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="dashboard-search">
      <Icon name="search" size={16} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button type="button" className="dashboard-search__clear" aria-label="Clear search"
          onClick={(e) => {
            onChange('')
            e.currentTarget.parentElement.querySelector('input')?.focus()
          }}>
          <Icon name="close" size={14} />
        </button>
      )}
    </label>
  )
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dashboard-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-modal-title">
        <h2 id="dashboard-modal-title" className="dashboard-modal__title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function PageHead({ title, sub, children }) {
  return (
    <div className="dashboard-head">
      <div>
        <h1 className="dashboard-head__title">{title}</h1>
        {sub && <p className="dashboard-head__sub">{sub}</p>}
      </div>
      {children && <div className="dashboard-head__actions">{children}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Incoming orders                                                    */
/* ------------------------------------------------------------------ */
// "2× Tapsilog, 1× Iced Tea" with the quantities in bold so cooks can't miss them.
function ItemList({ text }) {
  return text.split(', ').map((part, i, all) => {
    const m = part.match(/^(\d+)\s*[×x]\s*(.+)$/i)
    return (
      <span key={i}>
        {m ? <><strong className="dashboard-qty">{m[1]}×</strong> {m[2]}</> : part}
        {i < all.length - 1 && ', '}
      </span>
    )
  })
}

function OrderTime({ order, now }) {
  const mins = Math.max(0, Math.floor((now - order.placedAt) / 60000))
  const done = order.status === 'completed'
  const late = !done && mins >= LATE_MINUTES
  const label = done
    ? new Date(order.placedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
    : timeAgo(mins)
  return (
    <span className={`dashboard-order__time ${late ? 'is-late' : ''}`} title={late ? 'Waiting a long time' : undefined}>
      {label}
    </span>
  )
}

// Photo of the first item in the order (falls back to the orange placeholder).
function OrderThumb({ order, menu }) {
  const first = order.items.split(', ')[0].replace(/^\d+\s*[×x]\s*/i, '').toLowerCase()
  const image = menu.find((m) => m.name.toLowerCase() === first)?.image
  return (
    <div className="dashboard-order__thumb" aria-hidden="true">
      {image && <img src={image} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
    </div>
  )
}

function OrdersTab({ orders, menu, preorder, onTurnOn, onStatus, onReject }) {
  const [filter, setFilter] = useState('pending')
  const now = useNow()
  const counts = useMemo(
    () => Object.fromEntries(STATUS_ORDER.map((s) => [s, orders.filter((o) => o.status === s).length])),
    [orders]
  )
  const active = orders.length - counts.completed
  const shown = orders.filter((o) => o.status === filter)

  if (!preorder) {
    return (
      <>
        <PageHead title="Incoming Orders" sub="Orders will show up here when pre-ordering is on." />
        <div className="dashboard-empty">
          <span className="dashboard-empty__icon"><Icon name="bellOff" size={34} /></span>
          <h2>Pre-ordering is off</h2>
          <p>Your store is listing-only. Students can view your menu but not pre-order. Turn it on to start receiving orders.</p>
          <button type="button" className="dashboard-btn dashboard-btn--primary" onClick={onTurnOn}>Turn on pre-ordering</button>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHead
        title="Incoming Orders"
        sub={`${active} active ${active === 1 ? 'order' : 'orders'}. Accept new orders, then move each one forward as you prepare it.`}
      />

      {/* Orders panel: status tabs + order cards */}
      <section className="dashboard-panel" aria-label="Orders">
        {/* Status tabs: Pending / Preparing / Ready / Completed */}
        <div className="dashboard-pills" role="group" aria-label="Filter orders by status">
          {STATUS_ORDER.map((s) => (
            <Pill key={s} tone={s} active={filter === s} count={counts[s]} onClick={() => setFilter(s)}>
              {PILL_LABEL[s]}
            </Pill>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="dashboard-empty dashboard-empty--small">
            <h2>{EMPTY_TITLE[filter]}</h2>
            <p>
              {filter === 'completed'
                ? 'Orders show up here once you mark them as handed over.'
                : 'New orders appear here the moment a student places them.'}
            </p>
          </div>
        ) : (
          <ul className="dashboard-list">
            {shown.map((o) => (
              <li key={o.id} className={`dashboard-order ${o.status === 'completed' ? 'dashboard-order--done' : ''}`}>
                <OrderThumb order={o} menu={menu} />
                <div className="dashboard-order__main">
                  <p className="dashboard-order__title">
                    <span className="dashboard-order__id">{o.id}</span>
                    <span>{o.name}</span>
                    <OrderTime order={o} now={now} />
                  </p>
                  <p className="dashboard-order__items"><ItemList text={o.items} /></p>
                </div>

                <span className="dashboard-order__total"><Peso value={o.total} /></span>

                {o.status === 'completed' ? (
                  <span className="dashboard-order__done">Completed</span>
                ) : (
                  <div className="dashboard-order__actions">
                    {o.status === 'pending' && (
                      <button type="button" className="dashboard-action dashboard-action--reject" onClick={() => onReject(o)}>
                        Reject
                      </button>
                    )}
                    <button
                      type="button"
                      className={`dashboard-action dashboard-action--${o.status}`}
                      onClick={() => onStatus(o.uuid, ACTION[o.status].next)}
                    >
                      {ACTION[o.status].label}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function RejectDialog({ order, onCancel, onConfirm }) {
  const [reason, setReason] = useState(REJECT_REASONS[0])
  const [note, setNote] = useState('')
  return (
    <Modal title={`Reject ${order.id}?`} onClose={onCancel}>
      <p className="dashboard-modal__text">{order.name} will see the reason you pick.</p>
      <fieldset className="dashboard-reasons">
        <legend className="visually-hidden">Reason</legend>
        {REJECT_REASONS.map((r) => (
          <label key={r} className={`dashboard-reason ${reason === r ? 'is-active' : ''}`}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            {r}
          </label>
        ))}
      </fieldset>
      <div className="dashboard-field">
        <label htmlFor="reject-note">Note to student (optional)</label>
        <textarea id="reject-note" className="dashboard-input" rows={2} value={note}
          onChange={(e) => setNote(e.target.value)} placeholder="Tapsilog is sold out for today." />
      </div>
      <div className="dashboard-modal__actions">
        <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={onCancel}>Keep order</button>
        <button type="button" className="dashboard-btn dashboard-btn--danger" onClick={() => onConfirm(order.uuid, reason)}>Reject order</button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/*  Dashboard home: finance summary + order history                                                   */
/* ------------------------------------------------------------------ */
function DashboardTab({ history, storeName, flash }) {
  // Filters: date range (defaults to Today), status tab and search text.
  const [range, setRange] = useState('today')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')

  // Orders that fall inside the selected date range.
  const inRange = useMemo(() => {
    const max = RANGES.find((r) => r.id === range).max
    return history.filter((o) => o.daysAgo <= max)
  }, [history, range])

  // Numbers for the four summary cards.
  const done = inRange.filter((o) => o.status === 'completed')
  const cancelled = inRange.filter((o) => o.status === 'cancelled')
  const revenue = done.reduce((n, o) => n + o.total, 0)
  const avg = done.length ? Math.round(revenue / done.length) : 0
  const rangeName = { today: 'today', 7: 'last 7 days', 30: 'last 30 days', all: 'all time' }[range]

  // Export the in-range completed orders as a PDF revenue report. Groups by the
  // real calendar day via the canonical placedAt on each row (DOM-free builder).
  const exportPdf = () => {
    try {
      const { days, grandTotal, orderCount } = aggregateByDay(done)
      const rangeLabel = RANGES.find((r) => r.id === range).label
      const doc = buildRevenuePdf({
        storeName,
        rangeLabel,
        generatedAt: new Date().toLocaleString('en-PH'),
        days,
        grandTotal,
        orderCount,
      })
      doc.save(`revenue-${range}.pdf`)
      flash('Revenue report downloaded')
    } catch (err) {
      console.error('Failed to build revenue PDF:', err)
      flash('Could not generate the PDF. Please try again.')
    }
  }

  // Revenue of the period right before the selected one (yesterday, the 7 days before, etc.)
  // so the revenue card can show a "+x% vs ..." trend. "All time" has nothing to compare with.
  const trend = useMemo(() => {
    const span = { today: 1, 7: 7, 30: 30 }[range]
    if (!span) return null
    const sum = (list) => list.filter((o) => o.status === 'completed').reduce((n, o) => n + o.total, 0)
    const prev = sum(history.filter((o) => o.daysAgo >= span && o.daysAgo < span * 2))
    const label = { today: 'Yesterday', 7: 'Previous 7 days', 30: 'Previous 30 days' }[range]
    if (prev === 0) return { text: 'No sales', label, dir: 'flat' }
    const pct = ((revenue - prev) / prev) * 100
    const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
    return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, label, dir }
  }, [history, range, revenue])

  // Rows shown in the history list (status filter + search + newest first).
  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return inRange
      .filter((o) => status === 'all' || o.status === status)
      .filter((o) => !term || o.id.toLowerCase().includes(term) || o.name.toLowerCase().includes(term))
      .sort((a, b) => a.daysAgo - b.daysAgo)
  }, [inRange, status, q])

  // Group the rows by day so each day gets its own heading.
  const groups = useMemo(() => {
    const map = new Map()
    list.forEach((o) => map.set(o.daysAgo, [...(map.get(o.daysAgo) ?? []), o]))
    return [...map.entries()]
  }, [list])

  return (
    <>
      {/* Page heading */}
      <PageHead title="Welcome!" sub="This is your finance and order history report.">
        <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={exportPdf}>
          <Icon name="download" size={16} />
          Export PDF
        </button>
      </PageHead>

      {/* Date range filter (Today / Last 7 days / Last 30 days / All time) */}
      <div className="dashboard-pills" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <Pill key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>{r.label}</Pill>
        ))}
      </div>

      {/* Summary cards: revenue, completed, average order, canceled */}
      <div className="dashboard-kpis">
        <div className="dashboard-kpi dashboard-kpi--revenue">
          <p className="dashboard-stat__label">Total revenue {rangeName}</p>
          <p className="dashboard-kpi__num"><Peso value={revenue} /></p>
          <p className="dashboard-stat__note dashboard-stat__trend">
            {trend ? (
              <>
                <span className={`dashboard-trend dashboard-trend--${trend.dir}`}>{trend.text}</span>
                <span>vs {trend.label}</span>
              </>
            ) : (
              <span>From {done.length} completed {done.length === 1 ? 'order' : 'orders'}</span>
            )}
          </p>
        </div>
        <div className="dashboard-kpi">
          <p className="dashboard-stat__label">Completed</p>
          <p className="dashboard-kpi__num">{done.length}</p>
          <p className="dashboard-stat__note">Orders Handed Over</p>
        </div>
        <div className="dashboard-kpi">
          <p className="dashboard-stat__label">Average order</p>
          <p className="dashboard-kpi__num"><Peso value={avg} /></p>
          <p className="dashboard-stat__note">Based on {done.length} {done.length === 1 ? 'order' : 'orders'}</p>
        </div>
        <div className="dashboard-kpi">
          <p className="dashboard-stat__label">Canceled</p>
          <p className="dashboard-kpi__num">{cancelled.length}</p>
          <p className="dashboard-stat__note">Not counted in revenue</p>
        </div>
      </div>

      {/* Status filter tabs + search box */}
      <div className="dashboard-toolbar">
        <div className="dashboard-pills dashboard-pills--flush" role="group" aria-label="Filter by status">
          <Pill active={status === 'all'} count={inRange.length} onClick={() => setStatus('all')}>All</Pill>
          <Pill active={status === 'completed'} count={done.length} onClick={() => setStatus('completed')}>Completed</Pill>
          <Pill active={status === 'cancelled'} count={cancelled.length} onClick={() => setStatus('cancelled')}>Canceled</Pill>
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Order no. or student" />
      </div>

      {/* Order history list, grouped by day */}
      {groups.length === 0 ? (
        <div className="dashboard-empty dashboard-empty--small">
          <h2>No orders in this range</h2>
          <p>Try a longer date range or clear the search.</p>
        </div>
      ) : (
        <div className="dashboard-table">
          {groups.map(([daysAgo, rows]) => (
            <section key={daysAgo} aria-label={dayLabel(daysAgo)}>
              <h2 className="dashboard-table__day">{dayLabel(daysAgo)}</h2>
              <ul>
                {rows.map((o) => (
                  <li key={o.id} className="dashboard-row">
                    {/* Order number + student */}
                    <div className="dashboard-order__who">
                      <span className="dashboard-order__id">{o.id}</span>
                      <strong>{o.name}</strong>
                    </div>
                    {/* Items (and cancel reason, if any) */}
                    <p className="dashboard-order__items">
                      <ItemList text={o.items} />
                      {o.reason && <span className="dashboard-row__reason"> · {o.reason}</span>}
                    </p>
                    {/* Total + status badge */}
                    <span className="dashboard-order__total"><Peso value={o.total} /></span>
                    <span className={`dashboard-badge dashboard-badge--${o.status}`}>{STATUS[o.status].label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function HistoryUnavailable({ onTurnOn }) {
  return (
    <>
      <PageHead title="Welcome!" sub="Your finance and order history report is available while pre-ordering is on." />
      <div className="dashboard-empty">
        <span className="dashboard-empty__icon"><Icon name="lock" size={34} /></span>
        <h2>Order history is unavailable</h2>
        <p>Your store is listing-only, so there are no pre-orders to track. Turn on pre-ordering to see your past orders again.</p>
        <button type="button" className="dashboard-btn dashboard-btn--primary" onClick={onTurnOn}>Turn on pre-ordering</button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Menu items                                                         */
/* ------------------------------------------------------------------ */
// Menu tab. All changes go to the shared store (VendorContext), so the
// store page and cart show them right away.
function MenuTab({ menu, categories, onToggle, onSave, onDelete, flash }) {
  const [filter, setFilter] = useState('all')
  const [dialog, setDialog] = useState(null) // null | { item? }

  const available = menu.filter((m) => m.available).length
  const shown = menu.filter((m) => filter === 'all' || (filter === 'available' ? m.available : !m.available))

  const toggle = (id, value) => onToggle(id, value) // sold out / available switch

  const save = (item) => {
    onSave(item) // add new item or update existing one
    setDialog(null)
    flash(dialog?.item ? 'Item updated' : 'Item added')
  }

  const remove = (id) => {
    onDelete(id)
    setDialog(null)
    flash('Item deleted')
  }

  return (
    <>
      <PageHead title="Menu Items" sub="Add, edit or switch items off when they sell out." />

      {/* Availability filter: All / Available / Unavailable */}
      <div className="dashboard-pills" role="group" aria-label="Filter items">
        <Pill active={filter === 'all'} count={menu.length} onClick={() => setFilter('all')}>All</Pill>
        <Pill active={filter === 'available'} count={available} onClick={() => setFilter('available')}>Available</Pill>
        <Pill active={filter === 'unavailable'} count={menu.length - available} onClick={() => setFilter('unavailable')}>Unavailable</Pill>
      </div>

      {/* Menu card grid */}
      <ul className="dashboard-menu">
        {shown.map((m, i) => (
          <li key={m.id} className={`dashboard-item ${m.available ? '' : 'is-off'}`}>
            <div className="dashboard-item__img">
              {m.image && <img src={m.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
            </div>
            <div className="dashboard-item__body">
              <div className="dashboard-item__top">
                <h2>{m.name}</h2>
                <span className="dashboard-item__price"><Peso value={m.price} /></span>
              </div>
              <p className="dashboard-item__desc">{m.desc}</p>
              <div className="dashboard-item__foot">
                <span className="dashboard-item__avail">
                  <Switch checked={m.available} onChange={(v) => toggle(m.id, v)} label={`${m.name} available`} />
                  {m.available ? 'Available' : 'Sold out'}
                </span>
                <button type="button" className="dashboard-btn dashboard-btn--outline dashboard-btn--sm" onClick={() => setDialog({ item: m })}>Edit</button>
              </div>
            </div>
          </li>
        ))}
        {/* Dashed "add item" tile */}
        <li>
          <button type="button" className="dashboard-add" onClick={() => setDialog({})}>
            <Icon name="plus" size={26} />
            <span>Add a new menu item</span>
          </button>
        </li>
      </ul>


      {dialog && (
        <ItemDialog item={dialog.item} categories={categories} onClose={() => setDialog(null)} onSave={save} onDelete={remove} />
      )}
    </>
  )
}

function ItemDialog({ item, categories, onClose, onSave, onDelete }) {
  const editing = Boolean(item)
  const [form, setForm] = useState({
    name: item?.name ?? '',
    desc: item?.desc ?? '',
    price: item?.price ?? '',
    category: item?.category ?? categories[0]?.id ?? '',
    available: item?.available ?? true,
    dailyLimit: item?.dailyLimit ?? '',
    image: item?.image ?? '',
  })
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [photoMenu, setPhotoMenu] = useState(false)
  const photoWrap = useRef(null)
  const photoInput = useRef(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Close the photo options menu when clicking elsewhere.
  useEffect(() => {
    if (!photoMenu) return
    const onDoc = (e) => { if (!photoWrap.current?.contains(e.target)) setPhotoMenu(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [photoMenu])

  const pickImage = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' 
    if (!file) return
    readImage(file).then((src) => {
      if (!src) return setError(PHOTO_ERROR)
      setError('')
      setForm((f) => ({ ...f, image: src }))
    })
  }

  const submit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Enter an item name.')
    if (!(Number(form.price) > 0)) return setError('Enter a price greater than zero.')
    onSave({
      ...item,
      id: item?.id ?? `m-${Date.now()}`,
      name: form.name.trim(),
      desc: form.desc.trim(),
      price: Number(form.price),
      category: form.category,
      available: form.available,
      dailyLimit: form.dailyLimit === '' ? null : Number(form.dailyLimit),
      image: form.image,
    })
  }

  return (
    <Modal title={editing ? 'Edit Menu Item' : 'Add Menu Item'} onClose={onClose}>
      <form onSubmit={submit} className="dashboard-form">
        <div className="dashboard-itemtop">
          <div className="dashboard-itemtop__preview">
            {form.image && <img src={form.image} alt="" />}
          </div>
          <div className="dashboard-itemtop__fields">
            <div className="dashboard-field">
              <label htmlFor="item-name">Item name</label>
              <input id="item-name" className="dashboard-input" value={form.name} onChange={set('name')} placeholder="e.g. Tapsilog" />
            </div>
            {/* Photo button: uploads right away when empty; once a photo is set it opens Change / Remove */}
            <div className="dashboard-itemtop__btns" ref={photoWrap}>
              <button type="button" className="dashboard-btn dashboard-btn--outline dashboard-btn--sm"
                aria-haspopup={form.image ? 'menu' : undefined}
                aria-expanded={form.image ? photoMenu : undefined}
                onClick={() => (form.image ? setPhotoMenu((o) => !o) : photoInput.current?.click())}>
                <Icon name="upload" size={14} />
                {form.image ? 'Change photo' : 'Upload a photo'}
              </button>
              <input ref={photoInput} type="file" accept="image/*" hidden onChange={pickImage} />
              {photoMenu && form.image && (
                <div className="dashboard-popover" role="menu">
                  <button type="button" role="menuitem" className="dashboard-popover__item"
                    onClick={() => { setPhotoMenu(false); photoInput.current?.click() }}>
                    Change photo
                  </button>
                  <button type="button" role="menuitem" className="dashboard-popover__item"
                    onClick={() => { setForm((f) => ({ ...f, image: '' })); setPhotoMenu(false) }}>
                    Remove photo
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="dashboard-field">
          <label htmlFor="item-desc">Description</label>
          <textarea id="item-desc" className="dashboard-input" rows={2} value={form.desc} onChange={set('desc')}
            placeholder="e.g. Beef tapa, garlic rice, egg." />
        </div>
        <div className="dashboard-grid2">
          <div className="dashboard-field">
            <label htmlFor="item-price">Price (<Icon name="peso" size={14} className="price__icon price__icon--label" />)</label>
            <input id="item-price" type="number" min="0" step="1" inputMode="numeric" className="dashboard-input" value={form.price} onChange={set('price')} placeholder="e.g. 75" />
          </div>
          <div className="dashboard-field">
            <label htmlFor="item-cat">Category</label>
            <select id="item-cat" className="dashboard-input" value={form.category} onChange={set('category')}>
              <option value="" disabled>Select a category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="dashboard-grid2">
          <div className="dashboard-field">
            <label htmlFor="item-limit">Daily limit (optional)</label>
            <input id="item-limit" type="number" min="0" className="dashboard-input" value={form.dailyLimit}
              onChange={set('dailyLimit')} placeholder="No limit" />
          </div>
          <div className="dashboard-field">
            <span className="dashboard-field__label">Availability</span>
            <span className="dashboard-item__avail--form">
              <Switch large checked={form.available} onChange={(v) => setForm((f) => ({ ...f, available: v }))} label={form.available ? 'Available' : 'Sold out'} />
            </span>
          </div>
        </div>

        {error && <p className="dashboard-error" role="alert">{error}</p>}

        <div className="dashboard-modal__actions dashboard-modal__actions--split">
          {confirmDelete ? (
            <>
              <span className="dashboard-confirm">Delete this item?</span>
              <span className="dashboard-modal__pair">
                <button type="button" className="dashboard-btn dashboard-btn--danger" onClick={() => onDelete(item.id)}>Yes, Delete</button>
                <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={() => setConfirmDelete(false)}>No, Keep</button>
              </span>
            </>
          ) : (
            <>
              {editing ? (
                <button type="button" className="dashboard-link-danger" onClick={() => setConfirmDelete(true)}>Delete item</button>
              ) : <span />}
              <span className="dashboard-modal__pair">
                <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={onClose}>Discard</button>
                <button type="submit" className="dashboard-btn dashboard-btn--primary">{editing ? 'Save Changes' : 'Add Item'}</button>
              </span>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/*  Store profile                                                      */
/* ------------------------------------------------------------------ */
function StoreAvatar({ logo, name }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [logo])
  return logo && !broken
    ? <img src={logo} alt="" onError={() => setBroken(true)} />
    : <span>{initials(name) || '?'}</span>
}

function ProfileTab({ saved, onSave, preorder, flash, vendor, categories }) {

  const [draft, setDraft] = useState(saved)
  const coverInput = useRef(null)
  const logoInput = useRef(null)
  const logoWrap = useRef(null)
  const coverWrap = useRef(null)
  const [logoMenu, setLogoMenu] = useState(false)
  const [coverMenu, setCoverMenu] = useState(false)

  const FORM_KEYS = ['name', 'description', 'category', 'phone', 'gcashNumber', 'gcashName', 'locationArea', 'hoursOpen', 'hoursClose']
  const formOf = (o) => Object.fromEntries(FORM_KEYS.map((k) => [k, o[k]]))
  const dirty = JSON.stringify(formOf(draft)) !== JSON.stringify(formOf(saved))
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))

  // Photo picker for cover / logo (shrinks the image, stores a data URL).
  const pick = (key) => (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    readImage(file).then((src) => {
      if (!src) return flash(PHOTO_ERROR)
      onSave({ ...saved, [key]: src })
      flash(key === 'logo' ? 'Logo updated' : 'Cover updated')
    })
  }

  const open = isOpenNow(draft.hoursOpen, draft.hoursClose)

  // Philippine mobile number: shows 917 123 4567 after a fixed +63 prefix, saves as "+63 917 123 4567".
  const phoneDigits = phDigits(draft.phone)
  const phoneBad = phoneDigits.length > 0 && !phValid(phoneDigits)
  const onPhone = (e) => {
    const raw = e.target.value
    let d = phDigits(raw)
    // Backspacing over a space removes the digit before it instead of doing nothing.
    if (raw.length < phFormat(phoneDigits).length && d === phoneDigits) d = d.slice(0, -1)
    setDraft((x) => ({ ...x, phone: d ? `+63 ${phFormat(d)}` : '' }))
  }

  // Close the logo options popover on outside click or Escape.
  useEffect(() => {
    if (!logoMenu) return
    const onDoc = (e) => { if (!logoWrap.current?.contains(e.target)) setLogoMenu(false) }
    const onKey = (e) => e.key === 'Escape' && setLogoMenu(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [logoMenu])

  // Same for the cover options menu.
  useEffect(() => {
    if (!coverMenu) return
    const onDoc = (e) => { if (!coverWrap.current?.contains(e.target)) setCoverMenu(false) }
    const onKey = (e) => e.key === 'Escape' && setCoverMenu(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [coverMenu])

  return (
    <>
      {/* Page heading */}
      <PageHead title="Your Profile" sub="This is how students see your store. Change the photos right on the preview." />

      <div className="dashboard-profile">
        {/* LEFT COLUMN: edit forms + save bar */}
        <div className="dashboard-profile__forms">
          {/* Card 1: store identity & contact info */}
          <section className="dashboard-card">
            <h2 className="dashboard-card__title">Store Identity &amp; Info</h2>
            <div className="dashboard-field">
              <label htmlFor="p-name">Store name</label>
              <input id="p-name" className="dashboard-input" value={draft.name} onChange={set('name')} placeholder="e.g. Tita Nena’s Silog" />
            </div>
            <div className="dashboard-field">
              <label htmlFor="p-desc">Description</label>
              <textarea id="p-desc" className="dashboard-input" rows={3} value={draft.description} onChange={set('description')} placeholder="Tell students what you serve, e.g. Home-style silog plates served hot all day." />
            </div>
            <div className="dashboard-grid2 dashboard-grid2--phone">
              <div className="dashboard-field">
                <label htmlFor="p-cat">Category</label>
                <select id="p-cat" className="dashboard-input" value={draft.category} onChange={set('category')}>
                  <option value="" disabled>Select a category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="dashboard-field">
                <label htmlFor="p-phone">Contact Number</label>
                {/* +63 prefix is fixed; the vendor types the 10-digit mobile number */}
                <div className={`dashboard-phone ${phoneBad ? 'is-invalid' : ''}`}>
                  <span className="dashboard-phone__prefix" aria-hidden="true">+63</span>
                  <input id="p-phone" type="tel" inputMode="numeric" autoComplete="tel-national"
                    value={phFormat(phoneDigits)} onChange={onPhone} placeholder="917 123 4567"
                    aria-label="Contact number, after +63" aria-invalid={phoneBad || undefined} aria-describedby={phoneBad ? 'p-phone-err' : undefined} />
                </div>
                {phoneBad && <p id="p-phone-err" className="dashboard-error dashboard-error--sm" role="alert">Enter a 10-digit mobile number starting with 9.</p>}
              </div>
            </div>
            <div className="dashboard-grid2">
              <div className="dashboard-field">
                <label htmlFor="p-gcash-number">GCash number</label>
                <input id="p-gcash-number" type="tel" inputMode="numeric" className="dashboard-input"
                  value={draft.gcashNumber} onChange={set('gcashNumber')} placeholder="e.g. 0917 123 4567" />
                <p className="dashboard-hint">Students send pre-order payments to this GCash number. Required to turn on pre-ordering.</p>
              </div>
              <div className="dashboard-field">
                <label htmlFor="p-gcash-name">GCash account name</label>
                <input id="p-gcash-name" className="dashboard-input"
                  value={draft.gcashName} onChange={set('gcashName')} placeholder="e.g. Elena Reyes" />
              </div>
            </div>
          </section>

          {/* Card 2: location & opening hours */}
          <section className="dashboard-card">
            <h2 className="dashboard-card__title">Location &amp; Hours</h2>
            <div className="dashboard-field">
              <label htmlFor="p-loc">Location/Stall Area</label>
              <input id="p-loc" className="dashboard-input" value={draft.locationArea} onChange={set('locationArea')} placeholder="e.g. Food Court, Stall 4" />
            </div>
            <div className="dashboard-grid2">
              <div className="dashboard-field">
                <label htmlFor="p-open">Open</label>
                <input id="p-open" type="time" className="dashboard-input" value={draft.hoursOpen} onChange={set('hoursOpen')} />
              </div>
              <div className="dashboard-field">
                <label htmlFor="p-close">Closes</label>
                <input id="p-close" type="time" className="dashboard-input" value={draft.hoursClose} onChange={set('hoursClose')} />
              </div>
            </div>
          </section>

          {/* Save bar: discard or save the draft */}
          {dirty && (
            <div className="dashboard-savebar">
              <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={() => setDraft((d) => ({ ...d, ...formOf(saved) }))}>
                Discard
              </button>
              <button type="button" className="dashboard-btn dashboard-btn--primary" disabled={phoneBad}
                onClick={() => { onSave({ ...saved, ...formOf(draft) }); flash('Store profile saved') }}>
                Save changes
              </button>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: live preview of the student-facing store card */}
        <section className="dashboard-preview" aria-label="Store preview">
          {/* Cover photo + change button */}
          <div className="dashboard-preview__cover" style={saved.cover ? { backgroundImage: `url("${saved.cover}")` } : undefined}>
            {/* Change cover: uploads right away when there is no cover; once a cover is set it opens Change / Remove */}
            <div className="dashboard-preview__coverbtn" ref={coverWrap}>
              <button type="button" className="dashboard-btn dashboard-btn--light dashboard-btn--sm"
                aria-haspopup={saved.cover ? 'menu' : undefined}
                aria-expanded={saved.cover ? coverMenu : undefined}
                onClick={() => (saved.cover ? setCoverMenu((o) => !o) : coverInput.current?.click())}>
                <Icon name="camera" size={15} /> Change cover
              </button>
              {coverMenu && saved.cover && (
                <div className="dashboard-popover dashboard-popover--right" role="menu">
                  <button type="button" role="menuitem" className="dashboard-popover__item"
                    onClick={() => { setCoverMenu(false); coverInput.current?.click() }}>
                    Change cover
                  </button>
                  <button type="button" role="menuitem" className="dashboard-popover__item"
                    onClick={() => { onSave({ ...saved, cover: '' }); flash('Cover removed'); setCoverMenu(false) }}>
                    Remove photo
                  </button>
                </div>
              )}
            </div>
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={pick('cover')} />
          </div>

          <div className="dashboard-preview__row">
            {/* Logo / initials avatar with camera button + options popover */}
            <div className="dashboard-preview__avatar" ref={logoWrap}>
              <StoreAvatar logo={saved.logo} name={draft.name} />
              <button
                type="button"
                className="dashboard-preview__cam"
                aria-label={saved.logo ? 'Logo options' : 'Upload logo'}
                aria-haspopup={saved.logo ? 'menu' : undefined}
                aria-expanded={saved.logo ? logoMenu : undefined}
                onClick={() => (saved.logo ? setLogoMenu((o) => !o) : logoInput.current?.click())}
              >
                <Icon name="camera" size={14} />
              </button>
              <input ref={logoInput} type="file" accept="image/*" hidden onChange={pick('logo')} />

              {logoMenu && (
                <div className="dashboard-popover" role="menu">
                  <button type="button" role="menuitem" className="dashboard-popover__item"
                    onClick={() => { setLogoMenu(false); logoInput.current?.click() }}>
                    Change logo
                  </button>
                  <button type="button" role="menuitem" className="dashboard-popover__item"
                    onClick={() => { onSave({ ...saved, logo: '' }); flash('Logo removed'); setLogoMenu(false) }}>
                    Remove logo
                  </button>
                </div>
              )}
            </div>

            {/* Store name, open/closed badge, pre-order tag, description, quick facts */}
            <div className="dashboard-preview__info">
              <div className="dashboard-preview__title">
                <h2>{draft.name || 'Your store name'}</h2>
                <span className={`dashboard-badge dashboard-badge--sm ${open ? 'dashboard-badge--open' : 'dashboard-badge--cancelled'}`}>
                  {open ? 'Open' : 'Closed'}
                </span>
                <span className="dashboard-preview__preorder">{preorder ? <><span className="dashboard-preview__avail">Available </span>Pre-order</> : 'Listing only'}</span>
              </div>
              <p className="dashboard-preview__desc">{draft.description}</p>
              <p className="dashboard-preview__facts">
                <span className="dashboard-fact dashboard-fact--rating">
                  <span>{vendor.rating}</span>
                  <Icon name="star" size={11} className="dashboard-preview__star" />
                  <span>({vendor.reviews})</span>
                </span>
                {draft.locationArea && (
                  <span className="dashboard-fact">
                    <Icon name="pin" size={13} className="dashboard-fact__icon" />
                    {draft.locationArea}
                  </span>
                )}
                <span className="dashboard-fact">
                  <svg className="dashboard-fact__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  {draft.hoursOpen}–{draft.hoursClose}
                </span>
                {draft.phone && <span className="dashboard-fact dashboard-fact--phone">{draft.phone}</span>}
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Account settings (login details, password, delete account)         */
/* ------------------------------------------------------------------ */
const pwRules = (p) => [
  { ok: p.length >= 8, text: 'At least 8 characters' },
  { ok: /[A-Z]/.test(p) && /\d/.test(p), text: 'One uppercase letter and one number' },
  { ok: /[^A-Za-z0-9]/.test(p), text: 'One special character (e.g. ! @ #)' },
]

function PasswordField({ id, label, value, onChange, show, onToggle, placeholder, autoComplete, onFocus, onBlur }) {
  return (
    <div className="dashboard-field">
      <label htmlFor={id}>{label}</label>
      <div className="dashboard-pass">
        <input id={id} className="dashboard-input" type={show ? 'text' : 'password'} value={value} onChange={onChange}
          placeholder={placeholder} autoComplete={autoComplete} onFocus={onFocus} onBlur={onBlur} />
        {onToggle && (
          <button type="button" className="dashboard-pass__eye" onClick={onToggle} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {show
                ? <><path d="M17.9 17.9A10.6 10.6 0 0 1 12 20c-6 0-10-8-10-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9.7 9.7 0 0 1 12 4c6 0 10 8 10 8a18 18 0 0 1-2.2 3.2M1 1l22 22" /><path d="M14.1 14.1A3 3 0 0 1 9.9 9.9" /></>
                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" /><circle cx="12" cy="12" r="3" /></>}
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

// Confirmation popup for deleting the vendor account: warns about open orders, offers the sales report,
// and asks for the password before the final button works.
function DeleteDialog({ openCount, onExport, onClose, onConfirm }) {
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const blocked = openCount > 0

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    if (!pass || blocked) return
    setBusy(true)
    try {
      await onConfirm(pass)
    } catch (err) {
      setError(err?.message || 'Could not delete your account. Check your password and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="dashboard-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dashboard-dialog" role="dialog" aria-modal="true" aria-labelledby="dashboard-del-title">
        <button type="button" className="dashboard-dialog__x" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <span className="dashboard-dialog__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
        </span>
        <h2 id="dashboard-del-title" className="dashboard-dialog__title">Delete your vendor account?</h2>
        <p className="dashboard-dialog__text">This permanently deletes your store, menu items, reviews and sales history. This can’t be undone.</p>

        <div className="dashboard-notice" role={blocked ? 'alert' : undefined}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></svg>
          <p>
            {blocked && <>You have <strong>{openCount} open {openCount === 1 ? 'order' : 'orders'}</strong>. Complete or cancel {openCount === 1 ? 'it' : 'them'} before deleting. </>}
            Want a copy of your records?{' '}
            <button type="button" className="dashboard-link" onClick={onExport}>Export sales report</button>
          </p>
        </div>

        <form onSubmit={submit}>
          <PasswordField id="del-pass" label="Enter your password to confirm" value={pass}
            onChange={(e) => { setPass(e.target.value); setError('') }}
            show={show} onToggle={() => setShow((s) => !s)} placeholder="Your password" autoComplete="current-password" />
          {error && <p className="dashboard-error dashboard-error--sm" role="alert">{error}</p>}
          <div className="dashboard-modal__actions">
            <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="dashboard-btn dashboard-btn--deep" disabled={!pass || blocked || busy}>Delete account</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AccountTab({ history, openCount, flash, onDeleted }) {
  const auth = useAuth()
  const user = auth?.user || {}
  const saved = { name: user.full_name || '', email: user.email || '' }

  // --- Account details (login name + email)
  const [details, setDetails] = useState(saved)
  const detailsDirty = details.name !== saved.name || details.email !== saved.email
  const emailBad = details.email.trim() !== '' && !/^\S+@\S+\.\S+$/.test(details.email.trim())
  const emailChanged = details.email.trim() !== saved.email

  const saveDetails = () => {
    // TODO: connect your API. If the email changed, send the confirmation link to the new address.
    auth?.updateUser?.({ name: details.name.trim(), email: details.email.trim() })
    flash(emailChanged ? 'Confirmation link sent to your new email' : 'Account details saved')
  }

  // --- Change password
  const blank = { current: '', next: '', confirm: '' }
  const [pw, setPw] = useState(blank)
  const [show, setShow] = useState({ current: false, next: false })
  const [others, setOthers] = useState(true)
  const [pwFocus, setPwFocus] = useState(false)
  const [pwErr, setPwErr] = useState('')
  const [busy, setBusy] = useState(false)
  const setP = (k) => (e) => { setPw((f) => ({ ...f, [k]: e.target.value })); setPwErr('') }

  const rules = pwRules(pw.next)
  const score = [pw.next.length >= 8, /[A-Z]/.test(pw.next) && /\d/.test(pw.next), /[^A-Za-z0-9]/.test(pw.next), pw.next.length >= 12].filter(Boolean).length
  // The strength bar + checklist only appear once the New password box is clicked (and stay while it has text).
  const showRules = pwFocus || pw.next.length > 0

  const pwDirty = Boolean(pw.current || pw.next || pw.confirm) || !others // anything changed?
  const discardPw = () => { setPw(blank); setShow({ current: false, next: false }); setOthers(true); setPwErr('') }

  const updatePw = async () => {
    if (!pw.current) return setPwErr('Enter your current password.')
    if (!rules[0].ok || !rules[1].ok) return setPwErr('Your new password does not meet the requirements.')
    if (pw.next === pw.current) return setPwErr('Choose a password you have not used before.')
    if (pw.next !== pw.confirm) return setPwErr('The new passwords do not match.')
    setBusy(true)
    try {
      // TODO: connect your API. Pass logoutOthers to sign out the other devices.
      if (auth?.changePassword) await auth.changePassword({ current: pw.current, next: pw.next, logoutOthers: others })
      discardPw()
      flash('Password updated')
    } catch (error) {
      setPwErr(error?.message || 'Could not update your password. Check your current password and try again.')
    } finally {
      setBusy(false)
    }
  }

  // --- Export the sales report (CSV) before deleting
  const exportReport = () => {
    // Quote every cell, and stop spreadsheet apps from running cells that start with = + - @
    const esc = (v) => {
      let s = String(v ?? '')
      if (/^[=+\-@]/.test(s)) s = `'${s}`
      return `"${s.replace(/"/g, '""')}"`
    }
    const rows = [['Order', 'Customer', 'Items', 'Total (PHP)', 'Status', 'Reason', 'Days ago']]
    history.forEach((o) => rows.push([o.id, o.name, o.items, o.total, o.status, o.reason || '', o.daysAgo ?? 0]))
    const blob = new Blob(['\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }) // BOM keeps the × sign readable in Excel
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sales-report.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000) // revoking right away can cancel the download in some browsers
    flash('Sales report downloaded')
  }

  // --- Delete vendor account (confirmed in a popup)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = async (password) => {
    // TODO: connect your API to delete the vendor account, store, menu and reviews permanently (check the password).
    if (auth?.deleteAccount) await auth.deleteAccount({ password })
    onDeleted()
  }

  return (
    <>
      <PageHead title="Account Settings" sub="Manage the login and security of your vendor account." />

      <div className="dashboard-settings">
        <div className="dashboard-settings__col">
          {/* Account details */}
          <section className="dashboard-card">
            <h2 className="dashboard-card__title">Account Details</h2>
            <p className="dashboard-card__sub">The name and email you use to sign in as a vendor.</p>
            <div className="dashboard-form">
              <div className="dashboard-field">
                <label htmlFor="a-name">Full name</label>
                <input id="a-name" className="dashboard-input" value={details.name} autoComplete="name"
                  onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Elena Reyes" />
              </div>
              <div className="dashboard-field">
                <label htmlFor="a-email">Email</label>
                <input id="a-email" type="email" className="dashboard-input" value={details.email} autoComplete="email"
                  onChange={(e) => setDetails((d) => ({ ...d, email: e.target.value }))} placeholder="e.g. owner@email.com"
                  aria-invalid={emailBad || undefined} />
                {emailBad
                  ? <p className="dashboard-error dashboard-error--sm" role="alert">Enter a valid email address.</p>
                  : <p className="dashboard-hint">If you change your email, we’ll send a confirmation link to the new address.</p>}
              </div>
              {detailsDirty && (
                <div className="dashboard-modal__actions">
                  <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={() => setDetails(saved)}>Discard</button>
                  <button type="button" className="dashboard-btn dashboard-btn--primary" disabled={emailBad || !details.name.trim()} onClick={saveDetails}>Save Changes</button>
                </div>
              )}
            </div>
          </section>

          {/* Change password */}
          <section className="dashboard-card">
            <h2 className="dashboard-card__title">Change Password</h2>
            <p className="dashboard-card__sub">Use a strong password you don’t use anywhere else.</p>
            <div className="dashboard-form">
              <PasswordField id="pw-current" label="Current password" value={pw.current} onChange={setP('current')}
                show={show.current} onToggle={() => setShow((s) => ({ ...s, current: !s.current }))}
                placeholder="Enter current password" autoComplete="current-password" />

              <div className="dashboard-passgroup">
                <PasswordField id="pw-new" label="New password" value={pw.next} onChange={setP('next')}
                  show={show.next} onToggle={() => setShow((s) => ({ ...s, next: !s.next }))}
                  onFocus={() => setPwFocus(true)} onBlur={() => setPwFocus(false)}
                  placeholder="Enter new password" autoComplete="new-password" />
                {showRules && (
                  <>
                    <div className="dashboard-meter" aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => <span key={i} className={i < score ? 'is-on' : ''} />)}
                    </div>
                    <ul className="dashboard-rules" aria-label="Password requirements">
                      {rules.map((rule) => (
                        <li key={rule.text} className={rule.ok ? 'is-ok' : ''}>
                          <span className="dashboard-rules__dot" aria-hidden="true">
                            {rule.ok && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}
                          </span>
                          {rule.text}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <PasswordField id="pw-confirm" label="Confirm new password" value={pw.confirm} onChange={setP('confirm')}
                placeholder="Re-enter new password" autoComplete="new-password" />

              <label className="dashboard-check">
                <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
                Log me out of other devices
              </label>

              {pwErr && <p className="dashboard-error" role="alert">{pwErr}</p>}

              {pwDirty && (
                <div className="dashboard-modal__actions">
                  <button type="button" className="dashboard-btn dashboard-btn--outline" onClick={discardPw}>Discard</button>
                  <button type="button" className="dashboard-btn dashboard-btn--primary" disabled={busy} onClick={updatePw}>Update Password</button>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Delete account */}
        <div className="dashboard-settings__col">
          <section className="dashboard-card dashboard-card--danger">
            <h2 className="dashboard-card__title dashboard-card__title--danger">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
              Delete Vendor Account
            </h2>
            <p className="dashboard-card__sub">This permanently removes your store, menu items, reviews and account. This can’t be undone.</p>
            <ul className="dashboard-bullets">
              <li>
                Pending orders must be completed or cancelled first ({openCount} open now).
              </li>
              <li>
                Download your sales report before deleting.{' '}
                <button type="button" className="dashboard-link" onClick={exportReport}>Export report</button>
              </li>
            </ul>
            <button type="button" className="dashboard-btn dashboard-btn--dangerline" onClick={() => setDeleteOpen(true)}>
              Delete my account
            </button>
          </section>
        </div>
      </div>
      {deleteOpen && <DeleteDialog openCount={openCount} onExport={exportReport} onClose={() => setDeleteOpen(false)} onConfirm={remove} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Payments (GCash pre-order verification)                            */
/* ------------------------------------------------------------------ */
// payment_submitted orders can be Verified / Rejected / Cancelled; awaiting_payment
// orders (student hasn't paid yet) can only be Cancelled. All writes go through
// the C# order service (never a direct Supabase order write).
function PaymentsTab({ payments, preorder, onTurnOn, onVerify, onReject, onCancel, onView }) {
  const submitted = payments.filter((o) => o.status === 'payment_submitted')
  const awaiting = payments.filter((o) => o.status === 'awaiting_payment')

  if (!preorder) {
    return (
      <>
        <PageHead title="Payments" sub="GCash payments show up here when pre-ordering is on." />
        <div className="dashboard-empty">
          <span className="dashboard-empty__icon"><Icon name="bellOff" size={34} /></span>
          <h2>Pre-ordering is off</h2>
          <p>Your store is listing-only, so there are no GCash pre-orders to verify. Turn it on to start receiving orders.</p>
          <button type="button" className="dashboard-btn dashboard-btn--primary" onClick={onTurnOn}>Turn on pre-ordering</button>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHead
        title="Payments"
        sub={`${submitted.length} ${submitted.length === 1 ? 'payment' : 'payments'} to review. Verify a GCash reference to send the order to your queue.`}
      />

      <section className="dashboard-panel" aria-label="Payments to verify">
        <h2 className="dashboard-payments__group">Submitted — needs review</h2>
        {submitted.length === 0 ? (
          <div className="dashboard-empty dashboard-empty--small">
            <h2>No payments waiting</h2>
            <p>When a student submits their GCash reference, it shows up here for you to verify.</p>
          </div>
        ) : (
          <ul className="dashboard-list">
            {submitted.map((o) => (
              <li key={o.uuid} className="dashboard-order dashboard-order--payment">
                <div className="dashboard-order__main">
                  <p className="dashboard-order__title">
                    <span className="dashboard-order__id">{o.id}</span>
                    <span>{o.name}</span>
                    <span className="dashboard-badge dashboard-badge--payment_submitted">Payment submitted</span>
                  </p>
                  <p className="dashboard-order__items"><ItemList text={o.items} /></p>
                  <p className="dashboard-payments__ref">
                    GCash ref: <strong>{o.gcashReference || '—'}</strong>
                    {' · '}
                    <button type="button" className="dashboard-link" onClick={() => onView(o.screenshotPath)}>
                      View screenshot
                    </button>
                  </p>
                </div>
                <span className="dashboard-order__total"><Peso value={o.total} /></span>
                <div className="dashboard-order__actions">
                  <button type="button" className="dashboard-action dashboard-action--reject" onClick={() => onCancel(o.uuid)}>Cancel</button>
                  <button type="button" className="dashboard-action dashboard-action--reject" onClick={() => onReject(o.uuid)}>Reject</button>
                  <button type="button" className="dashboard-action dashboard-action--pending" onClick={() => onVerify(o.uuid)}>Verify payment</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {awaiting.length > 0 && (
          <>
            <h2 className="dashboard-payments__group dashboard-payments__group--muted">Awaiting payment</h2>
            <ul className="dashboard-list">
              {awaiting.map((o) => (
                <li key={o.uuid} className="dashboard-order dashboard-order--muted">
                  <div className="dashboard-order__main">
                    <p className="dashboard-order__title">
                      <span className="dashboard-order__id">{o.id}</span>
                      <span>{o.name}</span>
                      <span className="dashboard-badge dashboard-badge--awaiting_payment">Awaiting payment</span>
                    </p>
                    <p className="dashboard-order__items"><ItemList text={o.items} /></p>
                  </div>
                  <span className="dashboard-order__total"><Peso value={o.total} /></span>
                  <div className="dashboard-order__actions">
                    <button type="button" className="dashboard-action dashboard-action--reject" onClick={() => onCancel(o.uuid)}>Cancel</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Top bar (logo, nav pill, bell, avatar menu)                        */
/* ------------------------------------------------------------------ */

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'orders', label: 'Orders', icon: 'cart' },
  { id: 'payments', label: 'Payments', icon: 'peso' },
  { id: 'menu', label: 'Menu', icon: 'utensils' },
]

function TopBar({ tab, onTab, preorder, onPreorder, preorderLock, pendingCount, submittedCount, profile, onExit, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const accountRef = useRef(null)

  // Close the avatar menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e) => { if (!accountRef.current?.contains(e.target)) setMenuOpen(false) }
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const newOrders = preorder ? pendingCount : 0
  const newPayments = preorder ? submittedCount : 0

  return (
    <header className="dashboard-top">
      {/* Brand: logo + app name, links to the home page */}
      <Link to="/" className="dashboard-top__brand" aria-label="Food Herons home">
        <span className="dashboard-top__logo" aria-hidden="true">
          <img src="/images/logo.jpg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
        </span>
        <span className="dashboard-top__name">Food Herons</span>
      </Link>

      {/* Nav pill: Dashboard / Orders / Menu */}
      <nav className="dashboard-nav" aria-label="Dashboard">
        {NAV.map((n) => {
          const locked = n.id === 'dashboard' && !preorder // finance report needs pre-ordering
          return (
            <button key={n.id} type="button"
              className={`dashboard-nav__item ${tab === n.id ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`}
              aria-current={tab === n.id ? 'page' : undefined}
              title={locked ? 'Unavailable while pre-ordering is off' : n.label}
              onClick={() => onTab(n.id)}>
               
              <span className="dashboard-nav__icon">
  <Icon name={n.icon} size={16} />
  {n.id === 'orders' && newOrders > 0 && (
    <span className="dashboard-nav__badge" aria-label={`${newOrders} new`}>{newOrders}</span>
  )}
  {n.id === 'payments' && newPayments > 0 && (
    <span className="dashboard-nav__badge" aria-label={`${newPayments} to verify`}>{newPayments}</span>
  )}
</span>
<span className="dashboard-nav__label">{n.label}</span>
{locked && <span className="dashboard-nav__lock"><Icon name="lock" size={12} /><span className="visually-hidden">Unavailable</span></span>}
            </button>
          )
        })}
      </nav>

      {/* Right side: notification bell + avatar menu */}
      <div className="dashboard-top__tools">
        {/* Bell: jumps to Orders; dot shows when new orders are waiting */}
        <button type="button" className="dashboard-bell" onClick={() => onTab('orders')}
          aria-label={newOrders > 0 ? `${newOrders} new orders` : 'No new orders'}>
          <Icon name="bell" size={16} />
          {newOrders > 0 && <span className="dashboard-bell__dot" aria-hidden="true" />}
        </button>

        {/* Avatar: opens the account menu */}
        <div className="dashboard-account" ref={accountRef}>
          <button type="button" className="dashboard-avatar" onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true" aria-expanded={menuOpen} aria-label="Account menu">
            <StoreAvatar logo={profile.logo} name={profile.name} />
          </button>

          {menuOpen && (
            <div className="dashboard-account__menu">
              {/* Store summary */}
              <div className="dashboard-account__store">
                <strong>{profile.name}</strong>
                <small>{profile.locationArea}</small>
                <small>{profile.hoursOpen} - {profile.hoursClose}</small>
              </div>

              {/* Go to the profile editor */}
              <button type="button" className="dashboard-account__item"
                onClick={() => { setMenuOpen(false); onTab('profile') }}>
                <Icon name="user" size={16} /> Store profile
              </button>
              <button type="button" className="dashboard-account__item"
                onClick={() => { setMenuOpen(false); onTab('settings') }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
                Account settings
              </button>

              {/* Pre-ordering switch (disabled while not approved or no GCash number) */}
              <div className="dashboard-account__preorder">
                <span className="dashboard-account__preorder-text">
                  <strong>Pre-ordering</strong>
                  <small>
                    {preorderLock?.disabled
                      ? preorderLock.hint
                      : preorder
                      ? 'Students can order ahead.'
                      : 'Listing-only. Students can’t order.'}
                  </small>
                </span>
                <Switch
                  checked={preorder}
                  onChange={onPreorder}
                  label="Pre-ordering"
                  disabled={preorderLock?.disabled}
                />
              </div>

              {/* Exit / log out */}
              <button type="button" className="dashboard-account__item" onClick={onExit}>
                <Icon name="back" size={16} /> Exit dashboard
              </button>
              <button type="button" className="dashboard-account__item" onClick={onLogout}>
                <Icon name="logout" size={16} /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/*  Page shell                                                         */
/* ------------------------------------------------------------------ */
// Join an order's items into "2× Tapsilog, 1× Iced Tea".
const itemsText = (rows) =>
  (rows ?? []).map((oi) => `${oi.qty}× ${oi.name}`).join(', ')

// Whole days between a timestamp and now (0 = today).
const daysAgoFrom = (ts) => {
  if (!ts) return 0
  const then = new Date(ts)
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = startOfDay(new Date()) - startOfDay(then)
  return Math.max(0, Math.round(diff / 86400000))
}

export default function Dashboard() {
  const navigate = useNavigate()
  const auth = useAuth()
  const [tab, setTab] = useState('dashboard') // dashboard | orders | menu | profile | settings
  const [orders, setOrders] = useState([]) // active orders (read-only from Supabase)
  const [history, setHistory] = useState([]) // completed/cancelled orders (read-only)
  const [payments, setPayments] = useState([]) // awaiting_payment + payment_submitted (pre-queue)
  const [rejecting, setRejecting] = useState(null)
  const [toast, setToast] = useState('')

  // Store + menu data lives in the shared VendorContext (not in this page).
  const { currentVendorId, categories, getVendor, updateVendorInfo, setPreorderEnabled, saveMenuItem, setItemAvailable, deleteMenuItem } = useVendors()
  const vendor = getVendor(currentVendorId)
  const vid = vendor?.id
  const preorder = Boolean(vendor?.preorderEnabled)
  const approvalStatus = vendor?.approvalStatus ?? 'pending'
  const isApproved = approvalStatus === 'approved'
  const hasGcash = Boolean(vendor?.gcashNumber)
  // The pre-order Switch is gated two ways (FR1.6 + GCash gate): a store that
  // is not approved, or has no GCash number, cannot turn pre-ordering on.
  const preorderLock = !isApproved
    ? {
        disabled: true,
        hint:
          approvalStatus === 'suspended'
            ? 'Your store is suspended. Pre-ordering is unavailable.'
            : 'Your store is awaiting admin approval.',
      }
    : !hasGcash
    ? { disabled: true, hint: 'Add your GCash number in Store info to enable pre-ordering' }
    : { disabled: false, hint: '' }
  // Guard the setter so a forced-on toggle can never fire while locked.
  const setPreorder = (on) => {
    if (preorderLock.disabled) return
    setPreorderEnabled(vid, on)
  }
  const menu = vendor?.menu ?? []

  // Fetch this store's orders (read-only; RLS lets the owner read their vendor's orders).
  // Returns a promise so transition handlers can refresh after a write.
  const loadOrders = useCallback(async () => {
    if (!currentVendorId) return
    const { data, error } = await supabase
      .from('orders')
      .select('id, code, pickup_name, status, total, placed_at, cancel_reason, gcash_reference, payment_screenshot_path, order_items(name, qty)')
      .eq('vendor_id', currentVendorId)
      .order('placed_at', { ascending: false })
    if (error) { console.error('Failed to load orders:', error); return }
    const rows = data ?? []
    const live = []
    const done = []
    const pay = [] // awaiting_payment + payment_submitted (pre-queue, not Incoming)
    rows.forEach((o) => {
      const base = {
        uuid: o.id, // real order UUID — used for status transitions via the order service
        id: o.code, // display code (FH-000123) shown in the UI
        name: o.pickup_name,
        items: itemsText(o.order_items),
        total: Number(o.total),
        status: o.status,
      }
      if (o.status === 'completed' || o.status === 'cancelled') {
        done.push({ ...base, reason: o.cancel_reason || undefined, daysAgo: daysAgoFrom(o.placed_at), placedAt: Date.parse(o.placed_at) })
      } else if (o.status === 'awaiting_payment' || o.status === 'payment_submitted') {
        pay.push({ ...base, gcashReference: o.gcash_reference || undefined, screenshotPath: o.payment_screenshot_path || null, placedAt: Date.parse(o.placed_at) })
      } else {
        live.push({ ...base, placedAt: Date.parse(o.placed_at) })
      }
    })
    setOrders(live)
    setHistory(done)
    setPayments(pay)
  }, [currentVendorId])

  useEffect(() => { loadOrders() }, [loadOrders])

  const profile = useMemo(() => ({
    name: vendor?.name ?? '',
    description: vendor?.description ?? '',
    category: vendor?.category ?? '',
    locationArea: vendor?.locationArea ?? '',
    hoursOpen: vendor?.hoursOpen ?? '',
    hoursClose: vendor?.hoursClose ?? '',
    cover: vendor?.cover ?? '',
    logo: vendor?.logo ?? '',
    phone: vendor?.phone ?? '',
    gcashNumber: vendor?.gcashNumber ?? '',
    gcashName: vendor?.gcashName ?? '',
  }), [vendor])

  // Small "toast" message at the bottom of the screen.
  const toastTimer = useRef(null)
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // Advance an order (accept->preparing, mark ready->ready, handed over->completed)
  // through the C# order service using the order UUID, then refresh from Supabase.
  const changeStatus = async (uuid, status) => {
    try {
      await transitionOrder(uuid, { to: status })
      await loadOrders()
      if (status === 'completed') flash('Order marked as handed over')
      else if (status === 'preparing') flash('Order accepted')
      else if (status === 'ready') flash('Order marked ready for pickup')
    } catch (err) {
      flash(
        err?.code === 'ILLEGAL_TRANSITION'
          ? 'That order has already moved on — refreshing.'
          : err?.message || 'Could not update the order. Please try again.'
      )
      if (err?.code === 'ILLEGAL_TRANSITION') await loadOrders()
    }
  }

  // Orders picked up today count as completed in the dashboard history.
  const allHistory = useMemo(
    () => [...orders.filter((o) => o.status === 'completed').map((o) => ({ ...o, daysAgo: 0 })), ...history],
    [orders, history]
  )

  // Reject an order: cancel it (with a reason) through the order service using
  // the order UUID, then refresh from Supabase.
  const reject = async (uuid, reason) => {
    try {
      await transitionOrder(uuid, { to: 'cancelled', reason })
      await loadOrders()
      flash('Order rejected')
    } catch (err) {
      flash(
        err?.code === 'ILLEGAL_TRANSITION'
          ? 'That order has already moved on — refreshing.'
          : err?.message || 'Could not reject the order. Please try again.'
      )
      if (err?.code === 'ILLEGAL_TRANSITION') await loadOrders()
    } finally {
      setRejecting(null)
    }
  }

  // Open a short-lived signed URL for a payment screenshot in a new tab.
  const viewScreenshot = async (path) => {
    if (!path) { flash('No screenshot provided'); return }
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 60)
    if (error || !data?.signedUrl) { flash('Couldn’t open the screenshot.'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  // Payment verify/reject/cancel — all go through the C# order service by the
  // order UUID, then refresh. Verify has no reason; reject/cancel prompt for one.
  const runPayment = async (fn, okMsg) => {
    try {
      await fn()
      await loadOrders()
      flash(okMsg)
    } catch (err) {
      flash(
        err?.code === 'ILLEGAL_TRANSITION'
          ? 'That order has already moved on — refreshing.'
          : err?.message || 'Could not update the order. Please try again.'
      )
      if (err?.code === 'ILLEGAL_TRANSITION') await loadOrders()
    }
  }

  const verifyPayment = (uuid) =>
    runPayment(() => transitionOrder(uuid, { to: 'pending' }), 'Payment verified — order is now in your queue')

  const rejectPayment = (uuid) => {
    const reason = window.prompt('Why are you rejecting this payment?')
    if (reason === null) return
    const trimmed = reason.trim()
    if (!trimmed) { flash('Please give a short reason.'); return }
    return runPayment(() => transitionOrder(uuid, { to: 'awaiting_payment', reason: trimmed }), 'Payment rejected — student can resubmit')
  }

  const cancelPayment = (uuid) => {
    const reason = window.prompt('Why are you cancelling this order?')
    if (reason === null) return
    const trimmed = reason.trim()
    if (!trimmed) { flash('Please give a short reason.'); return }
    return runPayment(() => transitionOrder(uuid, { to: 'cancelled', reason: trimmed }), 'Order cancelled')
  }

  const pendingCount = orders.filter((o) => o.status === 'pending').length
  const submittedCount = payments.filter((o) => o.status === 'payment_submitted').length
  const openCount = orders.filter((o) => o.status !== 'completed').length // orders still being handled

  // No store linked to this account yet: show a message instead of crashing
  if (!vendor) {
    return (
      <div className="dashboard">
        <section className="dashboard-main">
          <div className="dashboard-empty">
            <h2>Store not found</h2>
            <p>We couldn’t find a store for this account.</p>
            <Link to="/" className="dashboard-btn dashboard-btn--primary">Back to home</Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="dashboard">
      {/* Top bar */}
      <TopBar
        tab={tab}
        onTab={setTab}
        preorder={preorder}
        onPreorder={setPreorder}
        preorderLock={preorderLock}
        pendingCount={pendingCount}
        submittedCount={submittedCount}
        profile={profile}
        onExit={() => navigate('/')}
        onLogout={() => { auth?.logout?.(); navigate('/login') }}
      />

      {/* Active page */}
      <section className="dashboard-main">
        {!isApproved && (
          <div className="dashboard-empty dashboard-empty--banner" role="status">
            <span className="dashboard-empty__icon"><Icon name="lock" size={34} /></span>
            <h2>{approvalStatus === 'suspended' ? 'Your store is suspended' : 'Your store is awaiting approval'}</h2>
            <p>
              {approvalStatus === 'suspended'
                ? 'An admin has suspended your store, so it is hidden from students and pre-ordering is turned off. You can still edit your store and menu while it is suspended.'
                : approvalStatus === 'rejected'
                ? 'Your store was not approved. Update your store details — an admin can re-activate it. It stays hidden from students and pre-ordering is unavailable for now.'
                : 'An admin needs to approve your store before students can see it or pre-order. You can set up your store and menu in the meantime.'}
            </p>
          </div>
        )}
        {tab === 'dashboard' && (preorder
          ? <DashboardTab history={allHistory} storeName={vendor?.name ?? 'Store'} flash={flash} />
          : <HistoryUnavailable onTurnOn={() => setPreorder(true)} />)}
        {tab === 'orders' && (
          <OrdersTab orders={orders} menu={menu} preorder={preorder} onTurnOn={() => setPreorder(true)}
            onStatus={changeStatus} onReject={setRejecting} />
        )}
        {tab === 'payments' && (
          <PaymentsTab payments={payments} preorder={preorder} onTurnOn={() => setPreorder(true)}
            onVerify={verifyPayment} onReject={rejectPayment} onCancel={cancelPayment} onView={viewScreenshot} />
        )}
        {tab === 'menu' && (
          <MenuTab menu={menu} categories={categories} flash={flash}
            onToggle={(itemId, on) => setItemAvailable(vid, itemId, on)}
            onSave={(item) => saveMenuItem(vid, item)}
            onDelete={(itemId) => deleteMenuItem(vid, itemId)} />
        )}
        {tab === 'settings' && (
          <AccountTab history={allHistory} openCount={openCount} flash={flash} onDeleted={() => { auth?.logout?.(); navigate('/') }} />
        )}
        {tab === 'profile' && (
          <ProfileTab key={JSON.stringify({ ...profile, cover: '', logo: '' })} saved={profile}
            onSave={(info) => updateVendorInfo(vid, info)}
            preorder={preorder} flash={flash} vendor={vendor} categories={categories} />
        )}
      </section>

      {/* Reject dialog + toast */}
      {rejecting && <RejectDialog order={rejecting} onCancel={() => setRejecting(null)} onConfirm={reject} />}
      {toast && <div className="dashboard-toast" role="status">{toast}</div>}
    </div>
  )
}