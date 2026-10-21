// The demo backend: the same functions as backend-firebase.js, but everything lives in this
// browser (localStorage), shared between tabs. It comes with sample deliveries in Cairo and a
// demo courier who drives one of them to your door along a real road route.
const KEY = 'pt.demo.world.v1';
const ME = 'demo-you';
const USER = { uid: ME, email: 'demo@parcel-tracker.app', displayName: 'You' };
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;

export const kind = 'demo';
export const testMode = false;
export const now = () => Date.now();

const clone = v => JSON.parse(JSON.stringify(v));
const denied = () => Object.assign(new Error('Not allowed'), { code: 'permission-denied' });

// ---------- The sample world ----------
function seed() {
  const t = Date.now();
  const ev = (s, ago, by, extra = {}) => ({ s, at: t - ago, by, ...extra });
  const home = { lat: 30.06095, lng: 31.21985 };          // Zamalek
  const start = { lat: 30.04442, lng: 31.23571 };         // Tahrir Square
  return {
    profiles: { [ME]: { name: 'You', phone: '', role: 'customer', createdAt: t, updatedAt: t } },
    pins: { RN4SH7EZ: '3816', HP6DRK2Q: '7240', BK3XWT9M: '5052', CK8BDY5P: '4271' },
    robot: { code: 'RN4SH7EZ', coords: [[start.lng, start.lat], [home.lng, home.lat]], startedAt: t, speed: 12 },
    deliveries: {
      RN4SH7EZ: {
        ownerUid: ME, ownerName: 'You', ownerPhone: '', item: 'Running shoes', from: 'Sports shop',
        address: 'Building 4, 2nd floor', notes: 'Ring twice, please.',
        dest: home, destLabel: '26th of July Corridor, Zamalek, Cairo',
        status: 'on_the_way', courierUid: 'demo-karim', courierName: 'Karim (demo courier)', courierPhone: '',
        courierLoc: { ...start, acc: 6, heading: null, speed: 12, at: t }, demoDrive: true,
        events: [ev('waiting', 26 * HOUR, 'customer'), ev('assigned', 3 * HOUR, 'courier'), ev('picked_up', 40 * MIN, 'courier'), ev('on_the_way', 1 * MIN, 'courier')],
        createdAt: t - 26 * HOUR, updatedAt: t,
      },
      HP6DRK2Q: {
        ownerUid: ME, ownerName: 'You', ownerPhone: '', item: 'Headphones', from: 'Electronics store',
        address: '', notes: '', dest: { lat: 29.96018, lng: 31.25694 }, destLabel: 'Road 9, Maadi, Cairo',
        status: 'waiting', courierUid: null, courierName: '', courierPhone: '', courierLoc: null,
        events: [ev('waiting', 2 * HOUR, 'customer')],
        createdAt: t - 2 * HOUR, updatedAt: t - 2 * HOUR,
      },
      BK3XWT9M: {
        ownerUid: ME, ownerName: 'You', ownerPhone: '', item: 'Books', from: 'Bookshop',
        address: '', notes: '', dest: { lat: 30.09103, lng: 31.32257 }, destLabel: 'Korba, Heliopolis, Cairo',
        status: 'delivered', courierUid: 'demo-omar', courierName: 'Omar (demo courier)', courierPhone: '',
        courierLoc: { lat: 30.09103, lng: 31.32257, acc: 8, heading: null, speed: 0, at: t - 20 * HOUR },
        events: [ev('waiting', 50 * HOUR, 'customer'), ev('assigned', 30 * HOUR, 'courier'), ev('picked_up', 23 * HOUR, 'courier'), ev('on_the_way', 21 * HOUR, 'courier'), ev('delivered', 20 * HOUR, 'courier')],
        handoffPin: '5052', deliveredAt: t - 20 * HOUR, createdAt: t - 50 * HOUR, updatedAt: t - 20 * HOUR,
      },
      CK8BDY5P: {
        ownerUid: 'demo-salma', ownerName: 'Salma (demo customer)', ownerPhone: '', item: 'Birthday cake', from: 'Bakery',
        address: 'Villa 12, ground floor', notes: 'Keep it flat, please!', dest: { lat: 30.03846, lng: 31.21203 }, destLabel: 'Mossadak Street, Dokki, Giza',
        status: 'assigned', courierUid: ME, courierName: 'You', courierPhone: '', courierLoc: null,
        events: [ev('waiting', 3 * HOUR, 'customer'), ev('assigned', 20 * MIN, 'courier')],
        createdAt: t - 3 * HOUR, updatedAt: t - 20 * MIN,
      },
    },
  };
}

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
let world = load();
if (!world || !world.deliveries) { world = seed(); persist(); fetchRobotRoute(); }

