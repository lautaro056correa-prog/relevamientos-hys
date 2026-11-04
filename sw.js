// Service worker de la web instalable: guarda la app en el celular para usarla sin señal.
// Archivos propios: primero la red (así llegan las actualizaciones) y, sin señal, la copia guardada.
// Librería docx y fuentes: primero la copia guardada.
const VERSION = '20261104085437';
const CACHE = 'hys-' + VERSION;
const ARCHIVOS = ['./', 'index.html', 'manifest.webmanifest', 'iconos/icon-192.png', 'iconos/icon-512.png', 'normativa/novedades.json', 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js', 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js', 'https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.15/locales/es.global.min.js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'app/agenda-informes.js', 'app/agenda.js', 'app/app.js', 'app/legajo.js', 'app/sync.js', 'motor/calculo.js', 'motor/informe-docx.js', 'motor/planilla-xlsx.js', 'modulos/arnes.json', 'modulos/autoelevadores.json', 'modulos/compresores.json', 'modulos/condiciones_generales.json', 'modulos/electrico.json', 'modulos/epp.json', 'modulos/ergonomia.json', 'modulos/extintores.json', 'modulos/index.json', 'modulos/izaje.json', 'modulos/legajo.json', 'modulos/luces_emergencia.json', 'modulos/maquinas.json', 'modulos/medios_escape.json', 'modulos/obra.json', 'modulos/orden_limpieza.json', 'modulos/oxicorte.json', 'modulos/primeros_auxilios.json', 'modulos/quimicos.json', 'modulos/retractiles.json', 'modulos/sujecion.json', 'config/legajo.json', 'config/normativa.json', 'config/rubros.json', 'textos/plantillas.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARCHIVOS.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hys-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Avisos con la app cerrada (los manda la función "avisos" del servidor)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {cuerpo: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Relevamientos HyS', {body: d.cuerpo || '', icon: 'iconos/icon-192.png', badge: 'iconos/icon-192.png', tag: d.tag || undefined}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const host = new URL(r.url).host, propio = host === location.host;
  // Los datos de la cuenta nunca se guardan en el caché: van directo al servidor
  if (host.endsWith('.supabase.co')) return;
  // Datos que cambian (clima, feriados, direcciones, mapas): siempre de la red; sin señal, la última copia si hay
  const cambiante = /open-meteo\.com|argentinadatos\.com|nominatim\.openstreetmap\.org|tile\.openstreetmap\.org/.test(host);
  if (cambiante) {
    e.respondWith(fetch(r).then(res => {
      if (res.ok && !host.startsWith('tile.')) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(r, copia)); }
      return res;
    }).catch(() => caches.match(r).then(m => m || Response.error())));
    return;
  }
  if (propio) {
    e.respondWith(fetch(r).then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(r.url.split('?')[0], copia)); }
      return res;
    }).catch(() => caches.match(r.url.split('?')[0]).then(m => m || caches.match('./'))));
  } else {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok || res.type === 'opaque') { const copia = res.clone(); caches.open(CACHE).then(c => c.put(r, copia)); }
      return res;
    })));
  }
});
