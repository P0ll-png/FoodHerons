import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { useCart } from '../context/CartContext'
import { useVendors } from '../context/VendorContext'
import { useAuth } from '../context/AuthContext'
import './Cart.css'

const Peso = ({ value }) => (
  <span className="price">
    <Icon name="peso" className="price__icon" />
    <span className="price__num">{Number(value || 0).toLocaleString('en-PH')}</span>
  </span>
)


export default function Cart() {
  const { lines, count, total, setQty, vendorId, clearCart } = useCart()
  const { getVendor } = useVendors() // live store data (edited from the vendor dashboard)
  const vendor = vendorId ? getVendor(vendorId) : null
  const { user } = useAuth()
  const [pickupName, setPickupName] = useState(user?.role === 'student' ? user.full_name ?? '' : '')
  const [note, setNote] = useState('')
  const closed = vendor ? !vendor.isOpen || !vendor.preorderEnabled : false

  const placeOrder = (e) => {
    e.preventDefault()
    if (closed) return
    // TODO(Phase C): POST /api/orders { vendorId, pickupName, note, lines } then navigate('/order/'+id).
    // The client never writes orders/order_items to Supabase (RLS forbids it); the C# order service
    // computes totals server-side and creates the order. Until it ships, keep the cart intact and
    // tell the student order placement is coming soon (see the inline message on the confirm button).
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

            {/* Phase-C placeholder: order placement is handled by the C# order service, not the client. */}
            <p className="checkout__closed" role="status">
              Order placement is coming soon (handled by the order service). Your cart is saved.
            </p>

            <button type="submit" className="btn btn--primary btn--block" disabled>
              Confirm Pre-Order
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