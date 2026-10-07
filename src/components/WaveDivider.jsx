// WaveDivider — soft rounded wave rendered at the top edge of the footer.
// Static inline SVG filled with the footer background so the footer rises on a wave.
// Decorative: aria-hidden, pointer-events none, block element (no inline gap).

export default function WaveDivider({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1200 48"
      width="100%"
      height="48"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="none"
      style={{ display: 'block', pointerEvents: 'none' }}
    >
      <path
        d="M0 48V20c120-24 260-24 400 0s280 24 400 0 280-24 400 0v28Z"
        fill="var(--footer-bg)"
      />
    </svg>
  )
}
