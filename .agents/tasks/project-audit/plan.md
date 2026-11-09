# Implementation Plan — FoodHerons Audit Fixes

All work happens in the git worktree at `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes` (branch `audit-fixes`). Step agents' cwd is the parent workspace, so use absolute paths and `git -C "c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes"` for every git operation. Verified base state: working tree clean, root `images/` exists, `public/images/` does not, favicon points at a missing `/logo.png`, `AuthContext` has no `changePassword`/`deleteAccount`, build script is `vite build` (React 18.3 + react-router-dom 6.26 + Vite 5.4, plain JSX).

Line numbers below are the ACTUAL worktree lines confirmed by reading the files; they differ slightly from findings.md. Match on the quoted text, not the line number.

Scope is EXACTLY the eight fixes below. Do NOT touch H2, H3, H4, M1, M2, M3, M5, M7, M8, L1, L3, L4, L6, L7.

Do items in order. Items 1–8 are edits; item 9 is the single build + grep + commit gate. Each edit item leaves the tree buildable (the final `npm run build` in item 9 is the one authoritative buildability check, since item 1's image move is what makes the referenced assets resolve).

---

- [ ] 1. **C1 — Move `images/` to `public/images/` so `/images/...` URLs resolve.** Run the git rename (do NOT edit any `/images/...` URL in code). Then confirm every referenced file landed under `public/images/`.
      Files: moves `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\images\` → `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\public\images\` (no source edits).
      Command: `git -C "c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes" mv images public/images`
      Referenced files that MUST exist under `public/images/` after the move (grep-confirmed references in `src/`): logo.jpg, ricemeals.png, snacks.png, drinks.png, desserts.png, noodles.png, grill.png, email.png, facebook.png, messenger.png, bowl.png, stall.png, cart1.png. (The directory also contains arrow.png, cart.png, login.png, search.png — harmless extras, keep them.)
      Verify: `git -C "...audit-fixes" status` shows the renames staged; `Test-Path "c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\public\images\logo.jpg"` → True; `Test-Path "c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\images"` → False. Final proof is the clean build in item 9.

- [ ] 2. **C2 — Repoint favicon to an existing asset.** In `index.html` replace the line `    <link rel="icon" type="image/png" href="/logo.png" />` (line 5) with `    <link rel="icon" type="image/jpeg" href="/images/logo.jpg" />`. Do NOT create a new logo.png.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\index.html`
      Verify: `git grep -n "logo.png" -- index.html` (run via `git -C "...audit-fixes"`) returns nothing; `git grep -n "/images/logo.jpg" -- index.html` returns the new line. Depends on item 1 for the target file to exist.

- [ ] 3. **C3a — Add throwing stubs to AuthContext.** In `src/context/AuthContext.jsx`, after the `logout` callback (around line 46) add two `useCallback` stubs that throw a clear "not available yet" message, and add both to the provider `value`.
      Add:
      ```jsx
      const changePassword = useCallback(() => {
        throw new Error('Password change is not available yet.')
      }, [])

      const deleteAccount = useCallback(() => {
        throw new Error('Account deletion is not available yet.')
      }, [])
      ```
      Then change the provider open tag `<AuthContext.Provider value={{ user, login, updateUser, logout }}>` to include the two new functions (the final `value` is wired via `useMemo` in item 7 — if item 7 is done first, add these keys to that memo instead; items 3 and 7 both touch this `value` object, so whichever runs second must include ALL six keys: `user, login, updateUser, logout, changePassword, deleteAccount`).
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\src\context\AuthContext.jsx`
      Verify: build in item 9 passes; manual read confirms both functions throw and both appear in the provider value.

- [ ] 4. **C3b — Confirm Profile call sites surface the thrown error (no source change expected, verify only; adjust if needed).** Read `src/pages/Profile.jsx` `AccountSettings.submit` (~line 622: `if (changePassword) await changePassword(...)` inside `try/catch`) and `remove` (~line 644: `if (deleteAccount) await deleteAccount({ password }); onDeleted()`), plus `DeleteDialog.submit` (~line 565: `try { await onConfirm(pass) } catch (err) { setError(...) }`).
      Behavior analysis (already correct once item 3's stubs throw, because `auth.changePassword`/`auth.deleteAccount` are now defined so the `if (...)` guards are truthy and the awaits run):
      - Password: the throw is caught by `submit`'s `catch`, which sets `err` to the thrown message and skips the `setOk('Password updated.')` success path.
      - Delete: the throw propagates out of `remove` BEFORE `onDeleted()` runs (so no logout/redirect), is caught by `DeleteDialog.submit`, which sets `error` to the thrown message.
      KEEP the `if (changePassword)` / `if (deleteAccount)` guards (they are now truthy, so no harm) and KEEP the existing try/catch and toast/`err`/`error` patterns. Make NO edit unless reading reveals the flow differs from this analysis (e.g. `onDeleted()` is inside the `try` after the await — it is not; it is the statement after the awaited guard). If an edit is needed, the minimum change is to ensure `onDeleted()` only runs when `deleteAccount` did NOT throw (it already does, since a throw skips it).
      Files (only if a fix is required): `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\src\pages\Profile.jsx`
      Verify: build in item 9 passes; confirm by reading that neither success path (`setOk('Password updated.')`, `onDeleted()` logout) can run when the stub throws.

- [ ] 5. **C3c — Confirm Dashboard call sites surface the thrown error (verify only; adjust if needed).** Read `src/pages/Dashboard.jsx` `updatePw` (~line 1167: `if (auth?.changePassword) await auth.changePassword(...)` inside `try/catch` with `flash('Password updated')` on success) and `remove` (~line 1200: `if (auth?.deleteAccount) await auth.deleteAccount({ password }); onDeleted()`), plus `DeleteDialog.submit` (~line 1075: `try { await onConfirm(pass) } catch (err) { setError(...) }`), and `AccountTab`'s `onDeleted={() => { auth?.logout?.(); navigate('/') }}` (~line 1551).
      Behavior analysis (correct once item 3 stubs throw): the password throw is caught by `updatePw`'s `catch` → `setPwErr(message)`, skipping `flash('Password updated')`; the delete throw propagates out of `remove` before `onDeleted()` → caught by `DeleteDialog.submit` → `setError(message)`, no logout/redirect. KEEP the `auth?.changePassword` / `auth?.deleteAccount` guards and existing error/flash patterns. Make NO edit unless reading reveals the flow differs.
      Files (only if a fix is required): `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\src\pages\Dashboard.jsx`
      Verify: build in item 9 passes; confirm by reading that neither `flash('Password updated')` nor the `onDeleted()` logout can run when the stub throws.

- [ ] 6. **H1 + H5 + M4 — Clean up `src/pages/Home.jsx` and `src/pages/Profile.jsx` dead/unused code (grouped: all in two page files, independent edits).**
      6a. **H1** — In `src/pages/Profile.jsx` remove the dead constant `const ROUTES = { dashboard: '/', menu: '/search' }` (line 14). Grep confirmed zero `ROUTES.` usages. Leave `const LOGO_SRC = '/images/logo.jpg'` (line 13) untouched — it IS used.
      6b. **H5** — In `src/pages/Home.jsx` remove the two unused state declarations (lines 195–196):
      ```jsx
      const [userLocation, setUserLocation] = useState(null)  // { lat, lng } from the browser
      const [locationError, setLocationError] = useState('')  // message if location is denied
      ```
      and remove the entire geolocation `useEffect` block (lines ~199–215) that starts with the comment `/* ---------- Ask the browser for the user's location ... */` and contains `navigator.geolocation.getCurrentPosition(...)`, including its `setUserLocation(...)` and `setLocationError(...)` calls. Remove the explanatory comment line too. Nothing else reads these vars (grep-confirmed: all matches are the declarations and the effect). Do not remove the `useEffect` import (it is used elsewhere in the file — confirm before deleting any import).
      6c. **M4** — In `src/pages/Home.jsx` map iframe (~line 371) change the string attribute `allowFullScreen=""` to the boolean JSX form `allowFullScreen`.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\src\pages\Profile.jsx`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\src\pages\Home.jsx`
      Verify: `git -C "...audit-fixes" grep -n "ROUTES"` returns nothing; `git -C "...audit-fixes" grep -n "userLocation\|locationError\|geolocation"` returns nothing; `git -C "...audit-fixes" grep -n 'allowFullScreen' -- src` shows the boolean form (no `=""`); build in item 9 passes.

- [ ] 7. **M6 — Memoize each context provider's `value` object.** Wrap the four provider `value` literals in `useMemo` with correct dependency arrays. Where an inner handler is currently recreated every render, wrap it in `useCallback` first so the memo actually prevents re-renders (behavior unchanged). Import `useMemo`/`useCallback` where not already imported.
      7a. `src/context/AuthContext.jsx` — `login`, `updateUser`, `logout`, `changePassword`, `deleteAccount` are all `useCallback`-stable; `user` is state. Wrap: `const value = useMemo(() => ({ user, login, updateUser, logout, changePassword, deleteAccount }), [user, login, updateUser, logout, changePassword, deleteAccount])` and use `value={value}`. (Coordinate with item 3: the memo MUST contain all six keys.)
      7b. `src/context/ThemeContext.jsx` — `toggleTheme` is currently a plain function (recreated each render). Wrap it: `const toggleTheme = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), [])`. Then `const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])`; use `value={value}`. Add `useCallback`, `useMemo` to the React import.
      7c. `src/context/CartContext.jsx` — `addItem`, `setQty`, `clearCart` are `useCallback`-stable; `vendorId, items, lines, count, total` come from the existing `useMemo`/reducer. Wrap: `const value = useMemo(() => ({ vendorId, items, lines, count, total, addItem, setQty, clearCart }), [vendorId, items, lines, count, total, addItem, setQty, clearCart])`; use `value={value}`. `useMemo` is already imported.
      7d. `src/context/VendorContext.jsx` — `getVendor` is `useCallback`-stable, but `patchVendor`, `updateVendorInfo`, `setPreorderEnabled`, `saveMenuItem`, `setItemAvailable`, `deleteMenuItem` are plain functions recreated each render. Wrap each of the five exposed mutators (and `patchVendor`) in `useCallback` with `[]` deps (they only use the stable `setRawVendors` updater, so `[]` is correct and behavior-preserving). Then `const value = useMemo(() => ({ vendors, currentVendorId, getVendor, updateVendorInfo, setPreorderEnabled, saveMenuItem, setItemAvailable, deleteMenuItem }), [vendors, currentVendorId, getVendor, updateVendorInfo, setPreorderEnabled, saveMenuItem, setItemAvailable, deleteMenuItem])`; use `value={value}`. `useCallback`/`useMemo` are already imported. Do not change any mutator's logic.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\src\context\AuthContext.jsx`, `...\src\context\ThemeContext.jsx`, `...\src\context\CartContext.jsx`, `...\src\context\VendorContext.jsx`
      Verify: build in item 9 passes with no missing-import or undefined-variable errors; app behavior unchanged (same keys exposed by each context).

