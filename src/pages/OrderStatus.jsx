import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { useVendors } from '../context/VendorContext'
import { supabase } from '../lib/supabase'
import { submitPayment, transitionOrder } from '../lib/api'
import './OrderStatus.css'

const Peso = ({ value }) => (
  <span className="price">
    <Icon name="peso" className="price__icon" />
    <span className="price__num">{Number(value || 0).toLocaleString('en-PH')}</span>
  </span>
)

const STEPS = [
  { key: 'payment', label: 'Payment', desc: 'Pay via GCash to confirm' },
  { key: 'pending', label: 'Pending', desc: 'Sent to the vendor' },
  { key: 'accepted', label: 'Accepted', desc: 'Vendor is preparing your order' },
  { key: 'ready', label: 'Ready for pickup', desc: 'Head to the stall' },
  { key: 'completed', label: 'Completed', desc: 'Picked up and paid' },
]

const STATE_UI = {
  payment: {
    tone: 'payment',
    icon: 'peso',
    title: 'Payment required',
    pill: 'Awaiting payment',
    subtitle: (o) => (
      <>
        Pay for order <strong>{o.id}</strong> via GCash and submit your reference
        number to send it to <strong>{o.vendorName}</strong>.
      </>
    ),
  },
  payment_submitted: {
    tone: 'payment',
    icon: 'clock',
    title: 'Payment submitted',
    pill: 'Checking payment',
    subtitle: (o) => (
      <>
        Waiting for <strong>{o.vendorName}</strong> to confirm your payment for
        order <strong>{o.id}</strong>.
      </>
    ),
  },
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
  awaiting_payment: 'payment',
  payment_submitted: 'payment',
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

// Simple filename sanitiser for the Storage object key (keeps the extension).
const safeName = (name) => (name || 'proof').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)

