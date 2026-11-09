# Vector-cartoon redesign — token-first rounding, pop shadows, and heron mascot fallback

The redesign softens Food Herons into a friendly vector-cartoon look by re-pointing the shared radius scale, adding a "pop" shadow family, converting the icon set to a cohesive rounded-outline style, and shipping an inline-SVG heron mascot as the default logo-slot fill. The work is token-first: most of the visual shift ships from `tokens.css` and `global.css`, with small per-file touches where a hard-coded radius or a decorative SVG needs to land. The implementation matches the approved Revision 3 design, and all three required fixes are present and correct. No color tokens, fonts, or spacing tokens change; dark mode stays functional through `[data-theme="dark"]`; no new dependencies were added.

Watch for: nothing blocking. Build passes per `verification.md` (vite 5.4.21, 62 modules, zero errors). All seven logo call sites carry the mascot fallback (confirmed), FIX 2 is a true in-place merge with no competing resting rule (confirmed), and FIX 3 scopes `transform:none` to added transforms while preserving the functional `.toggle__thumb` translate (confirmed).

**Verdict**: APPROVED

## High-level view

The rounding is driven entirely by re-pointing three existing radius tokens (`sm` 8→14, `md` 14→20, `lg` 22→28) and adding `--radius-xs`/`-xl`/`-blob`, so every element referencing those tokens rounds out together. Inputs are deliberately pinned back to `--radius-sm` (14px) so text fields keep their current corner rather than inheriting the rounder `md`. The role-switch inner buttons accept the intended +6px delta.

The cartoon "pop" look comes from three new orange/yellow shadow tokens with black-family dark overrides. Solid-variant buttons rest on a hard offset shadow and press into it; the stepper buttons get an equivalent rule in their own stylesheet since they are not `.btn`. Cards and tiles gain a soft ambient hover shadow plus a hair of scale.

The icon set is unified by adding rounded caps/joins to the root `<svg>` and redrawing the six formerly-filled glyphs as per-icon `fill="none"` outlines — no blanket `fill:none` that would blank the un-converted icons. A filled `starSolid` keeps ratings legible and is wired at both rating sites.

The logo slots never render empty: a `HeronMascot` SVG sits behind the `<img src="/logo.png">` in all seven call sites, so the current no-logo state shows the mascot and a dropped-in logo would override it. Two more decorative components (`BlobField`, `WaveDivider`) add background shapes, all `aria-hidden` and `pointer-events:none`.

The known gaps are the ones the design already declared out of scope (emoji unchanged, WCAG AA not machine-verified), not defects in this diff.

<details>
<summary>Issues (0)</summary>

No blocking or actionable findings. All checklist items verified against the diff and `verification.md`.

</details>

<details>
<summary>Details</summary>

## Radius scale re-point and the input pin

`tokens.css` replaces the four-value radius scale with the bubblier six-value scale exactly as specified: `--radius-xs:8px` and `--radius-xl:36px` are new, `sm` moves 8→14, `md` moves 14→20, `lg` moves 22→28, `--radius-pill` stays `999px`, and `--radius-blob` is added as the organic value for decorative wrappers only (confirmed). Because `sm`/`md`/`lg` are re-pointed rather than renamed, every surface already referencing them rounds out automatically — the intended cohesion lever.

The one deliberate counter-move is inputs. `global.css` changes `.input, .textarea, .select` from `--radius-md` to `--radius-sm`, which keeps their corner at 14px rather than letting them inherit the rounder 20px `md` (confirmed). This is the design's "keep text fields from reading pill-like" decision, on the record. The role-switch inner buttons are left to ride the `--radius-sm` bump 8→14px (the accepted +6px delta); no per-selector pin was added, matching the design.

The explicit radius bumps all landed: `.empty` goes `--radius-lg`→`--radius-xl`, `.hero__hl::after` goes 4→6px, the logo chips (`.brand__logo`, `.footer__logo` 12px; `.auth__logo` 14px) go to `--radius-lg`, `.vcard__cover-logo` goes 16px→`--radius-md`, and `:focus-visible` fallback radius goes 4px→`--radius-xs` (8px) while keeping its 3px orange ring and 2px offset — so the visible, non-color-only focus indicator is preserved.

