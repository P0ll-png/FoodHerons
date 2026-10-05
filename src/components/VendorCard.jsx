import { Link } from 'react-router-dom'
import Icon from './Icon'
import { categoryName } from '../data/vendors'
import './VendorCard.css'

export default function VendorCard({ vendor }) {
  const {
    id,
    name,
    locationArea,
    description,
    hoursOpen,
    hoursClose,
    isOpen,
    rating,
    reviews,
    preorderEnabled,
    coverTint,
    category,
  } = vendor

  return (
    <Link to={`/vendor/${id}`} className="vcard card" aria-label={`${name} store page`}>
      <div className="vcard__cover" style={{ background: coverTint }}>
        {/* Vendor photo placeholder — logo.png or vendor photo would go here */}
        <span className="vcard__cover-logo" aria-hidden="true">
          <img
            src="/logo.png"
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </span>
        <div className="vcard__cover-badges">
          <span className={`badge ${isOpen ? 'badge--open' : 'badge--closed'}`}>
            {isOpen ? 'Open now' : 'Closed'}
          </span>
          {preorderEnabled && (
            <span className="badge badge--preorder">Pre-order</span>
          )}
        </div>
      </div>

      <div className="vcard__body">
        <div className="vcard__head">
          <h3 className="vcard__name">{name}</h3>
          <span className="vcard__rating">
            <Icon name="star" size={15} className="vcard__star" />
            {rating}
            <span className="vcard__reviews">({reviews})</span>
          </span>
        </div>

        <p className="vcard__desc">{description}</p>

        <div className="vcard__meta">
          <span className="chip chip--active">{categoryName(category)}</span>
          <span className="vcard__meta-item">
            <Icon name="pin" size={15} /> {locationArea}
          </span>
          <span className="vcard__meta-item">
            <Icon name="clock" size={15} /> {hoursOpen}–{hoursClose}
          </span>
        </div>
      </div>
    </Link>
  )
}
