// PLACEHOLDER reviews (front-end only, no backend).
// Each stall gets a different, repeatable set: the stall's id picks which reviews it shows.
// To use real data later, give a vendor a `reviewList` (same shape) and it is used instead.

const DAY = 86400000
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()

// `item` is filled from the stall's own menu, so "Ordered:" matches what it sells.
const POOL = [
  { name: 'Rico M.',   rating: 5, qty: 1, days: 2,  helpful: 12, text: 'Hot food and a big serving for the price. The line moves fast even at lunch.' },
  { name: 'Aira S.',   rating: 5, qty: 2, days: 7,  helpful: 8,  text: 'Sulit! Pre-ordered before class and it was ready when I got there.' },
  { name: 'Jomar D.',  rating: 4, qty: 1, days: 14, helpful: 3,  text: 'Tasty and filling. Sometimes sold out by 1 PM, so order early.' },
  { name: 'Kim L.',    rating: 5, qty: 1, days: 21, helpful: 5,  text: 'Best budget meal near the gate. Friendly staff too.' },
  { name: 'Paolo R.',  rating: 3, qty: 1, days: 35, helpful: 1,  text: 'Good flavor, but it was a bit dry on my last visit.' },
  { name: 'Mae C.',    rating: 2, qty: 1, days: 60, helpful: 0,  text: 'Waited longer than expected during the rush.' },
  { name: 'Dani V.',   rating: 5, qty: 3, days: 3,  helpful: 6,  text: 'Ordered for the whole group and everything came out together. Will order again.' },
  { name: 'Leah T.',   rating: 4, qty: 1, days: 10, helpful: 2,  text: 'Always fresh. Wish there were more seats nearby.' },
  { name: 'Carlo B.',  rating: 5, qty: 1, days: 5,  helpful: 9,  text: 'My go-to between classes. Portions are generous.' },
  { name: 'Trixie N.', rating: 4, qty: 2, days: 18, helpful: 4,  text: 'Good value and the staff are quick. Pickup was easy.' },
  { name: 'Ben A.',    rating: 3, qty: 1, days: 28, helpful: 0,  text: 'Okay overall. Decent taste, nothing special.' },
  { name: 'Shane P.',  rating: 5, qty: 1, days: 1,  helpful: 7,  text: 'Super tasty and still hot when I picked it up!' },
]

const hash = (str) => {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

// Spreads `total` ratings over 5..1 stars so the bars fit the stall's average rating.
const makeBreakdown = (rating, total) => {
  const w = [1, 2, 3, 4, 5].map((n) => Math.max(0.03, 1 - Math.abs(n - rating) * 0.75) ** 2)
  const sum = w.reduce((a, b) => a + b, 0)
  const out = {}
  ;[1, 2, 3, 4, 5].forEach((n, i) => { out[n] = Math.round((w[i] / sum) * total) })
  return out
}

export function getReviewsFor(vendor) {
  if (!vendor) return { reviews: [], breakdown: null }
  if (vendor.reviewList) return { reviews: vendor.reviewList, breakdown: vendor.ratingBreakdown ?? null }

  const total = Number(vendor.reviews) || 0
  if (total === 0) return { reviews: [], breakdown: null } // shows the "No reviews yet" state

  const seed = hash(String(vendor.id))
  const count = Math.min(total, 5 + (seed % 3)) // 5 to 7 cards, never more than the stall's count
  const menu = (vendor.menu || []).map((m) => m.name)

  const reviews = Array.from({ length: count }, (_, i) => {
    const r = POOL[(seed + i * 5) % POOL.length] // step 5 is coprime with 12, so no repeats
    const item = menu.length ? menu[(seed + i * 3) % menu.length] : 'Meal'
    return {
      id: `${vendor.id}-r${i}`,
      name: r.name,
      rating: r.rating,
      text: r.text,
      ordered: `${r.qty}× ${item}`,
      helpful: r.helpful,
      createdAt: ago(r.days),
    }
  })
  return { reviews, breakdown: makeBreakdown(Number(vendor.rating) || 4.5, total) }
}
