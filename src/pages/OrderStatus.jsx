import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { useVendors } from '../context/VendorContext'
import { supabase } from '../lib/supabase'
import './OrderStatus.css'

const Peso = ({ value }) => (
  <span className="price">
    <Icon name="peso" className="price__icon" />
    <span className="price__num">{Number(value || 0).toLocaleString('en-PH')}</span>
  </span>
)

const STEPS = [
  { key: 'pending', label: 'Pending', desc: 'Sent to the vendor' },
  { key: 'accepted', label: 'Accepted', desc: 'Vendor is preparing your order' },
  { key: 'ready', label: 'Ready for pickup', desc: 'Head to the stall' },
  { key: 'completed', label: 'Completed', desc: 'Picked up and paid' },
]

const STATE_UI = {
  pending: {
    tone: 'pending',
    icon: 'clock',
    title: 'Waiting for the vendor',
    pill: 'Pending',
    subtitle: (o) => (
      <>
        Order <strong>{o.id}</strong> at <strong>{o.vendorName}</strong>. We will
        update you once it is accepted.
      </>
    ),
  },
  accepted: {
    tone: 'accepted',
    icon: 'utensils',
    title: 'Order accepted',
    pill: 'Accepted',
    subtitle: (o) => (
      <>
        <strong>{o.vendorName}</strong> is preparing your order{' '}
        <strong>{o.id}</strong>.
      </>
    ),
  },
  ready: {
    tone: 'ready',
    icon: 'bag',
    title: 'Ready for pickup!',
    pill: 'Ready for pickup',
    subtitle: (o) => (
      <>
        Head to <strong>{o.vendorName}</strong> to collect order{' '}
        <strong>{o.id}</strong>.
      </>
    ),
  },
  completed: {
    tone: 'completed',
    icon: 'check',
    title: 'Order completed!',
    pill: 'Completed',
    subtitle: (o) => (
      <>
        Order <strong>{o.id}</strong> at <strong>{o.vendorName}</strong>. Thanks
        for ordering!
      </>
    ),
  },
}

// Map the DB order status to the UI step key (the tracker has no separate
// 'preparing' step — a preparing order is shown as 'accepted').
const DB_STATUS_TO_STEP = {
  pending: 'pending',
  preparing: 'accepted',
  ready: 'ready',
  completed: 'completed',
}

