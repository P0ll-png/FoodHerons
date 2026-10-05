# Food Herons — Frontend

Campus food vendor discovery and pre-ordering web app for the University of
Makati (UMAK). Students browse every food vendor near and within campus —
including student-run sellers — and pre-order where available. Pickup only,
cash on pickup.

> **Tagline:** Campus food, found fast.

This repository contains the **frontend** (React + Vite). The backend (C#) and
database (MySQL via Supabase) are separate.

## Design

- **Responsive, mobile-first** — works on phones, tablets and desktop.
- **Palette:** two shades of orange, a few yellows, mostly white — no blue.
  Tokens live in `src/styles/tokens.css`.
- **Dark mode** included (toggle in the header), using darkened warm neutrals.
- **Logo** is referenced as `/logo.png` and left empty on purpose. See
  `public/LOGO_README.txt` to add it.

## Pages

| Route          | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `/`            | Vendor directory — search, category + area filters, open-now |
| `/vendor/:id`  | Store page (pre-order flow **or** listing-only by vendor)  |
| `/cart`        | Review pre-order, pickup details, place order              |
| `/order/:id`   | Order status tracker (pending → ready → completed)         |
| `/dashboard`   | Vendor dashboard — orders, menu, profile, pre-order toggle |
| `/login`       | Log in                                                     |
| `/signup`      | Self-service signup (student or vendor, no approval step)  |

## Getting started

```bash
npm install
npm run dev      # start dev server at http://localhost:5173
npm run build    # production build to /dist
npm run preview  # preview the production build
```

## Notes

- Data is mocked in `src/data/vendors.js` for the frontend. Wire these to the
  C# API when the backend is ready.
- No online payment — orders are reservations settled in cash at pickup.
- Auth pages are frontend-only stubs; connect to real auth later.
