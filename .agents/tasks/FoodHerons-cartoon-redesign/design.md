# Design — Food Herons Vector Cartoon Redesign (Revision 3)

## Overview

This design turns the Food Herons React + Vite app into a friendly **vector-cartoon** experience with **rounder shapes** throughout, while keeping the current information architecture, routing, state (CartContext / ThemeContext), and every component API intact. The strategy is **token-first**: the bulk of the visual shift ships by editing `src/styles/tokens.css` and the shared primitives in `src/styles/global.css` so the whole app rounds-out and softens together, with only small, surgical per-file touches where a hard-coded radius or a decorative SVG needs to land. No new dependencies: the cartoon look is built entirely from the existing inline-SVG `Icon` component, a few new tiny inline-SVG components, and CSS.

The frozen constraints are respected literally: **no color tokens change** (the orange/yellow/white palette and the NO-BLUE rule stay exactly as-is in both light and dark), fonts stay **Nunito + Poppins**, dark mode continues through `[data-theme="dark"]`, and all added motion is gated behind `prefers-reduced-motion`. The only new token families are **radii, shadows, and decorative fills** — all of which draw from the existing orange/yellow/warm-neutral values.

**Technology stack (locked):** React 18 + Vite 5, React Router 6, plain CSS with custom properties (no CSS-in-JS, no Tailwind), inline SVG for all iconography and decoration. No icon library, no animation library (framer-motion explicitly excluded). This stack is already in `package.json` and does not change.

---

## 1. Rounder shapes — radius scale and surface map

### 1a. New radius tokens (in `tokens.css` `:root`)

Replace the current four-value scale with a bubblier six-value scale. The two existing mid values grow; two new tokens are added at the ends. `--radius-pill` is unchanged.

```css
/* ---- Radii (bubblier cartoon scale) ---- */
--radius-xs: 8px;     /* NEW — smallest soft corner (was the old --radius-sm) */
--radius-sm: 14px;    /* was 8px  → chips-inner, role-switch buttons, small controls */
--radius-md: 20px;    /* was 14px → inputs, menu rows, filters, tiles, small cards */
--radius-lg: 28px;    /* was 22px → cards, modals, hero panels, large logo slots */
--radius-xl: 36px;    /* NEW — biggest soft corner for feature panels / empty states */
--radius-pill: 999px; /* unchanged — fully-rounded buttons, chips, badges, toggles */
--radius-blob: 42% 58% 54% 46% / 48% 44% 56% 52%; /* NEW — organic blob for decorative SVG wrappers only */
```

Rationale for keeping `--radius-pill` and adding `--radius-blob`: pills already read friendly and are heavily used for buttons/chips/badges; the blob value is reserved strictly for decorative, `aria-hidden` wrappers (never content containers) so it cannot distort text or imagery.

Because `--radius-sm`, `--radius-md`, and `--radius-lg` are **re-pointed to larger values**, every element already referencing those tokens rounds-out automatically — this is the cohesion lever. The side effects of the re-point are enumerated below so none are silent.

### 1b. Surface → radius map

