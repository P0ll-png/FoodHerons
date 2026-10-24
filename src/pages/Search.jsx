import { useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Icon from '../components/Icon'            // every icon on this page comes from Icon.jsx
import VendorCard from '../components/VendorCard' // the same store card used on Home
import { categoryName } from '../data/vendors'
import { useVendors } from '../context/VendorContext' // live store data (edited from the vendor dashboard)
import './Search.css'

// ---- Settings ----
const STORAGE_KEY = 'fh-recent-searches' // where recent searches are saved in the browser
const MAX_RECENT = 8                      // how many recent searches to remember
const POPULAR_COUNT = 3                   // how many stalls to show under "Popular stalls"

// Read the saved recent searches. Falls back to an empty list if nothing is saved
// or the browser blocks storage.
function loadRecent() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

export default function Search() {
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { vendors } = useVendors() // live data, so dashboard edits show up in search
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(loadRecent)


  const persist = (list) => {
    setRecent(list)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    } catch {
    }
  }

  const saveRecent = (text) => {
    const t = text.trim()
    if (!t) return
    persist(
      [t, ...recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT)
    )
  }

  const removeRecent = (text) => persist(recent.filter((r) => r !== text))

  const goBack = () => (location.key === 'default' ? navigate('/') : navigate(-1))

  // ---------- Search results ----------

  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!q) return []
    return vendors.filter((v) => {
      const hay = [
        v.name,
        v.description,
        v.locationArea,
        categoryName(v.category),
        ...(v.menu || []).map((m) => m.name),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [q, vendors])

  const popular = useMemo(
    () =>
      [...vendors]
        .sort((a, b) => b.reviews - a.reviews || b.rating - a.rating)
        .slice(0, POPULAR_COUNT),
    [vendors]
  )

  return (
    <div className="search-page">
      <div className="container">
        {/* Top bar: back arrow + search box. Pressing Enter saves the search to "recent". */}
        <form
          className="search-page__bar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            saveRecent(query)
          }}
        >
          <button type="button" className="search-page__back" onClick={goBack} aria-label="Go back">
            <Icon name="arrowLeft" size={26} />
          </button>

          <label className="search-page__field">
            <Icon name="search" size={20} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendors, dishes or stall areas…"
              aria-label="Search vendors, dishes or stall areas"
              enterKeyHint="search"
              autoComplete="off"
              autoFocus
            />
            {/* Clear (x) button: only visible while something is typed */}
            {query && (
              <button
                type="button"
                className="search-page__clear"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                aria-label="Clear search"
              >
                <Icon name="close" size={18} />
              </button>
            )}
          </label>
        </form>

        {q ? (
          results.length > 0 ? (
            <div className="grid grid--cards" onClick={() => saveRecent(query)}>
              {results.map((v) => (
                <VendorCard key={v.id} vendor={v} />
              ))}
            </div>
          ) : (
            <p className="search-page__empty">No vendors match “{query.trim()}”.</p>
          )
        ) : (
          <>
            {recent.length > 0 ? (
              <section aria-labelledby="recent-heading">
                <h2 id="recent-heading" className="search-page__heading">Recent Searches</h2>
                <ul className="recent">
                  {recent.map((r) => (
                    <li key={r} className="recent__row">
                      <button
                        type="button"
                        className="recent__item"
                        onClick={() => {
                          setQuery(r)
                          saveRecent(r)
                        }}
                      >
                        <Icon name="history" size={22} />
                        <span>{r}</span>
                      </button>
                      {/* Remove this one recent search */}
                      <button
                        type="button"
                        className="recent__remove"
                        onClick={() => removeRecent(r)}
                        aria-label={`Remove ${r} from recent searches`}
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="search-page__empty">Search for vendors, dishes or stall areas.</p>
            )}
            {popular.length > 0 && (
              <section className="popular" aria-labelledby="popular-heading">
                <h2 id="popular-heading" className="search-page__heading popular__heading">
                  <Icon name="star" size={18} className="popular__icon" />
                  Popular stalls
                </h2>
                <p className="popular__sub">Most reviewed on campus</p>
                <div className="grid grid--cards">
                  {popular.map((v) => (
                    <VendorCard key={v.id} vendor={v} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}