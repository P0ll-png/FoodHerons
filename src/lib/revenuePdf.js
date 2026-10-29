import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/* ------------------------------------------------------------------ */
/*  Vendor revenue PDF — pure, DOM-free builders.                      */
/*                                                                      */
/*  aggregateByDay() groups completed orders by their real calendar     */
/*  day (device local time) using the canonical `placedAt` carried on   */
/*  every history row. buildRevenuePdf() turns the aggregate into a      */
/*  jsPDF document the caller saves. Neither touches the DOM, so both    */
/*  are unit-testable in isolation.                                      */
/* ------------------------------------------------------------------ */

// Palette (no blue) — kept here so the PDF matches the app's oranges.
const ORANGE = [234, 88, 12] // header / table head fill
const DARK = [38, 38, 38] // body text

// "PHP 1,234.00" — grouped thousands, two decimals, no ₱ glyph (the core
// PDF fonts don't carry it, so we spell out the currency instead).
function formatPhp(amount) {
  const n = Number(amount) || 0
  return `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Group completed orders by calendar day. Keyed by the device's local date
// (en-PH) derived from each order's `placedAt`, so a completed-today order and
// an older one land on their correct days. Returns an array of
// { date, orderCount, revenue } sorted oldest-first, plus the running totals.
export function aggregateByDay(orders = []) {
  const byDay = new Map()
  let grandTotal = 0
  let orderCount = 0

  orders.forEach((o) => {
    const total = Number(o.total) || 0
    const date = new Date(o.placedAt).toLocaleDateString('en-PH')
    const row = byDay.get(date) ?? { date, orderCount: 0, revenue: 0, at: o.placedAt }
    row.orderCount += 1
    row.revenue += total
    // Keep the earliest timestamp seen for a day so sorting is stable.
    if (o.placedAt < row.at) row.at = o.placedAt
    byDay.set(date, row)
    grandTotal += total
    orderCount += 1
  })

  const days = [...byDay.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ date, orderCount: c, revenue }) => ({ date, orderCount: c, revenue }))

  return { days, grandTotal, orderCount }
}

// Build the revenue report PDF. `days` is the aggregateByDay() output; an empty
// range still produces a valid zero-total document (never throws).
export function buildRevenuePdf({
  storeName,
  rangeLabel,
  generatedAt,
  days = [],
  grandTotal = 0,
  orderCount = 0,
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 40
  let y = margin

  // Header: store name + report title.
  doc.setTextColor(...ORANGE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(String(storeName || 'Store'), margin, y)
  y += 20
  doc.setFontSize(13)
  doc.text('Revenue report', margin, y)
  y += 22

  // Meta lines: range, generated timestamp, day-boundary basis.
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Date range: ${rangeLabel || 'All time'}`, margin, y)
  y += 14
  doc.text(`Generated: ${generatedAt || new Date().toLocaleString('en-PH')}`, margin, y)
  y += 14
  doc.text("Day boundary: your device's local time", margin, y)
  y += 18

  if (days.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.text('No completed orders in this range', margin, y)
    y += 18
    doc.setFont('helvetica', 'bold')
    doc.text(`Total revenue: ${formatPhp(0)}`, margin, y)
    return doc
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Date', 'Completed orders', 'Revenue (PHP)']],
    body: days.map((d) => [d.date, String(d.orderCount), formatPhp(d.revenue)]),
    foot: [['Total', String(orderCount), formatPhp(grandTotal)]],
    theme: 'striped',
    styles: { fontSize: 10, textColor: DARK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [255, 237, 213], textColor: DARK, fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  })

  return doc
}