## Pop-shadow family and the button cascade (FIX 2)

Three shadow tokens are added to `:root` — `--shadow-pop` (orange rgba), `--shadow-pop-accent` (yellow rgba), `--shadow-soft` (gentle orange ambient) — each with a black-family `[data-theme="dark"]` override, so no surface is left un-themed and no blue is introduced (confirmed).

FIX 2 is implemented as a true in-place merge, not an append. The existing resting `.btn--primary` rule has its `box-shadow: var(--shadow-sm)` replaced with `var(--shadow-pop)`:

```css
.btn--primary {
  background: var(--primary);
  color: var(--on-primary);
  box-shadow: var(--shadow-pop);
}
```

A grep of `global.css` finds exactly one resting `.btn--primary {` block, so there is no second competing rule that could shadow-stomp or win on source order. `.btn--accent` picks up `--shadow-pop-accent` the same way, and a single shared press rule placed after `.btn:active` gives both solid variants the 3px press-into-shadow:

```css
.btn--primary:active,
.btn--accent:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 rgba(217, 74, 24, 0.22);
}
```

Ghost buttons keep the base `.btn:active` behavior, as designed.

The stepper buttons are handled correctly in their own context: `.stepper__btn` is not a `.btn`, so `VendorStore.css` gets explicit resting `--shadow-pop`, a `:active` translate-and-flatten, and a disabled/`aria-disabled` rule that drops the shadow and transform. Its transition is extended to animate `transform` and `box-shadow`, and the 50% circle / 36×36 size are untouched (confirmed).

## Icon set — rounded outlines without blanking the un-converted glyphs

The root `<svg>` in `Icon.jsx` gains `strokeLinecap="round" strokeLinejoin="round"` while keeping `fill="currentColor"` (confirmed). This is the safe sequence the design called out: no blanket `fill="none"` on the root, which would have made any not-yet-redrawn filled icon vanish. The six formerly-filled icons (`search, pin, clock, star, moon, user`) are each redrawn as outline paths carrying their own `fill="none" stroke="currentColor" strokeWidth="2"`, so they inherit the rounded caps/joins while the already-stroked icons are unchanged and `check/plus/minus/back` keep their heavier `2.5` stroke. `dashboard` is left to inherit the root defaults, as the design permitted.

A filled `starSolid` glyph with softened vertices is added, and both rating call sites switch to it: `VendorCard.jsx` (`size=15`, `vcard__star`) and `VendorStore.jsx` (`size=16`, `fact-star`). Sizes and classNames are unchanged, so no layout shift. The outline `star` remains in the set for any non-rating use.

## Logo slots never empty — mascot at all seven sites (FIX 1)

`HeronMascot.jsx` is a static inline SVG built only from frozen palette vars (`--orange`, `--orange-soft`, `--orange-dark`, `--yellow`, `--ink`), `aria-hidden`, filling its slot at 100%. It is placed as a sibling behind the existing `<img src="/logo.png" onError=…>` in all seven call sites: Header, Footer, VendorCard, VendorStore, Dashboard, Login, and Signup (confirmed by reading each JSX hunk). Critically, both auth pages — Login and Signup — add the mascot inside their own `.auth__logo` span, so neither is left with an empty hidden `<img>`. Since no `logo.png` exists in the repo today, the mascot is the current default and a later real logo would layer on top.

## Reduced-motion scoping preserves functional transforms (FIX 3)

A second `@media (prefers-reduced-motion: reduce)` block is added after the base universal duration-zeroing block. It neutralizes only the transforms this redesign introduced:

```css
.btn--primary:active,
.btn--accent:active,
.vcard:hover,
.cat-tile:hover,
.card:hover,
.stepper__btn:active {
  transform: none !important;
}
.fh-float, .fh-pop { animation: none !important; }
```

It does not list `.btn:hover` (no such transform exists, so listing it would be noise) and it does not list `.toggle__thumb`. A grep of `Home.css` confirms `.toggle input:checked + .toggle__track .toggle__thumb { transform: translateX(20px) }` is present and untouched — the functional thumb slide is preserved, so the theme and pre-order switches still move to the "on" position under reduced motion. The static-hover-box-shadow comment is present ("Hover box-shadow is a static state, not motion — intentionally kept"), matching the design's intent to keep `.card:hover` / `.vcard:hover` shadows while dropping their lifts. Comparing against the base branch confirms this scoped block is genuinely new, not inherited.

