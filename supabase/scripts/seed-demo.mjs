// FoodHerons — Phase A — scripts/seed-demo.mjs
//
// Seeds the 8 demo vendor owner accounts and their stores, per design §5.
//
// For each of the 8 vendors this script:
//   1. LOOKUP-FIRST / create-if-absent the <slug>@foodherons.local auth user
//      (shared demo password, email_confirm:true, metadata role='vendor',
//      store_name=real display name, store_slug=canonical slug, full_name).
//      The handle_new_user trigger (on the service connection) provisions the
//      profile + a minimal vendors row.
//   2. POLL (short backoff) for the owned vendors row keyed on owner_id, then
//      UPDATE it with the real category/location_area/description/hours/rating/
//      review_count/phone/preorder_enabled/cover_tint, asserting rowcount === 1.
//   3. UPSERT that vendor's menu_items.
//
// Idempotent: a re-run finds existing users, skips creation, and re-applies
// the UPDATE/upserts, converging to the same state.
//
// Requires Node v18+ (repo uses v24). Run with env vars set:
//   SUPABASE_URL                 e.g. https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service-role key (NEVER hardcoded / committed)
//   SEED_VENDOR_PASSWORD         optional; defaults to the documented demo password
//
//   node scripts/seed-demo.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
// Demo-only shared password — documented in supabase/README.md. Overridable
// via env so production can supply something else (and should rotate/delete
// these accounts before any real deployment).
const DEMO_PASSWORD = process.env.SEED_VENDOR_PASSWORD || 'FoodHerons!Demo2026'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing required env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      '(and optionally SEED_VENDOR_PASSWORD) before running.'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const EMAIL_DOMAIN = 'foodherons.local'

