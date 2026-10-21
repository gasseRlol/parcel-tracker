// Firebase web config. These values are public by design: the security rules in firestore.rules decide who can read or change what.
export const firebaseConfig = {
  apiKey: 'AIzaSyALPI4oQY8mdYb2CRngPstahQMDP-CoQaE',
  authDomain: 'parcel-tracker-gasser.firebaseapp.com',
  projectId: 'parcel-tracker-gasser',
  storageBucket: 'parcel-tracker-gasser.firebasestorage.app',
  messagingSenderId: '732973505165',
  appId: '1:732973505165:web:5aef3bf0af1b40dc0420c4',
};

// Local testing: open http://localhost:3100/?emu with `firebase emulators:start` running,
// and every account and delivery stays on this computer.
export const useEmulators = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  && new URLSearchParams(location.search).has('emu');
