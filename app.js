// Parcel Tracker: accounts, your deliveries as tabs, the courier's checklist, and live tracking
// of the courier's phone on a spinning Earth. Data lives in Firebase (backend-firebase.js),
// or in the browser for the demo (backend-demo.js); both offer the same functions.
import { createGlobe } from './globe.js?v=20261030a';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const SEC = 1000, MIN = 60 * SEC;

// ---------- Live, demo or test room ----------
// ?demo (or the "Try the demo" button) opens the demo on this device only. ?room=CODE opens a test
// room: the same deliveries online for everyone who has the link, no account needed.
const params = new URLSearchParams(location.search);
if (params.has('room')) { store.set('pt.room', params.get('room')); store.set('pt.demo', false); }
else if (params.has('demo')) { store.set('pt.demo', true); store.set('pt.room', null); }
const ROOM_ID = store.get('pt.room', null);
const B = ROOM_ID ? await import('./backend-room.js?v=20261031b')
  : store.get('pt.demo', false) ? await import('./backend-demo.js?v=20261031a') : await import('./backend-firebase.js?v=20261031a');
if (ROOM_ID) { try { B.useRoom(ROOM_ID); } catch { store.set('pt.room', null); location.replace(location.pathname); } }
const DEMO = B.kind === 'demo';
const ROOM = B.kind === 'room';
if (B.testMode) $('#testBanner').hidden = false;
if (B.testMode || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) queueMicrotask(() => { window.__pt = { globe, S, B }; });
$('#demoBtn').addEventListener('click', () => { store.set('pt.demo', true); store.set('pt.room', null); location.href = `${location.pathname}?demo`; });
if (ROOM) {
  $('#testBanner').textContent = `Test room ${B.room()} · everyone with the link sees the same`;
  $('#testBanner').hidden = false;
  document.querySelector('[data-menu="signout"] span').textContent = 'Leave the test room';
}
if (DEMO) {
  $('#testBanner').textContent = 'Demo · everything stays on this device';
  $('#testBanner').hidden = false;
  document.querySelector('[data-menu="signout"] span').textContent = 'Leave the demo';
  $('[data-menu="reset-demo"]').hidden = false;
}

// ---------- Words ----------
const STATUS = {
  at_supplier:  { label: 'With the supplier', short: 'With the supplier', tone: 'idle' },
  in_warehouse: { label: 'In the warehouse', short: 'In the warehouse', tone: 'sky' },
  waiting:    { label: 'Waiting for a courier', short: 'No courier yet', tone: 'idle' },
  assigned:   { label: 'Courier assigned', short: 'Courier assigned', tone: 'sky' },
  picked_up:  { label: 'Picked up', short: 'Picked up', tone: 'sky' },
  on_the_way: { label: 'On the way', short: 'On the way', tone: 'live' },
  delivered:  { label: 'Delivered', short: 'Delivered', tone: 'ok' },
  problem:    { label: 'Problem reported', short: 'Problem', tone: 'bad' },
  cancelled:  { label: 'Cancelled', short: 'Cancelled', tone: 'idle' },
};
const STEP_OF = { at_supplier: 0, in_warehouse: 0, waiting: 0, assigned: 1, picked_up: 2, on_the_way: 3, problem: 3, delivered: 4, cancelled: -1 };
const STEPS = ['Added', 'Courier', 'Picked up', 'On the way', 'Delivered'];
const FINISHED = new Set(['delivered', 'cancelled']);
const EVENT_TEXT = {
  waiting: 'Delivery added',
  assigned: 'Courier took the job',
  picked_up: 'Courier has the order',
  on_the_way: 'On the way, sharing live location',
  delivered: 'Delivered',
  problem: 'Problem reported',
  cancelled: 'Delivery cancelled',
  unassigned: 'Courier removed',
  returned: 'Courier gave the job back',
  restored: 'Delivery restored',
  at_supplier: 'Ordered from the suppliers',
  in_warehouse: 'Everything is in the warehouse',
  released: 'Packed and ready to go out',
  part_delivered: 'Part of the order is on the ship',
  collected: 'Piece collected',
  trip_cancelled: 'Trip called off',
};
// Orders a company sends (Quayside): the same statuses, worded for a delivery to a ship, in three stages
const ORDER_LABEL = {
  waiting: 'Packed, waiting for a driver', assigned: 'Driver ready to pick it up', picked_up: 'The driver has it',
  on_the_way: 'On the way to the ship', delivered: 'On the ship',
};
const statusOf = d => {
  const st = STATUS[d.status] || STATUS.waiting;
  if (d.kind === 'order' && d.status === 'picked_up') {
    const p = progress(d), label = p.got >= p.of ? 'All pieces collected' : `Collecting: ${p.got} of ${p.of} pieces`;
    return { ...st, label, short: label };
  }
  return d.kind === 'order' && ORDER_LABEL[d.status] ? { ...st, label: ORDER_LABEL[d.status], short: ORDER_LABEL[d.status] } : st;
};
// The driver ticks off each piece of an order as he collects it (at a supplier or at the warehouse)
const isGot = (d, l) => !!(d.collected && d.collected[l.id]);
const openLines = d => (d.lines || []).filter(l => !['pending', 'ship'].includes(l.stage));
const progress = d => { const open = openLines(d); return { got: open.filter(l => isGot(d, l)).length, of: open.length }; };
const DRIVER_AT_WORK = ['assigned', 'picked_up', 'on_the_way', 'problem'];
// Where an order goes back to when nobody is driving it
const restStatus = d => (d.trip ? 'waiting' : (d.stage || 1) >= 2 ? 'in_warehouse' : 'at_supplier');
const ORDER_STEPS = ['With the supplier', 'In the warehouse', 'On the ship'];
const orderStage = d => (d.status === 'delivered' ? 3 : ['picked_up', 'on_the_way', 'problem', 'waiting'].includes(d.status) ? 2 : (d.stage || 1) >= 2 ? 1 : 0);
const released = d => !['at_supplier', 'in_warehouse'].includes(d.status);
const LINE_STAGE = {
  pending: ['Not ordered yet', 'idle'], supplier: ['With the supplier', 'idle'], warehouse: ['In the warehouse', 'sky'],
  packed: ['Packed', 'sky'], collected: ['With the driver', 'live'], on_way: ['On the way', 'live'], ship: ['On the ship', 'ok'],
};
// What a line shows: the driver's tick counts as soon as he makes it
function shownStage(d, l) {
  if (l.stage === 'ship') return 'ship';
  if (isGot(d, l)) return ['on_the_way', 'problem'].includes(d.status) ? 'on_way' : 'collected';
  return l.stage === 'collected' ? 'warehouse' : l.stage;
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/></svg>',
  nav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
};

// ---------- State ----------
const S = {
  user: null,
  profile: null,
  mode: 'customer',
  mine: new Map(),
  jobs: new Map(),
  loaded: { mine: false, jobs: false },
  known: new Map(),
  selected: null,             // { kind: 'delivery' | 'new' | 'edit' | 'join', code? }
  pins: new Map(),
  pendingDelete: new Map(),
  draft: null,
  join: { code: '', preview: null, error: '', busy: false },
  ui: { problemOpen: false, armed: '', pinError: '' },
  sharing: null,
  routes: new Map(),
  unsubs: [],
  pendingJoin: null,
  follow: true,               // keep the courier in view as they move
};
let pendingProfile = null;

// ---------- Globe ----------
const globe = createGlobe($('#map'), {
  onMapClick: handleMapClick,
  onPlaceClick: code => select({ kind: 'delivery', code }, { spin: true }),
  onUserMove: () => { S.follow = false; },  // someone is looking around: stop chasing the courier
});

// ---------- Small helpers ----------
const ms = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : null);
const fmtTime = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDay = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
function when(t) {
  const diff = Math.round((startOfDay(t) - startOfDay(Date.now())) / 864e5);
  const day = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : fmtDay(t);
  return `${day}, ${fmtTime(t)}`;
}
function ago(t) {
  const d = Math.max(0, Date.now() - t);
  if (d < 10 * SEC) return 'just now';
  if (d < MIN) return `${Math.floor(d / SEC)} s ago`;
  if (d < 60 * MIN) return `${Math.floor(d / MIN)} min ago`;
  return `${Math.floor(d / (60 * MIN))} h ago`;
}
const initials = name => (String(name || '').match(/\p{L}+/gu) || ['?']).slice(0, 2).map(w => w[0]).join('').toUpperCase();
function distance(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
function offset(p, meters, deg) {
  const R = 6371e3, rad = Math.PI / 180, d = meters / R, b = deg * rad, lat1 = p.lat * rad, lng1 = p.lng * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / rad, lng: lng2 / rad };
}
const km = m => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10e3 ? 1 : 0)} km`);
const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const randomCode = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), n => ALPHABET[n % ALPHABET.length]).join('');
const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
const cleanCode = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const shareUrl = code => (ROOM
  ? `${location.origin}${location.pathname}?room=${B.room()}${B.testMode ? '&emu' : ''}#join/${code}`
  : `${location.origin}${location.pathname}${location.search}#join/${code}`);
const event = (s, by, extra = {}) => ({ s, at: Date.now(), by, ...extra });

// ---------- Toast and alerts ----------
let toastTimer = 0;
function toast(text, action) {
  const el = $('#toast'), btn = $('#toastAction');
  $('#toastText').textContent = text;
  btn.hidden = !action;
  btn.textContent = action ? action.label : '';
  btn.onclick = action ? () => { el.hidden = true; action.run(); } : null;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6500 : 3500);
}
function alertUser(text) {
  toast(text);
  try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch {}
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Parcel Tracker', { body: text, icon: 'icons/icon-192.png' });
    }
  } catch {}
}
function updateAlertsLabel() {
  const on = 'Notification' in window && Notification.permission === 'granted';
  $('#alertsLabel').textContent = on ? 'Alerts are on' : 'Turn on alerts';
}

