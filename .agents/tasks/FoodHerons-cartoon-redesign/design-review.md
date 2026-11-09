# Design Review — Food Herons Vector Cartoon Redesign (Revision 3)

Reviewed fresh against the live source in `c:\Users\paulc\Projects\FoodHerons\src`. Every "the code currently does X" claim in the design was checked against the actual files. The hard constraints from the task brief were each tested for violation or omission.

Verdict: **CHANGES_REQUESTED** (1 HIGH, 2 MEDIUM, plus NITs).

---

## Findings

### 1. HIGH — Logo-slot count is wrong: there are seven JSX call sites, not six; Login and Signup are both missed in the per-file plan

Where: §2c ("There are **six** such slots"), §5 ("Logo image load (6 slots)"), §7 steps 8 ("all six logo slots", "all six slots"), and the §4 file list.

Problem: The design counts logo slots by CSS selector (`.brand__logo`, `.footer__logo`, `.auth__logo`, `.vcard__cover-logo`, `.store-head__logo`, `.dash-head__logo` = six selectors) but the mascot/`LogoSlot` work is a **JSX markup change**, and the `.auth__logo` selector is rendered from **two separate files** — `src/pages/Login.jsx` (line 21) and `src/pages/Signup.jsx` (line 24). Verified: both files contain their own `<span className="auth__logo"><img src="/logo.png" onError=.../></span>`. That means there are **seven** JSX call sites to touch, not six. The §4 entry for auth is written as `src/pages/auth.css + *.jsx` and adds "`<HeronMascot>` to `.auth__logo`" once, without naming Login.jsx and Signup.jsx as two distinct edits. An implementer following "swap the six call sites" will leave one auth page with a hidden `<img>` and no mascot — a visibly empty slot, which is exactly the invariant §5 says must never happen.

Concrete fix: Change the count to "**six slot classes across seven JSX call sites**" everywhere (§2c, §5, §7 step 8). In §4, replace the single auth line with two explicit edits:
- `src/pages/Login.jsx` — add `<HeronMascot>` fallback inside `.auth__logo`.
- `src/pages/Signup.jsx` — add `<HeronMascot>` fallback inside `.auth__logo`.
If `LogoSlot` is adopted, state that it replaces the `<img onError>` markup in **all seven** call sites (Header, Footer, VendorCard, VendorStore, Dashboard, Login, Signup).

### 2. MEDIUM — Existing `.btn--primary { box-shadow: var(--shadow-sm) }` is not reconciled with the new resting pop shadow

Where: §2b button rules; §4 `global.css` entry.

Problem: The design adds `.btn--primary { box-shadow: var(--shadow-pop); }` as a resting rule and says to place the variant rules "after the base `.btn:active`." But the live `global.css` already has a resting rule `.btn--primary { background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm); }` (verified). The new `.btn--primary { box-shadow: var(--shadow-pop) }` and the existing one are both specificity (0,1,0), so the winner is purely source order. "After `.btn:active`" is ambiguous because the existing `.btn--primary` resting block sits before `.btn:active` in some orderings and the design never states that the new rule must come **after the existing `.btn--primary` resting block**. If the new rule is placed before it, `--shadow-sm` wins and the pop shadow silently does nothing. `.btn--accent` has no existing resting `box-shadow`, so only `--primary` is affected, but that is the primary CTA.

Concrete fix: State explicitly that the new resting shadow must either (a) be merged into the existing `.btn--primary` block (replace `box-shadow: var(--shadow-sm)` with `box-shadow: var(--shadow-pop)` in place), or (b) be added as a rule placed **after the existing `.btn--primary` resting declaration** in `global.css`. Prefer (a) to avoid two competing resting declarations. Example (option a):
```css
.btn--primary {
  background: var(--primary);
  color: var(--on-primary);
  box-shadow: var(--shadow-pop); /* was --shadow-sm */
}
```

### 3. MEDIUM — Reduced-motion block omits the `.cat-tile:hover` dark/active transform path and the hover `box-shadow`, and the enumerated selector list does not match where motion is actually applied

Where: §2b "Reduced motion" enumerated block and the hover-effect rules just above it.

Problem: The design adds hover motion via `.vcard:hover { transform: translateY(-4px) scale(1.01) }`, `.cat-tile:hover { transform: translateY(-3px) scale(1.02) }`, and `.card:hover`. The reduced-motion block then neutralizes `.vcard:hover`, `.cat-tile:hover`, `.card:hover` with `transform: none !important`. That part is consistent. However two gaps:
- The existing universal reduced-motion block only zeroes `animation-duration` and `transition-duration`; it does **not** stop a `transform` that is applied directly in a `:hover` rule (a transform with no transition still jumps instantly on hover). The design's enumerated `transform: none !important` list is the right mechanism, but it must also be verified that `.btn:hover` actually has a transform to suppress — the live `.btn` has **no** `:hover` transform (verified: `.btn:active` has the only transform). Listing `.btn:hover` in the suppression block is harmless but implies a hover transform exists that does not. This is a correctness/clarity mismatch that will confuse the implementer about what motion is really being added.
- `box-shadow` changes on `.card:hover`/`.vcard:hover` are gated by `transition-duration` zeroing (fine), but the design should confirm the hover shadow itself is acceptable under reduced motion (it is — a static shadow is not motion). State this so it is not "fixed" by mistake.

