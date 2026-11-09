// FoodHerons — scripts/seed-photos.mjs
//
// Seeds on-brand photos for the demo stores and their menu items (option 1:
// curated hosted image URLs, no Storage bucket required).
//
// For each store (keyed by its canonical slug / vendor id) this script:
//   1. UPDATEs public.vendors.cover_url (and logo_url) with a cuisine-matched,
//      warm, well-lit food photo that complements the orange/yellow brand.
//   2. UPDATEs each public.menu_items.image_url (keyed by composite PK
//      vendor_id,id) with a dish-matched photo.
//
// Images are stable Unsplash direct-image URLs (images.unsplash.com/photo-<id>)
// with sizing/format params appended so they load fast as CSS backgrounds.
// Every photo id below was HEAD-checked to return 200 image/jpeg. Covers use a
// wide crop; menu items use a square crop.
//
// Service-role connection bypasses RLS, so these UPDATEs write freely.
// Idempotent: re-running re-applies the same URLs and converges.
//
// IMPORTANT: run scripts/seed-demo.mjs FIRST — this script only updates rows
// that already exist (it does not create stores or menu items). A store/item
// that is missing is reported and skipped, not created.
//
// Requires Node v18+ (repo uses v24). Set env (see supabase/scripts/.env):
//   SUPABASE_URL                 e.g. https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service-role key (NEVER hardcoded / committed)
//
//   node scripts/seed-photos.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing required env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      '(service-role key) before running.'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------
// Image URL helpers. Unsplash serves derivatives via query params:
//   w = width, q = quality, auto=format (webp when supported), fit=crop.
// Covers are wide (landscape hero behind the card badges); logos/menu items
// are square. All ids below verified 200 image/jpeg.
// ---------------------------------------------------------------------------
const BASE = 'https://images.unsplash.com/'
const cover = (id) => `${BASE}${id}?w=1200&h=800&q=80&auto=format&fit=crop`
const square = (id) => `${BASE}${id}?w=600&h=600&q=80&auto=format&fit=crop`

