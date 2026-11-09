# Implementation Plan — Food Herons Vector Cartoon Redesign

Derived from the approved design (`design.md` Revision 3) and its supporting review (`design-review.md`). All paths are absolute and point inside the worktree at `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign`. The worktree already exists on branch `cartoon-redesign` (base `main`) — do NOT create it.

Build command (run from the worktree root): `npm run build`. There is no test framework (verified: `package.json` scripts are only `dev`/`build`/`preview`), so verification is `npm run build` passing plus the targeted visual/code checks noted per item. Do NOT run `npm run dev` — it blocks; the user runs it to review.

Hard constraints carried into every item: palette FROZEN (two oranges, yellows, white/cream warm neutrals, warm-near-black ink, NO BLUE); dark mode via `[data-theme="dark"]` must keep working; fonts Nunito + Poppins kept; WCAG AA text contrast + visible focus states preserved; `prefers-reduced-motion` gates all ADDED motion but never the functional `.toggle__thumb` transform; no new dependencies (inline SVG + CSS only); do not break routing, cart context, theme context, or component props/APIs.

Order rationale: the token layer (item 1) is the cohesion lever every later item depends on, so it ships first. Items 2–3 extend the shared primitives (`global.css`) and the `Icon` component that call sites consume. Items 4–6 add the new presentational SVG components before the call sites that import them. Items 7–13 are the per-file edits (CSS re-points, hard-coded radius replacements, logo-slot fallback markup, star call sites, tap targets, decorations). Each item leaves the codebase buildable.

---

- [ ] 1. Rewrite the radius scale and add the shadow tokens in `tokens.css`.
      In `:root`, replace the four-value radius block (`--radius-sm: 8px; --radius-md: 14px; --radius-lg: 22px; --radius-pill: 999px`) with the bubblier six-value scale: `--radius-xs: 8px` (NEW), `--radius-sm: 14px` (was 8), `--radius-md: 20px` (was 14), `--radius-lg: 28px` (was 22), `--radius-xl: 36px` (NEW), `--radius-pill: 999px` (unchanged), and `--radius-blob: 42% 58% 54% 46% / 48% 44% 56% 52%` (NEW, decorative wrappers only). Still in `:root`, add three shadow tokens after the existing `--shadow-lg` line: `--shadow-pop: 0 4px 0 rgba(217, 74, 24, 0.22)`, `--shadow-pop-accent: 0 4px 0 rgba(212, 160, 0, 0.28)`, `--shadow-soft: 0 8px 22px rgba(217, 74, 24, 0.10)`. In the `[data-theme="dark"]` block, after the existing `--shadow-lg` override, add dark overrides: `--shadow-pop: 0 4px 0 rgba(0, 0, 0, 0.45)`, `--shadow-pop-accent: 0 4px 0 rgba(0, 0, 0, 0.45)`, `--shadow-soft: 0 8px 22px rgba(0, 0, 0, 0.5)`. Change NO color-role, font, or spacing tokens. All new shadow values are orange/yellow/warm-black rgba only — NO BLUE.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\styles\tokens.css`
      Verify: `npm run build` from the worktree root succeeds; confirm `tokens.css` now defines six radius tokens plus `--radius-blob`, and both `:root` and `[data-theme="dark"]` define `--shadow-pop`/`--shadow-pop-accent`/`--shadow-soft`.

- [ ] 2. Update shared primitives in `global.css`: input radius pin, button pop shadows (REQUIRED FIX 2 — merge in place), chip tap target, focus-ring fallback, card hover, and the scoped reduced-motion block (REQUIRED FIX 3).
      Make these edits in `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\styles\global.css`:
      (a) Inputs keep their 14px corner: in `.input, .textarea, .select`, change `border-radius: var(--radius-md)` to `border-radius: var(--radius-sm)` (now 14px — deliberate "keep current look").
      (b) REQUIRED FIX 2 — MERGE the resting pop shadow into the EXISTING `.btn--primary` block in place: in the existing rule `.btn--primary { background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm); }`, replace `box-shadow: var(--shadow-sm)` with `box-shadow: var(--shadow-pop)`. Do NOT add a second competing resting `.btn--primary` rule.
      (c) Add a resting pop shadow for the accent button and the press rules for both solid variants, placed AFTER the base `.btn:active` rule so they win on equal specificity: `.btn--accent { box-shadow: var(--shadow-pop-accent); }` and `.btn--primary:active, .btn--accent:active { transform: translateY(3px); box-shadow: 0 1px 0 rgba(217, 74, 24, 0.22); }`. Leave `.btn--ghost` with no pop shadow.
      (d) Bump chip tap target: in `.chip`, change `min-height: 36px` to `min-height: 40px`.
      (e) Focus ring fallback: in `:focus-visible`, change `border-radius: 4px` to `border-radius: var(--radius-xs)` (8px). Keep the `3px solid var(--orange)` outline and `outline-offset: 2px` unchanged.
      (f) Card hover lift: add `.card:hover { box-shadow: var(--shadow-soft); }` (the `.card` rule already has a `box-shadow`/`transform` transition).
      (g) REQUIRED FIX 3 — Add a SCOPED reduced-motion block AFTER the existing universal `@media (prefers-reduced-motion: reduce)` duration-zeroing block (keep that block as-is). The new block neutralizes only ADDED decorative/press transforms and must NOT list `.btn:hover` (no `.btn:hover` transform exists in the live CSS) and must NOT touch the functional `.toggle__thumb` transform:
      ```css
      @media (prefers-reduced-motion: reduce) {
        /* Suppress only ADDED decorative hover lifts and button press feedback.
           Functional state transforms (e.g. .toggle__thumb translateX) are NOT listed. */
        .btn--primary:active,
        .btn--accent:active,
        .vcard:hover,
        .cat-tile:hover,
        .card:hover,
        .stepper__btn:active {
          transform: none !important;
        }
        .fh-float, .fh-pop { animation: none !important; }
        /* Hover box-shadow is a static state, not motion — intentionally kept under reduced motion. */
      }
      ```
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\styles\global.css`
      Verify: `npm run build` succeeds; confirm `.btn--primary` has exactly ONE resting rule and it uses `var(--shadow-pop)`; confirm the new reduced-motion block does NOT contain `.btn:hover` and does NOT contain `.toggle__thumb`.