## Decorative SVG components

`BlobField.jsx` (two organic blobs, `--orange-soft` + `--yellow-pale`, low opacity, one carrying `.fh-float`) and `WaveDivider.jsx` (one wide rounded path filled `var(--footer-bg)`, 48px block element) are both `aria-hidden`, `pointer-events:none`, and take only an optional `className`. BlobField sits behind `.hero__inner` on Home and behind `.auth__card` on both auth pages, with the containers given `position:relative; z-index` and the blob layers pinned behind at `z-index:0`. WaveDivider is the first child of the footer with a `-48px` top margin so the footer rises on a wave crest. No external fetches, no new dependencies, palette-only fills.

## Constraints and scope

Palette is untouched: `tokens.css` adds only radius and shadow families, all orange/yellow/warm-black, no blue, and the dark block carries matching overrides. Fonts stay Nunito + Poppins; spacing scale is unchanged. Routing, CartContext, ThemeContext, and every component API are intact — all new components are additive and presentational, and the icon `name` prop contract is unchanged (adding `starSolid` as a new key). Tap-target bumps landed (`.dash-order__btn`/`.dash-menu__edit` 40→44px, `.chip` 36→40px). The emoji and WCAG-AA machine verification remain out of scope per the design, which is a declared boundary rather than a gap in this work.

## Test coverage

No test framework exists (package.json has only `dev`/`build`/`preview`), so the bar is build plus manual QA. `verification.md` records a passing production build (vite 5.4.21, 62 modules, zero errors, CSS 31.26 kB / JS 209.03 kB gzipped 65.13 kB) after an `npm install` in the fresh worktree. Build was not re-run here per instruction. Not automatically tested (and not expected to be, given no framework): the visual rounding sweep in both themes, the pop-shadow press feedback, the mascot-renders-then-logo-overrides behavior, and the reduced-motion toggle check. These are the manual QA items the design enumerated.

</details>

<details>
<summary>File map</summary>

- `src/styles/tokens.css` — radius scale re-pointed to six values; `--shadow-pop/-pop-accent/-soft` added with dark overrides; no color/font/spacing changes.
- `src/styles/global.css` — inputs pinned to `--radius-sm`; FIX 2 in-place pop shadow on `.btn--primary`; `.btn--accent` pop-accent; shared `:active` press rule; `.chip` 40px; `:focus-visible` fallback 8px; `.card:hover` soft shadow; FIX 3 scoped reduced-motion block.
- `src/components/Icon.jsx` — root `<svg>` rounded caps/joins; six icons redrawn as `fill="none"` outlines; `starSolid` added.
- `src/components/HeronMascot.jsx` — new; palette-only cartoon heron, mascot fallback.
- `src/components/BlobField.jsx` / `WaveDivider.jsx` — new decorative inline SVGs.
- `src/components/Header.jsx` / `.css` — `.brand__logo` → `--radius-lg`; mascot added.
- `src/components/Footer.jsx` / `.css` — `.footer__logo` → `--radius-lg`; mascot + wave divider added.
- `src/components/VendorCard.jsx` / `.css` — cover-logo → `--radius-md`; hover scale + soft shadow; mascot; star → starSolid.
- `src/pages/VendorStore.jsx` / `.css` — stepper pop/press/disabled rules; mascot; star → starSolid.
- `src/pages/Dashboard.jsx` / `.css` — buttons 40→44px; mascot.
- `src/pages/Home.jsx` / `.css` — `.empty` → `--radius-xl`; hl underline 6px; cat-tile hover scale; hero blobs; toggle thumb preserved.
- `src/pages/Login.jsx` / `Signup.jsx` / `auth.css` — `.auth__logo` → `--radius-lg`; blob decoration; mascot on both auth pages.

Full diff: `git -C c:\Users\paulc\Projects\FoodHerons\.worktrees\cartoon-redesign diff main`

</details>
