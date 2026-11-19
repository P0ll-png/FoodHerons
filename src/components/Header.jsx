import { Link, NavLink, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useTheme } from '../context/ThemeContext'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import './Header.css'

export default function Header() {
  const { theme, toggleTheme } = useTheme()
  const { count } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()

  const profilePath = user?.role === 'admin' ? '/admin' : user?.role === 'vendor' ? '/dashboard' : '/profile'
  // One icon button for everyone: log in (guests), dashboard (vendors), admin panel (admins), profile (students)
  const iconTo = !user ? '/login' : profilePath
  const iconLabel = !user ? 'Log in or sign up' : user.role === 'vendor' ? 'Vendor Dashboard' : user.role === 'admin' ? 'Admin' : 'My profile'

  return (
    <header className="header">
      <div className="container header__bar">
        {/* Logo area */}
        <Link to="/" className="brand" aria-label="Food Herons home">
          <span className="brand__logo">
            <img
              src="/images/logo.jpg"
              alt=""
              aria-hidden="true"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </span>
          <span className="brand__text">
            <span className="brand__name">FOOD HERONS</span>
            <span className="brand__tag">Campus food, found fast</span>
          </span>
        </Link>

        <div className="header__actions">
          {/* Order: theme, home, cart, then log in / sign up */}
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>

          <NavLink to="/" end className="icon-btn" aria-label="Discover" title="Discover">
            <Icon name="houseRounded" size={24} />
          </NavLink>

          <button
            className="icon-btn icon-btn--cart"
            onClick={() => navigate('/cart')}
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            <Icon name="cart" />
            {count > 0 && <span className="cart-count">{count}</span>}
          </button>

          <NavLink to={iconTo} className="icon-btn" aria-label={iconLabel} title={iconLabel}>
            <Icon name="userOutline" size={24} />
          </NavLink>
        </div>
      </div>
    </header>
  )
}