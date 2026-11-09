# Merge Conflict Resolution Plan

Resolving the in-progress merge of `origin/Feature/UI-Updates` ("theirs", polished
styling + user components) into `main` ("ours", `f9115f0` vector-cartoon redesign).
Do NOT run `git merge` again, do NOT abort, do NOT touch `stash@{0}`.

## Grounding facts discovered during exploration

These drive every decision below. They were read from the already-merged (staged,
non-conflicted) files, which are the authoritative contract the 15 conflicted files
must satisfy:

- **Build**: Vite + React 18. Commands from `package.json`: `npm run build` (prod
  build), `npm run dev`. No test runner exists in the repo.
- **`src/App.jsx` (merged)** wraps the tree in `ThemeProvider > AuthProvider >
  VendorProvider > CartProvider` and routes include `/search`, `/profile`,
  `/dashboard`. The Feature side is the one these providers/routes come from.
- **`src/context/VendorContext.jsx` (merged)** exports `useVendors()` returning
  `{ vendors, getVendor, currentVendorId, ... }`. `vendors` carries a live `isOpen`.
- **`src/context/AuthContext.jsx` (merged)** exports `useAuth()` returning
  `{ user, login, updateUser, logout }`; `user = { name, email, mobile, role, avatar }`,
  `role` is `'Student' | 'Vendor'`.
- **`src/data/vendors.js` (merged)** still exports `vendors`, `getVendor`,
  `categoryName`, `categories`, `locationAreas`. Vendor records keep `coverTint`
  AND optionally `logo`, `cover`, `phone`.
- **`src/components/Avatar.jsx`, `AuthLayout.jsx`, `ReviewsModal.jsx` (merged)**
  are imported by the Feature side of the conflicted files. `AuthLayout.jsx`
  exports: default `AuthLayout`, plus `PasswordField`, `PhoneField`, `AuthDivider`,
  `AuthTerms`, `FacebookButton`, `isStrongPassword`, `isValidPHMobile`.
- **`src/components/HeronMascot.jsx` stays** — it is still used by the merged
  `Footer.jsx`. `BlobField.jsx` becomes unused after resolution (all its call sites
  live in dropped HEAD hunks); leaving the file in place does NOT break the build.

### Global guiding principle (applies to all 15 files)

The already-merged new files (Profile, Search, AuthLayout, Avatar, EmptyState,
ReviewsModal, AuthContext, VendorContext, reviews.js, studentSample.js, App.jsx)
are written against the **Feature/UI-Updates** structure. Therefore, for every
conflict, **keep the Feature side's imports, component APIs, JSX structure, routing,
and the CSS class names its markup uses**. From the main cartoon side, preserve only
visual tokens/rules that surviving (Feature-side) markup still references — chiefly
the `starSolid` icon and the `--radius-xl` token (both proven to be referenced by
merged/Feature code below).

### Cross-file consistency contract (must hold after resolution)

- Icon registry must contain the **union** needed by surviving code: `starSolid`
  (used by merged `VendorCard.jsx` body + Feature `VendorStore` header), plus
  `star`, `peso`, `user`, `mail`, `lock`, `store`, `eye`, `eyeOff`, `trash`, `all`,
  `thumb`, `checkBold` (used by Feature pages / merged Avatar, AuthLayout, Profile,
  Search, ReviewsModal, Cart, OrderStatus, Dashboard).
- Design tokens: keep Feature radius scale values, but **retain `--radius-xl`**
  (referenced by surviving `Home.css .empty`) and **retain `--field-radius`**
  (referenced by merged `Dashboard.css` and `Profile.css`).
- Vendor cover fallback token name is `coverTint` (still in data) — do not rename.

---

## Per-file resolution decisions

### 1. `src/components/Icon.jsx` (2 conflict hunks)
- **Decision: KEEP THE UNION of both sides' icon keys.** This is the one file where
  you must not drop a whole side.
- Hunk 1 (`moon`, `user`): both sides define `moon` and `user`. Take the
  **Feature-side** `moon` and `user` (filled variants — `user` is the Avatar
  fallback). Then ALSO keep the Feature-only keys in this hunk: `mail`, `lock`,
  `store`, `eye`, `eyeOff`.