// Payment step for an awaiting_payment order: shows the vendor's GCash details
// and a required reference input + optional screenshot upload. The screenshot is
// uploaded to the private 'payment-proofs' bucket under `${uuid}/${filename}`
// first; on upload failure we fall back to reference-only. Then submitPayment is
// called and the order refreshed.
function PaymentForm({ order, vendor, onSubmitted }) {
  const [reference, setReference] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const trimmed = reference.trim()
    if (!trimmed) {
      setError('Enter the GCash reference number from your payment.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')

    let screenshotPath = null
    if (file) {
      const path = `${order.uuid}/${Date.now()}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage
        .from('payment-proofs')
        .upload(path, file, { upsert: false })
      if (upErr) {
        // Screenshot is optional — proceed with reference only.
        setNotice("Couldn't upload your screenshot; submitting the reference number without it.")
      } else {
        screenshotPath = path
      }
    }

    try {
      await submitPayment(order.uuid, { gcashReference: trimmed, screenshotPath })
      await onSubmitted()
    } catch (err) {
      setError(
        err?.code === 'ILLEGAL_TRANSITION'
          ? 'This order is no longer awaiting payment — refreshing.'
          : err?.message || 'We couldn’t submit your payment. Please try again.'
      )
      if (err?.code === 'ILLEGAL_TRANSITION') await onSubmitted()
      setBusy(false)
    }
  }

  return (
    <div className="order-pay">
      {order.paymentRejectedReason && (
        <p className="order-pay__rejected" role="alert">
          Your last payment was rejected: {order.paymentRejectedReason}. Please
          check the details and submit again.
        </p>
      )}

      <div className="order-pay__gcash">
        <p className="order-pay__gcash-label">Send exactly</p>
        <p className="order-pay__gcash-amount"><Peso value={order.total} /></p>
        <p className="order-pay__gcash-to">
          via GCash to{' '}
          <strong>{vendor.gcashNumber}</strong>
          {vendor.gcashName && <> ({vendor.gcashName})</>}
        </p>
      </div>

      <form className="order-pay__form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="gcash-ref">GCash reference number (required)</label>
          <input
            id="gcash-ref"
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. 1234 5678 90"
            inputMode="numeric"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="gcash-shot">Screenshot (optional)</label>
          <input
            id="gcash-shot"
            className="input"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {notice && <p className="order-pay__notice" role="status">{notice}</p>}
        {error && <p className="order-review__error" role="alert">{error}</p>}

        <button type="submit" className="order-btn order-btn--primary order-btn--block" disabled={busy}>
          {busy ? 'Submitting…' : 'I’ve paid — submit reference'}
        </button>
      </form>
    </div>
  )
}

export default function OrderStatus() {
  const { id } = useParams()
  const { getVendor } = useVendors()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showReview, setShowReview] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  // Load the real order (RLS lets a student read only their own orders).
  // Status is always read straight from Supabase — only the write (cancel)
  // goes through the order service.
  const fetchOrder = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, code, vendor_id, status, total, pickup_name, note, gcash_reference, payment_submitted_at, payment_rejected_reason, order_items(name, qty, unit_price)')
      .eq('id', id)
      .single()
    if (error || !data) return null
    return {
      uuid: data.id,
      id: data.code,
      vendorId: data.vendor_id,
      status: data.status,
      total: data.total,
      pickupName: data.pickup_name,
      note: data.note,
      gcashReference: data.gcash_reference,
      paymentSubmittedAt: data.payment_submitted_at,
      paymentRejectedReason: data.payment_rejected_reason,
      lines: (data.order_items ?? []).map((oi) => ({ name: oi.name, qty: oi.qty, price: oi.unit_price })),
    }
  }, [id])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchOrder().then((o) => {
      if (!active) return
      setOrder(o)
      setLoading(false)
    })
    return () => { active = false }
  }, [fetchOrder])

  // Student cancel: prompt for a reason, POST the transition through the order
  // service, then refresh the order from Supabase. ILLEGAL_TRANSITION means the
  // vendor already moved the order on (lost race).
  const cancelOrder = async () => {
    const reason = window.prompt('Why are you cancelling this order?')
    if (reason === null) return // dismissed the prompt
    const trimmed = reason.trim()
    if (!trimmed) {
      setCancelError('Please give a short reason for cancelling.')
      return
    }
    setCancelling(true)
    setCancelError('')
    try {
      await transitionOrder(order.uuid, { to: 'cancelled', reason: trimmed })
      const refreshed = await fetchOrder()
      if (refreshed) setOrder(refreshed)
    } catch (err) {
      setCancelError(
        err?.code === 'ILLEGAL_TRANSITION'
          ? 'This order can no longer be cancelled — the vendor has already started on it.'
          : err?.message || 'We couldn’t cancel your order. Please try again.'
      )
    } finally {
      setCancelling(false)
    }
  }

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
  // A cancelled order has no tracker step; show it as payment-looking but blocked.
  const stepKey = DB_STATUS_TO_STEP[order.status] ?? 'pending'
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === stepKey))
  const current = STEPS[stepIndex]
  const isAwaitingPayment = order.status === 'awaiting_payment'
  const isPaymentSubmitted = order.status === 'payment_submitted'
  // In the payment step, the two DB states map to distinct copy; elsewhere the
  // UI is keyed off the tracker step.
  const ui = isAwaitingPayment
    ? STATE_UI.payment
    : isPaymentSubmitted
    ? STATE_UI.payment_submitted
    : STATE_UI[current.key]
  const isPending = current.key === 'pending'
  const isCompleted = current.key === 'completed'

  // Vendor record gives us location + hours. PINNED: full-list getVendor, so an
  // in-flight order still resolves even if the store was suspended mid-flow.
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
                <p className="order-receipt__total-sub">Pay via GCash</p>
              </div>
              <strong className="order-receipt__total-amt"><Peso value={order.total} /></strong>
            </div>

            {/* Actions: Payment = pay form / waiting + Cancel, Pending = Cancel,
                Accepted/Ready = Contact, Completed = Reorder + Review */}
            <div className="order-actions">
              {isAwaitingPayment && (
                <>
                  {vendor && vendor.gcashNumber ? (
                    <PaymentForm
                      order={order}
                      vendor={vendor}
                      onSubmitted={async () => {
                        const refreshed = await fetchOrder()
                        if (refreshed) setOrder(refreshed)
                      }}
                    />
                  ) : (
                    <p className="order-pay__unavailable" role="status">
                      This vendor's payment details are unavailable right now.
                      Please contact the vendor before paying.
                    </p>
                  )}
                  <button
                    type="button"
                    className="order-btn order-btn--outline order-btn--block"
                    onClick={cancelOrder}
                    disabled={cancelling}
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel order'}
                  </button>
                  {cancelError && (
                    <p className="order-review__error" role="alert">{cancelError}</p>
                  )}
                </>
              )}

              {isPaymentSubmitted && (
                <>
                  <p className="order-pay__waiting" role="status">
                    Payment submitted{order.gcashReference ? <> — reference <strong>{order.gcashReference}</strong></> : null}.
                    Waiting for the vendor to confirm.
                  </p>
                  <button
                    type="button"
                    className="order-btn order-btn--outline order-btn--block"
                    onClick={cancelOrder}
                    disabled={cancelling}
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel order'}
                  </button>
                  {cancelError && (
                    <p className="order-review__error" role="alert">{cancelError}</p>
                  )}
                </>
              )}

              {isPending && (
                <>
                  <button
                    type="button"
                    className="order-btn order-btn--outline order-btn--block"
                    onClick={cancelOrder}
                    disabled={cancelling}
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel order'}
                  </button>
                  {cancelError && (
                    <p className="order-review__error" role="alert">{cancelError}</p>
                  )}
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