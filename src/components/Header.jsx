import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import HeronMascot from './HeronMascot'
import { useTheme } from '../context/ThemeContext'
import { useCart } from '../context/CartContext'
import './Header.css'

export default function Header() {
  const { theme, toggleTheme } = useTheme()
  const { count } = useCart()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const closeMenu = () => setOpen(false)

  return (
    <header className="header">
      <div className="container header__bar">
        {/* Logo area — intentionally empty, uses logo.png when provided */}
        <Link to="/" className="brand" onClick={closeMenu} aria-label="Food Herons home">
          <span className="brand__logo">
            <HeronMascot className="logo-mascot" />
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </span>
          <span className="brand__text">
            <span className="brand__name">Food Herons</span>
            <span className="brand__tag">Campus food, found fast</span>
          </span>
        </Link>

        <nav className={`nav ${open ? 'nav--open' : ''}`} aria-label="Primary">
          <NavLink to="/" end className="nav__link" onClick={closeMenu}>
            Discover
          </NavLink>
          <NavLink to="/dashboard" className="nav__link" onClick={closeMenu}>
            Vendor Dashboard
          </NavLink>
          <NavLink to="/login" className="nav__link" onClick={closeMenu}>
            Log in
          </NavLink>
          <Link
            to="/signup"
            className="btn btn--primary nav__cta"
            onClick={closeMenu}
          >
            Sign up
          </Link>
        </nav>

        <div className="header__actions">
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>

          <button
            className="icon-btn icon-btn--cart"
            onClick={() => navigate('/cart')}
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            <Icon name="cart" />
            {count > 0 && <span className="cart-count">{count}</span>}
          </button>

          <button
            className="icon-btn nav-toggle"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            <Icon name={open ? 'close' : 'menu'} />
          </button>
        </div>
      </div>
    </header>
  )
}
