// BlobField — soft organic cartoon blobs for page decoration.
// Static inline SVG, frozen palette only (orange-soft / yellow-pale, low opacity).
// Decorative: aria-hidden, pointer-events none, sits behind content.

export default function BlobField({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 300"
      width="100%"
      height="100%"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      style={{ pointerEvents: 'none' }}
    >
      <path
        className="fh-float"
        d="M90 60c34-18 78-14 100 14 20 26 10 64-20 82-32 20-78 16-98-14-18-28-14-64 18-82Z"
        fill="var(--orange-soft)"
        opacity="0.55"
      />
      <path
        d="M300 150c26-8 54 8 60 36 6 28-12 54-40 58-26 4-50-14-54-40-4-24 10-48 34-54Z"
        fill="var(--yellow-pale)"
        opacity="0.6"
      />
    </svg>
  )
}