// ---------- Auth screens ----------
const AUTH_ERRORS = {
  'auth/invalid-email': "That email address doesn't look right.",
  'auth/missing-password': 'Type your password.',
  'auth/weak-password': 'Use at least 6 characters for the password.',
  'auth/email-already-in-use': 'There is already an account with this email. Sign in instead.',
  'auth/invalid-credential': 'Email or password is wrong.',
  'auth/wrong-password': 'Email or password is wrong.',
  'auth/user-not-found': 'Email or password is wrong.',
  'auth/too-many-requests': 'Too many tries. Wait a minute, then try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/operation-not-allowed': "Accounts aren't open yet. Tap \"Try the demo\" above to test everything now.",
  'auth/configuration-not-found': "Accounts aren't open yet. Tap \"Try the demo\" above to test everything now.",
};
const authMessage = e => AUTH_ERRORS[e && e.code] || 'Something went wrong. Try again in a moment.';
function showError(id, text) { const el = $(id); el.textContent = text; el.hidden = !text; }

function setAuthTab(which) {
  document.querySelectorAll('[data-auth-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.authTab === which)));
  $('#signInForm').hidden = which !== 'in';
  $('#signUpForm').hidden = which !== 'up';
  showError('#inError', ''); showError('#upError', '');
}
document.querySelectorAll('[data-auth-tab]').forEach(b => b.addEventListener('click', () => setAuthTab(b.dataset.authTab)));

$('#signInForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter || $('#signInForm button[type=submit]');
  btn.disabled = true;
  try {
    await B.signIn($('#inEmail').value.trim(), $('#inPassword').value);
  } catch (err) {
    showError('#inError', authMessage(err));
  } finally { btn.disabled = false; }
});

$('#signUpForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#upName').value.trim();
  if (!name) return showError('#upError', 'Type your name so couriers and customers know who you are.');
  const role = new FormData($('#signUpForm')).get('role') || 'customer';
  const btn = e.submitter || $('#signUpForm button[type=submit]');
  btn.disabled = true;
  pendingProfile = { name, phone: $('#upPhone').value.trim().slice(0, 30), role };
  try {
    await B.signUp($('#upEmail').value.trim(), $('#upPassword').value, name);
  } catch (err) {
    pendingProfile = null;
    showError('#upError', authMessage(err));
  } finally { btn.disabled = false; }
});

$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#inEmail').value.trim();
  if (!email) return showError('#inError', 'Type your email above first, then tap "Forgot your password?" again.');
  try {
    await B.resetPassword(email);
    showError('#inError', '');
    toast('If there is an account for that email, a reset link is on its way.');
  } catch (err) { showError('#inError', authMessage(err)); }
});

async function loadProfile(user) {
  try {
    const existing = await B.getProfile(user.uid);
    if (existing) return existing;
  } catch {}
  const profile = pendingProfile || { name: user.displayName || (user.email || 'You').split('@')[0], phone: '', role: 'customer' };
  pendingProfile = null;
  const data = { name: profile.name.slice(0, 60) || 'You', phone: profile.phone || '', role: profile.role, createdAt: B.now(), updatedAt: B.now() };
  try { await B.saveProfile(user.uid, data); } catch {}
  return data;
}

B.onAuth(async user => {
  $('#boot').hidden = true;
  endSession();
  S.user = user;
  if (!user) {
    $('#appScreen').hidden = true;
    $('#authScreen').hidden = false;
    updateInsets();
    globe.showEarth();
    return;
  }
  $('#authScreen').hidden = true;
  S.profile = await loadProfile(user);
  if (S.user !== user) return;
  S.mode = store.get(`pt.mode.${user.uid}`, S.profile.role || 'customer');
  $('#appScreen').hidden = false;
  renderChrome();
  updateInsets();
  subscribe();
  if (!openFromHash()) renderAll();
});

function endSession() {
  stopSharing();
  S.unsubs.forEach(u => u());
  S.unsubs = [];
  S.mine = new Map(); S.jobs = new Map();
  S.loaded = { mine: false, jobs: false };
  S.known = new Map(); S.pins = new Map(); S.routes = new Map();
  S.selected = null; S.draft = null;
  S.join = { code: '', preview: null, error: '', busy: false };
  for (const t of S.pendingDelete.values()) clearTimeout(t.timer);
  S.pendingDelete = new Map();
  globe.stopPick(); globe.setDestination(null); globe.setCourier(null); globe.setRoute(null); globe.setPlaces([]);
  closeMenu();
}

// ---------- Data ----------
function subscribe() {
  const uid = S.user.uid;
  const toMap = list => new Map(list.map(d => [d.code, d]));
  const fail = () => toast("Couldn't load your deliveries. Check your connection.");
  S.unsubs.push(B.watch('ownerUid', uid, list => { S.mine = toMap(list); onData('mine'); }, fail));
  S.unsubs.push(B.watch('courierUid', uid, list => {
    const before = S.jobs;
    S.jobs = toMap(list);
    if (S.loaded.jobs) for (const [code, d] of before) if (!S.jobs.has(code) && !S.mine.has(code)) alertUser(`${d.item}: the customer took you off this delivery`);
    onData('jobs');
  }, fail));
}

function onData(which) {
  const map = which === 'mine' ? S.mine : S.jobs;
  const first = !S.loaded[which];
  S.loaded[which] = true;
  for (const d of map.values()) {
    const key = `${which}:${d.code}`;
    const prev = S.known.get(key);
    S.known.set(key, d.status);
    if (first || !prev || prev === d.status) continue;
    const last = d.events && d.events[d.events.length - 1];
    if (last && last.by === (which === 'mine' ? 'customer' : 'courier')) continue; // only news from the other side
    alertUser(`${d.item}: ${statusOf(d).label}`);
  }
  if (which === (S.mode === 'customer' ? 'mine' : 'jobs')) {
    if (first && !S.selected) {
      const pick = defaultPick();
      if (pick) { select({ kind: 'delivery', code: pick }, { spin: true }); return; }
    }
    // A link like #d/CODE was opened before the data arrived: fly there now
    const arrived = first && S.selected && S.selected.kind === 'delivery' && !!currentDelivery();
    if (S.selected && S.selected.kind === 'delivery' && !currentDelivery()) S.selected = null;
    renderTabs();
    refreshPanel();
    updateMap({ spin: arrived });
  }
}

function sortedList() {
  const map = S.mode === 'customer' ? S.mine : S.jobs;
  const hidden = S.mode === 'courier' ? new Set(store.get(`pt.hiddenJobs.${S.user.uid}`, [])) : new Set();
  return [...map.values()]
    .filter(d => !S.pendingDelete.has(d.code) && !hidden.has(d.code))
    .sort((a, b) => (FINISHED.has(a.status) - FINISHED.has(b.status)) || ((ms(b.createdAt) || Date.now()) - (ms(a.createdAt) || Date.now())));
}
function currentDelivery() {
  if (!S.selected || S.selected.kind !== 'delivery') return null;
  const d = (S.mode === 'customer' ? S.mine : S.jobs).get(S.selected.code);
  return d && !S.pendingDelete.has(d.code) ? d : null;
}
const toneOf = d => (STATUS[d.status] || STATUS.waiting).tone;

// ---------- Selection ----------
function select(sel, { spin = false } = {}) {
  const leavingForm = S.selected && ['new', 'edit'].includes(S.selected.kind) && !(sel && ['new', 'edit'].includes(sel.kind));
  if (leavingForm) globe.stopPick();
  S.selected = sel;
  S.ui = { problemOpen: false, armed: '', pinError: '' };
  if (sel && sel.kind === 'delivery') store.set(`pt.sel.${S.user.uid}.${S.mode}`, sel.code);
  try { history.replaceState(null, '', sel && sel.kind === 'delivery' ? `#d/${sel.code}` : `${location.pathname}${location.search}`); } catch {}
  renderTabs();
  renderPanel();
  if (sel && ['new', 'edit'].includes(sel.kind)) startPicking();
  else updateMap({ spin });
}

function setMode(mode) {
  if (mode === S.mode) return;
  S.mode = mode;
  store.set(`pt.mode.${S.user.uid}`, mode);
  renderChrome();
  const pick = defaultPick();
  select(pick ? { kind: 'delivery', code: pick } : null, { spin: true });
}

// What to open first: the last one you looked at, else one on its way, else the newest unfinished one
function defaultPick() {
  const map = S.mode === 'customer' ? S.mine : S.jobs;
  const remembered = store.get(`pt.sel.${S.user.uid}.${S.mode}`, null);
  if (remembered && map.has(remembered) && !S.pendingDelete.has(remembered)) return remembered;
  const list = sortedList();
  const moving = list.find(d => d.status === 'on_the_way');
  if (moving) return moving.code;
  return list[0] && !FINISHED.has(list[0].status) ? list[0].code : null;
}

// ---------- Rendering: chrome and tabs ----------
function renderChrome() {
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
  $('#avatarBtn').textContent = initials(S.profile && S.profile.name);
  $('#menuName').textContent = S.profile ? S.profile.name : '';
  $('#menuEmail').textContent = S.user ? S.user.email : '';
  updateAlertsLabel();
}

