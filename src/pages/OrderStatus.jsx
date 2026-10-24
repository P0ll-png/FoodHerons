import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { useVendors } from '../context/VendorContext' 
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

// Read the saved order (null if it is missing or the storage is unreadable).
function loadOrder(id) {
  try {
    const raw = sessionStorage.getItem(`order-${id}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function OrderStatus() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { getVendor, vendors } = useVendors()
  const order = useMemo(() => loadOrder(id), [id])
  const [stepIndex, setStepIndex] = useState(0)
  const [showCancel, setShowCancel] = useState(false) 

  useEffect(() => {
    if (stepIndex >= STEPS.length - 1) return
    const t = setTimeout(() => setStepIndex((i) => i + 1), 3500)
    return () => clearTimeout(t)
  }, [stepIndex])

  useEffect(() => {
    if (!showCancel) return
    const onKey = (e) => e.key === 'Escape' && setShowCancel(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showCancel])

  if (!order) {
    return (
      <div className="container section">
        <div className="cart-empty">
          <span className="cart-empty__emoji" aria-hidden="true">📦</span>
          <h1>Order not found</h1>
          <p className="text-muted">
            We couldn't find order {id}. It may have expired this session.
          </p>
          <Link to="/" className="btn btn--primary mt-4">Back to vendors</Link>
        </div>
      </div>
    )
  }

  /* ---------- Derived values ---------- */
  const current = STEPS[stepIndex]
  const ui = STATE_UI[current.key]
  const isPending = current.key === 'pending'
  const isCompleted = current.key === 'completed'

  // Vendor record gives us location + hours (prefer id, fall back to name).
  const vendor =
    (order.vendorId && getVendor(order.vendorId)) ||
    vendors.find((v) => v.name === order.vendorName)

  // Reorder goes back to the vendor's store (adjust the route to yours).
  const reorderTo = vendor ? `/vendor/${vendor.id}` : '/'

  // Runs after the student confirms in the popup.
  const handleCancel = () => {
    try {
      sessionStorage.removeItem(`order-${id}`)
    } catch {
    }
    setShowCancel(false)
    navigate('/')
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
          <p className="order-confirm__sub">{ui.subtitle(order)}</p>
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
                  {order.vendorName}
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

            {/* Actions: Pending = Cancel, Accepted/Ready = Contact, Completed = Reorder + Review */}
            <div className="order-actions">
              {isPending && (
                <button
                  type="button"
                  className="order-btn order-btn--outline order-btn--block"
                  onClick={() => setShowCancel(true)}
                >
                  Cancel order
                </button>
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
                    <button
                      type="button"
                      className="order-btn order-btn--outline"
                      onClick={() => {
                        /* TODO: open your review modal / route here */
                      }}
                    >
                      Leave a review
                    </button>
                  </div>
                  <Link to="/" className="order-another">
                    Order from another vendor
                  </Link>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* ---------- Cancel confirmation popup ---------- */}
      {showCancel && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCancel(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cancel-title" className="modal__title">Cancel this order?</h2>
            <p className="modal__text">
              Order <strong>{order.id}</strong> at <strong>{order.vendorName}</strong> will
              be removed. This can't be undone.
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="order-btn order-btn--outline"
                onClick={() => setShowCancel(false)}
                autoFocus
              >
                Keep order
              </button>
              <button
                type="button"
                className="order-btn order-btn--primary"
                onClick={handleCancel}
              >
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}