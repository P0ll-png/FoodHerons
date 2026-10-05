import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { CartProvider } from './context/CartContext'
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

export default function App() {
  return (
    <ThemeProvider>
      <CartProvider>
        <ScrollToTop />
        <a href="#main" className="visually-hidden">Skip to content</a>
        <Header />
        <main id="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/vendor/:id" element={<VendorStore />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/order/:id" element={<OrderStatus />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </CartProvider>
    </ThemeProvider>
  )
}