- [ ] 3. Convert `Icon.jsx` to the rounded-stroke cartoon style and add `starSolid`.
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Icon.jsx`:
      (a) Add `strokeLinecap="round"` and `strokeLinejoin="round"` to the root `<svg>` (it keeps `fill="currentColor"`; do NOT add a blanket `fill="none"` to the root).
      (b) Redraw the six currently-filled icons (`search, pin, clock, star, moon, user`) as outline paths, each carrying its OWN `fill="none" stroke="currentColor" strokeWidth="2"` (they inherit the root rounded caps/joins). Each redrawn path MUST set `fill="none"` or it will fill solid against the root `fill="currentColor"`.
      (c) Keep the already-stroked icons unchanged (`cart, sun, menu, close, check, plus, minus, back, store, dashboard`); keep the heavier `strokeWidth="2.5"` on `check, plus, minus, back`. Leave `dashboard` to inherit the root defaults (its closed-rect segments make linecap moot).
      (d) Add a NEW filled `starSolid` key (fill inherits `currentColor`, softened/rounded point geometry), e.g. `starSolid: <path d="M12 3.5c.4 0 .76.23.93.59l2.02 4.2 4.6.62c.86.12 1.2 1.18.56 1.78l-3.36 3.16.84 4.57c.15.85-.75 1.5-1.5 1.08L12 17.3l-4.1 2.2c-.76.42-1.66-.23-1.5-1.08l.83-4.57-3.36-3.16c-.63-.6-.3-1.66.57-1.78l4.6-.62 2.02-4.2c.17-.36.53-.59.92-.59Z" />`. The outline `star` stays available. Do NOT change the component's props/API (`name`, `size`, `title`, `className`, `style`) or the `aria-hidden`/`role` contract.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Icon.jsx`
      Verify: `npm run build` succeeds; confirm the root `<svg>` carries `strokeLinecap="round" strokeLinejoin="round"`, each of the six redrawn icons carries its own `fill="none"`, and a `starSolid` key exists in `paths`.

- [ ] 4. Create the `HeronMascot` presentational component.
      Create `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\HeronMascot.jsx` — a static inline-SVG friendly heron built from frozen palette values only (orange body, yellow beak, warm-ink eye; use `var(--orange)`/`var(--yellow)`/`var(--ink)` via fill or `currentColor`). It must be `aria-hidden="true"`, render at `width: 100%; height: 100%` so it fills whatever slot wraps it, accept an optional `className` prop, and take no other props. No new dependencies.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\HeronMascot.jsx`
      Verify: `npm run build` succeeds; the file exports a default React component rendering an `aria-hidden` `<svg>` with no non-palette colors.

- [ ] 5. Create the `BlobField` decorative component.
      Create `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\BlobField.jsx` — one or two soft organic blobs as inline SVG, filled with `var(--orange-soft)` / `var(--yellow-pale)` at low opacity. It must be `aria-hidden="true"`, `pointer-events: none`, sit behind content, accept an optional `className` prop (for positioning), and take no other props. Palette-only fills (NO BLUE). An optional `.fh-float` idle-drift animation class may be referenced (it is gated under reduced motion by item 2).
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\BlobField.jsx`
      Verify: `npm run build` succeeds; the component renders an `aria-hidden`, `pointer-events: none` SVG using only `--orange-soft`/`--yellow-pale`.

