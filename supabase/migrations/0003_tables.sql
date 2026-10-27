-- FoodHerons — Phase A — 0003_tables.sql
-- All tables + the order_code_seq sequence, per design §1.
-- Run AFTER 0002_enums.sql.
--
-- Monetary values: numeric(10,2). IDs: text slug PKs for vendors/menu_items
-- (carried verbatim from seed data); orders use gen_random_uuid() plus a
-- human-friendly `code`. RLS is enabled in 0005; triggers/functions in 0004.

-- ---------------------------------------------------------------------------
-- categories (lookup table, seeded; includes safe-default 'uncategorized')
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id         text    primary key,
  name       text    not null,
  image      text,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- location_areas (lookup table, seeded; includes safe-default 'unassigned')
-- id = name = the display value verbatim (e.g. 'Food Court').
-- ---------------------------------------------------------------------------
create table if not exists public.location_areas (
  id         text    primary key,
  name       text    not null,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user; role + display fields.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  role       public.user_role not null,
  full_name  text        not null,
  email      text        not null,
  mobile     text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- vendors — stores. owner_id nullable by schema; category/location_area carry
-- safe-default values so the signup trigger's minimal INSERT satisfies NOT NULL
-- and the FKs (backed by seeded 'uncategorized'/'unassigned' rows).
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id               text        primary key,
  owner_id         uuid        references public.profiles(id),
  name             text        not null,
  category         text        not null default 'uncategorized'
                               references public.categories(id),
  location_area    text        not null default 'unassigned'
                               references public.location_areas(id),
  description      text        not null default '',
  hours_open       text        not null default '00:00',
  hours_close      text        not null default '00:00',
  rating           numeric(2,1) not null default 0,
  review_count     integer     not null default 0,
  phone            text,
  preorder_enabled boolean     not null default false,
  cover_tint       text        not null default 'var(--orange-soft)',
  logo_url         text,
  cover_url        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists vendors_category_idx      on public.vendors (category);
create index if not exists vendors_location_area_idx on public.vendors (location_area);
create index if not exists vendors_owner_id_idx      on public.vendors (owner_id);

-- ---------------------------------------------------------------------------
-- menu_items — composite PK (vendor_id, id). No price trust from client.
-- ---------------------------------------------------------------------------
create table if not exists public.menu_items (
  id          text        not null,
  vendor_id   text        not null references public.vendors(id) on delete cascade,
  name        text        not null,
  price       numeric(10,2) not null check (price >= 0),
  category    text        not null references public.categories(id),
  available   boolean     not null default true,
  description text,
  image_url   text,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (vendor_id, id)
);

create index if not exists menu_items_vendor_id_idx on public.menu_items (vendor_id);

-- ---------------------------------------------------------------------------
-- order_code_seq — backs the human-friendly order code (FH-000142).
-- ---------------------------------------------------------------------------
create sequence if not exists public.order_code_seq;

-- ---------------------------------------------------------------------------
-- orders — written by the C# service (service-role) only; no client write.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id            uuid        primary key default gen_random_uuid(),
  code          text        not null unique
                            default ('FH-' || lpad(nextval('public.order_code_seq')::text, 6, '0')),
  student_id    uuid        not null references public.profiles(id),
  vendor_id     text        not null references public.vendors(id),
  status        public.order_status not null default 'pending',
  subtotal      numeric(10,2) not null check (subtotal >= 0),
  total         numeric(10,2) not null check (total >= 0),
  pickup_name   text        not null,
  note          text,
  cancel_reason text,
  placed_at     timestamptz not null default now(),
  accepted_at   timestamptz,
  ready_at      timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz
);

create index if not exists orders_student_id_idx       on public.orders (student_id);
create index if not exists orders_vendor_status_idx     on public.orders (vendor_id, status);
create index if not exists orders_placed_at_idx         on public.orders (placed_at);

-- ---------------------------------------------------------------------------
-- order_items — price/name snapshot at order time. NO FK to menu_items.
-- Only FK is order_id -> orders (ON DELETE CASCADE).
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id           uuid        primary key default gen_random_uuid(),
  order_id     uuid        not null references public.orders(id) on delete cascade,
  menu_item_id text        not null,
  vendor_id    text        not null,
  name         text        not null,
  unit_price   numeric(10,2) not null,
  qty          integer     not null check (qty > 0)
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- reviews — one per completed order. author_name/ordered_summary are
-- snapshot columns filled by the set_review_snapshot trigger (0004).
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id              uuid        primary key default gen_random_uuid(),
  vendor_id       text        not null references public.vendors(id) on delete cascade,
  student_id      uuid        not null default auth.uid() references public.profiles(id),
  order_id        uuid        not null references public.orders(id),
  author_name     text        not null,
  ordered_summary text        not null default '',
  rating          integer     not null check (rating between 1 and 5),
  text            text,
  helpful_count   integer     not null default 0,
  created_at      timestamptz not null default now(),
  unique (student_id, vendor_id, order_id)
);

create index if not exists reviews_vendor_id_idx  on public.reviews (vendor_id);
create index if not exists reviews_student_id_idx on public.reviews (student_id);

-- ---------------------------------------------------------------------------
-- favorites — composite PK (student_id, vendor_id). Membership tuple.
-- ---------------------------------------------------------------------------
create table if not exists public.favorites (
  student_id uuid        not null default auth.uid()
                         references public.profiles(id) on delete cascade,
  vendor_id  text        not null references public.vendors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, vendor_id)
);

create index if not exists favorites_student_id_idx on public.favorites (student_id);
