# Verification

## Ran
- `npm run build` (Vite 5): succeeded, 489 modules transformed. Only the existing chunk-size warning appeared.
- No lint or test script exists in package.json, so none was run.
- Not run: dev server / browser flow. It needs a live Supabase project with providers configured, and I did not open any .env file.

## Cannot be verified without real credentials / a live project
- Reset email arrives and its link opens /reset-password; valid link shows the form; expired or reused link shows "Link expired or invalid"; updateUser succeeds; user is signed out and lands on /login; new password works.
- Whether the project uses implicit (#access_token) or PKCE (?code) links, and whether "Secure password change" blocks updateUser.
- Google and Facebook end to end: redirect, return to /auth/callback, session pickup, role redirect.
- Migration 0011 applies in the SQL editor; new OAuth users get a profiles row (role student, name, email, avatar). Provider metadata keys (full_name/name/avatar_url/picture) and Facebook without an email.
- Same-email linking between an email account and Google/Facebook.
- Connected Accounts link/unlink (needs "Manual Linking" enabled; unlinking the only identity returns a Supabase error that is shown in the UI).
- Without provider setup, clicking the buttons should show Supabase's "provider is not enabled" error in the form (not exercised here).