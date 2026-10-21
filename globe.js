// The Earth behind the app: a MapLibre globe that shows NASA's Blue Marble from space
// and fades into a dark street map close up. It spins slowly when idle, and whips
// around and dives in when a delivery is opened.
// MapLibre 5 comes from a classic <script> in index.html (window.maplibregl). Its bundled worker
// starts reliably in iPhone Safari, which MapLibre 6's module worker did not.
const lib = globalThis.maplibregl;

const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const BLUE_MARBLE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const EMPTY = { type: 'FeatureCollection', features: [] };
// Zoom at which the whole planet fits a box this size (its radius in px is about 81.5 * 2^zoom)
const fitZoom = (w, h) => Math.max(0.3, Math.log2((0.45 * Math.max(140, Math.min(w, h))) / 81.5));

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wrap = lng => ((((lng + 180) % 360) + 360) % 360) - 180;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const ICONS = {
  home: '<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 47C20 47 3 29.5 3 18.5a17 17 0 0 1 34 0C37 29.5 20 47 20 47Z" fill="#FFB547" stroke="#1B1204" stroke-width="2"/><path d="M12 19.5 20 12.5l8 7v8.5h-5.2v-5h-5.6v5H12Z" fill="#1B1204"/></svg>',
  dot: '<span></span>',
  pick: '<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 47C20 47 3 29.5 3 18.5a17 17 0 0 1 34 0C37 29.5 20 47 20 47Z" fill="#73B8FF" stroke="#06101F" stroke-width="2"/><circle cx="20" cy="18.5" r="6" fill="#06101F"/></svg>',
  courier: '<span class="pulse"></span><span class="arrow"></span><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#FFB547" stroke="#1B1204" stroke-width="2"/><g fill="none" stroke="#1B1204" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="20.5" r="3"/><circle cx="23" cy="20.5" r="3"/><path d="M13 20.5h5.5l2.5-6h-4M20.5 14.5 19 10h-2.5M8 13h6v4.5H8Z"/></g></svg>',
};

function element(html, className) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  return el;
}

// When the map can't start (no WebGL, or the library didn't load), the rest of the app keeps working
function noGlobe(container, reason) {
  console.warn('Map unavailable:', reason);
  container.innerHTML = `<div class="map-off"><strong>The map can't start in this browser.</strong><span>Your deliveries still work. Try updating the phone, or open the link in Safari or Chrome.</span></div>`;
  const done = Promise.resolve();
  const nothing = () => {};
  return {
    map: null, whenReady: done, isReady: () => false,
    spinTo: () => done, showEarth: nothing, fit: nothing, setInsets: nothing,
    setDestination: nothing, setCourier: nothing, setPlaces: nothing, setRoute: nothing,
    startPick: nothing, movePick: nothing, stopPick: nothing,
    zoom: () => 0, resize: nothing, isVisible: () => true, isFlying: () => false,
  };
}

export function createGlobe(container, options = {}) {
  if (!lib) return noGlobe(container, 'MapLibre did not load');
  try {
    return makeGlobe(container, options);
  } catch (err) {
    return noGlobe(container, err);
  }
}