- [ ] 8. **L5 — Drop unused Poppins from the Google Fonts import.** In `src/styles/global.css` line 10, change the `@import url(...)` so the query keeps Nunito and removes the Poppins family. Replace:
      `@import url("https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Poppins:wght@500;600;700;800&display=swap");`
      with:
      `@import url("https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap");`
      Optionally update the stale comment on line 8 (`/* Fonts (Poppins for display, Nunito for body) */`) to drop the Poppins mention. Do NOT touch the `@font-face` Metropolis blocks or `--font-brand` in `tokens.css`.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes\src\styles\global.css`
      Verify: `git -C "...audit-fixes" grep -ni "poppins" -- src` returns nothing (or only the comment if you chose to leave it — prefer removing it); build in item 9 passes.

- [ ] 9. **Final verification + single commit.** Run the authoritative build and the grep checks, then commit once on `audit-fixes` (no push, no PR).
      9a. Install deps only if `node_modules` is missing: from the worktree, `npm install` (skip if already present).
      9b. Build: run `npm run build` in `c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes` and confirm it exits 0; report the module count from Vite's output (baseline was 75 modules).
      9c. Grep gates (all via `git -C "c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes"`):
         - `git grep -n "userLocation\|locationError\|geolocation" -- src` → no matches.
         - `git grep -n "ROUTES" -- src` → no matches.
         - `git grep -n "/logo.png\|logo.png" -- index.html` → no matches; `git grep -n "/images/logo.jpg" -- index.html` → one match.
         - `git grep -ni "poppins" -- src` → no matches (or only the comment, if kept).
         - `git grep -n 'allowFullScreen=\"\"' -- src` → no matches.
      9d. Asset/rename checks: `Test-Path "...\public\images\logo.jpg"` → True; `Test-Path "...\images"` → False; `git -C "...audit-fixes" status` shows the `images/ → public/images/` rename plus the edited files.
      9e. Commit everything on `audit-fixes` in one commit referencing the finding ids, e.g.:
         `git -C "c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes" add -A`
         `git -C "c:\Users\paulc\Projects\FoodHerons\.worktrees\audit-fixes" commit -m "fix(audit): resolve C1,C2,C3,H1,H5,M4,M6,L5" -m "C1 move images to public/images; C2 favicon -> /images/logo.jpg; C3 throwing changePassword/deleteAccount stubs; H1 remove dead ROUTES; H5 drop unused geolocation; M4 boolean allowFullScreen; M6 memoize context values; L5 drop unused Poppins font"`
      No `git push`, no PR.
      Files: none new; commits the worktree.
      Verify: `npm run build` exit 0; all grep gates pass; `git -C "...audit-fixes" log --oneline -1` shows the new commit; `git -C "...audit-fixes" status` is clean afterward.

## Assumptions / notes
- findings.md's line numbers are off by a line or two from the live worktree; the plan quotes exact text so the implementer matches on content.
- C3 (items 4 and 5) is expected to need NO call-site edits because the existing guarded `await` + try/catch already surfaces a thrown error and skips the success path once the stubs exist; the items are written as verify-and-only-fix-if-needed to honor the audit's "surface the error, don't fake success, don't log out" requirement.
- M6 wraps previously-unmemoized inner handlers (ThemeContext `toggleTheme`, VendorContext mutators) in `useCallback` so the outer `useMemo` is effective; this is behavior-preserving (same functions, same results).
- The one build in item 9 is the authoritative buildable-state check for the whole batch, since item 1's asset move is what lets `/images/...` references resolve at build/runtime.
