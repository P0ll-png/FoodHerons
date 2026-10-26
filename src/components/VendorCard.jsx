import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { categoryName } from '../data/vendors'
import './VendorCard.css'

export default function VendorCard({ vendor, isFavorite, onToggleFavorite }) {
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
    cover,
  } = vendor

  const isControlled = typeof isFavorite === 'boolean'
  const [localFav, setLocalFav] = useState(false)
  const fav = isControlled ? isFavorite : localFav

  const handleFavorite = (e) => {
    // The card is a <Link>, so stop the click from navigating
    e.preventDefault()
    e.stopPropagation()
    const next = !fav
    if (!isControlled) setLocalFav(next)
    onToggleFavorite?.(id, next)
  }

  return (
    <Link to={`/vendor/${id}`} className="vcard card" aria-label={`${name} store page`}>
      {/* Cover photo from the vendor dashboard; falls back to the tint colour.
          The url is quoted so file names with spaces or brackets still load. */}
      <div
        className="vcard__cover"
        style={{
          backgroundColor: coverTint,
          ...(cover ? { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}
      >
        {/* Store logo from the vendor dashboard; falls back to the placeholder logo */}

        <div className="vcard__cover-badges">
          <span className={`badge ${isOpen ? 'badge--open' : 'badge--closed'}`}>
            {isOpen ? 'Open now' : 'Closed'}
          </span>
          {preorderEnabled && (
            <span className="badge badge--preorder">Pre-order</span>
          )}
        </div>

        <button
          type="button"
          className={`vcard__fav${fav ? ' is-active' : ''}`}
          onClick={handleFavorite}
          aria-pressed={fav}
          aria-label={fav ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
        >
          <Icon name={fav ? 'heartFilled' : 'heart'} size={20} />
        </button>
      </div>

      <div className="vcard__body">
        <div className="vcard__head">
          <h3 className="vcard__name">{name}</h3>
          <span className="vcard__rating">
            <Icon name="starSolid" size={15} className="vcard__star" />
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