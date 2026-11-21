-- FoodHerons - 0011_oauth_profile.sql
-- Google / Facebook sign-in support. Re-defines public.handle_new_user() (body of
-- 0004 plus three changes) so OAuth users get a complete profile:
--   * full_name falls back to the provider's 'name' claim
--   * email falls back to the provider metadata, then '' (profiles.email is NOT NULL
--     and Facebook can return no email)
--   * avatar_url is copied from the provider's 'avatar_url' / 'picture' claim
-- Role handling is unchanged: OAuth sign-ups are always 'student'.
-- The on_auth_user_created trigger from 0004 already points at this function.
-- Run AFTER 0010 in the Supabase SQL editor.
-- ===========================================================================
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role        public.user_role;
  v_full_name   text;
  v_mobile      text;
  v_store_name  text;
  v_store_slug  text;
  v_is_service  boolean;
  v_slug        text;
  v_base_slug   text;
  v_suffix      integer;
begin
  -- Coerce any role not exactly 'vendor' to 'student' so 'admin' (or any
  -- unknown string) can never be obtained via signup.
  v_role := case
    when new.raw_user_meta_data->>'role' = 'vendor' then 'vendor'::public.user_role
    else 'student'::public.user_role
  end;

  v_full_name  := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), '');
  v_mobile     := new.raw_user_meta_data->>'mobile';
  v_store_name := new.raw_user_meta_data->>'store_name';
  v_store_slug := new.raw_user_meta_data->>'store_slug';

  -- Service/seed connection iff there is no PostgREST/GoTrue JWT context.
  v_is_service := current_setting('request.jwt.claims', true) is null;

  -- Provision the profile row.
  insert into public.profiles (id, role, full_name, email, mobile, avatar_url)
  values (
    new.id, v_role, v_full_name,
    coalesce(new.email, new.raw_user_meta_data->>'email', ''),
    v_mobile,
    coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''), nullif(new.raw_user_meta_data->>'picture', ''))
  );

  -- Mirror role into app_metadata (not user-writable) so the C# service can
  -- read role from the JWT without a DB round-trip.
  update auth.users
    set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role::text)
    where id = new.id;

  -- Vendors get an owned store row created here (sole writer of that row).
  if v_role = 'vendor' then
    if v_is_service then
      -- Service/seed path: honor the supplied store_slug verbatim and use
      -- ON CONFLICT (id) DO NOTHING so re-seeding is idempotent.
      v_slug := coalesce(nullif(v_store_slug, ''), 'vendor-' || replace(new.id::text, '-', ''));
      insert into public.vendors (id, owner_id, name)
      values (v_slug, new.id, coalesce(v_store_name, 'Unnamed Store'))
      on conflict (id) do nothing;
    else
      -- Browser self-signup: ignore store_slug entirely. Slugify store_name
      -- and append a numeric suffix on collision so the id is always unique.
      v_base_slug := trim(both '-' from
        lower(regexp_replace(coalesce(v_store_name, 'store'), '[^a-z0-9]+', '-', 'gi')));
      if v_base_slug = '' then
        v_base_slug := 'store';
      end if;
      v_slug := v_base_slug;
      v_suffix := 1;
      while exists (select 1 from public.vendors where id = v_slug) loop
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix::text;
      end loop;
      -- Plain conflict-surfacing INSERT (no DO NOTHING): the generated slug is
      -- unique, so a self-signup vendor always gets exactly one store row.
      insert into public.vendors (id, owner_id, name)
      values (v_slug, new.id, coalesce(v_store_name, 'Unnamed Store'));
    end if;
  end if;

  return new;
end;
$$;
