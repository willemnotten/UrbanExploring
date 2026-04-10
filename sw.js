self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('v1').then(cache =>
      cache.addAll([
        '/',
        '/index.html',
        '/app.js'
      ])
    )
  );
});