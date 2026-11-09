import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Icon from '../components/Icon'
import { useVendors } from '../context/VendorContext'
import './About.css'

// Hide broken images
const hideBroken = (e) => { e.currentTarget.style.display = 'none' }

// Services list
const SERVICES = [
  {
    icon: 'bagCheck',
    title: 'Pickup-Based Ordering',
    text: 'Order ahead and collect at the stall. No delivery, so food stays fresh and fees stay low.',
  },
  {
    icon: 'wallet',
    title: 'GCash Payments',
    text: 'Pay in the app. Your order is confirmed only after payment succeeds.',
  },
  {
    icon: 'barChart',
    title: 'Vendor Dashboard',
    text: 'Vendors accept and update orders in real time, and set their stall open or closed.',
  },
  {
    icon: 'compass',
    title: 'Live Discovery',
    text: 'Search vendors, dishes and stall areas. See who is open now and browse by category.',
  },
]

// How-it-works steps
const STEPS = {
  students: [
    { title: 'Order', text: 'Browse and add to cart' },
    { title: 'Payment', text: 'Pay via GCash to confirm' },
    { title: 'Ready for pickup', text: 'Show your order number' },
    { title: 'Completed', text: 'Picked up and paid' },
  ],
  vendors: [
    { title: 'New order', text: 'Receive the order alert' },
    { title: 'Accepted', text: 'Confirm payment and prepare' },
    { title: 'Ready for pickup', text: 'Verify the order number' },
    { title: 'Completed', text: 'Hand over and close the order' },
  ],
}

// FAQ content
const FAQS = [
  {
    id: 'pickup',
    category: 'Ordering',
    q: 'How does pickup ordering work?',
    a: 'Choose your food, place your order and pay through GCash. The vendor prepares it and you are notified when it is ready. Go to the stall, show your order number and collect your food.',
  },
  {
    id: 'gcash',
    category: 'Payments',
    q: 'Is GCash payment safe?',
    a: 'Yes. Payments are processed through GCash, so FoodHerons never sees or stores your GCash PIN. Your order goes to the vendor only after payment is confirmed.',
  },
  {
    id: 'cancel',
    category: 'Ordering',
    q: 'Can I cancel or change my order?',
    a: 'You can cancel before the vendor accepts it. Once preparation has started, orders cannot be changed. If something goes wrong, contact support.',
  },
  {
    id: 'join',
    category: 'Vendors',
    q: 'I am a stall owner. How do I join?',
    a: 'Select Become a Vendor, submit your stall details and wait for approval. Once approved, you can add your menu, set your hours and start receiving orders.',
  },
  {
    id: 'orders',
    category: 'Vendors',
    q: 'How do I receive and manage orders?',
    a: 'New orders appear in your Vendor Dashboard with an alert. Accept the order, mark it as ready for pickup when the food is done, and complete it once the student has collected it.',
  },
  {
    id: 'vendorpay',
    category: 'Vendors',
    q: 'How do I get paid?',
    a: 'Students send the exact amount to your GCash number and submit the reference number, with an optional screenshot. The payment shows up under Needs review in your dashboard. Check it against your GCash app, then continue with the order.',
  },
  {
    id: 'hours',
    category: 'Vendors',
    q: 'Can I set my stall as open or closed?',
    a: 'Yes. You can switch your stall between open and closed from your dashboard, so students only order when you are ready to take orders.',
  },
  {
    id: 'late',
    category: 'Ordering',
    q: 'What if my order is not ready on time?',
    a: 'Your order status updates in the app. If it is taking too long, ask the vendor at the stall or contact support.',
    extra: true,
  },
  {
    id: 'delivery',
    category: 'Ordering',
    q: 'Is there a delivery option?',
    a: 'No. FoodHerons is pickup only, which keeps food fresh and fees low.',
    extra: true,
  },
  {
    id: 'soldout',
    category: 'Vendors',
    q: 'What if a dish sells out?',
    a: 'Vendors can mark dishes as unavailable, so sold-out items stop appearing as orderable.',
    extra: true,
  },
  {
    id: 'menu',
    category: 'Vendors',
    q: 'How do I update my menu and prices?',
    a: 'Open the Menu tab in your dashboard to add dishes, change prices and photos, or hide items you are not selling today.',
    extra: true,
  },
  {
    id: 'studentcancel',
    category: 'Vendors',
    q: 'What if a student cancels an order?',
    a: 'Students pick a reason when they cancel, and you can see it on the order. Canceled orders are not counted in your revenue.',
    extra: true,
  },
  {
    id: 'verify',
    category: 'Vendors',
    q: 'How do I know the right student is picking up?',
    a: 'Ask the student to show their order number and match it to the order in your dashboard before handing over the food.',
    extra: true,
  },
]

