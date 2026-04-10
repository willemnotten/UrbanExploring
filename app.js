const map = L.map('map').setView([52.35, 5.22], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
}).addTo(map);

let gridLayer = L.layerGroup().addTo(map);

async function generateGrid() {
  gridLayer.clearLayers();

  const bounds = map.getBounds();
  const centerLat = map.getCenter().lat;

  const latStep = 50 / 111320;
  const lngStep = 50 / (111320 * Math.cos(centerLat * Math.PI / 180));

  const waterData = await fetchWaterData(bounds);

  const roadsData = await fetchRoads(bounds);

  const roads = roadsData.elements
    .filter(el => el.geometry)
    .flatMap(el => el.geometry);

  const waterPolygons = waterData.elements
    .filter(el => el.geometry)
    .map(el => el.geometry);

  for (let lat = bounds.getSouth(); lat < bounds.getNorth(); lat += latStep) {
    for (let lng = bounds.getWest(); lng < bounds.getEast(); lng += lngStep) {

      const center = [lat + latStep / 2, lng + lngStep / 2];

      const isWater = waterPolygons.some(poly =>
        pointInPolygon(center, poly)
      );

      if (isWater) continue;

      const nearRoad = roads.some(p => distance(center, p) < 0.0003);
      if (!nearRoad) continue;

      const square = [
        [lat, lng],
        [lat + latStep, lng],
        [lat + latStep, lng + lngStep],
        [lat, lng + lngStep]
      ];

      L.polygon(square, {
        color: 'green',
        weight: 1,
        fillOpacity: 0.3
      }).addTo(gridLayer);
    }
  }
}

async function fetchWaterData(bounds) {
  const query = `
    [out:json];
    (
      way["natural"="water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
      relation["natural"="water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
    );
    out geom;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query
  });

  return response.json();
}

function pointInPolygon(point, vs) {
  let x = point[0], y = point[1];
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
    [out:json];
    way["highway"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
    out geom;
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query
  });

  return res.json();
}


function distance(a, b) {
  return Math.sqrt(
    Math.pow(a[0] - b.lat, 2) + Math.pow(a[1] - b.lon, 2)
  );
}