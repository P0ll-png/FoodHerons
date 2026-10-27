import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useCart } from '../context/CartContext'
import { useVendors } from '../context/VendorContext'
import { useAuth } from '../context/AuthContext'
import { postOrder } from '../lib/api'
import './Cart.css'

// Maps order-service error codes to friendly inline messages.
const ORDER_ERROR_MESSAGE = {
  ITEM_UNAVAILABLE: 'One of your items just became unavailable. Please review your cart and try again.',
  VENDOR_CLOSED: 'This vendor isn’t accepting pre-orders right now.',
  VALIDATION: 'Please check your order details and try again.',
}

const Peso = ({ value }) => (
  <span className="price">
    <Icon name="peso" className="price__icon" />
    <span className="price__num">{Number(value || 0).toLocaleString('en-PH')}</span>
  </span>
)


export default function Cart() {
  const navigate = useNavigate()
  const { lines, count, total, setQty, vendorId, clearCart } = useCart()
  const { getVendor } = useVendors() // live store data (edited from the vendor dashboard)
  const vendor = vendorId ? getVendor(vendorId) : null
  const { user } = useAuth()
  const [pickupName, setPickupName] = useState(user?.role === 'student' ? user.full_name ?? '' : '')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const closed = vendor ? !vendor.isOpen || !vendor.preorderEnabled : false

  // Place the order through the C# order service. The client sends only ids +
  // quantities — prices and totals are computed server-side (RLS forbids the
  // browser from writing orders/order_items). On success the cart is cleared
  // and we jump to the live status page for the returned order UUID.
  const placeOrder = async (e) => {
    e.preventDefault()
    if (closed || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const resp = await postOrder({
        vendorId,
        pickupName: pickupName.trim(),
        note: note.trim() || null,
        items: lines.map((l) => ({ menuItemId: l.item.id, qty: l.qty })),
      })
      clearCart()
      navigate('/order/' + resp.id)
    } catch (err) {
      setError(
        ORDER_ERROR_MESSAGE[err?.code] ||
          err?.message ||
          'We couldn’t place your order. Please try again.'
      )
      setSubmitting(false)
    }
  }

  if (count === 0) {
    return (
      <div className="container section">
        <div className="cart-empty">
          <span className="cart-empty__emoji" aria-hidden="true">
            <img src="/images/cart1.png" alt=""
              aria-hidden="true"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}/>
          </span>
          <h1 className = "cart-title">Empty Cart</h1>
          <p className="text-muted">
            Explore campus vendors and add your favorite meals to your cart.
          </p>
          <Link to="/" className="btn btn--primary mt-4">
            Explore Food
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

      <h1 className="cart-title">Review Your Order</h1>
      {vendor && (
        <p className="text-muted cart-vendor">
          <Icon name="store" size={16} /> {vendor.name} · {vendor.locationArea}
        </p>
      )}

      <div className="cart-grid">
        <section aria-label="Order items" className="cart-panel">
          <ul className="cart-lines">
            {lines.map(({ item, qty }) => (
              <li key={item.id} className="cart-line card">
                  <div className="cart-line__thumb" aria-hidden="true">
                   {item.image && (
                   <img
                   src={item.image}
                   alt=""
                   onError={(e) => { e.currentTarget.style.display = 'none' }}
                   />
                  )}
                  </div>
                <div className="cart-line__info">
                  <p className="cart-line__name">{item.name}</p>
                  <p className="cart-line__desc">{item.desc ?? 'Item Description/Details.'}</p>
                  <p className="cart-line__price"><Peso value={item.price} /></p>
                  
                </div>
                <div className="stepper" role="group" aria-label={`Quantity of ${item.name}`}>
                  <button
                    type="button"
                     className="stepper__btn"
                     onClick={() => setQty(item.id, qty - 1)}
                    aria-label={qty === 1 ? `Remove ${item.name} from cart` : `Remove one ${item.name}`}
                  >
                 <Icon name={qty === 1 ? 'trash' : 'minus'} size={16} />
                </button>
                  <span className="stepper__count">{qty}</span>
                  <button
                    type="button"
                    className="stepper__btn"
                    onClick={() => setQty(item.id, qty + 1)}
                    aria-label={`Add one ${item.name}`}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="cart-actions">  
          <Link to={vendor ? `/vendor/${vendor.id}` : '/'} className="cart-add">
          <span aria-hidden="true">+</span> Add more items
          </Link>
         <button type="button" className="cart-clear" onClick={clearCart}>
          Clear Cart
        </button>
        </div>
        </section>

        <aside>
          <form className="checkout card" onSubmit={placeOrder}>
            <h2 className="checkout__title">Pickup Information</h2>

            <div className="field">
              <label htmlFor="pickup-name">Your Name (Required) </label>
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
              <label htmlFor="note">Special Instructions (Optional)</label>
              <textarea
                id="note"
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. extra sauce, pick up at 12:30"
              />
            </div>

            <div className="checkout__summary">
              <div className="checkout__row ">
                <span>Items ({count})</span>
                <span><Peso value={total} /></span>
              </div>
              <div className="checkout__row checkout__row--total ">
                <span>TOTAL</span>
                 <strong><Peso value={total} /></strong>
              </div>
            </div>

            <div className="checkout__pay">
              <Icon name="check" size={18} className="checkout__pay-icon" />
              <span>Pay cash upon pickup at the counter</span>
            </div>

            {closed && (
              <p className="checkout__closed" role="alert">
                {vendor.name} isn't taking pre-orders right now. Open hours: {vendor.hoursOpen}–{vendor.hoursClose}.
              </p>
            )}

            {error && (
              <p className="checkout__closed" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn--primary btn--block" disabled={closed || submitting}>
              {submitting ? 'Placing order…' : 'Confirm Pre-Order'}
            </button>
            <p className="checkout__fine">
              This reserves your order for pickup only.
            </p>
          </form>
        </aside>
      </div>
    </div>
  )
}