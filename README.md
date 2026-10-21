# Parcel Tracker

Track your deliveries live on a spinning Earth. Add what you're waiting for, send the code to whoever delivers it, and watch their phone move down your street.

**Live app:** https://gasserlol.github.io/parcel-tracker/ (on iPhone: open in Safari, Share → Add to Home Screen)

## How it works

- **Accounts.** Sign up with email and password and pick what you mostly do: track deliveries or deliver them. You can switch between **My deliveries** and **Courier** at any time.
- **Your deliveries are tabs.** Each one has its own tab. Tap a tab, or a dot on the globe, and the Earth spins fast and dives into that delivery's street.
- **Adding a delivery.** Say what's coming and drop a pin: tap the globe (it spins over and zooms in), search an address, or use your location. Add address details and notes for the courier.
- **The courier.** Share the delivery's 8-character code or link. The courier opens it, signs in, and takes the job. Their panel is a checklist: *Job taken → I have the order → On my way → Delivered*.
- **Live tracking.** When the courier taps *Start delivery*, their phone shares its location every few seconds. You see them move on the map with a road route, distance and ETA.
- **Handoff PIN.** Your delivery has a 4-digit PIN that only you can see. The courier needs it to mark the delivery as done, so nobody can say "delivered" without handing it over.
- **Also:** call buttons on both sides, Google Maps and Apple Maps directions for the courier, problem reports, remove or replace a courier, cancel or restore a delivery, delete with undo, alerts when a status changes, and a **demo drive** that simulates a courier along a real route so you can show the app off.

Phones only share location while the app is open, so the courier should keep the screen on during a delivery. The app asks the phone to keep the screen awake.

## Files

| File | What it is |
|---|---|
| `index.html` | Screens and the space theme |
| `app.js` | Accounts, deliveries, courier panel, live tracking |
| `globe.js` | The Earth: NASA Blue Marble from space, dark street map up close, the spin and dive |
| `firebase-config.js` | The Firebase web config (public by design) |
| `firestore.rules` | Who can read and change what. Deploy with `firebase deploy --only firestore:rules` |
| `lookup.html` | The older carrier-number lookup (DHL and others, sample data) |
| `server.js` | Optional local server; also adds live DHL data to `lookup.html` when `DHL_API_KEY` is set in `.env` |
| `TESTING.md` | Running everything locally against Firebase's emulators |

## Services it uses

- **Firebase** (project `parcel-tracker-gasser`): sign-in and the live database, on the free plan.
- **MapLibre GL 6.13** for the globe, **OpenFreeMap** for street tiles, **NASA GIBS Blue Marble** for the planet.
- **OSRM** (free demo server) for road routes and ETAs, and **Nominatim** (OpenStreetMap) for address search. Both are free and meant for light use.