function renderTabs() {
  const tabs = $('#tabs');
  const sel = S.selected;
  const items = sortedList().map(d => {
    const tone = toneOf(d);
    const selected = sel && sel.kind === 'delivery' && sel.code === d.code;
    const cls = ['tab', `tone-${tone}`, d.status === 'on_the_way' ? 'live' : '', FINISHED.has(d.status) ? 'done' : ''].join(' ');
    return `<button class="${cls}" type="button" role="tab" aria-selected="${selected}" data-open="${esc(d.code)}" title="${esc(d.item)}: ${esc(statusOf(d).short)}"><span class="dot"></span><span class="name">${esc(d.item)}</span></button>`;
  });
  const addSel = sel && (S.mode === 'customer' ? sel.kind === 'new' : sel.kind === 'join');
  items.push(S.mode === 'customer'
    ? `<button class="tab add" type="button" role="tab" aria-selected="${!!addSel}" data-act="new">${ICON.plus}Add delivery</button>`
    : `<button class="tab add" type="button" role="tab" aria-selected="${!!addSel}" data-act="join">${ICON.plus}Take a job</button>`);
  tabs.innerHTML = items.join('');
  const active = tabs.querySelector('[aria-selected="true"]');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------- Rendering: the panel ----------
function renderPanel() {
  const body = $('#panelBody');
  const saved = {};
  body.querySelectorAll('input[id], textarea[id]').forEach(el => { saved[el.id] = el.value; });
  const focusId = body.contains(document.activeElement) && document.activeElement.id ? document.activeElement.id : null;
  const view = S.selected ? `${S.mode}:${S.selected.kind}:${S.selected.code || ''}` : `${S.mode}:none`;
  const scroll = view === renderPanel.view ? body.scrollTop : 0; // a new view starts at the top
  renderPanel.view = view;
  renderPanel.sig = panelSignature();
  body.innerHTML = panelHtml();
  for (const [id, v] of Object.entries(saved)) {
    const el = body.querySelector(`#${CSS.escape(id)}`);
    if (el && v && !el.value) el.value = v;
  }
  if (focusId) { const el = body.querySelector(`#${CSS.escape(focusId)}`); if (el) el.focus({ preventScroll: true }); }
  body.scrollTop = scroll;
  if (S.selected && S.selected.kind === 'delivery' && S.mode === 'customer') loadPin(S.selected.code);
}
// Data changed: re-render details, but never wipe a form someone is typing in
function refreshPanel() {
  if (S.selected && ['new', 'edit'].includes(S.selected.kind)) return;
  if (S.selected && S.selected.kind === 'join') { if (!S.join.preview) return; }
  // Location updates arrive every few seconds; only redraw the live parts for those,
  // so a courier typing the PIN isn't interrupted
  if (panelSignature() === renderPanel.sig) return updateLiveParts();
  renderPanel();
}
// Everything that changes the panel's layout (but not the live numbers)
function panelSignature() {
  const d = currentDelivery();
  const loc = d && liveLocation(d);
  const sh = S.sharing;
  return JSON.stringify([
    S.mode, S.selected, S.ui, S.join.busy, S.join.error, S.join.preview && S.join.preview.code,
    d && [d.status, d.courierUid, d.courierName, d.courierPhone, (d.events || []).length, d.problem, d.item, d.from,
      d.address, d.notes, d.destLabel, d.ownerPhone, ms(d.deliveredAt), d.demoDrive, S.pins.get(d.code), d.kind, d.trip && d.trip.ref, JSON.stringify(d.lines || []), JSON.stringify(d.collected || {})],
    !!loc, !!(loc && Date.now() - loc.at > 90 * SEC),
    sh && [sh.code, sh.demo, sh.error, !!sh.lastSent],
  ]);
}
function updateLiveParts() {
  const d = currentDelivery();
  if (!d) return;
  const live = $('#liveSlot');
  if (live) { const loc = liveLocation(d); live.innerHTML = loc ? liveCardHtml(d, loc) : ''; }
  const share = $('#shareSlot');
  if (share && !share.contains(document.activeElement)) share.innerHTML = shareHtml(d);
}
function renderAll() { renderTabs(); renderPanel(); updateMap({ spin: true }); }

function panelHtml() {
  const sel = S.selected;
  if (sel && sel.kind === 'new') return formHtml(false);
  if (sel && sel.kind === 'edit') return formHtml(true);
  if (sel && sel.kind === 'join') return joinHtml();
  const d = currentDelivery();
  if (d) return S.mode === 'customer' ? customerHtml(d) : courierHtml(d);
  return emptyHtml();
}

function emptyHtml() {
  const any = sortedList().length > 0;
  if (S.mode === 'customer') {
    return `<div class="empty">
      <h2>${any ? 'Pick a delivery' : 'Nothing on its way yet'}</h2>
      <p class="muted">${any ? 'Choose a tab above, or tap a dot on the Earth to fly to it.' : 'Add something you are waiting for. You get a code to send to whoever delivers it, and you can watch them come to your door.'}</p>
      <button class="btn btn-primary" type="button" data-act="new">${ICON.plus}Add a delivery</button>
    </div>`;
  }
  return `<div class="empty">
    <h2>${any ? 'Pick a job' : 'No jobs yet'}</h2>
    <p class="muted">${any ? 'Choose a tab above to see the next step.' : 'Ask the customer for their 8-character delivery code, or open the link they sent you.'}</p>
    <button class="btn btn-primary" type="button" data-act="join">${ICON.plus}Take a job</button>
  </div>`;
}

function stepsHtml(d) {
  if (d.kind === 'order') {
    const at = orderStage(d);
    return `<ol class="steps three tone-${toneOf(d)}" aria-label="Where the order is">${ORDER_STEPS.map((label, i) => {
      const cls = at === 3 ? (i < 2 ? 'done' : 'now') : i < at ? 'done' : i === at ? 'now' : '';
      const sub = i === 2 && at === 2 ? `<span class="sub">${esc(statusOf(d).label)}</span>` : '';
      return `<li class="${cls}"${i === Math.min(at, 2) ? ' aria-current="step"' : ''}><span class="node"></span><span>${label}</span>${sub}</li>`;
    }).join('')}</ol>`;
  }
  const at = STEP_OF[d.status] ?? 0;
  const tone = toneOf(d);
  return `<ol class="steps tone-${tone}" aria-label="Progress">${STEPS.map((label, i) => {
    const cls = d.status === 'delivered' ? (i < 4 ? 'done' : 'now') : i < at ? 'done' : i === at ? 'now' : '';
    return `<li class="${cls}"${i === at ? ' aria-current="step"' : ''}><span class="node"></span><span>${label}</span></li>`;
  }).join('')}</ol>`;
}

function liveLocation(d) {
  if (S.sharing && S.sharing.code === d.code && S.sharing.lastPos && S.mode === 'courier') return S.sharing.lastPos;
  if (d.courierLoc && ['on_the_way', 'problem', 'picked_up'].includes(d.status)) return d.courierLoc;
  return null;
}

function etaHtml(d, loc) {
  const r = S.routes.get(d.code);
  const along = r && alongRoute(r.coords, loc);
  const onRoute = along && along.off < 200;
  const meters = onRoute ? along.remaining : distance(loc, d.dest) * 1.35;
  const secs = onRoute ? r.duration * (r.fixed ? 1 : 1.2) * (along.remaining / Math.max(1, r.distance)) : (meters / 1000) / 22 * 3600;
  if (meters < 60) return { big: 'At your door', line: 'The courier is right outside.' };
  const min = Math.max(1, Math.round(secs / 60));
  return { big: `About ${min} min away`, line: `${km(meters)} ${r && r.fixed ? 'to go' : 'by road'}` };
}

function liveCardHtml(d, loc) {
  if (!loc) return '';
  const stale = Date.now() - loc.at > 90 * SEC;
  const eta = etaHtml(d, loc);
  return `<div class="live-card">
    <span class="live-badge">${stale ? 'Last known position' : 'Live'}</span>
    <div class="big">${esc(eta.big)}</div>
    <p class="${stale ? 'stale' : 'muted'} small">${esc(eta.line)} · updated <span data-ago="${loc.at}">${ago(loc.at)}</span>${loc.acc ? ` · ±${Math.round(loc.acc)} m` : ''}</p>
    ${stale ? '<p class="small stale">No update for a while. The courier may have closed the app or lost signal.</p>' : ''}
    ${d.demoDrive ? '<p class="small muted">Demo drive: this position is simulated.</p>' : ''}
  </div>`;
}

function timelineHtml(d) {
  const evs = (d.events || []).slice().reverse();
  if (!evs.length) return '';
  return `<section class="head"><p class="label">History</p><ol class="timeline">${evs.map(e => `
    <li><time datetime="${new Date(e.at).toISOString()}">${esc(when(e.at))}</time><span class="rail" aria-hidden="true"></span>
    <div><strong>${esc(EVENT_TEXT[e.kind] || EVENT_TEXT[e.s] || e.s)}</strong>${e.note ? `<p class="small muted">${esc(e.note)}</p>` : ''}<p class="small muted">${e.by === 'courier' ? (d.kind === 'order' ? 'By the driver' : 'By the courier') : e.by === 'company' ? `By ${esc(d.from || 'the company')}` : 'By the customer'}</p></div></li>`).join('')}</ol></section>`;
}

// What is in an order, line by line, and where each line is
const fmtQty = n => (Number.isFinite(+n) ? String(+(+n).toFixed(2)) : String(n || ''));
function contentsHtml(d) {
  const lines = d.lines || [];
  if (!lines.length) return '';
  const p = progress(d), working = d.courierUid && DRIVER_AT_WORK.includes(d.status);
  return `<section class="card contents">
    <div class="contents-head"><p class="label">What is in it</p><span class="small muted">${working && p.of ? `${p.got} of ${p.of} collected by ${esc(d.courierName || 'the driver')}` : `${lines.length} ${lines.length === 1 ? 'item' : 'items'}`}</span></div>
    ${working && p.of ? `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${p.of}" aria-valuenow="${p.got}"><span style="width:${Math.round((p.got / p.of) * 100)}%"></span></div>` : ''}
    <ul class="lines">${lines.map(l => {
      const [lab, tone] = LINE_STAGE[shownStage(d, l)] || ['', 'idle'];
      return `<li><span class="qty mono">${esc(fmtQty(l.qty))} ${esc(l.unit || '')}</span><span class="what">${esc(l.desc)}</span>${lab ? `<span class="chip tone-${tone}">${lab}</span>` : ''}</li>`;
    }).join('')}</ul>
  </section>`;
}
function stageNote(d) {
  if (d.kind !== 'order') return '';
  const who = d.courierName || 'The driver';
  const p = progress(d);
  const text = {
    at_supplier: 'The pieces are with the suppliers. A driver collects them and brings them to you.',
    in_warehouse: 'Everything is in the warehouse. A driver collects it and brings it to you.',
    waiting: 'Packed and ready. Waiting for a driver to take it.',
    assigned: `${who} took the job and will collect the pieces. You see each one ticked off here.`,
    picked_up: p.got >= p.of ? `${who} has every piece. You see them on the map once they set off.` : `${who} is collecting the pieces: ${p.got} of ${p.of} so far.`,
  }[d.status];
  return text ? `<p class="stage-note">${esc(text)}</p>` : '';
}

function factsHtml(d, forCourier) {
  const rows = [
    ['Deliver to', d.destLabel || `${d.dest.lat.toFixed(5)}, ${d.dest.lng.toFixed(5)}`, true],
    forCourier && d.pickup ? ['Pick it up at', d.pickup.label, true] : null,
    d.address ? ['Address details', d.address, true] : null,
    d.notes ? ['Notes for the courier', d.notes, true] : null,
    d.from ? ['From', d.source && d.source.ref ? `${d.from} (${d.source.ref})` : d.from] : null,
    d.receivedBy && d.status === 'delivered' ? ['Received by', d.receivedBy] : null,
    ['Added', when(ms(d.createdAt) || Date.now())],
    forCourier ? ['Customer', d.ownerName || 'Customer'] : null,
  ].filter(Boolean);
  return `<dl class="facts">${rows.map(([k, v, full]) => `<div class="${full ? 'full' : ''}"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function armed(key, label, armedLabel) { return S.ui.armed === key ? armedLabel : label; }

function customerHtml(d) {
  const st = statusOf(d);
  const order = d.kind === 'order';
  const loc = liveLocation(d);
  const pin = S.pins.get(d.code);
  const finished = FINISHED.has(d.status);
  const courier = d.courierUid
    ? `<div class="card"><div class="card-row"><span class="face" aria-hidden="true">${esc(initials(d.courierName))}</span><div><strong>${esc(d.courierName || 'Your courier')}</strong><p class="small muted">Your courier${d.courierPhone ? ` · <span class="mono">${esc(d.courierPhone)}</span>` : ''}</p></div>
        ${d.courierPhone ? `<a class="btn" href="tel:${esc(d.courierPhone.replace(/[^+\d]/g, ''))}">${ICON.phone}Call</a>` : ''}</div></div>`
    : finished ? '' : `<div class="card">
        <p class="label">${order ? 'Send this link to the driver' : 'Send this code to your courier'}</p>
        <div class="code" aria-label="Delivery code ${esc(d.code.split('').join(' '))}">${esc(d.code)}</div>
        <div class="actions"><button class="btn btn-primary" type="button" data-act="share-code">${ICON.share}Share link</button><button class="btn" type="button" data-act="${ROOM ? 'copy-link' : 'copy-code'}">${ICON.copy}${ROOM ? 'Copy link' : 'Copy code'}</button></div>
        <p class="small muted">${ROOM
          ? 'They open the link on their phone, type their name and take the job. When they press "On my way", you see them moving on the map.'
          : 'They open the link, sign in as a courier, and take the job. Then you can watch them on the map.'}</p>
        ${DEMO ? `<p class="small" style="color: var(--sky)">Demo: be the courier yourself. Switch to <strong>Courier</strong> at the top, tap <strong>Take a job</strong> and type <span class="mono">${esc(d.code)}</span>.</p>` : ''}
      </div>`;
  const pinCard = !finished ? `<div class="card">
      <p class="label">Delivery PIN</p>
      <div class="pin-digits" aria-label="PIN ${pin ? pin.split('').join(' ') : 'loading'}">${(pin || '····').split('').map(c => `<span>${esc(c)}</span>`).join('')}</div>
      <p class="small muted">Tell the courier this PIN only when the parcel is in your hands. They need it to mark the delivery as done.</p>
    </div>` : '';
  const problem = d.status === 'problem' && d.problem ? `<div class="card tone-bad" style="border-color: rgba(255,107,94,.45)"><p class="label" style="color: var(--bad)">The courier reported a problem</p><p>${esc(d.problem)}</p></div>` : '';
  const actions = [];
  if (!finished && order) {
    if (d.courierUid) actions.push(`<button class="btn btn-plain" type="button" data-act="unassign">${armed('unassign', 'Remove the driver', 'Tap again to remove')}</button>`);
  } else if (!finished) {
    actions.push(`<button class="btn" type="button" data-act="edit">Edit details</button>`);
    actions.push(`<button class="btn btn-ok" type="button" data-act="received">${ICON.check}I got it</button>`);
    if (d.courierUid) actions.push(`<button class="btn btn-plain" type="button" data-act="unassign">${armed('unassign', 'Remove the courier', 'Tap again to remove')}</button>`);
    actions.push(`<button class="btn btn-danger" type="button" data-act="cancel">${armed('cancel', 'Cancel delivery', 'Tap again to cancel')}</button>`);
  } else {
    if (d.status === 'cancelled') actions.push(`<button class="btn" type="button" data-act="restore">Restore delivery</button>`);
    actions.push(`<button class="btn btn-danger" type="button" data-act="delete">Delete</button>`);
  }
  return `
    <div class="head">
      <p class="eyebrow">${d.from ? `<span>From ${esc(d.from)}</span>` : ''}<span class="mono">${esc(d.code)}</span></p>
      <h1 class="title">${esc(d.item)}</h1>
      <span class="pill tone-${st.tone}">${esc(st.label)}</span>
    </div>
    ${d.status === 'on_the_way' && !loc ? '<p class="small muted">On the way. Waiting for the courier\'s first location.</p>' : ''}
    ${['on_the_way', 'problem'].includes(d.status) ? `<div id="liveSlot">${loc ? liveCardHtml(d, loc) : ''}</div>` : ''}
    ${d.status === 'delivered' ? `<div class="card" style="border-color: rgba(76,211,138,.45)"><p class="label" style="color: var(--ok)">Delivered</p><p>${d.deliveredAt ? esc(when(ms(d.deliveredAt))) : 'Done'}${d.courierName ? ` by ${esc(d.courierName)}` : ''}.</p></div>` : ''}
    ${problem}
    ${d.status !== 'cancelled' ? stepsHtml(d) : ''}
    ${stageNote(d)}
    ${order ? contentsHtml(d) : ''}
    ${courier}
    ${pinCard}
    ${order ? '' : contentsHtml(d)}
    ${factsHtml(d, false)}
    <div class="actions">${actions.join('')}</div>
    <hr>
    ${timelineHtml(d)}`;
}

function shareHtml(d) {
  const sharingThis = S.sharing && S.sharing.code === d.code;
  if (d.status === 'on_the_way' || d.status === 'problem') {
    if (sharingThis) {
      const sh = S.sharing;
      return `<div class="share-state">
        <span class="live-badge">${sh.demo ? 'Demo drive' : 'Sharing your location'}</span>
        ${sh.error ? `<p class="small" style="color: var(--bad)">${esc(sh.error)}</p>` : sh.lastSent ? `<p class="small muted">Last sent <span data-ago="${sh.lastSent}">${ago(sh.lastSent)}</span>${sh.lastPos && sh.lastPos.acc ? ` · ±${Math.round(sh.lastPos.acc)} m` : ''}</p>` : '<p class="small muted">Finding your location…</p>'}
        <p class="small muted">${sh.demo ? 'Your position is simulated along a real route, sped up.' : 'Keep this screen open. Phones stop sharing location when the app is closed or the screen locks.'}</p>
        <div class="actions"><button class="btn" type="button" data-act="stop-share">Pause sharing</button></div>
      </div>`;
    } else {
      return `<div class="share-state">
        <p class="small">Your location isn't being shared right now.</p>
        <div class="actions"><button class="btn btn-primary" type="button" data-act="share-gps">${ICON.locate}Share my location</button><button class="btn" type="button" data-act="demo-drive">Demo drive</button></div>
      </div>`;
    }
  }

  return '';
}

// The pieces to collect, grouped by where to get them
function collectListHtml(d, canTick) {
  const groups = new Map();
  for (const l of (d.lines || []).filter(x => x.stage !== 'ship')) {
    const key = l.stage === 'pending' ? 'Not ordered yet' : (l.from && l.from.label) || 'At the warehouse';
    if (!groups.has(key)) groups.set(key, { from: l.stage === 'pending' ? null : l.from, lines: [] });
    groups.get(key).lines.push(l);
  }
  return [...groups].map(([label, g]) => {
    const got = g.lines.filter(l => isGot(d, l)).length;
    const dir = g.from && Number.isFinite(g.from.lat) ? `https://www.google.com/maps/dir/?api=1&destination=${g.from.lat},${g.from.lng}` : '';
    return `<div class="pickup">
      <div class="pickup-head"><span><strong>${esc(label)}</strong><span class="small muted"> · ${got} of ${g.lines.length}</span></span>${dir ? `<a class="btn btn-plain small-btn" href="${dir}" target="_blank" rel="noopener">${ICON.nav}Directions</a>` : ''}</div>
      <ul class="pieces">${g.lines.map(l => {
        const on = isGot(d, l), able = canTick && l.stage !== 'pending';
        return `<li><button type="button" class="piece${on ? ' got' : ''}" data-act="piece" data-id="${esc(l.id)}" aria-pressed="${on}" ${able ? '' : 'disabled'}>
          <span class="box" aria-hidden="true">${ICON.check}</span><span class="qty mono">${esc(fmtQty(l.qty))} ${esc(l.unit || '')}</span><span class="what">${esc(l.desc)}</span></button></li>`;
      }).join('')}</ul></div>`;
  }).join('');
}
function orderCourierHtml(d, check, pinForm, shareBlock) {
  const p = progress(d), moving = ['on_the_way', 'problem'].includes(d.status), done = d.status === 'delivered';
  const collecting = !moving && !done && d.status !== 'cancelled';
  const left = p.of - p.got;
  return `<ol class="checks" aria-label="Delivery checklist">
    ${check(true, false, 'Job taken', d.events ? `You took it ${esc(when((d.events.find(e => e.s === 'assigned') || {}).at || Date.now()))}` : '')}
    ${check(p.of > 0 && p.got >= p.of, collecting, `Collect the pieces · ${p.got} of ${p.of}`,
      collecting ? (p.got >= p.of ? 'You have every piece.' : 'Tick each piece when it is in your hands. The customer sees it right away.') : `${p.got} of ${p.of} collected`,
      collectListHtml(d, collecting))}
    ${check(moving || done, collecting && p.got > 0, 'On my way to the ship',
      moving ? 'The customer can see you on their map.' : collecting && p.got > 0 ? `Starts sharing your live location.${left > 0 ? ` ${left} ${left === 1 ? 'piece is' : 'pieces are'} not collected yet; they stay for a later trip.` : ''}` : 'Collect at least one piece first.',
      `<button class="btn btn-primary" type="button" data-act="start">${ICON.nav}On my way</button><button class="btn" type="button" data-act="start-demo">Start a demo drive</button>`)}
    ${shareBlock ? `<li id="shareSlot">${shareBlock}</li>` : ''}
    ${check(done, moving, 'Delivered', done ? `Done ${d.deliveredAt ? esc(when(ms(d.deliveredAt))) : ''}` : 'Ask the ship for their PIN when you hand it over.', pinForm)}
  </ol>`;
}

function courierHtml(d) {
  const st = statusOf(d);
  const order = d.kind === 'order';
  const at = STEP_OF[d.status] ?? 1;
  const check = (done, now, title, sub, act = '') => `<li class="check${done ? ' done' : ''}${now ? ' now' : ''}">
      <span class="box" aria-hidden="true">${ICON.check}</span>
      <div><strong>${title}</strong>${sub ? `<p class="small muted">${sub}</p>` : ''}${now && act ? `<div class="act">${act}</div>` : ''}</div>
      <span class="sr-only">${done ? 'Done' : now ? 'Next step' : 'Not yet'}</span></li>`;

  const shareBlock = shareHtml(d);

  const demoPin = DEMO && B.peekPin(d.code);
  const pinForm = `<form class="act" data-form="pin" novalidate>
      ${demoPin ? `<p class="small" style="color: var(--sky)">Demo: the customer's PIN is <span class="mono">${esc(demoPin)}</span>.</p>` : ''}
      <div class="field"><label for="pinInput">Customer's 4-digit PIN</label><input id="pinInput" class="mono" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="0000" style="font-size: 22px; letter-spacing: .4em"></div>
      ${S.ui.pinError ? `<p class="error" id="pinError" role="alert">${esc(S.ui.pinError)}</p>` : ''}
      <button class="btn btn-ok" type="submit">${ICON.check}Confirm delivery</button>
    </form>`;

  const finished = FINISHED.has(d.status);
  const checks = order ? orderCourierHtml(d, check, pinForm, shareBlock) : `<ol class="checks" aria-label="Delivery checklist">
    ${check(true, false, 'Job taken', d.events ? `You took it ${esc(when((d.events.find(e => e.s === 'assigned') || {}).at || Date.now()))}` : '')}
    ${check(at > 1, d.status === 'assigned', 'I have the order', d.status === 'assigned' ? 'Tick this when the parcel is in your hands.' : '', `<button class="btn btn-primary" type="button" data-act="picked">${ICON.check}I have the order</button>`)}
    ${check(['on_the_way', 'problem', 'delivered'].includes(d.status), d.status === 'picked_up', 'On my way', d.status === 'picked_up' ? 'Starts sharing your live location with the customer.' : d.status === 'on_the_way' ? 'The customer can see you on their map.' : '', `<button class="btn btn-primary" type="button" data-act="start">${ICON.nav}Start delivery</button><button class="btn" type="button" data-act="start-demo">Start a demo drive</button>`)}
    ${shareBlock ? `<li id="shareSlot">${shareBlock}</li>` : ''}
    ${check(d.status === 'delivered', d.status === 'on_the_way' || d.status === 'problem', 'Delivered', d.status === 'delivered' ? `Done ${d.deliveredAt ? esc(when(ms(d.deliveredAt))) : ''}` : 'Ask the customer for their PIN when you hand it over.', pinForm)}
  </ol>`;

  const nav = `https://www.google.com/maps/dir/?api=1&destination=${d.dest.lat},${d.dest.lng}`;
  const apple = `https://maps.apple.com/?daddr=${d.dest.lat},${d.dest.lng}`;
  const problem = !finished ? (S.ui.problemOpen
    ? `<form class="card" data-form="problem" novalidate>
        <div class="field"><label for="problemText">What's wrong?</label><textarea id="problemText" maxlength="300" placeholder="Nobody answers the door, wrong address, …"></textarea></div>
        <div class="actions"><button class="btn" type="button" data-act="problem-close">Never mind</button><button class="btn btn-primary" type="submit">Tell the customer</button></div>
      </form>`
    : d.status === 'problem'
      ? `<div class="card"><p class="label" style="color: var(--bad)">You reported a problem</p><p>${esc(d.problem || '')}</p><div class="actions"><button class="btn" type="button" data-act="resolved">It's sorted, carry on</button></div></div>`
      : `<button class="btn btn-plain" type="button" data-act="problem-open">Report a problem</button>`) : '';

  return `
    <div class="head">
      <p class="eyebrow"><span>For ${esc(d.ownerName || 'customer')}</span><span class="mono">${esc(d.code)}</span></p>
      <h1 class="title">${esc(d.item)}</h1>
      <span class="pill tone-${st.tone}">${esc(st.label)}</span>
    </div>
    ${d.status === 'cancelled' ? '<p class="error">The customer cancelled this delivery.</p>' : ''}
    ${checks}
    ${order ? '' : contentsHtml(d)}
    <div class="actions">
      <a class="btn" href="${nav}" target="_blank" rel="noopener">${ICON.nav}${order ? 'To the ship: Google Maps' : 'Google Maps'}</a>
      <a class="btn" href="${apple}" target="_blank" rel="noopener">${ICON.nav}Apple Maps</a>
      ${d.ownerPhone ? `<a class="btn" href="tel:${esc(d.ownerPhone.replace(/[^+\d]/g, ''))}">${ICON.phone}Call customer</a>` : ''}
    </div>
    ${factsHtml(d, true)}
    ${problem}
    <div class="actions">
      ${!finished ? `<button class="btn btn-danger" type="button" data-act="give-back">${armed('give-back', 'Give this job back', 'Tap again to give it back')}</button>` : `<button class="btn btn-plain" type="button" data-act="hide-job">Remove from my list</button>`}
    </div>
    <hr>
    ${timelineHtml(d)}`;
}

function joinHtml() {
  const j = S.join;
  const p = j.preview;
  return `
    <div class="head"><h1 class="title">Take a delivery job</h1><p class="muted">Type the 8-character code the customer sent you.</p></div>
    <form data-form="join" class="row" novalidate style="align-items: flex-end">
      <div class="field" style="flex: 2 1 180px"><label for="joinCode">Delivery code</label><input id="joinCode" class="mono" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="12" placeholder="AB3K7Q2M" value="${esc(j.code)}" style="font-size: 20px; letter-spacing: .14em; text-transform: uppercase"></div>
      <button class="btn btn-primary" type="submit" ${j.busy ? 'disabled' : ''}>Find job</button>
    </form>
    ${j.error ? `<p class="error">${esc(j.error)}</p>` : ''}
    ${p ? `<div class="card">
      <p class="label">Job ${esc(p.code)}</p>
      <strong style="font-size: 20px">${esc(p.item)}</strong>
      ${factsHtml(p, true)}
      ${contentsHtml(p)}
      ${ROOM ? `<div class="field"><label for="joinName">Your name</label><input id="joinName" maxlength="60" autocomplete="name" placeholder="The company and the customer see it" value="${esc(S.profile && S.profile.name !== 'Guest' ? S.profile.name : '')}"></div>
      <div class="field"><label for="joinPhone">Your phone (optional)</label><input id="joinPhone" type="tel" maxlength="30" autocomplete="tel" value="${esc((S.profile && S.profile.phone) || '')}"></div>` : ''}
      <button class="btn btn-primary" type="button" data-act="claim" ${j.busy ? 'disabled' : ''}>${ICON.check}Take this job</button>
    </div>` : ''}`;
}

function formHtml(editing) {
  const f = S.draft;
  return `
    <div class="head"><h1 class="title">${editing ? 'Edit delivery' : 'Add a delivery'}</h1>${editing ? '' : '<p class="muted">What are you waiting for, and where should it arrive?</p>'}</div>
    <form data-form="delivery" class="head" style="gap: 14px" novalidate>
      <div class="field"><label for="fItem">What is coming?</label><input id="fItem" maxlength="80" placeholder="Running shoes" value="${esc(f.item)}" required></div>
      <div class="field"><label for="fFrom">From (optional)</label><input id="fFrom" maxlength="80" placeholder="Shop or sender" value="${esc(f.from)}"></div>
      <div class="field">
        <span class="label">Delivery spot</span>
        <div id="spot">${spotHtml()}</div>
        <div class="row">
          <button class="btn" type="button" data-act="use-location">${ICON.locate}Use my location</button>
        </div>
        <div class="row" style="align-items: flex-end">
          <div class="field" style="flex: 3 1 180px"><label for="fSearch" class="sr-only">Search an address</label><input id="fSearch" placeholder="Search an address or place" autocomplete="off"></div>
          <button class="btn" type="button" data-act="search" style="flex: 1 1 90px">Search</button>
        </div>
        <ul class="results" id="results"></ul>
      </div>
      <div class="field"><label for="fAddress">Address details (optional)</label><input id="fAddress" maxlength="160" placeholder="Building 12, 3rd floor, flat 7" value="${esc(f.address)}"></div>
      <div class="field"><label for="fNotes">Notes for the courier (optional)</label><textarea id="fNotes" maxlength="300" placeholder="Ring twice. Leave it with the doorman if I don't answer.">${esc(f.notes)}</textarea></div>
      <div class="field"><label for="fPhone">Your phone (optional)</label><input id="fPhone" type="tel" maxlength="30" value="${esc(f.phone)}"><span class="hint">So the courier can call you.</span></div>
      <p class="error" id="formError" hidden></p>
      <div class="actions"><button class="btn" type="button" data-act="form-cancel">Cancel</button><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Add delivery'}</button></div>
    </form>`;
}
function spotHtml() {
  const f = S.draft;
  if (!f || !f.dest) return `<p class="spot">${ICON.pin}<span>Tap the Earth to drop a pin. It spins over and zooms in so you can place it exactly. You can also search, or use your location.</span></p>`;
  return `<p class="spot set">${ICON.pin}<span><strong>${esc(f.destLabel || 'Pinned spot')}</strong><br><span class="small muted mono">${f.dest.lat.toFixed(5)}, ${f.dest.lng.toFixed(5)}</span><br><span class="small muted">Drag the pin or tap the map to move it.</span></span></p>`;
}

// ---------- The map follows the selection ----------
function updateMap({ spin = false } = {}) {
  if (!S.user) return;
  const d = currentDelivery();
  globe.setPlaces(sortedList().filter(x => x.dest && (!d || x.code !== d.code)).map(x => ({ code: x.code, lng: x.dest.lng, lat: x.dest.lat, label: x.item, tone: toneOf(x) })));
  if (S.selected && ['new', 'edit'].includes(S.selected.kind)) return;
  if (!d) {
    globe.setDestination(null); globe.setCourier(null); globe.setRoute(null);
    if (spin) globe.showEarth();
    return;
  }
  globe.setDestination(d.dest);
  const loc = liveLocation(d);
  globe.setCourier(loc, loc ? finite(loc.heading) : null);
  if (loc && d.status !== 'delivered') ensureRoute(d, loc); else globe.setRoute(null);
  if (spin) {
    S.follow = true;
    // After the dive, frame both the courier (where they are by then) and the door
    globe.spinTo(loc || d.dest, 15.6).then(() => {
      const cur = currentDelivery();
      const now = cur && cur.code === d.code && liveLocation(cur);
      if (now) globe.fit([now, cur.dest]);
    });
  } else if (loc && S.follow && globe.isReady() && !globe.isFlying() && !globe.isVisible(loc)) {
    globe.fit([loc, d.dest]);
  }
}

// Road route from the courier to the door (free OSRM demo server; refreshed at most every 30 s)
// Where the courier is along a route: metres still to go, and how far they are from it
function alongRoute(coords, loc) {
  const p = { lng: loc.lng, lat: loc.lat };
  let best = { off: Infinity, i: 0, point: coords[0] };
  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lng: coords[i][0], lat: coords[i][1] }, b = { lng: coords[i + 1][0], lat: coords[i + 1][1] };
    // Project onto the segment in a local flat frame (fine at street scale)
    const kx = Math.cos(a.lat * Math.PI / 180);
    const ax = 0, ay = 0, bx = (b.lng - a.lng) * kx, by = b.lat - a.lat, px = (p.lng - a.lng) * kx, py = p.lat - a.lat;
    const len = bx * bx + by * by;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len)) : 0;
    const q = { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
    const off = distance(p, q);
    if (off < best.off) best = { off, i, point: q };
  }
  let remaining = distance(best.point, { lng: coords[best.i + 1][0], lat: coords[best.i + 1][1] });
  for (let i = best.i + 1; i < coords.length - 1; i++) remaining += distance({ lng: coords[i][0], lat: coords[i][1] }, { lng: coords[i + 1][0], lat: coords[i + 1][1] });
  return { off: best.off, remaining, rest: [[best.point.lng, best.point.lat], ...coords.slice(best.i + 1)] };
}

