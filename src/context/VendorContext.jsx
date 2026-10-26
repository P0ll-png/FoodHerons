import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { vendors as seedVendors } from '../data/vendors'

/* ------------------------------------------------------------------ */
/*  VendorContext: the ONE shared source of truth for stores + menus.  */

/* ------------------------------------------------------------------ */

// Bump this number whenever the shape of the starter data changes. Browsers that
// saved an older copy would otherwise keep showing it instead of the new data.
const STORAGE_KEY = 'fh-vendors-v2'
const OLD_STORAGE_KEYS = ['fh-vendors-v1']
const VendorContext = createContext()

// "HH:MM" -> minutes since midnight (used to compare opening hours).
const toMin = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number)
  return h * 60 + m
}

export const isOpenNow = (open, close, date = new Date()) => {
  const m = date.getHours() * 60 + date.getMinutes()
  const start = toMin(open)
  const end = toMin(close)
  return start <= end ? m >= start && m < end : m >= start || m < end
}

// Load saved vendors, or fall back to the starter data in data/vendors.js.
function loadVendors() {
  try {
    OLD_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k)) // clean up outdated saves
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (Array.isArray(saved) && saved.length) return saved
    }
  } catch {
    /* corrupted or blocked storage: use the starter data */
  }
  return seedVendors
}

export function VendorProvider({ children }) {
  const [rawVendors, setRawVendors] = useState(loadVendors)

  // Which vendor the dashboard is editing. Swap this for the logged-in vendor later.
  const currentVendorId = useMemo(
    () => (seedVendors.find((v) => v.preorderEnabled) ?? seedVendors[0]).id,
    []
  )

  // Save every change to localStorage (ignored if storage is full or blocked).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rawVendors))
    } catch {
      /* e.g. very large uploaded images: the change still works until refresh */
    }
  }, [rawVendors])

  // Re-check "open / closed" every minute so the status stays correct.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // Vendors with a live `isOpen`, worked out from their opening hours.
  const vendors = useMemo(
    () =>
      rawVendors.map((v) => ({
        ...v,
        isOpen: isOpenNow(v.hoursOpen, v.hoursClose, new Date(now)),
      })),
    [rawVendors, now]
  )

  // Find one vendor by id.
  const getVendor = useCallback((id) => vendors.find((v) => v.id === id), [vendors])

  // Helper: change one vendor and leave the others alone.
  const patchVendor = useCallback(
    (id, change) => setRawVendors((list) => list.map((v) => (v.id === id ? change(v) : v))),
    []
  )

  /* ---------- Edit functions (called by the vendor dashboard) ---------- */

  // Store info: name, description, category, location, hours, phone, logo, cover.
  const updateVendorInfo = useCallback(
    (id, info) => patchVendor(id, (v) => ({ ...v, ...info })),
    [patchVendor]
  )

  // Pre-ordering on/off.
  const setPreorderEnabled = useCallback(
    (id, on) => patchVendor(id, (v) => ({ ...v, preorderEnabled: on })),
    [patchVendor]
  )

  // Add a new menu item, or update it if the id already exists.
  const saveMenuItem = useCallback(
    (id, item) =>
      patchVendor(id, (v) => ({
        ...v,
        menu: (v.menu || []).some((m) => m.id === item.id)
          ? v.menu.map((m) => (m.id === item.id ? item : m))
          : [...(v.menu || []), item],
      })),
    [patchVendor]
  )

  // Sold out / available switch.
  const setItemAvailable = useCallback(
    (id, itemId, available) =>
      patchVendor(id, (v) => ({
        ...v,
        menu: (v.menu || []).map((m) => (m.id === itemId ? { ...m, available } : m)),
      })),
    [patchVendor]
  )

  // Remove a menu item.
  const deleteMenuItem = useCallback(
    (id, itemId) =>
      patchVendor(id, (v) => ({ ...v, menu: (v.menu || []).filter((m) => m.id !== itemId) })),
    [patchVendor]
  )

  const value = useMemo(
    () => ({
      vendors,
      currentVendorId,
      getVendor,
      updateVendorInfo,
      setPreorderEnabled,
      saveMenuItem,
      setItemAvailable,
      deleteMenuItem,
    }),
    [
      vendors,
      currentVendorId,
      getVendor,
      updateVendorInfo,
      setPreorderEnabled,
      saveMenuItem,
      setItemAvailable,
      deleteMenuItem,
    ]
  )

  return (
    <VendorContext.Provider value={value}>
      {children}
    </VendorContext.Provider>
  )
}

export function useVendors() {
  const ctx = useContext(VendorContext)
  if (!ctx) throw new Error('useVendors must be used within VendorProvider')
  return ctx
}