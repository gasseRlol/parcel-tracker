// The live backend: Firebase sign-in and the Firestore database (who may do what is in firestore.rules).
// backend-demo.js offers the same functions with everything kept in the browser.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  memoryLocalCache, doc, getDoc, setDoc, updateDoc, collection, query, where, onSnapshot,
  serverTimestamp, arrayUnion, writeBatch, runTransaction,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, useEmulators } from './firebase-config.js';

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = initializeFirestore(fb, {
  localCache: useEmulators ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
const deliveryRef = code => doc(db, 'deliveries', code);
const pinRef = code => doc(db, 'deliveries', code, 'private', 'handoff');

export const kind = 'live';
export const testMode = useEmulators;
export const now = () => serverTimestamp();

// ---------- Accounts ----------
export const onAuth = cb => onAuthStateChanged(auth, cb);
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name }).catch(() => {});
  return cred.user;
}
export const resetPassword = email => sendPasswordResetEmail(auth, email);
export const signOutUser = () => signOut(auth);

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}
export async function saveProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), data);
  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: data.name }).catch(() => {});
}

// ---------- Deliveries ----------
// Calls onList with every delivery whose `field` (ownerUid or courierUid) is uid, now and on each change
export function watch(field, uid, onList, onError) {
  return onSnapshot(query(collection(db, 'deliveries'), where(field, '==', uid)), snap => {
    const list = [];
    snap.forEach(d => list.push({ code: d.id, ...d.data() }));
    onList(list);
  }, onError);
}
export async function create(code, data, pin) {
  const batch = writeBatch(db);
  batch.set(deliveryRef(code), data);
  batch.set(pinRef(code), { pin });
  await batch.commit();
}
export function update(code, fields, event) {
  return updateDoc(deliveryRef(code), event ? { ...fields, events: arrayUnion(event) } : fields);
}
export async function getPin(code) {
  const snap = await getDoc(pinRef(code));
  return snap.exists() ? snap.data().pin : null;
}
export async function getJob(code) {
  const snap = await getDoc(deliveryRef(code));
  if (!snap.exists()) throw new Error('missing');
  return { code, ...snap.data() };
}
// Waits for the server's answer, so a wrong PIN never shows as "Delivered" for a moment
export async function deliver(code, fields, event) {
  await runTransaction(db, async tx => {
    const snap = await tx.get(deliveryRef(code));
    if (!snap.exists()) throw new Error('gone');
    tx.update(deliveryRef(code), { ...fields, events: arrayUnion(event) });
  });
}
export async function remove(code) {
  const batch = writeBatch(db);
  batch.delete(pinRef(code));
  batch.delete(deliveryRef(code));
  await batch.commit();
}
