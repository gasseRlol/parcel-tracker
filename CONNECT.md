# Connecting a company's system to Parcel Tracker

This is for a company that sends goods out and wants each delivery followed live: for example a ship supplier whose delivery notes go to ships by truck or launch boat. **Quayside** (https://gasserlol.github.io/quayside/) is a demo of such a system and is already connected to the tracker's demo, so you can watch the whole thing work.

## The idea

One **delivery note** in the company's system becomes one **delivery** in the tracker.

1. The company's system sends the note to the tracker and gets back a **tracking code**, a **handover PIN** and two links.
2. A driver takes the job on their phone (courier link) and shares their location while driving.
3. The customer (for a ship: the master or the agent) follows it live with the tracking link. They get the PIN and say it to the driver only when the goods are in their hands.
4. The tracker tells the company's system each change, so the delivery note moves to "On the way" and then "Delivered" (with who received it and when) by itself.

## The messages

All messages are JSON over HTTPS.

**1. Create a delivery** (company to tracker), when the note is packed or sent out:

```http
POST /api/deliveries
Authorization: Bearer <the company's API key>

{
  "ref": "DN-413",
  "title": "MV Nordic Falcon: ship stores (DN-413)",
  "from": "Quayside Marine Supply",
  "deliverTo": { "label": "Port Said anchorage", "lat": 31.36, "lng": 32.345,
                 "details": "Alongside MV Nordic Falcon, IMO 9412873" },
  "lines": [ { "desc": "Pilot ladder 9 m", "qty": 2, "unit": "pc" } ],
  "notes": "Pilot ladder must go out with the launch"
}
```

Answer:

```json
{ "code": "G88TN6NG", "pin": "4414",
  "trackUrl": "https://.../parcel-tracker/#d/G88TN6NG",
  "courierUrl": "https://.../parcel-tracker/#join/G88TN6NG" }
```

The company keeps `code` on the delivery note. The PIN goes to the customer (email or SMS to the ship's agent, for example). It never goes on the driver's copy.

**2. Status updates** (tracker to company): the tracker calls a web address the company gives (a "webhook") on every change.

```json
{ "code": "G88TN6NG", "ref": "DN-413", "status": "on_the_way", "at": "2026-10-30T15:01:12Z",
  "courier": { "name": "Launch boat Sea Runner", "lat": 31.29, "lng": 32.311 } }

{ "code": "G88TN6NG", "ref": "DN-413", "status": "delivered", "at": "2026-10-30T15:03:40Z",
  "receivedBy": "Chief Officer", "pinChecked": true }
```

Each call is signed with a secret shared with the company, so they can be sure it came from the tracker. If they cannot receive calls, they can ask instead: `GET /api/deliveries/G88TN6NG`.

**3. Cancel** when a note is unpacked or cancelled: `POST /api/deliveries/G88TN6NG/cancel`.

### Status mapping

| Tracker | Company's delivery note |
| --- | --- |
| `waiting`, `assigned` | Packed, waiting for a driver |
| `picked_up`, `on_the_way` | On the way |
| `delivered` | Delivered (who received it, when; PIN checked) |
| `problem` | Needs attention (the driver's note says why) |
| `cancelled` | Removed |

## How their desktop system plugs in

The marine supplier's current system is a Windows desktop program with its own database. There are two ways to connect it:

- **Their developer adds two things**: one call to "create a delivery" when a note is sent out, and one place that receives the status updates and writes them into their delivery-notes table.
- **Nothing changes in their program**: a small connector runs on their server. Every minute it looks for new delivery notes in their database, sends them to the tracker, and writes the statuses back. We can build and install this connector.

To set it up we need from them:
- the delivery places they use (berths, anchorages) with map positions;
- where their store is;
- a webhook address, or read and write access to the delivery-notes table for the connector;
- who should receive the PIN for each customer.

## What exists today

- **Demo**: `connect.js` makes exactly these calls inside the browser, between the Quayside demo and the tracker demo. It shows the same data, in the same order, as the real service would.
- **Live**: the tracker stores its data in Firebase. Before a real company connects, the tracker needs a small server part: the three web addresses above, an API key per company, and the webhook sender. On Firebase this is a few Cloud Functions. They need the project on the pay-as-you-go plan, which includes a free monthly allowance.
