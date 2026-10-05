import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="container section">
      <div className="cart-empty">
        <span className="cart-empty__emoji" aria-hidden="true">🍳</span>
        <h1>Page not found</h1>
        <p className="text-muted">
          That page slipped off the menu. Let's get you back to the food.
        </p>
        <Link to="/" className="btn btn--primary mt-4">Back to vendors</Link>
      </div>
    </div>
  )
}
