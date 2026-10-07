import { useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import HeronMascot from '../components/HeronMascot'
import { getVendor, categoryName } from '../data/vendors'
import { useCart } from '../context/CartContext'
import NotFound from './NotFound'
import './VendorStore.css'

export default function VendorStore() {
  const { id } = useParams()
  const navigate = useNavigate()
  const vendor = getVendor(id)
  const { items, addItem, setQty, count, total, vendorId } = useCart()

  // Menu items grouped by category for display.
  const grouped = useMemo(() => {
    if (!vendor) return {}
    return vendor.menu.reduce((acc, item) => {
      ;(acc[item.category] ||= []).push(item)
      return acc
    }, {})
  }, [vendor])

  if (!vendor) return <NotFound />

  const {
    name,
    description,
    locationArea,
    hoursOpen,
    hoursClose,
    isOpen,
    rating,
    reviews,
    preorderEnabled,
    category,
    coverTint,
  } = vendor

  // Cart lines belong to this vendor only.
  const cartIsThisVendor = vendorId === vendor.id
  const lineQty = (itemId) =>
    cartIsThisVendor && items[itemId] ? items[itemId].qty : 0

  return (
    <>
      <div className="container store__back">
        <Link to="/" className="backlink">
          <Icon name="back" size={18} /> All vendors
        </Link>
      </div>

      {/* ---------- Store header ---------- */}
      <header className="store-head" style={{ background: coverTint }}>
        <div className="container store-head__inner">
          <span className="store-head__logo" aria-hidden="true">
            <HeronMascot className="logo-mascot" />
            <img
              src="/logo.png"
              alt=""
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          </span>
          <div className="store-head__meta">
            <div className="store-head__badges">
              <span className={`badge ${isOpen ? 'badge--open' : 'badge--closed'}`}>
                {isOpen ? 'Open now' : 'Closed'}
              </span>
              <span className="badge badge--preorder">
                {preorderEnabled ? 'Pre-order available' : 'Listing only'}
              </span>
            </div>
            <h1>{name}</h1>
            <p className="store-head__desc">{description}</p>
            <ul className="store-head__facts">
              <li><Icon name="starSolid" size={16} className="fact-star" /> {rating} ({reviews} reviews)</li>
              <li><Icon name="pin" size={16} /> {locationArea}</li>
              <li><Icon name="clock" size={16} /> {hoursOpen}–{hoursClose}</li>
              <li><span className="chip chip--active">{categoryName(category)}</span></li>
            </ul>
          </div>
        </div>
      </header>

      {/* ---------- Body ---------- */}
      <div className="container store-body">
        <section className="store-menu" aria-label="Menu">
          <div className="section-head">
            <div>
              <h2>{preorderEnabled ? 'Menu & pre-order' : 'Menu'}</h2>
              <p>
                {preorderEnabled
                  ? 'Add items, then review your pre-order. Pay cash on pickup.'
                  : 'This vendor is not accepting pre-orders. Visit the stall to buy.'}
              </p>
            </div>
          </div>

          {Object.entries(grouped).map(([cat, menuItems]) => (
            <div key={cat} className="menu-group">
              <h3 className="menu-group__title">{categoryName(cat)}</h3>
              <ul className="menu-list">
                {menuItems.map((item) => {
                  const qty = lineQty(item.id)
                  const disabled = !item.available
                  return (
                    <li
                      key={item.id}
                      className={`menu-item ${disabled ? 'menu-item--out' : ''}`}
                    >
                      <div className="menu-item__info">
                        <p className="menu-item__name">
                          {item.name}
                          {disabled && <span className="menu-item__flag">Sold out</span>}
                        </p>
                        {item.desc && (
                          <p className="menu-item__desc">{item.desc}</p>
                        )}
                        <p className="menu-item__price">₱{item.price}</p>
                      </div>

                      {preorderEnabled && !disabled && (
                        <div className="menu-item__action">
                          {qty > 0 ? (
                            <div className="stepper" role="group" aria-label={`Quantity of ${item.name}`}>
                              <button
                                className="stepper__btn"
                                onClick={() => setQty(item.id, qty - 1)}
                                aria-label={`Remove one ${item.name}`}
                              >
                                <Icon name="minus" size={16} />
                              </button>
                              <span className="stepper__count" aria-live="polite">{qty}</span>
                              <button
                                className="stepper__btn"
                                onClick={() => addItem(vendor.id, item)}
                                aria-label={`Add one ${item.name}`}
                              >
                                <Icon name="plus" size={16} />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn--primary menu-item__add"
                              onClick={() => addItem(vendor.id, item)}
                            >
                              <Icon name="plus" size={16} /> Add
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>

        {/* ---------- Order summary (pre-order vendors only) ---------- */}
        {preorderEnabled && (
          <aside className="store-aside">
            <div className="order-box card">
              <h3 className="order-box__title">Your pre-order</h3>
              {cartIsThisVendor && count > 0 ? (
                <>
                  <ul className="order-box__lines">
                    {Object.values(items).map(({ item, qty }) => (
                      <li key={item.id}>
                        <span className="order-box__qty">{qty}×</span>
                        <span className="order-box__name">{item.name}</span>
                        <span className="order-box__amt">₱{item.price * qty}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="order-box__total">
                    <span>Total</span>
                    <strong>₱{total}</strong>
                  </div>
                  <button
                    className="btn btn--primary btn--block"
                    onClick={() => navigate('/cart')}
                  >
                    Review pre-order
                  </button>
                  <p className="order-box__note">
                    Cash on pickup · No online payment
                  </p>
                </>
              ) : (
                <div className="order-box__empty">
                  <Icon name="cart" size={28} className="order-box__empty-icon" />
                  <p>Your cart is empty. Add items from the menu to start a pre-order.</p>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Mobile sticky cart bar for pre-order vendors */}
      {preorderEnabled && cartIsThisVendor && count > 0 && (
        <div className="mobile-cartbar">
          <div className="mobile-cartbar__info">
            <strong>{count} item{count === 1 ? '' : 's'}</strong>
            <span>₱{total}</span>
          </div>
          <button className="btn btn--primary" onClick={() => navigate('/cart')}>
            Review pre-order
          </button>
        </div>
      )}
    </>
  )
}