Concrete fix: Remove `.btn:hover` from the enumerated reduced-motion list (no `.btn:hover` transform exists), or add the intended `.btn:hover` lift explicitly in §2b if one is wanted. Keep `.btn--primary:active`/`.btn--accent:active`/`.stepper__btn:active`/`.vcard:hover`/`.cat-tile:hover`/`.card:hover`. Add a one-line note that hover `box-shadow` is a static state (not motion) and is intentionally preserved.

### 4. NIT — `.role-switch__btn` 8px→14px delta is documented as "Finding 3 addressed" but the brief still wants concrete surface→radius clarity

Where: §1b role-switch note; §4 auth entry.

Problem: Verified `.role-switch` uses `--radius-md` and `.role-switch__btn` uses `--radius-sm` in `auth.css`, so the 8→14 and 14→20 moves are accurate. The design records the delta, which satisfies the "no silent side effects" bar. It is on the record and intended; no change required beyond what is written. Logged as a NIT only for completeness since it is a real behavioral change.

Concrete fix: None required; optionally add the one-line CSS it resolves to for the implementer: `.role-switch__btn` keeps `border-radius: var(--radius-sm)` (now 14px) with no edit.

### 5. NIT — Star rating call-site line reference for VendorStore is slightly off

Where: §2a (v) and §4: "`VendorStore.jsx:75`".

Problem: Verified `name="star"` in `VendorStore.jsx` is on the `<li>` that opens at line 75 (the `<Icon name="star" size={16} className="fact-star" />` sits on that line). VendorCard star at `:49` is exact. The reference is close enough to be found but is a line-of-`<li>` rather than line-of-`<Icon>` in some editors; no functional impact.

Concrete fix: None required; the grep target `name="star"` is unambiguous (exactly two matches, verified).

### 6. NIT — `.auth__logo` hard-coded radius is 14px, re-pointed to `--radius-lg` (28px); confirm this does not clip the gradient oddly at the small 56px slot

Where: §1b logo chips row; §4 auth entry.

Problem: Verified `.auth__logo` is 56×56 with `border-radius: 14px`. Moving to `--radius-lg` (28px) makes the corner radius exactly half the box, i.e. the slot becomes a circle-ish superellipse at 28/56. That is a large visual jump (14→28 on a 56px box). It is intended ("replace hard value") and safe (contains an image or mascot under `overflow: hidden`), but the design does not call out that 28px on a 56px box reads as nearly fully rounded, unlike the 110px store slot where 28px is gentler.

Concrete fix: None blocking; optionally note that at 56px the `--radius-lg` corner reads as strongly rounded (by design) and confirm the mascot artwork is centered so the rounding does not crop it.

---

## Verified Assumptions

These design claims were checked against source and are **correct**:

1. Radius tokens in `tokens.css` are exactly `--radius-sm: 8px; --radius-md: 14px; --radius-lg: 22px; --radius-pill: 999px` (four values). Confirmed.
2. Palette tokens (orange/yellow/white/warm-neutral) and the NO-BLUE rule are intact; dark mode is driven by `[data-theme="dark"]` with its own neutral/shadow overrides. Confirmed — the design changes no color-role tokens.
3. Fonts are Nunito (body) + Poppins (display) via `--font-sans`/`--font-display` and a Google Fonts `@import`. Confirmed; design keeps them.
4. `.btn` has `min-height: 44px` and `border-radius: var(--radius-pill)`; `.btn:active { transform: translateY(1px) scale(0.99) }` is the only button transform. Confirmed.
5. `.chip` has `min-height: 36px` and `border-radius: var(--radius-pill)`. Confirmed (design bumps to 40px).
6. `.card` uses `--radius-lg`; `.input/.textarea/.select` use `--radius-md` with `min-height: 48px`. Confirmed.
7. Icon.jsx renders `paths[name]` in one `<svg fill="currentColor">`; filled icons `search, pin, clock, star, moon, user` carry no stroke; stroked icons `cart, sun, menu, close, check, plus, minus, back, store, dashboard` carry their own `fill="none" stroke`. Confirmed exactly.
8. `check, plus, minus, back` use `strokeWidth="2.5"`; others `strokeWidth="2"`. Confirmed.
9. `dashboard` path carries `strokeLinejoin="round"` and no `strokeLinecap`; its segments are closed rects. Confirmed.
10. Star call sites: `VendorCard.jsx` line 49 `size={15} className="vcard__star"`; `VendorStore.jsx` line 75 `size={16} className="fact-star"`. Confirmed.
11. `--radius-md` re-point affects `.menu-item`, `.cat-tile`, `.filters`, `.role-switch`, `.auth__note`, and `.dash-head__logo` — all verified to reference `--radius-md`. Enumerated correctly.
12. `--radius-lg` re-point affects `.card`, `.store-head__logo`, `.empty` (via `--radius-lg`). Confirmed `.store-head__logo` uses `--radius-lg`; `.empty` uses `--radius-lg` (design bumps it explicitly to `--radius-xl`).
13. Hard-coded logo radii: `.brand__logo` 12px (Header.css), `.footer__logo` 12px (Footer.css), `.auth__logo` 14px (auth.css), `.vcard__cover-logo` 16px (VendorCard.css). All confirmed.
14. `.toggle input:checked + .toggle__track .toggle__thumb { transform: translateX(20px) }` exists in `Home.css` (line 243) and is a functional (state) transform that must not be suppressed under reduced motion. Confirmed.
15. Circular controls `.stepper__btn` (`border-radius: 50%`, 36×36), image slots use `object-fit: contain` under `overflow: hidden`. Confirmed for `.vcard__cover-logo`, `.store-head__logo`, `.dash-head__logo`.
16. `.stepper__btn` is `<button className="stepper__btn">`, not a `.btn`, lives in `VendorStore.css`, and has only a `:hover` background rule (no box-shadow, no press feedback) today. Confirmed — design's explicit new rules are warranted.
17. `.dash-order__btn` and `.dash-menu__edit` both have `min-height: 40px` (Dashboard.css). Confirmed; design bumps to 44.
18. `.hero` has `position: relative; overflow: hidden` and radial-gradient washes; `.hero__hl::after` has `border-radius: 4px`. Confirmed — blob placement and the 4→6 bump are feasible.
19. `:focus-visible` is `outline: 3px solid var(--orange); outline-offset: 2px; border-radius: 4px`. Confirmed; design keeps color/width, changes only fallback radius to 8px.
20. No test framework: `package.json` scripts are only `dev`/`build`/`preview`; deps are react/react-dom/react-router-dom; devDeps are vite + plugin-react. Confirmed — no icon/animation libraries, matches the "no heavy new dependencies" constraint.
21. Specificity claim for `.btn:active` vs `.btn--primary:active`: both are one class + one pseudo-class = (0,2,0). Confirmed; source-order tiebreak is valid.
22. All six logo-slot JSX files render `<img src="/logo.png" onError={hide}>` inside the gradient/surface chip. Confirmed in Header, Footer, VendorCard, VendorStore, Dashboard, Login, Signup.

## Unverified / Wrong Assumptions

1. **WRONG (Finding 1):** "There are **six** such slots" and "all six slots" undercount the JSX work. There are six slot *classes* but **seven** JSX call sites because `.auth__logo` is rendered independently from both `Login.jsx` and `Signup.jsx`.
2. **PARTIALLY WRONG (Finding 3):** `.btn:hover` is listed in the reduced-motion suppression set, implying a hover transform that does not exist on `.btn` in the live CSS. No `.btn:hover` transform is defined today.
3. **UNRESOLVED (Finding 2):** The design does not reconcile the pre-existing `.btn--primary { box-shadow: var(--shadow-sm) }` resting rule with the new `.btn--primary { box-shadow: var(--shadow-pop) }`; whether the pop shadow actually applies depends on an ordering detail the design states only loosely.
4. **UNVERIFIABLE (noted, not a finding against the design):** WCAG AA contrast of the orange focus ring and text pairs — the design correctly states (§7 step 12) that no color changed and that full AA validation needs manual measurement. This matches the brief's accessibility expectation and is honestly scoped, not asserted as proven.
5. **CONFIRMED-NOT-WRONG:** The claim that no `logo.png` exists was verified — `public/LOGO_README.txt` documents the absence and `index.html` references `/logo.png` only as a favicon. The mascot-is-default framing is accurate.

---

## Constraint check (task brief hard constraints)

- Keeps orange/yellow/white palette + NO-BLUE, no color changes: **PASS** (new shadow/decoration tokens use orange/yellow/warm-neutral rgba only; dark overrides use black rgba — not blue).
- Dark mode `[data-theme="dark"]` kept + friendly: **PASS** (shadow tokens have dark counterparts; decorations use palette vars that already have dark values).
- Fonts Nunito + Poppins unchanged: **PASS**.
- Accessibility (AA text contrast, visible focus, prefers-reduced-motion for added motion): **PASS with Finding 3** (reduced-motion handling is sound in intent but the enumerated list has a stray selector; focus ring preserved; contrast honestly scoped).
- No heavy new dependencies (inline SVG + CSS only): **PASS**.
- Does not break routing / cart / theme context / component APIs: **PASS** (all new components additive and presentational; no prop/API changes).
- Concrete NEW radius token values + surface map: **PASS** (six-value scale + blob, full surface→radius table, all verified against source).
- Icon component delivers rounded linecap/linejoin: **PASS** (root `<svg>` gets `strokeLinecap/strokeLinejoin="round"`; per-icon `fill="none"` ordering constraint called out correctly).
- Cohesive via tokens not one-off overrides: **PASS** (token re-point is the primary lever; per-file edits limited to hard-coded radii and new decorations).

The three substantive findings (1 HIGH, 2 MEDIUM) are about accuracy of the change plan, not constraint violations.
