// Parcel Tracker connector (demo edition).
// Another system, such as Quayside (the ship-supply demo on this same site), uses these few
// calls to hand a delivery to the tracker and to follow it:
//   createDelivery(job)  -> { code, pin, trackUrl, courierUrl }
//   dispatch(code, trip) -> a courier takes it and drives it (in the demo, a simulated one)
//   status(code)         -> where it is and what state it is in
//   onChange(fn)         -> fn runs whenever any delivery changes
//   complete(code, by) / cancel(code, why)
// Here the calls work on the demo data kept in this browser. For a real company the same
// calls become web requests to the tracker's server; CONNECT.md describes them.
import * as T from './backend-demo.js?v=20261030a';

const SEC = 1000;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), n => ALPHABET[n % ALPHABET.length]).join('');
const newPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
const base = new URL('./', import.meta.url).href;
const DEMO_COURIER = 'demo-connect-courier';

export const trackUrl = code => `${base}?demo#d/${code}`;
export const courierUrl = code => `${base}?demo#join/${code}`;
export const onChange = T.onChange;

// job: { title, from, dest: { lat, lng }, destLabel, address, notes, lines: [{ desc, qty, unit }], source: { system, ref } }
export async function createDelivery(job) {
  let code = newCode();
  while (T.get(code)) code = newCode();
  const pin = newPin(), t = Date.now();
  await T.create(code, {
    ownerUid: T.ME, ownerName: 'You', ownerPhone: '',
    item: job.title, from: job.from || '', address: job.address || '', notes: job.notes || '',
    dest: { lat: job.dest.lat, lng: job.dest.lng }, destLabel: job.destLabel || '',
    lines: job.lines || [], source: job.source || null,
    status: 'waiting', courierUid: null, courierName: '', courierPhone: '', courierLoc: null,
    events: [{ s: 'waiting', at: t, by: 'customer', note: job.from ? `Sent by ${job.from}${job.source?.ref ? ` (${job.source.ref})` : ''}` : '' }],
    createdAt: t, updatedAt: t,
  }, pin);
  return { code, pin, trackUrl: trackUrl(code), courierUrl: courierUrl(code) };
}

// trip: { origin: { lat, lng }, roadTo?: { lat, lng }, sea?: [{ lat, lng }], courierName, receiver }
// The courier drives by road from origin to roadTo (or straight to the door), then, for a ship
// at anchor, goes by boat through the sea points to the delivery spot.
export async function dispatch(code, trip) {
  const d = T.get(code);
  if (!d || ['delivered', 'cancelled'].includes(d.status)) return false;
  const roadEnd = trip.roadTo || d.dest;
  let coords = await road(trip.origin, roadEnd);
  coords.push([roadEnd.lng, roadEnd.lat]);
  for (const p of trip.sea || []) coords.push([p.lng, p.lat]);
  coords.push([d.dest.lng, d.dest.lat]);
  coords = coords.filter((p, i) => !i || p[0] !== coords[i - 1][0] || p[1] !== coords[i - 1][1]);
  // Sped up for the demo: any trip takes about two and a half minutes
  const speed = Math.max(12, T.pathLength(coords) / 150);
  const t = Date.now();
  const steps = ['assigned', 'picked_up', 'on_the_way'].filter(s => !(d.events || []).some(e => e.s === s));
  await T.update(code, {
    status: 'on_the_way', courierUid: DEMO_COURIER, courierName: trip.courierName || 'Demo courier', courierPhone: '',
    courierLoc: { lat: trip.origin.lat, lng: trip.origin.lng, acc: 6, heading: null, speed, at: t }, demoDrive: true,
  }, steps.map(s => ({ s, at: t, by: 'courier' })));
  T.startRobot(code, { coords, speed, courierUid: DEMO_COURIER, autoDeliver: true, receiver: trip.receiver || '' });
  return true;
}
async function road(a, b) {
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    const coords = (await res.json()).routes?.[0]?.geometry?.coordinates;
    if (coords && coords.length > 1) return [[a.lng, a.lat], ...coords];
  } catch {}
  return [[a.lng, a.lat]];
}

// The person on board signed for it (the sending system marks it delivered itself)
export async function complete(code, receivedBy = '') {
  const d = T.get(code);
  if (!d || ['delivered', 'cancelled'].includes(d.status)) return false;
  const t = Date.now();
  await T.deliver(code, { status: 'delivered', handoffPin: T.peekPin(code), deliveredAt: t, receivedBy, courierLoc: d.courierLoc && { ...d.courierLoc, speed: 0 } },
    { s: 'delivered', at: t, by: 'courier', note: receivedBy ? `Signed for by ${receivedBy}` : '' });
  return true;
}
export async function cancel(code, why = '') {
  const d = T.get(code);
  if (!d || ['delivered', 'cancelled'].includes(d.status)) return false;
  await T.update(code, { status: 'cancelled' }, { s: 'cancelled', at: Date.now(), by: 'customer', note: why });
  return true;
}

const LABEL = { waiting: 'Waiting for a courier', assigned: 'Courier assigned', picked_up: 'Picked up', on_the_way: 'On the way', delivered: 'Delivered', problem: 'Problem reported', cancelled: 'Cancelled' };
function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function status(code) {
  const d = T.get(code);
  if (!d) return null;
  const at = s => (d.events || []).filter(e => e.s === s).at(-1)?.at || null;
  const loc = d.courierLoc;
  // Distance still to go along the courier's own route (road, then sea for a ship at anchor)
  const r = T.robotOf(code);
  let kmLeft = loc && d.status === 'on_the_way' ? km(loc, d.dest) : null;
  if (r && d.status === 'on_the_way') kmLeft = Math.max(0, T.pathLength(r.coords) - ((Date.now() - r.startedAt) / SEC) * r.speed) / 1000;
  return {
    code, status: d.status, label: LABEL[d.status] || d.status,
    courierName: d.courierName || '', courierLoc: loc || null,
    kmLeft,
    sentAt: at('picked_up') || at('on_the_way'), deliveredAt: d.deliveredAt || at('delivered'), receivedBy: d.receivedBy || '',
    problem: d.status === 'problem' ? (d.events || []).at(-1)?.note || '' : '',
    source: d.source || null, createdAt: d.createdAt,
  };
}
// Every delivery a given system sent, so it can tidy up ones it no longer knows about
export const sentBy = system => T.all().filter(d => d.source?.system === system).map(d => status(d.code));
