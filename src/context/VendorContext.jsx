import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

/* ------------------------------------------------------------------ */
/*  VendorContext: the ONE shared source of truth for stores + menus.  */
/*  Data is read from Supabase (vendors + menu_items + categories +    */
/*  location_areas). The DB uses snake_case; the UI uses camelCase, so  */
/*  this file is the ONE place that maps between the two.               */
/* ------------------------------------------------------------------ */

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

// snake_case menu_items row -> camelCase UI menu item.
const mapMenuItem = (r) => ({
  id: r.id,
  name: r.name,
  price: r.price,
  category: r.category,
  available: r.available,
  desc: r.description,
  image: r.image_url,
})

// snake_case vendors row (+ its grouped menu) -> camelCase UI vendor.
const mapVendor = (r, menu) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  locationArea: r.location_area,
  description: r.description,
  hoursOpen: r.hours_open,
  hoursClose: r.hours_close,
  rating: r.rating,
  reviews: r.review_count,
  phone: r.phone,
  preorderEnabled: r.preorder_enabled,
  coverTint: r.cover_tint,
  logo: r.logo_url,
  cover: r.cover_url,
  ownerId: r.owner_id,
  menu,
})

export function VendorProvider({ children }) {
  const { user } = useAuth()

  const [rawVendors, setRawVendors] = useState([]) // mapped vendors, WITHOUT the live isOpen
  const [categories, setCategories] = useState([])
  const [locationAreas, setLocationAreas] = useState([])
  const [loading, setLoading] = useState(true)

  // Fetch vendors + menu_items (both public SELECT), group items under their
  // vendor, and map snake->camel to the UI shape.
  const loadVendors = useCallback(async () => {
    const [vendorsRes, itemsRes] = await Promise.all([
      supabase.from('vendors').select('*'),
      supabase.from('menu_items').select('*'),
    ])
    if (vendorsRes.error) {
      console.error('Failed to load vendors:', vendorsRes.error)
      return
    }
    if (itemsRes.error) {
      console.error('Failed to load menu items:', itemsRes.error)
      return
    }
    const itemsByVendor = {}
    for (const row of itemsRes.data || []) {
      ;(itemsByVendor[row.vendor_id] ||= []).push(mapMenuItem(row))
    }
    const mapped = (vendorsRes.data || []).map((v) => mapVendor(v, itemsByVendor[v.id] || []))
    setRawVendors(mapped)
  }, [])

  // Fetch the category + location-area lookup tables.
  const loadLookups = useCallback(async () => {
    const [catsRes, areasRes] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('location_areas').select('*').order('sort_order'),
    ])
    if (catsRes.error) console.error('Failed to load categories:', catsRes.error)
    else setCategories((catsRes.data || []).map((c) => ({ id: c.id, name: c.name, image: c.image })))

    if (areasRes.error) console.error('Failed to load location areas:', areasRes.error)
    else setLocationAreas((areasRes.data || []).map((a) => ({ id: a.id, name: a.name })))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([loadVendors(), loadLookups()]).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadVendors, loadLookups])

  // Which vendor the dashboard is editing: the store owned by the logged-in
  // vendor. Null when no owned store is found (Dashboard shows "Store not found").
  const currentVendorId = useMemo(
    () => rawVendors.find((v) => v.ownerId && v.ownerId === user?.id)?.id ?? null,
    [rawVendors, user?.id]
  )

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

  // Category id -> display name (falls back to the id).
  const categoryName = useCallback(
    (id) => categories.find((c) => c.id === id)?.name ?? id,
    [categories]
  )

  /* ---------- Edit functions (called by the vendor dashboard) ---------- */
  /* Each issues a Supabase write (camel->snake) then re-fetches the rows.   */
  /* owner_id / rating / review_count are NEVER sent from the client.        */

  // Store info: name, description, category, location, hours, phone, logo, cover.
  const updateVendorInfo = useCallback(
    async (id, info) => {
      const patch = {}
      if (info.name !== undefined) patch.name = info.name
      if (info.description !== undefined) patch.description = info.description
      if (info.category !== undefined) patch.category = info.category
      if (info.locationArea !== undefined) patch.location_area = info.locationArea
      if (info.hoursOpen !== undefined) patch.hours_open = info.hoursOpen
      if (info.hoursClose !== undefined) patch.hours_close = info.hoursClose
      if (info.phone !== undefined) patch.phone = info.phone
      if (info.logo !== undefined) patch.logo_url = info.logo
      if (info.cover !== undefined) patch.cover_url = info.cover

      const { error } = await supabase.from('vendors').update(patch).eq('id', id)
      if (error) {
        console.error('Failed to update vendor info:', error)
        return
      }
      await loadVendors()
    },
    [loadVendors]
  )

  // Pre-ordering on/off.
  const setPreorderEnabled = useCallback(
    async (id, on) => {
      const { error } = await supabase.from('vendors').update({ preorder_enabled: on }).eq('id', id)
      if (error) {
        console.error('Failed to update pre-order flag:', error)
        return
      }
      await loadVendors()
    },
    [loadVendors]
  )

  // Add a new menu item, or update it if the (vendor_id, id) already exists.
  const saveMenuItem = useCallback(
    async (id, item) => {
      const { error } = await supabase.from('menu_items').upsert({
        vendor_id: id,
        id: item.id,
        name: item.name,
        price: item.price,
        category: item.category,
        available: item.available,
        description: item.desc,
        image_url: item.image,
      })
      if (error) {
        console.error('Failed to save menu item:', error)
        return
      }
      await loadVendors()
    },
    [loadVendors]
  )

  // Sold out / available switch.
  const setItemAvailable = useCallback(
    async (id, itemId, available) => {
      const { error } = await supabase
        .from('menu_items')
        .update({ available })
        .eq('vendor_id', id)
        .eq('id', itemId)
      if (error) {
        console.error('Failed to update item availability:', error)
        return
      }
      await loadVendors()
    },
    [loadVendors]
  )

  // Remove a menu item.
  const deleteMenuItem = useCallback(
    async (id, itemId) => {
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('vendor_id', id)
        .eq('id', itemId)
      if (error) {
        console.error('Failed to delete menu item:', error)
        return
      }
      await loadVendors()
    },
    [loadVendors]
  )

  const value = useMemo(
    () => ({
      vendors,
      categories,
      locationAreas,
      categoryName,
      loading,
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
      categories,
      locationAreas,
      categoryName,
      loading,
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