// Road route from the courier to the door (free OSRM demo server). It is fetched once and
// followed as the courier moves; it is fetched again if they leave it or after two minutes.
const routeAsked = new Map();
async function ensureRoute(d, loc) {
  // A demo courier follows a set route (by road, then by boat to a ship at anchor): show that one
  const robot = B.robotOf && B.robotOf(d.code);
  if (robot && robot.coords.length > 1) {
    let rr = S.routes.get(d.code);
    if (!rr || rr.startedAt !== robot.startedAt) {
      const length = B.pathLength(robot.coords);
      rr = { coords: robot.coords, distance: length, duration: length / robot.speed, at: Date.now(), startedAt: robot.startedAt, fixed: true };
      S.routes.set(d.code, rr);
    }
    globe.setRoute([[loc.lng, loc.lat], ...alongRoute(rr.coords, loc).rest]);
    return;
  }
  const r = S.routes.get(d.code);
  const along = r && r.coords.length > 1 && alongRoute(r.coords, loc);
  const straight = [[loc.lng, loc.lat], [d.dest.lng, d.dest.lat]];
  if (along && along.off < 200) globe.setRoute([[loc.lng, loc.lat], ...along.rest]);
  else globe.setRoute(straight);
  const stale = !r || !along || along.off >= 200 || Date.now() - r.at > 2 * MIN;
  const wait = (routeAsked.get(d.code) || 0) - Date.now();
  if (!stale || wait > 0) return;
  routeAsked.set(d.code, Date.now() + 30 * SEC);
  try {
    const route = await fetchRoute(loc, d.dest);
    S.routes.set(d.code, { ...route, at: Date.now() });
    const cur = currentDelivery();
    if (cur && cur.code === d.code) { globe.setRoute(route.coords); refreshPanel(); }
  } catch {
    routeAsked.set(d.code, Date.now() + 4 * SEC);  // the free server sometimes says "too many requests": try again soon
  }
}
async function fetchRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const json = await res.json();
  const route = json.routes && json.routes[0];
  if (!route) throw new Error('no route');
  return { coords: route.geometry.coordinates, duration: route.duration, distance: route.distance };
}

