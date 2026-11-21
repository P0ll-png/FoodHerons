# Implementation Plan: forgot/reset password + Google/Facebook login and connection

Project: React 18 + Vite 5 + react-router 6, `@supabase/supabase-js ^2.118`, plain CSS. The only npm scripts are `dev`, `build`, `preview`. There is no test runner or linter, so the automated check for every item is `npm run build` (run from `c:\Users\paulc\Projects\FoodHerons`). Behaviour checks need a real Supabase project and are listed under "Needs verification".

## Findings from exploration

- `src/pages/ForgotPassword.jsx`: UI is finished (email field, error, `CheckInbox` resend, generic "if an account exists" message), but `sendResetEmail` is an empty stub (`async (address) => {}`), so it shows success without sending anything.
- `src/pages/ResetPassword.jsx`: UI is finished (`PasswordField` x2, `isStrongPassword`, mismatch check, `AuthToast`, redirect to `/login` after 1.5 s), but `updatePassword` is an empty stub and it reads a `?token=` param that Supabase never sends. It has no handling for a missing or expired recovery session, so it shows a form that cannot work.
- `src/App.jsx`: routes `/forgot-password` and `/reset-password` already exist. `Login.jsx` already links "Forgot password?" to `/forgot-password`. No router changes are needed for the reset flow.
- `src/context/AuthContext.jsx`: has `login`, `logout`, `signup`, `resendVerification`, `updateUser`, `changePassword` (`supabase.auth.updateUser({password})`). `onAuthStateChange` plus `getSession` hydrate `user` for any session, including a recovery session or an OAuth session. `fetchProfile` reads `profiles` and falls back to a session-only user with `role: ''` if the row is missing.
- `src/pages/Login.jsx` / `Signup.jsx`: `loginWithFacebook`, `loginWithGoogle`, `signupWithFacebook`, `signupWithGoogle` are empty stubs. `FacebookButton` / `GoogleButton` in `src/components/AuthLayout.jsx` already render and accept `onClick`. Their comments say "frontend-only stub".
- `src/pages/ConfirmEmail.jsx` (`/auth/confirmed`): waits for the session from the URL, redirects by role (`vendor` to `/dashboard`, otherwise `/`), and shows "Link expired or invalid" after an error in the URL or 8 s with no session. Its copy mentions email and signup, so it needs neutral copy for OAuth.
- `src/pages/Profile.jsx` (~L148-149, L282-296) and `src/pages/Dashboard.jsx` (~L1178-1179, L1344-1356): "Connected Accounts" rows for Facebook and Google only toggle local `useState`. Both files carry TODOs naming `linkIdentity` / `unlinkIdentity`. This is the "connection" part of the request.
- DB: `supabase/migrations/0004_functions_triggers.sql` `handle_new_user()` (AFTER INSERT on `auth.users`) already creates a `profiles` row for every new auth user, including OAuth users. The role is `student` unless `raw_user_meta_data->>'role' = 'vendor'`. Gaps for OAuth users:
  1. `profiles.email` is `NOT NULL` (0003). Facebook can return no email, which would make the trigger insert fail and sign-in fail with "Database error saving new user".
  2. `full_name` is read only from `raw_user_meta_data->>'full_name'`. Google and Facebook usually supply `full_name` and `name`, but this needs verification. It falls back to `''` otherwise, and `profiles.full_name` is `NOT NULL`, which `''` satisfies.
  3. `avatar_url` is never copied from the provider's `avatar_url` / `picture`.
  4. `role` and `store_name` cannot be supplied through `signInWithOAuth`. OAuth signups can only become students. Vendor stores must be created through email signup.
- `profiles.mobile` is nullable, and no other code in `src/`, the migrations or `server/` requires it. OAuth users will show "—" and can add a number in Edit Profile.
- Migrations are applied by hand in the Supabase SQL editor (`supabase/README.md`). There is no `supabase/config.toml` and no Supabase CLI workflow, so **I will not create `config.toml`**. All provider and URL setup goes in the checklist.
- `.env.example` has only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`. OAuth client secrets live in the Supabase dashboard, not in frontend env, so no new env vars. `supabase/scripts/.env` must not be opened.

## Design decisions

1. **Keep default supabase-js flow.** `src/lib/supabase.js` stays as is (`detectSessionInUrl` default true handles both `#access_token` implicit links and `?code=` PKCE links). Changing the flow type would be unrequested.
2. **Reset page readiness uses `useAuth()` (`user`, `loading`), not a local `PASSWORD_RECOVERY` listener.** The recovery event fires during client start-up, before the page mounts, so a page-level listener can miss it. `AuthProvider` is already subscribed, so a signed-in `user` means the recovery session exists. `ConfirmEmail.jsx` uses the same pattern. Any session lets the page change that user's password, which is equivalent to the existing `changePassword`.
3. **After a successful reset, sign out, then go to `/login`.** The recovery link signs the user in, and the request says "redirects to login". Without `logout()` the user would be signed in and the login page would be misleading.
4. **OAuth callback reuses `ConfirmEmail.jsx` at a new route `/auth/callback`** with an `oauth` prop for neutral copy. It already does the wait, role redirect and failure handling. Adding a new page would duplicate it.
5. **OAuth signups are always students.** `signInWithOAuth` cannot carry `role` or `store_name`. On Signup, if "Vendor" is selected and a social button is clicked, show an inline error telling the user to create the store with email and password. Existing vendors can then connect Google/Facebook from the Dashboard and log in with it. This is a gap in the request; I assume this behaviour.
6. **Connected Accounts wiring is included.** "connection" most plausibly means these rows, and the TODOs point at `linkIdentity`. It needs "Manual Linking" enabled in the Supabase dashboard (checklist).
7. **DB trigger update is a new migration `0011_oauth_profile.sql`** (create or replace `handle_new_user`) rather than editing 0004, because 0004 is already applied in the live project. The user must run it in the SQL editor.