// Per-store photo plan. Keys are the vendor slug (== vendors.id). `cover` is
// the store hero; `logo` is a tight square crop of the same cuisine (stands in
// until a real brand logo is dropped in). `menu` maps menu_item id -> photo id.
const STORE_PHOTOS = {
  // Tita Nena's Silog — Filipino silog / rice plates
  'tita-nenas': {
    coverId: 'photo-1626509653291-18d9a934b9db',
    logoId: 'photo-1603133872878-684f208fb84b',
    menu: {
      tapsilog: 'photo-1626509653291-18d9a934b9db',
      tocilog: 'photo-1617093727343-374698b1b08d',
      hotsilog: 'photo-1603133872878-684f208fb84b',
      'extra-rice': 'photo-1516684732162-798a0062be99',
      'iced-tea': 'photo-1499638673689-79a0b5115d87',
    },
  },

  // Campus Brews — milk tea, shakes, coffee
  'campus-brews': {
    coverId: 'photo-1558857563-b371033873b8',
    logoId: 'photo-1564890369478-c89ca6d9cde9',
    menu: {
      wintermelon: 'photo-1558857563-b371033873b8',
      matcha: 'photo-1536256263959-770b48d82b0a',
      'mango-shake': 'photo-1546173159-315724a31696',
      americano: 'photo-1461023058943-07fcbe16d735',
    },
  },

  // Crunch Corner — fries, fishballs, street snacks
  'crunch-corner': {
    coverId: 'photo-1573080496219-bb080dd4f877',
    logoId: 'photo-1619740455993-9e612b1af08a',
    menu: {
      fries: 'photo-1573080496219-bb080dd4f877',
      fishball: 'photo-1619740455993-9e612b1af08a',
      kikiam: 'photo-1541592106381-b31e9677c0e5',
    },
  },

  // Ate Len Noodle House — mami, pancit, lomi
  'noodle-house': {
    coverId: 'photo-1569718212165-3a8278d5f624',
    logoId: 'photo-1612929633738-8fe44f7ec841',
    menu: {
      'beef-mami': 'photo-1569718212165-3a8278d5f624',
      pancit: 'photo-1612929633738-8fe44f7ec841',
      lomi: 'photo-1555126634-323283e090fa',
    },
  },

  // The Sweet Spot — brownies, cookies, halo-halo
  'sweet-spot': {
    coverId: 'photo-1551024601-bec78aea704b',
    logoId: 'photo-1606313564200-e75d5e30476c',
    menu: {
      brownie: 'photo-1606313564200-e75d5e30476c',
      cookies: 'photo-1499636136210-6f4ee915583e',
      halohalo: 'photo-1551024601-bec78aea704b',
    },
  },

  // Kuya Boy Smoky Grill — isaw, pork bbq, grilled skewers
  'smoky-grill': {
    coverId: 'photo-1555939594-58d7cb561ad1',
    logoId: 'photo-1529563021893-cc83c992d75d',
    menu: {
      isaw: 'photo-1555939594-58d7cb561ad1',
      'pork-bbq': 'photo-1529563021893-cc83c992d75d',
    },
  },

  // Brekkie Cart — sandwiches, pandesal, coffee
  'brekkie-cart': {
    coverId: 'photo-1528735602780-2552fd46c7af',
    logoId: 'photo-1571091718767-18b5b1457add',
    menu: {
      eggsand: 'photo-1571091718767-18b5b1457add',
      pandesal: 'photo-1509440159596-0249088772ff',
      kape: 'photo-1600271886742-f049cd451bba',
    },
  },

  // Rice Rush — rice bowls, ulam combos
  'rice-rush': {
    coverId: 'photo-1512058564366-18510be2db19',
    logoId: 'photo-1546069901-ba9599a7e63c',
    menu: {
      'adobo-bowl': 'photo-1512058564366-18510be2db19',
      'sisig-bowl': 'photo-1600891964092-4316c288032e',
    },
  },
}

async function seedStorePhotos(slug, plan) {
  console.log(`\n[${slug}]`)

  // Cover + logo on the vendors row.
  const { data: vrows, error: verr } = await supabase
    .from('vendors')
    .update({
      cover_url: cover(plan.coverId),
      logo_url: square(plan.logoId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', slug)
    .select('id')

  if (verr) throw new Error(`vendors UPDATE failed for ${slug}: ${verr.message}`)
  if (!vrows || vrows.length === 0) {
    console.warn(`  SKIP: no vendors row id=${slug} (run seed-demo.mjs first)`)
    return
  }
  console.log('  cover + logo set')

  // Per-item image_url. Each item is updated individually so a missing item is
  // reported rather than silently ignored.
  let updated = 0
  for (const [itemId, photoId] of Object.entries(plan.menu)) {
    // eslint-disable-next-line no-await-in-loop
    const { data: mrows, error: merr } = await supabase
      .from('menu_items')
      .update({ image_url: square(photoId), updated_at: new Date().toISOString() })
      .eq('vendor_id', slug)
      .eq('id', itemId)
      .select('id')

    if (merr) throw new Error(`menu_items UPDATE failed for ${slug}/${itemId}: ${merr.message}`)
    if (!mrows || mrows.length === 0) {
      console.warn(`  SKIP item: ${slug}/${itemId} not found`)
      continue
    }
    updated += 1
  }
  console.log(`  ${updated}/${Object.keys(plan.menu).length} menu item photos set`)
}

async function main() {
  const slugs = Object.keys(STORE_PHOTOS)
  console.log(`Seeding photos for ${slugs.length} demo stores into ${SUPABASE_URL}`)
  for (const slug of slugs) {
    // eslint-disable-next-line no-await-in-loop
    await seedStorePhotos(slug, STORE_PHOTOS[slug])
  }
  console.log('\nDone. All demo store photos seeded.')
}

main().catch((err) => {
  console.error('\nPhoto seed failed:', err.message)
  process.exit(1)
})