// ---------- Picking the delivery spot ----------
function startPicking() {
  const f = S.draft;
  globe.setDestination(null); globe.setCourier(null); globe.setRoute(null);
  globe.startPick(f.dest, p => setDraftSpot(p, { fly: false }));
  if (f.dest) globe.spinTo(f.dest, 16.5); else globe.showEarth();
}
function handleMapClick(p) {
  if (S.selected && ['new', 'edit'].includes(S.selected.kind)) {
    setDraftSpot(p, { fly: p.zoom < 11 });
    return;
  }
  if (S.user && !currentDelivery() && p.zoom < 5) globe.spinTo(p, 12.5);
}
let geocodeSeq = 0;
function setDraftSpot(p, { fly = false, label = '' } = {}) {
  const f = S.draft;
  if (!f) return;
  f.dest = { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) };
  f.destLabel = label;
  globe.movePick(f.dest);
  if (fly) globe.spinTo(f.dest, 16.5);
  renderSpot();
  if (!label) {
    const seq = ++geocodeSeq;
    reverseGeocode(f.dest).then(name => { if (seq === geocodeSeq && S.draft === f && name) { f.destLabel = name; renderSpot(); } });
  }
}
function renderSpot() { const el = $('#spot'); if (el) el.innerHTML = spotHtml(); }
async function reverseGeocode(p) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${p.lat}&lon=${p.lng}`, { headers: { 'Accept-Language': 'en' } });
    const j = await res.json();
    return shortPlace(j);
  } catch { return ''; }
}
function shortPlace(j) {
  const a = (j && j.address) || {};
  const parts = [[a.house_number, a.road].filter(Boolean).join(' '), a.neighbourhood || a.suburb || a.quarter, a.city || a.town || a.village || a.state].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(', ') : String((j && j.display_name) || '').split(',').slice(0, 3).join(',');
}
async function searchPlaces(q) {
  const list = $('#results');
  if (!list) return;
  list.innerHTML = '<li class="small muted">Searching…</li>';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
    const rows = await res.json();
    if (!rows.length) { list.innerHTML = '<li class="small muted">No places found. Try a street and city, or tap the map.</li>'; return; }
    list.innerHTML = rows.map((r, i) => `<li><button type="button" data-result="${i}">${esc(r.display_name)}</button></li>`).join('');
    list.onclick = e => {
      const b = e.target.closest('[data-result]');
      if (!b) return;
      const r = rows[+b.dataset.result];
      setDraftSpot({ lat: +r.lat, lng: +r.lon }, { fly: true, label: shortPlace(r) });
      list.innerHTML = '';
    };
  } catch { list.innerHTML = '<li class="small muted">Search is unavailable right now. Tap the map instead.</li>'; }
}
function locateMe() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error("This browser can't share your location."));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      err => reject(new Error(geoMessage(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  });
}
function geoMessage(err) {
  if (err && err.code === 1) return 'Location is blocked. Allow location for this site in your browser settings.';
  if (err && err.code === 3) return "Couldn't get a location fix. Move near a window or outside and try again.";
  return "Couldn't get your location right now.";
}

// ---------- Customer actions ----------
function openForm(editing) {
  const d = editing ? currentDelivery() : null;
  S.draft = d
    ? { code: d.code, item: d.item, from: d.from || '', address: d.address || '', notes: d.notes || '', phone: d.ownerPhone || '', dest: { ...d.dest }, destLabel: d.destLabel || '' }
    : { item: '', from: '', address: '', notes: '', phone: (S.profile && S.profile.phone) || '', dest: null, destLabel: '' };
  select({ kind: editing ? 'edit' : 'new', code: d ? d.code : undefined });
}
function readForm() {
  const f = S.draft;
  f.item = $('#fItem').value.trim();
  f.from = $('#fFrom').value.trim();
  f.address = $('#fAddress').value.trim();
  f.notes = $('#fNotes').value.trim();
  f.phone = $('#fPhone').value.trim();
  return f;
}
async function submitForm() {
  const f = readForm();
  const err = !f.item ? 'Say what is coming, for example "Running shoes".' : !f.dest ? 'Drop a pin on the map for the delivery spot.' : '';
  if (err) return showError('#formError', err);
  showError('#formError', '');
  const fields = { item: f.item.slice(0, 80), from: f.from.slice(0, 80), address: f.address.slice(0, 160), notes: f.notes.slice(0, 300), ownerPhone: f.phone.slice(0, 30), dest: f.dest, destLabel: (f.destLabel || '').slice(0, 160) };
  if (S.selected.kind === 'edit') {
    try {
      await B.update(f.code, { ...fields, updatedAt: B.now() });
      toast('Saved');
      S.draft = null;
      select({ kind: 'delivery', code: f.code }, { spin: true });
    } catch { showError('#formError', "Couldn't save. Check your connection and try again."); }
    return;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    const pin = randomPin();
    const data = {
      ...fields,
      ownerUid: S.user.uid, ownerName: S.profile.name,
      status: 'waiting', courierUid: null, courierName: '', courierPhone: '', courierLoc: null,
      events: [event('waiting', 'customer')],
      createdAt: B.now(), updatedAt: B.now(),
    };
    try {
      await B.create(code, data, pin);
      S.pins.set(code, pin);
      S.draft = null;
      toast('Added. Send the code to whoever is delivering it.');
      select({ kind: 'delivery', code }, { spin: true });
      return;
    } catch (e) {
      if (!(e && e.code === 'permission-denied')) { showError('#formError', "Couldn't add it. Check your connection and try again."); return; }
    }
  }
  showError('#formError', "Couldn't add it. Try again.");
}

async function loadPin(code) {
  if (S.pins.has(code)) return;
  S.pins.set(code, null);
  try {
    const pin = await B.getPin(code);
    if (pin) { S.pins.set(code, pin); refreshPanel(); }
  } catch { S.pins.delete(code); }
}

async function setStatus(d, status, by, extra = {}, kind) {
  await B.update(d.code, { status, updatedAt: B.now(), ...extra }, event(status, by, kind ? { kind } : {}));
}

function deleteWithUndo(d) {
  const t = { data: d, timer: 0 };
  t.timer = setTimeout(async () => {
    S.pendingDelete.delete(d.code);
    try { await B.remove(d.code); } catch { toast(`Couldn't delete ${d.item}.`); renderTabs(); }
  }, 6500);
  S.pendingDelete.set(d.code, t);
  select(null, { spin: true });
  toast(`Deleted ${d.item}`, { label: 'Undo', run() { clearTimeout(t.timer); S.pendingDelete.delete(d.code); select({ kind: 'delivery', code: d.code }, { spin: true }); } });
}