## Items (ordered by dependency)

- [ ] 1. Add auth methods to `AuthContext`.
      In `src/context/AuthContext.jsx` add and expose in the `useMemo` value and dependency array:
      - `requestPasswordReset(email)`: `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/reset-password\` })`. Throw on error. Supabase returns success for unknown emails, so existence is never revealed. Map `status === 429` or "rate limit" messages to "Too many requests. Please wait a minute and try again." and use a generic message for other errors.
      - `completePasswordReset(password)`: `supabase.auth.updateUser({ password })`, throw on error (so "New password should be different…" reaches the UI), then `await supabase.auth.signOut()` and `setUser(null)`. This reuses the `logout` logic, so call `logout` or inline the same two lines.
      - `loginWithProvider(provider)` where provider is `'google'` or `'facebook'`: `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: \`${window.location.origin}/auth/callback\` } })`. Throw on error (the browser navigates away on success).
      - `getLinkedProviders()`: `supabase.auth.getUserIdentities()` and return an array of provider names.
      - `linkProvider(provider, returnPath)`: `supabase.auth.linkIdentity({ provider, options: { redirectTo: origin + returnPath } })`.
      - `unlinkProvider(provider)`: find the identity via `getUserIdentities()` and call `supabase.auth.unlinkIdentity(identity)`. Surface the "at least 2 identities" error to the caller.
      Follow the existing style (`useCallback`, `[ADD]` comment markers, throw-on-error).
      Files: `src/context/AuthContext.jsx`
      Verify: `npm run build` succeeds.

- [ ] 2. Make Forgot Password send the email.
      In `src/pages/ForgotPassword.jsx` get `requestPasswordReset` from `useAuth()`, replace the stub `sendResetEmail` body with it, and delete the TODO. Add client validation (non-empty, `/^\S+@\S+\.\S+$/`) with an error message. Disable the submit button and show "Sending…" while `submitting` (currently only disabled). Keep the success message generic ("If an account exists for …"). `CheckInbox` resend already calls `sendResetEmail`. Keep the existing `auth__error` / `AuthLayout` markup, with no new CSS.
      Files: `src/pages/ForgotPassword.jsx`
      Verify: `npm run build` succeeds. Manual: needs verification during implementation (real email, see below).

- [ ] 3. Make Reset Password work with the recovery session.
      In `src/pages/ResetPassword.jsx`:
      - Remove `useSearchParams` and the `token` param.
      - Read `{ user, loading, completePasswordReset }` from `useAuth()`.
      - `linkFailed` initial state: `/error=|error_code=/.test(window.location.hash + window.location.search)` (same as `ConfirmEmail.jsx`), plus an 8 s timeout (same as `ConfirmEmail.jsx`) that sets it when no `user` exists.
      - Render: while `!user && !linkFailed`, show `AuthLayout` titled "Checking your link…" with no form. If `linkFailed` and no user, show "Link expired or invalid" with a `<Link to="/forgot-password">Request a new link</Link>` and a link back to login. Otherwise render the existing form.
      - `submit` calls `completePasswordReset(form.password)` instead of the stub. Keep the existing validation (`isStrongPassword`, confirm match), toast, and 1.5 s `navigate('/login')`. Clear the timer on unmount, as it already does.
      - Keep the `variant="recovery"` layout and existing classes.
      Files: `src/pages/ResetPassword.jsx`
      Verify: `npm run build` succeeds. Manual flow: needs verification during implementation.