| Surface | Selector(s) | Current | New | How |
|---|---|---|---|---|
| Primary buttons | `.btn` | `--radius-pill` | `--radius-pill` | unchanged (already pill) |
| Chips / tags | `.chip` | `--radius-pill` | `--radius-pill` | unchanged |
| Badges | `.badge` | `--radius-pill` | `--radius-pill` | unchanged |
| Cards | `.card` (`.vcard`, `.order-box`, `.auth__card`) | `--radius-lg` 22 | `--radius-lg` 28 | token re-point |
| Inputs / textarea / select | `.input .textarea .select` | `--radius-md` 14 | **keep 14** → set explicitly to `--radius-sm` | see note below |
| Menu rows | `.menu-item` | `--radius-md` 14 | `--radius-md` 20 | token re-point |
| Category tiles | `.cat-tile` | `--radius-md` 14 | `--radius-md` 20 | token re-point |
| Filters bar | `.filters` | `--radius-md` 14 | `--radius-md` 20 | token re-point |
| Role switch container | `.role-switch` | `--radius-md` 14 | `--radius-md` 20 | token re-point |
| Role switch inner button | `.role-switch__btn` | `--radius-sm` 8 | `--radius-sm` 14 | token re-point (**intended +6px delta, see note**) |
| Alert / note boxes | `.auth__note`, `.cart` note, `.dash-*` cards | `--radius-md` 14 | `--radius-md` 20 | token re-point |
| Hero empty state | `.empty` | `--radius-lg` 22 | `--radius-xl` 36 | explicit bump for extra friendliness |
| Logo chips (brand/footer) | `.brand__logo`, `.footer__logo` | hard-coded 12px | `--radius-lg` 28 | replace hard value |
| Logo chip (auth) | `.auth__logo` | hard-coded 14px | `--radius-lg` 28 | replace hard value |
| Logo slot (vendor card cover) | `.vcard__cover-logo` | hard-coded 16px | `--radius-md` 20 | replace hard value |
| Logo slot (store head) | `.store-head__logo` | `--radius-lg` 22 | `--radius-lg` 28 | token re-point (no edit) |
| Logo slot (dashboard head) | `.dash-head__logo` | `--radius-md` 14 | `--radius-md` 20 | token re-point (no edit) |
| Circular controls | `.icon-btn`, `.stepper__btn`, `.tracker__dot`, `.order-confirm__check`, `.toggle__thumb` | `50%` | `50%` | **stay circular** (already maximally round) |
| Focus ring | `:focus-visible` | `4px` fallback | `8px` fallback (`--radius-xs`) | see §3 |
| Hero highlight underline | `.hero__hl::after` | `4px` | `6px` | small bump for a softer marker |

**Inputs note (explicit, on the record):** inputs currently use `--radius-md` which is being re-pointed 14 → 20. 20px on a 48px-tall input reads slightly too round/pill-like next to the sharper text baseline. We therefore **pin inputs to `--radius-sm` (now 14px)** so they keep their current 14px corner. This is a deliberate "keep current look" move for text fields, not an oversight. Change in `global.css`: `.input, .textarea, .select { border-radius: var(--radius-sm); }`.

**Role-switch note (Finding 3, on the record):** `.role-switch__btn` references `var(--radius-sm)`, which moves 8px → 14px with this redesign. The inner segmented buttons therefore change by **+6px** (intended — rounder segments read friendlier and match the softened container). Unlike inputs we do **not** pin these back; the delta is accepted. Recorded here so it is not a surprise during implementation or review.

**Logo-slot caveat:** image-bearing slots (`.vcard__cover-logo`, `.store-head__logo`, `.dash-head__logo`) use `object-fit: contain` under `overflow: hidden`, so their radius clips the rounded container, not the logo artwork — safe to round. The decorative `--radius-blob` is **never** applied to any logo/image slot (it would crop artwork unevenly); blob is for pure-decoration wrappers only (§2d).

---

## 2. Vector cartoon theme

### 2a. Icon component — rounded-stroke vector look