// ---------- Courier actions ----------
async function findJob(raw) {
  const code = cleanCode(raw);
  S.join = { code, preview: null, error: '', busy: false };
  if (code.length !== 8) { S.join.error = 'Delivery codes have 8 letters and numbers.'; renderPanel(); return; }
  const mine = S.jobs.get(code);
  if (mine) { select({ kind: 'delivery', code }, { spin: true }); return; }
  S.join.busy = true; renderPanel();
  try {
    const p = await B.getJob(code);
    if (p.courierUid && p.courierUid !== S.user.uid) throw new Error('taken');
    if (FINISHED.has(p.status)) S.join.error = 'This delivery is already finished.';
    else S.join.preview = p;
  } catch {
    S.join.error = "No open job with that code. Check it with the customer. If someone else already took the job, it won't show up.";
  }
  S.join.busy = false;
  renderPanel();
  if (S.join.preview) { globe.setDestination(S.join.preview.dest); globe.spinTo(S.join.preview.dest, 14); }
}
async function claimJob() {
  const p = S.join.preview;
  if (!p) return;
  if (ROOM) {
    // In a test room there are no accounts: the driver just says who he is
    const name = (($('#joinName') || {}).value || '').trim();
    if (!name) { S.join.error = 'Type your name first, so they know who is delivering.'; renderPanel(); return; }
    S.profile = { ...S.profile, name: name.slice(0, 60), phone: (($('#joinPhone') || {}).value || '').trim().slice(0, 30), role: 'courier', updatedAt: B.now() };
    await B.saveProfile(S.user.uid, S.profile);
    renderChrome();
  }
  S.join.busy = true; S.join.error = ''; renderPanel();
  try {
    await B.update(p.code, {
      courierUid: S.user.uid, courierName: S.profile.name, courierPhone: S.profile.phone || '',
      status: 'assigned', updatedAt: B.now(),
    }, event('assigned', 'courier'));
    S.join = { code: '', preview: null, error: '', busy: false };
    toast(`You took the job: ${p.item}`);
    select({ kind: 'delivery', code: p.code }, { spin: true });
  } catch {
    S.join.busy = false;
    S.join.error = 'Someone else took this job a moment ago, or it changed. Ask the customer.';
    S.join.preview = null;
    renderPanel();
  }
}

