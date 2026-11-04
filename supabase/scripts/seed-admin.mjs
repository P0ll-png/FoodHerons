// FoodHerons — scripts/seed-admin.mjs
//
// Seeds (or promotes) a single ADMIN account.
//
// Why a two-step promote? The handle_new_user trigger coerces any signup role
// that isn't exactly 'vendor' down to 'student', so 'admin' can NEVER be set
// through metadata at creation. This script therefore:
//   1. LOOKUP-FIRST / create-if-absent the admin auth user (email_confirm:true).
//      The trigger provisions a profiles row as 'student'.
//   2. UPDATE public.profiles.role -> 'admin' on the service-role connection.
//      guard_profile_role() allows this because request.jwt.claims IS NULL for
//      a service connection (only an admin or the service may change a role).
//   3. Mirror role:'admin' into the user's auth app_metadata, matching what
//      the trigger does for the initial role (the C# service reads it from JWT).
//
// Idempotent: a re-run finds the existing user, re-applies the role UPDATE and
// the app_metadata mirror, and converges to the same state.
//
// Requires Node v18+ (repo uses v24). Set env (see supabase/scripts/.env):
//   SUPABASE_URL                 e.g. https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service-role key (NEVER hardcoded / committed)
//   SEED_ADMIN_EMAIL             admin login email         (required)
//   SEED_ADMIN_PASSWORD          admin login password      (required)
//   SEED_ADMIN_NAME              display name (optional; defaults to 'Admin')
//
//   node scripts/seed-admin.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase()
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || ''
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Admin'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing required env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      '(service-role key) before running.'
  )
  process.exit(1)
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    'Missing required env. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD ' +
      '(and optionally SEED_ADMIN_NAME) before running.'
  )
  process.exit(1)
}
if (ADMIN_PASSWORD.length < 8) {
  console.error('SEED_ADMIN_PASSWORD must be at least 8 characters.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Lookup-first: find the auth user for an email by paging listUsers.
async function findUserByEmail(email) {
  const target = email.toLowerCase()
  const perPage = 1000
  for (let page = 1; page <= 50; page += 1) {
    // eslint-disable-next-line no-await-in-loop
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
async function resolveOrCreateUser() {
  const existing = await findUserByEmail(ADMIN_EMAIL)
  if (existing) {
    console.log(`  user exists: ${ADMIN_EMAIL} (${existing.id})`)
    return existing.id
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    // role here is intentionally NOT 'admin' — the trigger would coerce it to
    // 'student' regardless. The UPDATE below is what makes this account admin.
    user_metadata: { full_name: ADMIN_NAME },
  })

  if (error) {
    // On a duplicate-email race, fall back to lookup and reuse the id.
    const again = await findUserByEmail(ADMIN_EMAIL)
    if (again) {
      console.log(`  user resolved after create error: ${ADMIN_EMAIL} (${again.id})`)
      return again.id
    }
    throw new Error(`createUser failed for ${ADMIN_EMAIL}: ${error.message}`)
  }

  console.log(`  user created: ${ADMIN_EMAIL} (${data.user.id})`)
  return data.user.id
}

// Promote: set profiles.role = 'admin' on the service connection. Poll briefly
// for the trigger-created profile row first.
async function promoteProfileToAdmin(userId) {
  const budgetMs = 5000
  const stepMs = 50
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase
      .from('profiles')
      .update({ role: 'admin', full_name: ADMIN_NAME, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, role')
    if (error) throw new Error(`profiles UPDATE failed: ${error.message}`)
    if (data && data.length === 1) {
      console.log(`  profile role set: ${data[0].role}`)
      return
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, stepMs))
  }
  throw new Error(
    `profiles row for id=${userId} not found within ${budgetMs}ms ` +
      '(handle_new_user trigger may not have created it)'
  )
}

// Mirror role into auth app_metadata so the C# service can read it from the JWT
// (the trigger does the same for the initial role on signup).
async function mirrorAppMetadata(userId) {
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { role: 'admin' },
  })
  if (error) throw new Error(`updateUserById (app_metadata) failed: ${error.message}`)
  console.log('  app_metadata.role mirrored: admin')
}

async function main() {
  console.log(`Seeding admin account into ${SUPABASE_URL}`)
  console.log(`\n[admin] ${ADMIN_EMAIL}`)
  const userId = await resolveOrCreateUser()
  await promoteProfileToAdmin(userId)
  await mirrorAppMetadata(userId)
  console.log('\nDone. Admin account ready.')
  console.log(`  email: ${ADMIN_EMAIL}`)
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message)
  process.exit(1)
})
