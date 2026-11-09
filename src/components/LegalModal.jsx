import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../components/Icon'
import './LegalModal.css'

/* ---------------------------------------------------------------------
   Legal pop-up: Terms of Service / Privacy Policy
   Shared modal driven by the `kind` prop ('terms' | 'privacy').
   Follows the same behaviour as ReviewsModal: rendered in a portal,
   Esc closes, page scroll is locked, focus is trapped inside.
   --------------------------------------------------------------------- */

const LAST_UPDATED = 'November 5, 2026'

const CONTENT = {
  terms: {
    icon: 'receipt',
    title: 'Terms of Service',
    intro:
      'Welcome to FoodHerons. By creating an account or using our service, you agree to these terms. Please read them carefully.',
    sections: [
      {
        h: '1. Using FoodHerons',
        p: 'FoodHerons connects you with local food stalls and vendors. You must be at least 18 years old, or have the consent of a parent or guardian, to create an account and place orders.',
      },
      {
        h: '2. Your account',
        p: 'You are responsible for keeping your login details secure and for all activity that happens under your account. Let us know right away if you notice any unauthorized use.',
      },
      {
        h: '3. Orders and payments',
        p: 'Prices, availability, and preparation times are set by the vendors. An order is a request to a vendor, who may accept or decline it. You agree to pay the listed price plus any applicable fees shown at checkout.',
      },
      {
        h: '4. Cancellations and refunds',
        p: 'Once a vendor begins preparing your order it may no longer be cancellable. Refund eligibility depends on the vendor and the status of your order at the time of the request.',
      },
      {
        h: '5. Acceptable use',
        p: 'Do not misuse the service, interfere with its operation, or use it for anything unlawful. We may suspend or close accounts that break these terms.',
      },
      {
        h: '6. Changes to these terms',
        p: 'We may update these terms from time to time. If we make a significant change, we will let you know. Continuing to use FoodHerons after an update means you accept the revised terms.',
      },
    ],
  },
  privacy: {
    icon: 'lock',
    title: 'Privacy Policy',
    intro:
      'Your privacy matters to us. This policy explains what information FoodHerons collects, how we use it, and the choices you have.',
    sections: [
      {
        h: '1. Information we collect',
        p: 'We collect the details you give us when you sign up and order, such as your name, email, contact number, and delivery or pickup address. We also collect basic usage data to keep the service running smoothly.',
      },
      {
        h: '2. How we use your information',
        p: 'We use your information to create and manage your account, process orders, connect you with vendors, provide support, and improve FoodHerons.',
      },
      {
        h: '3. Sharing with vendors',
        p: 'When you place an order, we share the details a vendor needs to prepare and fulfil it, such as your order and contact information. We do not sell your personal information.',
      },
      {
        h: '4. Keeping your data safe',
        p: 'We use reasonable technical and organizational measures to protect your information. No system is perfectly secure, but we work to safeguard your data and limit access to it.',
      },
      {
        h: '5. Your choices',
        p: 'You can review and update your profile details at any time from your account settings. You may request that we delete your account and associated personal data.',
      },
      {
        h: '6. Contact us',
        p: 'If you have questions about this policy or how your data is handled, reach out to us through the support options in the app.',
      },
    ],
  },
}

export default function LegalModal({ kind, onClose }) {
  const closeRef = useRef(null)
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose) // always points at the latest onClose
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const open = kind === 'terms' || kind === 'privacy'

  /* Open/close behaviour: Esc closes, page scroll locked, focus kept inside. */
  useEffect(() => {
    if (!open) return undefined
    const prevFocus = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const f = dialogRef.current.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [open])

  if (!open) return null

  const data = CONTENT[kind]

  return createPortal(
    <div className="lg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="lg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lg-title"
        ref={dialogRef}
      >
        {/* ---------- Header ---------- */}
        <header className="lg-head">
          <div className="lg-head__text">
            <span className="lg-head__icon" aria-hidden="true">
              <Icon name={data.icon} size={20} />
            </span>
            <div>
              <h2 id="lg-title">{data.title}</h2>
              <p>Last updated {LAST_UPDATED}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" className="lg-close" onClick={onClose} aria-label={`Close ${data.title}`}>
            <Icon name="close" size={18} />
          </button>
        </header>

        {/* ---------- Body ---------- */}
        <div className="lg-body">
          <p className="lg-intro">{data.intro}</p>
          {data.sections.map((s) => (
            <section key={s.h} className="lg-section">
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </section>
          ))}
          <p className="lg-note">
            This summary is provided for FoodHerons and does not constitute legal advice.
          </p>
        </div>

        {/* ---------- Footer ---------- */}
        <footer className="lg-foot">
          <button type="button" className="lg-done" onClick={onClose}>Got it</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
