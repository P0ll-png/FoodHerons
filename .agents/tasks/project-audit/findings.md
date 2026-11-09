# Food Herons — Project Audit (errors, discrepancies, improvements)

Read-only static audit of the React/Vite frontend at `c:\Users\paulc\Projects\FoodHerons`. Every file under `src/`, plus `index.html`, `package.json`, `vite.config.js`, `.gitignore`, and `README.md`, was read. A production build (`npm run build`) was run once and **succeeded** (75 modules, built in ~8s, exit 0), so there are no module-resolution or syntax errors that break the bundle. The findings below are runtime/behavioral bugs, broken asset references, data and a11y discrepancies, and hygiene suggestions.

## Summary answer (the key finding first)

The single highest-impact issue is an **asset path mismatch**: all raster images are stored in `c:\Users\paulc\Projects\FoodHerons\images\`, but every reference in code points at `/images/...` (an absolute URL served from Vite's `public/` root). `public/` contains only `fonts/` and `LOGO_README.txt` — there is **no `public/images/`** — so every logo, category tile image, cart/footer icon, and the hero/CTA art resolves to a 404 at runtime in both dev and the production build. The favicon `/logo.png` in `index.html` is likewise missing. The app does not crash because almost every `<img>` has an `onError` "hide" handler, but the site renders with no photographic imagery at all. Fix by moving `images/` to `public/images/` (and adding `public/logo.png`), or by importing assets through Vite instead of using root-absolute URLs.

Beyond that: the vendor/student account-deletion and change-password flows call context methods that do not exist, so they silently "succeed" and can navigate the user away as if their account were deleted. There are also several moderate a11y gaps (icon-only logo images with empty alt that are the only logo content, a cross-origin map iframe, decorative emoji) and the usual data/hygiene items. Details and line references follow.

---

## CRITICAL — breaks runtime behavior or core references

### C1. All `/images/*` assets 404 (images live outside `public/`)
- **Where:** asset folder `images/` at the project root vs. references throughout the app.
- **Evidence (references):**
  - `src/data/vendors.js:6-11` — `categories[].image` = `/images/ricemeals.png`, `/images/snacks.png`, `/images/drinks.png`, `/images/desserts.png`, `/images/noodles.png`, `/images/grill.png`.
  - `src/components/Header.jsx:30` — `src="/images/logo.jpg"`.
  - `src/components/Footer.jsx:18`, `:55`, `:58`, `:61` — `/images/logo.jpg`, `/images/email.png`, `/images/facebook.png`, `/images/messenger.png`.
  - `src/components/AuthLayout.jsx:146` — `/images/logo.jpg`.
  - `src/pages/Home.jsx:256-258` (`/images/bowl.png`), `:401` (`/images/stall.png`).
  - `src/pages/Cart.jsx:60` — `/images/cart1.png`.
  - `src/pages/Dashboard.jsx` TopBar logo — `/images/logo.jpg`.
  - `src/pages/Profile.jsx:12` — `LOGO_SRC = '/images/logo.jpg'`.
- **Verified:** `public/` contains only `fonts/` and `LOGO_README.txt` (`Test-Path public\images` → false; `Test-Path images\logo.jpg` → true). Vite serves `public/` at `/`, so `/images/...` does not map to the root `images/` folder.
- **What's wrong:** Every image request 404s. The UI survives only because `onError` hides the broken `<img>` (and category tiles fall back to a non-existent `c.emoji`, see M-series). The app looks image-less rather than broken.
- **Fix:** Move the `images/` directory into `public/images/` (simplest, keeps the `/images/...` URLs working), **or** import each asset (`import logo from '../../images/logo.jpg'`) so Vite fingerprints and bundles them. Also add `public/logo.png` for the favicon (C2). Pick one approach and apply it consistently.

### C2. Favicon `/logo.png` missing
- **Where:** `index.html:6` — `<link rel="icon" type="image/png" href="/logo.png" />`.
- **Verified:** `Test-Path public\logo.png` → false. `public/LOGO_README.txt` documents that the logo is intentionally left empty.
- **What's wrong:** The browser requests `/logo.png` and 404s; no favicon renders.
- **Fix:** Add `public/logo.png`, or point the icon at an existing asset (e.g. move the logo into `public/` and reference it). The README already calls this out as a known placeholder, so this is "expected" but should be flagged before release.

### C3. Account deletion & password change silently no-op (then act as if they succeeded)
- **Where:**
  - `src/context/AuthContext.jsx` — the provider value only exposes `user, login, updateUser, logout`. There is **no** `changePassword` and **no** `deleteAccount`.
  - `src/pages/Profile.jsx:745` passes `changePassword={auth.changePassword}` and `deleteAccount={auth.deleteAccount}` (both `undefined`).
  - `src/pages/Profile.jsx:632` `if (changePassword) await changePassword(...)` and `:644` `if (deleteAccount) await deleteAccount(...)` then `onDeleted()` → `leave()` (logout + navigate `/`).
  - `src/pages/Dashboard.jsx:1167` / `:1201` — same pattern, `onDeleted()` logs out and navigates.
- **What's wrong:** Because the methods are `undefined`, the guarded calls are skipped and the flow proceeds to the success path: "Password updated." toast shows without any change, and "Delete account" logs the user out and redirects as though the account were destroyed. This is misleading and, once a backend exists, a data-safety trap (UI claims success for an operation that never ran).
- **Fix:** Either implement `changePassword`/`deleteAccount` in `AuthContext` (even as stubs that throw "Not implemented"), or have the UI surface a clear "not available yet" state instead of a success toast. At minimum, do not treat a missing method as success.

---

## HIGH — functional bugs, broken references, data integrity

### H1. Dead/incorrect route constant in Profile
- **Where:** `src/pages/Profile.jsx:13` — `const ROUTES = { dashboard: '/', menu: '/search' }`.
- **What's wrong:** `ROUTES` is never read anywhere (grep for `ROUTES.` returns no usages). It also encodes a misleading mapping (`dashboard → '/'`). Dead code that will confuse the next maintainer.
- **Fix:** Remove it, or wire it up and correct `dashboard` to `/dashboard`.

### H2. Student "Favorites" / sample data reference items & vendors that don't exist in the menu data
- **Where:** `src/data/studentSample.js`.
- **Evidence:** order/review items like `Iced Matcha`, `Spanish Latte`, `Bottled Water`, `Hotdog`, `Longsilog` (lines 3-14) are not items in `src/data/vendors.js` menus (e.g. Campus Brews sells `wintermelon/matcha/mango-shake/americano`, not "Iced Matcha"/"Spanish Latte"). `FAVORITES` vendor ids (`tita-nenas`, `campus-brews`) *do* exist, which is good; the item names do not.
- **What's wrong:** Referential drift between placeholder student data and the canonical vendor menus. Harmless today (these are display-only strings), but `Favorites` passes ids into `VendorCard` via `toVendor()`, so any id that stops matching a real vendor would silently render fallback data.
- **Fix:** Align sample item names with real menu entries, or add a comment that `studentSample.js` is purely cosmetic and not referentially tied to `vendors.js`.

### H3. `reviews` prop shadows the review count in VendorStore
- **Where:** `src/pages/VendorStore.jsx:40-49` destructures `reviews` from the vendor object (a **number**, the rating count), while the page also computes `reviewData` (the review **list**) at `:33`. The `reviews` number is used in the rating button label (`:107`, `:110`).
- **What's wrong:** Not a bug per se (the number is what's wanted there), but the name `reviews` meaning "count" while `reviewData.reviews` means "list" is a readability hazard and an easy source of future mistakes.
- **Fix:** Rename the vendor field usage to `reviewCount` locally, or destructure as `reviews: reviewCount`.

### H4. `OrderStatus` auto-advances the order regardless of real state
- **Where:** `src/pages/OrderStatus.jsx:90-94` — a `setTimeout` bumps `stepIndex` every 3.5s until completion.
- **What's wrong:** The tracker always marches pending → accepted → ready → completed on a timer, independent of any vendor action. That's acceptable as a frontend demo, but the "Cancel order" button (`:258`) only appears during the brief pending window, and "Contact vendor"/"Reorder" appear purely on the timer. Once wired to a backend this logic must be replaced, not extended. Flagging as a behavioral discrepancy vs. a real order lifecycle.
- **Fix:** Gate the auto-advance behind a `DEMO_MODE`-style flag so it's obvious this is simulated.

### H5. Geolocation is requested but never used
- **Where:** `src/pages/Home.jsx:198-213` requests `navigator.geolocation.getCurrentPosition` and stores `userLocation`/`locationError`.
- **What's wrong:** `userLocation` and `locationError` are set but never read (the map iframe at `:380` is a static Google Maps embed of "University of Makati"). The app triggers a browser permission prompt on first load for no functional benefit — a privacy/UX wart.
- **Fix:** Either use the coordinates (e.g. center the map on the user) or remove the geolocation request until it's needed.

---

## MEDIUM — accessibility, CSS/state discrepancies

### M1. Logo images are the only logo content but have empty/`aria-hidden` alt
- **Where:** `Header.jsx:31-33`, `Footer.jsx:19-25`, `AuthLayout.jsx:146`, Dashboard TopBar logo, `Profile.jsx` `pf-logo__mark`.
- **What's wrong:** The logo `<img>` uses `alt=""` + `aria-hidden="true"`. In the header the adjacent `.brand__text` ("FOOD HERONS") supplies an accessible name via the wrapping `Link aria-label`, so that case is fine. But in `AuthLayout` the logo is the sole visual in `.auth__logo` with no nearby text, and in the footer the logo sits beside a styled name — acceptable, but worth confirming each logo has a text equivalent nearby. Since images 404 today (C1), screen-reader users and sighted users both get nothing.
- **Fix:** Give the primary brand logo a meaningful `alt="Food Herons"` in at least one place per view, and keep purely decorative repeats `alt=""`.

### M2. Category tile emoji fallback references a non-existent field
- **Where:** `src/pages/Home.jsx:327-329` — `{c.image ? <img .../> : <span className="cat-tile__emoji">{c.emoji}</span>}`.
- **What's wrong:** `categories` in `vendors.js` have `image` but no `emoji`. Because every category has an `image`, the image branch always runs; combined with C1 the image 404s and `onError` hides it, leaving an **empty plate** with no emoji fallback (the `emoji` branch is never reached, and would render `undefined` if it were). Dead fallback + no graceful degradation.
- **Fix:** After fixing C1 the images render. Separately, either add `emoji` values to categories or drop the dead fallback branch.

### M3. Decorative emoji used as content in empty/404 states
- **Where:** `Home.jsx:234` (`🔍`), `NotFound.jsx:8` (`🍳`), `OrderStatus.jsx:103` (`📦`). Each is wrapped `aria-hidden="true"`, which is correct, but emoji rendering is inconsistent across platforms and clashes with the "no emoji, inline SVG icons" convention stated in `Icon.jsx:1`.
- **Fix:** Replace with the existing inline SVG icons (`search`, `receipt`/`inbox`, etc.) for visual consistency with the rest of the app.

### M4. External links: map iframe and social links
- **Where:** `Home.jsx:382-390` Google Maps `<iframe>`; `Footer.jsx:56-60` `facebook.com` / `m.me` links.
- **What's wrong (minor):** The social `<a target="_blank">` links correctly include `rel="noreferrer"` (good — no `noopener` gap). The map iframe uses `allowFullScreen=""` as a string attribute; in JSX this should be `allowFullScreen` (boolean) — it works but is a React anti-pattern and logs no error. The iframe has a `title` (good for a11y).
- **Fix:** Change `allowFullScreen=""` to `allowFullScreen`. No security change needed for the social links.

### M5. `useEffect` cleanup in EditProfile reverts user on unmount (fragile pattern)
- **Where:** `src/pages/Profile.jsx` EditProfile — `useEffect(() => () => { if (!committed.current) updateUser(original.current) }, [])` plus a second effect that calls `updateUser(patch)` on every `form`/`photo` change.
- **What's wrong:** The component writes to global auth state on *every keystroke* and then rolls back on unmount if not "committed". This causes extra `AuthProvider` re-renders app-wide per keystroke and makes the data flow hard to reason about (two effects racing to call `updateUser`). The `// eslint-disable-next-line react-hooks/exhaustive-deps` on both effects hides the intentional dependency omissions.
- **Fix:** Keep edits in local component state and call `updateUser` once on Save (the `save` handler already does the authoritative write at `:238`). Drop the per-keystroke effect and the unmount-revert.

### M6. Context value objects are re-created every render (unnecessary re-renders)
- **Where:** `AuthContext.jsx:46` (`value={{ user, login, updateUser, logout }}`), `ThemeContext.jsx:30`, `CartContext.jsx:66`, `VendorContext.jsx` provider value.
- **What's wrong:** The `value` object literal is new on every provider render, so all consumers re-render even when the underlying data is unchanged. `CartContext` and `VendorContext` already `useMemo`/`useCallback` their inner pieces, but the outer `value` object itself isn't memoized.
- **Fix:** Wrap each provider `value` in `useMemo([...deps])`. Low effort, measurable win on a context-heavy tree.

### M7. `window.alert` used for a user-facing message
- **Where:** `OrderStatus.jsx` `handleContact` — `window.alert('This vendor has not added a contact number yet.')`.
- **What's wrong:** Native `alert` is jarring and inconsistent with the app's toast/modal patterns (the Dashboard has a `flash` toast; OrderStatus has a modal).
- **Fix:** Replace with an inline message or the existing modal/toast style.

### M8. Duplicated helper code across pages
- **Where:** `phDigits` / `phFormat` / `phValid` are defined in `Dashboard.jsx`, `Profile.jsx`, and (as `cleanPHMobile`/`isValidPHMobile`) in `AuthLayout.jsx`. `initials()` is defined in `Dashboard.jsx`, `Profile.jsx`, and `Avatar.jsx`. `pwRules()` and `PasswordField` exist in both `Dashboard.jsx` and `Profile.jsx`. A `Peso` component is re-declared in `VendorStore.jsx`, `Cart.jsx`, `OrderStatus.jsx`, and `Dashboard.jsx`.
- **What's wrong:** Four+ copies of the same logic drift over time (e.g. `pwRules` in Profile marks the special-char rule `optional: true`, Dashboard's does not — already a subtle divergence).
- **Fix:** Extract to `src/lib/phone.js`, `src/lib/password.js`, and a shared `src/components/Peso.jsx` / `src/lib/initials.js`.

---

## LOW — hygiene, config, suggestions

### L1. No linter, formatter, or test tooling configured
- **Where:** `package.json` scripts are only `dev`/`build`/`preview`; no ESLint, Prettier, or test runner in `devDependencies`.
- **Fix:** Add `eslint` + `eslint-plugin-react-hooks` (would have flagged the effect-dependency issues in M5), `prettier`, and a `lint` script. Consider Vitest for unit tests of the pure helpers (phone/password/`isOpenNow`).

### L2. `dist/` is NOT tracked in git (good) — but build output exists on disk
- **Where / verified:** `git ls-files dist` → 0 files; `.gitignore:2` lists `dist`. The `dist/` directory present in the working tree (and `dist/index.html` is open in the editor) is a local build artifact, correctly ignored.
- **Note:** No action needed. Flagging only because the task asked to confirm: build output is properly git-ignored and untracked.

### L3. `index.html` missing a couple of niceties
- **Where:** `index.html`.
- **What's wrong (minor):** `lang="en"` ✓, viewport ✓, description ✓, `theme-color` ✓. Missing: Open Graph/social meta tags and `apple-touch-icon`. The `theme-color` is a single light value; a `media="(prefers-color-scheme: dark)"` variant would match the app's dark mode.
- **Fix:** Add OG tags and a dark `theme-color` if social sharing / PWA polish matters.

### L4. Dependency versions use caret ranges
- **Where:** `package.json` — `react ^18.3.1`, `react-router-dom ^6.26.2`, `vite ^5.4.8`, `@vitejs/plugin-react ^4.3.1`.
- **What's wrong:** Caret ranges allow minor/patch drift; a `package-lock.json` is present (good) so installs are reproducible, but there's no pinning policy.
- **Fix:** Acceptable as-is given the lockfile. Pin exactly if you want byte-identical CI installs.

### L5. Font `@import` of Nunito/Poppins is unused given Metropolis is the brand font
- **Where:** `src/styles/global.css:10` imports Google Fonts "Nunito" and "Poppins", but `--font-brand` (`tokens.css`) is `"Metropolis", "Nunito", "Segoe UI", system-ui`. Poppins is never listed in any font stack.
- **What's wrong:** A render-blocking Google Fonts request for a family (Poppins) that nothing uses, plus Nunito only as a fallback. Minor perf + privacy (external request) cost.
- **Fix:** Drop Poppins from the import; consider self-hosting Nunito or removing it since Metropolis is self-hosted in `public/fonts/`.

### L6. Mixed indentation / stray whitespace in JSX
- **Where:** `VendorStore.jsx` (inconsistent 1-3 space indents around the store header, e.g. `:26`, `:62-130`), `Cart.jsx` (`:98` extra spaces), `Dashboard.jsx` TopBar nav block.
- **What's wrong:** Cosmetic; makes diffs noisy. A formatter (L1) resolves this.

### L7. `Profile.jsx` keeps a disabled auth redirect in place for preview
- **Where:** `Profile.jsx:735` — `// if (!auth.user) return <Navigate to="/login" replace />` is commented out, and `PREVIEW_USER` (`:17`) seeds a fake student. `Header.jsx:56` and `AuthContext` `DEMO_MODE = true` are the matching preview scaffolding.
- **What's wrong:** Intentional (clearly TODO-commented), but these preview shims (`DEMO_MODE`, `PREVIEW_USER`, the commented redirect, the "frontend preview only" nav links) must all be reverted together before real auth ships, or unauthenticated users will see a fake profile.
- **Fix:** Track these with a single feature flag so they flip off in one place.

---

## Things checked that are OK (so they're not re-investigated later)

- **Build:** `npm run build` succeeds, exit 0, 75 modules — no import/export resolution errors, no missing JSX components.
- **Routes:** every `<Link>`/`<NavLink>`/`navigate()` target (`/`, `/search`, `/vendor/:id`, `/cart`, `/order/:id`, `/profile`, `/dashboard`, `/login`, `/signup`) maps to a `<Route>` in `App.jsx:37-47`; a `path="*"` → `NotFound` catch-all exists. No dead or duplicate routes.
- **Provider nesting:** `App.jsx` nests `ThemeProvider > AuthProvider > VendorProvider > CartProvider`. `CartContext` consumes `useVendors()`, so `VendorProvider` correctly wraps `CartProvider` (the comment at `App.jsx:33` documents this dependency). All `useX()` hooks throw outside their provider — correct.
- **Tokens / CSS vars:** `global.css:10` does `@import "./tokens.css"`, so custom properties load before any component CSS. Core semantic tokens (`--bg`, `--text`, `--primary`, spacing, radii, shadows, status colors) are defined for both light and `[data-theme="dark"]`. The `coverTint` values in `vendors.js` (`var(--orange-soft)`, `var(--yellow-pale)`) reference defined tokens.
- **Data integrity (vendors):** `vendors[].id` are all unique; `menu[].id` unique within each vendor; `reviews.js` `getReviewsFor()` derives everything from the passed vendor (no hardcoded vendor-id coupling); `categoryName()`/`getVendor()` use safe `?.`/`??` fallbacks.
- **Cart math:** `CartContext` computes `count`/`total` from live menu data and filters out unavailable/deleted items — quantity and total logic is correct; adding from a different vendor resets the cart (single-vendor invariant held in one reducer state).
- **Storage robustness:** every `localStorage`/`sessionStorage` access is wrapped in try/catch with sensible fallbacks (Theme, Auth, Vendor, Search, Cart order persistence).
- **No security red flags:** no `dangerouslySetInnerHTML`, no hardcoded secrets/API keys, no `.env` committed (`.gitignore` covers `.env*`). The CSV export in `Dashboard.jsx` even guards against CSV-injection (`'^[=+\-@]'` prefixing).
- **External `target="_blank"` links** include `rel="noreferrer"` (Footer social links).

---

## Prioritized action list

1. **C1 — Fix image paths.** Move `images/` → `public/images/` (or import assets). Highest visible impact; unblocks M2 and most of the "looks broken" perception. *(CRITICAL)*
2. **C2 — Add `public/logo.png`** (or repoint the favicon). *(CRITICAL)*
3. **C3 — Stop faking success for change-password/delete-account.** Implement stubs in `AuthContext` or show an explicit "unavailable" state. *(CRITICAL)*
4. **H5 — Remove or use the Home geolocation request** (avoids an unnecessary permission prompt). *(HIGH)*
5. **H1 — Delete the dead/incorrect `ROUTES` constant** in `Profile.jsx`. *(HIGH)*
6. **H2 — Reconcile `studentSample.js` item names** with real menus, or document them as cosmetic. *(HIGH)*
7. **M6 — Memoize context `value` objects** (quick perf win). **M5 — Simplify EditProfile's per-keystroke `updateUser`.** *(MEDIUM)*
8. **M1/M3/M4 — a11y polish:** one meaningful logo `alt` per view; swap content emoji for SVG icons; `allowFullScreen` boolean. *(MEDIUM)*
9. **M8 — Deduplicate helpers** (`Peso`, phone, password, initials) into `src/lib`. *(MEDIUM)*
10. **L1 — Add ESLint + Prettier (+ Vitest)**; **L5 — drop unused Poppins font import**; **L7 — gate preview shims behind one flag.** *(LOW)*

*Note:* `dist/` build output is already correctly git-ignored and untracked — no action required there.
