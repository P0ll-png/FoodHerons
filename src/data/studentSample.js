// Placeholder data. Replace with real API data; empty arrays show the empty states.
export const ACTIVE_ORDERS = [
  { id: 'FH-4833', vendorId: 'campus-brews', vendor: 'Campus Brews', date: 'Oct 24, 11:42 am', total: 165, status: 'Preparing', image: '', items: [{ qty: 1, name: 'Iced Matcha' }, { qty: 1, name: 'Spanish Latte' }] },
  { id: 'FH-4829', vendorId: 'tita-nenas', vendor: 'Tita Nena’s Silog', date: 'Oct 24, 11:15 am', total: 120, status: 'Ready for pickup', image: '', items: [{ qty: 1, name: 'Tapsilog' }, { qty: 1, name: 'Bottled Water' }] },
]

export const PAST_ORDERS = [
  { id: 'FH-4820', vendorId: 'tita-nenas', vendor: 'Tita Nena’s Silog', date: 'Oct 14, 3:10 pm', total: 175, status: 'Completed', image: '', items: [{ qty: 1, name: 'Tocilog' }, { qty: 2, name: 'Hotdog' }] },
  { id: 'FH-4811', vendorId: 'campus-brews', vendor: 'Campus Brews', date: 'Oct 12, 1:45 pm', total: 140, status: 'Completed', image: '', items: [{ qty: 2, name: 'Iced Matcha' }] },
  { id: 'FH-4790', vendorId: 'tita-nenas', vendor: 'Tita Nena’s Silog', date: 'Oct 9, 12:20 pm', total: 95, status: 'Cancelled', image: '', items: [{ qty: 1, name: 'Longsilog' }] },
]

export const FAVORITES = [
  { id: 'tita-nenas', name: 'Tita Nena’s Silog', tag: 'Filipino · Rice meals', image: '' },
  { id: 'campus-brews', name: 'Campus Brews', tag: 'Coffee · Drinks', image: '' },
]

export const PENDING_REVIEWS = [
  { id: 'FH-4824', vendor: 'Tita Nena’s Silog', image: '' },
]

export const PAST_REVIEWS = [
  { id: 'r1', vendor: 'Campus Brews', date: 'Oct 14', rating: 5, text: 'Fast pickup and the matcha was great.', image: '' },
  { id: 'r2', vendor: 'Tita Nena’s Silog', date: 'Oct 10', rating: 4, text: 'Generous servings, a bit of a queue at lunch.', image: '' },
]