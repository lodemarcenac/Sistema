/************************************************************************
 * sw.js — Service worker del sistema (PWA).
 * Objetivo: permitir instalar la app en el celular y dar un fallback
 * OFFLINE básico, SIN servir versiones viejas en PC ni en el cel.
 *
 * Estrategia = NETWORK-FIRST para lo propio (HTML/JS/CSS): siempre
 * intenta la red primero (así nunca queda pegado en una versión vieja;
 * el mecanismo "Actualizar" + version.json sigue mandando). Si no hay
 * internet, cae a lo último que quedó en caché. Las llamadas a Supabase
 * (datos en vivo) y version.json NO se tocan: pasan directo a la red.
 ************************************************************************/
var CACHE = 'carniceria-rt-v1';

self.addEventListener('install', function(e){ self.skipWaiting(); });

self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    var keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;                 // solo GET (no cachear POST/auth)
  var url;
  try { url = new URL(req.url); } catch(err){ return; }

  // Datos en vivo: Supabase (REST, auth, functions, realtime) → sin tocar.
  if (/\.supabase\.(co|in)$/.test(url.hostname)) return;
  // version.json siempre fresco (es el que dispara "Actualizar").
  if (/version\.json$/.test(url.pathname)) return;

  var sameOrigin = (url.origin === self.location.origin);

  if (sameOrigin) {
    // Red primero; si no hay internet, lo último cacheado.
    e.respondWith((async function(){
      try {
        var res = await fetch(req);
        if (res && res.ok) { var c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        var cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          var home = await caches.match('./index.html');
          if (home) return home;
        }
        throw err;
      }
    })());
  } else {
    // CDN de librerías/fuentes (URLs versionadas): caché primero.
    e.respondWith((async function(){
      var cached = await caches.match(req);
      if (cached) return cached;
      try {
        var res = await fetch(req);
        if (res && res.ok) { var c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
