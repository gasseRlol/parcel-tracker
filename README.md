# Parcel Tracker

Type a tracking number and see where the parcel is: label created, picked up, in transit, out for delivery, delivered. It also warns when a parcel stops moving ("No movement for 5 days") or runs late, and shows the full scan history.

Right now it runs on sample data. Real DHL results switch on when you add a free DHL key (see below).

## Try it

- **On this computer:** `node server.js`, then open http://localhost:3100
- **Without a server:** double-click `index.html`. Sample data works the same way.
- **Sample numbers:** `DEMO-OUT`, `DEMO-TRANSIT`, `DEMO-STUCK`, `DEMO-NEW`, `DEMO-DELIVERED`, `DEMO-PROBLEM`, and `DEMO-LIVE` (gets a new scan every minute).
- **Link to one parcel:** add `#` and the number to the address, e.g. `…/index.html#DEMO-STUCK`.

## iPhone

Open the link in Safari, tap **Share**, then **Add to Home Screen**. It gets its own icon and opens full screen like an app, with no App Store needed. The parcel list is saved on each phone.

## Live DHL tracking

1. Sign up at https://developer.dhl.com, create an app, and add **Shipment Tracking - Unified** to it. DHL reviews the request. The starter key allows 250 lookups a day.
2. Copy `.env.example` to `.env` and paste the key after `DHL_API_KEY=`.
3. Restart `node server.js`. The badge in the corner changes from "Demo mode" to "Live · DHL".

The key stays in `.env` on the computer running the server. The page never sees it. The server waits 5 seconds between DHL calls and remembers each answer for 5 minutes, to stay inside DHL's limits.

Live mode needs the server running, so a static host like GitHub Pages only shows the samples. To have live data online, the server has to run on a host that runs Node (for example Render or Railway).

## What it can't do

- **Amazon:** an order number (`113-…`) isn't a tracking number. Amazon's own deliveries (`TBA…`) can only be tracked in the Amazon app. If Amazon hands the parcel to DHL or Aramex, that carrier's number works here.
- **Other carriers live:** only DHL is wired up. Aramex, UPS, FedEx and postal numbers are recognised, but they show simulated data until another tracking service is connected.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app: screens, sample data, carrier guessing |
| `server.js` | Optional. Serves the app and asks DHL for live data. No dependencies |
| `manifest.webmanifest`, `icons/` | Name and icon for "Add to Home Screen" |
| `.env.example` | Settings template: DHL key, port, Wi-Fi access |
