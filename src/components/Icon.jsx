// Lightweight inline SVG icons — vector, theme-aware (currentColor), no emoji.
// Decorative usage should pass aria-hidden; meaningful usage should pass a title.

const paths = {
  search: <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.74 4.74 1.42-1.42-4.74-4.74A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z" fill="none" stroke="currentColor" strokeWidth="2" />,
  cart: <path d="M3 3h2l.6 3M7 13h10l3-7H6.1M7 13 5.6 6M7 13l-1.1 5H19m-9 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  pin: <path d="M12 3a6 6 0 0 0-6 6c0 4.2 6 11 6 11s6-6.8 6-11a6 6 0 0 0-6-6Zm0 3.5A2.5 2.5 0 1 1 12 11.5 2.5 2.5 0 0 1 12 6.5Z" fill="none" stroke="currentColor" strokeWidth="2" />,
  clock: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="2" />,
  star: <path d="M12 3.5 14.6 9l6 .7-4.4 4.1 1.2 5.9L12 16.9 6.6 19.7l1.2-5.9L3.4 9.7l6-.7Z" fill="none" stroke="currentColor" strokeWidth="2" />,
    // [ADD] filled twin of `star`: same path and stroke, so filled and empty stars are always the same size
  starFilled: <path d="M12 3.5 14.6 9l6 .7-4.4 4.1 1.2 5.9L12 16.9 6.6 19.7l1.2-5.9L3.4 9.7l6-.7Z" fill="currentColor" stroke="currentColor" strokeWidth="2" />,
  sun: <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  user: <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6Z" />,
  mail: (<path d="M3 5h18v14H3V5Zm0 1 9 6 9-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>),
  lock: (<path d="M5 11h14v10H5V11Zm3 0V8a4 4 0 0 1 8 0v3"  fill="none"  stroke="currentColor" strokeWidth="2"  strokeLinecap="round" strokeLinejoin="round" /> ),
  store: ( <path  d="M4 4h16l1 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0l1-5Zm1 7.9V20h14v-8.1"  fill="none"  stroke="currentColor"  strokeWidth="2" strokeLinecap="round"  strokeLinejoin="round" /> ),
  eye: (<> <path  d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"  fill="none"  stroke="currentColor"  strokeWidth="2"  strokeLinecap="round"  strokeLinejoin="round" />
        <circle cx="12"  cy="12" r="3"  fill="none"  stroke="currentColor"  strokeWidth="2"  />  </>),
  eyeOff: ( <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor"  strokeWidth="2"  strokeLinecap="round"  strokeLinejoin="round" />),
  menu: <path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  close: <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  check: <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />,
  minus: <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />,
  
  // Long left arrow (used by the Search page back button)
  arrowLeft: <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  
  // Heart outline + filled heart (favorites)
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  heartFilled: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  back: <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  dashboard: <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  starSolid: <path d="M12 3.5c.4 0 .76.23.93.59l2.02 4.2 4.6.62c.86.12 1.2 1.18.56 1.78l-3.36 3.16.84 4.57c.15.85-.75 1.5-1.5 1.08L12 17.3l-4.1 2.2c-.76.42-1.66-.23-1.5-1.08l.83-4.57-3.36-3.16c-.63-.6-.3-1.66.57-1.78l4.6-.62 2.02-4.2c.17-.36.53-.59.92-.59Z" />,
  peso: (<g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"> <path d="M9 20V4.5" />                       
      <path d="M9 4.5h4.5a4 4 0 0 1 0 8H9" />       
      <path d="M5.5 8h12.5" />                     
      <path d="M5.5 11h12.5" />  </g>),
  trash: ( <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" /> </g>),
    // All category
  all: (
    <g fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <circle cx="17.25" cy="17.25" r="3.75" /></g>),

  /* Dashboard icons */
  inbox: <path d="M4 13h4l1 3h6l1-3h4M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  utensils: <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2.5-3 6s1 4 3 4v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  // Shopping bag (used by the "Ready for pickup" header on the order status page)
  bag: (<g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8h12l1 12H5L6 8Z" />   {/* bag body */}
      <path d="M9 8V7a3 3 0 0 1 6 0v1" /> {/* handle */} </g>),
  panel: <path d="M4 5h16v14H4zM9 5v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  bellOff: <path d="M13.7 21a2 2 0 0 1-3.4 0M18 8a6 6 0 0 0-9.3-5M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M3 3l18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  home: <path d="M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  camera: <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  
  /* Profile icons */
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  review: <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8v10l4-3h9a2 2 0 0 0 2-2v-2" /><path d="M8 11h5M8 14h3" /><path d="m17.5 2.5 1.1 2.2 2.4.4-1.7 1.7.4 2.4-2.2-1.1-2.2 1.1.4-2.4L14 5.1l2.4-.4 1.1-2.2Z" /></g>,
  starOutline: <path d="m12 17.3 6.2 3.7-1.6-7L22 9.2l-7.1-.6L12 2 9.1 8.6 2 9.2l5.4 4.8-1.6 7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  // [ADD] Multicolor Google "G" (keeps its own colors, ignores currentColor). Same artwork as the login/signup button,
  // scaled from its 320x320 drawing area into the 24x24 icon box so it renders the same size as the other icons.
  google: (<g transform="translate(-13.875 -3.75) scale(0.075)">
      <path fill="#FF4B26" d="M345 50A160 160 0 0 0 207 130L261 161A97 97 0 0 1 345 113Z" />
      <path fill="#D93F21" d="M345 50A160 160 0 0 1 452 92L413 139A97 97 0 0 0 345 113Z" />
      <path fill="#FFD500" d="M207 130A160 160 0 0 0 207 290L261 260A97 97 0 0 1 261 161Z" />
      <path fill="#14B54A" d="M207 290A160 160 0 0 0 345 370L345 307A97 97 0 0 1 261 260Z" />
      <path fill="#0F9D45" d="M345 370A160 160 0 0 0 425 348L395 295A97 97 0 0 1 345 307Z" />
      <path fill="#1A7FE8" d="M425 348A160 160 0 0 0 505 210L505 195Q505 183 493 183L364 183Q352 183 352 195L352 233Q352 245 364 245L437 245A97 97 0 0 1 395 295Z" />
    </g>),
  facebook: <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v8h4v-8h3l1-4h-4V8.6c0-.4.2-.6.6-.6Z" />,
  chevronCircle: (<g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 11l4 4 4-4" /></g> ),

  // Outline clock (store preview facts)
  clockOutline: (<g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /> </g>),
  passEye: (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" /><circle cx="12" cy="12" r="3" /></g>),
  passEyeOff: (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.9 17.9A10.6 10.6 0 0 1 12 20c-6 0-10-8-10-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9.7 9.7 0 0 1 12 4c6 0 10 8 10 8a18 18 0 0 1-2.2 3.2M1 1l22 22" />
      <path d="M14.1 14.1A3 3 0 0 1 9.9 9.9" /></g>),

  // Warning triangle (delete account dialog + danger card title)
  warning: (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" /> </g>),
  // Info circle (notice box)
  info: (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" />  </g> ),
  settings: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </g>),
      // Thumbs up (the "Helpful" button in the reviews pop-up)
  thumb: <path d="M7 10v11H3V10h4zM7 10l4-8c1.7 0 3 1.3 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  // Small bold check (password rule met)
  checkBold: <path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />,
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