// ---------------------------------------------------------------------------
// The 8 vendors — real data transcribed verbatim from src/data/vendors.js.
// store_name values match that file's `name` exactly (used verbatim by the
// trigger for vendors.name and by the "(Demo Owner)" full_name rule).
// ---------------------------------------------------------------------------
const VENDORS = [
  {
    slug: 'tita-nenas',
    store_name: "Tita Nena's Silog",
    category: 'rice',
    location_area: 'Food Court',
    description:
      'Home-style silog plates served hot all day. Student favorite near the Food Court.',
    hours_open: '06:30',
    hours_close: '15:00',
    rating: 4.8,
    review_count: 212,
    phone: '0917 123 4567',
    preorder_enabled: true,
    cover_tint: 'var(--orange-soft)',
    menu: [
      { id: 'tapsilog', name: 'Tapsilog', price: 75, category: 'rice', available: true, description: 'Beef tapa, garlic rice, egg.' },
      { id: 'tocilog', name: 'Tocilog', price: 70, category: 'rice', available: true, description: 'Sweet tocino, garlic rice, egg.' },
      { id: 'hotsilog', name: 'Hotsilog', price: 60, category: 'rice', available: true, description: 'Hotdog, garlic rice, egg.' },
      { id: 'extra-rice', name: 'Extra Rice', price: 20, category: 'rice', available: true, description: 'One cup garlic rice.' },
      { id: 'iced-tea', name: 'House Iced Tea', price: 25, category: 'drinks', available: true, description: 'Freshly brewed, lightly sweet.' },
    ],
  },
  {
    slug: 'campus-brews',
    store_name: 'Campus Brews',
    category: 'drinks',
    location_area: 'HPSB Building',
    description: 'Milk teas, fruit shakes and coffee to fuel your study grind.',
    hours_open: '07:00',
    hours_close: '19:00',
    rating: 4.6,
    review_count: 158,
    phone: null,
    preorder_enabled: true,
    cover_tint: 'var(--yellow-pale)',
    menu: [
      { id: 'wintermelon', name: 'Wintermelon Milk Tea', price: 65, category: 'drinks', available: true, description: 'Large, with pearls.' },
      { id: 'matcha', name: 'Matcha Latte', price: 70, category: 'drinks', available: true, description: 'Iced, lightly sweet.' },
      { id: 'mango-shake', name: 'Mango Shake', price: 60, category: 'drinks', available: false, description: 'Fresh mango blended.' },
      { id: 'americano', name: 'Iced Americano', price: 55, category: 'drinks', available: true, description: 'Double shot.' },
    ],
  },
  {
    slug: 'crunch-corner',
    store_name: 'Crunch Corner',
    category: 'snacks',
    location_area: 'Covered Court',
    description: 'Fries, fishballs and street snacks for the quick break between classes.',
    hours_open: '09:00',
    hours_close: '17:00',
    rating: 4.4,
    review_count: 97,
    phone: null,
    preorder_enabled: false,
    cover_tint: 'var(--orange-soft)',
    menu: [
      { id: 'fries', name: 'Cheese Fries', price: 45, category: 'snacks', available: true, description: 'Loaded with cheese powder.' },
      { id: 'fishball', name: 'Fishball (10 pcs)', price: 30, category: 'snacks', available: true, description: 'With sweet & spicy sauce.' },
      { id: 'kikiam', name: 'Kikiam', price: 35, category: 'snacks', available: true, description: 'Crispy, 6 pcs.' },
    ],
  },
  {
    slug: 'noodle-house',
    store_name: 'Ate Len Noodle House',
    category: 'noodles',
    location_area: 'Food Court',
    description: 'Steaming bowls of mami, pancit and lomi — comfort in a bowl.',
    hours_open: '10:00',
    hours_close: '18:00',
    rating: 4.7,
    review_count: 143,
    phone: null,
    preorder_enabled: true,
    cover_tint: 'var(--yellow-pale)',
    menu: [
      { id: 'beef-mami', name: 'Beef Mami', price: 70, category: 'noodles', available: true, description: 'Rich beef broth, noodles, egg.' },
      { id: 'pancit', name: 'Pancit Canton', price: 60, category: 'noodles', available: true, description: 'Stir-fried, generous veggies.' },
      { id: 'lomi', name: 'Special Lomi', price: 65, category: 'noodles', available: true, description: 'Thick, hearty, topped with chicharon.' },
    ],
  },
  {
    slug: 'sweet-spot',
    store_name: 'The Sweet Spot',
    category: 'desserts',
    location_area: 'Admin Lobby',
    description: 'Student-run dessert stall: brownies, cookies and halo-halo in season.',
    hours_open: '08:00',
    hours_close: '16:00',
    rating: 4.9,
    review_count: 76,
    phone: null,
    preorder_enabled: true,
    cover_tint: 'var(--orange-soft)',
    menu: [
      { id: 'brownie', name: 'Fudge Brownie', price: 40, category: 'desserts', available: true, description: 'Dense and chocolatey.' },
      { id: 'cookies', name: 'Choc-chip Cookies (3)', price: 50, category: 'desserts', available: true, description: 'Baked fresh daily.' },
      { id: 'halohalo', name: 'Halo-Halo', price: 65, category: 'desserts', available: false, description: 'Seasonal, with ube ice cream.' },
    ],
  },
  {
    slug: 'smoky-grill',
    store_name: 'Kuya Boy Smoky Grill',
    category: 'grill',
    location_area: 'Back Gate',
    description: 'Isaw, pork BBQ and grilled favorites fired up fresh every afternoon.',
    hours_open: '14:00',
    hours_close: '21:00',
    rating: 4.5,
    review_count: 189,
    phone: null,
    preorder_enabled: false,
    cover_tint: 'var(--yellow-pale)',
    menu: [
      { id: 'isaw', name: 'Isaw (3 sticks)', price: 30, category: 'grill', available: true, description: 'Classic chicken isaw.' },
      { id: 'pork-bbq', name: 'Pork BBQ', price: 35, category: 'grill', available: true, description: 'Sweet-savory marinade.' },
    ],
  },
  {
    slug: 'brekkie-cart',
    store_name: 'Brekkie Cart',
    category: 'snacks',
    location_area: 'Main Gate',
    description: 'Sandwiches, pandesal and quick bites for the morning rush at the gate.',
    hours_open: '06:00',
    hours_close: '11:00',
    rating: 4.3,
    review_count: 64,
    phone: null,
    preorder_enabled: true,
    cover_tint: 'var(--yellow-pale)',
    menu: [
      { id: 'eggsand', name: 'Egg & Cheese Sandwich', price: 45, category: 'snacks', available: true, description: 'On toasted bun.' },
      { id: 'pandesal', name: 'Pandesal w/ Kesong Puti', price: 40, category: 'snacks', available: true, description: 'Warm, 2 pcs.' },
      { id: 'kape', name: 'Barako Coffee', price: 30, category: 'drinks', available: true, description: 'Strong brewed barako.' },
    ],
  },
  {
    slug: 'rice-rush',
    store_name: 'Rice Rush',
    category: 'rice',
    location_area: 'Covered Court',
    description: 'Rice bowls and ulam combos — big servings, student prices.',
    hours_open: '10:30',
    hours_close: '16:30',
    rating: 4.6,
    review_count: 121,
    phone: null,
    preorder_enabled: false,
    cover_tint: 'var(--orange-soft)',
    menu: [
      { id: 'adobo-bowl', name: 'Chicken Adobo Bowl', price: 75, category: 'rice', available: true, description: 'With rice and egg.' },
      { id: 'sisig-bowl', name: 'Sisig Rice Bowl', price: 85, category: 'rice', available: true, description: 'Sizzling-style, with egg.' },
    ],
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Lookup-first: find the auth user for an email by paging listUsers.
async function findUserByEmail(email) {
  const target = email.toLowerCase()
  const perPage = 1000
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const users = data?.users ?? []
    const match = users.find((u) => (u.email || '').toLowerCase() === target)
    if (match) return match
    if (users.length < perPage) break // no more pages
  }
  return null
}

// Create-if-absent: return the existing user id or create a new one.
async function resolveOrCreateUser(v) {
  const email = `${v.slug}@${EMAIL_DOMAIN}`
  const fullName = `${v.store_name} (Demo Owner)`

  const existing = await findUserByEmail(email)
  if (existing) {
    console.log(`  user exists: ${email} (${existing.id})`)
    return existing.id
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: 'vendor',
      store_name: v.store_name,
      store_slug: v.slug,
    },
  })

  if (error) {
    // On a duplicate-email race, fall back to lookup and reuse the id.
    const again = await findUserByEmail(email)
    if (again) {
      console.log(`  user resolved after create error: ${email} (${again.id})`)
      return again.id
    }
    throw new Error(`createUser failed for ${email}: ${error.message}`)
  }

  console.log(`  user created: ${email} (${data.user.id})`)
  return data.user.id
}

