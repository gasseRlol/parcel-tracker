// Parcel Tracker connector.
// Another system, such as Quayside (the ship-supply demo on this site), uses these calls to hand
// an order to the tracker and follow it. They work on a test room: deliveries shared online with
// everyone who has the room's link, so a real driver can take part from his own phone.
//   useRoom(id)               which test room to use
//   saveOrder(order)          creates or updates the tracker's copy of an order: what is in it, the
//                             stage of each line, and whether a trip to the customer is going on
//   complete(code, by)        the company marks it delivered itself
//   pretendDriver(code, trip) for testing alone: a simulated driver takes the trip from this page
//   remove(code), clearRoom(), status(code), sentBy(system), onChange(fn), isReady()
//   trackUrl(code)            the link the customer follows the order with
//   courierUrl(code)          the link the driver opens on his phone to take the job
// For a real company the same calls become web requests to the tracker's server (CONNECT.md).
import * as T from './backend-room.js?v=20261031a';
import { useEmulators } from './firebase-config.js';

const SEC = 1000;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), n => ALPHABET[n % ALPHABET.length]).join('');
const newPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
const base = new URL('./', import.meta.url).href;
const PRETEND = 'pretend-driver';

export const { useRoom, newRoomId, isReady, onChange } = T;
export const room = () => T.room();
const link = (code, kind) => `${base}?room=${T.room()}${useEmulators ? '&emu' : ''}#${kind}/${code}`;
export const trackUrl = code => link(code, 'd');
export const courierUrl = code => link(code, 'join');

// The three stages of an order, and the tracker status each one shows while no trip is going on
export const STAGE_STATUS = { 1: 'at_supplier', 2: 'in_warehouse', 3: 'delivered' };

// order: { code?, pin?, title, from, customer, dest: { lat, lng }, destLabel, address, notes,
//          lines: [{ id, desc, qty, unit, stage }], stage: 1 | 2 | 3, tripRef: id of the delivery
//          note now going out (or null), tripLines: line ids on it, source: { system, ref } }
// Line stages: pending, supplier, warehouse, packed, on_way, ship.
export async function saveOrder(o) {
  const t = Date.now();
  const cur = o.code ? T.get(o.code) : null;
  if (!cur) {
    const code = o.code || newCode(), pin = o.pin || newPin();
    const status = o.tripRef ? 'waiting' : STAGE_STATUS[o.stage] === 'delivered' ? 'in_warehouse' : STAGE_STATUS[o.stage];
    await T.create(code, {
      kind: 'order', ownerUid: 'company', ownerName: o.customer || '', ownerPhone: '',
      item: o.title, from: o.from || '', address: o.address || '', notes: o.notes || '',
      dest: o.dest, destLabel: o.destLabel || '', pickup: o.pickup || null, lines: o.lines, stage: o.stage, source: o.source || null,
      trip: o.tripRef ? { ref: o.tripRef, lines: o.tripLines || [], at: t } : null,
      status, courierUid: null, courierName: '', courierPhone: '', courierLoc: null,
      events: [{ s: status === 'waiting' ? 'released' : status, at: t, by: 'company' }],
      createdAt: t, updatedAt: t,
    }, pin);
    return { code, pin };
  }
  const f = { item: o.title, dest: o.dest, destLabel: o.destLabel || '', pickup: o.pickup || null, address: o.address || '', notes: o.notes || '', lines: o.lines, stage: o.stage, ownerName: o.customer || '', updatedAt: t };
  const ev = [];
  const tripRef = cur.trip && cur.trip.ref;
  const stageStatus = STAGE_STATUS[o.stage];
  if (tripRef && tripRef !== o.tripRef) {
    // The trip is over on the company's side: delivered (maybe only part of the order) or called off
    f.trip = null; f.courierLoc = null;
    if (o.stage === 3) { if (cur.status !== 'delivered') { f.status = 'delivered'; f.deliveredAt = t; ev.push({ s: 'delivered', at: t, by: 'company' }); } }
    else if (cur.status === 'delivered') { f.status = stageStatus; f.handoffPin = T.deleteField(); f.deliveredAt = null; ev.push({ s: 'part_delivered', at: t, by: 'company', note: 'The rest of the order is not on the ship yet' }); }
    else { f.status = stageStatus; ev.push({ s: 'trip_cancelled', at: t, by: 'company' }); }
  }
  if (o.tripRef && o.tripRef !== tripRef) {
    // A delivery note is packed and may go out: the driver can start
    f.trip = { ref: o.tripRef, lines: o.tripLines || [], at: t };
    f.status = cur.courierUid && cur.courierUid !== PRETEND ? 'assigned' : 'waiting';
    if (cur.courierUid === PRETEND) { f.courierUid = null; f.courierName = ''; }
    f.courierLoc = null;
    if (cur.status === 'delivered') { f.handoffPin = T.deleteField(); f.deliveredAt = null; }
    ev.push({ s: 'released', at: t, by: 'company', note: o.tripNote || '' });
  } else if (!o.tripRef && !tripRef && cur.status !== 'cancelled' && stageStatus !== 'delivered' && cur.status !== stageStatus) {
    f.status = stageStatus;
    ev.push({ s: stageStatus, at: t, by: 'company' });
  }
  await T.update(o.code, f, ev.length ? ev : null);
  return { code: o.code, pin: o.pin };
}

