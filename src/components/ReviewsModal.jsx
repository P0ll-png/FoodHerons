import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../components/Icon'
import './ReviewsModal.css'

/* ---------------------------------------------------------------------
   Reviews pop-up
   Reviews arrive via the `reviews` prop (fetched from Supabase by the parent).
   --------------------------------------------------------------------- */

const DAY = 86400000

const SORTS = [
  { key: 'top', label: 'Top reviews' },
  { key: 'newest', label: 'Newest' },
  { key: 'highest', label: 'Highest rating' },
  { key: 'lowest', label: 'Lowest rating' },
]

const timeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / DAY)
  if (d < 1) {
    const h = Math.floor(diff / 3600000)
    return h < 1 ? 'Just now' : `${h} hour${h === 1 ? '' : 's'} ago`
  }
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`
  if (d < 30) { const w = Math.floor(d / 7); return `${w} week${w === 1 ? '' : 's'} ago` }
  if (d < 365) { const m = Math.floor(d / 30); return `${m} month${m === 1 ? '' : 's'} ago` }
  const y = Math.floor(d / 365)
  return `${y} year${y === 1 ? '' : 's'} ago`
}

const Stars = ({ value, size }) => (
  <span className="rv-stars" role="img" aria-label={`${value} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} className={n <= Math.round(value) ? 'rv-stars__on' : 'rv-stars__off'}>
        <Icon name={n <= Math.round(value) ? 'starFilled' : 'star'} size={size} className="rv-star" />   {/* [CHANGE] solid star when filled, outline when empty */}
      </span>
    ))}
  </span>
)

export default function ReviewsModal({
  open,
  onClose,
  vendor,
  reviews = [],
  breakdown: breakdownProp,
  onOrder,
}) {
  const [sort, setSort] = useState('top')
  const [liked, setLiked] = useState({}) // review id -> true (local "Helpful" toggle)
  const closeRef = useRef(null)
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose) // always points at the latest onClose
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const isEmpty = reviews.length === 0

  /* Rating counts for the bars: vendor.ratingBreakdown, else counted from the list */
  const breakdown = useMemo(() => {
    if (breakdownProp) return breakdownProp
    const c = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    reviews.forEach((r) => { c[Math.min(5, Math.max(1, Math.round(r.rating)))]++ })
    return c
  }, [breakdownProp, reviews])
  const breakdownTotal = Object.values(breakdown).reduce((a, b) => a + (b || 0), 0) || 1

  const sorted = useMemo(() => {
    const list = [...reviews]
    const t = (r) => new Date(r.createdAt).getTime()
    switch (sort) {
      case 'newest': return list.sort((a, b) => t(b) - t(a))
      case 'highest': return list.sort((a, b) => b.rating - a.rating || t(b) - t(a))
      case 'lowest': return list.sort((a, b) => a.rating - b.rating || t(b) - t(a))
      default: return list.sort((a, b) => (b.helpful || 0) - (a.helpful || 0) || t(b) - t(a))
    }
  }, [reviews, sort])

  /* Open/close behaviour: Esc closes, page scroll locked, focus kept inside.
     Depends on `open` only, so a new onClose function from the parent
     does not reset the sort or steal focus. */
  useEffect(() => {
    if (!open) return undefined
    setSort('top')
    const prevFocus = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const f = dialogRef.current.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [open])

  if (!open || !vendor) return null

  const toggleHelpful = (id) => setLiked((s) => ({ ...s, [id]: !s[id] }))

  return createPortal(
    <div className="rv-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="rv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rv-title"
        ref={dialogRef}
      >
        {/* ---------- Header ---------- */}
        <header className="rv-head">
          <div className="rv-head__text">
            <h2 id="rv-title">{vendor.name}</h2>
            <p>Reviews</p>
          </div>
          <button ref={closeRef} type="button" className="rv-close" onClick={onClose} aria-label="Close reviews">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="rv-body">
         {isEmpty ? (
          /* ---------- Empty state: no reviews yet ---------- */
          <section className="rv-empty" aria-live="polite">
            <span className="rv-empty__icon" aria-hidden="true">
              <span><Icon name="starOutline" size={26} /></span>
            </span>
            <Stars value={0} size={14} />
            <h3>No reviews yet</h3>
            <p>
              Be the first to share how your order was. You can leave a review once you
              have picked up an order from this stall.
            </p>
            <button
              type="button"
              className="rv-empty__btn"
              onClick={() => { onClose(); onOrder?.() }}
            >
              Order from this stall
            </button>
          </section>
         ) : (
         <>
          {/* ---------- Rating summary ---------- */}
          <section className="rv-summary" aria-label="Rating summary">
            <div className="rv-summary__score">
              <strong>{Number(vendor.rating || 0).toFixed(1)}</strong>
              <Stars value={vendor.rating || 0} size={16} />
              <span>{Number(vendor.reviews || breakdownTotal).toLocaleString('en-PH')} ratings</span>
            </div>

            <ul className="rv-bars">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = breakdown[n] || 0
                const pct = Math.round((count / breakdownTotal) * 100)
                return (
                  <li key={n}>
                    <span className="rv-bars__label">{n}</span>
                    <Icon name="starFilled" size={13} className="rv-star" />   {/* [CHANGE] solid star, matches the filled stars */}
                    <span className="rv-bars__track" aria-hidden="true">
                      <span className="rv-bars__fill" style={{ width: `${Math.max(pct, count ? 2 : 0)}%` }} />
                    </span>
                    <span className="rv-sr">{pct}% gave {n} stars</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* ---------- Sort chips ---------- */}
          <div className="rv-sort" role="group" aria-label="Sort reviews">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`rv-chip ${sort === s.key ? 'rv-chip--active' : ''}`}
                aria-pressed={sort === s.key}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* ---------- Review list ---------- */}
          <ul className="rv-list">
            {sorted.map((r) => {
              const isLiked = !!liked[r.id]
              return (
                <li key={r.id} className="rv-card">
                  <p className="rv-card__name">{r.name}</p>
                  <div className="rv-card__meta">
                    <Stars value={r.rating} size={13} />
                    <span>{timeAgo(r.createdAt)}</span>
                  </div>
                  {r.ordered && <p className="rv-card__ordered">Ordered: {r.ordered}</p>}
                  <p className="rv-card__text">{r.text}</p>
                  <button
                    type="button"
                    className={`rv-helpful ${isLiked ? 'rv-helpful--on' : ''}`}
                    aria-pressed={isLiked}
                    onClick={() => toggleHelpful(r.id)}
                  >
                    <span className="rv-helpful__icon"><Icon name="thumb" size={16} /></span> Helpful · {(r.helpful || 0) + (isLiked ? 1 : 0)}
                  </button>
                </li>
              )
            })}
          </ul>
         </>
         )}
        </div>
      </div>
    </div>,
    document.body,
  )
}