// ---------- Sharing the courier's location ----------
async function keepAwake(sh) {
  try { if (navigator.wakeLock) sh.wake = await navigator.wakeLock.request('screen'); } catch {}
}
function stopSharing() {
  const sh = S.sharing;
  if (!sh) return;
  if (sh.watchId != null) navigator.geolocation.clearWatch(sh.watchId);
  clearInterval(sh.timer);
  try { sh.wake && sh.wake.release(); } catch {}
  S.sharing = null;
}
function startSharing(d, { demo = false } = {}) {
  stopSharing();
  const sh = { code: d.code, demo, lastSent: 0, lastPos: null, error: '', watchId: null, timer: 0, wake: null };
  S.sharing = sh;
  keepAwake(sh);
  if (demo) startDemoDrive(sh, d);
  else if (!('geolocation' in navigator)) sh.error = "This browser can't share location.";
  else {
    sh.watchId = navigator.geolocation.watchPosition(
      pos => onPosition(sh, { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, heading: pos.coords.heading, speed: pos.coords.speed }),
      err => { if (S.sharing === sh) { sh.error = geoMessage(err); refreshPanel(); } },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 },
    );
  }
  refreshPanel();
}
function onPosition(sh, p) {
  if (S.sharing !== sh) return;
  sh.lastPos = { lat: p.lat, lng: p.lng, acc: finite(p.acc), heading: finite(p.heading), speed: finite(p.speed), at: Date.now() };
  sh.error = '';
  const d = currentDelivery();
  if (d && d.code === sh.code && S.mode === 'courier') updateMap();
  if (Date.now() - sh.lastSent >= 4 * SEC) send(sh);
}
async function send(sh) {
  const p = sh.lastPos;
  if (!p) return;
  sh.lastSent = Date.now();
  try {
    await B.update(sh.code, {
      courierLoc: { lat: p.lat, lng: p.lng, acc: p.acc, heading: p.heading, speed: p.speed, at: p.at },
      updatedAt: B.now(),
      ...(sh.demo ? { demoDrive: true } : {}),
    });
  } catch {
    sh.error = "Couldn't send your location. Check your connection.";
  }
  refreshPanel();
}
// A sped-up drive along a real road route to the door, for showing the app off
async function startDemoDrive(sh, d) {
  const start = offset(d.dest, 2200 + Math.random() * 900, Math.random() * 360);
  let path;
  try { path = (await fetchRoute(start, d.dest)).coords.map(([lng, lat]) => ({ lng, lat })); }
  catch { path = Array.from({ length: 30 }, (_, i) => ({ lng: start.lng + (d.dest.lng - start.lng) * i / 29, lat: start.lat + (d.dest.lat - start.lat) * i / 29 })); }
  if (S.sharing !== sh) return;
  path.push({ ...d.dest });
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distance(path[i - 1], path[i]));
  const total = cum[cum.length - 1];
  let s = 0;
  const tick = () => {
    if (S.sharing !== sh) return;
    s = Math.min(total, s + 24); // about 86 km/h: a sped-up city drive
    let i = 1;
    while (i < path.length - 1 && cum[i] < s) i++;
    const a = path[i - 1], b = path[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
    onPosition(sh, { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, acc: 5, heading: bearing(a, b), speed: 24 });
    if (s >= total) { clearInterval(sh.timer); send(sh); }
  };
  tick();
  sh.timer = setInterval(tick, SEC);
}

