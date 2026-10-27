import { supabase } from './supabase'

// Base URL for the C# order service. In dev, '/api' is proxied to
// http://localhost:5080 by Vite (see vite.config.js); prod can override
// via VITE_API_BASE_URL.
const BASE = import.meta.env.VITE_API_BASE_URL || '/api'

// Thrown on any non-2xx response from the order service. Carries the
// machine-readable `code` (e.g. ITEM_UNAVAILABLE / VENDOR_CLOSED /
// ILLEGAL_TRANSITION / VALIDATION) and the HTTP `status` so callers can
// branch on them. Any extra ProblemDetails fields (field, menuItemId,
// from/to, correlationId) are spread onto the error.
export class ApiError extends Error {
  constructor(message, { status, code, ...extras } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    Object.assign(this, extras)
  }
}

// Reads the current Supabase access token. The order service validates this
// JWT and derives the user id + role from it; AuthContext does not expose the
// token, so we read it straight from the Supabase session.
async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Token-aware JSON fetch. Sends the Bearer token + JSON body, and on a non-2xx
// response parses the ProblemDetails body and throws an ApiError.
async function request(path, { method = 'GET', body } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  // Parse the JSON body when present (both success and error bodies are JSON).
  let payload = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!res.ok) {
    const code = payload?.code
    const message =
      payload?.title || payload?.message || `Request failed (${res.status})`
    const { status, title, message: _m, ...extras } = payload ?? {}
    throw new ApiError(message, { status: res.status, code, ...extras })
  }

  return payload
}

// POST /api/orders — place an order. Body: { vendorId, pickupName, note, items:
// [{ menuItemId, qty }] } (no prices; totals are computed server-side).
// Returns the PlaceOrderResponse ({ id, code, status, subtotal, total, ... }).
export function postOrder(body) {
  return request('/orders', { method: 'POST', body })
}

// POST /api/orders/{id}/transition — advance or cancel an order. `id` is the
// order UUID. Body: { to, reason? } (reason required iff to === 'cancelled').
// Returns the updated OrderDto.
export function transitionOrder(id, body) {
  return request(`/orders/${id}/transition`, { method: 'POST', body })
}
