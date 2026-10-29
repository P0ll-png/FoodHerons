# Food Herons — Frontend

Campus food vendor discovery and pre-ordering web app for the University of
Makati (UMAK). Students browse every food vendor near and within campus —
including student-run sellers — and pre-order where available. Pickup only,
paid ahead via GCash.

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
| `/order/:id`   | Order status tracker (pay via GCash → pending → ready → completed) |
| `/dashboard`   | Vendor dashboard — orders, GCash payment verification, menu, profile, pre-order toggle, revenue PDF export |
| `/admin`       | Admin console — approve/suspend stores, manage users + orders, verify payments |
| `/login`       | Log in                                                     |
| `/signup`      | Self-service signup; new vendor stores require admin approval before they appear to students |

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
- GCash-gated pre-orders (manual verification, no gateway): placing a pre-order
  creates it `awaiting_payment`. The student pays via the vendor's GCash number
  and submits a reference (screenshot optional); the order moves to
  `payment_submitted`. A vendor or admin verifies it into the normal queue. An
  unverified order never reaches the active queue.
- Vendors can export their revenue (completed orders only) as a client-side PDF
  from the dashboard over a selectable date range.
- Auth pages are frontend-only stubs; connect to real auth later.
