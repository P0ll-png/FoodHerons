// HeronMascot — friendly cartoon heron used as the default logo-slot fill.
// Static inline SVG, frozen palette only (orange body, yellow beak, warm-ink eye).
// Decorative: aria-hidden, fills whatever slot wraps it.

export default function HeronMascot({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      width="100%"
      height="100%"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {/* soft body */}
      <path
        d="M20 50c-4-10-2-22 8-27 8-4 17-2 21 5 4 7 2 16-5 21-3 2-7 3-11 3H22l-2-2Z"
        fill="var(--orange)"
      />
      {/* belly highlight */}
      <path
        d="M24 48c-2-7 0-15 7-18 5-2 10-1 13 2-6-1-12 1-15 6-2 4-3 7-5 10Z"
        fill="var(--orange-soft)"
        opacity="0.6"
      />
      {/* head */}
      <circle cx="42" cy="24" r="9" fill="var(--orange)" />
      {/* beak */}
      <path d="M50 23l11 2-10 4Z" fill="var(--yellow)" />
      {/* little crest */}
      <path
        d="M40 15c1-3 3-5 6-6-1 3-1 5-3 7Z"
        fill="var(--orange-dark)"
      />
      {/* eye */}
      <circle cx="44" cy="22" r="2" fill="var(--ink)" />
    </svg>
  )
}
