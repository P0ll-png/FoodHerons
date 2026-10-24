import { createContext, useCallback, useContext, useMemo, useReducer } from 'react'
import { useVendors } from './VendorContext'

const CartContext = createContext()

// Cart is scoped to a single vendor at a time (pre-orders are per vendor).
// The cart only remembers item IDs and quantities. Names, prices and images
// are looked up from VendorContext every time, so when the vendor edits an
// item in the dashboard the cart updates automatically.
//
// The vendor and the quantities live in ONE reducer state so that "which
// vendor is this cart for?" and "what is in it?" always change together.
// (With two separate states, two quick clicks after switching vendors could
// each start from an empty cart and one item would be lost.)
const EMPTY_CART = { vendorId: null, qtys: {} } // qtys: { menuItemId: quantity }

function cartReducer(state, action) {
  switch (action.type) {
    // Add one of an item. Adding from a different vendor starts a fresh cart.
    case 'add': {
      const base = action.vendorId === state.vendorId ? state.qtys : {}
      return {
        vendorId: action.vendorId,
        qtys: { ...base, [action.itemId]: (base[action.itemId] ?? 0) + 1 },
      }
    }
    // Set an exact quantity (0 or less removes the item).
    case 'set': {
      if (action.qty <= 0) {
        const { [action.itemId]: removed, ...rest } = state.qtys
        return { ...state, qtys: rest }
      }
      return { ...state, qtys: { ...state.qtys, [action.itemId]: action.qty } }
    }
    case 'clear':
      return EMPTY_CART
    default:
      return state
  }
}

export function CartProvider({ children }) {
  const { getVendor } = useVendors()
  const [{ vendorId, qtys }, dispatch] = useReducer(cartReducer, EMPTY_CART)

  const addItem = useCallback((vId, item) => dispatch({ type: 'add', vendorId: vId, itemId: item.id }), [])
  const setQty = useCallback((itemId, qty) => dispatch({ type: 'set', itemId, qty }), [])
  const clearCart = useCallback(() => dispatch({ type: 'clear' }), [])

  // Build the live cart: current item data + quantity.
  // Items the vendor deleted or marked sold out are left out automatically.
  const { items, lines, count, total } = useMemo(() => {
    const menu = (vendorId ? getVendor(vendorId)?.menu : null) ?? []
    const lines = Object.entries(qtys)
      .map(([id, qty]) => ({ item: menu.find((m) => m.id === id), qty }))
      .filter((l) => l.item && l.item.available)
    return {
      lines,
      items: Object.fromEntries(lines.map((l) => [l.item.id, l])), // { id: { item, qty } }
      count: lines.reduce((n, l) => n + l.qty, 0),
      total: lines.reduce((n, l) => n + l.qty * l.item.price, 0),
    }
  }, [qtys, vendorId, getVendor])

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