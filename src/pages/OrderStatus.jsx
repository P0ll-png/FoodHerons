import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import './OrderStatus.css'

const STEPS = [
  { key: 'pending', label: 'Pending', desc: 'Sent to the vendor' },
  { key: 'accepted', label: 'Accepted', desc: 'Vendor is preparing your order' },
  { key: 'ready', label: 'Ready for pickup', desc: 'Head to the stall' },
  { key: 'completed', label: 'Completed', desc: 'Picked up & paid' },
]

export default function OrderStatus() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const raw = sessionStorage.getItem(`order-${id}`)
    if (raw) setOrder(JSON.parse(raw))
  }, [id])

  // Simulated status progression so the tracker feels alive.
  useEffect(() => {
    if (stepIndex >= STEPS.length - 1) return
    const t = setTimeout(() => setStepIndex((i) => i + 1), 3500)
    return () => clearTimeout(t)
  }, [stepIndex])

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

  const current = STEPS[stepIndex]

  return (
    <div className="container section">
      <div className="order-confirm">
        <span className="order-confirm__check" aria-hidden="true">
          <Icon name="check" size={30} />
        </span>
        <h1>Pre-order placed!</h1>
        <p className="text-muted">
          Order <strong>{order.id}</strong> at <strong>{order.vendorName}</strong>
        </p>
      </div>

      <div className="order-track card">
        <h2 className="order-track__title">Order status</h2>
        <p className="order-track__now">
          Currently: <span className="badge badge--preorder">{current.label}</span>
        </p>

        <ol className="tracker">
          {STEPS.map((step, i) => {
            const state =
              i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'upcoming'
            return (
              <li key={step.key} className={`tracker__step tracker__step--${state}`}>
                <span className="tracker__dot" aria-hidden="true">
                  {state === 'done' ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <div className="tracker__text">
                  <p className="tracker__label">{step.label}</p>
                  <p className="tracker__desc">{step.desc}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="order-receipt card">
        <h2 className="order-receipt__title">Order summary</h2>
        <ul className="order-receipt__lines">
          {order.lines.map((l, idx) => (
            <li key={idx}>
              <span className="order-box__qty">{l.qty}×</span>
              <span>{l.name}</span>
              <span className="order-receipt__amt">₱{l.price * l.qty}</span>
            </li>
          ))}
        </ul>
        <div className="order-receipt__total">
          <span>Total (cash on pickup)</span>
          <strong>₱{order.total}</strong>
        </div>
        {order.pickupName && (
          <p className="order-receipt__meta">Pickup name: {order.pickupName}</p>
        )}
        {order.note && (
          <p className="order-receipt__meta">Note: {order.note}</p>
        )}
      </div>

      <div className="center mt-4">
        <Link to="/" className="btn btn--ghost">Order from another vendor</Link>
      </div>
    </div>
  )
}
