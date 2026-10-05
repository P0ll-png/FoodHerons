import { useState } from 'react'
import Icon from '../components/Icon'
import { vendors } from '../data/vendors'
import './Dashboard.css'

// Demo dashboard for the first pre-order-enabled vendor.
const demoVendor = vendors.find((v) => v.preorderEnabled) ?? vendors[0]

const incomingOrders = [
  { id: 'FH-4821', name: 'Aira S.', items: '2× Tapsilog, 1× Iced Tea', total: 175, status: 'pending' },
  { id: 'FH-4820', name: 'Marco D.', items: '1× Tocilog', total: 70, status: 'accepted' },
  { id: 'FH-4818', name: 'Jules P.', items: '3× Hotsilog, 2× Extra Rice', total: 220, status: 'ready' },
]

const STATUS_FLOW = ['pending', 'accepted', 'ready', 'completed']
const STATUS_LABEL = {
  pending: 'Pending',
  accepted: 'Accepted',
  ready: 'Ready',
  completed: 'Completed',
}

export default function Dashboard() {
  const [preorder, setPreorder] = useState(demoVendor.preorderEnabled)
  const [tab, setTab] = useState('orders')
  const [orders, setOrders] = useState(incomingOrders)

  const advance = (id) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o
        const next = STATUS_FLOW[Math.min(STATUS_FLOW.indexOf(o.status) + 1, STATUS_FLOW.length - 1)]
        return { ...o, status: next }
      })
    )
  }

  return (
    <div className="container section">
      <header className="dash-head">
        <span className="dash-head__logo" aria-hidden="true">
          <img src="/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </span>
        <div>
          <p className="dash-head__eyebrow">Vendor dashboard</p>
          <h1>{demoVendor.name}</h1>
          <p className="text-muted">{demoVendor.locationArea} · {demoVendor.hoursOpen}–{demoVendor.hoursClose}</p>
        </div>
      </header>

      {/* Pre-order master toggle */}
      <div className="dash-toggle card">
        <div>
          <h2 className="dash-toggle__title">Pre-ordering</h2>
          <p className="text-muted">
            {preorder
              ? 'Students can place advance orders from your menu.'
              : 'Your store is listing-only. Students can view your menu but not pre-order.'}
          </p>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={preorder}
            onChange={(e) => setPreorder(e.target.checked)}
          />
          <span className="toggle__track" aria-hidden="true">
            <span className="toggle__thumb" />
          </span>
          <span className="visually-hidden">Toggle pre-ordering</span>
          {preorder ? 'On' : 'Off'}
        </label>
      </div>

      {/* Tabs */}
      <div className="dash-tabs" role="tablist" aria-label="Dashboard sections">
        <button
          role="tab"
          aria-selected={tab === 'orders'}
          className={`dash-tab ${tab === 'orders' ? 'dash-tab--active' : ''}`}
          onClick={() => setTab('orders')}
        >
          Incoming orders
        </button>
        <button
          role="tab"
          aria-selected={tab === 'menu'}
          className={`dash-tab ${tab === 'menu' ? 'dash-tab--active' : ''}`}
          onClick={() => setTab('menu')}
        >
          Menu items
        </button>
        <button
          role="tab"
          aria-selected={tab === 'profile'}
          className={`dash-tab ${tab === 'profile' ? 'dash-tab--active' : ''}`}
          onClick={() => setTab('profile')}
        >
          Store profile
        </button>
      </div>

      {/* Orders */}
      {tab === 'orders' && (
        <section className="dash-panel">
          {!preorder ? (
            <div className="empty">
              <span className="empty__emoji" aria-hidden="true">🔕</span>
              <h3>Pre-ordering is off</h3>
              <p className="text-muted">Turn it on above to start receiving orders.</p>
            </div>
          ) : (
            <ul className="dash-orders">
              {orders.map((o) => (
                <li key={o.id} className="dash-order card">
                  <div className="dash-order__main">
                    <p className="dash-order__id">{o.id} · {o.name}</p>
                    <p className="dash-order__items text-muted">{o.items}</p>
                  </div>
                  <span className="dash-order__total">₱{o.total}</span>
                  <span className={`badge badge--${o.status === 'completed' ? 'open' : 'preorder'}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                  {o.status !== 'completed' ? (
                    <button className="btn btn--primary dash-order__btn" onClick={() => advance(o.id)}>
                      Mark {STATUS_LABEL[STATUS_FLOW[STATUS_FLOW.indexOf(o.status) + 1]]}
                    </button>
                  ) : (
                    <span className="dash-order__done"><Icon name="check" size={16} /> Paid</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Menu management */}
      {tab === 'menu' && (
        <section className="dash-panel">
          <div className="section-head">
            <div><h2>Menu items</h2><p>Add, edit or mark items unavailable.</p></div>
            <button className="btn btn--primary"><Icon name="plus" size={16} /> Add item</button>
          </div>
          <ul className="dash-menu">
            {demoVendor.menu.map((item) => (
              <li key={item.id} className="dash-menu__item card">
                <div>
                  <p className="dash-menu__name">{item.name}</p>
                  <p className="text-muted dash-menu__desc">{item.desc}</p>
                </div>
                <span className="dash-menu__price">₱{item.price}</span>
                <span className={`badge ${item.available ? 'badge--open' : 'badge--closed'}`}>
                  {item.available ? 'Available' : 'Sold out'}
                </span>
                <button className="btn btn--ghost dash-menu__edit">Edit</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Profile */}
      {tab === 'profile' && (
        <section className="dash-panel">
          <form className="dash-form card" onSubmit={(e) => e.preventDefault()}>
            <h2 className="dash-form__title">Store profile</h2>
            <div className="field">
              <label htmlFor="store-name">Store name</label>
              <input id="store-name" className="input" defaultValue={demoVendor.name} />
            </div>
            <div className="field">
              <label htmlFor="store-desc">Description</label>
              <textarea id="store-desc" className="textarea" defaultValue={demoVendor.description} />
            </div>
            <div className="dash-form__row">
              <div className="field">
                <label htmlFor="store-loc">Location / stall area</label>
                <input id="store-loc" className="input" defaultValue={demoVendor.locationArea} />
              </div>
              <div className="field">
                <label htmlFor="store-cat">Category</label>
                <input id="store-cat" className="input" defaultValue={demoVendor.category} />
              </div>
            </div>
            <div className="dash-form__row">
              <div className="field">
                <label htmlFor="store-open">Opens</label>
                <input id="store-open" type="time" className="input" defaultValue={demoVendor.hoursOpen} />
              </div>
              <div className="field">
                <label htmlFor="store-close">Closes</label>
                <input id="store-close" type="time" className="input" defaultValue={demoVendor.hoursClose} />
              </div>
            </div>
            <button type="submit" className="btn btn--primary">Save changes</button>
          </form>
        </section>
      )}
    </div>
  )
}
