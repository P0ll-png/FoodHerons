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

// CHANGED: converts a stored 24-hour time ("08:00", "17:30", "08:00:00") to 12-hour format ("8:00 AM", "5:30 PM").
const to12h = (t) => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t ?? '').trim())
  if (!m) return t
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
}

const STEPS = [
  { key: 'payment', label: 'Payment', desc: 'Pay via GCash to confirm' },
  // [CHANGE] 'Pending' step removed from the tracker (payment -> accepted -> ready -> completed)
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
  // [CHANGE] 'pending' UI state (title, pill, subtitle) removed
  // [CHANGE] NEW: cancelled state. Before, cancelled orders fell back to the first step and
  // showed "Payment required / Awaiting payment". icon is null because the header draws a
  // plain ✕ for it (see the header below), so no new Icon name is needed.
  cancelled: {
    tone: 'cancelled',
    icon: null,
    title: 'Order canceled',
    pill: 'Canceled',
    subtitle: (o) => (
      <>
        Order <strong>{o.id}</strong> at <strong>{o.vendorName}</strong> was
        canceled.
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
  // [CHANGE] was 'pending'. There is no Pending step any more, so a legacy DB 'pending'
  // order is shown as 'accepted' (same as Profile.jsx, which also dropped Pending).
  pending: 'accepted',
  preparing: 'accepted',
  ready: 'ready',
  completed: 'completed',
}

// NEW: reasons offered in the cancel pop-up
const CANCEL_REASONS = ['Changed my mind', 'Ordered by mistake', 'Wrong items or details', 'Taking too long', 'Other']

// NEW: pop-up that asks the student why they are cancelling
function CancelDialog({ busy, error, onClose, onConfirm }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0])
  const [note, setNote] = useState('')
  const isOther = reason === 'Other'

  // Close with Escape (not while the request is running)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = (e) => {
    e.preventDefault()
    // "Other" needs typed text; other reasons can add an optional note
    const text = isOther ? note.trim() : [reason, note.trim()].filter(Boolean).join(' — ')
    if (text) onConfirm(text)
  }

  return (
    <div className="cancel-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title" onSubmit={submit}>
        <h2 id="cancel-title" className="cancel-modal__title">Cancel this order?</h2>
        <p className="cancel-modal__text">Tell us why you are cancelling. The vendor will see your reason.</p>

        <fieldset className="cancel-reasons">
          <legend className="visually-hidden">Reason for cancelling</legend>
          {CANCEL_REASONS.map((r) => (
            <label key={r} className={`cancel-reason ${reason === r ? 'is-active' : ''}`}>
              <input type="radio" name="cancel-reason" checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
        </fieldset>

        {/* Note: labelled field + short 2-row box (same layout as the vendor's reject pop-up) */}
        <div className="cancel-field">
          <label htmlFor="cancel-note">{isOther ? 'Tell us why (required)' : 'Note to vendor (optional)'}</label>
          <textarea id="cancel-note" className="cancel-note" rows={2} value={note} maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isOther ? 'Please tell us why you are cancelling.' : 'Anything the vendor should know?'} />
        </div>

        {error && <p className="order-review__error" role="alert">{error}</p>}

        {/* Buttons: right-aligned like the reject pop-up. Outline "Keep order" + solid red "Cancel order" */}
        <div className="cancel-modal__actions">
          <button type="button" className="order-btn order-btn--outline cancel-btn" onClick={onClose} disabled={busy}>Keep order</button>
          <button type="submit" className="order-btn cancel-btn cancel-btn--danger" disabled={busy || (isOther && !note.trim())}>
            {busy ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      </form>
    </div>
  )
}

// [CHANGE] The inline ReviewForm was replaced by this pop-up. It copies the "Write a Review"
// pop-up from the Reviews tab in Profile (same layout: vendor photo + "How was ...?" +
// "Order ... is ready to rate.", 5 outline stars, textarea, Save Review / Cancel).
// It uses its own os-rv-* classes (see OrderStatus.css) so it does not depend on Profile.css.
// [CHANGE] now also works as the "Edit Review" pop-up: pass `initial` ({ rating, text }) to pre-fill it
// (same as the Edit Review pop-up in Profile).
function ReviewDialog({ vendorName, orderCode, initial, onClose, onSubmit }) {
  const isEdit = !!initial
  const [rating, setRating] = useState(initial?.rating || 0)
  const [text, setText] = useState(initial?.text || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Close with Escape (not while the review is being saved)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async (e) => {
    e.preventDefault()
    if (!rating || busy) return // Save Review stays disabled until a star is picked
    setBusy(true)
    setError('')
    try {
      await onSubmit({ rating, text: text.trim() })
      // the parent closes the pop-up on success
    } catch (err) {
      setError(err?.message || 'Could not submit your review. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="os-rv-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="os-rv-modal" role="dialog" aria-modal="true" aria-labelledby="os-rv-title">
        <h2 id="os-rv-title" className="os-rv-modal__title">{isEdit ? 'Edit Review' : 'Write a Review'}</h2>
        <div className="os-rv-modal__top">
          <span className="os-rv-photo" aria-hidden="true" />
          <div className="os-rv-modal__who">
            {/* [CHANGE] edit mode uses the same wording as the Edit Review pop-up in Profile */}
            <h3>{isEdit ? vendorName : `How was ${vendorName}?`}</h3>
            <p>{isEdit ? 'Update your rating or comment.' : `Order ${orderCode} is ready to rate.`}</p>
          </div>
        </div>

        <form className="os-rv-form" onSubmit={submit}>
          <span className="os-rv-stars" role="radiogroup" aria-label={`${rating} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={n === rating}
                aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}>
                {/* same icon names as the Profile reviews tab: star = outline, starFilled = filled */}
                <Icon name={n <= rating ? 'starFilled' : 'star'} size={20} />
              </button>
            ))}
          </span>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="How was the food and pickup? (optional)" maxLength={280} />
          {error && <p className="order-review__error" role="alert">{error}</p>}
          <div className="os-rv-actions">
            <button type="submit" className="os-rv-btn os-rv-btn--primary" disabled={!rating || busy}>
              {busy ? 'Saving…' : 'Save Review'}
            </button>
            <button type="button" className="os-rv-btn os-rv-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// [CHANGE] NEW: small pop-up shown right after a review is saved (or updated)
function ThanksDialog({ title, text, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="os-rv-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="os-rv-modal os-rv-thanks" role="dialog" aria-modal="true" aria-labelledby="os-thanks-title">
        <span className="os-rv-thanks__icon" aria-hidden="true"><Icon name="check" size={26} /></span>
        <h2 id="os-thanks-title" className="os-rv-modal__title">{title}</h2>
        <p className="os-rv-thanks__text">{text}</p>
        <button type="button" className="os-rv-btn os-rv-btn--primary" onClick={onClose} autoFocus>Done</button>
      </div>
    </div>
  )
}

// NEW: Contact Vendor pop-up.
// - Vendor HAS a number: shows it large, with Call (opens the phone dialer) and Copy number buttons.
function ContactDialog({ vendorName, phone, orderId, onClose }) {
  const [copied, setCopied] = useState(false)
  const hasPhone = Boolean(phone && phone.trim())

  // Close with Escape
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Copy the number to the clipboard and show "Copied!" for a moment
  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(phone.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: the number is still shown on screen, so the student can copy it by hand */
    }
  }

  return (
    <div className="os-rv-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="os-rv-modal os-rv-thanks contact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-title">
        {/* Icon circle: orange phone when there is a number, gray info icon when there is not */}
        <span className={`contact-modal__icon ${hasPhone ? '' : 'contact-modal__icon--empty'}`} aria-hidden="true">
          {hasPhone ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
            </svg>
          ) : (
            <Icon name="info" size={26} />
          )}
        </span>

        {hasPhone ? (
          <>
            <h2 id="contact-title" className="os-rv-modal__title">Contact {vendorName}</h2>
            <p className="os-rv-thanks__text">Call or message about order <strong>{orderId}</strong>.</p>
            <p className="contact-modal__number">{phone.trim()}</p>
            <div className="contact-modal__actions">
              <a className="os-rv-btn os-rv-btn--primary" href={`tel:${phone.replace(/\s/g, '')}`}>Call now</a>
              <button type="button" className="os-rv-btn os-rv-btn--ghost" onClick={copyNumber}>
                {copied ? 'Copied!' : 'Copy number'}
              </button>
              <button type="button" className="contact-modal__close" onClick={onClose} autoFocus>Close</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="contact-title" className="os-rv-modal__title">No contact number yet</h2>
            <p className="os-rv-thanks__text">
              {vendorName} has not added a contact number. You can still follow your order on this page,
              or visit the stall and show your order number <strong>{orderId}</strong>.
            </p>
            <div className="contact-modal__actions">
              <button type="button" className="os-rv-btn os-rv-btn--primary" onClick={onClose} autoFocus>Got it</button>
            </div>
          </>
        )}
      </div>
    </div>
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
          {busy ? 'Submitting…' : 'Submit Payment Details'}
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
  const [showReview, setShowReview] = useState(false) // [CHANGE] now controls the review pop-up
  // [CHANGE] replaces `reviewed`: this order's saved review ({ id, rating, text }) or null.
  // While it is set, the button reads "Edit review" instead of "Leave a review".
  const [review, setReview] = useState(null)
  const [thanks, setThanks] = useState(null) // [CHANGE] NEW: text for the thank-you pop-up (null = closed)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [showCancel, setShowCancel] = useState(false) 
  const [showContact, setShowContact] = useState(false) 

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

  // [CHANGE] NEW: load this order's existing review (if any), so "Edit review" also shows after a
  const orderUuid = order?.uuid
  const orderStatus = order?.status
  useEffect(() => {
    if (!orderUuid || orderStatus !== 'completed') return
    let active = true
    supabase
      .from('reviews')
      .select('id, rating, text')
      .eq('order_id', orderUuid)
      .maybeSingle()
      .then(({ data }) => { if (active) setReview(data ?? null) })
    return () => { active = false }
  }, [orderUuid, orderStatus])

  // Student cancel: the reason comes from CancelDialog (no more window.prompt).
  // POST the transition through the order service, then refresh the order from
  // Supabase. ILLEGAL_TRANSITION means the vendor already moved the order on.
  const cancelOrder = async (reason) => {
    setCancelling(true)
    setCancelError('')
    try {
      await transitionOrder(order.uuid, { to: 'cancelled', reason })
      const refreshed = await fetchOrder()
      if (refreshed) setOrder(refreshed)
      setShowCancel(false) // close the pop-up on success
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
  const stepKey = DB_STATUS_TO_STEP[order.status] ?? 'payment'
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === stepKey))
  const current = STEPS[stepIndex]
  const isAwaitingPayment = order.status === 'awaiting_payment'
  const isPaymentSubmitted = order.status === 'payment_submitted'
  const isCancelled = order.status === 'cancelled' // [CHANGE] NEW
  // In the payment step, the two DB states map to distinct copy; elsewhere the
  // UI is keyed off the tracker step.
  // [CHANGE] cancelled is checked first so it never shows a payment/tracker state
  const ui = isCancelled
    ? STATE_UI.cancelled
    : isAwaitingPayment
    ? STATE_UI.payment
    : isPaymentSubmitted
    ? STATE_UI.payment_submitted
    : STATE_UI[current.key]
  // [CHANGE] isPending removed (no Pending step)
  const isCompleted = current.key === 'completed'

  // Vendor record gives us location + hours. PINNED: full-list getVendor, so an
  // in-flight order still resolves even if the store was suspended mid-flow.
  const vendor = order.vendorId && getVendor(order.vendorId)
  const vendorName = vendor?.name ?? 'the vendor'
  const orderForUi = { ...order, vendorName }

  // Reorder goes back to the vendor's store.
  const reorderTo = vendor ? `/vendor/${vendor.id}` : '/'

  // Save the review for this completed order.
  // [CHANGE] If a review already exists it is UPDATED (rating + text only); otherwise a new one is
  // inserted. The client sends ONLY these four fields on insert; student_id/author_name/ordered_summary
  // are filled by the DB trigger.
  const submitReview = async ({ rating, text }) => {
    if (review) {
      const { error } = await supabase.from('reviews').update({ rating, text }).eq('id', review.id)
      if (error) throw error
      setReview({ ...review, rating, text })
      return
    }
    const { data, error } = await supabase
      .from('reviews')
      .insert({ vendor_id: order.vendorId, order_id: order.uuid, rating, text })
      .select('id')
      .single()
    if (error) throw error
    setReview({ id: data.id, rating, text })
  }

  // Contact Vendor now opens a pop-up (shows the number, or a "no number yet" message)
  const handleContact = () => setShowContact(true)

  return (
    <div className="order-page">
      <div className="order-page__inner">
        {/* ---------- Header: icon + title + subtitle ---------- */}
        <header className="order-confirm">
          <span className={`state-icon state-icon--${ui.tone}`} aria-hidden="true">
            {/* [CHANGE] cancelled has no icon name, so draw a ✕ instead */}
            {ui.icon ? <Icon name={ui.icon} size={26} /> : <span style={{ fontSize: 24, lineHeight: 1 }}>✕</span>}
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

          {/* [CHANGE] A canceled order has no progress to track, so show a short message
              instead of the tracker */}
          {isCancelled && (
            <p className="text-muted" role="status">
              This order was canceled, so there is nothing left to track.
            </p>
          )}

          {/* Tracker*/}
          {!isCancelled && (
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
          )}
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
                  <span>Open {to12h(vendor.hoursOpen)} to {to12h(vendor.hoursClose)}</span> {/* CHANGED: 12-hour format */}
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

            {/* Actions: Payment = pay form / waiting + Cancel,
                Accepted/Ready = Contact, Completed = Reorder + Review
                [CHANGE] removed 'Pending = Cancel' */}
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
                    onClick={() => setShowCancel(true)} // opens the reason pop-up
                  >
                    Cancel order
                  </button>
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
                    onClick={() => setShowCancel(true)} // opens the reason pop-up
                  >
                    Cancel order
                  </button>
                </>
              )}

              {/* [CHANGE] Pending-state Cancel button block removed */}

              {/* [CHANGE] condition was `!isPending && !isCompleted`; isPending no longer exists.
                  Also hidden for canceled orders (nothing to contact the vendor about) */}
              {!isCompleted && !isCancelled && (
                <button
                  type="button"
                  className="order-btn order-btn--contact order-btn--block" /* CHANGED: new plain icon + text style (was order-btn--outline) */
                  onClick={handleContact}
                >
                  {/* CHANGED: chat-bubble icon before the label */}
                  <svg className="order-btn__icon" width="20" height="20" style={{ display: 'block', flex: 'none' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3C6.98 3 3 6.58 3 11c0 2.1.9 4 2.4 5.4L4.5 21l4.3-2.1c1 .3 2.1.4 3.2.4 5.02 0 9-3.58 9-8s-3.98-8-9-8z" />
                    <circle cx="8.5" cy="11" r="1.1" fill="currentColor" />
                    <circle cx="12" cy="11" r="1.1" fill="currentColor" />
                    <circle cx="15.5" cy="11" r="1.1" fill="currentColor" />
                  </svg>
                  Contact Vendor
                </button>
              )}

              {/* [CHANGE] NEW: canceled orders get Reorder + a link back to browsing */}
              {isCancelled && (
                <>
                  <Link to={reorderTo} className="order-btn order-btn--primary order-btn--block">
                    Reorder
                  </Link>
                  <Link to="/" className="order-another">
                    Order from another vendor
                  </Link>
                </>
              )}

              {isCompleted && (
                <>
                  <div className="order-actions__row">
                    <Link to={reorderTo} className="order-btn order-btn--primary">
                      Reorder
                    </Link>
                    {/* [CHANGE] no longer hidden after reviewing: it becomes "Edit review" */}
                    <button
                      type="button"
                      className="order-btn order-btn--outline"
                      onClick={() => setShowReview(true)}
                    >
                      {review ? 'Edit review' : 'Leave a review'}
                    </button>
                  </div>
                  {/* [CHANGE] inline "Thanks for your review!" text removed; a thank-you pop-up is used instead */}
                  <Link to="/" className="order-another">
                    Order from another vendor
                  </Link>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* [CHANGE] NEW: "Write a Review" pop-up (same as the Reviews tab in Profile) */}
      {showReview && (
        <ReviewDialog
          vendorName={vendorName}
          orderCode={order.id}
          initial={review} // [CHANGE] pre-fills the pop-up when editing
          onClose={() => setShowReview(false)}
          onSubmit={async (data) => {
            const wasEdit = !!review
            await submitReview(data)
            setShowReview(false)
            // [CHANGE] open the thank-you pop-up after saving
            setThanks(wasEdit
              ? { title: 'Review updated', text: 'Your changes have been saved.' }
              : { title: 'Thank you!', text: 'Thanks for your review. It helps other students pick where to eat.' })
          }}
        />
      )}

      {/* [CHANGE] NEW: thank-you pop-up */}
      {thanks && <ThanksDialog title={thanks.title} text={thanks.text} onClose={() => setThanks(null)} />}

      {/* NEW: Contact Vendor pop-up */}
      {showContact && (
        <ContactDialog
          vendorName={vendorName}
          phone={vendor?.phone}
          orderId={order.id}
          onClose={() => setShowContact(false)}
        />
      )}

      {/* NEW: cancel reason pop-up */}
      {showCancel && (
        <CancelDialog
          busy={cancelling}
          error={cancelError}
          onClose={() => { setShowCancel(false); setCancelError('') }}
          onConfirm={cancelOrder}
        />
      )}
    </div>
  )
}