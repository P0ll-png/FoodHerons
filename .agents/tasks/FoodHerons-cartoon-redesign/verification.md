# Verification — Food Herons Vector Cartoon Redesign

First iteration (no `review.json` present). Full redesign implemented from `plan.md` (Revision 3 design).

## Build

- **Command run** (from the worktree `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign`):
  `npm run build` (invoked as `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build` because the sandbox PowerShell execution policy blocks `npm.ps1`; this runs the same `vite build` script).
  - Note: the worktree had no `node_modules`, so `npm install` was run first (vite 5.4.21 + deps installed), then the build.
- **Result: PASS — zero errors.** Vite output:
  - `vite v5.4.21 building for production...`
  - `62 modules transformed.`
  - `dist/index.html` 0.74 kB
  - `dist/assets/index-CYPS7eAf.css` 31.26 kB (gzip 6.26 kB)
  - `dist/assets/index-DmAYfrUB.js` 209.03 kB (gzip 65.13 kB)
  - `built in 10.77s`

No test framework exists (package.json scripts are `dev`/`build`/`preview` only), so build + per-file code checks are the verification bar. `npm run dev` was NOT run.

## Changed files and visual change made

### New files
- `src/components/HeronMascot.jsx` — friendly cartoon heron (orange body/head, yellow beak, warm-ink eye) built from frozen palette vars only; `aria-hidden`, fills its slot at 100%×100%, optional `className`, no other props. Serves as the default logo-slot fill (no `logo.png` exists today).
- `src/components/BlobField.jsx` — one orange-soft + one yellow-pale organic blob at low opacity; `aria-hidden`, `pointer-events:none`, optional `className`. One blob carries the `.fh-float` class (gated under reduced motion). Palette-only, no blue.
- `src/components/WaveDivider.jsx` — single wide rounded wave path filled with `var(--footer-bg)`, rendered as a `display:block` SVG at 48px tall (no inline gap); `aria-hidden`, `pointer-events:none`, optional `className`.

### `src/styles/tokens.css`
- Radius scale re-pointed to the bubblier six-value scale: `--radius-xs:8px` (new), `--radius-sm:8→14px`, `--radius-md:14→20px`, `--radius-lg:22→28px`, `--radius-xl:36px` (new), `--radius-pill:999px` (unchanged), `--radius-blob` organic value (new, decorative wrappers only).
- Added shadow tokens in `:root`: `--shadow-pop` (orange rgba), `--shadow-pop-accent` (yellow rgba), `--shadow-soft` (gentle orange ambient). Added matching `[data-theme="dark"]` overrides (black rgba).
- **No color-role, font, or spacing token changes.** All new shadow values are orange/yellow/warm-black rgba only — no blue.

### `src/styles/global.css`
- Inputs pinned to `--radius-sm` (keeps 14px look): `.input, .textarea, .select`.
- **REQUIRED FIX 2:** `.btn--primary` resting `box-shadow` changed in place from `var(--shadow-sm)` → `var(--shadow-pop)` (exactly one resting `.btn--primary` rule; no second competing rule).
- `.btn--accent` gets resting `var(--shadow-pop-accent)`; added `.btn--primary:active, .btn--accent:active { transform: translateY(3px); box-shadow: 0 1px 0 rgba(217,74,24,0.22); }` placed after `.btn:active`. `.btn--ghost` unchanged.
- `.chip` min-height 36 → 40px.
- `:focus-visible` fallback radius 4px → `var(--radius-xs)` (8px); 3px orange outline + 2px offset unchanged.
- `.card:hover { box-shadow: var(--shadow-soft); }` added.
- **REQUIRED FIX 3:** added a scoped `@media (prefers-reduced-motion: reduce)` block AFTER the universal duration-zeroing block. It neutralizes only ADDED transforms: `.btn--primary:active, .btn--accent:active, .vcard:hover, .cat-tile:hover, .card:hover, .stepper__btn:active` → `transform:none`, plus `.fh-float, .fh-pop { animation:none }`. It does NOT list `.btn:hover` (no such transform exists) and does NOT list `.toggle__thumb`. One-line comment notes hover box-shadow is a static state intentionally kept.

### `src/components/Icon.jsx`
- Root `<svg>` now carries `strokeLinecap="round" strokeLinejoin="round"` (kept `fill="currentColor"`; no blanket `fill="none"`).
- The six formerly-filled icons (`search, pin, clock, star, moon, user`) redrawn as outline paths, each with its own `fill="none" stroke="currentColor" strokeWidth="2"` (inherit rounded caps/joins).
- Already-stroked icons unchanged; `check/plus/minus/back` keep `strokeWidth="2.5"`; `dashboard` inherits root defaults.
- Added filled `starSolid` key (softened/rounded point geometry, fill inherits currentColor). Props/API and `aria-hidden`/`role` contract unchanged.

