import { Link } from 'react-router-dom'
import HeronMascot from './HeronMascot'
import WaveDivider from './WaveDivider'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <WaveDivider className="footer__wave" />
      <div className="container footer__grid">
        <div className="footer__brand">
          <div className = "footer__brand-top">
          <span className="footer__logo">
            <HeronMascot className="logo-mascot" />
            <img
              src="/images/logo.jpg"
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
        <p className="footer__about">
         A student project for the University of Makati. Browse campus
         vendors and pre-order where available. Pickup only, cash on pickup.
        </p>
        </div>
        
        <nav className="footer__col" aria-label="Explore">
          <h3>Explore</h3>
          <Link to="/">Open Now </Link>
          <Link to="/">View Map</Link>
          <Link to="/">About us</Link>
        </nav>

        <nav className="footer__col" aria-label="For vendors">
          <h3>For vendors</h3>
          <Link to="/signup?role=vendor">Become a vendor</Link>
          <Link to="/login">Log in</Link>
          <Link to="/">Partner FAQs</Link>
        </nav>

        <div className="footer__col"> 
          <h3>Contact us</h3>
            <div className="footer__social">  {/* placeholders only */}
              <a href="mailto:hello@foodherons.com" aria-label="Email">
                <img src="/images/email.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              </a>
              <a href="https://facebook.com" aria-label="Facebook" target="_blank" rel="noreferrer">
                 <img src="/images/facebook.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              </a>
              <a href="https://m.me" aria-label="Messenger" target="_blank" rel="noreferrer">
                <img src="/images/messenger.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
               </a>
             </div>
         </div>
      </div>
      <div className="container footer__bottom">
        <p>© {new Date().getFullYear()} Food Herons · UMAK campus · Made for students</p>
      </div>
    </footer>
  )
}