// FAQ tabs
const CATEGORIES = ['Ordering', 'Payments', 'Vendors']

// Image with placeholder fallback
function Photo({ src, alt, label, className = '' }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className={`${className} about-ph`} role="img" aria-label={alt}>
        <Icon name="camera" size={32} />
        <span>{label}</span>
      </div>
    )
  }
  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />
}

// About page root
export default function About() {
  const { publicVendors, categories } = useVendors()
  // Hero stats
  const stats = [
    { value: publicVendors.length, label: 'Vendors' },
    { value: categories.length, label: 'Categories' },
    { value: '100%', label: 'Pick-up based' },
    { value: 'GCash', label: 'Secure Payments' },
  ]

  // State
  const [track, setTrack] = useState('students')
  const [category, setCategory] = useState('Ordering')
  const [openId, setOpenId] = useState('pickup')
  const [showAll, setShowAll] = useState(false)
  // Visible FAQs
  const inCategory = FAQS.filter((f) => f.category === category)
  const hasExtras = inCategory.some((f) => f.extra)
  const visibleFaqs = inCategory.filter((f) => showAll || !f.extra)
  // Switch FAQ tab
  const selectCategory = (c) => {
    setCategory(c)
    setShowAll(false)
    setOpenId(FAQS.find((f) => f.category === c)?.id ?? null)
  }

  // Deep link to FAQs (#faqs, ?faq=)
  const { hash, search, key } = useLocation()
  useEffect(() => {
    const wanted = new URLSearchParams(search).get('faq')?.toLowerCase()
    const match = CATEGORIES.find((c) => c.toLowerCase() === wanted)
    if (match) selectCategory(match)

    if (hash !== '#faqs') return
    const goToFaqs = () => document.getElementById('faqs')?.scrollIntoView({ block: 'start' })
    const timers = [0, 120, 350].map((ms) => setTimeout(goToFaqs, ms))
    return () => timers.forEach(clearTimeout)
  }, [hash, search, key])

  // Reveal steps on scroll
  const stepsRef = useRef(null)
  const [stepsSeen, setStepsSeen] = useState(false)
  useEffect(() => {
    const el = stepsRef.current
    if (!el || !('IntersectionObserver' in window)) { setStepsSeen(true); return }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setStepsSeen(true); io.disconnect() }
    }, { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  // Open / close FAQ
  const toggleFaq = (id) => setOpenId((cur) => (cur === id ? null : id))

  return (
    <main className="about">
      {/* Hero */}
      <section className="about-hero" aria-labelledby="about-hero-title">
        <div className="about-hero__art" aria-hidden="true">
          <span className="about-hero__blob" />
          <img className="about-hero__bowl" src="/images/bowl.png" alt="" onError={hideBroken} />
        </div>
        <div className="about-hero__inner">
          <span className="about-tag">University of Makati</span>
          <h1 id="about-hero-title" className="about-hero__title">
            <span>Campus Food,</span> <span>Found fast</span>
          </h1>
          <p className="about-hero__sub">
            Order ahead. Skip the line. Enjoy your break.
          </p>
          <div className="about-hero__actions">
            <Link to="/" className="about-btn about-btn--primary">Start ordering</Link>
            <Link to="/signup?role=vendor" className="about-btn about-btn--ghost">Become a vendor</Link>
          </div>
        </div>
      </section>

      <div className="about-panel">

      {/* Intro + stats */}
      <section className="about-intro container">
        <h2 className="about-intro__headline">ORDER AHEAD. PICK UP FAST.</h2>
        <p className="about-intro__sub">Connecting Herons to Campus Bites.</p>
        <p className="about-intro__body">
          FoodHerons lets University of Makati students order ahead from campus stalls.
          Browse menus, pay via GCash, and pick up when ready.
        </p>
        <dl className="about-stats">
          {stats.map((st) => (
            <div key={st.label} className="about-stats__item">
              <dt>{st.value}</dt>
              <dd>{st.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Story */}
      <section className="about-story">
        <div className="container about-story__grid">
          <Photo
            className="about-story__img"
            src="/images/umak.jpg"
            alt="A vendor handing an order to a student"
            label="Vendor handing an order to a student"
          />
          <div>
            <h2 className="about-title">About Us</h2>
            <p>
              FoodHerons is a dedicated web platform designed to streamline campus dining at the University of Makati.
               By connecting students directly with surrounding food stalls through a seamless pickup-only system,
                we eliminate long wait times, simplify GCash transactions, and empower local vendors to manage peak-hour demand efficiently.
            </p>
            <p className="about-story__mission">
             Empowering campus dining through efficient technology and local vendor growth.
            </p>
          </div>
        </div>
      </section>

      {/* Services + steps */}
      <section className="about-services container">
        <h2 className="about-title about-title--center">Our Services</h2>

        <div className="about-services__grid">
          {SERVICES.map((s) => (
            <article key={s.title} className="about-card">
              <span className="about-card__icon"><Icon name={s.icon} size={26} /></span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>

        <div className="about-toggle" role="group" aria-label="How it works for">
          <button
            type="button"
            className={`about-pill ${track === 'students' ? 'is-active' : ''}`}
            aria-pressed={track === 'students'}
            onClick={() => { setTrack('students'); setStepsSeen(true) }}
          >
            For Students
          </button>
          <button
            type="button"
            className={`about-pill ${track === 'vendors' ? 'is-active' : ''}`}
            aria-pressed={track === 'vendors'}
            onClick={() => { setTrack('vendors'); setStepsSeen(true) }}
          >
            For Vendors
          </button>
        </div>

        <ol key={track} ref={stepsRef} className={`about-steps ${stepsSeen ? 'is-in' : ''}`}>
          {STEPS[track].map((step, i) => (
            <li
              key={step.title}
              className="about-steps__item"
              style={{ '--i': i }}
            >
              <span className="about-steps__dot">{i + 1}</span>
              <span className="about-steps__title">{step.title}</span>
              <span className="about-steps__text">{step.text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQs */}
      <section className="about-faq" id="faqs">
        <div className="container about-faq__grid">
          <div>
            <h2 className="about-title">Frequently asked Questions</h2>
            <p>Quick answers about ordering, payments and pickup.</p>
            <div className="about-faq__pills" role="group" aria-label="Filter questions">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`about-pill ${category === c ? 'is-active' : ''}`}
                  aria-pressed={category === c}
                  onClick={() => selectCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="about-faq__list">
            {visibleFaqs.map((f) => {
              const open = openId === f.id
              return (
                <div key={f.id} className={`about-faqitem ${open ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    className="about-faqitem__q"
                    aria-expanded={open}
                    aria-controls={`faq-${f.id}`}
                    onClick={() => toggleFaq(f.id)}
                  >
                    {f.q}
                    <Icon name={open ? 'minus' : 'plus'} size={22} />
                  </button>
                  {open && (
                    <p id={`faq-${f.id}`} className="about-faqitem__a">{f.a}</p>
                  )}
                </div>
              )
            })}

            {/* Show more / fewer */}
            {hasExtras && (
              <button
                type="button"
                className="about-faq__more"
                aria-expanded={showAll}
                onClick={() => setShowAll((s) => !s)}
              >
                {showAll ? 'Show fewer questions' : 'Show more questions'}
              </button>
            )}
          </div>
        </div>
      </section>
      </div>
    </main>
  )
}