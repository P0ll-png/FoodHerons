import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { CartProvider } from './context/CartContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { VendorProvider } from './context/VendorContext'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import VendorStore from './pages/VendorStore'
import Cart from './pages/Cart'
import OrderStatus from './pages/OrderStatus'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Login from './pages/Login'
import Signup from './pages/Signup'
import NotFound from './pages/NotFound'
import ScrollToTop from './components/ScrollToTop'
import Search from './pages/Search'
import Profile from './pages/Profile'
import ConfirmEmail from './pages/ConfirmEmail'   // [ADD]
import About from './pages/About'

function AuthSplash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
      Loading…
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AuthSplash />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequireRole({ role, children }) {
  const { user, loading } = useAuth()
  if (loading) return <AuthSplash />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to="/" replace />
  return children
}


export default function App() {
  const { pathname } = useLocation()
  const inSection = (base) => pathname === base || pathname.startsWith(`${base}/`)
  const hideChrome = inSection('/search') || inSection('/dashboard') || inSection('/profile')

  // Header stays on the cart, vendor store and order pages; only the footer is hidden
  const hideFooter = hideChrome || inSection('/cart') || inSection('/vendor') || inSection('/order')  || inSection('/about')

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
            <Route path="/cart" element={<RequireAuth><Cart /></RequireAuth>} />
            <Route path="/order/:id" element={<RequireAuth><OrderStatus /></RequireAuth>} />
            <Route path="/profile" element={<RequireRole role="student"><Profile /></RequireRole>} />
            <Route path="/dashboard" element={<RequireRole role="vendor"><Dashboard /></RequireRole>} />
            <Route path="/admin" element={<RequireRole role="admin"><Admin /></RequireRole>} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/about" element={<About />} />
             <Route path="/auth/confirmed" element={<ConfirmEmail />} />   {/* [ADD] email confirmation landing page */}
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