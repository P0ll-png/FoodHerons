# Setup checklist: password reset, Google and Facebook login

These steps happen in third-party dashboards and cannot be done in code. Do not commit client secrets. Paste them only into the Supabase dashboard.

Replace `<project-ref>` with your Supabase project reference (the part before `.supabase.co` in `VITE_SUPABASE_URL`) and `<production-url>` with the deployed site URL.

## 1. Supabase: URL configuration

Supabase dashboard > Authentication > URL Configuration.

- [ ] Site URL: `<production-url>` (use `http://localhost:5173` while only developing locally).
- [ ] Redirect URLs (add all):
  - `http://localhost:5173/**`
  - `<production-url>/**`
  The wildcard covers `/reset-password`, `/auth/callback`, `/auth/confirmed`, `/profile` and `/dashboard`.

## 2. Supabase: callback URL (needed by both providers)

- [ ] `https://<project-ref>.supabase.co/auth/v1/callback`. Copy it from Authentication > Sign In / Providers > Google (or Facebook), where Supabase shows it as "Callback URL".

## 3. Google

Google Cloud console > APIs & Services.

- [ ] Create or choose a project.
- [ ] OAuth consent screen: set app name, support email, and add the scopes `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`. While in "Testing", add your test users.
- [ ] Credentials > Create credentials > OAuth client ID > Web application.
  - Authorized JavaScript origins: `http://localhost:5173` and `<production-url>`.
  - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`.
- [ ] Copy the Client ID and Client secret.
- [ ] Supabase dashboard > Authentication > Sign In / Providers > Google: enable, paste Client ID and Client secret, save.
- [ ] Publish the consent screen when you want non-test users to sign in.

## 4. Facebook

Meta for Developers (developers.facebook.com).

- [ ] Create an app (use case: "Authenticate and request data from users with Facebook Login").
- [ ] Add the Facebook Login product > Settings > Valid OAuth Redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`.
- [ ] App settings > Basic: copy the App ID and App Secret. Set a Privacy Policy URL and app domains for going live.
- [ ] Permissions: `email` and `public_profile`. A user can decline sharing an email, which the app handles after migration 0011.
- [ ] Supabase dashboard > Authentication > Sign In / Providers > Facebook: enable, paste App ID and App Secret, save.
- [ ] While the app is in Development mode only app roles (admins, developers, testers) can sign in. Switch to Live for everyone.

## 5. Supabase: auth settings

- [ ] Authentication > Sign In / Providers: enable "Manual linking" (needed for the Connect/Disconnect buttons on Profile and Dashboard).
- [ ] Minimum password length must be 8 or lower. The app enforces 8+ with upper, lower, number and symbol.
- [ ] Email templates: the "Reset Password" template must keep `{{ .ConfirmationURL }}`.
- [ ] Production: configure custom SMTP (Authentication > Emails > SMTP Settings). The built-in sender is limited to a few emails per hour, which breaks reset emails for real users.

## 6. Database

- [ ] After implementation, run `supabase/migrations/0011_oauth_profile.sql` in the Supabase SQL editor (see `supabase/README.md`).

## 7. Local `.env.local`

- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are already used. No new variables are needed. Restart `npm run dev` after any change.

## 8. Test after setup

- [ ] Forgot password with a real email: the link opens `/reset-password`, the password changes, you land on `/login`, and the new password works.
- [ ] Open the same reset link a second time: the page shows "Link expired or invalid".
- [ ] "Continue with Google" and "Continue with Facebook" on Login and on Signup (as Student): you return to the app signed in, and the new user has a `student` row in `profiles`.
- [ ] Connect and Disconnect on Profile (student) and Dashboard (vendor).
