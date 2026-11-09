# Audit-fix batch: broken asset paths, fake-success auth flows, dead code and context memoization

This change resolves eight findings from the project audit on branch `audit-fixes`: it relocates the raster assets so `/images/*` URLs resolve instead of 404ing (C1), repoints the favicon at an asset that now exists (C2), converts the change-password and delete-account flows from silent fake-success into visible errors (C3), deletes a dead route constant (H1), drops an unused geolocation permission prompt (H5), corrects a JSX boolean attribute (M4), memoizes the four context provider values (M6), and trims an unused font family from the Google Fonts import (L5). The approach is deliberately minimal — the hardest finding (C3) is fixed not by rewriting call sites but by defining the previously-missing context methods so the existing guards and try/catch finally do the right thing. The coder recorded `npm run build` exit 0 (75 modules transformed) and a clean set of grep gates in the commit message; those are the build evidence for this review.

Watch for: nothing blocking. C3's behavior change is confirmed correct at both call sites (Profile and Dashboard). The diff stays strictly within the eight in-scope findings and touches none of the out-of-scope items.

**Verdict**: APPROVED

## High-level view

The asset fix (C1) is a pure `git mv` of the root `images/` tree into `public/images/`, so Vite now serves the existing files at the `/images/*` URLs the code already references — no URL in source changed, and the root `images/` folder is gone. The favicon (C2) is repointed from the never-present `/logo.png` to `/images/logo.jpg` with a matching `image/jpeg` type.

C3 is the subtle one and it is correct. `AuthContext` now exposes `changePassword` and `deleteAccount` as stubs that throw "not available yet." Because the call sites in both Profile and Dashboard already wrapped these calls in `try/catch` (password) or delegated to a dialog that does (delete), defining the methods flips the behavior from fake success to a surfaced error: the password path lands in `catch` and shows the message via `role="alert"` instead of reaching the "Password updated" toast, and the delete path throws before `onDeleted()`, so the logout-and-redirect never fires and the dialog shows the error instead. No call-site code needed to change.

The remaining findings are low-risk hygiene: H1 removes an unreferenced `ROUTES` constant, H5 removes the unused `userLocation`/`locationError` state and the `getCurrentPosition` effect that triggered a pointless permission prompt, M4 changes `allowFullScreen=""` to the boolean form, M6 wraps the four provider `value` objects in `useMemo` (with `useCallback` added where the inner functions were previously re-created inline, so dependency arrays are stable), and L5 drops Poppins from the font import while keeping Nunito. Grep gates for every removed symbol come back empty, and the diff is confined to the expected files.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking findings. All eight in-scope fixes are implemented correctly and no out-of-scope code was touched.

</details>

<details>
<summary>Details</summary>

## C1 — Asset relocation via git mv

The 17 raster files moved from root `images/` to `public/images/` as pure renames (the `--stat` shows `{images => public/images}/…` with `Bin` and zero content delta), and no `/images/...` reference in source changed — Vite serves `public/` at `/`, so the URLs that previously 404'd now resolve. Verified on disk: root `images/` no longer exists, `public/images/` exists with 17 git-tracked files including `logo.jpg`.

## C2 — Favicon repointed

`index.html` changes `href="/logo.png"` (a file that never existed) to `href="/images/logo.jpg"`, with `type` updated to `image/jpeg` to match the asset. The target resolves because of C1.

## C3 — Fake success converted to surfaced error

`AuthContext` previously exposed only `{ user, login, updateUser, logout }`, so `auth.changePassword` and `auth.deleteAccount` were `undefined`. The call sites guard on that:

```js
if (changePassword) await changePassword({ ... })   // skipped when undefined
setOk('Password updated.')                          // ran anyway -> fake success

if (deleteAccount) await deleteAccount({ password }) // skipped when undefined
onDeleted()                                          // logout + navigate('/') -> fake "deleted"
```

The fix adds both methods as `useCallback` stubs that throw:

```js
const changePassword = useCallback(() => { throw new Error('Password change is not available yet.') }, [])
const deleteAccount  = useCallback(() => { throw new Error('Account deletion is not available yet.') }, [])
```

Now the guards pass and the throw drives the outcome:

- Change password (`Profile.AccountSettings.submit`, `Dashboard.AccountTab.updatePw`): the `await` throw jumps into the existing `catch`, which calls `setErr`/`setPwErr` with the message, rendered via `role="alert"`. The `setOk('Password updated.')` / `flash('Password updated')` success line is skipped.
- Delete account (`Profile.remove`, `Dashboard.remove`): the throw happens before `onDeleted()`, so the logout-and-redirect never runs. `remove` is passed as `onConfirm` to a `DeleteDialog` whose `submit` wraps `await onConfirm(pass)` in `try/catch` and calls `setError(err.message)`, shown via `role="alert"`.

Both the student (Profile) and vendor (Dashboard) paths are covered. The misleading "success for an operation that never ran" is gone in all four flows.

## H1, H5, M4, L5 — removals and attribute fix

H1 deletes `const ROUTES = { dashboard: '/', menu: '/search' }` from Profile; grep for `ROUTES.` returns nothing. H5 removes the `userLocation`/`locationError` state and the `useEffect` that called `navigator.geolocation.getCurrentPosition`, eliminating the on-load permission prompt that fed nothing (the map iframe is a static embed); grep for `userLocation`, `locationError`, and `navigator.geolocation` all return empty. M4 changes `allowFullScreen=""` to `allowFullScreen` on the map iframe; no `allowFullScreen=` string form remains. L5 drops `Poppins` from the Google Fonts `@import` and keeps `Nunito`; the comment is updated and Metropolis `@font-face` blocks are untouched. Grep for `poppins` in `src/` is empty.

## M6 — Provider value memoization

All four provider `value` objects are wrapped in `useMemo` with dependency arrays listing each piece. Where inner functions were previously plain arrows re-created every render (`toggleTheme` in Theme; `patchVendor` and the five mutators in Vendor), they are now `useCallback`-wrapped so the `useMemo` deps stay stable. Auth and Cart pieces were already stable, so only the outer object needed wrapping. The dependency arrays include every referenced value, so this is a referential-stability change with no behavior difference.

## Scope confirmation

The diff is confined to `index.html`, `src/context/{Auth,Cart,Theme,Vendor}Context.jsx`, `src/pages/Home.jsx`, `src/pages/Profile.jsx`, `src/styles/global.css`, and the 17 image renames. None of the out-of-scope findings (H2, H3, H4, M1, M2, M3, M5, M7, M8, L1, L3, L4, L6, L7) were touched. Notably M5 (EditProfile per-keystroke `updateUser`), M8 (duplicated helpers), and L7 (preview shims) remain as-is, which is correct for this batch.

</details>

<details>
<summary>File map</summary>

- `index.html` — favicon href + type (C2)
- `src/context/AuthContext.jsx` — changePassword/deleteAccount throwing stubs + value useMemo (C3, M6)
- `src/context/CartContext.jsx` — value useMemo (M6)
- `src/context/ThemeContext.jsx` — toggleTheme useCallback + value useMemo (M6)
- `src/context/VendorContext.jsx` — mutators useCallback + value useMemo (M6)
- `src/pages/Home.jsx` — remove geolocation effect + state; allowFullScreen boolean (H5, M4)
- `src/pages/Profile.jsx` — remove dead ROUTES constant (H1)
- `src/styles/global.css` — drop Poppins from font import (L5)
- `{images => public/images}/*.{png,jpg}` — 17 asset renames (C1)

Full diff: `git -C .worktrees/audit-fixes diff main...audit-fixes`

</details>