File: `src/components/Icon.jsx`. The component renders `paths[name]` inside one `<svg>`. Today some paths are **filled** (rely on the svg's `fill="currentColor"` and carry no stroke) and some are **stroked** (carry their own `fill="none" stroke="currentColor" strokeWidth strokeLinecap strokeLinejoin`). To get a consistent clean cartoon line without rewriting everything, we:

**(i) Add rounded-stroke defaults to the root `<svg>`** so every stroked path inherits soft ends/joins:

```jsx
<svg ... fill="currentColor" strokeLinecap="round" strokeLinejoin="round" focusable="false">
```

`strokeLinecap`/`strokeLinejoin` only affect paths that actually stroke; filled paths ignore them. This single change gives every stroked icon rounded caps and joins.

**(ii) Convert the six filled icons to the stroked, rounded style** so the whole set reads as one cohesive outline family. The filled icons are exactly: `search, pin, clock, star, moon, user` (verified in `Icon.jsx`). Each gets redrawn as an outline path with `fill="none" stroke="currentColor" strokeWidth="2"` (inheriting the svg's rounded caps/joins). The already-stroked icons (`cart, sun, menu, close, check, plus, minus, back, store, dashboard`) keep their paths.

**Critical ordering constraint:** the root `<svg>` keeps `fill="currentColor"`. A redrawn outline path **must** set its own `fill="none"`, or it will fill solid. Any filled icon not yet redrawn must either keep its original filled path or be given `fill="currentColor"` explicitly. Do not add a blanket `fill="none"` to the svg root — that would make the not-yet-redrawn filled icons vanish. Redraw-and-set-`fill="none"` per icon is the safe sequence.

**(iii) Stroke-width consistency.** Standardize the base outline set at `strokeWidth="2"`. Keep the existing heavier `strokeWidth="2.5"` on `check, plus, minus, back` (they read as "action" glyphs and benefit from a chunkier line). After conversion, the apparent stroke of `star` at small sizes must be eyeballed: `strokeWidth="2"` on a `viewBox 0 0 24 24` rendered at `size=15` is ~1.25px (2/24×15) and at `size=16` is ~1.33px — thin but acceptable; if it looks weak next to text, bump the two rating call sites to a dedicated solid star (see (v)).

**(iv) Optional cleanup.** Per-path attributes that now exactly match the svg defaults (`strokeLinecap="round"`, `strokeLinejoin="round"`) may be stripped to reduce noise, but this is cosmetic and not required for correctness. **`dashboard` (Finding 5):** its path carries only `strokeLinejoin="round"` and no `strokeLinecap`; its segments are closed rects so linecap is moot anyway. It is **safe to let `dashboard` inherit the svg defaults** (rounded caps + joins) — no per-path override is needed, and the svg default already satisfies the rounded-linecap/linejoin requirement for it. This is a clarity note only.

**(v) Rating star stays legible.** The `star` icon is used at `size=15` (`VendorCard.jsx:49`, `className="vcard__star"`) and `size=16` (`VendorStore.jsx:75`, `className="fact-star"`). A thin outline star reads poorly at those sizes and ratings want a confident filled star. Add a **`starSolid`** icon (filled, with a soft/rounded point geometry) and point both rating call sites at it:

```jsx
starSolid: <path d="M12 3.5c.4 0 .76.23.93.59l2.02 4.2 4.6.62c.86.12 1.2 1.18.56 1.78l-3.36 3.16.84 4.57c.15.85-.75 1.5-1.5 1.08L12 17.3l-4.1 2.2c-.76.42-1.66-.23-1.5-1.08l.83-4.57-3.36-3.16c-.63-.6-.3-1.66.57-1.78l4.6-.62 2.02-4.2c.17-.36.53-.59.92-.59Z" />,
```

(fill inherits `currentColor`; the softened vertices give it the cartoon feel). The two call sites change `name="star"` → `name="starSolid"`; sizes/classNames are unchanged, so no CSS or layout changes. The outline `star` remains available for any future non-rating use.

### 2b. Soft friendly touches

**Chunky buttons with a "pop" shadow.** Add a cartoon-flat drop shadow token and apply it to the main CTAs so they look like pressable candy buttons:

```css
/* tokens.css :root */
--shadow-pop: 0 4px 0 rgba(217, 74, 24, 0.22);        /* orange-family hard shadow */
--shadow-pop-accent: 0 4px 0 rgba(212, 160, 0, 0.28); /* yellow-family hard shadow */
--shadow-soft: 0 8px 22px rgba(217, 74, 24, 0.10);    /* gentle ambient lift for cards on hover */
```

Dark-mode overrides (in `[data-theme="dark"]`, orange/yellow-family only — no blue):

```css
--shadow-pop: 0 4px 0 rgba(0, 0, 0, 0.45);
--shadow-pop-accent: 0 4px 0 rgba(0, 0, 0, 0.45);
--shadow-soft: 0 8px 22px rgba(0, 0, 0, 0.5);
```

**Where each shadow lands (concrete selectors):**

| Shadow token | Applied to (resting) | On press |
|---|---|---|
| `--shadow-pop` | `.btn--primary` | shrinks to flat (see press rule) |
| `--shadow-pop-accent` | `.btn--accent` | shrinks to flat |
| `--shadow-pop` | `.stepper__btn` (circular +/− in VendorStore) | shrinks to flat |
| `--shadow-soft` | `.card:hover`, `.vcard:hover` (replaces `--shadow-md` on hover) | n/a |

`global.css` button rules (place these variant rules **after** the base `.btn:active` so they win on equal specificity — both are specificity (0,2,0) and source order breaks the tie):

```css
.btn--primary { box-shadow: var(--shadow-pop); }
.btn--accent  { box-shadow: var(--shadow-pop-accent); }
.btn--primary:active,
.btn--accent:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 rgba(217, 74, 24, 0.22);
}
```

This replaces the base `.btn:active { transform: translateY(1px) scale(0.99) }` for the two solid variants with a satisfying "press into the shadow" of 3px (the ghost button keeps the base behavior). `.btn--ghost` gets no pop shadow (it is a secondary/outline control).

**Stepper button rule (Finding 1 — concrete).** `.stepper__btn` is `<button className="stepper__btn">`, is **not** a `.btn`, and lives in `VendorStore.css`. It gets its own explicit rules there (it would otherwise receive no pop shadow or press feedback):

```css
/* VendorStore.css */
.stepper__btn { box-shadow: var(--shadow-pop); }
.stepper__btn:active {
  transform: translateY(3px);
  box-shadow: 0 2px 0 rgba(217, 74, 24, 0.18);
}
.stepper__btn:disabled,
.stepper__btn[aria-disabled="true"] {
  opacity: 0.5;
  box-shadow: none;
  transform: none;
}
```

The circle (`border-radius: 50%`) and 36×36 size are unchanged. The dark-mode press value is covered because the resting `--shadow-pop` is overridden under `[data-theme="dark"]`; the `:active` literal `0 2px 0 rgba(217,74,24,0.18)` is a short-lived press flash and is intentionally the same warm tone in both themes (acceptable — it is a transient state, not a resting surface). If a darker press flash is preferred, add `[data-theme="dark"] .stepper__btn:active { box-shadow: 0 2px 0 rgba(0,0,0,0.4); }` — optional.

**Soft fills.** No new fill colors (palette frozen). The "soft fill" cartoon feel comes from the existing tinted surfaces (`--orange-soft`, `--yellow-pale`, `--surface-2`) already used on chips, hero eyebrow, badges, steppers, and empty states — these now sit inside rounder containers, which is where the softness reads.

**Hover bounce/scale.** Add a gentle lift to interactive cards and tiles (these already translate; we add a hair of scale + the soft shadow):

```css
.vcard:hover  { transform: translateY(-4px) scale(1.01); box-shadow: var(--shadow-soft); }
.cat-tile:hover { transform: translateY(-3px) scale(1.02); }
.card:hover   { box-shadow: var(--shadow-soft); }
```

**Reduced motion (Finding 2 — scoped, concrete).** The existing `@media (prefers-reduced-motion: reduce)` block in `global.css` zeroes `animation`/`transition` durations with a universal `*` selector. We must **not** add a broad `transform: none !important`, because that would clobber **functional** (state, not motion) transforms — specifically `.toggle input:checked + .toggle__track .toggle__thumb { transform: translateX(20px) }` (verified in `Home.css`; drives both the theme and pre-order switches), snapping the thumb back to the "off" position while logically "on". The reduced-motion override is therefore **enumerated to decorative hover-lifts and keyframes only**:

```css
@media (prefers-reduced-motion: reduce) {
  /* keep existing universal duration-zeroing block as-is, then add: */
  .btn:hover,
  .btn--primary:active,
  .btn--accent:active,
  .vcard:hover,
  .cat-tile:hover,
  .card:hover,
  .stepper__btn:active {
    transform: none !important;
  }
  .fh-float, .fh-pop { animation: none !important; }
}
```

Explicit rule for implementers: **functional transforms must NOT be suppressed** — `.toggle__thumb` checked-state `translateX(20px)` and any future state-driven transform stay out of this block. Only decorative hover lifts, the button press (`:active`) feedback, and the named decorative keyframes (`.fh-float`, `.fh-pop`, §2d) are neutralized.

### 2c. LogoSlot + HeronMascot

Every logo slot today renders `<img src="/logo.png" onError={hide}>` inside a gradient chip; on error the `<img>` is hidden and the gradient shows through. There are **six** such slots: `.brand__logo` (Header), `.footer__logo` (Footer), `.auth__logo` (auth pages), `.vcard__cover-logo` (VendorCard), `.store-head__logo` (VendorStore), `.dash-head__logo` (Dashboard).

**Current-state note (Finding 4, on the record):** there is **no `logo.png` anywhere in the repo** (not in `/public`, not in `src`). That means the `onError` fires on **every** load today and the fallback is the **current default state across all six slots** — the mascot is not a rare edge case, it is what users see now. The design embraces this: ship a cute cartoon **heron mascot** as the default, with a real `logo.png` able to override it later.

Add a tiny presentational component `src/components/HeronMascot.jsx` — an inline SVG of a simple, friendly heron head/body built from the frozen palette (orange body, yellow beak, warm-ink eye), `aria-hidden`, `width/height: 100%` so it fills whatever slot wraps it. Optionally add a thin `LogoSlot.jsx` wrapper that renders `<img src="/logo.png" onError>` with `<HeronMascot>` as the fallback sibling, to replace the six repeated `<img onError>` snippets. **This refactor is optional and additive**: if `LogoSlot` is adopted, the six call sites swap their inner markup but keep their existing wrapper classNames (`.brand__logo` etc.), so all CSS and the gradient background are unchanged; if not adopted, drop a `<HeronMascot>` next to each existing `<img>` and show it when the image is hidden. Either way the slot is never empty and no className/layout changes.

### 2d. Blob / wave decorative SVGs

Add two tiny presentational inline-SVG components, both `aria-hidden`, both using only frozen palette values, both pointer-events:none and sitting behind content:

- **`src/components/BlobField.jsx`** — one or two soft organic blobs (filled `--orange-soft` / `--yellow-pale`, low opacity). **Placement:** absolutely-positioned decoration inside `.hero` (behind `.hero__inner`) and inside `.auth` (behind `.auth__card`). These pages already use radial-gradient washes; the blobs add gentle cartoon shapes on top of that wash. Also usable behind the `.empty` state illustration.
- **`src/components/WaveDivider.jsx`** — a single wide, rounded SVG wave path (filled `--footer-bg`) placed at the **top edge of `.footer`** so the footer rises out of the page on a soft wave instead of a straight border. Rendered as a block SVG directly above the footer grid, `width:100%`, fixed small height (~48px), `display:block` to avoid inline gaps.

Both components take an optional `className` for positioning and have no props beyond that. They introduce **no dependencies** and no runtime cost beyond a static SVG. The optional idle animation `.fh-float` (a 6s ease-in-out `translateY` of ±6px) may be applied to a blob for a lazy drift; it is one of the decorative keyframes disabled under reduced-motion (§2b).

---

## 3. More user-friendly

- **Tap targets.** `.btn` already enforces `min-height: 44px` — keep. Bump the two dashboard buttons from 40 → 44px: `.dash-order__btn, .dash-menu__edit { min-height: 44px; }` (verified currently 40). Bump `.chip` from `min-height: 36px` → `40px` for easier tapping. `.icon-btn` stays 44×44. Stepper buttons stay 36×36 (paired, inside a 44px-tall pill container — the combined control exceeds 44px of touch area).
- **Visual hierarchy.** Unchanged type scale (frozen fonts), but rounder, shadowed CTAs now stand out more clearly as the primary action on each view. Section heads (`.section-head`) and card titles keep Poppins display weight.
- **Friendly rounded typography treatment.** No font change (Nunito + Poppins stay). "Rounder" type is achieved via existing weights and generous line-height (body `1.6`, headings `1.15`) — both already friendly. Optional: add `letter-spacing: 0.01em` to `.btn` display text for a slightly softer, more rounded button label. No new `@font-face`, no variable-font axes.
- **Comfortable spacing.** The 4/8 spacing scale is unchanged; the larger radii naturally increase perceived padding inside cards, so no spacing-token edits are required.
- **Obvious affordances.** The pop shadows (§2b) make buttons look pressable; the hover lift + soft shadow on cards/tiles signals "clickable"; `:focus-within` on the search bar already highlights the active field.
- **Smooth gentle transitions.** The global `--transition: 180ms ease` is reused for all added hovers/presses; nothing faster/jarring is introduced.
- **Focus states.** `:focus-visible` keeps its `3px solid var(--orange)` ring. We change only its `border-radius` fallback from `4px` → `8px` (`--radius-xs`) so the ring on now-rounder elements follows the element shape better. The ring color is a frozen orange and meets a visible non-color-only focus indicator. Rationale on the record: most focusable elements set their own radius, so the ring hugs the element; `8px` is only the fallback for elements without an explicit radius.

---

## 4. File-by-file change list (cohesion via tokens first)

**`src/styles/tokens.css`** — add/replace radius tokens (§1a: `--radius-xs`, re-point `sm/md/lg`, add `--radius-xl`, `--radius-blob`); add shadow tokens (`--shadow-pop`, `--shadow-pop-accent`, `--shadow-soft`) in `:root`; add the three dark overrides in `[data-theme="dark"]`; add decorative fill helpers only if a blob needs a token (reuse `--orange-soft`/`--yellow-pale` otherwise). No color-role or font or spacing token changes.

**`src/styles/global.css`** — pin inputs to `--radius-sm` (keep 14px); add `.btn--primary`/`.btn--accent` resting pop shadows + `:active` press rules (placed after `.btn:active`); add `.card:hover`/`.vcard:hover` soft shadow + bounce; bump `.chip { min-height: 40px }`; change `:focus-visible` fallback radius 4 → 8; add the **scoped** reduced-motion `transform:none` block (§2b, enumerated selectors only, functional transforms excluded).

**`src/components/Icon.jsx`** — add `strokeLinecap="round" strokeLinejoin="round"` to the root `<svg>`; redraw the six filled icons (`search, pin, clock, star, moon, user`) as `fill="none"` outlines (per-icon, never a blanket svg `fill:none`); add `starSolid`; keep `2.5` strokes on `check/plus/minus/back`; `dashboard` left to inherit svg defaults (Finding 5).

**`src/components/VendorCard.jsx` / `.jsx:49`** — rating star `name="star"` → `name="starSolid"`. **`VendorCard.css`** — `.vcard__cover-logo` radius 16 → `--radius-md`; `.vcard:hover` adds `scale(1.01)` + `--shadow-soft`; add `<HeronMascot>` fallback in the cover-logo slot (or adopt `LogoSlot`).

**`src/pages/VendorStore.jsx` / `.jsx:75`** — rating star `name="star"` → `name="starSolid"`. **`VendorStore.css`** — add explicit `.stepper__btn` pop shadow + `:active` + disabled rules (Finding 1); stepper circles stay `50%`; `.store-head__logo` rounds via `--radius-lg` re-point (no edit); add `<HeronMascot>` to the store-head logo slot.

**`src/components/Header.jsx` / `Header.css`** — `.brand__logo` radius 12 → `--radius-lg`; add `<HeronMascot>` fallback in the brand slot. `.icon-btn` stays 50%.

**`src/components/Footer.jsx` / `Footer.css`** — `.footer__logo` radius 12 → `--radius-lg`; add `<HeronMascot>` fallback; add `<WaveDivider>` at the top edge of `.footer`.

**`src/pages/auth.css` + `*.jsx`** — `.auth__logo` radius 14 → `--radius-lg`; `.role-switch` rounds via `--radius-md` re-point; **`.role-switch__btn` corners go 8px → 14px via the `--radius-sm` bump (intended, on the record — Finding 3)**; `.auth` gets a `<BlobField>` decoration behind `.auth__card`; add `<HeronMascot>` to `.auth__logo`.

**`src/pages/Home.css` + `Home.jsx`** — `.cat-tile` / `.filters` round via `--radius-md` re-point; `.cat-tile:hover` adds `scale(1.02)`; `.empty` radius bumps to `--radius-xl`; `.hero__hl::after` radius 4 → 6; `.hero` gets a `<BlobField>` behind `.hero__inner`. The `.toggle__thumb` `translateX(20px)` checked transform is explicitly preserved under reduced motion.

**`src/pages/Dashboard.jsx` / `Dashboard.css`** — `.dash-order__btn`, `.dash-menu__edit` min-height 40 → 44; `.dash-head__logo` rounds via `--radius-md` re-point (no edit); add `<HeronMascot>` to the dash-head logo slot. The dashboard pre-order `.toggle__thumb` transform is preserved under reduced motion.

**`src/pages/Cart.css`, `OrderStatus.css`, `NotFound.jsx`** — alert/note boxes round via `--radius-md` re-point (no edits needed); `.order-confirm__check` and `.tracker__dot` stay `50%`. Empty-state emoji (🛒 Cart, 🔕 Dashboard, 🔍 Home no-match, 🍳 NotFound, 📦 OrderStatus) and the data-layer category emoji (`categories[].emoji`) + the literal 🍽️ "All" tile are **out of scope** (see §6).

---

## 5. Error handling, validation, invariants

**Logo image load (6 slots).** *Failure condition:* `/logo.png` fails to load (currently always, since the file does not exist). *Recoverable:* yes — fully expected and is the default state. *Behavior:* `<img onError>` hides the broken image (or `LogoSlot` toggles to the mascot); `<HeronMascot>` renders so the slot is never empty. *Logging:* none — this is normal, not an error worth logging; a `console` message would spam on every page load. *Invariant:* "a logo slot is never visually empty" — owned by the slot markup/`LogoSlot` component (the layer closest to the DOM), because only it knows both the img state and the fallback.

**Icon name lookup.** *Failure condition:* `Icon` called with a `name` not in `paths` (e.g. a typo like `starSolld`). *Recoverable:* yes. *Behavior today:* `paths[name]` is `undefined` and the `<svg>` renders empty (no crash) — this is preserved; the redesign adds `starSolid` so the two rating sites resolve. *Logging:* none at runtime; invalid names are caught at build/review time (the key set is static). *Invariant:* "every `name` passed in the codebase exists in `paths`" — owned by the authoring/review step, enforced by grepping call sites against the `paths` keys (there is no runtime registry to validate against). *Validation of inputs:* `name` is required (string, must be a `paths` key); `size` optional (number, defaults 20); `title` optional (string — presence flips the svg from `aria-hidden` presentation to a labeled `img`, unchanged behavior). On an unknown `name` the component degrades to an empty svg rather than throwing — acceptable for a presentational icon.

**Decorative SVG components (`HeronMascot`, `BlobField`, `WaveDivider`).** *Failure modes:* none meaningful — they are static inline SVG with no external fetch, no props that can be malformed beyond an optional `className` (string). They are `aria-hidden` and `pointer-events:none`, so they cannot intercept clicks or affect the a11y tree. No validation or logging needed.

**Theme/`data-theme`.** Unchanged. `ThemeContext` sets `data-theme` on `document.documentElement`; all new shadow/decoration tokens have `[data-theme="dark"]` counterparts (or use frozen palette vars that already have dark values), so there is no un-themed surface. Invariant "no blue in either theme" is owned by `tokens.css` (the only place color-family values live); the new tokens are orange/yellow/warm-neutral only.

**Reduced motion.** *Failure to honor it* would be an accessibility regression. The scoped block (§2b) is the enforcement point; the invariant "decorative motion is suppressed, functional state transforms are not" is owned by `global.css`. Validated by toggling the OS reduced-motion setting and confirming (a) card/button hover lifts and blob drift stop, and (b) the toggle thumb still slides to the checked position.

---

## 6. Out of scope

- Changing any color token, adding gradients beyond existing ones, or altering the NO-BLUE palette.
- Replacing the five empty-state **emoji** (🛒 🔕 🔍 🍳 📦) or the **category emoji** (`categories[].emoji` from the data layer, plus the literal 🍽️ "All" tile). These are content/data, not theme; swapping them to custom SVG is a larger, separate effort and risks touching the data model. Declared out of scope; the emoji remain.
- Font changes (no new families, no variable-font axes — Nunito + Poppins stay).
- Any routing, `CartContext`, `ThemeContext`, or component-API/prop changes. All new components (`HeronMascot`, `BlobField`, `WaveDivider`, optional `LogoSlot`) are additive and presentational.
- Adding libraries (icon sets, animation libs, framer-motion) — explicitly excluded.
- Spacing-scale and type-scale token changes.

---

## 7. Testability

No test framework exists (verified: `package.json` scripts are `dev`/`build`/`preview` only; no vitest/jest). Primary verification is **build + manual visual QA**; add Vitest as a dev-dependency only if automated snapshotting is wanted later (it would not add a runtime dependency).

**Build check:** `npm run build` must pass (pure CSS/SVG/JSX edits; no new imports beyond local components).

**Unit-testable (if Vitest is added):**
1. `Icon` renders an `<svg>` for every key in `paths`, including the new `starSolid`.
2. `Icon` with a `title` sets `role="img"` + `<title>`; without a title sets `aria-hidden="true"` + `role="presentation"` (unchanged contract).
3. `Icon` root `<svg>` carries `strokeLinecap="round"` and `strokeLinejoin="round"`.
4. Each redrawn outline icon path carries its own `fill="none"` (guards against the "filled icon vanishes" regression).
5. `HeronMascot`/`BlobField`/`WaveDivider` render an `aria-hidden` SVG and accept a `className`.

**Manual / integration QA:**
6. Visual sweep in light **and** dark that cards, inputs, tiles, logo chips, and empty states all show the bubblier radii and nothing clips oddly (logos stay `contain`-fit inside rounded slots).
7. Press a primary button, an accent button, and a stepper +/− button: each shows the pop shadow at rest and the 3px press-into-shadow on `:active`.
8. **Mascot default:** confirm the heron mascot renders in all six logo slots **right now** (no `logo.png` present). Then drop a valid `logo.png` into `/public` and confirm the `<img>` wins in all six slots and the mascot steps aside. (Do not frame this as "break the logo to test" — the mascot is the current default; the test is confirming the mascot shows now and that *adding* a logo overrides it.)
9. **Reduced motion:** enable the OS setting and confirm hover lifts, blob drift, and button-press transforms stop, **while** both toggle switches (theme + pre-order) still visibly slide their thumb to the checked position (functional transform preserved — Finding 2).
10. Rating stars (`VendorCard`, `VendorStore` header) render as a solid, legible yellow star at 15/16px.
11. Keyboard focus: tab through buttons, links, inputs, chips, toggles — the orange focus ring is visible and hugs each (now-rounder) element.
12. Contrast: no text/background color changed, so AA pairs are unchanged; full AA validation still requires manual contrast measurement at implementation (noted, not assumed).

---

## 8. Responses to design review findings (verdict: CHANGES_REQUESTED)

**Finding 1 (MEDIUM — `.stepper__btn` pop shadow asserted but not specified): ADDRESSED.** §2b now gives `.stepper__btn` an explicit `box-shadow: var(--shadow-pop)`, an `:active` press rule (`translateY(3px)` + `0 2px 0 rgba(217,74,24,0.18)`), and a disabled rule, all located in `VendorStore.css` (where `.stepper__btn` lives, since it is not a `.btn`). Dark-mode resting value is inherited from the `[data-theme="dark"] --shadow-pop` override; the transient `:active` flash is explained, with an optional dark override noted. The §4 `VendorStore.css` entry now lists these rules instead of only "circles stay 50%".

**Finding 2 (MEDIUM — reduced-motion `transform:none` scope unspecified, can break functional transforms): ADDRESSED.** §2b replaces the vague "hover-lift rules" with an **enumerated selector list** (`.btn:hover`, `.btn--primary:active`, `.btn--accent:active`, `.vcard:hover`, `.cat-tile:hover`, `.card:hover`, `.stepper__btn:active`, plus named decorative keyframes `.fh-float`/`.fh-pop`). It states explicitly that functional transforms — the `.toggle__thumb` checked-state `translateX(20px)` — must **not** be suppressed, and §5/§7 add the enforcement owner and a QA step confirming the toggle thumb still slides under reduced motion.

**Finding 3 (NIT — `.role-switch__btn` silently changes 8→14px): ADDRESSED.** §1b and §4 now explicitly record that `.role-switch__btn` corners move **8px → 14px** via the `--radius-sm` re-point (intended; reads friendlier), parallel to how the input case is called out. The delta is on the record.

**Finding 4 (NIT — `/logo.png` does not exist, so the mascot is the default, not an edge case): ADDRESSED.** §2c, §5, and §7 step 8 now state that **no `logo.png` exists in the repo**, so the heron mascot is the **current default across all six slots**, not a rare fallback. The test is reframed to confirm the mascot renders now and that *adding* a valid `logo.png` makes the `<img>` win — no "break the logo" framing.

**Finding 5 (NIT — `dashboard` icon lacks `strokeLinecap`; confirm it inherits the default): ADDRESSED.** §2a (iv) now states `dashboard` is **safe to let inherit the svg defaults** (rounded caps + joins) with no per-path override needed, and notes its closed-rect segments make linecap moot anyway. Clarity note added.