// ---------- Clicks inside the app ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-open], [data-act], [data-mode], [data-menu]');
  if (!t) { if (!e.target.closest('#menu, #avatarBtn')) closeMenu(); return; }
  if (t.dataset.mode) return setMode(t.dataset.mode);
  if (t.dataset.menu) return menuAction(t.dataset.menu);
  if (t.dataset.open) {
    const same = S.selected && S.selected.kind === 'delivery' && S.selected.code === t.dataset.open;
    return select({ kind: 'delivery', code: t.dataset.open }, { spin: true, again: same });
  }
  const act = t.dataset.act;
  const d = currentDelivery();
  // Two-tap confirmation for things that are awkward to undo
  if (['cancel', 'unassign', 'give-back'].includes(act) && S.ui.armed !== act) {
    S.ui.armed = act;
    renderPanel();
    setTimeout(() => { if (S.ui.armed === act) { S.ui.armed = ''; refreshPanel(); } }, 4000);
    return;
  }
  S.ui.armed = '';
  try {
    switch (act) {
      case 'new': return openForm(false);
      case 'edit': return openForm(true);
      case 'join': S.join = { code: '', preview: null, error: '', busy: false }; return select({ kind: 'join' });
      case 'form-cancel': { const back = S.selected.kind === 'edit' ? { kind: 'delivery', code: S.draft.code } : null; S.draft = null; return select(back, { spin: true }); }
      case 'use-location': {
        try { const p = await locateMe(); setDraftSpot(p, { fly: true }); } catch (err) { showError('#formError', err.message); }
        return;
      }
      case 'search': { const q = $('#fSearch').value.trim(); if (q) searchPlaces(q); return; }
      case 'share-code': return shareCode(d);
      case 'copy-code': return copyText(d.code, 'Code copied');
      case 'copy-link': return copyText(shareUrl(d.code), 'Link copied. Send it to the driver.');
      case 'received': return setStatus(d, 'delivered', 'customer', { deliveredAt: B.now() });
      case 'cancel': return setStatus(d, 'cancelled', 'customer');
      case 'restore': return setStatus(d, d.courierUid ? 'assigned' : 'waiting', 'customer', {}, 'restored');
      case 'unassign': return setStatus(d, d.kind === 'order' ? restStatus(d) : 'waiting', 'customer', { courierUid: null, courierName: '', courierPhone: '', courierLoc: null, ...(d.kind === 'order' ? { collected: {} } : {}) }, 'unassigned');
      case 'delete': return deleteWithUndo(d);
      case 'claim': return claimJob();
      case 'picked': return setStatus(d, 'picked_up', 'courier');
      case 'piece': {
        // The driver ticks (or unticks) one piece; the first tick means he started collecting
        const line = (d.lines || []).find(l => l.id === t.dataset.id);
        if (!line || !B.deleteField) return;
        const on = isGot(d, line);
        const fields = { [`collected.${line.id}`]: on ? B.deleteField() : Date.now(), updatedAt: B.now() };
        if (!on && d.status !== 'picked_up') fields.status = 'picked_up';
        return B.update(d.code, fields, on ? null : event('collected', 'courier', { note: `${fmtQty(line.qty)} ${line.unit || ''} ${line.desc}${line.from && line.from.label ? `, from ${line.from.label}` : ''}`.replace(/\s+/g, ' ') }));
      }
      case 'start': await setStatus(d, 'on_the_way', 'courier', { demoDrive: false }); return startSharing(d);
      case 'start-demo': await setStatus(d, 'on_the_way', 'courier', { demoDrive: true }); return startSharing(d, { demo: true });
      case 'share-gps': return startSharing(d);
      case 'demo-drive': return startSharing(d, { demo: true });
      case 'stop-share': stopSharing(); return refreshPanel();
      case 'problem-open': S.ui.problemOpen = true; return renderPanel();
      case 'problem-close': S.ui.problemOpen = false; return renderPanel();
      case 'resolved': return setStatus(d, d.courierLoc ? 'on_the_way' : 'picked_up', 'courier', { problem: '' });
      case 'give-back':
        if (S.sharing && S.sharing.code === d.code) stopSharing();
        await setStatus(d, d.kind === 'order' ? restStatus(d) : 'waiting', 'courier', { courierUid: null, courierName: '', courierPhone: '', courierLoc: null, ...(d.kind === 'order' ? { collected: {} } : {}) }, 'returned');
        return toast('You gave the job back.');
      case 'hide-job': {
        const key = `pt.hiddenJobs.${S.user.uid}`;
        store.set(key, [...new Set([...store.get(key, []), d.code])]);
        return select(null, { spin: true });
      }
    }
  } catch (err) {
    toast("That didn't go through. Check your connection and try again.");
  }
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const d = currentDelivery();
  if (kind === 'delivery') return submitForm();
  if (kind === 'join') return findJob($('#joinCode').value);
  if (kind === 'pin') {
    const input = $('#pinInput');
    const pin = input.value.replace(/\D/g, '');
    if (pin.length !== 4) { S.ui.pinError = 'The PIN has 4 digits.'; return renderPanel(); }
    try {
      await B.deliver(d.code, { status: 'delivered', handoffPin: pin, deliveredAt: B.now(), updatedAt: B.now() }, event('delivered', 'courier'));
      S.ui.pinError = '';
      stopSharing();
      toast(`Delivered: ${d.item}`);
      refreshPanel();
    } catch (err) {
      S.ui.pinError = err && err.code === 'permission-denied'
        ? "That PIN doesn't match. Ask the customer to read it from their app."
        : "Couldn't confirm the delivery. Check your connection and try again.";
      input.value = '';
      renderPanel();
      const again = $('#pinInput');
      if (again) again.focus();
    }
    return;
  }
  if (kind === 'problem') {
    const text = $('#problemText').value.trim();
    if (!text) return;
    try {
      await setStatus(d, 'problem', 'courier', { problem: text.slice(0, 300) }, undefined);
      S.ui.problemOpen = false;
      renderPanel();
    } catch { toast("Couldn't send that. Try again."); }
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'joinCode') S.join.code = cleanCode(e.target.value);
  if (S.draft && ['fItem', 'fFrom', 'fAddress', 'fNotes', 'fPhone'].includes(e.target.id)) readForm();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'fSearch') { e.preventDefault(); const q = e.target.value.trim(); if (q) searchPlaces(q); }
  if (e.key === 'Escape') closeMenu();
});

async function shareCode(d) {
  const url = shareUrl(d.code);
  const text = `Delivery job "${d.item}". Open the link and take it with code ${d.code}.`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Parcel Tracker job', text, url }); return; }
    catch (err) { if (err && err.name === 'AbortError') return; }
  }
  copyText(url, 'Link copied. Send it to your courier.');
}
async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { toast(`Copy this: ${text}`); }
}

// ---------- Top bar, menu, profile ----------
$('#brandBtn').addEventListener('click', e => { e.preventDefault(); select(null, { spin: true }); });
$('#earthBtn').addEventListener('click', () => globe.showEarth());
$('#recenterBtn').addEventListener('click', () => {
  const d = currentDelivery();
  if (S.selected && ['new', 'edit'].includes(S.selected.kind) && S.draft && S.draft.dest) return globe.spinTo(S.draft.dest, 16.5);
  if (!d) return toast('Open a delivery first.');
  S.follow = true;
  const loc = liveLocation(d);
  if (loc) globe.fit([loc, d.dest]); else globe.spinTo(d.dest, 15.6);
});
$('#avatarBtn').addEventListener('click', () => {
  const menu = $('#menu');
  menu.hidden = !menu.hidden;
  $('#avatarBtn').setAttribute('aria-expanded', String(!menu.hidden));
});
function closeMenu() { $('#menu').hidden = true; $('#avatarBtn').setAttribute('aria-expanded', 'false'); }
async function menuAction(what) {
  closeMenu();
  if (what === 'signout') {
    if (S.sharing) stopSharing();
    if (ROOM) { store.set('pt.room', null); location.href = location.pathname; return; }
    if (DEMO) { store.set('pt.demo', false); location.href = location.pathname; return; }
    return B.signOutUser();
  }
  if (what === 'reset-demo') {
    stopSharing();
    B.reset();
    location.reload();
    return;
  }
  if (what === 'profile') {
    $('#pfName').value = S.profile.name || '';
    $('#pfPhone').value = S.profile.phone || '';
    document.querySelectorAll('[name=pfRole]').forEach(r => { r.checked = r.value === (S.profile.role || 'customer'); });
    showError('#pfError', '');
    $('#profileDialog').showModal();
  }
  if (what === 'alerts') {
    if (!('Notification' in window)) return toast("This browser can't show alerts. You still see updates while the app is open.");
    const res = await Notification.requestPermission();
    updateAlertsLabel();
    toast(res === 'granted' ? "Alerts are on. You'll hear about changes even in another tab." : 'Alerts stay off. You can allow them in your browser settings.');
  }
}
$('#profileForm').addEventListener('submit', async e => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const name = $('#pfName').value.trim();
  if (!name) return showError('#pfError', 'Type your name.');
  const role = (document.querySelector('[name=pfRole]:checked') || {}).value || 'customer';
  const data = { name: name.slice(0, 60), phone: $('#pfPhone').value.trim().slice(0, 30), role, createdAt: S.profile.createdAt || B.now(), updatedAt: B.now() };
  try {
    await B.saveProfile(S.user.uid, data);
    S.profile = data;
    renderChrome();
    $('#profileDialog').close();
    toast('Profile saved');
  } catch { showError('#pfError', "Couldn't save. Check your connection."); }
});

// ---------- Panel size (phones) and map insets ----------
const SIZES = ['half', 'full', 'peek'];
$('#handle').addEventListener('click', () => {
  const panel = $('#panel');
  panel.dataset.size = SIZES[(SIZES.indexOf(panel.dataset.size) + 1) % SIZES.length];
  setTimeout(updateInsets, 320);
});
function updateInsets() {
  const wide = matchMedia('(min-width: 900px)').matches;
  if ($('#appScreen').hidden) {
    // Signed out: keep the planet in the space the sign-in card leaves free
    const card = $('.auth-card').getBoundingClientRect();
    return globe.setInsets($('#authScreen').hidden || !card.height ? {} : wide ? { left: card.right } : { bottom: Math.max(0, innerHeight - card.top) });
  }
  const panel = $('#panel').getBoundingClientRect();
  globe.setInsets(wide ? { top: 120, left: panel.right + 10, right: 60, bottom: 10 } : { top: 120, bottom: Math.max(0, innerHeight - panel.top) + 10, left: 0, right: 56 });
}
addEventListener('resize', () => { clearTimeout(updateInsets.t); updateInsets.t = setTimeout(updateInsets, 150); });

// ---------- Links like #join/AB3K7Q2M and #d/AB3K7Q2M ----------
function openFromHash() {
  const m = location.hash.match(/^#(join|d)\/([0-9A-Za-z]{8})$/);
  if (!m) return false;
  const code = cleanCode(m[2]);
  if (!S.user) { S.pendingJoin = m[1] === 'join' ? code : null; return false; }
  if (m[1] === 'join') {
    if (S.mode !== 'courier') { S.mode = 'courier'; store.set(`pt.mode.${S.user.uid}`, 'courier'); renderChrome(); }
    S.join = { code, preview: null, error: '', busy: false };
    select({ kind: 'join' });
    findJob(code);
  } else {
    select({ kind: 'delivery', code }, { spin: true });
  }
  return true;
}
addEventListener('hashchange', () => { if (S.user) openFromHash(); });
if (/^#join\//.test(location.hash)) {
  const note = document.createElement('p');
  note.className = 'small';
  note.style.cssText = 'margin:0;padding:10px 12px;border-radius:10px;background:var(--accent-soft);color:var(--accent)';
  note.textContent = 'You were sent a delivery job. Sign in, or create an account and choose "Deliver parcels", to take it.';
  $('.auth-card').insertBefore(note, $('.auth-card .seg'));
}

// ---------- Ticking clocks, wake lock, leaving mid-delivery ----------
setInterval(() => {
  document.querySelectorAll('[data-ago]').forEach(el => { el.textContent = ago(+el.dataset.ago); });
}, SEC);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.sharing) keepAwake(S.sharing);
});
addEventListener('beforeunload', e => { if (S.sharing && !S.sharing.demo) { e.preventDefault(); e.returnValue = ''; } });
