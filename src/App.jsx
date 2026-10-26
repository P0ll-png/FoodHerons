import { Routes, Route, useLocation } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { CartProvider } from './context/CartContext'
import { AuthProvider } from './context/AuthContext'
import { VendorProvider } from './context/VendorContext'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import VendorStore from './pages/VendorStore'
import Cart from './pages/Cart'
import OrderStatus from './pages/OrderStatus'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Signup from './pages/Signup'
import NotFound from './pages/NotFound'
import ScrollToTop from './components/ScrollToTop'
import Search from './pages/Search'
import Profile from './pages/Profile'


export default function App() {
  const { pathname } = useLocation()
  const inSection = (base) => pathname === base || pathname.startsWith(`${base}/`)
  const hideChrome = inSection('/search') || inSection('/dashboard') || inSection('/profile')

  // Header stays on the cart, vendor store and order pages; only the footer is hidden
  const hideFooter = hideChrome || inSection('/cart') || inSection('/vendor') || inSection('/order')

  return (
    <ThemeProvider>
      <AuthProvider>
      {/* VendorProvider holds the shared store/menu data. It must wrap CartProvider, because the cart reads from it. */}
      <VendorProvider>
      <CartProvider>
        <ScrollToTop />
        <a href="#main" className="visually-hidden">Skip to content</a>
{!hideChrome && <Header />}
<main id="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/vendor/:id" element={<VendorStore />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/order/:id" element={<OrderStatus />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        {!hideFooter && <Footer />}
      </CartProvider>
      </VendorProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}