import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import VendorCard from '../components/VendorCard'
import BlobField from '../components/BlobField'
import { vendors, categories, locationAreas } from '../data/vendors'
import './Home.css'

export default function Home() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeArea, setActiveArea] = useState('all')
  const [openOnly, setOpenOnly] = useState(params.get('open') === '1')

  // Keep the "open now" URL param in sync so footer links work.
  useEffect(() => {
    if (params.get('open') === '1') setOpenOnly(true)
  }, [params])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vendors.filter((v) => {
      if (activeCategory !== 'all' && v.category !== activeCategory) return false
      if (activeArea !== 'all' && v.locationArea !== activeArea) return false
      if (openOnly && !v.isOpen) return false
      if (q) {
        const hay = `${v.name} ${v.description} ${v.locationArea}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [query, activeCategory, activeArea, openOnly])

  const openCount = vendors.filter((v) => v.isOpen).length

  const clearFilters = () => {
    setQuery('')
    setActiveCategory('all')
    setActiveArea('all')
    setOpenOnly(false)
    setParams({})
  }

  return (
    <>
      {/* ---------- Hero ---------- */}
      <section className="hero">
        <BlobField className="hero__blobs" />
        <div className="container hero__inner">
          <div className="hero__copy">
            <span className="hero__eyebrow">University of Makati</span>
            <h1 className="hero__title">
              Campus food, <span className="hero__hl">found fast.</span>
            </h1>
            <p className="hero__sub">
              Browse every food vendor near and within UMAK — including
              student-run sellers — all in one place. Pre-order where available,
              pay cash on pickup.
            </p>

            <form
              className="searchbar"
              role="search"
              onSubmit={(e) => e.preventDefault()}
            >
              <Icon name="search" className="searchbar__icon" />
              <input
                type="search"
                className="searchbar__input"
                placeholder="Search vendors, dishes or stall areas…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search vendors"
              />
              <button type="submit" className="btn btn--primary searchbar__btn">
                Search
              </button>
            </form>

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

      {/* ---------- Categories ---------- */}
      <section className="container section">
        <div className="section-head">
          <div>
            <h2>Browse by category</h2>
            <p>Find exactly what you're craving between classes.</p>
          </div>
        </div>
        <div className="cat-row">
          <button
            className={`cat-tile ${activeCategory === 'all' ? 'cat-tile--active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            <span className="cat-tile__emoji" aria-hidden="true">🍽️</span>
            <span className="cat-tile__label">All</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`cat-tile ${activeCategory === c.id ? 'cat-tile--active' : ''}`}
              onClick={() => setActiveCategory(c.id)}
            >
              <span className="cat-tile__emoji" aria-hidden="true">{c.emoji}</span>
              <span className="cat-tile__label">{c.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ---------- Directory ---------- */}
      <section className="container section" aria-labelledby="dir-heading">
        <div className="section-head">
          <div>
            <h2 id="dir-heading">Vendors near you</h2>
            <p>
              {filtered.length} {filtered.length === 1 ? 'vendor' : 'vendors'} match
              your filters
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="filters">
          <div className="filters__group">
            <label className="filters__label" htmlFor="area-select">Area</label>
            <select
              id="area-select"
              className="select"
              value={activeArea}
              onChange={(e) => setActiveArea(e.target.value)}
            >
              <option value="all">All areas</option>
              {locationAreas.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => {
                setOpenOnly(e.target.checked)
                if (!e.target.checked) setParams({})
              }}
            />
            <span className="toggle__track" aria-hidden="true">
              <span className="toggle__thumb" />
            </span>
            Open now only
          </label>

          <button className="btn btn--ghost filters__clear" onClick={clearFilters}>
            Clear filters
          </button>
        </div>

        {filtered.length > 0 ? (
          <div className="grid grid--cards">
            {filtered.map((v) => (
              <VendorCard key={v.id} vendor={v} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <span className="empty__emoji" aria-hidden="true">🔍</span>
            <h3>No vendors match</h3>
            <p className="text-muted">Try clearing a filter or searching something else.</p>
            <button className="btn btn--primary mt-4" onClick={clearFilters}>
              Reset filters
            </button>
          </div>
        )}
      </section>
    </>
  )
}