- [ ] 4. Wire Facebook and Google on Login and Signup, and add the callback route.
      - `src/pages/Login.jsx`: implement `loginWithFacebook` / `loginWithGoogle` as `try { await loginWithProvider('facebook') } catch (err) { setError(...) }`. Show the existing `auth__error`. Disable the buttons while redirecting if cheap, else leave it.
      - `src/pages/Signup.jsx`: same for `signupWithFacebook` / `signupWithGoogle`. If `role === 'vendor'`, `setError('Vendors: create your store with email and password. You can connect Google or Facebook afterwards from your dashboard.')` and return.
      - `src/components/AuthLayout.jsx`: update the two "Frontend-only stub" comments only.
      - `src/pages/ConfirmEmail.jsx`: add an `oauth` prop. When true: title "Signing you in…" / message "Hang tight, finishing sign-in."; failed title "Sign-in failed"; failed message from the URL `error_description` param when present (read from `window.location.search` and the hash via `URLSearchParams`), else "Please try again."; failed link goes to `/login`. Default (email) behaviour is unchanged.
      - `src/App.jsx`: add `import` and `<Route path="/auth/callback" element={<ConfirmEmail oauth />} />` next to `/auth/confirmed`.
      Files: `src/pages/Login.jsx`, `src/pages/Signup.jsx`, `src/components/AuthLayout.jsx`, `src/pages/ConfirmEmail.jsx`, `src/App.jsx`
      Verify: `npm run build` succeeds. With `npm run dev`, clicking the buttons without provider setup should show the Supabase "provider is not enabled" error in the form (this check works without credentials). The full sign-in needs verification during implementation.

- [ ] 5. Wire Connected Accounts to real identities.
      - `src/pages/Profile.jsx` (`fb`, `google` state, ~L148 and ~L282-296) and `src/pages/Dashboard.jsx` (`googleLinked`, `fbLinked`, ~L1178 and ~L1344-1356): on mount call `getLinkedProviders()` to set the state. "Connect" calls `linkProvider(provider, '/profile')` or `linkProvider(provider, '/dashboard')`. "Disconnect" calls `unlinkProvider(provider)`, then updates the state, and shows an error through each page's existing error/flash mechanism (Profile `setErr`-style, Dashboard `flash`). Remove the TODO comments that are now done. Keep the markup and CSS classes.
      - Scope check: do not touch other parts of these large files.
      Files: `src/pages/Profile.jsx`, `src/pages/Dashboard.jsx`
      Verify: `npm run build` succeeds. Real linking needs verification during implementation.

- [ ] 6. Add the DB migration for OAuth profiles.
      Create `supabase/migrations/0011_oauth_profile.sql`. It does `create or replace function public.handle_new_user()` with the body of 0004 copied verbatim, plus three changes: (a) `v_full_name := coalesce(nullif(meta->>'full_name',''), nullif(meta->>'name',''), '')`; (b) email `coalesce(new.email, meta->>'email', '')` for the `profiles.email` NOT NULL column; (c) insert `avatar_url` from `meta->>'avatar_url'` or `meta->>'picture'`. Do not change role handling (still coerces to `student` unless `vendor`) and do not recreate the trigger (it already points to the function name). Add a header comment in the style of 0004. Add item 11 to the list in `supabase/README.md` (migrations list) saying to run it in the SQL editor.
      Files: `supabase/migrations/0011_oauth_profile.sql`, `supabase/README.md`
      Verify: `npm run build` still succeeds (SQL is not built). Applying the SQL needs verification during implementation: run it in the Supabase SQL editor and confirm it applies without error. I cannot run it from here.

- [ ] 7. Environment note and checklist.
      The checklist `setup-checklist.md` is already written in this task folder. Add one line to `.env.example` only if the implementer finds a new env var is needed (none is expected). Do not create `supabase/config.toml`.
      Files: none expected
      Verify: `npm run build` succeeds as the final gate for the whole change.

## Needs verification during implementation (requires real credentials or a live project)

- Forgot password email actually arrives, and its link opens `/reset-password` (requires the redirect URL allow-list and, for production, custom SMTP because Supabase's built-in mail sender is heavily rate limited).
- Recovery link behaviour: valid link shows the form; expired or reused link shows the "Link expired or invalid" state; `updateUser` succeeds; the user is signed out and lands on `/login`; the old password stops working and the new one works. Confirm whether the hosted project uses the implicit (`#access_token`) or PKCE (`?code`) link format.
- Whether "Secure password change" / "Confirm email" settings in the Supabase dashboard block `updateUser` right after recovery.
- Google and Facebook sign-in end to end: redirect to provider, return to `/auth/callback`, session picked up, redirect by role.
- A new Google/Facebook user gets a `profiles` row with role `student`, a name, and email (check in SQL editor / Table editor), before and after applying 0011.
- What metadata keys Google and Facebook actually provide (`full_name`, `name`, `avatar_url`, `picture`), and that Facebook without an email still signs in after 0011.
- An email user later signing in with Google/Facebook using the same email: confirm the identity is linked to the same account (Supabase's automatic linking rules) rather than creating a duplicate.
- `linkIdentity` / `unlinkIdentity` need "Manual Linking" enabled in Supabase. Confirm the unlink error when the user has only one identity.
- The Admin role is unaffected (trigger still coerces roles).