- Hunk 2 (`starSolid` vs Feature block): **KEEP HEAD's `starSolid`** (merged
  `VendorCard.jsx` line ~90 and Feature `VendorStore` header reference it) AND keep
  the entire Feature-only block: `peso`, `trash`, `all`, `inbox`, `history`,
  `utensils`, `bag`, `panel`, `bellOff`, `home`, `bell`, `logout`, `download`,
  `upload`, `camera`, `receipt`, `review`, `starOutline`, `facebook`,
  `chevronCircle`, `clockOutline`, `passEye`, `passEyeOff`, `warning`, `info`,
  `settings`, `thumb`, `checkBold`.
- Files: `src/components/Icon.jsx`
- **Risk**: do not drop `starSolid`; do not end up with two `user`/`moon` keys
  (object-literal duplicate keys silently clobber — keep exactly one of each).
- Verify: `npm run build` succeeds; after full resolution, grep confirms no
  `Icon name="X"` in `src/**` refers to a missing key.

### 2. `src/components/Header.jsx` (1 hunk)
- **Decision: take the Feature-side import** (`import Avatar from './Avatar'`) and
  **drop** `import HeronMascot from './HeronMascot'`. The non-conflicted body below
  already uses `<Avatar .../>`, `useAuth`, `/images/logo.jpg`, `profilePath`, and
  does NOT use `HeronMascot`.
- Files: `src/components/Header.jsx`
- **Risk**: the body references `Avatar` and `useAuth` — both must remain imported.
  Removing the HeronMascot import is required (unused import is tolerable but the
  Feature structure is the intended one).
- Verify: `npm run build`; Header renders with the profile chip/avatar.

### 3. `src/components/VendorCard.jsx` (1 hunk)
- **Decision: take the Feature-side cover block** (the `<div className="vcard__cover">`
  that uses `backgroundColor: coverTint` + optional `backgroundImage: url(cover)`),
  **drop** the HEAD block (`HeronMascot` + `/logo.png` placeholder).
- Also remove the now-unused `import HeronMascot from './HeronMascot'` at the top of
  the file (it is outside the marker; delete it as part of this resolution).
- The rest of the body is non-conflicted and keeps `starSolid` (handled in item 1),
  `categoryName`, and the `vcard__*` classes.
- Files: `src/components/VendorCard.jsx`
- **Risk**: `coverTint` must still be read from `vendor` (it is destructured and
  still present in data). Keep `cover` in the destructure.
- Verify: `npm run build`; cards show cover image/tint + open/pre-order badges.

### 4. `src/pages/Login.jsx` (2 hunks)
- **Decision: take the Feature side of both hunks.** Imports: keep
  `import { useAuth } from '../context/AuthContext'` and
  `import AuthLayout, { PasswordField, AuthDivider, AuthTerms, FacebookButton } from '../components/AuthLayout'`;
  drop `HeronMascot`, `BlobField`, and `import './auth.css'` (AuthLayout imports
  auth.css itself). Structure: keep the `<AuthLayout variant="login" ...>` tree with
  the email `field`, drop the HEAD `.auth`/`.auth__card`/`BlobField` markup.
- The non-conflicted body already calls `useAuth().login(...)` and renders
  `<PasswordField/>`, `<AuthDivider/>`, `<FacebookButton/>`, `<AuthTerms/>`.
- Files: `src/pages/Login.jsx`
- **Risk**: `login` must come from `useAuth`; `AuthLayout` + named exports must all
  resolve (they exist in the merged `AuthLayout.jsx`).
- Verify: `npm run build`; `/login` renders inside the AuthLayout card.

### 5. `src/pages/Signup.jsx` (2 hunks)
- **Decision: take the Feature side of both hunks.** Keep the `AuthLayout` import
  with `PasswordField, PhoneField, AuthDivider, AuthTerms, FacebookButton,
  isStrongPassword, isValidPHMobile`; drop `HeronMascot`, `BlobField`, `./auth.css`.
  Hunk 2: keep `const signupWithFacebook = () => goNext()` and the
  `<AuthLayout variant="signup" ...>` return; drop the HEAD `.auth__card` markup.
- The non-conflicted body uses `isValidPHMobile`, `isStrongPassword`, `PhoneField`,
  `PasswordField showRules`, role-switch with `Icon name="user"/"store"`.