const listeners = new Set();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(world)); } catch {} }
function changed() { persist(); for (const l of listeners) queueMicrotask(l); }
addEventListener('storage', e => { if (e.key === KEY) { world = load() || seed(); for (const l of listeners) l(); } });

export function reset() { world = seed(); persist(); fetchRobotRoute(); }
export const peekPin = code => world.pins[code] || null;

// ---------- The demo courier drives along a real road route ----------
async function fetchRobotRoute() {
  const r = world.robot;
  const [a, b] = [r.coords[0], r.coords[r.coords.length - 1]];
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`);
    const json = await res.json();
    const coords = json.routes && json.routes[0] && json.routes[0].geometry.coordinates;
    if (coords && coords.length > 1 && world.robot === r) { r.coords = [...coords, b]; r.startedAt = Date.now(); persist(); }
  } catch {}
}
function dist(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function heading(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
function robotTick() {
  const r = world.robot;
  const d = r && world.deliveries[r.code];
  if (!d || d.status !== 'on_the_way' || d.courierUid !== 'demo-karim') return;
  const c = r.coords;
  let s = ((Date.now() - r.startedAt) / SEC) * r.speed;
  let i = 1;
  while (i < c.length) { const seg = dist(c[i - 1], c[i]); if (s <= seg) break; s -= seg; i++; }
  let p, h = null;
  if (i >= c.length) p = c[c.length - 1];
  else { const seg = dist(c[i - 1], c[i]) || 1, f = s / seg; p = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f]; h = heading(c[i - 1], c[i]); }
  d.courierLoc = { lat: p[1], lng: p[0], acc: 6, heading: h, speed: i >= c.length ? 0 : r.speed, at: Date.now() };
  d.updatedAt = Date.now();
  changed();
}
setInterval(robotTick, 2 * SEC);

// ---------- Accounts (the demo has one person: you) ----------
export function onAuth(cb) { queueMicrotask(() => cb(USER)); return () => {}; }
export async function signIn() { return USER; }
export async function signUp() { return USER; }
export async function resetPassword() {}
export async function signOutUser() {}
export async function getProfile(uid) { return world.profiles[uid] ? clone(world.profiles[uid]) : null; }
export async function saveProfile(uid, data) {
  world.profiles[uid] = { ...data, createdAt: data.createdAt || Date.now(), updatedAt: Date.now() };
  for (const d of Object.values(world.deliveries)) {
    if (d.ownerUid === uid) { d.ownerName = data.name; d.ownerPhone = data.phone || d.ownerPhone; }
    if (d.courierUid === uid) { d.courierName = data.name; d.courierPhone = data.phone || ''; }
  }
  changed();
}

// ---------- Deliveries ----------
export function watch(field, uid, onList) {
  const fire = () => onList(Object.entries(world.deliveries).filter(([, d]) => d[field] === uid).map(([code, d]) => ({ code, ...clone(d) })));
  listeners.add(fire);
  queueMicrotask(fire);
  return () => listeners.delete(fire);
}
export async function create(code, data, pin) {
  if (world.deliveries[code]) throw denied();
  world.deliveries[code] = clone(data);
  world.pins[code] = pin;
  changed();
}
export async function update(code, fields, event) {
  const d = world.deliveries[code];
  if (!d) throw denied();
  if (fields.courierUid === ME && d.courierUid && d.courierUid !== ME) throw denied();
  Object.assign(d, clone(fields));
  if (event) d.events = [...(d.events || []), event];
  changed();
}
export async function getPin(code) { return world.deliveries[code] && world.deliveries[code].ownerUid === ME ? world.pins[code] || null : null; }
export async function getJob(code) {
  const d = world.deliveries[code];
  if (!d || (d.courierUid && d.courierUid !== ME && d.ownerUid !== ME)) throw denied();
  return { code, ...clone(d) };
}
export async function deliver(code, fields, event) {
  if (fields.handoffPin !== world.pins[code]) throw denied();
  await update(code, fields, event);
}
export async function remove(code) { delete world.deliveries[code]; delete world.pins[code]; changed(); }