### `src/components/Header.jsx` / `Header.css` (logo site 1 of 7)
- `.brand__logo` radius `12px` → `var(--radius-lg)`. `.icon-btn` stays `50%`.
- `<HeronMascot />` added as fallback sibling inside the `.brand__logo` span (img layered on top via the existing grid cell; `<img onError>` kept).

### `src/components/Footer.jsx` / `Footer.css` (logo site 2 of 7)
- `.footer__logo` radius `12px` → `var(--radius-lg)`.
- `<HeronMascot />` added inside `.footer__logo`; `<WaveDivider />` rendered as the first child of `<footer>` with `.footer__wave` (negative top margin so the footer rises on a wave crest).

### `src/components/VendorCard.jsx` / `VendorCard.css` (logo site 3 of 7, star site 1 of 2)
- `.vcard__cover-logo` radius `16px` → `var(--radius-md)`.
- `.vcard:hover` → `transform: translateY(-4px) scale(1.01)` and `box-shadow: var(--shadow-soft)`.
- `<HeronMascot />` added inside `.vcard__cover-logo`; rating Icon `name="star"` → `name="starSolid"` (size 15 / className unchanged).

### `src/pages/VendorStore.jsx` / `VendorStore.css` (logo site 4 of 7, star site 2 of 2)
- Added `.stepper__btn` rules: resting `box-shadow: var(--shadow-pop)`; `:active { transform: translateY(3px); box-shadow: 0 2px 0 rgba(217,74,24,0.18); }`; disabled/`aria-disabled` → opacity 0.5, no shadow, no transform. Circle `50%` and 36×36 kept; transition extended to include transform/box-shadow.
- `.store-head__logo` rounds via the `--radius-lg` re-point (no CSS edit).
- `<HeronMascot />` added inside `.store-head__logo`; header rating Icon `name="star"` → `name="starSolid"` (size 16 / className unchanged).

### `src/pages/Dashboard.jsx` / `Dashboard.css` (logo site 5 of 7)
- `.dash-order__btn` and `.dash-menu__edit` min-height 40 → 44px.
- `.dash-head__logo` rounds via the `--radius-md` re-point (no CSS edit).
- `<HeronMascot />` added inside `.dash-head__logo`.

### `src/pages/auth.css` + `src/pages/Login.jsx` + `src/pages/Signup.jsx` (logo sites 6 AND 7 of 7)
- `.auth__logo` radius `14px` → `var(--radius-lg)`. `.auth` made `position:relative; overflow:hidden`; added `.auth__blobs` absolute-positioned behind the card and `.auth__card` given `position:relative; z-index:1`. `.role-switch` / `.role-switch__btn` re-point automatically (role-switch__btn 8→14px, intended, on the record — no per-selector edit).
- Login.jsx: `<HeronMascot />` added inside its `.auth__logo` span; `<BlobField className="auth__blobs" />` rendered behind `.auth__card`.
- Signup.jsx: `<HeronMascot />` added inside its OWN `.auth__logo` span; `<BlobField className="auth__blobs" />` rendered behind `.auth__card`.
- Neither auth page is left with an empty hidden `<img>` slot.

### `src/pages/Home.jsx` / `Home.css`
- `.empty` radius `var(--radius-lg)` → `var(--radius-xl)`; `.hero__hl::after` radius `4px` → `6px`; `.cat-tile:hover` → `transform: translateY(-3px) scale(1.02)`.
- Added `.hero__blobs` (absolute, behind content) and gave `.hero__inner` `position:relative; z-index:1`; `<BlobField className="hero__blobs" />` rendered inside `.hero` behind `.hero__inner`.
- The `.toggle input:checked + .toggle__track .toggle__thumb { transform: translateX(20px) }` rule is UNCHANGED.

## Explicit confirmations
- **Radii tokens re-pointed as specified** (sm 8→14, md 14→20, lg 22→28; added xs:8, xl:36, blob; pill unchanged). ✔
- **Icon.jsx uses rounded strokeLinecap/strokeLinejoin on the root `<svg>`**, each of the six redrawn icons carries its own `fill="none"`, and `starSolid` exists. ✔
- **`starSolid` used at BOTH rating call sites** — VendorCard.jsx and VendorStore.jsx. ✔
- **No palette or dark-mode regressions in tokens.css** — only radius + shadow families added; all color roles and both-theme palette untouched; no blue. Dark mode `[data-theme="dark"]` retains all shadow overrides. ✔
- **prefers-reduced-motion preserves the toggle-thumb transform** — the scoped block does not list `.toggle__thumb` (verified still present in Home.css) and does not list `.btn:hover`. ✔
- **All SEVEN logo call sites have the mascot fallback** — Header, Footer, VendorCard, VendorStore, Dashboard, Login, Signup. ✔

## Caveats on the record
- Full WCAG AA contrast cannot be asserted as proven without manual measurement with assistive tools; no color tokens changed, so existing text/background pairs are unchanged.
- `.role-switch__btn` corners move 8→14px via the `--radius-sm` re-point — intended and accepted per design Finding 3.