- Files: `src/pages/Signup.jsx`
- **Risk**: all seven named imports from `AuthLayout` must be kept; `Icon`,
  `useSearchParams` imports (non-conflicted) stay.
- Verify: `npm run build`; `/signup` renders, phone/password validation wired.

### 6. `src/pages/VendorStore.jsx` (2 hunks)
- **Decision: take the Feature side of both hunks.** Hunk 1 imports: keep
  `import { categoryName } from '../data/vendors'` and
  `import { useVendors } from '../context/VendorContext'`; drop `HeronMascot` and
  `import { getVendor, categoryName } from '../data/vendors'` (the local `getVendor`
  now comes from `useVendors()`). Hunk 2: keep the Feature `.store-hero` /
  `.store-hero__cover` / `.store-hero__avatar` markup using `vendor.cover`,
  `vendor.logo`, `vendor.phone`; drop the HEAD `.store-head` markup that referenced
  `coverTint`, `category`, `starSolid`, and `HeronMascot`.
- The non-conflicted body already destructures WITHOUT `coverTint`/`category`, calls
  `const { getVendor } = useVendors()`, and uses `ReviewsModal`, `getReviewsFor`,
  `Icon name="star"`, `peso`.
- Files: `src/pages/VendorStore.jsx`
- **Risk**: this is the highest-risk file. If the HEAD side is kept, it references
  `coverTint`/`category`/`getVendor`(from data) that the merged body no longer
  destructures, and `starSolid` markup that duplicates intent — breaking render.
  Confirm after edit that `category` and `coverTint` are not referenced anywhere in
  the resolved file, and that `getVendor` resolves to the context value.
- Verify: `npm run build`; `/vendor/:id` renders hero + menu + reviews modal.

### 7. `src/pages/Home.jsx` (2 hunks)
- **Decision: take the Feature side of both hunks.** Hunk 1 imports: keep
  `import { categories, locationAreas } from '../data/vendors'` +
  `import { useVendors } from '../context/VendorContext'`; drop `BlobField` and the
  `import { vendors, ... }` named import (vendors now comes from `useVendors()`).
  Hunk 2 (hero): keep the inline decorative `hero__blob`/`hero__bowl` spans+images;
  drop the HEAD `<BlobField className="hero__blobs" />`.
- The non-conflicted body calls `const { vendors } = useVendors()` and references
  `/images/bowl.png`, `/images/stall.png`, `cat-tile`, `searchbar`.
- Files: `src/pages/Home.jsx`
- **Risk**: `vendors` must resolve to the `useVendors()` value (do not keep the
  static `vendors` import, or you get a redeclaration/stale-data conflict).
- Verify: `npm run build`; `/` renders hero, category row, directory grid.

### 8. `src/pages/Dashboard.jsx` (2 hunks)
- **Decision: take the Feature side of both hunks.** Hunk 1 imports: keep
  `import { categories } from '../data/vendors'`, `import { useVendors } ...`,
  `import { useAuth } ...`; drop `HeronMascot` and `import { vendors } from
  '../data/vendors'`. Hunk 2 (inside `OrdersTab`): keep the Feature `<PageHead .../>`
  + `.dashboard-pills`/`Pill` markup; drop the HEAD `.dash-head`/`demoVendor` block
  (that block referenced an undefined `demoVendor` and `HeronMascot`).
- Files: `src/pages/Dashboard.jsx`
- **Risk**: the HEAD hunk referenced `demoVendor` which does not exist in the
  Feature-structured component — keeping it would be a ReferenceError. The rest of
  the large file (helpers, DashboardTab, MenuTab using `useVendors`/`categories`)
  is non-conflicted and must stay intact.
- Verify: `npm run build`; `/dashboard` renders orders/menu/profile tabs.

### 9. `src/styles/tokens.css` (1 hunk — merge BOTH, do not drop a side)
- **Decision: produce one combined Radii block.** Use the **Feature values** for the
  shared scale and KEEP the cartoon-only tokens that surviving CSS references:
  ```css
  /* ---- Radii ---- */
  --radius-xs: 8px;        /* kept: harmless; smallest soft corner */
  --radius-sm: 8px;        /* Feature value */
  --radius-md: 14px;       /* Feature value */
  --radius-lg: 22px;       /* Feature value */
  --radius-xl: 36px;       /* KEEP: referenced by Home.css .empty */
  --radius-pill: 999px;
  --field-radius: 14px;    /* KEEP: referenced by Dashboard.css + Profile.css */
  ```
  You MAY also keep `--radius-blob` (organic-blob value) — it is currently unreferenced
  after resolution but is harmless; dropping it is equally fine. `--radius-xl` and
  `--field-radius` are NOT optional.
