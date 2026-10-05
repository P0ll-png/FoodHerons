// Mock data for the Food Herons frontend.
// In production this comes from the C# backend / Supabase (MySQL).

export const categories = [
  { id: 'rice', name: 'Rice Meals', emoji: '🍚' },
  { id: 'snacks', name: 'Snacks', emoji: '🍟' },
  { id: 'drinks', name: 'Drinks', emoji: '🥤' },
  { id: 'desserts', name: 'Desserts', emoji: '🍰' },
  { id: 'noodles', name: 'Noodles', emoji: '🍜' },
  { id: 'grill', name: 'Grill & BBQ', emoji: '🍢' },
]

export const locationAreas = [
  'Main Gate',
  'HPSB Building',
  'Admin Lobby',
  'Covered Court',
  'Food Court',
  'Back Gate',
]

// Each vendor: preorderEnabled drives whether a store page shows an order flow.
export const vendors = [
  {
    id: 'tita-nenas',
    name: "Tita Nena's Silog",
    category: 'rice',
    locationArea: 'Food Court',
    description:
      'Home-style silog plates served hot all day. Student favorite near the Food Court.',
    hoursOpen: '06:30',
    hoursClose: '15:00',
    isOpen: true,
    rating: 4.8,
    reviews: 212,
    preorderEnabled: true,
    coverTint: 'var(--orange-soft)',
    menu: [
      { id: 'tapsilog', name: 'Tapsilog', price: 75, category: 'rice', available: true, desc: 'Beef tapa, garlic rice, egg.' },
      { id: 'tocilog', name: 'Tocilog', price: 70, category: 'rice', available: true, desc: 'Sweet tocino, garlic rice, egg.' },
      { id: 'hotsilog', name: 'Hotsilog', price: 60, category: 'rice', available: true, desc: 'Hotdog, garlic rice, egg.' },
      { id: 'extra-rice', name: 'Extra Rice', price: 20, category: 'rice', available: true, desc: 'One cup garlic rice.' },
      { id: 'iced-tea', name: 'House Iced Tea', price: 25, category: 'drinks', available: true, desc: 'Freshly brewed, lightly sweet.' },
    ],
  },
  {
    id: 'campus-brews',
    name: 'Campus Brews',
    category: 'drinks',
    locationArea: 'HPSB Building',
    description: 'Milk teas, fruit shakes and coffee to fuel your study grind.',
    hoursOpen: '07:00',
    hoursClose: '19:00',
    isOpen: true,
    rating: 4.6,
    reviews: 158,
    preorderEnabled: true,
    coverTint: 'var(--yellow-pale)',
    menu: [
      { id: 'wintermelon', name: 'Wintermelon Milk Tea', price: 65, category: 'drinks', available: true, desc: 'Large, with pearls.' },
      { id: 'matcha', name: 'Matcha Latte', price: 70, category: 'drinks', available: true, desc: 'Iced, lightly sweet.' },
      { id: 'mango-shake', name: 'Mango Shake', price: 60, category: 'drinks', available: false, desc: 'Fresh mango blended.' },
      { id: 'americano', name: 'Iced Americano', price: 55, category: 'drinks', available: true, desc: 'Double shot.' },
    ],
  },
  {
    id: 'crunch-corner',
    name: 'Crunch Corner',
    category: 'snacks',
    locationArea: 'Covered Court',
    description: 'Fries, fishballs and street snacks for the quick break between classes.',
    hoursOpen: '09:00',
    hoursClose: '17:00',
    isOpen: true,
    rating: 4.4,
    reviews: 97,
    preorderEnabled: false,
    coverTint: 'var(--orange-soft)',
    menu: [
      { id: 'fries', name: 'Cheese Fries', price: 45, category: 'snacks', available: true, desc: 'Loaded with cheese powder.' },
      { id: 'fishball', name: 'Fishball (10 pcs)', price: 30, category: 'snacks', available: true, desc: 'With sweet & spicy sauce.' },
      { id: 'kikiam', name: 'Kikiam', price: 35, category: 'snacks', available: true, desc: 'Crispy, 6 pcs.' },
    ],
  },
  {
    id: 'noodle-house',
    name: 'Ate Len Noodle House',
    category: 'noodles',
    locationArea: 'Food Court',
    description: 'Steaming bowls of mami, pancit and lomi — comfort in a bowl.',
    hoursOpen: '10:00',
    hoursClose: '18:00',
    isOpen: false,
    rating: 4.7,
    reviews: 143,
    preorderEnabled: true,
    coverTint: 'var(--yellow-pale)',
    menu: [
      { id: 'beef-mami', name: 'Beef Mami', price: 70, category: 'noodles', available: true, desc: 'Rich beef broth, noodles, egg.' },
      { id: 'pancit', name: 'Pancit Canton', price: 60, category: 'noodles', available: true, desc: 'Stir-fried, generous veggies.' },
      { id: 'lomi', name: 'Special Lomi', price: 65, category: 'noodles', available: true, desc: 'Thick, hearty, topped with chicharon.' },
    ],
  },
  {
    id: 'sweet-spot',
    name: 'The Sweet Spot',
    category: 'desserts',
    locationArea: 'Admin Lobby',
    description: 'Student-run dessert stall: brownies, cookies and halo-halo in season.',
    hoursOpen: '08:00',
    hoursClose: '16:00',
    isOpen: true,
    rating: 4.9,
    reviews: 76,
    preorderEnabled: true,
    coverTint: 'var(--orange-soft)',
    menu: [
      { id: 'brownie', name: 'Fudge Brownie', price: 40, category: 'desserts', available: true, desc: 'Dense and chocolatey.' },
      { id: 'cookies', name: 'Choc-chip Cookies (3)', price: 50, category: 'desserts', available: true, desc: 'Baked fresh daily.' },
      { id: 'halohalo', name: 'Halo-Halo', price: 65, category: 'desserts', available: false, desc: 'Seasonal, with ube ice cream.' },
    ],
  },
  {
    id: 'smoky-grill',
    name: 'Kuya Boy Smoky Grill',
    category: 'grill',
    locationArea: 'Back Gate',
    description: 'Isaw, pork BBQ and grilled favorites fired up fresh every afternoon.',
    hoursOpen: '14:00',
    hoursClose: '21:00',
    isOpen: false,
    rating: 4.5,
    reviews: 189,
    preorderEnabled: false,
    coverTint: 'var(--yellow-pale)',
    menu: [
      { id: 'isaw', name: 'Isaw (3 sticks)', price: 30, category: 'grill', available: true, desc: 'Classic chicken isaw.' },
      { id: 'pork-bbq', name: 'Pork BBQ', price: 35, category: 'grill', available: true, desc: 'Sweet-savory marinade.' },
    ],
  },
  {
    id: 'brekkie-cart',
    name: 'Brekkie Cart',
    category: 'snacks',
    locationArea: 'Main Gate',
    description: 'Sandwiches, pandesal and quick bites for the morning rush at the gate.',
    hoursOpen: '06:00',
    hoursClose: '11:00',
    isOpen: true,
    rating: 4.3,
    reviews: 64,
    preorderEnabled: true,
    coverTint: 'var(--yellow-pale)',
    menu: [
      { id: 'eggsand', name: 'Egg & Cheese Sandwich', price: 45, category: 'snacks', available: true, desc: 'On toasted bun.' },
      { id: 'pandesal', name: 'Pandesal w/ Kesong Puti', price: 40, category: 'snacks', available: true, desc: 'Warm, 2 pcs.' },
      { id: 'kape', name: 'Barako Coffee', price: 30, category: 'drinks', available: true, desc: 'Strong brewed barako.' },
    ],
  },
  {
    id: 'rice-rush',
    name: 'Rice Rush',
    category: 'rice',
    locationArea: 'Covered Court',
    description: 'Rice bowls and ulam combos — big servings, student prices.',
    hoursOpen: '10:30',
    hoursClose: '16:30',
    isOpen: true,
    rating: 4.6,
    reviews: 121,
    preorderEnabled: false,
    coverTint: 'var(--orange-soft)',
    menu: [
      { id: 'adobo-bowl', name: 'Chicken Adobo Bowl', price: 75, category: 'rice', available: true, desc: 'With rice and egg.' },
      { id: 'sisig-bowl', name: 'Sisig Rice Bowl', price: 85, category: 'rice', available: true, desc: 'Sizzling-style, with egg.' },
    ],
  },
]

export function getVendor(id) {
  return vendors.find((v) => v.id === id)
}

export function categoryName(id) {
  return categories.find((c) => c.id === id)?.name ?? id
}
