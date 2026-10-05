import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useCart } from '../context/CartContext'
import { getVendor } from '../data/vendors'
import './Cart.css'

export default function Cart() {
  const { lines, count, total, setQty, vendorId, clearCart } = useCart()
  const navigate = useNavigate()
  const vendor = vendorId ? getVendor(vendorId) : null
  const [pickupName, setPickupName] = useState('')
  const [note, setNote] = useState('')

  const placeOrder = (e) => {
    e.preventDefault()
    // Simulate order creation — in production this hits the C# backend.
    const orderId = `FH-${Math.floor(1000 + Math.random() * 9000)}`
    const order = {
      id: orderId,
      vendorId,
      vendorName: vendor?.name,
      pickupName,
      note,
      lines: lines.map((l) => ({ name: l.item.name, qty: l.qty, price: l.item.price })),
      total,
      placedAt: new Date().toISOString(),
    }
    sessionStorage.setItem(`order-${orderId}`, JSON.stringify(order))
    clearCart()
    navigate(`/order/${orderId}`)
  }

  if (count === 0) {
    return (
      <div className="container section">
        <div className="cart-empty">
          <span className="cart-empty__emoji" aria-hidden="true">🛒</span>
          <h1>Your cart is empty</h1>
          <p className="text-muted">
            Browse campus vendors and add items from a store that accepts
            pre-orders.
          </p>
          <Link to="/" className="btn btn--primary mt-4">
            Discover vendors
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container section">
      <Link to={vendor ? `/vendor/${vendor.id}` : '/'} className="backlink">
        <Icon name="back" size={18} /> Back to {vendor?.name ?? 'store'}
      </Link>

      <h1 className="cart-title">Review your pre-order</h1>
      {vendor && (
        <p className="text-muted cart-vendor">
          <Icon name="store" size={16} /> {vendor.name} · {vendor.locationArea}
        </p>
      )}

      <div className="cart-grid">
        <section aria-label="Order items">
          <ul className="cart-lines">
            {lines.map(({ item, qty }) => (
              <li key={item.id} className="cart-line card">
                <div className="cart-line__info">
                  <p className="cart-line__name">{item.name}</p>
                  <p className="cart-line__price">₱{item.price} each</p>
                </div>
                <div className="stepper" role="group" aria-label={`Quantity of ${item.name}`}>
                  <button
                    className="stepper__btn"
                    onClick={() => setQty(item.id, qty - 1)}
                    aria-label={`Remove one ${item.name}`}
                  >
                    <Icon name="minus" size={16} />
                  </button>
                  <span className="stepper__count">{qty}</span>
                  <button
                    className="stepper__btn"
                    onClick={() => setQty(item.id, qty + 1)}
                    aria-label={`Add one ${item.name}`}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                </div>
                <span className="cart-line__amt">₱{item.price * qty}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside>
          <form className="checkout card" onSubmit={placeOrder}>
            <h2 className="checkout__title">Pickup details</h2>

            <div className="field">
              <label htmlFor="pickup-name">Your name</label>
              <input
                id="pickup-name"
                className="input"
                value={pickupName}
                onChange={(e) => setPickupName(e.target.value)}
                placeholder="e.g. Juan Dela Cruz"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="note">Note for vendor (optional)</label>
              <textarea
                id="note"
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. extra sauce, pick up at 12:30"
              />
            </div>

            <div className="checkout__summary">
              <div className="checkout__row">
                <span>Items ({count})</span>
                <span>₱{total}</span>
              </div>
              <div className="checkout__row checkout__row--total">
                <span>Total due on pickup</span>
                <strong>₱{total}</strong>
              </div>
            </div>

            <div className="checkout__pay">
              <Icon name="check" size={18} className="checkout__pay-icon" />
              <span>Cash on pickup — no online payment needed</span>
            </div>

            <button type="submit" className="btn btn--primary btn--block">
              Place pre-order
            </button>
            <p className="checkout__fine">
              This reserves your order. Pickup only, no delivery.
            </p>
          </form>
        </aside>
      </div>
    </div>
  )
}
