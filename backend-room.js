// Test rooms: deliveries shared online (Firestore) with everyone who has the room's link, no
// sign-in. It offers the same functions as backend-demo.js and backend-firebase.js, so the app
// works the same, plus a few that connect.js uses. Rooms are for trying the app with other
// people: anyone with the link can see and change what is in a room, so nothing private goes in.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  initializeFirestore, connectFirestoreEmulator, memoryLocalCache, collection, doc, getDoc,
  updateDoc, onSnapshot, runTransaction, writeBatch, arrayUnion, deleteField,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, useEmulators } from './firebase-config.js';

const fb = initializeApp(firebaseConfig, 'rooms');
const db = initializeFirestore(fb, { localCache: memoryLocalCache() });
if (useEmulators) connectFirestoreEmulator(db, '127.0.0.1', 8080);

export const kind = 'room';
export const testMode = useEmulators;
export const now = () => Date.now();
export { deleteField };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newRoomId = () => Array.from(crypto.getRandomValues(new Uint32Array(12)), n => LETTERS[n % LETTERS.length]).join('');
export const cleanRoom = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

// This phone or computer: a random id, so a driver's jobs stay his
let device = store.get('pt.device', null);
if (!device) { device = `dev-${newRoomId().toLowerCase()}`; store.set('pt.device', device); }
export const ME = device;

// ---------- The room and one live listener on everything in it ----------
let ROOM = null, unsub = null, ready = false;
const cache = new Map();
const listeners = new Set();
export const room = () => ROOM;
export const isReady = () => ready;
export function useRoom(id) {
  const r = cleanRoom(id);
  if (r.length < 10) throw new Error('That room code is too short.');
  if (r === ROOM) return;
  ROOM = r; ready = false; cache.clear();
  if (unsub) unsub();
  unsub = onSnapshot(collection(db, 'rooms', ROOM, 'deliveries'), snap => {
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') cache.delete(ch.doc.id); else cache.set(ch.doc.id, ch.doc.data());
    }
    ready = true;
    for (const fn of listeners) fn();
  }, err => { for (const fn of listeners) fn(err); });
}
const dRef = code => doc(db, 'rooms', ROOM, 'deliveries', code);
const pRef = code => doc(db, 'rooms', ROOM, 'pins', code);
const clone = v => JSON.parse(JSON.stringify(v));
export const get = code => (cache.has(code) ? { code, ...clone(cache.get(code)) } : null);
export const all = () => [...cache.keys()].map(get);
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// ---------- "Accounts": in a room you are just this device, with a name you choose ----------
const PROFILE = 'pt.room.profile';
export function onAuth(cb) {
  const p = store.get(PROFILE, null);
  queueMicrotask(() => cb({ uid: ME, email: `Test room ${ROOM}`, displayName: (p && p.name) || 'Guest' }));
  return () => {};
}
export async function signIn() {}
export async function signUp() {}
export async function resetPassword() {}
export async function signOutUser() {}
export async function getProfile() { return store.get(PROFILE, null); }
export async function saveProfile(uid, data) { store.set(PROFILE, data); }

// ---------- Deliveries ----------
// Everyone in a room sees every delivery as a customer would; a driver sees the jobs he took
export function watch(field, uid, onList, onError) {
  const fire = err => {
    if (err) { if (onError) onError(err); return; }
    if (!ready) return;
    onList(all().filter(d => (field === 'ownerUid' ? true : d[field] === uid)));
  };
  listeners.add(fire);
  if (ready) queueMicrotask(() => fire());
  return () => listeners.delete(fire);
}
export async function create(code, data, pin) {
  const batch = writeBatch(db);
  batch.set(dRef(code), data);
  batch.set(pRef(code), { pin });
  await batch.commit();
}
export function update(code, fields, event) {
  const evs = !event ? [] : Array.isArray(event) ? event : [event];
  return updateDoc(dRef(code), evs.length ? { ...fields, events: arrayUnion(...evs) } : fields);
}
export async function getPin(code) {
  const snap = await getDoc(pRef(code));
  return snap.exists() ? snap.data().pin : null;
}
export async function getJob(code) {
  if (cache.has(code)) return get(code);
  const snap = await getDoc(dRef(code));
  if (!snap.exists()) throw new Error('missing');
  return { code, ...snap.data() };
}
// Waits for the server's answer (it checks the PIN), so a wrong PIN never shows as delivered
export async function deliver(code, fields, event) {
  await runTransaction(db, async tx => {
    const snap = await tx.get(dRef(code));
    if (!snap.exists()) throw new Error('gone');
    tx.update(dRef(code), { ...fields, events: arrayUnion(...(Array.isArray(event) ? event : [event])) });
  });
}
export async function remove(code) {
  const batch = writeBatch(db);
  batch.delete(pRef(code));
  batch.delete(dRef(code));
  await batch.commit();
}
// Empties the room
export async function clearAll() {
  const codes = [...cache.keys()];
  for (let i = 0; i < codes.length; i += 200) {
    const batch = writeBatch(db);
    for (const code of codes.slice(i, i + 200)) { batch.delete(dRef(code)); batch.delete(pRef(code)); }
    await batch.commit();
  }
}
