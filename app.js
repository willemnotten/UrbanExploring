// ─── Constanten ───────────────────────────────────────────────────────────────
const METERS_PER_DEGREE    = 111320;
const TILE_SIZE_METERS     = 10;
const CLAIM_RADIUS_METERS  = 10;   // Speler moet binnen 10m zijn om te claimen
const FOG_RADIUS_METERS    = 200;  // Tiles binnen dit bereik worden ontdekt
const RENDER_RADIUS_METERS = 200;  // Hard cap voor renderen (was verward met FOG_RADIUS)
const ENEMY_MOVE_INTERVAL  = 4000; // ms tussen enemy-bewegingen
const GRID_DEBOUNCE_MS     = 1000; // ms debounce voor generateGrid na GPS-update
const OSM_CACHE_MARGIN     = 0.002; // graden — cache invalideren als bounds > marge verschuiven

// ─── Kaartinitialisatie ────────────────────────────────────────────────────────
const map = L.map('map').setView([52.35, 5.22], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// ─── Spelstatus ────────────────────────────────────────────────────────────────
let playerPosition = null;
let playerMarker   = null;
let enemyMarker    = null;
let enemyPosition  = [52.36, 5.23];
let gridTimeout    = null;

const gridLayer = L.layerGroup().addTo(map);

// Persistente speldata via localStorage
let claimedTiles    = JSON.parse(localStorage.getItem("claimedTiles")    || "{}");
let enemyTiles      = JSON.parse(localStorage.getItem("enemyTiles")      || "{}");
let discoveredTiles = JSON.parse(localStorage.getItem("discoveredTiles") || "{}");

// ─── OSM-datacache ─────────────────────────────────────────────────────────────
// Voorkomt dubbele Overpass-requests als de bounds nauwelijks veranderd zijn
let osmCache = {
  bounds: null,
  waterData: null,
  roadsData: null,
};

function isCacheValid(bounds) {
  if (!osmCache.bounds) return false;
  const b = osmCache.bounds;
  return (
    Math.abs(bounds.getNorth() - b.getNorth()) < OSM_CACHE_MARGIN &&
    Math.abs(bounds.getSouth() - b.getSouth()) < OSM_CACHE_MARGIN &&
    Math.abs(bounds.getEast()  - b.getEast())  < OSM_CACHE_MARGIN &&
    Math.abs(bounds.getWest()  - b.getWest())  < OSM_CACHE_MARGIN
  );
}

// ─── GPS-tracking ──────────────────────────────────────────────────────────────
navigator.geolocation.watchPosition(
  (pos) => {
    playerPosition = [pos.coords.latitude, pos.coords.longitude];
    map.setView(playerPosition, map.getZoom(), { animate: false });

    if (!playerMarker) {
      playerMarker = L.marker(playerPosition).addTo(map);
    } else {
      playerMarker.setLatLng(playerPosition);
    }

    // Debounce: voorkomt tientallen Overpass-requests per minuut
    clearTimeout(gridTimeout);
    gridTimeout = setTimeout(generateGrid, GRID_DEBOUNCE_MS);
  },
  (err) => {
    console.error("GPS-fout:", err.message);
  },
  { enableHighAccuracy: true }
);

// ─── Kaartrotatie op mobiel ────────────────────────────────────────────────────
if (window.DeviceOrientationEvent) {
  window.addEventListener("deviceorientationabsolute", (event) => {
    if (event.alpha != null) {
      map.setBearing(event.alpha);
    }
  });
}

// ─── Enemy-simulatie ───────────────────────────────────────────────────────────
function updateEnemyPosition() {
  const dx = (Math.random() - 0.5) * 0.002;
  const dy = (Math.random() - 0.5) * 0.002;
  enemyPosition = [enemyPosition[0] + dx, enemyPosition[1] + dy];
  updateEnemyMarker();

  // Ruim verlaten enemy-tiles op: verwijder tiles die niet meer nabij de enemy zijn
  for (const key of Object.keys(enemyTiles)) {
    const [latStr, lngStr] = key.split("_");
    const tileLat = parseFloat(latStr);
    const tileLng = parseFloat(lngStr);
    const dist = distanceBetween([tileLat, tileLng], enemyPosition);
    if (dist > CLAIM_RADIUS_METERS * 3) {
      delete enemyTiles[key];
    }
  }
  localStorage.setItem("enemyTiles", JSON.stringify(enemyTiles));
}

setInterval(updateEnemyPosition, ENEMY_MOVE_INTERVAL);

// ─── Grid genereren ────────────────────────────────────────────────────────────
async function generateGrid() {
  if (!playerPosition) {
    console.warn("Nog geen spelerlocatie beschikbaar.");
    return;
  }

  gridLayer.clearLayers();

  const bounds  = map.getBounds();
  const centerLat = map.getCenter().lat;
  const latStep = TILE_SIZE_METERS / METERS_PER_DEGREE;
  const lngStep = TILE_SIZE_METERS / (METERS_PER_DEGREE * Math.cos(centerLat * Math.PI / 180));

  // Gebruik gecachede OSM-data als bounds weinig veranderd zijn
  let waterData, roadsData;
  if (isCacheValid(bounds)) {
    waterData = osmCache.waterData;
    roadsData = osmCache.roadsData;
  } else {
    [waterData, roadsData] = await Promise.all([
      fetchWaterData(bounds),
      fetchRoads(bounds),
    ]);
    osmCache = { bounds, waterData, roadsData };
  }

  // Fallback op lege arrays als een fetch mislukt
  const roads = (roadsData.elements || [])
    .filter(el => el.geometry)
    .flatMap(el => el.geometry);

  const waterPolygons = (waterData.elements || [])
    .filter(el => el.geometry)
    .map(el => el.geometry);

  for (let lat = bounds.getSouth(); lat < bounds.getNorth(); lat += latStep) {
    for (let lng = bounds.getWest(); lng < bounds.getEast(); lng += lngStep) {

      const center = [lat + latStep / 2, lng + lngStep / 2];
      const key    = tileKey(lat, lng);

      const distToPlayer = distanceBetween(center, playerPosition);
      const distToEnemy  = distanceBetween(center, enemyPosition);

      // Fog-of-war: markeer als ontdekt
      if (distToPlayer < FOG_RADIUS_METERS) {
        discoveredTiles[key] = true;
        localStorage.setItem("discoveredTiles", JSON.stringify(discoveredTiles));
      }

      // Auto-claim: alleen als speler er direct overheen loopt
      if (distToPlayer < CLAIM_RADIUS_METERS && !claimedTiles[key]) {
        claimedTiles[key] = true;
        localStorage.setItem("claimedTiles", JSON.stringify(claimedTiles));
      }

      // Enemy claimen
      if (distToEnemy < CLAIM_RADIUS_METERS) {
        enemyTiles[key] = true;
        localStorage.setItem("enemyTiles", JSON.stringify(enemyTiles));
      }

      // Niet renderen buiten render-radius of buiten fog-of-war
      if (distToPlayer > RENDER_RADIUS_METERS) continue;
      if (!discoveredTiles[key] && distToPlayer > FOG_RADIUS_METERS) continue;

      // Watercheck
      const samplePoints = [
        center,
        [lat, lng],
        [lat + latStep, lng],
        [lat, lng + lngStep],
        [lat + latStep, lng + lngStep],
      ];
      const isWater = waterPolygons.some(poly =>
        samplePoints.some(p => pointInPolygon(p, poly))
      );
      if (isWater) continue;

      // Wegcheck
      const nearRoad = roads.some(p => distanceBetween(center, [p.lat, p.lon]) < 40);
      if (!nearRoad) continue;

      // Kleur bepalen
      const isPlayerClaimed = claimedTiles[key];
      const isEnemyClaimed  = enemyTiles[key];
      let color = 'green';
      let fill  = 0.3;
      if (isEnemyClaimed) {
        color = 'red';
        fill  = 0.6;
      } else if (isPlayerClaimed) {
        color = 'blue';
        fill  = 0.6;
      }

      const square = [
        [lat,           lng],
        [lat + latStep, lng],
        [lat + latStep, lng + lngStep],
        [lat,           lng + lngStep],
      ];

      const polygon = L.polygon(square, {
        color,
        weight: 1,
        fillOpacity: fill,
      }).addTo(gridLayer);

      // Claimen via klik — alleen als speler dichtbij genoeg is
      polygon.on('click', () => {
        if (!playerPosition) return;
        const clickDist = distanceBetween(center, playerPosition);
        if (clickDist > CLAIM_RADIUS_METERS * 5) {
          // Kleine marge voor klikken op kaart (speler hoeft niet exact op tile te staan)
          alert("Je bent te ver weg om deze tile te claimen!");
          return;
        }
        claimedTiles[key] = true;
        enemyTiles[key]   = false;
        localStorage.setItem("claimedTiles", JSON.stringify(claimedTiles));
        localStorage.setItem("enemyTiles",   JSON.stringify(enemyTiles));
        generateGrid();
      });
    }
  }
}

// ─── Enemy-marker bijwerken ────────────────────────────────────────────────────
function updateEnemyMarker() {
  if (!enemyPosition) return;

  const enemyLatLng = L.latLng(enemyPosition[0], enemyPosition[1]);
  const isVisible   = map.getBounds().contains(enemyLatLng);

  if (!isVisible) {
    if (enemyMarker) {
      map.removeLayer(enemyMarker);
      enemyMarker = null;
    }
    return;
  }

  if (!enemyMarker) {
    enemyMarker = L.marker(enemyLatLng, { title: "Enemy" }).addTo(map);
  } else {
    enemyMarker.setLatLng(enemyLatLng);
  }
}

// ─── Hulpfuncties ──────────────────────────────────────────────────────────────

/**
 * Unieke sleutel voor een tile op basis van lat/lng.
 */
function tileKey(lat, lng) {
  return lat.toFixed(5) + "_" + lng.toFixed(5);
}

/**
 * Afstand in meters tussen twee punten.
 * Beide punten als [lat, lng] array.
 */
function distanceBetween(a, b) {
  const lat1 = Array.isArray(a) ? a[0] : a.lat;
  const lng1 = Array.isArray(a) ? a[1] : a.lng ?? a.lon;
  const lat2 = Array.isArray(b) ? b[0] : b.lat;
  const lng2 = Array.isArray(b) ? b[1] : b.lng ?? b.lon;

  const dx = (lng1 - lng2) * METERS_PER_DEGREE * Math.cos(lat1 * Math.PI / 180);
  const dy = (lat1 - lat2) * METERS_PER_DEGREE;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Controleert of een punt [lat, lng] binnen een polygoon ligt.
 * Polygoon is een array van { lat, lon } objecten (Overpass-formaat).
 */
function pointInPolygon(point, vs) {
  if (!vs || vs.length < 3) return false;

  const x = point[0];
  const y = point[1];

  // Snelle bounding-box pre-check
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vs) {
    minX = Math.min(minX, v.lat);
    maxX = Math.max(maxX, v.lat);
    minY = Math.min(minY, v.lon);
    maxY = Math.max(maxY, v.lon);
  }
  if (x < minX || x > maxX || y < minY || y > maxY) return false;

  // Ray-casting algoritme
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].lat, yi = vs[i].lon;
    const xj = vs[j].lat, yj = vs[j].lon;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── OSM-datafetchers ──────────────────────────────────────────────────────────

async function fetchWaterData(bounds) {
  const query = `
    [out:json][timeout:10];
    (
      way["natural"="water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
      relation["natural"="water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
    );
    out geom;
  `;
  try {
    const response = await fetch("https://overpass.kumi.systems/api/interpreter", {
      method: "POST",
      body: query,
    });
    return await response.json();
  } catch (e) {
    console.error("Water-fetch mislukt:", e);
    return { elements: [] };
  }
}

async function fetchRoads(bounds) {
  const query = `
    [out:json][timeout:10];
    way["highway"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
    out geom;
  `;
  try {
    const res = await fetch("https://overpass.kumi.systems/api/interpreter", {
      method: "POST",
      body: query,
    });
    return await res.json();
  } catch (e) {
    console.error("Wegen-fetch mislukt:", e);
    return { elements: [] };
  }
}