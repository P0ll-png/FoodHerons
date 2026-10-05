import { Link } from 'react-router-dom'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <span className="footer__logo">
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </span>
          <div>
            <p className="footer__name">Food Herons</p>
            <p className="footer__tag">Campus food, found fast.</p>
          </div>
        </div>

        <nav className="footer__col" aria-label="Explore">
          <h3>Explore</h3>
          <Link to="/">Vendor directory</Link>
          <Link to="/?open=1">Open now</Link>
          <Link to="/signup">Become a vendor</Link>
        </nav>

        <nav className="footer__col" aria-label="For vendors">
          <h3>For vendors</h3>
          <Link to="/dashboard">Vendor dashboard</Link>
          <Link to="/signup?role=vendor">Create a store</Link>
          <Link to="/login">Log in</Link>
        </nav>

        <div className="footer__col">
          <h3>About</h3>
          <p className="footer__about">
            A student project for the University of Makati. Browse campus
            vendors and pre-order where available. Pickup only, cash on pickup.
          </p>
        </div>
      </div>

      <div className="container footer__bottom">
        <p>© {new Date().getFullYear()} Food Herons · UMAK campus · Made for students</p>
      </div>
    </footer>
  )
}