// The company marks the trip delivered itself (for example, the driver phoned it in)
export async function complete(code, receivedBy = '') {
  const d = T.get(code);
  if (!d || ['delivered', 'cancelled'].includes(d.status)) return false;
  stopPretend(code);
  const t = Date.now();
  await T.deliver(code, { status: 'delivered', handoffPin: await T.getPin(code), deliveredAt: t, receivedBy, updatedAt: t },
    { s: 'delivered', at: t, by: 'company', note: receivedBy ? `Signed for by ${receivedBy}` : '' });
  return true;
}
export async function remove(code) { stopPretend(code); if (T.get(code)) await T.remove(code); }
export const clearRoom = () => { for (const code of [...sims.keys()]) stopPretend(code); return T.clearAll(); };

// ---------- A pretend driver, for testing alone ----------
// Drives the trip from this page: by road from origin to roadTo (or to the door), then through the
// sea points to a ship at anchor. Sped up: any trip takes about two and a half minutes.
const sims = new Map();
function stopPretend(code) { clearInterval(sims.get(code)); sims.delete(code); }
function meters(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function headingOf(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
function along(c, s) {
  let i = 1;
  while (i < c.length) { const seg = meters(c[i - 1], c[i]); if (s <= seg) break; s -= seg; i++; }
  if (i >= c.length) return { p: c[c.length - 1], h: null, done: true };
  const f = s / (meters(c[i - 1], c[i]) || 1);
  return { p: [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f], h: headingOf(c[i - 1], c[i]), done: false };
}
async function road(a, b) {
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    const coords = (await res.json()).routes?.[0]?.geometry?.coordinates;
    if (coords && coords.length > 1) return [[a.lng, a.lat], ...coords];
  } catch {}
  return [[a.lng, a.lat]];
}
export const isPretending = code => sims.has(code);
// trip: { origin: { lat, lng }, roadTo?: { lat, lng }, sea?: [{ lat, lng }], courierName, receiver }
export async function pretendDriver(code, trip) {
  const d = T.get(code);
  if (!d || !d.trip || ['delivered', 'cancelled'].includes(d.status) || sims.has(code)) return false;
  sims.set(code, 0);
  const roadEnd = trip.roadTo || d.dest;
  let c = await road(trip.origin, roadEnd);
  c.push([roadEnd.lng, roadEnd.lat]);
  for (const p of trip.sea || []) c.push([p.lng, p.lat]);
  c.push([d.dest.lng, d.dest.lat]);
  c = c.filter((p, i) => !i || p[0] !== c[i - 1][0] || p[1] !== c[i - 1][1]);
  const total = c.reduce((s, p, i) => (i ? s + meters(c[i - 1], p) : 0), 0);
  const speed = Math.max(12, total / 150);
  const t0 = Date.now();
  const steps = [];
  if (!d.courierUid) steps.push('assigned');
  if (!['picked_up', 'on_the_way'].includes(d.status)) steps.push('picked_up');
  steps.push('on_the_way');
  try {
    await T.update(code, {
      courierUid: d.courierUid || PRETEND, courierName: d.courierName || trip.courierName || 'Pretend driver', courierPhone: d.courierPhone || '',
      status: 'on_the_way', demoDrive: true, updatedAt: t0,
      courierLoc: { lat: trip.origin.lat, lng: trip.origin.lng, acc: 6, heading: null, speed, at: t0 },
    }, steps.map(s => ({ s, at: t0, by: 'courier' })));
  } catch (e) { sims.delete(code); throw e; }
  const tick = async () => {
    if (!sims.has(code)) return;
    const cur = T.get(code);
    if (!cur || cur.status !== 'on_the_way') { stopPretend(code); return; }
    const now = Date.now();
    const { p, h, done } = along(c, ((now - t0) / SEC) * speed);
    const loc = { lat: p[1], lng: p[0], acc: 6, heading: h, speed: done ? 0 : speed, at: now };
    try {
      if (done && now - t0 > (total / speed) * SEC + 8 * SEC) {
        stopPretend(code);
        await T.deliver(code, { status: 'delivered', handoffPin: await T.getPin(code), deliveredAt: now, receivedBy: trip.receiver || '', courierLoc: loc, updatedAt: now },
          { s: 'delivered', at: now, by: 'courier', note: trip.receiver ? `Handed over with the PIN to ${trip.receiver}` : 'Handed over with the PIN' });
      } else await T.update(code, { courierLoc: loc, updatedAt: now });
    } catch {}
  };
  sims.set(code, setInterval(tick, 3 * SEC));
  return true;
}

// ---------- Reading ----------
const LABEL = {
  at_supplier: 'With the supplier', in_warehouse: 'In the warehouse', waiting: 'Packed, waiting for a driver',
  assigned: 'Driver ready, not started', picked_up: 'Driver has it', on_the_way: 'On the way',
  delivered: 'On the ship', problem: 'Driver reported a problem', cancelled: 'Cancelled',
};
function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function status(code) {
  const d = T.get(code);
  if (!d) return null;
  const evAt = s => (d.events || []).filter(e => e.s === s).at(-1)?.at || null;
  const loc = d.courierLoc;
  return {
    code, status: d.status, label: LABEL[d.status] || d.status, stage: d.stage, trip: d.trip || null,
    courierName: d.courierName || '', hasDriver: !!d.courierUid, pretend: d.courierUid === PRETEND,
    courierLoc: loc || null, kmLeft: loc && d.status === 'on_the_way' ? km(loc, d.dest) : null,
    sentAt: evAt('picked_up') || evAt('on_the_way'), deliveredAt: d.deliveredAt || evAt('delivered'), receivedBy: d.receivedBy || '',
    problem: d.status === 'problem' ? d.problem || '' : '', source: d.source || null, createdAt: d.createdAt,
  };
}
// Everything a given system sent, so it can tidy up orders it no longer has
export const sentBy = system => T.all().filter(d => d.source?.system === system).map(d => status(d.code));