function makeGlobe(container, { onMapClick, onPlaceClick, onUserMove } = {}) {
  const { Map, Marker, LngLatBounds } = lib;
  const map = new Map({
    container,
    style: STYLE,
    center: [31.2, 24],
    zoom: fitZoom(innerWidth, innerHeight),
    minZoom: 0.6,
    maxZoom: 18.5,
    // iPhones report 3x; drawing at 2x looks the same and keeps Safari inside its graphics memory
    pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    attributionControl: { compact: true, customAttribution: 'Earth imagery: NASA Blue Marble' },
  });

  // The dark street style names a few icons its sprite doesn't have; draw them as nothing
  map.on('styleimagemissing', e => {
    if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  // Safari can drop the graphics context when the app goes to the background; redraw when it's back
  map.on('webglcontextrestored', () => map.triggerRepaint());

  // The planet fills the part of the screen the panels leave free
  const spaceZoom = () => {
    const p = map.getPadding();
    return fitZoom(innerWidth - p.left - p.right, innerHeight - p.top - p.bottom);
  };

  let ready = false;
  const whenReady = new Promise(resolve => {
    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      map.addSource('earth', { type: 'raster', tiles: [BLUE_MARBLE], tileSize: 256, maxzoom: 8 });
      // Navy instead of black behind streets that are still loading
      if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', '#0E1524');
      // A blue ocean under the imagery, so the planet is never black while NASA's tiles download
      map.addLayer({
        id: 'ocean', type: 'background',
        paint: { 'background-color': '#0D3266', 'background-opacity': ['interpolate', ['linear'], ['zoom'], 4, 1, 7.5, 0] },
      });
      map.addLayer({
        id: 'earth', type: 'raster', source: 'earth',
        paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4, 1, 7.5, 0], 'raster-fade-duration': 250 },
      });
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route-shadow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#04060C', 'line-width': 9, 'line-opacity': 0.55 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFB547', 'line-width': 4.5 } });
      map.setSky({
        'sky-color': '#071022', 'horizon-color': '#3A78D6', 'fog-color': '#071022',
        'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
      });
      ready = true;
      resolve();
    });
  });

  // ---------- Idle spin (the Earth turns west to east, so the facing longitude drifts west) ----------
  let idle = true;
  let userBusy = false;
  let resumeTimer = 0;
  let lastFrame = 0;
  function tick(now) {
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    if (idle && !userBusy && !reduceMotion() && map.getZoom() < spaceZoom() + 1.5 && !map.isMoving()) {
      const c = map.getCenter();
      map.jumpTo({ center: [wrap(c.lng - dt * 0.004), c.lat] });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const busy = () => { userBusy = true; clearTimeout(resumeTimer); };
  const settle = () => { clearTimeout(resumeTimer); resumeTimer = setTimeout(() => { userBusy = false; }, 4000); };
  for (const type of ['mousedown', 'touchstart', 'wheel', 'dragstart']) map.on(type, busy);
  for (const type of ['mouseup', 'touchend', 'dragend']) map.on(type, settle);
  map.on('wheel', settle);

  map.on('dragstart', () => onUserMove && onUserMove());
  map.on('zoomstart', e => { if (e.originalEvent && onUserMove) onUserMove(); });

  map.on('click', e => {
    if (onMapClick) onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat, zoom: map.getZoom() });
  });

  // ---------- The fast spin and dive ----------
  let token = 0;
  const run = start => new Promise(resolve => { map.once('moveend', () => resolve()); start(); });

  function whirl(target, my) {
    return new Promise(resolve => {
      const c = map.getCenter();
      const fromLng = c.lng, fromLat = c.lat;
      const westward = (((fromLng - target.lng) % 360) + 360) % 360;
      const delta = -(westward + 360); // one full extra turn on the way
      const duration = 1700;
      const t0 = performance.now();
      const step = now => {
        if (my !== token) return resolve();
        const t = Math.min(1, (now - t0) / duration);
        const e = easeInOut(t);
        map.jumpTo({ center: [wrap(fromLng + delta * e), fromLat + (target.lat - fromLat) * e] });
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  let spinning = false;
  async function spinTo(target, zoom = 15.6) {
    const my = ++token;
    idle = false;
    spinning = true;
    try {
      await whenReady;
      map.stop();
      if (reduceMotion()) { map.jumpTo({ center: [target.lng, target.lat], zoom }); return; }
      if (map.getZoom() > spaceZoom() + 0.9) {
        await run(() => map.easeTo({ zoom: spaceZoom(), pitch: 0, bearing: 0, duration: 900, easing: easeInOut }));
        if (my !== token) return;
      }
      await whirl(target, my);
      if (my !== token) return;
      await run(() => map.flyTo({ center: [target.lng, target.lat], zoom, curve: 1.35, duration: 2600, essential: true }));
    } finally {
      if (my === token) spinning = false;
    }
  }

  // Is this point inside the part of the screen the panels leave free?
  function isVisible(p, margin = 48) {
    if (!ready) return true;
    const pt = map.project([p.lng, p.lat]);
    const pad = map.getPadding();
    const c = map.getContainer();
    return pt.x >= pad.left + margin && pt.x <= c.clientWidth - pad.right - margin
      && pt.y >= pad.top + margin && pt.y <= c.clientHeight - pad.bottom - margin;
  }

  function showEarth() {
    const my = ++token;
    spinning = false;
    const c = map.getCenter();
    whenReady.then(() => {
      if (my !== token) return;
      map.stop();
      const done = () => { if (my === token) idle = true; };
      if (map.getZoom() <= spaceZoom() + 0.2) return done();
      run(() => map.flyTo({ center: [c.lng, Math.max(-35, Math.min(35, c.lat))], zoom: spaceZoom(), pitch: 0, bearing: 0, duration: reduceMotion() ? 0 : 2000, essential: true })).then(done);
    });
  }

  function fit(points, { animate = true } = {}) {
    const my = ++token;
    idle = false;
    spinning = false;
    const pts = points.filter(Boolean);
    if (!pts.length) return;
    whenReady.then(() => {
      if (my !== token) return;
      if (pts.length === 1) { map.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: Math.max(map.getZoom(), 15), duration: animate ? 900 : 0 }); return; }
      const b = new LngLatBounds();
      pts.forEach(p => b.extend([p.lng, p.lat]));
      map.fitBounds(b, { padding: 70, maxZoom: 16.5, duration: animate ? 1100 : 0 });
    });
  }

  // Keep the camera looking at the part of the map the panels don't cover
  function setInsets(insets) {
    map.setPadding({ top: insets.top || 0, bottom: insets.bottom || 0, left: insets.left || 0, right: insets.right || 0 });
  }

  // ---------- Markers ----------
  const destMarker = new Marker({ element: element(ICONS.home, 'pin pin-home'), anchor: 'bottom' });
  const courierEl = element(ICONS.courier, 'pin pin-courier');
  const courierMarker = new Marker({ element: courierEl, anchor: 'center' });
  let courierAt = null;
  let courierAnim = 0;

  function setDestination(p) {
    if (!p) { destMarker.remove(); return; }
    destMarker.setLngLat([p.lng, p.lat]).addTo(map);
  }

  function setCourier(p, heading) {
    if (!p) { courierMarker.remove(); courierAt = null; return; }
    if (typeof heading === 'number' && !Number.isNaN(heading)) {
      courierEl.style.setProperty('--heading', `${heading}deg`);
      courierEl.classList.add('has-heading');
    } else courierEl.classList.remove('has-heading');
    if (!courierAt || reduceMotion()) {
      courierAt = { lng: p.lng, lat: p.lat };
      courierMarker.setLngLat([p.lng, p.lat]).addTo(map);
      return;
    }
    const from = { ...courierAt };
    const t0 = performance.now();
    const my = ++courierAnim;
    const step = now => {
      if (my !== courierAnim) return;
      const t = Math.min(1, (now - t0) / 900);
      courierAt = { lng: from.lng + (p.lng - from.lng) * t, lat: from.lat + (p.lat - from.lat) * t };
      courierMarker.setLngLat([courierAt.lng, courierAt.lat]);
      if (t < 1) requestAnimationFrame(step);
    };
    courierMarker.addTo(map);
    requestAnimationFrame(step);
  }

  // Small dots for every other delivery, so the globe shows where things are headed
  const places = new globalThis.Map();
  function setPlaces(list) {
    const keep = new Set(list.map(p => p.code));
    for (const [code, m] of places) if (!keep.has(code)) { m.remove(); places.delete(code); }
    for (const p of list) {
      let m = places.get(p.code);
      if (!m) {
        const el = element(ICONS.dot, 'pin pin-dot');
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.addEventListener('click', ev => { ev.stopPropagation(); onPlaceClick && onPlaceClick(p.code); });
        el.addEventListener('keydown', ev => { if (ev.key === 'Enter') onPlaceClick && onPlaceClick(p.code); });
        m = new Marker({ element: el, anchor: 'center' });
        places.set(p.code, m);
      }
      const el = m.getElement();
      el.dataset.tone = p.tone || 'idle';
      el.setAttribute('aria-label', `Open ${p.label}`);
      el.title = p.label;
      m.setLngLat([p.lng, p.lat]).addTo(map);
    }
  }

  function setRoute(coords) {
    whenReady.then(() => {
      const data = coords && coords.length > 1
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
        : EMPTY;
      map.getSource('route').setData(data);
    });
  }

  // ---------- Picking a delivery spot ----------
  let pickMarker = null;
  function startPick(initial, onChange) {
    stopPick();
    pickMarker = new Marker({ element: element(ICONS.pick, 'pin pin-pick'), anchor: 'bottom', draggable: true });
    if (initial) pickMarker.setLngLat([initial.lng, initial.lat]).addTo(map);
    pickMarker.on('dragend', () => { const ll = pickMarker.getLngLat(); onChange({ lng: ll.lng, lat: ll.lat }); });
  }
  function movePick(p) {
    if (!pickMarker) return;
    pickMarker.setLngLat([p.lng, p.lat]).addTo(map);
  }
  function stopPick() {
    if (pickMarker) pickMarker.remove();
    pickMarker = null;
  }

  return {
    map, whenReady, isReady: () => ready,
    spinTo, showEarth, fit, setInsets,
    setDestination, setCourier, setPlaces, setRoute,
    startPick, movePick, stopPick,
    zoom: () => map.getZoom(),
    isVisible,
    isFlying: () => spinning || map.isMoving(),
    resize: () => map.resize(),
  };
}
