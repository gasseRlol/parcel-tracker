// Parcel Tracker server. No dependencies. Run: node server.js
//  - serves the app (index.html, manifest, icons)
//  - /api/config tells the page whether live tracking is on
//  - /api/track?code=... asks DHL's tracking API when DHL_API_KEY is set in .env,
//    so the key stays on this computer and never reaches the page
// Without a key the page runs on its built-in sample data, exactly like the hosted copy.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Minimal .env reader (DHL_API_KEY=..., PORT=..., HOST=...)
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || "127.0.0.1"; // set HOST=0.0.0.0 to open it from a phone on the same Wi-Fi
const DHL_KEY = process.env.DHL_API_KEY || "";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};
// Only these files are served; everything else (server.js, .env, Firebase settings) stays private.
const PUBLIC = /^\/(index\.html|lookup\.html|app\.js|globe\.js|backend-(?:firebase|demo)\.js|firebase-config\.js|manifest\.webmanifest|icons\/[a-z0-9-]+\.png)$/;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// ---------- DHL Shipment Tracking - Unified ----------
// Starter keys allow 250 calls a day and one call every 5 seconds, so calls are spaced out and cached.
const CACHE_MS = 5 * 60e3;
const SPACING_MS = 5e3;
const cache = new Map();
let queue = Promise.resolve();
let lastCall = 0;

const SERVICE_NAMES = { express: "Express", "parcel-de": "Parcel Germany", "parcel-nl": "Parcel Netherlands", "parcel-pl": "Parcel Poland", "parcel-uk": "Parcel UK", ecommerce: "eCommerce", "ecommerce-europe": "eCommerce Europe", freight: "Freight", dgf: "Global Forwarding", svb: "Post & Parcel Germany", "post-de": "Post & Parcel Germany" };
const OUT_FOR_DELIVERY = /out for delivery|with (the )?(delivery )?courier|on (its|the) way to (you|the recipient)|in (the )?delivery vehicle|loaded (on|onto) (the )?delivery/i;

function place(loc) {
  const a = (loc && loc.address) || {};
  return [a.addressLocality, a.countryCode].filter(Boolean).join(", ");
}
function statusOf(ev) {
  const code = String(ev.statusCode || "").toLowerCase();
  if (code === "delivered") return "delivered";
  if (code === "failure") return "exception";
  if (code === "pre-transit") return "pre_transit";
  if (OUT_FOR_DELIVERY.test(`${ev.status || ""} ${ev.description || ""}`)) return "out_for_delivery";
  return "in_transit"; // "transit" and "unknown"
}
function toEvent(ev) {
  return { time: ev.timestamp || null, text: ev.description || ev.status || "Status update", place: place(ev.location), status: statusOf(ev) };
}

// DHL's shipment -> the shape the page understands
function fromDhl(s, code) {
  const events = (s.events || []).map(toEvent).filter(e => e.time);
  if (!events.length && s.status && s.status.timestamp) events.push(toEvent(s.status));
  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  const frame = s.estimatedDeliveryTimeFrame || {};
  return {
    code,
    source: "dhl",
    carrier: SERVICE_NAMES[s.service] ? `DHL ${SERVICE_NAMES[s.service]}` : "DHL",
    origin: place(s.origin),
    destination: place(s.destination),
    status: s.status ? statusOf(s.status) : (events[0] ? events[0].status : "in_transit"),
    events,
    eta: s.estimatedTimeOfDelivery || frame.estimatedThrough || null,
    etaDateOnly: false,
    lastUpdate: (s.status && s.status.timestamp) || (events[0] && events[0].time) || null,
  };
}

async function askDhl(code) {
  const wait = lastCall + SPACING_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  const url = "https://api-eu.dhl.com/track/shipments?trackingNumber=" + encodeURIComponent(code);
  let res;
  try {
    res = await fetch(url, { headers: { "DHL-API-Key": DHL_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(15e3) });
  } catch {
    return { ok: false, error: "carrier", message: "Couldn't reach DHL. Check this computer's internet connection." };
  }
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 429) return { ok: false, error: "busy", message: "DHL limits how often we can ask. Try again in a minute." };
  if (res.status === 401 || res.status === 403) return { ok: false, error: "key", message: "DHL didn't accept the API key in the .env file. Check that it's copied correctly and approved for Shipment Tracking." };
  if (!res.ok) return { ok: false, error: "carrier", message: `DHL answered with error ${res.status}. Try again later.` };
  const data = await res.json().catch(() => ({}));
  const s = data.shipments && data.shipments[0];
  return s ? { ok: true, shipment: fromDhl(s, code) } : { ok: false, error: "not_found" };
}

function track(code) {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.body);
  const run = async () => {
    const again = cache.get(code); // another request may have filled it while this one waited
    if (again && Date.now() - again.at < CACHE_MS) return again.body;
    const body = await askDhl(code);
    if (body.ok || body.error === "not_found") {
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      cache.set(code, { at: Date.now(), body });
    }
    return body;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---------- HTTP ----------
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "method" });

  if (url.pathname === "/api/config") {
    return send(res, 200, { live: Boolean(DHL_KEY), provider: DHL_KEY ? "DHL" : null });
  }
  if (url.pathname === "/api/track") {
    const code = String(url.searchParams.get("code") || "").toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9-]{6,44}$/.test(code)) return send(res, 400, { ok: false, error: "invalid", message: "That doesn't look like a tracking number." });
    if (!DHL_KEY) return send(res, 503, { ok: false, error: "off", message: "Live tracking is off. Add DHL_API_KEY to the .env file and restart the server." });
    return send(res, 200, await track(code));
  }

  const file = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!PUBLIC.test(file)) return send(res, 404, "Not found", "text/plain; charset=utf-8");
  fs.readFile(path.join(__dirname, file), (err, buf) => {
    if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, buf, TYPES[path.extname(file)] || "application/octet-stream");
  });
}).listen(PORT, HOST, () => {
  console.log(`Parcel Tracker: http://localhost:${PORT}  (${DHL_KEY ? "live DHL tracking on" : "sample data only; add DHL_API_KEY to .env for live DHL"})`);
  if (HOST === "0.0.0.0") {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === "IPv4" && !a.internal) console.log(`  on your Wi-Fi: http://${a.address}:${PORT}`);
    }
  }
});