- [ ] 6. Create the `WaveDivider` decorative component.
      Create `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\WaveDivider.jsx` — a single wide, rounded SVG wave path filled with `var(--footer-bg)`, rendered as a block element (`display: block`, `width: 100%`, fixed small height ~48px) so it has no inline gap. It must be `aria-hidden="true"`, `pointer-events: none`, accept an optional `className` prop, and take no other props.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\WaveDivider.jsx`
      Verify: `npm run build` succeeds; the component renders an `aria-hidden` block SVG filled with `var(--footer-bg)`.

- [ ] 7. Update Header: logo-slot radius, mascot fallback (REQUIRED FIX 1 — site 1 of 7).
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Header.css`, change `.brand__logo` `border-radius: 12px` to `border-radius: var(--radius-lg)`. In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Header.jsx`, add `<HeronMascot />` as a fallback sibling inside the existing `.brand__logo` `<span>` so the slot is never empty when `/logo.png` fails to load (which it always does today — no `logo.png` exists). Keep the `.brand__logo` className, the gradient background, and the `<img onError>` markup. `.icon-btn` stays `border-radius: 50%` (no change).
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Header.css`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Header.jsx`
      Verify: `npm run build` succeeds; `Header.jsx` imports and renders `HeronMascot` inside `.brand__logo`; `.brand__logo` uses `var(--radius-lg)`.

- [ ] 8. Update Footer: logo-slot radius, mascot fallback (REQUIRED FIX 1 — site 2 of 7), and wave divider.
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Footer.css`, change `.footer__logo` `border-radius: 12px` to `border-radius: var(--radius-lg)`. In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Footer.jsx`, add `<HeronMascot />` as a fallback sibling inside the existing `.footer__logo` `<span>`, and render `<WaveDivider />` at the top edge of `.footer` (as the first child of `<footer className="footer">`, directly above `.footer__grid`). Keep existing classNames and the `<img onError>` markup.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Footer.css`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\Footer.jsx`
      Verify: `npm run build` succeeds; `Footer.jsx` renders `HeronMascot` inside `.footer__logo` and `WaveDivider` at the top of `.footer`; `.footer__logo` uses `var(--radius-lg)`.

- [ ] 9. Update VendorCard: logo-slot radius + mascot fallback (REQUIRED FIX 1 — site 3 of 7), hover bounce, and solid star.
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\VendorCard.css`, change `.vcard__cover-logo` `border-radius: 16px` to `border-radius: var(--radius-md)`; update the existing `.vcard:hover` rule to add scale and the soft shadow — change `transform: translateY(-4px)` to `transform: translateY(-4px) scale(1.01)` and change `box-shadow: var(--shadow-md)` to `box-shadow: var(--shadow-soft)`. In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\VendorCard.jsx`, add `<HeronMascot />` as a fallback sibling inside the `.vcard__cover-logo` `<span>`, and change the rating `<Icon name="star" size={15} className="vcard__star" />` to `name="starSolid"` (size/className unchanged).
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\VendorCard.css`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\components\VendorCard.jsx`
      Verify: `npm run build` succeeds; `VendorCard.jsx` renders `HeronMascot` inside `.vcard__cover-logo` and the rating Icon uses `name="starSolid"`; `.vcard__cover-logo` uses `var(--radius-md)` and `.vcard:hover` uses `scale(1.01)` + `var(--shadow-soft)`.

- [ ] 10. Update VendorStore: stepper pop-shadow rules, logo mascot (REQUIRED FIX 1 — site 4 of 7), and solid star.
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\VendorStore.css`, add explicit `.stepper__btn` rules (it is NOT a `.btn`, so it gets no pop shadow otherwise): `.stepper__btn { box-shadow: var(--shadow-pop); }`, `.stepper__btn:active { transform: translateY(3px); box-shadow: 0 2px 0 rgba(217, 74, 24, 0.18); }`, and `.stepper__btn:disabled, .stepper__btn[aria-disabled="true"] { opacity: 0.5; box-shadow: none; transform: none; }`. Keep `.stepper__btn` `border-radius: 50%` and 36×36. `.store-head__logo` already uses `--radius-lg` (re-points automatically, no CSS edit). In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\VendorStore.jsx`, add `<HeronMascot />` as a fallback sibling inside the `.store-head__logo` `<span>`, and change the header rating `<Icon name="star" size={16} className="fact-star" />` to `name="starSolid"`.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\VendorStore.css`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\VendorStore.jsx`
      Verify: `npm run build` succeeds; `VendorStore.css` has the three `.stepper__btn` rules; `VendorStore.jsx` renders `HeronMascot` inside `.store-head__logo` and the header rating Icon uses `name="starSolid"`.

- [ ] 11. Update Dashboard: tap targets, logo mascot (REQUIRED FIX 1 — site 5 of 7).
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Dashboard.css`, change `min-height: 40px` to `min-height: 44px` in both `.dash-order__btn` and `.dash-menu__edit`. `.dash-head__logo` already uses `--radius-md` (re-points automatically, no CSS edit). In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Dashboard.jsx`, add `<HeronMascot />` as a fallback sibling inside the `.dash-head__logo` `<span>`. The functional `.toggle__thumb` checked transform (in Home.css, used by this page's pre-order toggle) is preserved by item 2's scoping — do not alter it.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Dashboard.css`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Dashboard.jsx`
      Verify: `npm run build` succeeds; both dashboard buttons use `min-height: 44px`; `Dashboard.jsx` renders `HeronMascot` inside `.dash-head__logo`.

- [ ] 12. Update auth: logo-slot radius + mascot fallback on BOTH Login and Signup (REQUIRED FIX 1 — sites 6 AND 7 of 7), plus blob decoration.
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\auth.css`, change `.auth__logo` `border-radius: 14px` to `border-radius: var(--radius-lg)`. `.role-switch` (uses `--radius-md`) and `.role-switch__btn` (uses `--radius-sm`, moving 8→14px) re-point automatically — this +6px delta on `.role-switch__btn` is intended and on the record; make NO per-selector radius edit for them. Because `.auth__logo` is rendered INDEPENDENTLY from two files, edit BOTH: in `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Login.jsx` add `<HeronMascot />` as a fallback sibling inside the `.auth__logo` `<span>`, and in `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Signup.jsx` do the SAME inside its own `.auth__logo` `<span>`. Neither auth page may be left with an empty hidden `<img>` slot. Also render `<BlobField />` behind `.auth__card` in both pages (positioned inside `.auth`, behind the card). Keep existing classNames and `<img onError>` markup.
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\auth.css`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Login.jsx`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Signup.jsx`
      Verify: `npm run build` succeeds; BOTH `Login.jsx` AND `Signup.jsx` import and render `HeronMascot` inside their `.auth__logo` span and render `BlobField`; `.auth__logo` uses `var(--radius-lg)`.

- [ ] 13. Update Home decorations: empty-state radius, hero highlight, cat-tile hover scale, hero blob.
      In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Home.css`: change `.empty` `border-radius: var(--radius-lg)` to `border-radius: var(--radius-xl)`; change `.hero__hl::after` `border-radius: 4px` to `border-radius: 6px`; update the existing `.cat-tile:hover` `transform: translateY(-3px)` to `transform: translateY(-3px) scale(1.02)`. Do NOT touch the `.toggle input:checked + .toggle__track .toggle__thumb { transform: translateX(20px) }` rule — it is a functional state transform and must keep working under reduced motion. In `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Home.jsx`, render `<BlobField />` inside `.hero`, behind `.hero__inner`. `.cat-tile` and `.filters` round automatically via the `--radius-md` re-point (no CSS edit).
      Files: `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Home.css`, `c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign\src\pages\Home.jsx`
      Verify: `npm run build` succeeds; `.empty` uses `var(--radius-xl)`, `.hero__hl::after` uses `6px`, `.cat-tile:hover` uses `scale(1.02)`; the `.toggle__thumb` `translateX(20px)` rule is unchanged; `Home.jsx` renders `BlobField` inside `.hero`.

---

## Notes and assumptions

- No `logo.png` exists in the repo (verified via `public/LOGO_README.txt` reference in the design review), so the heron mascot is the DEFAULT state across all seven slots today, not a rare fallback. The mascot must render whenever the `<img>` is hidden; keeping the `<img onError>` markup means a real `logo.png` dropped into `/public` later still overrides the mascot.
- `.auth__logo` at 56×56 with `--radius-lg` (28px) reads as strongly rounded by design; the mascot/image is centered under `overflow: hidden`, so rounding clips the container, not artwork. This is intended.
- `Cart.css`, `OrderStatus.css`, and `NotFound.jsx` need NO edits: their alert/note boxes round via the `--radius-md` re-point, and `.order-confirm__check`/`.tracker__dot` stay `50%`. Empty-state and category emoji are explicitly out of scope (design §6).
- Full WCAG AA contrast validation requires manual measurement with assistive tools; no color tokens change here, so existing text/background pairs are unchanged, but AA cannot be asserted as proven without that manual review.
- No test framework exists; `npm run build` passing plus the per-item code checks is the verification bar. If a build error surfaces, fix it before considering the item done.
