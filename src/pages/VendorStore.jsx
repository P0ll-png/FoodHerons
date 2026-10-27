import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { useVendors } from '../context/VendorContext'
import { useCart } from '../context/CartContext'
import NotFound from './NotFound'
import ReviewsModal from '../components/ReviewsModal'
import './VendorStore.css'

const Peso = ({ value }) => (
  <span className="price">
    <Icon name="peso" className="price__icon" />
    <span className="price__num">{Number(value || 0).toLocaleString('en-PH')}</span>
  </span>
)


export default function VendorStore() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { getVendor, categoryName } = useVendors()
  const vendor = getVendor(id)
  const { items, addItem, setQty, count, total, vendorId } = useCart()

 const [filter, setFilter] = useState('all')
  const [reviewsOpen, setReviewsOpen] = useState(false) // reviews pop-up
  const [reviews, setReviews] = useState([])            // real reviews from Supabase (read-only)

  // Load this vendor's reviews (newest first). The 'Ordered:' line uses the
  // ordered_summary snapshot column directly — no order_items join.
  useEffect(() => {
    let active = true
    supabase
      .from('reviews')
      .select('id, author_name, ordered_summary, rating, text, helpful_count, created_at')
      .eq('vendor_id', id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          console.error('Failed to load reviews:', error)
          setReviews([])
          return
        }
        setReviews(
          (data || []).map((r) => ({
            id: r.id,
            name: r.author_name,
            rating: r.rating,
            text: r.text,
            ordered: r.ordered_summary,
            helpful: r.helpful_count,
            createdAt: r.created_at,
          }))
        )
      })
    return () => {
      active = false
    }
  }, [id])

  const grouped = useMemo(() => {
    if (!vendor) return {}
    return (vendor.menu || []).reduce((acc, item) => {
      ;(acc[item.category] ||= []).push(item)
      return acc
    }, {})
  }, [vendor])
  

  if (!vendor) return <NotFound />
  const activeFilter = filter === 'all' || grouped[filter] ? filter : 'all'
  const shown = Object.entries(grouped).filter(([cat]) => activeFilter === 'all' || cat === activeFilter)
  const {
    name,
    description,
    locationArea,
    hoursOpen,
    hoursClose,
    isOpen,
    rating,
    reviews: reviewCount,
    preorderEnabled,
  } = vendor
  const canOrder = preorderEnabled && isOpen

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
      <div className="container">
       <div className="store-hero">
         <div className="store-hero__cover"
            style={vendor.cover ? { backgroundImage: `url("${vendor.cover}")` } : undefined}
            aria-hidden="true"
          />

        <div className="store-hero__row">
          <span className="store-hero__avatar" aria-hidden="true">
            {vendor.logo && (
                <img
                src={vendor.logo}
                alt=""
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
             )}
          </span>

        <div className="store-hero__info">
        <div className="store-hero__title">
          <h1>{name}</h1>
          <span className={`badge ${isOpen ? 'badge--open' : 'badge--closed'}`}>
            {isOpen ? 'Open Now' : 'Closed'}
          </span>
          <span className="store-hero__preorder">
            {preorderEnabled ? 'Available Pre-Order' : 'Listing only'}
          </span>
        </div>
        <p className="store-head__desc">{description}</p>
        <ul className="store-head__facts">
          <li>
            {/* Clicking the rating opens the reviews pop-up */}
            <button
              type="button"
              className="fact-rating"
              onClick={() => setReviewsOpen(true)}
              aria-haspopup="dialog"
              aria-label={`${rating} stars from ${reviewCount} ratings. See reviews`}
            >
              <Icon name="star" size={16} className="fact-star" /> {rating} ({reviewCount})
            </button>
          </li>
          <li><Icon name="pin" size={16} /> {locationArea}</li>
          <li><Icon name="clock" size={16} /> {hoursOpen}–{hoursClose}</li>
          {vendor.phone && (
            <li><a href={`tel:${vendor.phone.replace(/\s/g, '')}`}>{vendor.phone}</a></li>
          )}
        </ul>
      </div>
    </div>
  </div>