// Small rating + comment form shown on the completed state.
function ReviewForm({ onSubmit }) {
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  if (done) return <p className="order-review__done" role="status">Thanks for your review!</p>

  const submit = async (e) => {
    e.preventDefault()
    if (!rating) return setError('Pick a star rating first.')
    setBusy(true)
    setError('')
    try {
      await onSubmit({ rating, text: text.trim() })
      setDone(true)
    } catch (err) {
      setError(err?.message || 'Could not submit your review. Please try again.')
      setBusy(false)
    }
  }

  return (
    <form className="order-review" onSubmit={submit}>
      <span className="order-review__stars" role="radiogroup" aria-label={`${rating} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === rating}
            aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}>
            <Icon name={n <= rating ? 'star' : 'starOutline'} size={22} />
          </button>
        ))}
      </span>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="How was the food and pickup? (optional)" maxLength={280} />
      {error && <p className="order-review__error" role="alert">{error}</p>}
      <button type="submit" className="order-btn order-btn--primary" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit review'}
      </button>
    </form>
  )
}

export default function OrderStatus() {
  const { id } = useParams()
  const { getVendor } = useVendors()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showReview, setShowReview] = useState(false)

  // Load the real order (RLS lets a student read only their own orders).
  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('orders')
      .select('id, code, vendor_id, status, total, pickup_name, note, order_items(name, qty, unit_price)')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          setOrder(null)
        } else {
          setOrder({
            uuid: data.id,
            id: data.code,
            vendorId: data.vendor_id,
            status: data.status,
            total: data.total,
            pickupName: data.pickup_name,
            note: data.note,
            lines: (data.order_items ?? []).map((oi) => ({ name: oi.name, qty: oi.qty, price: oi.unit_price })),
          })
        }
        setLoading(false)
      })
    return () => { active = false }
  }, [id])

  if (loading) {
    return (
      <div className="container section">
        <p className="text-muted">Loading order…</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="container section">
        <div className="cart-empty">
          <span className="cart-empty__emoji" aria-hidden="true">📦</span>
          <h1>Order not found</h1>
          <p className="text-muted">
            We couldn't find order {id}, or it isn't yours to view.
          </p>
          <Link to="/" className="btn btn--primary mt-4">Back to vendors</Link>
        </div>
      </div>
    )
  }

  /* ---------- Derived values ---------- */
  // A cancelled order has no tracker step; show it as pending-looking but blocked.
  const stepKey = DB_STATUS_TO_STEP[order.status] ?? 'pending'
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === stepKey))
  const current = STEPS[stepIndex]
  const ui = STATE_UI[current.key]
  const isPending = current.key === 'pending'
  const isCompleted = current.key === 'completed'

  // Vendor record gives us location + hours.
  const vendor = order.vendorId && getVendor(order.vendorId)
  const vendorName = vendor?.name ?? 'the vendor'
  const orderForUi = { ...order, vendorName }

  // Reorder goes back to the vendor's store.
  const reorderTo = vendor ? `/vendor/${vendor.id}` : '/'

  // Submit a review for this completed order. The client sends ONLY these four fields;
  // student_id/author_name/ordered_summary are filled by the DB trigger.
  const submitReview = async ({ rating, text }) => {
    const { error } = await supabase
      .from('reviews')
      .insert({ vendor_id: order.vendorId, order_id: order.uuid, rating, text })
    if (error) throw error
  }

  const handleContact = () => {
    if (vendor?.phone) {
      window.location.href = `tel:${vendor.phone.replace(/\s/g, '')}`
    } else {
      window.alert('This vendor has not added a contact number yet.')
    }
  }

  return (
    <div className="order-page">
      <div className="order-page__inner">
        {/* ---------- Header: icon + title + subtitle ---------- */}
        <header className="order-confirm">
          <span className={`state-icon state-icon--${ui.tone}`} aria-hidden="true">
            <Icon name={ui.icon} size={26} /> 
          </span>
          <h1>{ui.title}</h1>
          <p className="order-confirm__sub">{ui.subtitle(orderForUi)}</p>
        </header>

        {/* ---------- Order status card (wide, full width) ---------- */}
        <section className="order-card order-card--status" aria-live="polite">
          <div className="order-card__head">
            <h2 className="order-card__title">Order status</h2>
            <span className={`status-pill status-pill--${ui.tone}`}>
              <span className="status-pill__dot" aria-hidden="true" />
              {ui.pill}
            </span>
          </div>

          {/* Tracker*/}
          <ol className="tracker">
            {STEPS.map((step, i) => {
              const state =
                i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'upcoming'
              const isFinal = isCompleted && i === STEPS.length - 1
              const linkDone = i + 1 <= stepIndex

              return (
                <li
                  key={step.key}
                  className={[
                    'tracker__step',
                    `tracker__step--${state}`,
                    isFinal ? 'tracker__step--final' : '',
                    linkDone ? 'tracker__step--link-done' : '',
                  ].join(' ')}
                >
                  <span className="tracker__dot" aria-hidden="true">
                    {state === 'done' || isFinal ? (
                      <Icon name="check" size={12} />
                    ) : state === 'active' ? (
                      <span className="tracker__inner" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="tracker__text">
                    <p className="tracker__label">{step.label}</p>
                    <p className="tracker__desc">{step.desc}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <div className="order-grid">
          {/* Pickup details */}
          <section className="order-card">
            <h2 className="order-card__title">Pickup details</h2>
            <ul className="pickup-list">
              <li>
                <Icon name="pin" size={16} />
                <span>
                  {vendorName}
                  {vendor?.locationArea && `, ${vendor.locationArea}`}
                </span>
              </li>
              {vendor?.hoursOpen && vendor?.hoursClose && (
                <li>
                  <Icon name="clock" size={16} />
                  <span>Open {vendor.hoursOpen} to {vendor.hoursClose}</span>
                </li>
              )}
              {order.pickupName && (
                <li>
                  <Icon name="user" size={16} />
                  <span>
                    Pickup name: <strong>{order.pickupName}</strong>
                  </span>
                </li>
              )}
            </ul>
            {order.note && <p className="pickup-note">Note: {order.note}</p>}
          </section>

          {/* Order summary + state-specific actions */}
          <section className="order-card order-card--summary">
            <h2 className="order-card__title">Order summary</h2>

            {/* Item lines */}
            <ul className="order-receipt__lines">
              {order.lines.map((l, idx) => (
                <li key={idx}>
                  <span>
                    <span className="order-receipt__qty">{l.qty}×</span> {l.name}
                  </span>
                  <span className="order-receipt__amt"><Peso value={l.price * l.qty} /></span>
                </li>
              ))}
            </ul>

            {/* Total */}
            <div className="order-receipt__total">
              <div>
                <p className="order-receipt__total-label">Total</p>
                <p className="order-receipt__total-sub">Cash on pickup</p>
              </div>
              <strong className="order-receipt__total-amt"><Peso value={order.total} /></strong>
            </div>

            {/* Actions: Pending = Cancel (Phase-C placeholder), Accepted/Ready = Contact, Completed = Reorder + Review */}
            <div className="order-actions">
              {isPending && (
                <>
                  {/* TODO(Phase C): POST /api/orders/{id}/transition {to:'cancelled'} — the client
                      must NOT write order status to Supabase (RLS forbids it; it's the order service's job). */}
                  <button
                    type="button"
                    className="order-btn order-btn--outline order-btn--block"
                    disabled
                    title="Cancelling an order will be handled by the order service (coming soon)."
                  >
                    Cancel order
                  </button>
                  <p className="order-confirm__sub" role="status">
                    Need to cancel? That's handled by the order service and is coming soon.
                  </p>
                </>
              )}

              {!isPending && !isCompleted && (
                <button
                  type="button"
                  className="order-btn order-btn--outline order-btn--block"
                  onClick={handleContact}
                >
                  Contact vendor
                </button>
              )}

              {isCompleted && (
                <>
                  <div className="order-actions__row">
                    <Link to={reorderTo} className="order-btn order-btn--primary">
                      Reorder
                    </Link>
                    {!showReview && (
                      <button
                        type="button"
                        className="order-btn order-btn--outline"
                        onClick={() => setShowReview(true)}
                      >
                        Leave a review
                      </button>
                    )}
                  </div>
                  {showReview && <ReviewForm onSubmit={submitReview} />}
                  <Link to="/" className="order-another">
                    Order from another vendor
                  </Link>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}