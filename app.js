const map = L.map('map').setView([52.35, 5.22], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
}).addTo(map);

let gridLayer = L.layerGroup().addTo(map);

function generateGrid() {
  gridLayer.clearLayers();

  const bounds = map.getBounds();
  const centerLat = map.getCenter().lat;

  const latStep = 50 / 111320;
  const lngStep = 50 / (111320 * Math.cos(centerLat * Math.PI / 180));

  for (let lat = bounds.getSouth(); lat < bounds.getNorth(); lat += latStep) {
    for (let lng = bounds.getWest(); lng < bounds.getEast(); lng += lngStep) {

      const square = [
        [lat, lng],
        [lat + latStep, lng],
        [lat + latStep, lng + lngStep],
        [lat, lng + lngStep]
      ];

      L.polygon(square, {
        color: 'blue',
        weight: 1,
        fillOpacity: 0.2
      }).addTo(gridLayer);
    }
  }
}