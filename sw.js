// Service worker de la web instalable: guarda la app en el celular para usarla sin señal.
// Archivos propios: primero la red (así llegan las actualizaciones) y, sin señal, la copia guardada.
// Librería docx y fuentes: primero la copia guardada.
const VERSION = '20261105195342';
const CACHE = 'hys-' + VERSION;
const ARCHIVOS = ['./', 'index.html', 'manifest.webmanifest', 'iconos/icon-192.png', 'iconos/icon-512.png', 'normativa/novedades.json', 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js', 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js', 'https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.15/locales/es.global.min.js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', 'app/agenda-informes.js', 'app/agenda.js', 'app/app.js', 'app/importar.js', 'app/legajo.js', 'app/sync.js', 'motor/calculo.js', 'motor/informe-docx.js', 'motor/planilla-xlsx.js', 'modulos/arnes.json', 'modulos/autoelevadores.json', 'modulos/compresores.json', 'modulos/condiciones_generales.json', 'modulos/electrico.json', 'modulos/epp.json', 'modulos/ergonomia.json', 'modulos/extintores.json', 'modulos/index.json', 'modulos/izaje.json', 'modulos/legajo.json', 'modulos/luces_emergencia.json', 'modulos/maquinas.json', 'modulos/medios_escape.json', 'modulos/obra.json', 'modulos/orden_limpieza.json', 'modulos/oxicorte.json', 'modulos/primeros_auxilios.json', 'modulos/quimicos.json', 'modulos/retractiles.json', 'modulos/sujecion.json', 'config/legajo.json', 'config/normativa.json', 'config/rubros.json', 'textos/plantillas.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARCHIVOS.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hys-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// ===== Avisos con la app cerrada =====
// El servidor no conoce visitas ni clientes: a las 19:00 y a las 08:00 solo despierta al celular ({tipo: 'noche' | 'manana'}).
// El mensaje se arma acá, con los datos del dispositivo y el pronóstico. Misma lógica que alertasClima y chequeo de app/agenda.js.
const diaISO = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const masDias = (f, n) => { const [y, m, d] = f.split('-').map(Number); return diaISO(new Date(y, m - 1, d + n)); };
const diaCorto = f => { const [y, m, d] = f.split('-').map(Number); return `${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][new Date(y, m - 1, d).getDay()]} ${f.slice(8)}/${f.slice(5, 7)}`; };
const abrirBase = () => new Promise((res, rej) => { const r = indexedDB.open('relevamientos-hys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
// Lee de a un registro y se queda solo con lo liviano (las fotos no pasan a memoria)
const leer = (db, s, elegir = x => x) => new Promise((res, rej) => {
  const out = [], q = db.transaction(s).objectStore(s).openCursor();
  q.onsuccess = () => { const c = q.result; if (!c) return res(out); const x = elegir(c.value); if (x) out.push(x); c.continue(); };
  q.onerror = () => rej(q.error);
});
const guardar = (db, s, v) => new Promise((res, rej) => { const t = db.transaction(s, 'readwrite'); t.objectStore(s).put(v); t.oncomplete = res; t.onerror = () => rej(t.error); });
const claveClima = (la, lo) => `${(+la).toFixed(2)},${(+lo).toFixed(2)}`;
async function actualizarPronostico(claves, clima){
  const viejos = claves.filter(k => !clima.puntos[k] || Date.now() - clima.puntos[k].t > 3 * 3600e3);
  for (let i = 0; i < viejos.length; i += 40) {
    const grupo = viejos.slice(i, i + 40), la = grupo.map(k => k.split(',')[0]).join(','), lo = grupo.map(k => k.split(',')[1]).join(',');
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min&past_days=2&forecast_days=16&timezone=America%2FArgentina%2FBuenos_Aires`);
      if (!r.ok) continue;
      const j = [].concat(await r.json());
      grupo.forEach((k, n) => {
        const d = j[n].daily, dias = {};
        d.time.forEach((f, x) => dias[f] = {code: d.weather_code[x], prob: d.precipitation_probability_max[x] ?? 0, mm: d.precipitation_sum[x] ?? 0, viento: d.wind_speed_10m_max[x] ?? 0, max: d.temperature_2m_max[x], min: d.temperature_2m_min[x]});
        clima.puntos[k] = {t: Date.now(), dias};
      });
    } catch (err) { console.warn('Clima', err); }   // sin señal: sirve el último pronóstico guardado
  }
}
async function calcularAvisos(tipo){
  const db = await abrirBase();
  db.onversionchange = () => db.close();
  try {
    const [vis, ests, emps, conf] = await Promise.all([
      leer(db, 'visitas', v => v.estado === 'planificada' ? {id: v.id, estabId: v.estabId, empresaId: v.empresaId, fecha: v.fecha, hora: v.hora, tareas: v.tareas || []} : null),
      leer(db, 'establecimientos', s => ({id: s.id, nombre: s.nombre, empresaId: s.empresaId, lat: s.lat, lng: s.lng})),
      leer(db, 'empresas', e => ({id: e.id, razonSocial: e.razonSocial})),
      leer(db, 'config')
    ]);
    const cfg = id => conf.find(c => c.id === id), h = diaISO(new Date()), en7 = masDias(h, 7), man = masDias(h, 1);
    const u = {prob: 60, mm: 2, viento: 40, pat: 10, ...cfg('perfil')?.clima};
    const acts = cfg('actividades')?.lista, sensible = t => acts ? !!acts.find(a => a.id === t.actividadId)?.clima : ['act2', 'act7', 'act8', 'act9'].includes(t.actividadId);
    const clima = {id: 'clima', puntos: {}, avisadas: {}, ...cfg('clima')}, local = {id: 'avisosLocal', ...cfg('avisosLocal')};
    const estab = id => ests.find(s => s.id === id);
    const punto = v => { const s = estab(v.estabId); return s?.lat != null ? claveClima(s.lat, s.lng) : claveClima(-32.9468, -60.6393); };
    const cliente = v => { const s = estab(v.estabId), e = emps.find(x => x.id === (s?.empresaId || v.empresaId)); return !e ? s?.nombre || 'Cliente' : ests.filter(x => x.empresaId === e.id).length > 1 ? `${e.razonSocial} · ${s?.nombre}` : e.razonSocial; };
    const futuras = vis.filter(v => v.fecha >= h && v.fecha <= en7);
    await actualizarPronostico([...new Set(futuras.map(punto))], clima);
    const dia = (v, f) => clima.puntos[punto(v)]?.dias[f];
    const mensajes = [], alertas = [];
    for (const v of futuras) {
      const sens = v.tareas.filter(sensible), d = dia(v, v.fecha), k = v.id + '|' + v.fecha;
      if (!sens.length || !d || clima.avisadas[k]) continue;
      const m = [];
      if (d.prob > u.prob || d.mm > u.mm) m.push(`lluvia ${d.prob}% (${d.mm} mm)`);
      if (d.viento > u.viento) m.push(`viento ${Math.round(d.viento)} km/h`);
      if (sens.some(t => /\bpat\b|puesta a tierra/i.test(t.nombre))) {
        const previa = [1, 2].reduce((n, i) => n + (dia(v, masDias(v.fecha, -i))?.mm || 0), 0);
        if (previa > u.pat) m.push(`${Math.round(previa)} mm en las 48 h previas (PAT)`);
      }
      if (m.length) { clima.avisadas[k] = Date.now(); alertas.push(`${cliente(v)} (${diaCorto(v.fecha)}): ${sens.map(t => t.nombre).join(', ')}: ${m.join(', ')}`); }
    }
    if (alertas.length) mensajes.push({titulo: 'Alerta de clima', cuerpo: alertas.join('\n')});
    if (tipo === 'noche' && local.noche !== h) {
      const vm = vis.filter(v => v.fecha === man).sort((a, b) => String(a.hora || '99').localeCompare(String(b.hora || '99')));
      if (vm.length) {
        local.noche = h;
        mensajes.push({titulo: `Mañana: ${vm.length} ${vm.length === 1 ? 'visita' : 'visitas'}`, cuerpo: vm.map(v => { const d = dia(v, man); return `${v.hora || 'Sin hora'} ${cliente(v)}${d ? ` · ${Math.round(d.max)}° · lluvia ${d.prob}%` : ''}`; }).join('\n')});
      }
    }
    if (tipo === 'manana' && local.manana !== h) {
      const sin = vis.filter(v => v.fecha < h).length;
      if (sin) { local.manana = h; mensajes.push({titulo: 'Visitas sin cerrar', cuerpo: `Tenés ${sin} ${sin === 1 ? 'visita pasada' : 'visitas pasadas'} sin cerrar.`}); }
    }
    await guardar(db, 'config', clima);
    await guardar(db, 'config', local);
    return mensajes;
  } finally { db.close(); }
}
const mostrar = (titulo, cuerpo, tag) => self.registration.showNotification(titulo, {body: cuerpo, icon: 'iconos/icon-192.png', badge: 'iconos/icon-192.png', tag: tag || undefined});
async function avisosLocales(tipo){
  let mensajes;
  try { mensajes = await calcularAvisos(tipo); }
  catch (err) { console.warn('Avisos', err); mensajes = [{titulo: 'Relevamientos HyS', cuerpo: 'Abrí la app para ver tus visitas y avisos.'}]; }
  if (mensajes.length) return Promise.all(mensajes.map(m => mostrar(m.titulo, m.cuerpo, m.titulo)));
  // Sin novedades: el navegador exige mostrar algo cada vez que despierta a la app; se muestra y se cierra al instante
  await self.registration.showNotification('Relevamientos HyS', {body: 'Sin novedades', tag: 'sin-novedades', silent: true});
  (await self.registration.getNotifications({tag: 'sin-novedades'})).forEach(n => n.close());
}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {cuerpo: e.data ? e.data.text() : ''}; }
  e.waitUntil(d.tipo ? avisosLocales(d.tipo) : mostrar(d.titulo || 'Relevamientos HyS', d.cuerpo || '', d.tag));
});
// Para revisar desde la app qué avisaría, sin mostrar nada
self.addEventListener('message', e => {
  if (e.data?.calcularAvisos) e.waitUntil(calcularAvisos(e.data.calcularAvisos).then(m => e.ports[0]?.postMessage(m)).catch(err => e.ports[0]?.postMessage({error: err.message})));
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