// Poll for the trigger-created vendors row keyed on owner_id.
async function waitForVendorRow(ownerId) {
  const budgetMs = 5000
  const stepMs = 50
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    const { data, error } = await supabase
      .from('vendors')
      .select('id')
      .eq('owner_id', ownerId)
      .maybeSingle()
    if (error) throw new Error(`vendors poll failed: ${error.message}`)
    if (data) return data.id
    await sleep(stepMs)
  }
  throw new Error(
    `vendors row for owner_id=${ownerId} not found within ${budgetMs}ms ` +
      `(handle_new_user trigger may not have created it)`
  )
}

async function applyVendorColumns(v, ownerId) {
  const { data, error } = await supabase
    .from('vendors')
    .update({
      name: v.store_name,
      category: v.category,
      location_area: v.location_area,
      description: v.description,
      hours_open: v.hours_open,
      hours_close: v.hours_close,
      rating: v.rating,
      review_count: v.review_count,
      phone: v.phone,
      preorder_enabled: v.preorder_enabled,
      cover_tint: v.cover_tint,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_id', ownerId)
    .select('id')

  if (error) throw new Error(`vendors UPDATE failed for ${v.slug}: ${error.message}`)
  if (!data || data.length !== 1) {
    throw new Error(
      `vendors UPDATE for ${v.slug} (owner_id=${ownerId}) matched ${
        data ? data.length : 0
      } rows, expected 1`
    )
  }
  return data[0].id
}

async function upsertMenuItems(v, vendorId) {
  const rows = v.menu.map((m, idx) => ({
    id: m.id,
    vendor_id: vendorId,
    name: m.name,
    price: m.price,
    category: m.category,
    available: m.available,
    description: m.description,
    sort_order: idx + 1,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('menu_items')
    .upsert(rows, { onConflict: 'vendor_id,id' })

  if (error) throw new Error(`menu_items upsert failed for ${v.slug}: ${error.message}`)
}

async function seedVendor(v) {
  console.log(`\n[${v.slug}] ${v.store_name}`)
  const ownerId = await resolveOrCreateUser(v)
  const vendorId = await waitForVendorRow(ownerId)
  const updatedId = await applyVendorColumns(v, ownerId)
  await upsertMenuItems(v, updatedId)
  console.log(`  store ready: ${updatedId} (${v.menu.length} menu items)`)
}

async function main() {
  console.log(`Seeding ${VENDORS.length} demo vendor accounts into ${SUPABASE_URL}`)
  for (const v of VENDORS) {
    // Sequential: each account's follow-up runs after its createUser resolves.
    // eslint-disable-next-line no-await-in-loop
    await seedVendor(v)
  }
  console.log('\nDone. All demo vendor stores seeded.')
  console.log('Shared demo password:', DEMO_PASSWORD === 'FoodHerons!Demo2026' ? '(default)' : '(from env)')
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message)
  process.exit(1)
})
