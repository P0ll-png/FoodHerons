# FoodHerons — Supabase backend (Phase A)

Database-only phase: schema, Row-Level Security, triggers, and seed data for
the FoodHerons Supabase project. No frontend or C# code is part of Phase A.

Everything here is additive and ordered. Apply the migrations top-to-bottom in
the Supabase dashboard **SQL editor**, then run the Node seed script.

## 1. Apply the SQL migrations (in order)

Open the Supabase dashboard → SQL editor and paste/run each file **in this
order** (each is idempotent-where-specified, so a re-run is safe):

1. `migrations/0001_extensions.sql` — `pgcrypto` (for `gen_random_uuid()`).
2. `migrations/0002_enums.sql` — `user_role` (`student`/`vendor`/`admin`) and
   `order_status` (`pending`/`preparing`/`ready`/`completed`/`cancelled`).
3. `migrations/0003_tables.sql` — all tables + the `order_code_seq` sequence.
4. `migrations/0004_functions_triggers.sql` — `public.auth_role()`,
   `handle_new_user` (signup trigger), the vendors/profiles column guards,
   `set_review_snapshot`, and the reviews→vendor rating aggregate trigger.
5. `migrations/0005_rls.sql` — enables RLS on every table and creates all
   policies.
6. `migrations/0006_seed.sql` — the 6 categories (+ `uncategorized`) and
   6 location areas (+ `unassigned`). The 8 vendors and their menus are **not**
   seeded here — see step 2.
7. `migrations/0007_order_rpcs.sql` — the `place_order` and (3-arg)
   `transition_order` RPCs backing the C# order service.
8. `migrations/0008_vendor_approval.sql` — the `vendor_approval_status` enum +
   `vendors.approval_status` (new signups default to `pending`; existing stores
   are backfilled to `approved` once), the `gcash_number`/`gcash_name` columns,
   the admin-only approval branch in `guard_vendor_columns`, and the narrowed
   `vendors` SELECT policy (students/anon see only approved stores).
9. `migrations/0009_order_payment_enum.sql` — the two new `order_status` labels
   (`awaiting_payment`, `payment_submitted`). **Run this as its OWN SQL-editor
   execution and let it finish before pasting/running `0010` — do not paste both
   files into a single run.** The SQL editor wraps a multi-statement run in one
   transaction, and Postgres forbids *using* a newly added enum label in the same
   transaction that added it; `0010` both sets a column default to
   `awaiting_payment` and references the labels inside RPC bodies, so the enum
   add must be committed first.
10. `migrations/0010_order_payment.sql` — the `orders` payment columns, the
    `awaiting_payment` status default, the **private** `payment-proofs` Storage
    bucket + its INSERT/SELECT policies, the `submit_payment` RPC, and the 4-arg
    `transition_order` overload (the old 3-arg overload is dropped). **Requires
    the Supabase `storage` schema (hosted project), not bare Postgres.** New
    orders now start `awaiting_payment`, and a vendor must set a `gcash_number`
    (Store info) before pre-ordering works against their store.

## 2. Run the demo-account seed script

Creating auth users needs the Admin API (service-role key), which can't run in
the SQL editor. The Node script `scripts/seed-demo.mjs` creates the 8 demo
vendor owner accounts; the signup trigger provisions each profile + a minimal
`vendors` row; the script then updates each store with its real data and
inserts its menu items.

The repo uses Node v24. The script imports `@supabase/supabase-js` — install it
if it is not already available (it becomes a frontend dependency in Phase B):

```
npm install @supabase/supabase-js
```

Set the environment (copy the template, fill in real values — the real `.env`
is git-ignored):

```
cp supabase/scripts/.env.example supabase/scripts/.env
# then edit supabase/scripts/.env:
#   SUPABASE_URL=https://<project>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # secret; never commit
#   SEED_VENDOR_PASSWORD=...                        # optional; see below
```

Run it from the `supabase/` directory with those vars exported (the script
reads `process.env`; it does not auto-load a `.env` file, so export them or use
your shell/`node --env-file`):

```
cd supabase
node --env-file=scripts/.env scripts/seed-demo.mjs
# or export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yourself, then:
#   node scripts/seed-demo.mjs
```

The script is **idempotent**: a re-run finds the existing 8 users, skips
creation, and re-applies the per-store updates and menu upserts.

### Demo vendor logins (demo-only — change before production)

The 8 seed stores are owned by auth users with **fake emails** of the form
`<vendor-slug>@foodherons.local` (e.g. `tita-nenas@foodherons.local`), all
sharing one demo password: **`FoodHerons!Demo2026`** (overridable via
`SEED_VENDOR_PASSWORD`). These let anyone log in as a seed store to demo the
vendor dashboard.

This is deliberately insecure (one shared, documented password across 8
accounts on an unroutable `.local` domain). It is acceptable **only** for
throwaway demo stores. Before any real deployment: rotate or delete these
accounts, or re-point each store's `owner_id` to a real vendor via the admin
dashboard and disable the demo logins.

The 8 accounts:

| slug | email | store |
| --- | --- | --- |
| `tita-nenas` | `tita-nenas@foodherons.local` | Tita Nena's Silog |
| `campus-brews` | `campus-brews@foodherons.local` | Campus Brews |
| `crunch-corner` | `crunch-corner@foodherons.local` | Crunch Corner |
| `noodle-house` | `noodle-house@foodherons.local` | Ate Len Noodle House |
| `sweet-spot` | `sweet-spot@foodherons.local` | The Sweet Spot |
| `smoky-grill` | `smoky-grill@foodherons.local` | Kuya Boy Smoky Grill |
| `brekkie-cart` | `brekkie-cart@foodherons.local` | Brekkie Cart |
| `rice-rush` | `rice-rush@foodherons.local` | Rice Rush |

## 3. Create the first admin (one-time bootstrap)

There is no admin signup path — the signup trigger coerces any non-`vendor`
role to `student`, so `admin` can only be set by a privileged DB statement.
After the seed runs, promote an account in the SQL editor:

```sql
-- by email:
update public.profiles set role = 'admin' where email = '<your-admin-email>';
-- or by auth user id:
update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
```

This runs as the Postgres owner/service role, so it hits the profiles
role-guard's service-role early-return (`request.jwt.claims` is NULL) and is
allowed. Only someone with DB / service-role access can perform it.

## 4. Phase A verification checklist (§7)

Run these in the dashboard once applied (see `PHASE-A-VERIFICATION.md` for the
full list and what was statically verified):

- Migrations apply cleanly in order.
- Anon `select` returns the 8 vendors + their menu items.
- A student JWT cannot insert into `orders` and cannot update another vendor's
  `menu_items`.
- A vendor JWT can update only its own vendor row / menu items.
- A signup attempt sending `role=admin` in metadata lands as `student`.
- An admin JWT can update any vendor's `owner_id`/`preorder_enabled`, delete any
  review, and select all orders — while `rating`/`review_count` remain
  unwritable by any client.
- Logging in as `tita-nenas@foodherons.local` / `FoodHerons!Demo2026` returns a
  vendor session owning the `tita-nenas` store.