- Files: `src/styles/tokens.css`
- **Risk**: dropping `--radius-xl` breaks `Home.css .empty`'s rounding; dropping
  `--field-radius` breaks merged `Dashboard.css`/`Profile.css` inputs. The rest of
  the file (colors, spacing, shadows, dark mode) is non-conflicted — leave untouched.
- Verify: `npm run build`; grep `--radius-xl` and `--field-radius` both still defined
  in tokens.css.

### 10. `src/styles/global.css` (2 hunks)
- Hunk 1 (`:focus-visible`): **take the Feature side** (no `border-radius` on
  `:focus-visible`). This also avoids a dependency on `--radius-xs`. Minor cartoon
  loss (rounded focus ring), acceptable per guiding principle.
- Hunk 2 (`.input/.textarea/.select`): **take the Feature side** — `border: 1px solid
  var(--border-strong)`, `border-radius: var(--radius-md)`, `padding: 0.75rem 0.8rem`.
  This matches the Feature form components (AuthLayout fields) that are now canonical.
- Files: `src/styles/global.css`
- **Risk**: `--radius-md` must exist (it does — item 9). Rest of file non-conflicted.
- Verify: `npm run build`; inputs across Login/Signup/Dashboard share one style.

### 11. `src/pages/auth.css` (2 hunks)
- **Decision: take the Feature side of both hunks.** The Feature auth pages render
  `.auth--login/.auth--signup > .auth__body > .auth__content` (from `AuthLayout.jsx`),
  NOT the HEAD `.auth__card`/`.auth__blobs` structure. Hunk 1: keep the Feature local
  color vars + `.auth--login/.auth--signup .auth__body/.auth__content/.auth__form`
  sizing; drop the HEAD `.auth` gradient-background + `.auth__blobs` + `.auth__card`.
  Hunk 2: keep the Feature `.auth__body` card rule; drop the HEAD `.auth__logo`
  gradient-logo block (AuthLayout renders `.auth__logo > img` only).
- Files: `src/pages/auth.css`
- **Risk**: the surviving selectors must match `AuthLayout.jsx`'s class names
  (`auth`, `auth--{variant}`, `auth__body`, `auth__content`, `auth__logo`,
  `auth__title`, `auth__message`, `auth__form`). Verify none of the HEAD-only
  classes (`auth__card`, `auth__blobs`, `auth__sub`) remain referenced.
- Verify: `npm run build`; `/login` and `/signup` are styled (centered card).

### 12. `src/pages/Home.css` (3 hunks)
- **Decision: take the Feature side of all three hunks.**
  - Hunk 1 (`.hero__blobs`/`.hero__inner`): keep Feature `.hero__inner` flex layout;
    drop HEAD `.hero__blobs` rule (its markup is gone; inline `.hero__blob` spans are
    styled elsewhere in the Feature CSS).
  - Hunk 2 (`.hero__hl::after`): take Feature (empty) — drop the HEAD highlight rule.
  - Hunk 3 (`.cat-tile` block): keep the Feature `.cat-tile__art`-based system; drop
    the HEAD `.cat-tile__emoji`/`.cat-tile__label` variants. The Feature definitions
    of `.cat-tile__emoji`, `.cat-tile__label`, `.cat-tile__plate`, `.cat-tile__art`
    appear again below the markers and match the surviving Home.jsx markup.
- Files: `src/pages/Home.css`
- **Risk**: `.empty { border-radius: var(--radius-xl) }` (non-conflicted) depends on
  item 9 keeping `--radius-xl`. Ensure no duplicate/HEAD `.cat-tile__label` lingers.
- Verify: `npm run build`; category tiles + hero render correctly.

