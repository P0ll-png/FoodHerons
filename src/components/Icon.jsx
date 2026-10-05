// Lightweight inline SVG icons — vector, theme-aware (currentColor), no emoji.
// Decorative usage should pass aria-hidden; meaningful usage should pass a title.

const paths = {
  search: <path d="M11 2a9 9 0 1 0 5.6 16.1l4.1 4.1 1.4-1.4-4.1-4.1A9 9 0 0 0 11 2Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z" />,
  cart: <path d="M3 3h2l.6 3M7 13h10l3-7H6.1M7 13 5.6 6M7 13l-1.1 5H19m-9 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  pin: <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />,
  clock: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm1-13h-2v6l5 3 1-1.7-4-2.3V7Z" />,
  star: <path d="m12 17.3 6.2 3.7-1.6-7L22 9.2l-7.1-.6L12 2 9.1 8.6 2 9.2l5.4 4.8-1.6 7z" />,
  sun: <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  user: <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6Z" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  close: <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  check: <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />,
  minus: <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />,
  back: <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  store: <path d="M4 4h16l1 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0l1-5Zm1 7.9V20h14v-8.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  dashboard: <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
}

export default function Icon({ name, size = 20, title, className, style }) {
  const decorative = !title
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={title}
      focusable="false"
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  )
}
