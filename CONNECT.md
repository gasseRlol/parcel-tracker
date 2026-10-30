# Connecting a company's system to Parcel Tracker

This is for a company that supplies customers and wants each order followed live: for example a ship supplier whose orders go to ships by truck or launch boat. **Quayside** (https://gasserlol.github.io/quayside/) is a demo of such a system and is already connected, so you can watch the whole thing work, with real drivers on their own phones.

## The idea

One **order** in the company's system (for Quayside: one ship call) becomes one **order** in the tracker, and the tracker follows it through three stages:

1. **With the supplier**: the company has ordered the goods from its suppliers.
2. **In the warehouse**: the goods reached the company's warehouse.
3. **On the ship** (at the customer): a driver took it there and the customer confirmed it with the PIN.

Every item in the order has its own stage, so the customer can see that, say, 3 items are already in the warehouse and 2 are still with the supplier.

How a delivery goes:

1. As soon as something is ordered from a supplier, the company's system sends the order to the tracker and gets back a **tracking code**, a **handover PIN** and two links.
2. Each time an item moves (received in the warehouse, packed, delivered), the system sends the new stages.
3. The driver opens the **driver link** on his phone, types his name and takes the job. He can start as soon as the order is placed.
4. His screen is a **checklist of the pieces**, grouped by where to pick each one up: the supplier's address while a piece is still there, or the company's warehouse once it arrived, with directions to each place. He ticks every piece as it comes into his hands; the customer and the company see "3 of 5 collected" and each piece marked "With the driver" right away.
5. He taps **On my way**: only then does his phone share its location, and everyone sees him move on the map. The pieces he has go on a delivery note in the company's system by themselves.
6. At the ship, the customer reads the **PIN** to the driver, who types it in. A wrong PIN is refused.
7. The tracker tells the company's system each change, so the delivery note moves to "Delivered" (who received it, when) by itself. Pieces he didn't collect stay open: he keeps the job and does another run for them.

The company can also pack a delivery note itself and **release** it ("Packed, waiting for a driver"); its pieces then show as packed at the warehouse on the driver's list.

## The messages

All messages are JSON over HTTPS.

**1. Create or update an order** (company to tracker), whenever anything about it changes:

```http
PUT /api/orders/OP-2612
Authorization: Bearer <the company's API key>

{
  "title": "MV Nordic Falcon: ship stores",
  "from": "Quayside Marine Supply",
  "deliverTo": { "label": "Port Said anchorage", "lat": 31.36, "lng": 32.345,
                 "details": "Alongside MV Nordic Falcon, IMO 9412873" },
  "pickup": { "label": "Quayside store, Port Said", "lat": 31.2585, "lng": 32.2985 },
  "lines": [
    { "id": "L1", "desc": "Pilot ladder 9 m", "qty": 2, "unit": "pc", "stage": "warehouse" },
    { "id": "L2", "desc": "Rice, basmati 5 kg bag", "qty": 50, "unit": "bag", "stage": "supplier" }
  ],
  "trip": null
}
```

Line stages: `pending` (not ordered yet), `supplier`, `warehouse`, `packed`, `on_way`, `ship`.

The first answer gives the codes; the company keeps them with its order:

```json
{ "code": "G88TN6NG", "pin": "4414",
  "trackUrl": "https://.../parcel-tracker/#d/G88TN6NG",
  "courierUrl": "https://.../parcel-tracker/#join/G88TN6NG" }
```

The PIN goes to the customer (email or SMS to the ship's agent, for example). It never goes on the driver's copy.

**2. Release a trip**: the same call with `"trip": { "ref": "DN-413", "lines": ["L1", "L2"] }` when a delivery note is sent out. Sending `"trip": null` again calls it off.

**3. Status updates** (tracker to company): the tracker calls a web address the company gives (a "webhook") on every change.

```json
{ "code": "G88TN6NG", "order": "OP-2612", "trip": "DN-413", "status": "on_the_way", "at": "2026-10-31T14:11:12Z",
  "driver": { "name": "Ali", "phone": "+20 100 000 0000", "lat": 31.29, "lng": 32.311 } }

{ "code": "G88TN6NG", "order": "OP-2612", "trip": "DN-413", "status": "delivered", "at": "2026-10-31T14:23:40Z",
  "receivedBy": "Chief Officer", "pinChecked": true }
```

Each call is signed with a secret shared with the company, so they can be sure it came from the tracker. If they cannot receive calls, they can ask instead: `GET /api/orders/OP-2612`.

**4. Remove** an order the company deleted: `DELETE /api/orders/OP-2612`.

### Status mapping

| Tracker | Company's system |
| --- | --- |
| `at_supplier` | Ordered from suppliers |
| `in_warehouse` | Everything in the warehouse |
| `waiting`, `assigned` | Delivery note sent out, waiting for the driver |
| `picked_up`, `on_the_way` | On the way |
| `delivered` | Delivered (who received it, when; PIN checked) |
| `problem` | Needs attention (the driver's note says why) |

## How their desktop system plugs in

The marine supplier's current system is a Windows desktop program with its own database. There are two ways to connect it:

- **Their developer adds two things**: one call that sends the order whenever it changes, and one place that receives the status updates and writes them into their delivery-notes table.
- **Nothing changes in their program**: a small connector runs on their server. Every minute it reads new or changed orders and delivery notes from their database, sends them to the tracker, and writes the statuses back. We can build and install this connector.

To set it up we need from them:
- the delivery places they use (berths, anchorages) with map positions, and where their warehouse is;
- a webhook address, or read and write access to the order and delivery-note tables for the connector;
- who should receive the PIN for each customer.

## What exists today

- **Test rooms** (working now): `connect.js` makes exactly these calls from the browser, into a shared online test room (Firestore). Quayside uses it, so you can test with real people: you run Quayside, a friend opens the driver link on his phone, a third person opens the customer link. Anyone with a room's link can see and change it, so it is only for testing.
- **Live**: before a real company connects, the tracker needs a small server part: the addresses above, an API key per company, and the webhook sender. On Firebase this is a few Cloud Functions. They need the project on the pay-as-you-go plan, which includes a free monthly allowance.