### 13. `src/pages/Dashboard.css` (2 hunks)
- **Decision: take the Feature side of both hunks.** The merged `Dashboard.jsx` uses
  `.dashboard-*` class names (`.dashboard-head__sub`, `.dashboard-head__actions`,
  `.dashboard-btn`, `.dashboard-pill`, etc.), NOT the HEAD `.dash-order__*` /
  `.dash-menu__*` classes. Keep the Feature rules; drop the HEAD `.dash-order__btn`/
  `.dash-order__done`/`.dash-menu__edit` rules (their markup was removed in item 8).
- Files: `src/pages/Dashboard.css`
- **Risk**: `--field-radius` (used later in this file, non-conflicted) depends on
  item 9. Confirm no surviving `.dash-*` (single-dash) selectors are orphaned-critical;
  they style removed markup and can go.
- Verify: `npm run build`; `/dashboard` styled (pills, cards, KPIs).

### 14. `src/components/Header.css` (1 hunk)
- **Decision: take the Feature side** — `.brand__logo` `width/height: 40px`,
  `border-radius: 100px`, comment referencing `/public/images` + `logo.jpg`. This
  matches merged `Header.jsx` which loads `/images/logo.jpg`. Drop the HEAD 44px /
  `var(--radius-lg)` / `logo.png` variant.
- Files: `src/components/Header.css`
- **Risk**: none beyond matching the logo path used by Header.jsx (`/images/logo.jpg`).
- Verify: `npm run build`; header logo slot sized/rounded consistently.

### 15. `src/components/VendorCard.css` (1 hunk)
- **Decision: take the Feature side** — `.vcard__cover-logo` (or logo slot)
  `width/height: 48px`, `border-radius: 12px`. This pairs with the Feature VendorCard
  cover markup kept in item 3. Drop the HEAD 64px / `var(--radius-md)` variant.
- Files: `src/components/VendorCard.css`
- **Risk**: none; purely visual sizing. Ensure the class name matches what the
  resolved VendorCard.jsx renders.
- Verify: `npm run build`; vendor cards render without layout breakage.

---

## Verification (run after ALL 15 files are resolved)

Run from `c:\Users\paulc\Projects\FoodHerons` (PowerShell):

1. **No conflict markers remain in whitespace/merge sense:**
   `git diff --check`
   Expected: no output (no lines flagged as conflict markers / whitespace errors).

2. **No literal conflict markers left anywhere in src:**
   `Select-String -Path src\* -Recurse -Pattern '^(<<<<<<<|=======|>>>>>>>)'`
   Expected: no matches. (`=======` can appear legitimately in CSS comment rules,
   so eyeball any `=======` hits; the `<<<<<<<` / `>>>>>>>` hits must be zero.)

3. **Dependencies present** (node_modules already exists; run only if build complains
   about missing modules): `npm install`

4. **Production build passes:** `npm run build`
   Expected: Vite build completes with exit code 0, no "failed to resolve import"
   and no unresolved CSS `var(--…)` errors. This is the real verification — it fails
   if an import, exported name, or token referenced by surviving code is missing.

## Completion steps (only after build passes)

Stage exactly the 15 resolved files, then commit the merge without editing the
message. No push, no branch switch, do not touch the stash.

```powershell
git add src/components/Header.css src/components/Header.jsx src/components/Icon.jsx `
        src/components/VendorCard.css src/components/VendorCard.jsx `
        src/pages/Dashboard.css src/pages/Dashboard.jsx src/pages/Home.css `
        src/pages/Home.jsx src/pages/Login.jsx src/pages/Signup.jsx `
        src/pages/VendorStore.jsx src/pages/auth.css `
        src/styles/global.css src/styles/tokens.css
git commit --no-edit
```

Expected: `git status` afterward shows a clean merge commit (no unmerged paths),
`stash@{0}` still present and untouched.

## Open assumptions (reasonable, noted per instructions)

- Taking the Feature side wholesale for the CSS hunks is correct because the HEAD
  hunks style markup that is removed when the Feature-side JSX wins; keeping them
  would leave dead rules at worst, or (for Dashboard/VendorStore) reference removed
  structure. If a future visual review wants the cartoon rounder look back, that is a
  follow-up styling pass, not part of completing this merge.
- `BlobField.jsx` and the `--radius-blob` token become unused but are left in place;
  removing them is out of scope for conflict resolution and does not affect the build.
