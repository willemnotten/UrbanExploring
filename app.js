const map = L.map('map').setView([52.35, 5.22], 16);

let playerPosition = null;

navigator.geolocation.watchPosition(pos => {
  playerPosition = [pos.coords.latitude, pos.coords.longitude];
  map.setView(playerPosition, 17);
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
}).addTo(map);

let gridLayer = L.layerGroup().addTo(map);

let claimedTiles = JSON.parse(localStorage.getItem("claimedTiles") || "{}");

function tileKey(lat, lng) {
  return lat.toFixed(5) + "_" + lng.toFixed(5);
}

async function generateGrid() {
  gridLayer.clearLayers();

  const bounds = map.getBounds();

  if (!playerPosition) {
    console.warn("No player position yet");
    return;
  }

  const maxRadius = 500; // meters
  const activeRadius = 200; // meters

  const centerLat = map.getCenter().lat;

  const latStep = 10 / 111320;
  const lngStep = 10 / (111320 * Math.cos(centerLat * Math.PI / 180));

  const waterData = await fetchWaterData(bounds);
  console.log("Water elements:", waterData.elements?.length);

  const roadsData = await fetchRoads(bounds);
  console.log("Road elements:", roadsData.elements?.length);

  if (!waterData.elements && !roadsData.elements) {
    console.warn("No OSM data returned");
    return;
  }

  const roads = roadsData.elements
    .filter(el => el.geometry)
    .flatMap(el => el.geometry);

  const waterPolygons = waterData.elements
    .filter(el => el.geometry)
    .map(el => el.geometry);

  for (let lat = bounds.getSouth(); lat < bounds.getNorth(); lat += latStep) {
    for (let lng = bounds.getWest(); lng < bounds.getEast(); lng += lngStep) {

      const center = [lat + latStep / 2, lng + lngStep / 2];

      const distToPlayer = distance(center, { lat: playerPosition[0], lon: playerPosition[1] });

      if (distToPlayer < 5) {
        const key = tileKey(lat, lng);
        claimedTiles[key] = true;
      }

      // hard cap: don't generate beyond 500m
      if (distToPlayer > maxRadius) continue;

      // only render within 200m
      if (distToPlayer > activeRadius) continue;

      const key = tileKey(lat, lng);
      const isClaimed = claimedTiles[key];

      const samplePoints = [
        center,
        [lat, lng],
        [lat + latStep, lng],
        [lat, lng + lngStep],
        [lat + latStep, lng + lngStep]
      ];

      const isWater = waterPolygons.some(poly =>
        samplePoints.some(p => pointInPolygon(p, poly))
      );

      if (isWater) continue;

      const nearRoad = roads.some(p => distance(center, p) < 40);
      if (!nearRoad) continue;

      const square = [
        [lat, lng],
        [lat + latStep, lng],
        [lat + latStep, lng + lngStep],
        [lat, lng + lngStep]
      ];

      const polygon = L.polygon(square, {
        color: isClaimed ? 'red' : 'green',
        weight: 1,
        fillOpacity: isClaimed ? 0.6 : 0.3
      }).addTo(gridLayer);

      polygon.on('click', () => {
        claimedTiles[key] = true;
        localStorage.setItem("claimedTiles", JSON.stringify(claimedTiles));
        generateGrid();
      });
    }
  }
}

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
      body: query
    });

    const text = await response.text();
    return JSON.parse(text);
  } catch (e) {
    console.error("Water fetch failed", e);
    return { elements: [] };
  }
}

function pointInPolygon(point, vs) {
  if (!vs || vs.length < 3) return false;

  let x = point[0], y = point[1];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vs.length; i++) {
    minX = Math.min(minX, vs[i].lat);
    maxX = Math.max(maxX, vs[i].lat);
    minY = Math.min(minY, vs[i].lon);
    maxY = Math.max(maxY, vs[i].lon);
  }
  if (x < minX || x > maxX || y < minY || y > maxY) return false;

  let inside = false;

  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i].lat, yi = vs[i].lon;
    let xj = vs[j].lat, yj = vs[j].lon;

    let intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
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
      body: query
    });

    const text = await res.text();
    return JSON.parse(text);
  } catch (e) {
    console.error("Road fetch failed", e);
    return { elements: [] };
  }
}


function distance(a, b) {
  const dx = (a[1] - b.lon) * 111320 * Math.cos(a[0] * Math.PI / 180);
  const dy = (a[0] - b.lat) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}