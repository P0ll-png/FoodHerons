import { useMemo, useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import VendorCard from '../components/VendorCard'
import { categories, locationAreas } from '../data/vendors'
import { useVendors } from '../context/VendorContext'
import './Home.css'

/* ================================================================== */
/*  CONSTANTS & SMALL HELPERS                                          */
/* ================================================================== */

// If an <img> fails to load, hide it instead of showing a broken icon
const hideBroken = (e) => { e.currentTarget.style.display = 'none' }

/* ------------------------------------------------------------------ */
/*  useDragScroll: lets the category row be dragged with the mouse.    */
/*  Clicks right after a drag are cancelled so tiles don't trigger.    */
/* ------------------------------------------------------------------ */
function useDragScroll() {
  const ref = useRef(null)
  const drag = useRef({ down: false, startX: 0, scrollLeft: 0, moved: false })

  // Stop dragging (mouse released or left the row)
  const stop = () => {
    drag.current.down = false
    ref.current?.classList.remove('is-dragging')
  }

  return {
    ref,
    // Start dragging: remember the pointer + current scroll position
    onMouseDown: (e) => {
      drag.current = { down: true, startX: e.pageX, scrollLeft: ref.current.scrollLeft, moved: false }
    },
    // While dragging: scroll the row opposite to the pointer movement
    onMouseMove: (e) => {
      if (!drag.current.down) return
      const dx = e.pageX - drag.current.startX
      if (Math.abs(dx) > 5) {
        drag.current.moved = true
        ref.current.classList.add('is-dragging')
      }
      ref.current.scrollLeft = drag.current.scrollLeft - dx
    },
    onMouseUp: stop,
    onMouseLeave: () => { stop(); drag.current.moved = false }, // a drag that ends outside the row must not swallow the next click
    onClickCapture: (e) => {
      if (drag.current.moved) {
        e.preventDefault()
        e.stopPropagation()
        drag.current.moved = false
      }
    },
  }
}

/* ================================================================== */
/*  VendorResults                                                      */
/* ================================================================== */
function VendorResults({
  list,
  title,
  headingId,
  subtitle,
  action,
  initialOpenOnly = false,
  onOpenOnlyChange,
  showVendorHeading = false,
  showFilters = true,
}) {
  /* ---------- Filter state ---------- */
  const [area, setArea] = useState('all')
  const [openOnly, setOpenOnly] = useState(initialOpenOnly)

  // Turn "open only" on if the page was opened with ?open=1
  useEffect(() => {
    if (initialOpenOnly) setOpenOnly(true)
  }, [initialOpenOnly])

  // Apply the area + open-now filters to the list
  const shown = useMemo(
    () => list.filter((v) => (area === 'all' || v.locationArea === area) && (!openOnly || v.isOpen)),
    [list, area, openOnly]
  )

  // Reset every filter
  const clear = () => {
    setArea('all')
    setOpenOnly(false)
    onOpenOnlyChange?.(false)
  }

  return (
    <>
      {/* ---------- Section header (title + vendor count) ---------- */}
      {(title || subtitle) && (
        <div className="section-head">
          <div>
            {title && <h2 id={headingId} className="cats-panel__title">{title}</h2>}
            {subtitle && (
              <p>
                {shown.length} {shown.length === 1 ? 'vendor' : 'vendors'} {subtitle}
              </p>
            )}
          </div>
          {action}
        </div>
      )}

      {/* ---------- Filter bar: [Area select] [Open now toggle] [Clear] ---------- */}
      {showFilters && (
        <div className="filters">
          {/* Area dropdown */}
          <div className="filters__group">
            <label className="filters__label" htmlFor={`${headingId}-area`}>Area</label>
            <select
              id={`${headingId}-area`}
              className={`select${area === 'all' ? ' select--placeholder' : ''}`}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="all">All Areas</option>
              {locationAreas.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* "Open now only" switch ("only" is hidden on very small phones via CSS) */}
          <label className="toggle">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => {
                setOpenOnly(e.target.checked)
                onOpenOnlyChange?.(e.target.checked)
              }}
            />
            <span className="toggle__track" aria-hidden="true">
              <span className="toggle__thumb" />
            </span>
            <span className="toggle__text">
              Open now<span className="toggle__extra"> only</span>
            </span>
          </label>

          {/* Reset filters */}
          <button type="button" className="btn btn--ghost filters__clear" onClick={clear}>
            Clear filters
          </button>
        </div>
      )}

      {/* ---------- "Campus Vendors & Food Stalls" banner (category results only) ---------- */}
      {showVendorHeading && (
        <div className="vendor-heading">
          <h3 id={headingId} className="cats-panel__title">Food Stalls</h3>
          <span className="vendor-heading__count">
            {shown.length} {shown.length === 1 ? 'Vendor' : 'Vendors'} Available
          </span>
        </div>
      )}

      {/* ---------- Store cards grid, or empty state when nothing matches ---------- */}
      {shown.length > 0 ? (
        <div className="grid grid--cards">
          {shown.map((v) => (
            <VendorCard key={v.id} vendor={v} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="empty__emoji" aria-hidden="true">🔍</span>
          <h3>No vendors match</h3>
          <p className="text-muted">Try clearing a filter or searching something else.</p>
          <button type="button" className="btn btn--primary mt-4" onClick={clear}>
            Reset filters
          </button>
        </div>
      )}
    </>
  )
}

/* ================================================================== */
/*  Home page                                                          */
/* ================================================================== */
export default function Home() {
  /* ---------- State & data ---------- */
  const [params, setParams] = useSearchParams()
  const { vendors } = useVendors()                        // live store data (edited from the vendor dashboard)
  const [activeCategory, setActiveCategory] = useState(null) // clicked category tile (null = none yet)
  const resultsRef = useRef(null)                         // category results section (we scroll to it)
  const catScroll = useDragScroll()                       // drag-to-scroll for the category row

  /* ---------- Derived data ---------- */
  const openCount = vendors.filter((v) => v.isOpen).length

  // Vendors for the clicked category: their main category, or they sell an item in it
  const categoryVendors = useMemo(
    () =>
      activeCategory === null
        ? []
        : activeCategory === 'all'
        ? vendors // the "All" tile shows every vendor
        : vendors.filter(
            (v) => v.category === activeCategory || (v.menu || []).some((m) => m.category === activeCategory)
          ),
    [vendors, activeCategory]
  )

  /* ---------- Behaviour ---------- */
  // When a category is clicked, scroll down to its results
  useEffect(() => {
    if (activeCategory !== null) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [activeCategory])

  // Clicking the active tile again switches it off
  const pickCategory = (id) => setActiveCategory((cur) => (cur === id ? null : id))

  return (
    <>
      {/* ============================================================ */}
      {/*  HERO: title, tagline, search link, quick stats               */}
      {/* ============================================================ */}
      <section className="hero">
        {/* Decorative background blobs */}
        <span className="hero__blob hero__blob--tr" aria-hidden="true" />
        <span className="hero__blob hero__blob--bl" aria-hidden="true" />
        <span className="hero__blob hero__blob--br" aria-hidden="true" />

        {/* Decorative bowl images */}
        <img className="hero__bowl hero__bowl--left"   src="/images/bowl.png" alt="" onError={hideBroken} />
        <img className="hero__bowl hero__bowl--top"    src="/images/bowl.png" alt="" onError={hideBroken} />
        <img className="hero__bowl hero__bowl--bottom" src="/images/bowl.png" alt="" onError={hideBroken} />

        <div className="container hero__inner">
          <div className="hero__copy">
            <span className="hero__eyebrow">University of Makati</span>
            <h1 className="hero__title">FOOD HERONS</h1>
            <p className="hero__sub">Fly straight to the best food near Campus.</p>

            {/* Search bar (links to the /search page) */}
            <Link to="/search" className="searchbar" aria-label="Search vendors, dishes or stall areas">
              <Icon name="search" className="searchbar__icon" />
              <span className="searchbar__placeholder">vendors, dishes or stall areas...</span>
            </Link>

            {/* Quick stats */}
            <div className="hero__stats">
              <span><strong>{vendors.length}</strong> vendors</span>
              <span className="dot" aria-hidden="true">·</span>
              <span><strong>{openCount}</strong> open now</span>
              <span className="dot" aria-hidden="true">·</span>
              <span><strong>{categories.length}</strong> categories</span>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  MAIN PANEL: categories → category results → map → directory  */}
      {/* ============================================================ */}
      <section className="cats-panel">

        {/* ---------- Browse by category ---------- */}
        <div className="container section">
          <div className="section-head">
            <div>
              <h2 className="cats-panel__title">Browse by category</h2>
              <p className="cats-panel__sub">Find exactly what you're craving between classes.</p>
            </div>
          </div>

          {/* Horizontally scrollable row of category tiles */}
          <div className="cat-row" {...catScroll}>
         {/* "All" tile */}
        <button
             type="button"
                className={`cat-tile ${activeCategory === 'all' ? 'cat-tile--active' : ''}`}
          onClick={() => pickCategory('all')}
         >
         <span className="cat-tile__art">
         <span className="cat-tile__plate">
         <Icon
           name="all"
          size={36}
          className="cat-tile__all-icon"
          />
         </span>
        </span>
         <span className="cat-tile__label">All</span>
         </button>
            {/* One tile per category (image, or emoji fallback) */}
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`cat-tile ${activeCategory === c.id ? 'cat-tile--active' : ''}`}
                onClick={() => pickCategory(c.id)}
              >
                <span className="cat-tile__art">
                  <span className="cat-tile__plate">
                    {c.image
                      ? <img src={c.image} alt="" onError={hideBroken} />
                      : <span className="cat-tile__emoji" aria-hidden="true">{c.emoji}</span>}
                  </span>
                </span>
                <span className="cat-tile__label">{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ---------- Category results (shown after a tile is clicked) ---------- */}
        {activeCategory !== null && (
          <div
            className="container section cat-results"
            ref={resultsRef}
            role="region"
            aria-labelledby="cat-results-heading"
          >
            <VendorResults
              key={activeCategory}
              list={categoryVendors}
              headingId="cat-results-heading"
              showFilters={false}
              showVendorHeading={true}
            />
          </div>
        )}

        {/* ---------- Campus map & location ---------- */}
        <div className="container section map-section">
          <div className="section-head">
            <div>
              <h2 className="cats-panel__title">Campus Map &amp; Location</h2>
              <p>Find food spots relative to your current location near University of Makati.</p>
            </div>
          </div>

          <div className="map-container">
            <iframe
              title="University of Makati Map"
              src="https://www.google.com/maps?q=University+of+Makati&output=embed"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            ></iframe>
          </div>
        </div>

        {/* ---------- Directory: Vendors near you (with filter bar) ---------- */}
        <div className="container section" role="region" aria-labelledby="dir-heading">
          <VendorResults
            list={vendors}
            headingId="dir-heading"
            title="Vendors near you"
            subtitle="match your filters"
            showFilters={true}
            showVendorHeading={false}
            initialOpenOnly={params.get('open') === '1'}
            onOpenOnlyChange={(on) => { if (!on && params.get('open')) setParams({}, { replace: true }) }}
          />
        </div>
      </section>

      {/* ============================================================ */}
      {/*  VENDOR CTA: invite stall owners to sign up                   */}
      {/* ============================================================ */}
      <section className="cta">
        <div className="container cta__inner">
          <div className="cta__art">
            <img src="/images/stall.png" alt="" onError={hideBroken} />
          </div>
          <div className="cta__copy">
            <h2 className="cta__title">Own a food stall near Campus?</h2>
            <p className="cta__sub">Be the next Campus favorite.</p>
            <Link to="/signup?role=vendor" className="cta__btn">Partner with us.</Link>
          </div>
        </div>
      </section>
    </>
  )
}