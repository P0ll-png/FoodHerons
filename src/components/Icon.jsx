// Lightweight inline SVG icons — vector, theme-aware (currentColor), no emoji.
// Decorative usage should pass aria-hidden; meaningful usage should pass a title.

const paths = {
  search: <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.74 4.74 1.42-1.42-4.74-4.74A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z" fill="none" stroke="currentColor" strokeWidth="2" />,
  cart: <path d="M3 3h2l.6 3M7 13h10l3-7H6.1M7 13 5.6 6M7 13l-1.1 5H19m-9 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  pin: <path d="M12 3a6 6 0 0 0-6 6c0 4.2 6 11 6 11s6-6.8 6-11a6 6 0 0 0-6-6Zm0 3.5A2.5 2.5 0 1 1 12 11.5 2.5 2.5 0 0 1 12 6.5Z" fill="none" stroke="currentColor" strokeWidth="2" />,
  clock: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="2" />,
  star: <path d="M12 3.5 14.6 9l6 .7-4.4 4.1 1.2 5.9L12 16.9 6.6 19.7l1.2-5.9L3.4 9.7l6-.7Z" fill="none" stroke="currentColor" strokeWidth="2" />,
  sun: <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" fill="none" stroke="currentColor" strokeWidth="2" />,
  user: <path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 10c-4.4 0-8 2.2-8 5v2.5h16V18c0-2.8-3.6-5-8-5Z" fill="none" stroke="currentColor" strokeWidth="2" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  close: <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  check: <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />,
  minus: <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />,
  back: <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  store: <path d="M4 4h16l1 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0l1-5Zm1 7.9V20h14v-8.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  dashboard: <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  starSolid: <path d="M12 3.5c.4 0 .76.23.93.59l2.02 4.2 4.6.62c.86.12 1.2 1.18.56 1.78l-3.36 3.16.84 4.57c.15.85-.75 1.5-1.5 1.08L12 17.3l-4.1 2.2c-.76.42-1.66-.23-1.5-1.08l.83-4.57-3.36-3.16c-.63-.6-.3-1.66.57-1.78l4.6-.62 2.02-4.2c.17-.36.53-.59.92-.59Z" />,
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
      strokeLinecap="round"
      strokeLinejoin="round"
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