</div>

      {/* ---------- Body ---------- */}
      <div className="container store-body">
        <section className="store-menu" aria-label="Menu">
          {!preorderEnabled && (
           <p className="store-note">This vendor is not accepting pre-orders. Visit the stall to buy.</p>
         )}
          {preorderEnabled && !isOpen && (
           <p className="store-note store-note--closed">
             This store is closed right now. Pre-orders open at {hoursOpen}.
           </p>
         )}

     <div className="store-filter" role="group" aria-label="Filter menu by category">
      <span className="store-filter__label">Filter:</span>
      <button
       type="button"
       className={`store-filter__chip ${activeFilter === 'all' ? 'store-filter__chip--active' : ''}`}
       onClick={() => setFilter('all')}
       >
        All
      </button>
        {Object.keys(grouped).map((cat) => (
      <button
       key={cat}
       type="button"
       className={`store-filter__chip ${activeFilter === cat ? 'store-filter__chip--active' : ''}`}
       onClick={() => setFilter(cat)}
      >
       {categoryName(cat)}
     </button>
      ))}
     </div>
          {shown.map(([cat, menuItems]) =>  (
          <div key={cat} className="menu-group">
            <h3 className="menu-group__title">{categoryName(cat)}</h3>
            <ul className="menu-list">
            {menuItems.map((item) => {
              const qty = lineQty(item.id)
              const disabled = !item.available
              return (
              <li key={item.id} className={`menu-item ${disabled ? 'menu-item--out' : ''}`}>
              <div className="menu-item__thumb" aria-hidden="true">
                  {item.image && (
                  <img
                  src={item.image}
                  alt=""
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  )}
              </div>

            <div className="menu-item__info ">
              <p className="menu-item__name">
                {item.name}
                {disabled && <span className="menu-item__flag">Sold out</span>}
               </p>
               <p className="menu-item__desc">{item.desc ?? 'Campus food, found fast.'}</p>
               <p className="menu-item__price"><Peso value={item.price} /></p>
            </div>

          {canOrder && !disabled && (
            <div className="menu-item__action">
              {qty > 0 ? (
               <div className="stepper" role="group" aria-label={`Quantity of ${item.name}`}>
                 <button
                  type="button"
                  className="stepper__btn"
                  onClick={() => setQty(item.id, qty - 1)}
                  aria-label={qty === 1 ? `Remove ${item.name} from cart` : `Remove one ${item.name}`}
                >
                <Icon name={qty === 1 ? 'trash' : 'minus'} size={16} />
                </button>
                <span className="stepper__count" aria-live="polite">{qty}</span>
                <button type="button" className="stepper__btn"
                  onClick={() => addItem(vendor.id, item)}
                  aria-label={`Add one ${item.name}`}>
                <Icon name="plus" size={16} />
                </button>
           </div>
           ) : (
          <button type="button" className="menu-item__add"
                onClick={() => addItem(vendor.id, item)}>
          <Icon name="plus" size={14} /> Add
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
              <h3 className="order-box__title">Your Pre-Order</h3>
              {cartIsThisVendor && count > 0 ? (
           <>
          <ul className="order-box__lines">
              {Object.values(items).map(({ item, qty }) => (
              <li key={item.id}>
               <span className="order-box__name">{qty}x {item.name}</span>
               <span className="order-box__amt"><Peso value={item.price * qty} /></span>
              </li>
             ))}
          </ul>
           <div className="order-box__total">
             <span>TOTAL</span>
             <span><Peso value={total} /></span>
           </div>
           <button type="button" className="order-box__btn" onClick={() => navigate('/cart')}>
              Review Pre-Order
           </button>
           <p className="order-box__note">Cash on Pickup · No Online Payment</p>
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

      {/* ---------- Reviews pop-up ---------- */}
      <ReviewsModal
        open={reviewsOpen}
        onClose={() => setReviewsOpen(false)}
        vendor={vendor}
        reviews={reviews}
        onOrder={() =>
          document.querySelector('.store-menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      />

      {canOrder && cartIsThisVendor && count > 0 && (
              <button
        type="button"
        className="mobile-cartbar"
        onClick={() => navigate('/cart')}
        aria-label={`Review pre-order, ${count} item${count === 1 ? '' : 's'}, ${total} pesos`}
      >
      <span className="mobile-cartbar__count">{count}</span>
      <span className="mobile-cartbar__label">
        <strong>Review Pre-Order</strong>
        <small>{locationArea}</small>
      </span>
      <span className="mobile-cartbar__price">
       <Peso value={total} />
      </span>
    </button>
      )}
    </>
  )
}