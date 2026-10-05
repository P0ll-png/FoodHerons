import { createContext, useContext, useMemo, useState } from 'react'

const CartContext = createContext()

// Cart is scoped to a single vendor at a time (pre-orders are per vendor).
export function CartProvider({ children }) {
  const [vendorId, setVendorId] = useState(null)
  const [items, setItems] = useState({}) // { menuItemId: { item, qty } }

  const addItem = (vId, item) => {
    setItems((prev) => {
      // Switching vendors clears the previous cart.
      const base = vId === vendorId ? prev : {}
      const existing = base[item.id]
      return {
        ...base,
        [item.id]: { item, qty: existing ? existing.qty + 1 : 1 },
      }
    })
    setVendorId(vId)
  }

  const setQty = (itemId, qty) => {
    setItems((prev) => {
      if (qty <= 0) {
        const next = { ...prev }
        delete next[itemId]
        return next
      }
      return { ...prev, [itemId]: { ...prev[itemId], qty } }
    })
  }

  const clearCart = () => {
    setItems({})
    setVendorId(null)
  }

  const { count, total, lines } = useMemo(() => {
    const lines = Object.values(items)
    return {
      lines,
      count: lines.reduce((n, l) => n + l.qty, 0),
      total: lines.reduce((n, l) => n + l.qty * l.item.price, 0),
    }
  }, [items])

  return (
    <CartContext.Provider
      value={{ vendorId, items, lines, count, total, addItem, setQty, clearCart }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
