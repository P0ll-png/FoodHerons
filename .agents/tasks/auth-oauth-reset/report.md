# Report

Forgot/reset password and Google/Facebook sign-in and connections are wired to Supabase Auth.

## Changes
- AuthContext: added requestPasswordReset, completePasswordReset (updateUser, then sign out), loginWithProvider (signInWithOAuth, redirectTo /auth/callback), getLinkedProviders, linkProvider, unlinkProvider.
- ForgotPassword: sends resetPasswordForEmail (redirectTo /reset-password), email validation, "Sending…" state, generic success message (no email-existence leak), rate-limit message.
- ResetPassword: waits for the recovery session, shows "Link expired or invalid" with a link to request a new one (URL error or 8 s timeout), then the existing form (strength + confirm checks); redirects to /login after success. Routes already existed and Login already linked to forgot-password.
- Login/Signup: Google and Facebook buttons call signInWithOAuth; errors show in the form. On Signup with Vendor selected, social buttons show a message to create the store by email (OAuth cannot carry role/store).
- /auth/callback route reuses ConfirmEmail with an oauth prop (sign-in wording, provider error_description).
- Profile and Dashboard Connected Accounts use real identities (linkIdentity/unlinkIdentity).
- Migration 0011_oauth_profile.sql (name/email/avatar fallbacks in handle_new_user); README item 11.
- No supabase/config.toml: the project has none and applies SQL by hand, so provider and URL setup is in setup-checklist.md.

## Action needed from you
Run migration 0011 in the SQL editor and follow setup-checklist.md. See verification.md for what remains unverified.