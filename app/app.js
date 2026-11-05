// App de relevamientos HyS: pantallas de carga.
// Estructura: razón social → establecimientos → (relevamientos, panel de control, seguimiento de desvíos, informe de desvíos).
// El formulario se dibuja con la misma configuración del módulo (modulos/*.json) que usa el informe,
// así lo que se carga y lo que se informa nunca se desfasan.
// Los datos quedan solo en este navegador (IndexedDB); la copia de seguridad los exporta a un .json.

// ===== Almacenamiento local (IndexedDB) =====
const STORES = ['empresas', 'establecimientos', 'relevamientos', 'seguimiento', 'config', 'visitas', 'pendientes', 'semanas', 'legajo', 'sync_cola', 'sync_ver'];
const db = new Promise((res, rej) => {
  try {
    const r = indexedDB.open('relevamientos-hys', 6);
    r.onupgradeneeded = () => {
      for (const s of STORES)
        if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, {keyPath: 'id'});
    };
    // Si una versión nueva de la app necesita actualizar la base, esta pestaña cede y se recarga
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); location.reload(); }; res(r.result); };
    r.onerror = () => rej(r.error);
    // Otra pestaña vieja (sin la línea de arriba) tiene la base abierta: se destraba sola al cerrarla
    r.onblocked = () => { document.getElementById('app').innerHTML = aviso('aviso', 'info', 'La app se actualizó. Cerrá las otras pestañas o ventanas donde la tengas abierta y esperá unos segundos.'); };
  } catch (e) { rej(e); }
});
function tx(store, mode, fn){
  return db.then(d => new Promise((res, rej) => {
    const q = fn(d.transaction(store, mode).objectStore(store));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));
}
const getAll = s => tx(s, 'readonly', o => o.getAll());
const getOne = (s, id) => tx(s, 'readonly', o => o.get(id));
// Toda escritura queda anotada para sincronizar (app/sync.js)
const put = (s, v) => tx(s, 'readwrite', o => o.put(v)).then(async r => { await Sync.anotar(s, v.id); return r; });
const del = (s, id) => tx(s, 'readwrite', o => o.delete(id)).then(async r => { await Sync.anotar(s, id, true); return r; });

// Preferencias del dispositivo (solo comodidad: si el navegador no las guarda, no pasa nada)
const pref = {
  get: k => { try { return localStorage.getItem('hys.' + k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem('hys.' + k, v); } catch {} }
};

// ===== Utilidades =====
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const hoy = () => iso(new Date());
const fmtFecha = f => f ? f.split('-').reverse().join('/') : '';
const aFecha = f => { const [y, m, d] = f.split('-').map(Number); return new Date(y, m - 1, d); };
const sumarMeses = (f, n) => { const d = aFecha(f), dia = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return iso(d); };
const diasHasta = f => Math.round((aFecha(f) - aFecha(hoy())) / 86400000);
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FRECUENCIAS = [[1, 'Mensual'], [2, 'Bimestral'], [3, 'Trimestral'], [4, 'Cuatrimestral'], [6, 'Semestral'], [12, 'Anual']];
const nombreFrec = f => FRECUENCIAS.find(x => x[0] === +f)?.[1] || 'Sin programar';
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const iniciales = s => String(s || '?').replace(/\b(S\.?A\.?|S\.?R\.?L\.?|S\.?A\.?S\.?)\b/gi, '').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
let saveTimer;
const saveRelev = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => put('relevamientos', S.relev), 300); };

// Atributos de acción: el despachador de abajo llama a A[nombre](elemento, ...args)
const arg = a => a.length ? ` data-p="${esc(JSON.stringify(a))}"` : '';
const on = (accion, ...a) => `data-a="${accion}"${arg(a)}`;       // click
const oi = (accion, ...a) => `data-in="${accion}"${arg(a)}`;      // input (mientras se escribe)
const oc = (accion, ...a) => `data-ch="${accion}"${arg(a)}`;      // change (fechas, archivos, listas)
const olp = (accion, ...a) => `data-lp="${accion}"${arg(a)}`;     // mantener apretado

// ===== Íconos (trazo, 24×24) =====
const IC = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', chev: '<path d="m9 5 7 7-7 7"/>',
  ajustes: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  imagen: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
  doc: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>', descarga: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  subir: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>', alerta: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  basura: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', auto: '<path d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4"/>',
  extintor: '<path d="M9 9h6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z"/><path d="M10 9V6h4v3M14 6h3l2 2M12 3v3"/>',
  rayo: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  luz: '<rect x="4" y="9" width="16" height="7" rx="2"/><path d="M8 19h8M12 2v3M5 4.5l2 2M19 4.5l-2 2"/>',
  salida: '<path d="M14 4H6v16h8"/><path d="M11 12h10M18 9l3 3-3 3"/>',
  cruz: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  engranaje: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  compresor: '<rect x="3" y="10" width="13" height="8" rx="4"/><path d="M6 18v3M13 18v3M9.5 10V6h4M16 14h3a2 2 0 0 0 2-2V9"/>',
  llama: '<path d="M12 21c3.9 0 6.5-2.6 6.5-6.3 0-3.6-2.5-5.6-3.7-9.2-1.7 1.8-2.6 3.6-2.6 5.4-.9-.8-1.8-2-1.8-3.8C8.1 9 5.5 11.7 5.5 14.7 5.5 18.4 8.1 21 12 21z"/>',
  gancho: '<path d="M8 3h8M12 3v7"/><path d="M12 10a4 4 0 1 1-4 4v-1"/>',
  eslinga: '<path d="M7 3a4 4 0 0 0 0 8h10a4 4 0 0 1 0 8"/><circle cx="7" cy="7" r="1.5"/><circle cx="17" cy="15" r="1.5"/>',
  autoelevador: '<path d="M3 17V8h6l3 5v4"/><path d="M16 3v14h5"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/>',
  arnes: '<circle cx="12" cy="4" r="2"/><path d="M12 6v7M8 9h8M9 21l3-8 3 8M12 6C10 5 9 4 8.5 2.5"/>',
  retractil: '<circle cx="12" cy="8" r="5"/><circle cx="12" cy="8" r="1.5"/><path d="M12 13v6M10 21h4"/>',
  escoba: '<path d="M15 3l-4 9"/><path d="M6 12h9l2 9H4z"/><path d="M8 16v5M11.5 16v5"/>',
  edificio: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8.5 7h2M13.5 7h2M8.5 11h2M13.5 11h2M10 21v-5h4v5"/>',
  casco: '<path d="M3 17h18"/><path d="M5 17a7 7 0 0 1 14 0"/><path d="M12 6v4M9 7v3M15 7v3"/>',
  frasco: '<path d="M9 3h6M10 3v6l-5 10a2 2 0 0 0 1.8 2.9h10.4A2 2 0 0 0 19 19L14 9V3"/><path d="M7 15h10"/>',
  postura: '<circle cx="14" cy="4" r="2"/><path d="M13.5 7 9 12l5 2v7M9 12 6 21M14 14l4-2"/>',
  carpeta: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M8 13h8M8 16h5"/>',
  grua: '<path d="M6 21V3M3 21h8M6 5h15M6 5l4 4M17 5v5"/><rect x="15" y="10" width="4" height="3"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16"/>',
  lista: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4"/>',
  libro: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7M8 11h5"/>',
  compartir: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  mas: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  campana: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  link: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  ubicacion: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ojo: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  casa: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  telefono: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  chat: '<path d="M4 20l1.5-4A8 8 0 1 1 8 19z"/>',
  lluvia: '<path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 7.5a3.8 3.8 0 0 1 0 7.5z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  solnube: '<path d="M8 4v1.5M3.5 8.5H5M4.9 4.9 6 6M11.2 6A3.5 3.5 0 0 0 5 9"/><path d="M8 19a4 4 0 0 1-.4-8A5 5 0 0 1 17 11.5a3.6 3.6 0 0 1 .5 7.5z"/>',
  nube: '<path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4.2 4.2 0 0 1 0 8.5z"/>',
  niebla: '<path d="M7 13a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 5.5a3.8 3.8 0 0 1 1 7.5"/><path d="M4 17h16M6 21h12"/>',
  nieve: '<path d="M7 14a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 6.5a3.8 3.8 0 0 1 0 7.5"/><path d="M8 18h.01M12 18h.01M16 18h.01M10 21h.01M14 21h.01"/>',
  tormenta: '<path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 7.5a3.8 3.8 0 0 1 0 7.5"/><path d="m12 13-2 4h4l-2 4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  escudo: '<path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>',
  clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"/>'
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || IC.carpeta}</svg>`;
const tile = m => `<div class="tile t-${m?.color || 'menta'}">${ic(m?.icono || 'carpeta')}</div>`;
const aviso = (clase, icono, html) => `<div class="${clase}">${ic(icono)}<div>${html}</div></div>`;
const vacio = (icono, txt) => `<div class="empty">${ic(icono)}<div>${txt}</div></div>`;
const avatar = e => `<div class="avatar">${e.logo ? `<img src="${e.logo.data}" alt="">` : esc(iniciales(e.razonSocial))}</div>`;

function resizeImg(file, max = 1600, formato = 'jpg'){
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const g = c.getContext('2d');
      if (formato === 'jpg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res({data: c.toDataURL(formato === 'png' ? 'image/png' : 'image/jpeg', 0.75), w: c.width, h: c.height, tipo: formato});
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

// ===== Diálogos propios (el visor de claude.ai no muestra alert/confirm) =====
let dlgResolver = null;
function dialogo(texto, botones, columna = false){
  $('#dlgTxt').textContent = texto;
  $('#dlgTxt').hidden = !texto;
  $('#dlgBtns').className = 'actions' + (columna ? ' col' : '');
  $('#dlgBtns').innerHTML = botones.map((b, i) => `<button class="btn ${b.clase || ''}" ${on('dlgResp', i)}>${b.icono ? ic(b.icono) : ''}${esc(b.txt)}</button>`).join('');
  $('#dlg').hidden = false;
  $('#dlgBtns .btn:last-child')?.focus();
  return new Promise(res => dlgResolver = i => { $('#dlg').hidden = true; dlgResolver = null; res(botones[i]?.valor); });
}
const avisar = texto => dialogo(texto, [{txt: 'Entendido', valor: true}]);
const confirmar = (texto, si = 'Sí', no = 'Cancelar') => dialogo(texto, [{txt: no, clase: 'ghost', valor: false}, {txt: si, valor: true}]);
// Menú de opciones (mantener apretado): botones apilados, el último es Cancelar
const menu = (titulo, opciones) => dialogo(titulo, [...opciones.map(o => ({...o, clase: o.clase || 'sec'})), {txt: 'Cancelar', clase: 'ghost', valor: null}], true);
let toastTimer;
function toast(texto){
  const t = $('#toast');
  t.textContent = texto; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2600);
}

// En la app Android: el archivo pasa al contenedor en partes en base64, que lo guarda en Descargas y abre "Enviar"
async function guardarEnAndroid(nombre, blob){
  const host = window.AndroidHost, bytes = new Uint8Array(await blob.arrayBuffer()), PARTE = 3 * 256 * 1024;
  const ok = r => { if (r !== 'ok') throw new Error(r); };
  ok(host.iniciarArchivo(nombre, blob.type || ''));
  for (let i = 0; i < bytes.length; i += PARTE) {
    const trozo = bytes.subarray(i, i + PARTE);
    let bin = '';
    for (let j = 0; j < trozo.length; j += 0x8000) bin += String.fromCharCode.apply(null, trozo.subarray(j, j + 0x8000));
    ok(host.agregarParte(btoa(bin)));
  }
  ok(host.terminarArchivo());
  toast('Guardado en Descargas › Relevamientos HyS');
}

// Entrega un archivo al usuario: en la app Android, por el contenedor; en claude.ai, por la capacidad de
// descargas; en cualquier otro navegador, descarga directa
async function guardarArchivo(nombre, datos){
  if (window.AndroidHost) {
    try { await guardarEnAndroid(nombre, datos instanceof Blob ? datos : new Blob([datos])); return true; }
    catch (e) { await avisar('No se pudo guardar el archivo: ' + e.message); return false; }
  }
  const dl = window.claude?.use ? await window.claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({filename: nombre, data: datos}); return true; }
    catch (e) {
      if (e?.code === 'declined') return false;
      if (e?.code === 'rate_limited') { await avisar('Ya hay una descarga esperando confirmación. Aceptala o cerrala y probá de nuevo.'); return false; }
      await avisar('No se pudo descargar el archivo: ' + (e?.message || e?.code || 'error desconocido'));
      return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(datos instanceof Blob ? datos : new Blob([datos]));
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

// Compartir: abre el menú del celular (WhatsApp, mail…). Si el navegador no lo permite, se descarga.
async function compartirArchivo(nombre, blob){
  if (window.AndroidHost) return guardarArchivo(nombre, blob);   // el contenedor abre "Enviar" al guardar
  const file = new File([blob], nombre, {type: blob.type || 'application/octet-stream'});
  if (navigator.canShare?.({files: [file]})) {
    try { await navigator.share({files: [file], title: nombre}); return true; }
    catch (e) { if (e?.name === 'AbortError') return false; }
  }
  toast('Este navegador no permite compartir: se descarga el archivo');
  return guardarArchivo(nombre, blob);
}

// ===== Configuración (módulos, rubros, plantillas, normativa) =====
const CFG = {modulos: {}, orden: [], rubros: [], plantillas: null, normativa: {riesgos: [], programas: [], normas: []}, novedades: null};
let PERFIL = {id: 'perfil'}, NORMAS = {id: 'normas', estados: {}, leidas: {}};
// Actividades que se planifican en las visitas: [nombre, sensible al clima, vence cada N meses]
const ACT_BASE = [['Relevamiento'], ['Capacitación', false, 12], ['Medición de PAT', true, 12], ['Medición de iluminación', false, 12], ['Medición de ruido', false, 12],
  ['Investigación de accidente'], ['Entrega de EPP'], ['Simulacro', true, 12], ['Control de matafuegos', true, 12], ['Trabajos al aire libre', true], ['Confección de documentación'],
  ['Reunión con el empleador'], ['Relevamiento de agentes de riesgo (RAR)', false, 12]];
const actBase = () => ACT_BASE.map(([nombre, clima, meses], i) => ({id: 'act' + i, nombre, clima: !!clima, activa: true, meses: meses || 0}));
let ACTIVIDADES = {id: 'actividades', lista: actBase()};
// Lo guardado + las actividades base que se agregaron en versiones nuevas (y su periodicidad si no la tenían)
function completarActividades(guardadas){
  if (!guardadas?.lista) return {id: 'actividades', lista: actBase()};
  for (const b of actBase()) {
    const a = guardadas.lista.find(x => x.id === b.id);
    if (!a) guardadas.lista.push(b); else if (a.meses === undefined) a.meses = b.meses;
  }
  return guardadas;
}
const ROLES = ['Dueño', 'Encargado', 'RRHH', 'Otro'];
const FREC_VISITA = [['', 'Sin frecuencia fija'], ['semanal', 'Semanal'], ['quincenal', 'Quincenal'], ['mensual', 'Mensual']];

async function cargarConfig(){
  const j = u => fetch(u, {cache: 'no-store'}).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  CFG.orden = await j('modulos/index.json');
  const mods = await Promise.all(CFG.orden.map(id => j(`modulos/${id}.json`)));
  mods.forEach(m => CFG.modulos[m.id] = m);
  CFG.rubros = (await j('config/rubros.json')).rubros;
  CFG.plantillas = await j('textos/plantillas.json');
  CFG.normativa = await j('config/normativa.json');
  // Novedades del buscador automático: si todavía no existe el archivo, la app sigue igual
  CFG.novedades = await j('normativa/novedades.json').catch(() => null);
}
const rubro = id => CFG.rubros.find(r => r.id === id);
const nombreRiesgo = id => CFG.normativa.riesgos.find(r => r.id === id)?.nombre || id;

// ===== Estado y navegación =====
const S = {view: 'empresas', empresa: null, estab: null, relev: null, mi: 0, ei: 0, di: 0, filtro: '', editando: false, general: false, sel: new Set(),
  marcar: false, logoTmp: null, tab: 'inicio', verOtros: false, carpeta: 'curso', anio: new Date().getFullYear(), segFiltro: 'Abierto',
  obs: null, form: null, informes: null, normJur: 'Todas', normBuscar: ''};
const mod = () => CFG.modulos[S.relev.modulos[S.mi].modulo_id];
const rm = () => S.relev.modulos[S.mi];
const el = () => rm().elementos[S.ei];
const nombreEl = () => Motor.nombreElemento(mod(), el(), S.ei);
const tituloRelev = r => r.tipo === 'desvios' ? 'Informe de desvíos' : r.modulos.length > 1 ? 'Relevamiento general' : (CFG.modulos[r.modulos[0].modulo_id]?.titulo || r.modulos[0].modulo_id);
const iconoRelev = r => r.tipo === 'desvios' ? {color: 'rojo', icono: 'alerta'} : r.modulos.length > 1 ? {color: 'menta', icono: 'carpeta'} : CFG.modulos[r.modulos[0].modulo_id];
const listaFotos = tipo => tipo === 'gen' ? S.relev.fotos_generales : tipo === 'desv' ? S.relev.desvios[S.di].fotos : el().fotos;
const esRelev = r => r.modulos || r.tipo === 'desvios';
const terminado = r => r.estado === 'finalizado';

// Barra de navegación de abajo: [clave, pantalla, ícono, texto]
const TABS = [['inicio', 'empresas', 'casa', 'Inicio'], ['clientes', 'clientes', 'edificio', 'Clientes'], ['agenda', 'agenda', 'calendario', 'Agenda'],
  ['informes', 'informesLista', 'doc', 'Informes'], ['mas', 'mas', 'menu', 'Más']];
const esRaiz = v => TABS.some(t => t[1] === v);
const raiz = () => TABS.find(t => t[0] === S.tab)[1];
// Sin entrada: vuelve a la pantalla principal de la pestaña en la que se está
const PREV = {estab: 'empresa', categorias: 'estab', carpeta: 'categorias', perfil: 'mas', actividades: 'mas', relev: 'categorias',
  elemento: 'relev', generales: 'relev', fotosGen: 'relev', informe: 'relev', panel: 'estab', seguimiento: 'estab', obsForm: 'seguimiento',
  desvios: 'estab', desvioEl: 'desvios', normasEmp: 'empresa'};
let volverA = null;   // pantalla a la que vuelve "atrás" cuando se entró desde una pestaña
function go(view){ S.view = view; S.marcar = false; render(); scrollTo(0, 0); }

let renderN = 0;
async function render(){
  const v = VIEWS[S.view], conNav = esRaiz(S.view), n = ++renderN;
  const html = await v.html();
  if (n !== renderN) return;   // mientras se armaba, se pidió otra pantalla: gana la última
  $('#back').hidden = conNav;
  document.body.classList.toggle('con-nav', conNav);
  $('#nav').hidden = !conNav;
  $('#nav').innerHTML = TABS.map(([k, , icono, txt]) => `<button class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''} ${on('tab', k)}>${ic(icono)}<span>${txt}</span></button>`).join('');
  $('#marca').hidden = S.view !== 'empresas';
  $('#title').textContent = v.title();
  const sub = v.subtitle?.() || '';
  $('#subtitle').textContent = sub; $('#subtitle').hidden = !sub;
  $('#hright').innerHTML = v.right?.() || '';
  $('#app').innerHTML = html;
  progreso();
  await v.despues?.();   // calendario, mapa y gráficos se montan después de dibujar la pantalla
}

// Avance del checklist: barra fina en el encabezado + tarjeta del tema (solo en la carga)
const modCardHtml = () => `<div class="card modcard">${tile(mod())}<div><b>${esc(mod().titulo)}</b><div class="sub" id="modprogTxt"></div><div class="barra"><i id="modprog"></i></div></div></div>`;
function progreso(){
  const p = $('#hprog');
  if (S.view !== 'elemento' && S.view !== 'generales') { p.hidden = true; return; }
  const {items, ev} = contextoChecklist(), hechos = items.length - ev.faltan.length, pct = (items.length ? hechos * 100 / items.length : 0) + '%';
  p.hidden = false;
  p.firstElementChild.style.width = pct;
  $('#subtitle').hidden = false;
  $('#subtitle').textContent = `${S.empresa.razonSocial} · ${S.estab.nombre}`;
  if ($('#modprog')) { $('#modprog').style.width = pct; $('#modprogTxt').textContent = `${hechos} de ${items.length} preguntas respondidas`; }
}

// ===== Datos combinados =====
async function datosInicio(){
  const [emp, est, rels, seg] = await Promise.all(['empresas', 'establecimientos', 'relevamientos', 'seguimiento'].map(getAll));
  return {emp: emp.sort((a, b) => a.razonSocial.localeCompare(b.razonSocial)), est, rels: rels.filter(esRelev), seg};
}
// La empresa como la necesita el informe: datos de la razón social + los del establecimiento
const empresaInforme = (e = S.empresa, s = S.estab) => ({...e, establecimiento: s?.nombre || '', domicilio: s?.domicilio || '', localidad: s?.localidad || '',
  provincia: s?.provincia || '', responsable: s?.responsable || e.responsable || '', trabajadores: s?.trabajadores || e.trabajadores || ''});

// ===== Panel de control: programación de cada tema por establecimiento =====
// Para cada tema programado: último relevamiento terminado, próximo vencimiento y estado
function programacion(estab, rels){
  const prog = estab.programa || {}, propias = rels.filter(r => r.establecimientoId === estab.id && r.modulos);
  const ids = [...new Set([...Object.keys(prog).filter(id => CFG.modulos[id]), ...propias.flatMap(r => r.modulos.map(m => m.modulo_id))])];
  return ids.filter(id => CFG.modulos[id]).sort((a, b) => CFG.orden.indexOf(a) - CFG.orden.indexOf(b)).map(id => {
    const frec = +(prog[id]?.frec || 0);
    const hechos = propias.filter(r => terminado(r) && r.modulos.some(m => m.modulo_id === id)).map(r => r.fecha_relevamiento).sort();
    const ultimo = hechos[hechos.length - 1] || '';
    const proximo = frec ? (ultimo ? sumarMeses(ultimo, frec) : prog[id]?.desde || hoy()) : '';
    const dias = proximo ? diasHasta(proximo) : null;
    const estado = !frec ? 'sin' : dias < 0 ? 'vencido' : dias <= 30 ? 'porvencer' : 'aldia';
    return {id, mod: CFG.modulos[id], frec, responsable: prog[id]?.responsable || 'HyS', hechos, ultimo, proximo, dias, estado};
  });
}
// Meses del año marcados: h = hecho, v = vencido sin hacer, p = programado
function mesesDelAnio(p, anio){
  const m = Array(12).fill('');
  if (p.frec && p.proximo) for (let f = p.proximo, i = 0; i < 40 && +f.slice(0, 4) <= anio; f = sumarMeses(f, p.frec), i++)
    if (+f.slice(0, 4) === anio) m[+f.slice(5, 7) - 1] = diasHasta(f) < 0 ? 'v' : 'p';
  p.hechos.filter(f => +f.slice(0, 4) === anio).forEach(f => m[+f.slice(5, 7) - 1] = 'h');
  return m;
}
const ESTADO_PROG = {vencido: ['Vencido', 'b-bad'], porvencer: ['Por vencer', 'b-mid'], aldia: ['Al día', 'b-ok'], sin: ['Sin programar', 'b-na']};
// Avisos de vencimiento de todos los establecimientos (vencidos y los que vencen en 30 días)
function vencimientos(d){
  return d.est.flatMap(s => programacion(s, d.rels).filter(p => p.estado === 'vencido' || p.estado === 'porvencer')
    .map(p => ({...p, estab: s, empresa: d.emp.find(e => e.id === s.empresaId)}))).filter(v => v.empresa).sort((a, b) => a.dias - b.dias);
}
const textoVence = p => p.dias < 0 ? `venció hace ${plural(-p.dias, 'día', 'días')}` : p.dias === 0 ? 'vence hoy' : `vence en ${plural(p.dias, 'día', 'días')}`;

// ===== Normativa =====
const enSantaFe = s => /santa fe|rosario/.test(sinAcentos(`${s.provincia} ${s.localidad}`));
const enRosario = s => /rosario/.test(sinAcentos(s.localidad));
function aplicaNorma(a, e, estabs){
  if (a.siempre) return 'Aplica a todos los establecimientos';
  const c = [];
  if (a.rubros) c.push([a.rubros.includes(e.rubro), `por el rubro (${rubro(e.rubro)?.nombre || ''})`]);
  if (a.riesgos) { const m = a.riesgos.filter(r => e.riesgos?.includes(r)); c.push([m.length > 0, 'por ' + Motor.lista(m.map(r => nombreRiesgo(r).toLowerCase()))]); }
  if (a.no_rubros) c.push([!a.no_rubros.includes(e.rubro), 'por la actividad (industria, comercio y servicios)']);
  if (a.provincia) c.push([estabs.some(enSantaFe), 'por tener establecimiento en Santa Fe']);
  if (a.localidad) c.push([estabs.some(enRosario), 'por tener establecimiento en Rosario']);
  if (a.programa) c.push([(e.programas || []).includes(a.programa), 'por estar incluida en ' + (CFG.normativa.programas.find(p => p.id === a.programa)?.nombre || a.programa)]);
  if (a.trabajadores_min) c.push([+e.trabajadores >= a.trabajadores_min, `por tener ${a.trabajadores_min} o más trabajadores`]);
  const ok = a.cualquiera ? c.some(x => x[0]) : c.length && c.every(x => x[0]);
  if (!ok) return '';
  const m = c.filter(x => x[0]).map(x => x[1]).join(' y ');
  return m.charAt(0).toUpperCase() + m.slice(1);
}
const normasAplicables = (e, estabs) => CFG.normativa.normas.map(n => ({n, motivo: aplicaNorma(n.aplica, e, estabs)})).filter(x => x.motivo);

// Cruce de una novedad del buscador con el perfil de la empresa (se hace en el celular: los datos no salen)
function cruceNovedad(n, e, estabs){
  const jur = sinAcentos(n.jurisdiccion);
  if (jur.includes('santa fe') && !estabs.some(enSantaFe)) return null;
  if (jur.includes('rosario') && !estabs.some(enRosario)) return null;
  const riesgos = (n.riesgos || []).filter(r => e.riesgos?.includes(r));
  const rubros = (n.rubros || []).includes(e.rubro);
  if (riesgos.length || rubros) return {nivel: 'Aplica', motivo: 'Por ' + Motor.lista([...(rubros ? ['el rubro'] : []), ...riesgos.map(r => nombreRiesgo(r).toLowerCase())])};
  if (n.general) return {nivel: 'Posiblemente', motivo: 'Norma general de higiene y seguridad o riesgos del trabajo'};
  if (!jur.includes('nacion')) return {nivel: 'Posiblemente', motivo: 'Por la ubicación del establecimiento'};
  return null;
}
// El resumen se muestra solo si agrega algo al título (a veces el título sale del mismo primer artículo)
const resumenNovedad = n => n.resumen && !n.resumen.startsWith(n.titulo.replace(/…$/, '')) ? `<div class="sub">${esc(n.resumen)}</div>` : '';
const estadoNorma = (empId, nId) => NORMAS.estados[empId + '|' + nId] || '';
function novedadesEmpresa(e, estabs, conNoAplica = false){
  return (CFG.novedades?.normas || []).map(n => ({n, c: cruceNovedad(n, e, estabs), estado: estadoNorma(e.id, n.id)}))
    .filter(x => x.c && (conNoAplica || x.estado !== 'no_aplica'))
    .sort((a, b) => (a.c.nivel === 'Aplica' ? 0 : 1) - (b.c.nivel === 'Aplica' ? 0 : 1) || b.n.fecha.localeCompare(a.n.fecha));
}
const sinRevisar = (e, estabs) => novedadesEmpresa(e, estabs).filter(x => !x.estado).length;
const nuevasGenerales = () => (CFG.novedades?.normas || []).filter(n => !NORMAS.leidas[n.id]).length;

// ===== Pantallas =====
const VIEWS = {
  // ---- Inicio ----
  empresas: {
    title: () => 'Relevamientos HyS',
    right: () => `${Sync.botonNube()}<button class="hbtn" ${on('buscar')} aria-label="Buscar">${ic('search')}</button>`,
    async html(){
      const d = await datosInicio(), {emp, rels, seg} = d, P = await AG.inicioPartes();
      const ultima = pref.get('ultimaCopia');
      const dias = ultima ? Math.floor((Date.parse(hoy()) - Date.parse(ultima)) / 86400000) : null;
      const fecha = new Date().toLocaleDateString('es-AR', {weekday: 'long', day: 'numeric', month: 'long'});
      const nombre = (PERFIL.nombre || '').split(' ')[0];
      const venc = vencimientos(d), nuevas = nuevasGenerales();
      const stat = (accion, n, l) => `<button class="stat" ${on(...accion)}><b class="num">${n}</b><span>${l}</span></button>`;
      const enCurso = rels.filter(r => !terminado(r)).length, abiertos = seg.filter(o => o.estado === 'Abierto').length;
      const acceso = (accion, icono, txt, badge = '') => `<button class="acceso" ${on(...accion)}><span class="tile t-menta">${ic(icono)}</span>${txt}${badge}</button>`;
      return `<div class="stack">
        <div class="hero">
          <h2>${nombre ? `Hola, ${esc(nombre)}` : 'Resumen'}</h2>
          <div class="sub">${esc(fecha.charAt(0).toUpperCase() + fecha.slice(1))}</div>
          <div class="stats">
            ${stat(['tab', 'clientes'], emp.length, 'Clientes')}${stat(['irAgendaHoy'], P.visitasHoy, 'Visitas hoy')}
            ${stat(['irA', 'enCurso'], enCurso, 'Relevamientos en curso')}${stat(['go', 'desviosTodos'], abiertos, 'Desvíos abiertos')}
          </div>
        </div>
        <button class="btn block" ${on('nuevoRelevInicio')}>${ic('plus')}Nuevo relevamiento</button>
        ${P.proxima}
        <div class="accesos">${acceso(['tab', 'clientes'], 'edificio', 'Clientes')}${acceso(['tab', 'agenda'], 'calendario', 'Agenda')}
          ${acceso(['tab', 'informes'], 'doc', 'Informes')}${acceso(['go', 'desviosTodos'], 'alerta', 'Desvíos', abiertos ? `<span class="badge b-bad">${abiertos}</span>` : '')}</div>
        ${PERFIL.nombre ? '' : aviso('info', 'persona', `Cargá tus datos de profesional (nombre, matrícula, logo y firma) para que salgan en los informes. <a class="link" ${on('go', 'perfil')}>Cargar mis datos</a>`)}
        ${!(Sync.sincroniza && Sync.activo()) && emp.length && (dias === null || dias >= 7) ? aviso('aviso', 'alerta', `${ultima ? `Hace ${dias} días que no descargás una copia de seguridad.` : 'Todavía no descargaste ninguna copia de seguridad.'} Tus datos están solo en este dispositivo. <a class="link" ${on('exportar')}>Descargar copia</a>`) : ''}
        ${P.resumen}${P.asistente}
        ${venc.length ? `<div class="card alertas"><div class="between"><b>${ic('reloj')} Relevamientos a realizar</b><span class="badge ${venc.some(v => v.estado === 'vencido') ? 'b-bad' : 'b-mid'}">${venc.length}</span></div>
          ${venc.slice(0, 5).map(v => `<div class="el" ${on('abrirPanel', v.estab.id)}><span class="dot ${v.estado === 'vencido' ? 'bad' : 'mid'}"></span>
            <div><b>${esc(v.mod.titulo)}</b><div class="sub">${esc(v.empresa.razonSocial)} · ${esc(v.estab.nombre)} · ${textoVence(v)}</div></div>${ic('chev', 'chev')}</div>`).join('')}
          ${venc.length > 5 ? `<div class="sub" style="padding-top:8px">y ${venc.length - 5} más…</div>` : ''}</div>` : ''}
        ${nuevas ? `<div class="card rowcard" ${on('go', 'normativa')}><div class="tile t-menta">${ic('campana')}</div><div><b>Normativa nueva</b><div class="sub">${plural(nuevas, 'novedad sin leer', 'novedades sin leer')} del Boletín Oficial</div></div><span class="badge b-mid">${nuevas}</span></div>` : ''}
      </div>
      <h3 id="enCurso">Relevamientos en curso</h3>
      <div class="stack">${relevsPorEmpresaHtml(d, r => !terminado(r), emp.length ? 'No hay relevamientos en curso. Empezá uno con “Nuevo relevamiento”.' : 'Todavía no cargaste clientes. Empezá en la pestaña Clientes.')}</div>`;
    }
  },
  // Nuevo relevamiento desde el Inicio: primero se elige dónde
  elegirEstab: {
    title: () => 'Nuevo relevamiento',
    subtitle: () => 'Elegí el establecimiento',
    async html(){
      const d = await datosInicio();
      if (!d.est.length) return `<div class="stack">${vacio('edificio', 'Todavía no cargaste clientes con establecimientos.')}<button class="btn block" ${on('nuevaEmpresa')}>${ic('plus')}Agregar cliente</button></div>`;
      return `<div class="stack"><div class="search">${ic('search')}<input id="bestab" placeholder="Buscar cliente o establecimiento" value="${esc(S.filtroEst || '')}" ${oi('filtrarEstab')}></div>
        <div class="list" id="listaEstab">${listaEstabHtml(d)}</div></div>`;
    }
  },
  // Desvíos de todos los clientes (el seguimiento de cada establecimiento, junto)
  desviosTodos: {
    title: () => 'Desvíos',
    async html(){
      const d = await datosInicio(), f = S.dvFiltro || 'Abierto';
      const lista = d.seg.filter(o => f === 'Todos' || o.estado === f);
      const grupos = d.est.map(s => ({s, e: d.emp.find(e => e.id === s.empresaId), obs: lista.filter(o => o.establecimientoId === s.id).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))}))
        .filter(g => g.e && g.obs.length).sort((a, b) => a.e.razonSocial.localeCompare(b.e.razonSocial));
      return `<div class="segmento">${[['Abierto', 'Abiertos'], ['Cerrado', 'Cerrados'], ['Todos', 'Todos']].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" ${on('setDvFiltro', k)}>${t} (${k === 'Todos' ? d.seg.length : d.seg.filter(o => o.estado === k).length})</button>`).join('')}</div>
        <p class="sub">Son los desvíos de los relevamientos y los cargados a mano. Tocá uno para ver el seguimiento de ese establecimiento.</p>
        <div class="stack">${grupos.map(g => `<details class="card fold" open><summary>${avatar(g.e)}<div><b>${esc(g.e.razonSocial)}</b><div class="sub">${esc(g.s.nombre)} · ${plural(g.obs.length, 'desvío', 'desvíos')}</div></div>${ic('chev', 'chev')}</summary>
          ${g.obs.map(o => `<div class="el" ${on('abrirSeguimiento', g.s.id)}><span class="dot ${o.estado === 'Cerrado' ? 'ok' : o.prioridad === 'ALTA' ? 'bad' : 'mid'}"></span>
            <div><b>${esc(o.texto || 'Desvío')}</b><div class="sub">N° ${o.n || '–'} · ${fmtFecha(o.fecha)}${o.sector ? ' · ' + esc(o.sector) : ''}${o.estado === 'Cerrado' ? ' · cerrado ' + fmtFecha(o.fechaCierre) : ''}</div></div>
            ${o.prioridad && o.estado !== 'Cerrado' ? `<span class="badge b-${o.prioridad}">${o.prioridad}</span>` : ''}</div>`).join('')}</details>`).join('')
          || vacio('ok', f === 'Abierto' ? 'No hay desvíos abiertos.' : 'No hay desvíos para mostrar.')}</div>`;
    }
  },
  clientes: {
    title: () => 'Clientes',
    async html(){
      const d = await datosInicio();
      return `<div class="stack"><div class="search">${ic('search')}<input id="buscar" placeholder="Buscar por razón social o CUIT" value="${esc(S.filtro)}" ${oi('filtrar')}></div>
          <div class="list" id="listaEmp">${listaEmpresasHtml(d)}</div></div>
        <div class="bottom-bar"><div class="actions"><button class="btn hazard" ${on('nuevaEmpresa')}>${ic('plus')}Agregar cliente</button></div></div>`;
    }
  },
  informesLista: {
    title: () => 'Informes',
    async html(){
      const seg = `<div class="segmento" style="margin-bottom:12px">${[['relev', 'Relevamientos'], ['visitas', 'Visitas']].map(([k, t]) =>
        `<button class="${(S.infTab || 'relev') === k ? 'on' : ''}" ${on('setInfTab', k)}>${t}</button>`).join('')}</div>`;
      if (S.infTab === 'visitas') return seg + await AG.informeVisitasHtml();
      const d = await datosInicio();
      return `${seg}<div class="stack">${relevsPorEmpresaHtml(d, terminado, 'Todavía no hay informes emitidos.')}</div>
        ${d.rels.some(terminado) ? `<p class="sub">Mantené apretado un informe para descargarlo, compartirlo o eliminarlo.</p>` : ''}`;
    },
    despues: () => S.infTab === 'visitas' && AG.graficos()
  },
  mas: {
    title: () => 'Más',
    html(){
      const fila = (accion, icono, color, titulo, sub) => `<div class="card rowcard" ${on(...accion)}><div class="tile t-${color}">${ic(icono)}</div>
        <div><b>${titulo}</b><div class="sub">${sub}</div></div>${ic('chev', 'chev')}</div>`;
      const nuevas = nuevasGenerales(), activas = ACTIVIDADES.lista.filter(a => a.activa).length;
      return `<div class="list">
        ${fila(['go', 'cuenta'], 'persona', 'menta', Sync.sincroniza ? 'Cuenta y sincronización' : 'Cuenta', Sync.activo() ? 'Sesión iniciada · avisos con la app cerrada' : 'Para recibir avisos con la app cerrada')}
        ${fila(['go', 'legajoPanel'], 'carpeta', 'menta', 'Legajo técnico', 'Panel de todos los clientes, vencimientos y catálogo de requisitos')}
        ${fila(['go', 'desviosTodos'], 'alerta', 'menta', 'Desvíos de todos los clientes', 'Abiertos y cerrados, por establecimiento')}
        ${fila(['go', 'normativa'], 'libro', 'menta', 'Normativa', nuevas ? plural(nuevas, 'novedad sin leer', 'novedades sin leer') : 'Novedades del Boletín Oficial')}
        ${fila(['go', 'actividades'], 'lista', 'menta', 'Actividades', `${plural(activas, 'actividad activa', 'actividades activas')} para las visitas`)}
        ${fila(['go', 'perfil'], 'persona', 'menta', 'Mis datos y configuración', 'Datos para los informes, clima, copia de seguridad')}
      </div>`;
    }
  },
  actividades: {
    title: () => 'Actividades',
    html(){
      return `<div class="stack">
        <p class="sub" style="margin:0">Son las tareas que vas a poder planificar en cada visita. Las marcadas <b>Sensible al clima</b> avisan cuando el pronóstico da lluvia o viento fuerte. Las que no usás, desactivalas: no se borran del historial. Qué requisito del legajo renueva cada una se define en Más › Legajo técnico › Catálogo.</p>
        <div class="list" id="listaAct">${actividadesHtml()}</div>
      </div>
      <div class="bottom-bar"><div class="actions"><button class="btn hazard" ${on('nuevaActividad')}>${ic('plus')}Agregar actividad</button></div></div>`;
    }
  },
  empresaForm: {
    title: () => S.editando ? 'Editar empresa' : 'Nueva empresa',
    html(){
      const e = S.editando ? S.empresa : {}, F = S.form;
      const campo = (id, lbl, v, extra = '') => `<div class="fld"><label for="${id}">${lbl}</label><input id="${id}" value="${esc(v)}" ${extra}></div>`;
      return `<div class="stack">
        <div class="card"><h4>Razón social</h4>
          ${campo('e_rs', 'Razón social *', e.razonSocial)}
          <div class="row">${campo('e_cuit', 'CUIT', e.cuit, 'inputmode="numeric" placeholder="30-12345678-9"')}
            <div class="fld"><label for="e_rubro">Rubro *</label><select id="e_rubro"><option value="">Elegí el rubro…</option>
            ${CFG.rubros.map(r => `<option value="${r.id}" ${e.rubro === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></div></div>
          ${campo('e_act', 'Actividad principal', e.actividad, 'placeholder="Ej.: fabricación de estructuras metálicas"')}
          <div class="row">${campo('e_ciiu', 'Código CIIU (opcional)', e.ciiu, 'inputmode="numeric"')}${campo('e_trab', 'Trabajadores (total)', e.trabajadores, 'type="number" inputmode="numeric"')}</div>
          <div class="row">${campo('e_art', 'ART', e.art)}${campo('e_resp', 'Responsable (sale en el informe)', e.responsable)}</div>
        </div>
        <div class="card"><h4>Contactos</h4>
          <p class="sub" style="margin-top:0">Dueño, encargado, RRHH… Desde la ficha los llamás o les escribís por WhatsApp con un toque.</p>
          <div class="list" id="contactos">${contactosFormHtml()}</div>
          <button class="btn sec block" style="margin-top:12px" ${on('agregarContacto')}>${ic('plus')}Agregar contacto</button>
        </div>
        <div class="card"><h4>Riesgos y tareas presentes</h4>
          <p class="sub" style="margin-top:0">Con esto la app sabe qué normativa le aplica y qué novedades avisarte.</p>
          <div class="chips" id="chipsRiesgos">${chipsHtml('riesgos')}</div>
          <label>Programas o registros especiales</label>
          <div class="chips" id="chipsProgramas">${chipsHtml('programas')}</div>
          <label for="e_notas">Notas</label><textarea id="e_notas">${esc(e.notas)}</textarea>
        </div>
        <div class="card"><h4>Logo de la empresa (opcional)</h4><div id="logoBox">${imagenBox(S.logoTmp, 'logoEmpresa')}</div></div>
        ${S.editando ? `<button class="btn danger block" ${on('eliminarEmpresa')}>${ic('basura')}Eliminar empresa</button>` : ''}
      </div>
      <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('atras')}>Cancelar</button><button class="btn" ${on('guardarEmpresa')}>${ic('check')}Guardar</button></div></div>`;
    }
  },
  estabForm: {
    title: () => S.editando ? 'Datos del establecimiento' : 'Nuevo establecimiento',
    subtitle: () => S.empresa.razonSocial,
    html(){
      const s = S.editando ? S.estab : {provincia: 'Santa Fe'};
      const campo = (id, lbl, v, extra = '') => `<div class="fld"><label for="${id}">${lbl}</label><input id="${id}" value="${esc(v)}" ${extra}></div>`;
      return `<div class="stack">
        ${S.editando ? '' : aviso('aviso', 'info', 'Una razón social puede tener varios establecimientos (plantas, sucursales, obras). Cada uno tiene sus relevamientos, su panel de control y su seguimiento de desvíos.')}
        <div class="card">
          ${campo('s_nom', 'Nombre del establecimiento *', s.nombre, 'placeholder="Ej.: Planta Baigorria, Sucursal Centro"')}
          ${campo('s_dom', 'Dirección', s.domicilio)}
          <div class="row">${campo('s_loc', 'Localidad', s.localidad)}${campo('s_prov', 'Provincia', s.provincia)}</div>
          <div class="row">${campo('s_resp', 'Responsable del establecimiento', s.responsable, 'placeholder="Recibe el informe de desvíos"')}${campo('s_trab', 'Trabajadores', s.trabajadores, 'type="number" inputmode="numeric"')}</div>
          <div class="row">${campo('s_sup', 'Superficie (m²)', s.superficie, 'type="number" inputmode="decimal"')}${campo('s_horario', 'Turnos / horario', s.horario)}</div>
          <label for="s_notas">Notas</label><textarea id="s_notas">${esc(s.notas)}</textarea>
        </div>
        <div class="card"><h4>Ubicación</h4>
          <p class="sub" style="margin-top:0">La agenda la usa para el mapa del día, la ruta y el pronóstico del clima.</p>
          ${campo('s_coord', 'Coordenadas (latitud, longitud)', s.lat != null ? `${s.lat}, ${s.lng}` : '', 'inputmode="decimal" placeholder="-32.9468, -60.6393"')}
          <div class="actions" style="margin-top:10px">
            <button class="btn sec small" ${on('ubicarDireccion')}>${ic('search')}Buscar por dirección</button>
            <button class="btn sec small" ${on('ubicarAca')}>${ic('ubicacion')}Estoy acá</button>
          </div>
          <p class="hint">También podés copiar las coordenadas desde Google Maps (mantené apretado el lugar) y pegarlas.</p>
        </div>
        <div class="card"><h4>Visitas</h4>
          <div class="row"><div class="fld"><label for="s_frecv">Frecuencia de visita</label><select id="s_frecv">${FREC_VISITA.map(([v, t]) => `<option value="${v}" ${(s.frecVisita || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            ${campo('s_horas', 'Horas mensuales comprometidas', s.horasMes, 'type="number" inputmode="decimal" min="0" step="0.5"')}</div>
          <label for="s_fotoobl" style="margin-top:16px">Foto obligatoria al cerrar la visita</label>
          <select id="s_fotoobl">${[['', `Como en la configuración general (${PERFIL.fotoObligatoria ? 'sí' : 'no'})`], ['si', 'Sí, siempre'], ['no', 'No']].map(([v, t]) => `<option value="${v}" ${(s.fotoObligatoria || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div class="card"><h4>Datos para el legajo técnico</h4>
          <p class="sub" style="margin-top:0">Con esto (y la provincia y los trabajadores de arriba) la app propone qué requisitos del legajo aplican. Después lo confirmás o corregís.</p>
          ${[['quimicos', 'Usa productos químicos'], ['residuos', 'Genera residuos peligrosos o patogénicos'], ['ruido', 'Tiene fuentes de ruido'], ['comedor', 'Tiene comedor o cocina'],
            ['cancerigenos', 'El RAR declara agentes cancerígenos'], ['obra', 'Es una obra de construcción (Dec. 911/96)']].map(([k, t]) => {
            const v = s.legajo?.[k];
            return `<label for="lg_${k}">${t}</label><select id="lg_${k}"><option value="" ${v == null ? 'selected' : ''}>Sin dato</option><option value="si" ${v === true ? 'selected' : ''}>Sí</option><option value="no" ${v === false ? 'selected' : ''}>No</option></select>`; }).join('')}
          <div class="row"><div class="fld"><label for="lg_agua">Provisión de agua</label><select id="lg_agua">${[['', 'Sin dato'], ['red', 'Red'], ['perforacion', 'Perforación'], ['tanque', 'Tanque']]
            .map(([k, t]) => `<option value="${k}" ${(s.legajo?.agua || '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            ${campo('lg_puntos', 'Puntos de suministro', s.legajo?.puntosAgua ?? '', 'type="number" inputmode="numeric" min="1"')}</div>
        </div>
        ${S.editando ? `<button class="btn danger block" ${on('eliminarEstab')}>${ic('basura')}Eliminar establecimiento</button>` : ''}
      </div>
      <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('atras')}>Cancelar</button><button class="btn" ${on('guardarEstab')}>${ic('check')}Guardar</button></div></div>`;
    }
  },
  perfil: {
    title: () => 'Mis datos y configuración',
    html(){
      const ultima = pref.get('ultimaCopia');
      return `<div class="stack">
        <p class="sub" style="margin:0">Estos datos salen en la carátula, el pie y las firmas de todos los informes.</p>
        <div class="card">
          <label for="p_nom">Nombre y apellido</label><input id="p_nom" value="${esc(PERFIL.nombre)}">
          <div class="row"><div class="fld"><label for="p_tit">Título</label><input id="p_tit" value="${esc(PERFIL.titulo)}" placeholder="Lic. en Higiene y Seguridad"></div>
            <div class="fld"><label for="p_mat">Matrícula</label><input id="p_mat" value="${esc(PERFIL.matricula)}"></div></div>
          <div class="row"><div class="fld"><label for="p_tel">Teléfono</label><input id="p_tel" type="tel" inputmode="tel" value="${esc(PERFIL.telefono)}"></div>
            <div class="fld"><label for="p_mail">Email</label><input id="p_mail" type="email" inputmode="email" value="${esc(PERFIL.email)}"></div></div>
          <label>Logo de la consultora</label><div id="box_logo">${imagenBox(PERFIL.logo, 'imagenPerfil', 'logo')}</div>
          <label>Firma escaneada (opcional)</label><div id="box_firma">${imagenBox(PERFIL.firma, 'imagenPerfil', 'firma')}</div>
        </div>
        <h3>Agenda de visitas</h3>
        <div class="card">
          <p class="sub" style="margin-top:0">Opcional: si lo completás, figura como destinatario en el resumen semanal. Si lo dejás vacío, no aparece.</p>
          <div class="row"><div class="fld"><label for="p_dir">Nombre del destinatario</label><input id="p_dir" value="${esc(PERFIL.directorNombre)}"></div>
            <div class="fld"><label for="p_dirmail">Email del destinatario</label><input id="p_dirmail" type="email" inputmode="email" value="${esc(PERFIL.directorEmail)}"></div></div>
          <label class="check"><input type="checkbox" id="p_fotoobl" ${PERFIL.fotoObligatoria ? 'checked' : ''}> Pedir una foto obligatoria al cerrar cada visita</label>
          <p class="hint">Se puede cambiar para cada establecimiento en sus datos.</p>
        </div>
        <h3>Alertas de clima</h3>
        <div class="card">
          <p class="sub" style="margin-top:0">Una visita con tareas sensibles al clima queda en alerta si el pronóstico supera estos valores.</p>
          <div class="row"><div class="fld"><label for="p_cprob">Probabilidad de lluvia mayor a (%)</label><input id="p_cprob" type="number" inputmode="numeric" value="${AG.UMBRAL().prob}"></div>
            <div class="fld"><label for="p_cmm">Lluvia mayor a (mm)</label><input id="p_cmm" type="number" inputmode="decimal" step="0.5" value="${AG.UMBRAL().mm}"></div></div>
          <div class="row"><div class="fld"><label for="p_cvie">Viento mayor a (km/h)</label><input id="p_cvie" type="number" inputmode="numeric" value="${AG.UMBRAL().viento}"></div>
            <div class="fld"><label for="p_cpat">PAT: lluvia de las 48 h previas mayor a (mm)</label><input id="p_cpat" type="number" inputmode="decimal" value="${AG.UMBRAL().pat}"></div></div>
          <p class="hint">Con la app abierta, revisa el pronóstico cada media hora y te avisa si aparece una alerta nueva, el resumen de mañana (desde las 19 h) y las visitas sin cerrar.</p>
          ${window.Notification ? Notification.permission === 'granted' ? '<p class="sub">Avisos activados en este dispositivo.</p>'
            : `<button class="btn sec block" ${on('activarAvisos')}>${ic('campana')}Activar avisos en este dispositivo</button>` : ''}
        </div>
        <button class="btn block" ${on('guardarPerfil')}>${ic('check')}Guardar mis datos</button>
        <h3>Copia de seguridad</h3>
        <div class="card">
          <p style="margin-top:0">${Sync.sincroniza && Sync.activo() ? 'Con la sincronización activa, tus datos ya están en la nube. La copia es un resguardo extra: descargala cada tanto y guardala en Drive o en la compu.'
            : 'Tus clientes, relevamientos, visitas, legajos y fotos están guardados solo en este dispositivo. Descargá una copia cada semana y guardala en Drive o en la compu: si cambiás de teléfono o se borran los datos del navegador, la restaurás desde acá.'}</p>
          <p class="sub">${ultima ? `Última copia descargada: ${fmtFecha(ultima)}` : 'Todavía no descargaste ninguna copia.'}</p>
          <div class="actions">
            <button class="btn" ${on('exportar')}>${ic('descarga')}Descargar copia</button>
            <label class="btn sec">${ic('subir')}Restaurar copia<input type="file" accept=".json,application/json" hidden ${oc('importar')}></label>
          </div>
        </div>
      </div>`;
    }
  },
  // ---- Razón social ----
  empresa: {
    title: () => S.empresa.razonSocial,
    subtitle: () => rubro(S.empresa.rubro)?.nombre || '',
    async html(){
      const e = S.empresa, d = await datosInicio(), estabs = d.est.filter(s => s.empresaId === e.id).sort((a, b) => a.nombre.localeCompare(b.nombre));
      const aplic = normasAplicables(e, estabs), nov = novedadesEmpresa(e, estabs), pend = nov.filter(x => !x.estado);
      const incompleto = !e.riesgos?.length || !estabs.some(s => s.localidad);
      return `<div class="card rowcard" style="cursor:default">${avatar(e)}
          <div><b>${esc(e.razonSocial)}</b><div class="sub">${esc([e.cuit && 'CUIT ' + e.cuit, e.art && 'ART ' + e.art].filter(Boolean).join(' · ') || 'Sin datos adicionales')}</div></div>
          <button class="btn ghost small" ${on('editarEmpresa')}>Editar</button></div>
        <h3>Contactos</h3>
        ${contactosHtml(e.contactos) ? `<div class="card fold-list">${contactosHtml(e.contactos)}</div>` : aviso('aviso', 'info', `Sin contactos cargados. <a class="link" ${on('editarEmpresa')}>Agregar contactos</a>`)}
        <h3>Normativa</h3>
        <div class="stack">
          ${incompleto ? aviso('aviso', 'info', `Para afinar la normativa, completá los riesgos de la empresa y la localidad de cada establecimiento. <a class="link" ${on('editarEmpresa')}>Completar</a>`) : ''}
          <div class="card rowcard" ${on('go', 'normasEmp')}><div class="tile t-menta">${ic('libro')}</div>
            <div><b>Normativa aplicable</b><div class="sub">${plural(aplic.length, 'norma', 'normas')} según los datos de la empresa</div></div>${ic('chev', 'chev')}</div>
          <div class="card rowcard" ${on('go', 'normasEmp')}><div class="tile t-amarillo">${ic('campana')}</div>
            <div><b>Novedades normativas</b><div class="sub">${CFG.novedades ? (nov.length ? `${plural(nov.length, 'norma nueva', 'normas nuevas')} para este tipo de empresa` : 'Sin novedades para esta empresa') : 'El buscador automático todavía no está activo'}</div></div>
            ${pend.length ? `<span class="badge b-bad">${pend.length} sin revisar</span>` : ''}${ic('chev', 'chev')}</div>
        </div>
        <h3>Establecimientos</h3>
        <div class="list">${estabs.map(s => {
          const enCurso = d.rels.filter(r => r.establecimientoId === s.id && !terminado(r)).length;
          const venc = programacion(s, d.rels).filter(p => p.estado === 'vencido').length;
          return `<div class="card rowcard" ${on('elegirEstab', s.id)}><div class="tile t-verde">${ic('ubicacion')}</div>
            <div><b>${esc(s.nombre)}</b><div class="sub">${esc([s.domicilio, s.localidad].filter(Boolean).join(', ') || 'Sin dirección')}</div></div>
            ${venc ? `<span class="badge b-bad">${venc} vencido${venc > 1 ? 's' : ''}</span>` : enCurso ? `<span class="badge b-mid">${enCurso} en curso</span>` : ''}${ic('chev', 'chev')}</div>`;
        }).join('') || vacio('ubicacion', 'Esta empresa todavía no tiene establecimientos.')}</div>
        <div class="bottom-bar"><div class="actions"><button class="btn hazard" ${on('nuevoEstab')}>${ic('plus')}Agregar establecimiento</button></div></div>`;
    }
  },
  // ---- Establecimiento ----
  estab: {
    title: () => S.estab.nombre,
    subtitle: () => S.empresa.razonSocial,
    async html(){
      const s = S.estab, d = await datosInicio();
      const rels = d.rels.filter(r => r.establecimientoId === s.id), prog = programacion(s, d.rels);
      const venc = prog.filter(p => p.estado === 'vencido' || p.estado === 'porvencer');
      const abiertos = d.seg.filter(o => o.establecimientoId === s.id && o.estado === 'Abierto');
      const item = (accion, icono, color, titulo, sub, badge = '') => `<div class="card mod" ${on(...[].concat(accion))}><div class="tile t-${color}">${ic(icono)}</div>
        <div><b>${titulo}</b><div class="sub">${sub}</div></div>${badge}</div>`;
      await AG.legajoRefrescar();
      const leg = AG.legajoResumen(s);
      return `<div class="card rowcard" style="cursor:default"><div class="tile t-menta">${ic('ubicacion')}</div>
          <div><b>${esc(s.nombre)}</b><div class="sub">${esc([s.domicilio, s.localidad, s.provincia].filter(Boolean).join(', ') || 'Sin dirección')}</div></div>
          ${s.lat != null ? `<a class="hbtn mini" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener" aria-label="Cómo llegar">${ic('ubicacion')}</a>` : ''}
          <button class="btn ghost small" ${on('editarEstab')}>Editar</button></div>
        ${venc.length ? `<div style="margin-top:12px">${aviso(venc.some(p => p.estado === 'vencido') ? 'error' : 'aviso', 'reloj', venc.map(p => `<b>${esc(p.mod.titulo)}</b>: ${textoVence(p)}`).join('<br>'))}</div>` : ''}
        <div class="secc"><h3>Trabajo en planta</h3><div class="grid menu">
          ${item(['go', 'categorias'], 'lista', 'menta', 'Relevamientos', `${plural(rels.filter(r => !terminado(r)).length, 'en curso', 'en curso')} · ${plural(rels.filter(terminado).length, 'terminado', 'terminados')}`)}
          ${item(['nuevaVisita'], 'calendario', 'menta', 'Agendar visita', esc(s.frecVisita ? 'Visita ' + FREC_VISITA.find(f => f[0] === s.frecVisita)[1].toLowerCase() : 'Planificá la próxima visita'))}
          ${item(['nuevoInformeDesvios'], 'camara', 'amarillo', 'Informe de desvío', 'Para un desvío que viste fuera de un relevamiento')}
        </div></div>
        <div class="secc"><h3>Control</h3><div class="grid menu">
          ${item(['go', 'legajo'], 'carpeta', 'menta', 'Legajo técnico', leg.txt, leg.badge)}
          ${item(['go', 'seguimiento'], 'alerta', 'rojo', 'Seguimiento de desvíos', `${plural(abiertos.length, 'desvío abierto', 'desvíos abiertos')}`, abiertos.length ? `<span class="badge b-bad esq">${abiertos.length}</span>` : '')}
          ${item(['go', 'panel'], 'panel', 'menta', 'Programa de relevamientos', `Panel de control · ${plural(prog.filter(p => p.frec).length, 'tema programado', 'temas programados')}`,
            venc.length ? `<span class="badge ${venc.some(p => p.estado === 'vencido') ? 'b-bad' : 'b-mid'} esq">${venc.length}</span>` : '')}
          ${item(['go', 'historial'], 'reloj', 'menta', 'Visitas e historial', 'Visitas, relevamientos, desvíos y pendientes por fecha')}
        </div></div>
        <div class="secc"><h3>Datos</h3><div class="grid menu">
          ${item(['editarEstab'], 'edificio', 'menta', 'Datos del establecimiento', esc([s.responsable && 'Resp.: ' + s.responsable, s.trabajadores && s.trabajadores + ' trabajadores',
            s.frecVisita && 'Visita ' + FREC_VISITA.find(f => f[0] === s.frecVisita)[1].toLowerCase(), s.horasMes && s.horasMes + ' h/mes'].filter(Boolean).join(' · ') || 'Dirección, responsable, trabajadores, visitas, legajo'))}
        </div></div>`;
    }
  },
  // ---- Temas de relevamiento ----
  categorias: {
    title: () => 'Relevamientos',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    async html(){
      const e = S.empresa, rb = rubro(e.rubro);
      const rec = (rb?.recomendados || []).filter(id => CFG.modulos[id]);
      const rels = (await getAll('relevamientos')).filter(r => r.establecimientoId === S.estab.id && esRelev(r));
      const verOtros = S.verOtros || !rec.length;
      const card = id => {
        const m = CFG.modulos[id], marcado = S.sel.has(id);
        return `<div class="card mod ${S.general ? 'has-chk' : ''} ${S.general && marcado ? 'sel' : ''}" ${S.general ? on('toggleSel', id) : on('nuevoRelev', [id])}>
          ${tile(m)}<div><b>${esc(m.titulo)}</b><div class="sub">${esc(m.descripcion || '')}</div></div>
          ${S.general ? `<span class="chk">${marcado ? ic('check') : ''}</span>` : ''}</div>`;
      };
      const otros = CFG.orden.filter(id => !rec.includes(id) && CFG.modulos[id]), grupos = [];
      for (const id of otros) {
        const g = CFG.modulos[id].grupo || 'Otros temas';
        (grupos.find(x => x.g === g) || (grupos.push({g, ids: []}), grupos[grupos.length - 1])).ids.push(id);
      }
      const carpeta = (k, titulo, n, icono, color) => `<div class="card rowcard" ${on('abrirCarpeta', k)}><div class="tile t-${color}">${ic(icono)}</div>
        <div><b>${titulo}</b><div class="sub">${plural(n, 'relevamiento', 'relevamientos')}</div></div>${ic('chev', 'chev')}</div>`;
      return `<div class="seg">
          <button class="${S.general ? '' : 'on'}" ${on('setModo', false)}>Por tema</button>
          <button class="${S.general ? 'on' : ''}" ${on('setModo', true)}>Informe general</button>
        </div>
        <p class="sub">${S.general ? 'Marcá los temas de esta visita: sale un único informe con todos.' : 'Tocá un tema para empezar a relevar.'}</p>
        ${rec.length ? `<h3>Recomendados para ${esc(rb.nombre)}</h3><div class="grid">${rec.map(card).join('')}</div>` : ''}
        ${rec.length ? `<div class="card rowcard folder ${verOtros ? 'open' : ''}" style="margin-top:12px" ${on('toggleOtros')}><div class="tile t-menta">${ic('carpeta')}</div>
          <div><b>${verOtros ? 'Ocultar los demás temas' : 'Todos los temas'}</b><div class="sub">${plural(otros.length, 'tema más', 'temas más')}: ${esc(otros.slice(0, 4).map(id => CFG.modulos[id].titulo).join(', '))}…</div></div>${ic('chev', 'chev')}</div>` : ''}
        ${verOtros ? grupos.map(x => `<h3>${esc(x.g)}</h3><div class="grid">${x.ids.map(card).join('')}</div>`).join('') : ''}
        <h3>Relevamientos anteriores</h3>
        <div class="list">${carpeta('curso', 'En curso', rels.filter(r => !terminado(r)).length, 'reloj', 'amarillo')}${carpeta('terminados', 'Terminados', rels.filter(terminado).length, 'ok', 'verde')}</div>
        ${S.general ? `<div class="bottom-bar"><div class="actions"><button class="btn hazard" ${S.sel.size ? '' : 'disabled'} ${on('nuevoRelev', [...S.sel])}>Comenzar relevamiento general (${S.sel.size})</button></div></div>` : ''}`;
    }
  },
  carpeta: {
    title: () => S.carpeta === 'curso' ? 'En curso' : 'Terminados',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    async html(){
      const rels = (await getAll('relevamientos')).filter(r => r.establecimientoId === S.estab.id && esRelev(r) && (S.carpeta === 'curso' ? !terminado(r) : terminado(r)))
        .sort((a, b) => b.fecha_relevamiento.localeCompare(a.fecha_relevamiento) || b.creado - a.creado);
      if (!rels.length) return vacio('carpeta', S.carpeta === 'curso' ? 'No hay relevamientos en curso.' : 'Todavía no hay relevamientos terminados.');
      // Subcarpetas por tema
      const grupos = new Map();
      for (const r of rels) {
        const k = r.tipo === 'desvios' ? 'desvios' : r.modulos.length > 1 ? 'general' : r.modulos[0].modulo_id;
        if (!grupos.has(k)) grupos.set(k, {titulo: tituloRelev(r), icono: iconoRelev(r), rels: []});
        grupos.get(k).rels.push(r);
      }
      return `<div class="stack">${[...grupos.values()].map((g, i) => `<details class="card fold" ${grupos.size === 1 || i === 0 ? 'open' : ''}>
          <summary>${tile(g.icono)}<div><b>${esc(g.titulo)}</b><div class="sub">${plural(g.rels.length, 'relevamiento', 'relevamientos')}</div></div>${ic('chev', 'chev')}</summary>
          ${g.rels.map(r => filaRelevHtml(r)).join('')}</details>`).join('')}</div>
        <p class="sub">Mantené apretado un relevamiento para ver las opciones (descargar, compartir, eliminar).</p>`;
    }
  },
  // ---- Resumen del relevamiento ----
  relev: {
    title: () => tituloRelev(S.relev),
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    html(){
      const r = S.relev, M = calcular();
      return `<div class="card"><div class="row">
          <div class="fld"><label for="r_fecha">Fecha del relevamiento</label><input id="r_fecha" type="date" value="${r.fecha_relevamiento}" ${oc('setRelev', 'fecha_relevamiento', true)}></div>
          <div class="fld"><label for="r_acomp">Acompañó la recorrida</label><input id="r_acomp" value="${esc(r.acompanante)}" placeholder="Nombre y cargo" ${oi('setRelev', 'acompanante')}></div></div></div>
        ${M.modulos.map((m, mi) => {
          const md = m.mod, sing = md.nombre_elemento.toLowerCase(), est = md.tipo_elemento === 'establecimiento';
          const gen = m.generales ? md.items_generales.length - m.generales.faltan.length : 0;
          const resumen = est ? (m.elementos[0]?.ev.completo ? estadoTexto(m.elementos[0]) : 'Checklist pendiente')
            : `${Motor.cant(m.elementos.length, sing, (md.nombre_elemento_plural || md.nombre_elemento + 's').toLowerCase())}${m.ind.noConformes ? ` · ${m.ind.noConformes} con desvíos` : ''}`;
          return `<h3>${esc(md.grupo || 'Tema')}</h3><div class="card">
            <div class="modhead">${tile(md)}<div><h4 style="margin:0">${esc(md.titulo)}</h4><div class="sub">${esc(resumen)}</div></div></div>
            ${m.elementos.map((e, ei) => `<div class="el" ${on('abrirElemento', mi, ei)}>${estadoDot(e)}
              <div><b>${est ? (e.ev.completo ? 'Ver checklist' : 'Completar checklist') : esc(e.nombre)}</b>${e.sector && md.tipo_elemento === 'equipo' ? ` <span class="sub">· ${esc(e.sector)}</span>` : ''}</div>${estadoBadge(e)}${ic('chev', 'chev')}</div>`).join('')}
            <div class="actions" style="margin-top:12px">
              ${!est ? `<button class="btn sec" ${on('agregarElemento', mi)}>${ic('plus')}Agregar ${esc(sing)}</button>` : ''}
              ${m.generales ? `<button class="btn ghost" ${on('abrirGenerales', mi)}>Verificaciones generales · ${gen}/${md.items_generales.length}</button>` : ''}
            </div>
            ${frecuenciaHtml(md.id)}
            <label for="obs_${mi}">Observaciones (opcional, van al informe)</label>
            <textarea id="obs_${mi}" ${oi('setObsModulo', mi)}>${esc(m.rm.observaciones)}</textarea>
          </div>`;
        }).join('')}
        <h3>Anexo fotográfico</h3>
        <div class="card rowcard" ${on('go', 'fotosGen')}><div class="tile t-menta">${ic('imagen')}</div>
          <div><b>Fotos generales</b><div class="sub">${r.fotos_generales.length} foto(s) del establecimiento</div></div>${ic('chev', 'chev')}</div>
        <h3>Legajo técnico</h3>
        <div class="card rowcard" ${on('legRevisar')}><div class="tile t-menta">${ic('carpeta')}</div>
          <div><b>Revisión de legajo</b><div class="sub">Opcional: aprovechá la recorrida para revisar la documentación</div></div>${ic('chev', 'chev')}</div>
        <div class="bottom-bar"><div class="actions"><button class="btn hazard" ${on('go', 'informe')}>${ic('doc')}Revisar y generar informes</button></div></div>`;
    }
  },
  // ---- Carga de un elemento ----
  elemento: {
    title: () => nombreEl(),
    html(){
      const sectores = [...new Set(S.relev.modulos.flatMap(m => m.elementos.map(e => e.sector)).filter(Boolean))];
      const m = mod(), sing = m.nombre_elemento.toLowerCase(), est = m.tipo_elemento === 'establecimiento';
      const datos = atributosHtml();
      return `<div class="stack">
        ${modCardHtml()}
        ${datos ? `<div class="card" id="atributos">${datos}</div>` : '<div id="atributos" hidden></div>'}
        <datalist id="sectores">${sectores.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <div id="checklist" class="stack">${checklistHtml()}</div>
        <h3>Registro fotográfico</h3>
        <div class="card">
          ${botonesFoto('el')}
          ${fotosHtml(el().fotos, 'el')}
        </div>
        ${!est ? `<button class="btn danger block" ${on('eliminarElemento')}>${ic('basura')}Eliminar ${esc(nombreEl())}</button>` : ''}
      </div>
      <div class="bottom-bar"><div class="actions">
        ${!est ? `<button class="btn sec" ${on('siguienteElemento')}>${ic('plus')}Agregar ${esc(sing)}</button>` : ''}
        <button class="btn" ${on('terminarElemento')}>${ic('check')}Terminar</button>
      </div></div>`;
    }
  },
  generales: {
    title: () => 'Verificaciones generales',
    subtitle: () => mod().titulo,
    html: () => `<div class="stack">${modCardHtml()}${aviso('info', 'info', 'Se evalúan una sola vez para todo el establecimiento.')}
      <div id="checklist" class="stack">${checklistHtml()}</div></div>
      <div class="bottom-bar"><div class="actions"><button class="btn" ${on('terminarGenerales')}>${ic('check')}Listo</button></div></div>`
  },
  fotosGen: {
    title: () => 'Fotos generales',
    subtitle: () => S.estab.nombre,
    html: () => `<div class="stack"><p class="sub" style="margin:0">Fotos del establecimiento que no corresponden a un elemento puntual. Van al anexo fotográfico del informe.</p>
      <div class="card">${botonesFoto('gen')}${fotosHtml(S.relev.fotos_generales, 'gen')}</div></div>
      <div class="bottom-bar"><div class="actions"><button class="btn" ${on('go', 'relev')}>${ic('check')}Listo</button></div></div>`
  },
  // ---- Revisión y emisión de los informes ----
  informe: {
    title: () => 'Informes',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    async html(){
      const M = await calcularConPrevio(), r = S.relev, t = M.total;
      const kpi = (n, l, c) => `<div class="kpi ${c}"><b>${n}</b><span>${l}</span></div>`;
      const C = 2 * Math.PI * 46, pct = t.pct;
      const sinFrec = r.modulos.filter(m => !+S.estab.programa?.[m.modulo_id]?.frec);
      const texto = k => {
        const editado = r.textos_editados?.[k] != null, lbl = {objetivo: 'Objetivo', alcance: 'Alcance', conclusion: 'Conclusiones'}[k];
        return `<label for="tx_${k}">${lbl} ${editado ? '<span class="badge b-mid">editado a mano</span>' : ''}</label>
          <textarea id="tx_${k}" rows="${Math.min(10, M.textos[k].split('\n').length + 3)}" ${oi('editarTexto', k)}>${esc(M.textos[k])}</textarea>
          ${editado ? `<button class="btn ghost small" style="margin-top:6px" ${on('restaurarTexto', k)}>${ic('auto')}Restaurar texto automático</button>` : ''}`;
      };
      return `<div class="stack">
        ${M.incompletos.length ? aviso('error', 'alerta', `<b>Faltan datos para emitir el informe:</b><ul style="margin:6px 0 0;padding-left:18px">
          ${M.incompletos.map(i => `<li>${esc(i.modulo)} – ${esc(i.nombre)}: ${esc(i.faltan.slice(0, 3).join(', '))}${i.faltan.length > 3 ? '…' : ''}</li>`).join('')}</ul>`) : ''}
        ${PERFIL.nombre ? '' : aviso('aviso', 'info', `Tus datos de profesional están vacíos: el informe saldrá sin nombre ni matrícula. <a class="link" ${on('go', 'perfil')}>Cargarlos</a>`)}
        <div class="card result">
          <svg class="donut" viewBox="0 0 120 120" role="img" aria-label="Cumplimiento ${pct} %">
            <circle class="bg" cx="60" cy="60" r="46" fill="none" stroke-width="14"/>
            <circle class="fg" cx="60" cy="60" r="46" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C * pct / 100} ${C}" transform="rotate(-90 60 60)"/>
            <text x="60" y="68" text-anchor="middle">${pct}%</text>
          </svg>
          <div><div class="sub" style="margin-bottom:8px">Cumplimiento sobre ${t.C + t.NC} ítems evaluados</div>
            <div class="kpis">${kpi(t.elementos, 'Elementos', 'b-na')}${kpi(t.conformes, 'Conformes', 'b-ok')}${kpi(t.noConformes, 'Con desvíos', 'b-bad')}
            ${M.prioridadesUsadas.map(p => kpi(t.prioridades[p], 'Prioridad ' + p, 'b-' + p)).join('')}</div></div>
        </div>
        <div class="card"><div class="fld"><label for="i_fecha">Fecha del relevamiento</label><input id="i_fecha" type="date" value="${r.fecha_relevamiento}" ${oc('setRelev', 'fecha_relevamiento', true)}></div>
          <div class="row"><div class="fld"><label for="i_emision">Fecha de emisión</label><input id="i_emision" type="date" value="${r.fecha_emision || hoy()}" ${oc('setRelev', 'fecha_emision')}></div>
          <div class="fld"><label for="i_acomp">Acompañó la recorrida</label><input id="i_acomp" value="${esc(r.acompanante)}" placeholder="Nombre y cargo" ${oi('setRelev', 'acompanante')}></div></div>
          ${r.modulos.map(m => frecuenciaHtml(m.modulo_id, r.modulos.length > 1)).join('')}</div>
        ${sinFrec.length ? aviso('aviso', 'reloj', 'Elegí cada cuánto se repite este relevamiento: así aparece en el panel de control y la app te avisa cuando se vence.') : ''}
      </div>
      <h3>Desvíos detectados · ${M.desvios.length}</h3>
      <div class="card">${M.desvios.map(d => `<div class="desv"><span class="bar ${d.prioridad}"></span><div>${esc(d.texto)}
          <div class="sub">${esc(dondeDesvio(d))}</div></div>
          <span class="badge b-${d.prioridad}">${d.prioridad}</span></div>`).join('') || `<div class="sub">${ic('ok')} No se detectaron desvíos.</div>`}</div>
      ${M.seguimiento ? `<div style="margin-top:12px">${aviso('aviso', 'auto', `Se incluye el seguimiento del relevamiento del ${fmtFecha(M.seguimiento.fecha)}: ${M.seguimiento.filas.filter(f => f.estado === 'Cerrada').length} acciones cerradas y ${M.seguimiento.filas.filter(f => f.estado === 'Pendiente').length} pendientes.`)}</div>` : ''}
      <h3>Textos del informe</h3>
      <div class="card"><p class="sub" style="margin-top:0">Se generan solos a partir de los datos. Podés corregirlos antes de emitir.</p>${texto('objetivo')}${texto('alcance')}${texto('conclusion')}</div>
      <div id="resultadoInforme" style="margin-top:12px">${resultadoInformeHtml()}</div>
      <div class="bottom-bar"><div class="actions"><button class="btn hazard" ${M.incompletos.length ? 'disabled' : ''} ${on('generarInforme')}>${ic('doc')}Generar los 2 informes</button></div></div>`;
    }
  },
  // ---- Panel de control ----
  panel: {
    title: () => 'Panel de control',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    async html(){
      const prog = programacion(S.estab, (await getAll('relevamientos')).filter(esRelev)), Y = S.anio, mesHoy = new Date().getFullYear() === Y ? new Date().getMonth() : -1;
      const prg = prog.filter(p => p.frec);
      const celda = (c, i) => `<td class="m ${c} ${i === mesHoy ? 'hoy' : ''}">${{h: '✓', v: '!', p: ''}[c] || ''}</td>`;
      return `<div class="between"><button class="btn ghost small" ${on('setAnio', Y - 1)}>‹ ${Y - 1}</button><h2 style="margin:0">${Y}</h2><button class="btn ghost small" ${on('setAnio', Y + 1)}>${Y + 1} ›</button></div>
        <div class="leyenda"><span><i class="m h">✓</i>Hecho</span><span><i class="m p"></i>Programado</span><span><i class="m v">!</i>Vencido</span></div>
        ${prg.length ? `<div class="card tabla-scroll"><table class="prog"><thead><tr><th>Tema</th>${MESES.map(m => `<th>${m}</th>`).join('')}</tr></thead>
          <tbody>${prg.map(p => `<tr><td class="t"><b>${esc(p.mod.titulo)}</b><div class="sub">${nombreFrec(p.frec)} · ${esc(p.responsable)}</div></td>${mesesDelAnio(p, Y).map(celda).join('')}</tr>`).join('')}</tbody></table></div>`
          : vacio('panel', 'Todavía no hay temas programados. Elegí la frecuencia de cada tema abajo, o al hacer un relevamiento.')}
        <h3>Estado de cada tema</h3>
        <div class="list">${prog.map(p => `<div class="card">
            <div class="modhead">${tile(p.mod)}<div><b>${esc(p.mod.titulo)}</b><div class="sub">${p.ultimo ? 'Último: ' + fmtFecha(p.ultimo) : 'Sin relevamientos terminados'}${p.proximo ? ` · Próximo: ${fmtFecha(p.proximo)}` : ''}</div></div>
              <span class="badge ${ESTADO_PROG[p.estado][1]}">${ESTADO_PROG[p.estado][0]}</span></div>
            <div class="row"><div class="fld"><label>Frecuencia</label><select ${oc('setFrec', p.id)}>${opcionesFrec(p.frec)}</select></div>
              <div class="fld"><label>Responsable</label><input value="${esc(p.responsable)}" ${oc('setRespProg', p.id)}></div></div>
          </div>`).join('')}
          <div class="card rowcard" ${on('agregarAlPrograma')}><div class="tile t-menta">${ic('plus')}</div><div><b>Programar otro tema</b><div class="sub">Aunque todavía no lo hayas relevado</div></div></div>
        </div>
        <div class="bottom-bar"><div class="actions"><button class="btn sec" ${on('excelPanel', 'descargar')}>${ic('descarga')}Descargar Excel</button><button class="btn sec" ${on('excelPanel', 'compartir')}>${ic('compartir')}Compartir</button></div></div>`;
    }
  },
  // ---- Seguimiento de desvíos ----
  seguimiento: {
    title: () => 'Seguimiento de desvíos',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    async html(){
      const todos = (await getAll('seguimiento')).filter(o => o.establecimientoId === S.estab.id).sort((a, b) => a.n - b.n);
      const n = k => todos.filter(o => k === 'Todos' || o.estado === k).length;
      const lista = todos.filter(o => S.segFiltro === 'Todos' || o.estado === S.segFiltro)
        .sort((a, b) => S.segFiltro === 'Abierto' ? Motor.PRIORIDADES.indexOf(a.prioridad) - Motor.PRIORIDADES.indexOf(b.prioridad) || a.n - b.n : a.n - b.n);
      return `<div class="seg tres">${['Abierto', 'Cerrado', 'Todos'].map(k => `<button class="${S.segFiltro === k ? 'on' : ''}" ${on('setSegFiltro', k)}>${k === 'Todos' ? 'Todos' : k + 's'} (${n(k)})</button>`).join('')}</div>
        <p class="sub">Los desvíos de cada relevamiento se cargan solos al generar el informe, y se cierran solos cuando un relevamiento posterior del mismo tema da "Cumple".</p>
        <div class="list">${lista.map(o => `<div class="card obs" ${on('abrirObs', o.id)}><span class="bar ${o.prioridad}"></span>
            <div><div class="between"><b>N° ${o.n} · ${esc(o.sector || 'General')}</b><span class="badge ${o.estado === 'Cerrado' ? 'b-ok' : 'b-bad'}">${o.estado}</span></div>
            <div>${esc(o.texto)}</div>
            <div class="sub">${fmtFecha(o.fecha)} · ${esc(o.origen || '')}${o.estado === 'Cerrado' && o.fechaCierre ? ` · cerrado el ${fmtFecha(o.fechaCierre)}` : ''}</div></div>
            <span class="badge b-${o.prioridad}">${o.prioridad}</span></div>`).join('') || vacio('ok', S.segFiltro === 'Abierto' ? 'No hay desvíos abiertos.' : 'No hay desvíos en esta lista.')}</div>
        <div class="bottom-bar"><div class="actions"><button class="btn sec" ${on('excelSeguimiento', 'descargar')}>${ic('descarga')}Excel</button><button class="btn sec" ${on('excelSeguimiento', 'compartir')}>${ic('compartir')}Compartir</button><button class="btn" ${on('nuevaObs')}>${ic('plus')}Agregar</button></div></div>`;
    }
  },
  obsForm: {
    title: () => S.obs.n ? `Desvío N° ${S.obs.n}` : 'Nuevo desvío',
    subtitle: () => S.estab.nombre,
    html(){
      const o = S.obs;
      return `<div class="stack"><div class="card">
          <label for="o_sector">Tipo / Sector *</label><input id="o_sector" value="${esc(o.sector)}" placeholder="Ej.: Tablero general, Torno 1, Depósito">
          <label for="o_texto">Observación *</label><textarea id="o_texto">${esc(o.texto)}</textarea>
          <label for="o_accion">Acción correctiva</label><textarea id="o_accion">${esc(o.accion)}</textarea>
          <div class="row"><div class="fld"><label for="o_fecha">Fecha</label><input id="o_fecha" type="date" value="${o.fecha}"></div>
            <div class="fld"><label for="o_resp">Responsable</label><input id="o_resp" value="${esc(o.responsable)}"></div></div>
          <label>Prioridad</label><div class="prio" id="o_prio">${Motor.PRIORIDADES.map(p => `<button class="${p} ${o.prioridad === p ? 'on' : ''}" ${on('setObsCampo', 'prioridad', p)}>${p}</button>`).join('')}</div>
          <label>Estado</label><div class="chips" id="o_estado">${['Abierto', 'Cerrado'].map(k => `<button class="chip ${o.estado === k ? 'on' : ''}" ${on('setObsCampo', 'estado', k)}>${k}</button>`).join('')}</div>
          <div id="o_cierre" ${o.estado === 'Cerrado' ? '' : 'hidden'}><div class="row"><div class="fld"><label for="o_fcierre">Fecha de cierre</label><input id="o_fcierre" type="date" value="${o.fechaCierre || hoy()}"></div>
            <div class="fld"><label for="o_ccierre">Cómo se resolvió</label><input id="o_ccierre" value="${esc(o.cierre)}"></div></div></div>
        </div>
        ${o.origen ? `<p class="sub">Origen: ${esc(o.origen)}</p>` : ''}
        ${o.n ? `<button class="btn danger block" ${on('eliminarObs')}>${ic('basura')}Eliminar del seguimiento</button>` : ''}</div>
        <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('atras')}>Cancelar</button><button class="btn" ${on('guardarObs')}>${ic('check')}Guardar</button></div></div>`;
    }
  },
  // ---- Informe de desvíos fuera de un relevamiento ----
  desvios: {
    title: () => 'Informe de desvíos',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    html(){
      const r = S.relev;
      return `<div class="stack">${aviso('aviso', 'info', 'Para desvíos que viste en una visita sin hacer un relevamiento completo. Sale un informe corto para el responsable y cada desvío pasa al seguimiento.')}
        <div class="card"><div class="row">
          <div class="fld"><label for="d_fecha">Fecha</label><input id="d_fecha" type="date" value="${r.fecha_relevamiento}" ${oc('setRelev', 'fecha_relevamiento')}></div>
          <div class="fld"><label for="d_acomp">Acompañó la recorrida</label><input id="d_acomp" value="${esc(r.acompanante)}" placeholder="Nombre y cargo" ${oi('setRelev', 'acompanante')}></div></div></div></div>
        <h3>Desvíos · ${r.desvios.length}</h3>
        <div class="card">${r.desvios.map((d, i) => `<div class="desv" ${on('abrirDesvio', i)} style="cursor:pointer"><span class="bar ${d.prioridad}"></span><div><b>${esc(d.sector || 'Sin sector')}</b>
            <div>${esc(d.texto || 'Sin descripción')}</div><div class="sub">${d.fotos.length} foto(s)</div></div><span class="badge b-${d.prioridad}">${d.prioridad}</span></div>`).join('')
          || `<div class="sub">Todavía no cargaste desvíos.</div>`}
          <div class="actions" style="margin-top:12px"><button class="btn sec" ${on('agregarDesvio')}>${ic('plus')}Agregar desvío</button></div></div>
        <div id="resultadoInforme" style="margin-top:12px">${resultadoInformeHtml()}</div>
        <div class="bottom-bar"><div class="actions"><button class="btn hazard" ${r.desvios.length ? '' : 'disabled'} ${on('generarInformeDesvios')}>${ic('doc')}Generar informe</button></div></div>`;
    }
  },
  desvioEl: {
    title: () => `Desvío ${S.di + 1}`,
    subtitle: () => S.estab.nombre,
    async html(){
      const d = S.relev.desvios[S.di];
      const sectores = [...new Set((await getAll('seguimiento')).filter(o => o.establecimientoId === S.estab.id).map(o => o.sector).filter(Boolean))];
      return `<div class="stack"><div class="card">
          <datalist id="sectores">${sectores.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
          <label for="dv_sector">Dónde (tipo / sector) *</label><input id="dv_sector" list="sectores" value="${esc(d.sector)}" placeholder="Ej.: Portón de ingreso, Tablero general" ${oi('setDesvio', 'sector')}>
          <label for="dv_texto">Qué se observó *</label><textarea id="dv_texto" ${oi('setDesvio', 'texto')}>${esc(d.texto)}</textarea>
          <label for="dv_accion">Qué hay que hacer</label><textarea id="dv_accion" placeholder="Acción correctiva" ${oi('setDesvio', 'accion')}>${esc(d.accion)}</textarea>
          <label for="dv_resp">Responsable de la corrección</label><input id="dv_resp" value="${esc(d.responsable)}" ${oi('setDesvio', 'responsable')}>
          <label>Prioridad</label><div class="prio" id="dv_prio">${prioHtml(d.prioridad)}</div>
        </div>
        <h3>Fotos</h3><div class="card">${botonesFoto('desv')}${fotosHtml(d.fotos, 'desv')}</div>
        <button class="btn danger block" ${on('eliminarDesvio')}>${ic('basura')}Eliminar este desvío</button></div>
        <div class="bottom-bar"><div class="actions"><button class="btn sec" ${on('agregarDesvio')}>${ic('plus')}Otro desvío</button><button class="btn" ${on('go', 'desvios')}>${ic('check')}Listo</button></div></div>`;
    }
  },
  // ---- Normativa de una empresa ----
  normasEmp: {
    title: () => 'Normativa',
    subtitle: () => S.empresa.razonSocial,
    async html(){
      const e = S.empresa, estabs = (await getAll('establecimientos')).filter(s => s.empresaId === e.id);
      const aplic = normasAplicables(e, estabs), nov = novedadesEmpresa(e, estabs, true);
      const ambitos = ['Nación', 'Santa Fe', 'Rosario'].filter(a => aplic.some(x => x.n.ambito === a));
      return `<h3 style="margin-top:4px">Novedades normativas</h3>
        <div class="stack">${!CFG.novedades ? aviso('aviso', 'info', 'El buscador automático de normativa nueva todavía no está activo: se activa cuando la app quede publicada en internet (web instalable).')
          : nov.length ? nov.map(x => novedadHtml(x.n, x.c, x.estado, e.id)).join('') : vacio('campana', 'No hay normas nuevas que apliquen a esta empresa.')}</div>
        <h3>Normativa aplicable · ${aplic.length}</h3>
        <p class="sub" style="margin-top:0">Según rubro, riesgos, ubicación y programas cargados en la empresa. Tocá una norma para leerla.</p>
        ${ambitos.map(a => `<div class="list" style="margin-bottom:12px"><div class="sub"><b>${a}</b></div>${aplic.filter(x => x.n.ambito === a).map(({n, motivo}) => `
          <a class="card rowcard norma" href="${esc(n.url)}" target="_blank" rel="noopener"><div class="tile t-menta">${ic('libro')}</div>
            <div><b>${esc(n.codigo)}</b><div class="txt">${esc(n.titulo)}</div><div class="sub">${esc(motivo)}${n.busqueda ? ' · abre una búsqueda' : ''}</div></div>${ic('link', 'chev')}</a>`).join('')}</div>`).join('')}`;
    }
  },
  // ---- Normativa general (todas las novedades) ----
  normativa: {
    title: () => 'Normativa',
    async html(){
      const d = await datosInicio(), q = sinAcentos(S.normBuscar);
      const todas = (CFG.novedades?.normas || []).slice().sort((a, b) => b.fecha.localeCompare(a.fecha))
        .filter(n => S.normJur === 'Todas' || sinAcentos(n.jurisdiccion).includes(sinAcentos(S.normJur)))
        .filter(n => !q || sinAcentos(`${n.titulo} ${n.tipo} ${n.numero} ${n.organismo} ${n.resumen || ''}`).includes(q));
      const empresasDe = n => d.emp.map(e => ({e, c: cruceNovedad(n, e, d.est.filter(s => s.empresaId === e.id))})).filter(x => x.c && estadoNorma(x.e.id, n.id) !== 'no_aplica');
      setTimeout(marcarLeidas, 1500);
      if (!CFG.novedades) return aviso('aviso', 'info', `El buscador automático de normativa nueva todavía no está activo. Se activa cuando la app quede publicada en internet: todos los días hábiles revisa el Boletín Oficial y te muestra acá las normas de Higiene y Seguridad, marcando a qué empresas les aplica.<br><br>Mientras tanto, en cada empresa podés ver la <b>normativa aplicable</b> según sus datos.`);
      return `<div class="stack">
        <div class="search">${ic('search')}<input id="bnorma" placeholder="Buscar norma, número u organismo" value="${esc(S.normBuscar)}" ${oc('buscarNorma')}></div>
        <div class="chips">${['Todas', 'Nación', 'Santa Fe', 'Rosario'].map(j => `<button class="chip ${S.normJur === j ? 'on' : ''}" ${on('setNormJur', j)}>${j}</button>`).join('')}</div>
        <p class="sub" style="margin:0">Actualizado el ${fmtFecha(CFG.novedades.actualizado?.slice(0, 10))} · ${plural(todas.length, 'norma', 'normas')}</p>
        ${todas.map(n => {
          const emps = empresasDe(n);
          return `<div class="card nov ${NORMAS.leidas[n.id] ? '' : 'nueva'}">
            <div class="sub">${fmtFecha(n.fecha)} · ${esc(n.jurisdiccion)} · ${esc(n.organismo || '')}</div>
            <b>${esc([n.tipo, n.numero].filter(Boolean).join(' '))}</b><div>${esc(n.titulo)}</div>
            ${resumenNovedad(n)}
            <div class="sub" style="margin-top:6px">${emps.length ? `${ic('edificio')} ${emps.map(x => `<a class="link" ${on('abrirEmpresaNormas', x.e.id)}>${esc(x.e.razonSocial)}</a>${x.c.nivel === 'Aplica' ? '' : ' (posiblemente)'}`).join(', ')}` : 'No aplica a tus empresas cargadas'}</div>
            <a class="btn sec small" style="margin-top:10px" href="${esc(n.url)}" target="_blank" rel="noopener">${ic('link')}Leer la norma</a></div>`;
        }).join('') || vacio('libro', 'No hay normas que coincidan.')}</div>`;
    }
  }
};

// ===== Componentes =====
function listaEmpresasHtml(d){
  const f = sinAcentos(S.filtro);
  const lista = d.emp.filter(e => !f || sinAcentos(e.razonSocial).includes(f) || (e.cuit || '').includes(f));
  return lista.map(e => {
    const estabs = d.est.filter(s => s.empresaId === e.id);
    const enCurso = d.rels.filter(r => estabs.some(s => s.id === r.establecimientoId) && !terminado(r)).length;
    const venc = estabs.reduce((n, s) => n + programacion(s, d.rels).filter(p => p.estado === 'vencido').length, 0);
    const nov = CFG.novedades ? sinRevisar(e, estabs) : 0;
    return `<div class="card rowcard" ${on('elegirEmpresa', e.id)}>${avatar(e)}
      <div><b>${esc(e.razonSocial)}</b><div class="sub">${esc([rubro(e.rubro)?.nombre, plural(estabs.length, 'establecimiento', 'establecimientos')].filter(Boolean).join(' · '))}</div></div>
      <div class="badges">${venc ? `<span class="badge b-bad">${venc} vencido${venc > 1 ? 's' : ''}</span>` : ''}${enCurso ? `<span class="badge b-mid">${enCurso} en curso</span>` : ''}${nov ? `<span class="badge b-azul">${ic('campana')}${nov}</span>` : ''}</div>${ic('chev', 'chev')}</div>`;
  }).join('') || vacio('edificio', d.emp.length ? 'No hay empresas que coincidan con la búsqueda.' : 'Todavía no cargaste empresas. Empezá con “Agregar empresa”.');
}

// Establecimientos para elegir dónde relevar (Nuevo relevamiento del Inicio)
function listaEstabHtml(d){
  const f = sinAcentos(S.filtroEst);
  const filas = d.est.map(s => ({s, e: d.emp.find(e => e.id === s.empresaId)})).filter(x => x.e && (!f || sinAcentos(`${x.e.razonSocial} ${x.s.nombre} ${x.s.localidad}`).includes(f)))
    .sort((a, b) => a.e.razonSocial.localeCompare(b.e.razonSocial) || a.s.nombre.localeCompare(b.s.nombre));
  return filas.map(({s, e}) => `<div class="card rowcard" ${on('relevarEstab', s.id)}>${avatar(e)}
    <div><b>${esc(e.razonSocial)}</b><div class="sub">${esc([s.nombre, s.localidad].filter(Boolean).join(' · '))}</div></div>${ic('chev', 'chev')}</div>`).join('')
    || vacio('search', 'No hay establecimientos que coincidan.');
}

// Relevamientos agrupados por empresa (inicio: En curso / Informes)
function relevsPorEmpresaHtml(d, filtro, txtVacio){
  const rels = d.rels.filter(filtro).sort((a, b) => b.fecha_relevamiento.localeCompare(a.fecha_relevamiento));
  const grupos = d.emp.map(e => ({e, rels: rels.filter(r => d.est.some(s => s.id === r.establecimientoId && s.empresaId === e.id))})).filter(g => g.rels.length);
  return grupos.map(g => `<details class="card fold" open><summary>${avatar(g.e)}<div><b>${esc(g.e.razonSocial)}</b><div class="sub">${plural(g.rels.length, 'relevamiento', 'relevamientos')}</div></div>${ic('chev', 'chev')}</summary>
    ${g.rels.map(r => filaRelevHtml(r, d.est.find(s => s.id === r.establecimientoId))).join('')}</details>`).join('') || vacio('doc', txtVacio);
}

function filaRelevHtml(r, estab){
  const n = r.tipo === 'desvios' ? plural(r.desvios.length, 'desvío', 'desvíos') : plural(r.modulos.reduce((s, m) => s + m.elementos.length, 0), 'elemento', 'elementos');
  return `<div class="el" ${on('abrirRelev', r.id)} ${olp('menuRelev', r.id)}>${tile(iconoRelev(r))}
    <div><b>${esc(tituloRelev(r))}</b><div class="sub">${fmtFecha(r.fecha_relevamiento)}${estab ? ' · ' + esc(estab.nombre) : ''} · ${n}</div></div>
    <span class="badge ${terminado(r) ? 'b-ok' : 'b-mid'}">${terminado(r) ? 'Emitido' : 'En curso'}</span>
    <button class="hbtn mini" ${on('menuRelev', r.id)} aria-label="Opciones">${ic('mas')}</button></div>`;
}

function actividadesHtml(){
  return ACTIVIDADES.lista.map((a, i) => `<div class="card actividad ${a.activa ? '' : 'inactiva'}">
    <input id="act_${i}" value="${esc(a.nombre)}" placeholder="Nombre de la actividad" aria-label="Nombre de la actividad" ${oc('setActividad', i)}>
    <div class="chips" style="margin-top:10px">
      <button class="chip small ${a.clima ? 'on' : ''}" ${on('toggleActividad', i, 'clima')}>${ic('lluvia')}Sensible al clima</button>
      <button class="chip small ${a.activa ? 'on' : ''}" ${on('toggleActividad', i, 'activa')}>${a.activa ? ic('check') + 'Activa' : 'Desactivada'}</button>
    </div>
    ${(() => { const rs = (AG.legajoCatalogo()?.requisitos || []).filter(r => (r.actividades || []).includes(a.id));
      return rs.length ? `<p class="hint">Al cerrar una visita con esta tarea hecha, renueva en el legajo: ${rs.map(r => `<b>${esc(r.codigo)}</b> ${esc(r.nombre)}`).join(', ')}.</p>` : ''; })()}</div>`).join('');
}

// Contactos de la empresa (en el formulario se editan sobre S.form.contactos)
function contactosFormHtml(){
  return S.form.contactos.map((c, i) => `<div class="contacto">
    <div class="row"><div class="fld"><label for="c_nom_${i}">Nombre</label><input id="c_nom_${i}" value="${esc(c.nombre)}" ${oi('setContacto', i, 'nombre')}></div>
      <div class="fld"><label for="c_rol_${i}">Rol</label><select id="c_rol_${i}" ${oc('setContacto', i, 'rol')}>${ROLES.map(r => `<option ${c.rol === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div></div>
    <div class="row"><div class="fld"><label for="c_tel_${i}">Teléfono / WhatsApp</label><input id="c_tel_${i}" type="tel" inputmode="tel" value="${esc(c.telefono)}" placeholder="341 555-1234" ${oi('setContacto', i, 'telefono')}></div>
      <div class="fld"><label for="c_mail_${i}">Email</label><input id="c_mail_${i}" type="email" inputmode="email" value="${esc(c.email)}" ${oi('setContacto', i, 'email')}></div></div>
    <button class="btn ghost small" style="margin-top:10px" ${on('quitarContacto', i)}>${ic('basura')}Quitar contacto</button></div>`).join('')
    || '<p class="sub" style="margin:0">Todavía no hay contactos cargados.</p>';
}
// Número para WhatsApp: agrega el 54 9 de Argentina si falta
const numeroWa = tel => { let n = String(tel || '').replace(/\D/g, '').replace(/^0/, ''); if (!n) return ''; if (!n.startsWith('54')) n = '549' + n.replace(/^(\d{2,4})15/, '$1'); return n; };
// "-32.94, -60.63" → [-32.94, -60.63] (también acepta lo que se copia de Google Maps)
function leerCoordenadas(txt){
  const m = String(txt || '').match(/(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
  if (!m) return null;
  const [lat, lng] = [m[1], m[2]].map(x => +x.replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [+lat.toFixed(6), +lng.toFixed(6)] : null;
}
function contactosHtml(lista){
  return (lista || []).filter(c => c.nombre || c.telefono || c.email).map(c => `<div class="el contacto-ver">
    <div><b>${esc(c.nombre || 'Sin nombre')}</b><div class="sub">${esc([c.rol, c.telefono, c.email].filter(Boolean).join(' · '))}</div></div>
    ${c.telefono ? `<a class="hbtn mini" href="tel:${esc(c.telefono.replace(/[^\d+]/g, ''))}" aria-label="Llamar">${ic('telefono')}</a>
      <a class="hbtn mini" href="https://wa.me/${numeroWa(c.telefono)}" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('chat')}</a>` : ''}
    ${c.email ? `<a class="hbtn mini" href="mailto:${esc(c.email)}" aria-label="Mail">${ic('mail')}</a>` : ''}</div>`).join('');
}

function chipsHtml(tipo){
  const lista = CFG.normativa[tipo], sel = S.form[tipo];
  return lista.map(x => `<button class="chip ${sel.has(x.id) ? 'on' : ''}" ${on('toggleChip', tipo, x.id)}>${sel.has(x.id) ? ic('check') : ''}${esc(x.nombre)}</button>`).join('');
}

const opcionesFrec = f => `<option value="0">Sin programar</option>${FRECUENCIAS.map(([v, t]) => `<option value="${v}" ${+f === v ? 'selected' : ''}>${t}</option>`).join('')}`;
function frecuenciaHtml(id, conNombre = false){
  const f = S.estab.programa?.[id]?.frec || 0;
  return `<label>${conNombre ? `Repetir ${esc(CFG.modulos[id].titulo.toLowerCase())}` : 'Repetir este relevamiento'}</label>
    <select ${oc('setFrec', id)}>${opcionesFrec(f)}</select>`;
}
const prioHtml = sel => Motor.PRIORIDADES.map(p => `<button class="${p} ${sel === p ? 'on' : ''}" ${on('setDesvioPrio', p)}>${p}</button>`).join('');

function novedadHtml(n, c, estado, empId){
  const est = [['revisada', 'Revisada'], ['pendiente', 'Pendiente de implementar'], ['no_aplica', 'No aplica']];
  return `<div class="card nov ${estado ? '' : 'nueva'}">
    <div class="between"><div class="sub">${fmtFecha(n.fecha)} · ${esc(n.jurisdiccion)}</div><span class="badge ${c.nivel === 'Aplica' ? 'b-bad' : 'b-mid'}">${c.nivel === 'Aplica' ? 'Aplica' : 'Posiblemente'}</span></div>
    <b>${esc([n.tipo, n.numero].filter(Boolean).join(' '))}</b><div>${esc(n.titulo)}</div>
    ${resumenNovedad(n)}
    <div class="sub" style="margin-top:4px">${esc(c.motivo)}</div>
    <div class="chips" style="margin-top:10px">${est.map(([k, t]) => `<button class="chip small ${estado === k ? 'on' : ''}" ${on('setEstadoNorma', empId, n.id, k)}>${t}</button>`).join('')}</div>
    <a class="btn sec small" style="margin-top:10px" href="${esc(n.url)}" target="_blank" rel="noopener">${ic('link')}Leer la norma</a></div>`;
}

function imagenBox(img, accion, campo = ''){
  return `${img ? `<img class="logo-prev" src="${img.data}" alt="">` : '<div class="sub">Sin imagen</div>'}
    <div class="row" style="margin-top:8px">
      <label class="btn sec small" style="flex:0 0 auto">${ic('imagen')}Elegir imagen<input type="file" accept="image/*" hidden ${oc(accion, campo)}></label>
      ${img ? `<button class="btn ghost small" style="flex:0 0 auto" ${on(accion, campo)}>Quitar</button>` : ''}
    </div>`;
}

function botonesFoto(tipo){
  return `<div class="photo-btns">
    <label class="btn">${ic('camara')}Sacar foto<input type="file" accept="image/*" capture="environment" hidden ${oc('agregarFotos', tipo)}></label>
    <label class="btn sec">${ic('imagen')}De la galería<input type="file" accept="image/*" multiple hidden ${oc('agregarFotos', tipo)}></label>
  </div>`;
}

const estadoTexto = e => !e.ev.completo ? 'Incompleto' : e.ev.conteo.NC ? Motor.cant(e.ev.conteo.NC, 'desvío', 'desvíos') : 'Conforme';
function estadoDot(e){ return `<span class="dot ${!e.ev.completo ? 'mid' : e.ev.conteo.NC ? 'bad' : 'ok'}"></span>`; }
function estadoBadge(e){
  const c = !e.ev.completo ? 'b-mid' : e.ev.conteo.NC ? 'b-bad' : 'b-ok';
  return `<span class="badge ${c}">${estadoTexto(e)}</span>`;
}
const dondeDesvio = d => d.elemento ? d.elemento.nombre + (d.elemento.sector && d.mod.tipo_elemento === 'equipo' ? ' · ' + d.elemento.sector : '') : 'General – ' + d.mod.titulo;

function atributosHtml(){
  const m = mod(), e = el(), err = c => S.marcar && c ? 'attr-err' : '';
  let html = '';
  if (m.tipo_elemento !== 'establecimiento') {
    const lbl = m.tipo_elemento === 'sector' ? m.nombre_elemento : 'Sector';
    html += `<label for="a_sector">${esc(lbl)} *</label><input id="a_sector" list="sectores" class="${err(!e.sector)}" value="${esc(e.sector)}" placeholder="${m.tipo_elemento === 'sector' ? 'Nombre del ' + esc(lbl.toLowerCase()) : 'Ej.: Depósito'}" ${oi('setSector')}>`;
  }
  for (const a of m.atributos || []) {
    const v = e.atributos[a.clave] ?? '', falta = a.obligatorio && v === '', id = 'a_' + a.clave;
    html += `<label for="${id}">${esc(a.etiqueta)}${a.obligatorio ? ' *' : ''}</label>`;
    if (a.tipo === 'opcion') html += `<div class="chips ${err(falta)}" id="${id}">${a.opciones.map(o =>
      `<button class="chip ${v === o ? 'on' : ''}" ${on('setAttr', a.clave, o, true)}>${esc(o)}</button>`).join('')}</div>`;
    else {
      const tipo = {numero: 'number', fecha: 'date', mes: 'month'}[a.tipo] || 'text';
      const extra = a.tipo === 'numero' ? 'inputmode="decimal" step="any"' : '';
      const evento = a.tipo === 'mes' || a.tipo === 'fecha' ? oc('setAttr', a.clave) : oi('setAttr', a.clave);
      const input = `<input id="${id}" type="${tipo}" ${extra} class="${err(falta)}" value="${esc(v)}" placeholder="${esc(a.ayuda || '')}" ${evento}>`;
      html += a.unidad ? `<div class="unit">${input}<span>${esc(a.unidad)}</span></div>` : input;
      if (a.ayuda && a.tipo !== 'texto') html += `<div class="hint">${esc(a.ayuda)}</div>`;
    }
  }
  return html;
}

// Checklist del elemento actual o de las verificaciones generales
function contextoChecklist(){
  if (S.view === 'generales') {
    const r = rm();
    r.generales ||= {};
    return {items: mod().items_generales, holder: r.generales, ev: Motor.evaluar(mod(), {resultados: r.generales}, mod().items_generales, S.relev.fecha_relevamiento, false)};
  }
  return {items: mod().items, holder: el().resultados, ev: Motor.evaluar(mod(), el(), mod().items, S.relev.fecha_relevamiento)};
}

function checklistHtml(){
  const {items, ev} = contextoChecklist(), m = mod();
  let n = 0;
  const itemHtml = it => {
    const r = ev.res[it.clave], st = r?.valor || '', manual = !r?.auto;
    const opt = (k, t, i) => `<button class="opt ${k} ${st === k ? 'on' : ''}" ${on('setVal', it.clave, k)}>${ic(i)}${t}</button>`;
    let extra = '';
    if (r?.auto) extra = `<div class="auto">${ic('auto')}<div>Automático: <b>${Motor.VALOR_TXT[r.valor]}</b>${r.obs ? ' · ' + esc(r.obs) : ''}</div></div>`;
    else if (st === 'NC') extra = `<textarea aria-label="Desvío" placeholder="Describí el desvío (si lo dejás vacío se usa: «${esc(it.desvio_defecto)}»)" ${oi('setObs', it.clave)}>${esc(r.obs)}</textarea>
      <div class="prio">Prioridad: ${Motor.PRIORIDADES.map(p => `<button class="${p} ${r.gravedad === p ? 'on' : ''}" ${on('setGrav', it.clave, p)}>${p}</button>`).join('')}</div>`;
    else if (it.automatico && !st) extra = '<div class="hint">Se completa solo al cargar la fecha de vencimiento.</div>';
    return `<div class="card item ${st} ${S.marcar && !st ? 'err' : ''}" id="it-${it.clave}">
      <div class="itxt"><span class="n">${++n}</span><span>${esc(it.texto)}</span></div>
      ${manual ? `<div class="opts">${opt('C', 'Cumple', 'check')}${opt('NC', 'No cumple', 'x')}${opt('NA', 'No aplica', 'minus')}</div>` : ''}${extra}</div>`;
  };
  const avisos = ev.observaciones.map(o => aviso('aviso', 'alerta', esc(o))).join('');
  if (S.view !== 'generales' && m.secciones?.length) {
    return avisos + m.secciones.map(s => {
      const its = items.filter(i => i.seccion === s.clave);
      return its.length ? `<h3>${esc(s.titulo)}</h3>${its.map(itemHtml).join('')}` : '';
    }).join('') + items.filter(i => !m.secciones.some(s => s.clave === i.seccion)).map(itemHtml).join('');
  }
  return avisos + (S.view === 'generales' ? '' : '<h3>Lista de verificación</h3>') + items.map(itemHtml).join('');
}

function fotosHtml(lista, tipo){
  return lista.length ? `<div class="photos">${lista.map((f, i) => `<div class="photo">
      <img src="${f.data}" alt="${esc(f.descripcion || 'Foto ' + (i + 1))}">
      <textarea aria-label="Descripción de la foto" placeholder="Descripción" ${oi('descFoto', tipo, i)}>${esc(f.descripcion)}</textarea>
      <button class="btn ghost small block" style="margin-top:4px" ${on('quitarFoto', tipo, i)}>Quitar</button></div>`).join('')}</div>`
    : '<div class="sub" style="margin-top:12px">Sin fotos todavía.</div>';
}

// Resultado de la emisión: cada informe con Descargar y Compartir
function resultadoInformeHtml(){
  const u = S.informes;
  if (!u || u.relId !== S.relev.id) return '';
  const fila = (k, titulo, sub) => u[k] ? `<div class="informe-fila">${ic('doc')}<div><b>${titulo}</b><div class="sub">${sub}</div></div>
    <div class="actions"><button class="btn sec small" ${on('entregarInforme', k, 'descargar')}>${ic('descarga')}Descargar</button>
    <button class="btn small" ${on('entregarInforme', k, 'compartir')}>${ic('compartir')}Compartir</button></div></div>` : '';
  return `<div class="card okcard">${aviso('okbox', 'ok', '<b>Informes generados</b>' + (S.relev.tipo === 'desvios' ? '' : '<div class="sub" style="color:inherit">Los desvíos se cargaron en el seguimiento del establecimiento.</div>'))}
    ${fila('completo', 'Informe técnico completo', 'Para el legajo técnico')}${fila('desvios', 'Informe de desvíos', 'Corto y simple, para quien tiene que hacer las correcciones')}</div>`;
}

// ===== Informe =====
const ctxMotor = () => ({modulos: CFG.modulos, plantillas: CFG.plantillas, empresa: empresaInforme()});
const calcular = () => Motor.calcular(S.relev, ctxMotor(), false);

// Relevamiento anterior del mismo establecimiento con informe emitido, para el seguimiento
async function calcularConPrevio(){
  const previos = (await getAll('relevamientos')).filter(r => r.establecimientoId === S.relev.establecimientoId && r.id !== S.relev.id && r.modulos
    && terminado(r) && r.fecha_relevamiento < S.relev.fecha_relevamiento).sort((a, b) => b.fecha_relevamiento.localeCompare(a.fecha_relevamiento));
  const M = Motor.calcular(S.relev, {...ctxMotor(), previo: previos[0] || null});
  M.rubroNombre = rubro(S.empresa.rubro)?.nombre || '';
  return M;
}

// Datos del informe corto de desvíos
function datosDesvios(M){
  const r = S.relev;
  if (r.tipo === 'desvios') return {empresa: empresaInforme(), fecha: r.fecha_relevamiento, tema: 'recorrida', origen: 'Desvíos detectados en la recorrida',
    filas: r.desvios.map(d => ({donde: d.sector, texto: d.texto, accion: d.accion || 'Corregir el desvío observado.', prioridad: d.prioridad, responsable: d.responsable, fotos: d.fotos}))};
  return {empresa: empresaInforme(), fecha: r.fecha_relevamiento, tema: M.multi ? 'general' : M.modulos[0].mod.titulo,
    origen: M.multi ? 'Relevamiento general de higiene y seguridad' : `Relevamiento de ${M.modulos[0].mod.titulo.toLowerCase()}`,
    filas: M.desvios.map(d => ({donde: dondeDesvio(d), texto: d.texto, accion: d.accion, prioridad: d.prioridad, responsable: d.responsable, fotos: d.elemento?.el.fotos || []}))};
}

async function generarInformes(conCompleto){
  const M = conCompleto ? await calcularConPrevio() : null, ctx = {plantillas: CFG.plantillas, perfil: PERFIL};
  return {relId: S.relev.id,
    completo: conCompleto ? await Informe.generar(M, ctx) : null,
    desvios: await Informe.generarDesvios(datosDesvios(M), ctx), M};
}

// Pasa los desvíos de un relevamiento (o de un informe de desvíos) a la planilla de seguimiento del establecimiento.
// Un desvío ya cargado no se duplica; los abiertos de relevamientos anteriores del mismo tema que ahora cumplen se cierran solos.
async function sincronizarSeguimiento(rel, M){
  const todos = (await getAll('seguimiento')).filter(o => o.establecimientoId === rel.establecimientoId);
  let n = Math.max(0, ...todos.map(o => o.n || 0));
  const origen = `${tituloRelev(rel)} del ${fmtFecha(rel.fecha_relevamiento)}`;
  const actuales = rel.tipo === 'desvios'
    ? rel.desvios.map(d => ({id: rel.id + '|' + d.id, sector: d.sector, texto: d.texto, accion: d.accion, prioridad: d.prioridad, responsable: d.responsable, moduloId: '', itemClave: '', elemento: ''}))
    : M.desvios.map(d => ({id: `${rel.id}|${d.elemento?.id || 'gen-' + d.mod.id}|${d.item.clave}`, sector: dondeDesvio(d), texto: d.texto, accion: d.accion,
        prioridad: d.prioridad, responsable: d.responsable, moduloId: d.mod.id, itemClave: d.item.clave, elemento: d.elemento ? d.elemento.nombre + '|' + d.elemento.sector : 'general'}));
  for (const a of actuales) {
    const prev = todos.find(o => o.id === a.id);
    await put('seguimiento', prev ? {...prev, ...a, estado: prev.estado} : {...a, n: ++n, establecimientoId: rel.establecimientoId, relId: rel.id,
      fecha: rel.fecha_relevamiento, estado: 'Abierto', origen});
  }
  for (const o of todos.filter(o => o.relId === rel.id && o.estado === 'Abierto' && !actuales.some(a => a.id === o.id))) await del('seguimiento', o.id);
  if (rel.tipo !== 'desvios') for (const o of todos) {
    if (o.estado !== 'Abierto' || o.relId === rel.id || !o.moduloId || o.fecha > rel.fecha_relevamiento || !rel.modulos.some(m => m.modulo_id === o.moduloId)) continue;
    if (actuales.some(a => a.moduloId === o.moduloId && a.itemClave === o.itemClave && a.elemento === o.elemento)) continue;
    await put('seguimiento', {...o, estado: 'Cerrado', fechaCierre: rel.fecha_relevamiento, cierre: `Verificado en ${origen.toLowerCase()}`});
  }
}

// Valida el elemento actual; resuelve true si se puede seguir
async function validarElemento(){
  const {ev} = contextoChecklist();
  if (!ev.completo) {
    S.marcar = true;
    $('#atributos').innerHTML = atributosHtml();
    $('#checklist').innerHTML = checklistHtml();
    (document.querySelector('.attr-err') || document.querySelector('.item.err'))?.scrollIntoView({behavior: 'smooth', block: 'center'});
    const faltan = [...ev.faltanAtributos, ...ev.faltan.map(k => mod().items.find(i => i.clave === k).texto)];
    await avisar(`Faltan completar ${faltan.length} dato(s) en ${nombreEl()}:\n• ${faltan.slice(0, 6).join('\n• ')}${faltan.length > 6 ? '\n…' : ''}`);
    return false;
  }
  const sinFoto = mod().items.filter(it => it.foto_obligatoria_si_nc && ev.res[it.clave]?.valor === 'NC');
  if (sinFoto.length && !el().fotos.length)
    return confirmar(`"${sinFoto[0].texto}" no cumple y conviene registrarlo con una foto.`, 'Seguir sin foto', 'Sacar foto');
  return true;
}

const nuevoElemento = sector => ({id: uid(), sector: sector || '', atributos: {}, resultados: {}, fotos: []});
function agregarElemento(mi, sector){
  S.mi = mi;
  rm().elementos.push(nuevoElemento(sector));
  S.ei = rm().elementos.length - 1;
  saveRelev();
  go('elemento');
}
function setModo(general){
  S.general = general;
  S.sel = new Set();
}
// Carga empresa y establecimiento de un relevamiento (para abrirlo desde el inicio)
async function prepararRelev(id){
  S.relev = await getOne('relevamientos', id);
  S.estab = await getOne('establecimientos', S.relev.establecimientoId);
  S.empresa = await getOne('empresas', S.estab.empresaId);
}
async function guardarProgramaTema(id, cambios){
  S.estab.programa ||= {};
  S.estab.programa[id] = {...(S.estab.programa[id] || {}), ...cambios};
  await put('establecimientos', S.estab);
}
async function marcarLeidas(){
  if (S.view !== 'normativa' || !CFG.novedades) return;
  CFG.novedades.normas.forEach(n => NORMAS.leidas[n.id] = true);
  await put('config', NORMAS);
}

// ---- Planillas Excel ----
function excelSeguimiento(obs){
  const e = S.empresa, s = S.estab, T = CFG.plantillas.seguimiento;
  const enc = ['N°', 'Tipo / Sector', 'Observaciones', 'Acción correctiva', 'Fecha', 'Estado', 'Prior.', 'Fecha de cierre'];
  const texto = v => [{v, s: 'texto'}], titulo = v => [{v, s: 'subtitulo'}];
  const filas = [
    [{v: 'SEGUIMIENTO DE LAS OBSERVACIONES', s: 'titulo'}],
    [{v: 'Empresa:', s: 'etiqueta'}, e.razonSocial, '', '', {v: 'Fecha:', s: 'etiqueta'}, fmtFecha(hoy())],
    [{v: 'Ubicación:', s: 'etiqueta'}, [s.nombre, s.domicilio].filter(Boolean).join(' – ')],
    [{v: 'Localidad:', s: 'etiqueta'}, s.localidad || ''],
    [],
    titulo('1- OBJETIVO'), {celdas: texto(T.objetivo), alto: 30},
    titulo('2- ALCANCE'), {celdas: texto(T.alcance.replace('{razon_social}', e.razonSocial).replace('{domicilio}', s.domicilio || s.nombre).replace('{localidad}', s.localidad || '—')), alto: 30},
    titulo('3- MARCO LEGAL'), ...T.marco_legal.map(m => texto('• ' + m)),
    titulo('4- DESARROLLO'), texto(T.desarrollo),
    [],
    titulo('OBSERVACIONES:'),
    enc.map(v => ({v, s: 'enc'})),
    ...obs.map(o => ({alto: Math.max(30, Math.ceil(Math.max(o.texto.length, (o.accion || '').length) / 55) * 14), celdas: [
      {v: o.n, s: 'centro'}, {v: o.sector, s: 'celda'}, {v: o.texto, s: 'celda'}, {v: o.accion || '', s: 'celda'}, {v: fmtFecha(o.fecha), s: 'centro'},
      {v: o.estado, s: o.estado === 'Cerrado' ? 'ok' : 'mal'}, {v: o.prioridad, s: {ALTA: 'mal', MEDIA: 'medio', BAJA: 'ok'}[o.prioridad]}, {v: fmtFecha(o.fechaCierre || ''), s: 'centro'}]}))
  ];
  const combinar = ['A1:H1', 'B2:D2', 'B3:H3', 'B4:H4', 'A7:H7', 'A9:H9'];
  filas.forEach((f, i) => { if (i >= 9 && Array.isArray(f) && f.length === 1 && f[0]?.s === 'texto') combinar.push(`A${i + 1}:H${i + 1}`); });
  return Planilla.generar([{nombre: 'Seguimiento', filas, anchos: [6, 26, 48, 40, 11, 10, 8, 13], combinar}]);
}
function excelPanel(prog){
  const Y = S.anio, prg = prog.filter(p => p.frec);
  const filas = [
    [{v: `PROGRAMACIÓN DE RELEVAMIENTOS ${Y}`, s: 'titulo'}],
    [{v: 'Empresa:', s: 'etiqueta'}, S.empresa.razonSocial],
    [{v: 'Establecimiento:', s: 'etiqueta'}, [S.estab.nombre, S.estab.domicilio, S.estab.localidad].filter(Boolean).join(' – ')],
    [{v: 'Emitido:', s: 'etiqueta'}, fmtFecha(hoy())],
    [],
    ['Tema', 'Responsable', 'Frecuencia', ...MESES, 'Último', 'Próximo', 'Estado'].map(v => ({v, s: 'enc'})),
    ...prg.map(p => [{v: p.mod.titulo, s: 'celda'}, {v: p.responsable, s: 'centro'}, {v: nombreFrec(p.frec), s: 'centro'},
      ...mesesDelAnio(p, Y).map(c => ({v: {h: '✓', v: '!'}[c] || '', s: {h: 'ok', v: 'mal', p: 'gris'}[c] || 'centro'})),
      {v: fmtFecha(p.ultimo), s: 'centro'}, {v: fmtFecha(p.proximo), s: 'centro'}, {v: ESTADO_PROG[p.estado][0], s: {vencido: 'mal', porvencer: 'medio', aldia: 'ok'}[p.estado] || 'centro'}]),
    [],
    ['Referencias:', '✓ = realizado', 'gris = programado', '! = vencido sin realizar']
  ];
  return Planilla.generar([{nombre: `Programación ${Y}`, filas, anchos: [30, 14, 13, ...Array(12).fill(5.5), 11, 11, 12], combinar: ['A1:R1', 'B2:R2', 'B3:R3'], fijarFila: 6}]);
}
const limpiarNombre = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
const entregar = (modo, nombre, blob) => modo === 'compartir' ? compartirArchivo(nombre, blob) : guardarArchivo(nombre, blob);

// ===== Acciones (llamadas por el despachador con el elemento tocado primero) =====
const A = {
  dlgResp: (t, i) => dlgResolver?.(i),
  go: (t, v) => go(v),
  atras(){
    if (S.view === 'empresaForm') return go(S.editando ? 'empresa' : raiz());
    if (S.view === 'estabForm') return go(S.editando ? 'estab' : 'empresa');
    if (volverA && ['relev', 'desvios', 'panel', 'normasEmp'].includes(S.view)) { const v = volverA; volverA = null; return go(v); }
    const p = PREV[S.view];
    go((typeof p === 'function' ? p() : p) || raiz());
  },

  setInfTab(t, k){ S.infTab = k; render(); },
  nuevoRelevInicio(){ S.filtroEst = ''; go('elegirEstab'); },
  async filtrarEstab(t){ S.filtroEst = t.value; $('#listaEstab').innerHTML = listaEstabHtml(await datosInicio()); },
  async relevarEstab(t, id){
    S.estab = await getOne('establecimientos', id); S.empresa = await getOne('empresas', S.estab.empresaId);
    S.visitaId = null; setModo(false); S.verOtros = false;
    go('categorias');
  },
  setDvFiltro(t, k){ S.dvFiltro = k; render(); },
  // Pestañas de abajo
  tab(t, k){ S.tab = k; volverA = null; S.visitaId = null; go(raiz()); },
  irA(t, id){ document.getElementById(id)?.scrollIntoView({behavior: 'smooth'}); },
  async filtrar(t){ S.filtro = t.value; $('#listaEmp').innerHTML = listaEmpresasHtml(await datosInicio()); },
  async abrirPanel(t, estabId){
    S.estab = await getOne('establecimientos', estabId);
    S.empresa = await getOne('empresas', S.estab.empresaId);
    volverA = 'empresas'; S.anio = new Date().getFullYear();
    go('panel');
  },

  // Empresas
  async elegirEmpresa(t, id){ S.empresa = await getOne('empresas', id); volverA = null; go('empresa'); },
  nuevaEmpresa(){ S.editando = false; S.logoTmp = null; S.form = {riesgos: new Set(), programas: new Set(), contactos: []}; go('empresaForm'); },
  editarEmpresa(){
    S.editando = true; S.logoTmp = S.empresa.logo || null;
    S.form = {riesgos: new Set(S.empresa.riesgos || []), programas: new Set(S.empresa.programas || []), contactos: (S.empresa.contactos || []).map(c => ({...c}))};
    go('empresaForm');
  },
  agregarContacto(){
    S.form.contactos.push({nombre: '', rol: 'Encargado', telefono: '', email: ''});
    $('#contactos').innerHTML = contactosFormHtml();
    $(`#c_nom_${S.form.contactos.length - 1}`).focus();
  },
  setContacto(t, i, campo){ S.form.contactos[i][campo] = t.value.trim(); },
  quitarContacto(t, i){ S.form.contactos.splice(i, 1); $('#contactos').innerHTML = contactosFormHtml(); },
  toggleChip(t, tipo, id){
    S.form[tipo].has(id) ? S.form[tipo].delete(id) : S.form[tipo].add(id);
    $(tipo === 'riesgos' ? '#chipsRiesgos' : '#chipsProgramas').innerHTML = chipsHtml(tipo);
  },
  async logoEmpresa(t){
    try { S.logoTmp = t.files?.[0] ? await resizeImg(t.files[0], 600, 'png') : null; }
    catch (e) { return avisar(e.message); }
    $('#logoBox').innerHTML = imagenBox(S.logoTmp, 'logoEmpresa');
  },
  async guardarEmpresa(){
    const v = id => $('#' + id).value.trim();
    if (!v('e_rs') || !v('e_rubro')) return avisar('La razón social y el rubro son obligatorios.');
    const nueva = !S.editando;
    S.empresa = {...(S.editando ? S.empresa : {id: uid(), creado: Date.now()}), razonSocial: v('e_rs'), cuit: v('e_cuit'), rubro: v('e_rubro'), actividad: v('e_act'),
      ciiu: v('e_ciiu'), trabajadores: v('e_trab'), art: v('e_art'), responsable: v('e_resp'), notas: v('e_notas'),
      riesgos: [...S.form.riesgos], programas: [...S.form.programas], logo: S.logoTmp,
      contactos: S.form.contactos.filter(c => c.nombre || c.telefono || c.email)};
    await put('empresas', S.empresa);
    if (nueva) { S.editando = false; toast('Empresa guardada. Ahora cargá su establecimiento.'); return go('estabForm'); }
    go('empresa');
  },
  async eliminarEmpresa(){
    const estabs = (await getAll('establecimientos')).filter(s => s.empresaId === S.empresa.id);
    const rels = (await getAll('relevamientos')).filter(r => estabs.some(s => s.id === r.establecimientoId));
    if (!(await confirmar(`¿Eliminar ${S.empresa.razonSocial}? Se borran también ${plural(estabs.length, 'establecimiento', 'establecimientos')} y ${plural(rels.length, 'relevamiento', 'relevamientos')}, con sus fotos. No se puede deshacer.`, 'Eliminar todo'))) return;
    const seg = (await getAll('seguimiento')).filter(o => estabs.some(s => s.id === o.establecimientoId));
    for (const r of rels) await del('relevamientos', r.id);
    for (const o of seg) await del('seguimiento', o.id);
    for (const s of estabs) { await AG.borrarDeEstab(s.id); await del('establecimientos', s.id); }
    await del('empresas', S.empresa.id);
    toast('Empresa eliminada');
    go(raiz());
  },

  // Establecimientos
  async elegirEstab(t, id){ S.estab = await getOne('establecimientos', id); S.visitaId = null; setModo(false); S.verOtros = false; go('estab'); },
  nuevoEstab(){ S.editando = false; go('estabForm'); },
  editarEstab(){ S.editando = true; go('estabForm'); },
  async guardarEstab(){
    const v = id => $('#' + id).value.trim();
    if (!v('s_nom')) return avisar('Poné un nombre al establecimiento (por ejemplo, la planta o la dirección).');
    const coord = leerCoordenadas(v('s_coord'));
    if (v('s_coord') && !coord) return avisar('Las coordenadas no se entienden. Tienen que ser dos números separados por coma, por ejemplo: -32.9468, -60.6393');
    S.estab = {...(S.editando ? S.estab : {id: uid(), empresaId: S.empresa.id, programa: {}, creado: Date.now()}), nombre: v('s_nom'), domicilio: v('s_dom'),
      localidad: v('s_loc'), provincia: v('s_prov'), responsable: v('s_resp'), trabajadores: v('s_trab'), superficie: v('s_sup'), horario: v('s_horario'), notas: v('s_notas'),
      lat: coord?.[0] ?? null, lng: coord?.[1] ?? null, frecVisita: v('s_frecv'), horasMes: v('s_horas'), fotoObligatoria: v('s_fotoobl'),
      legajo: {...Object.fromEntries(['quimicos', 'residuos', 'ruido', 'comedor', 'cancerigenos', 'obra'].map(k => [k, v('lg_' + k) === '' ? null : v('lg_' + k) === 'si'])),
        agua: v('lg_agua'), puntosAgua: v('lg_puntos') ? Math.max(1, +v('lg_puntos')) : null}};
    await put('establecimientos', S.estab);
    setModo(false);
    go('estab');
  },
  async eliminarEstab(){
    const rels = (await getAll('relevamientos')).filter(r => r.establecimientoId === S.estab.id);
    if (!(await confirmar(`¿Eliminar ${S.estab.nombre}${rels.length ? ` y sus ${plural(rels.length, 'relevamiento', 'relevamientos')}` : ''}? No se puede deshacer.`, 'Eliminar'))) return;
    for (const r of rels) await del('relevamientos', r.id);
    for (const o of (await getAll('seguimiento')).filter(o => o.establecimientoId === S.estab.id)) await del('seguimiento', o.id);
    await AG.borrarDeEstab(S.estab.id);
    await del('establecimientos', S.estab.id);
    go('empresa');
  },

  async ubicarDireccion(){
    const q = [$('#s_dom').value, $('#s_loc').value, $('#s_prov').value].map(x => x.trim()).filter(Boolean).join(', ');
    if (!$('#s_dom').value.trim()) return avisar('Primero cargá la dirección y la localidad.');
    toast('Buscando la dirección…');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`).then(r => r.json());
      if (!r.length) return avisar('No encontré esa dirección. Probá escribirla distinto o pegá las coordenadas desde Google Maps.');
      $('#s_coord').value = `${(+r[0].lat).toFixed(6)}, ${(+r[0].lon).toFixed(6)}`;
      toast('Ubicación encontrada: revisala en el mapa al guardar');
    } catch { avisar('No se pudo buscar la dirección (¿hay señal?). Podés pegar las coordenadas desde Google Maps.'); }
  },
  ubicarAca(){
    if (!navigator.geolocation) return avisar('Este navegador no permite usar la ubicación.');
    toast('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      p => { $('#s_coord').value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`; toast('Ubicación cargada'); },
      () => avisar('No se pudo obtener la ubicación. Revisá que el permiso de ubicación esté activado para esta app.'),
      {enableHighAccuracy: true, timeout: 15000});
  },

  // Actividades
  async setActividad(t, i){
    if (!t.value.trim()) { t.value = ACTIVIDADES.lista[i].nombre; return avisar('La actividad necesita un nombre. Si no la usás, desactivala.'); }
    ACTIVIDADES.lista[i].nombre = t.value.trim();
    await put('config', ACTIVIDADES);
  },
  async toggleActividad(t, i, campo){
    ACTIVIDADES.lista[i][campo] = !ACTIVIDADES.lista[i][campo];
    await put('config', ACTIVIDADES);
    $('#listaAct').innerHTML = actividadesHtml();
  },
  async setActividadMeses(t, i){ ACTIVIDADES.lista[i].meses = +t.value; await put('config', ACTIVIDADES); },
  async nuevaActividad(){
    ACTIVIDADES.lista.push({id: uid(), nombre: 'Nueva actividad', clima: false, activa: true, meses: 0});
    await put('config', ACTIVIDADES);
    $('#listaAct').innerHTML = actividadesHtml();
    const inp = $(`#act_${ACTIVIDADES.lista.length - 1}`);
    inp.focus(); inp.select();
  },

  // Perfil y copia de seguridad
  async imagenPerfil(t, campo){
    try { PERFIL[campo] = t.files?.[0] ? await resizeImg(t.files[0], 600, 'png') : null; }
    catch (e) { return avisar(e.message); }
    $('#box_' + campo).innerHTML = imagenBox(PERFIL[campo], 'imagenPerfil', campo);
  },
  async guardarPerfil(){
    const v = id => $('#' + id).value.trim();
    Object.assign(PERFIL, {nombre: v('p_nom'), titulo: v('p_tit'), matricula: v('p_mat'), telefono: v('p_tel'), email: v('p_mail'),
      directorNombre: v('p_dir'), directorEmail: v('p_dirmail'), fotoObligatoria: $('#p_fotoobl').checked,
      clima: {prob: +v('p_cprob') || 60, mm: +v('p_cmm') || 2, viento: +v('p_cvie') || 40, pat: +v('p_cpat') || 10}});
    await put('config', PERFIL);
    toast('Datos guardados');
    go('mas');
  },
  async exportar(){
    const copia = {app: 'relevamientos-hys', version: 2, fecha: hoy(), empresas: await getAll('empresas'), establecimientos: await getAll('establecimientos'),
      relevamientos: await getAll('relevamientos'), seguimiento: await getAll('seguimiento'), perfil: PERFIL, normas: NORMAS, actividades: ACTIVIDADES,
      visitas: await getAll('visitas'), pendientes: await getAll('pendientes'), semanas: await getAll('semanas'), legajo: await getAll('legajo'), legajoCatalogo: AG.legajoCatalogo()};
    const blob = new Blob([JSON.stringify(copia)], {type: 'application/json'});
    if (await guardarArchivo(`Copia_relevamientos_HyS_${hoy()}.json`, blob)) {
      pref.set('ultimaCopia', hoy());
      toast('Copia descargada');
      render();
    }
  },
  async importar(t){
    const f = t.files?.[0];
    t.value = '';
    if (!f) return;
    let copia;
    try { copia = JSON.parse(await f.text()); } catch { return avisar('El archivo no es una copia de seguridad válida.'); }
    if (copia?.app !== 'relevamientos-hys' || !Array.isArray(copia.empresas) || !Array.isArray(copia.relevamientos))
      return avisar('El archivo no es una copia de seguridad de esta app.');
    const ok = await confirmar(`Copia del ${fmtFecha(copia.fecha)}: ${copia.empresas.length} empresas y ${copia.relevamientos.length} relevamientos.\n\nSe agregan a lo que ya tenés; si un registro ya existe, se reemplaza por el de la copia.`, 'Restaurar');
    if (!ok) return;
    for (const e of copia.empresas) await put('empresas', e);
    for (const s of copia.establecimientos || []) await put('establecimientos', s);
    for (const r of copia.relevamientos) await put('relevamientos', r);
    for (const o of copia.seguimiento || []) await put('seguimiento', o);
    if (copia.perfil?.nombre) { PERFIL = {...copia.perfil, id: 'perfil'}; await put('config', PERFIL); }
    if (copia.normas) { NORMAS = {...NORMAS, ...copia.normas, id: 'normas'}; await put('config', NORMAS); }
    if (copia.actividades?.lista) { ACTIVIDADES = {...copia.actividades, id: 'actividades'}; await put('config', ACTIVIDADES); }
    for (const s of ['visitas', 'pendientes', 'semanas', 'legajo']) for (const x of copia[s] || []) await put(s, x);
    if (copia.legajoCatalogo?.requisitos) await put('config', {...copia.legajoCatalogo, id: 'legajoCatalogo'});
    await AG.init();
    await AG.legajoInit();
    await migrar();
    toast('Copia restaurada');
    S.tab = 'inicio';
    go('empresas');
  },

  // Temas y relevamientos
  setModo(t, general){ setModo(general); render(); },
  toggleSel(t, id){ S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); render(); },
  toggleOtros(){ S.verOtros = !S.verOtros; render(); },
  abrirCarpeta(t, k){ S.carpeta = k; go('carpeta'); },
  async nuevoRelev(t, ids){
    if (!ids.length) return;
    const orden = [...ids].sort((a, b) => CFG.orden.indexOf(a) - CFG.orden.indexOf(b));
    S.relev = {id: uid(), empresaId: S.empresa.id, establecimientoId: S.estab.id, creado: Date.now(), fecha_relevamiento: hoy(), fecha_emision: '',
      acompanante: S.estab.responsable || S.empresa.responsable || '',
      // Los temas que se evalúan una sola vez por establecimiento arrancan con su único elemento
      modulos: orden.map(id => ({modulo_id: id, elementos: CFG.modulos[id].tipo_elemento === 'establecimiento' ? [nuevoElemento()] : [], generales: {}, observaciones: ''})),
      fotos_generales: [], textos_editados: {}, estado: 'borrador', visitaId: S.visitaId || null};
    await put('relevamientos', S.relev);
    await AG.vincularRelev(S.relev);
    if (orden.length > 1) return go('relev');
    if (CFG.modulos[orden[0]].tipo_elemento === 'establecimiento') { S.mi = 0; S.ei = 0; return go('elemento'); }
    agregarElemento(0);   // por tema: arranca directo en el primer elemento
  },
  async abrirRelev(t, id){
    const desde = esRaiz(S.view) ? S.view : null;
    await prepararRelev(id);
    volverA = desde;
    go(S.relev.tipo === 'desvios' ? 'desvios' : 'relev');
  },
  // Mantener apretado (o ⋮) un relevamiento: descargar, compartir o eliminar
  async menuRelev(t, id){
    const r = await getOne('relevamientos', id), fin = terminado(r), desv = r.tipo === 'desvios';
    const op = [
      ...(fin && !desv ? [{txt: 'Descargar informe completo', icono: 'descarga', valor: 'completo|descargar'}, {txt: 'Compartir informe completo', icono: 'compartir', valor: 'completo|compartir'}] : []),
      ...(fin ? [{txt: 'Descargar informe de desvíos', icono: 'descarga', valor: 'desvios|descargar'}, {txt: 'Compartir informe de desvíos', icono: 'compartir', valor: 'desvios|compartir'}] : []),
      ...(!fin ? [{txt: 'Abrir y continuar', icono: 'chev', valor: 'abrir'}] : []),
      {txt: 'Eliminar', icono: 'basura', clase: 'danger', valor: 'eliminar'}
    ];
    const elegido = await menu(`${tituloRelev(r)} · ${fmtFecha(r.fecha_relevamiento)}`, op);
    if (!elegido) return;
    if (elegido === 'abrir') return A.abrirRelev(t, id);
    if (elegido === 'eliminar') {
      if (!(await confirmar(`¿Eliminar ${tituloRelev(r).toLowerCase()} del ${fmtFecha(r.fecha_relevamiento)}, con sus fotos? Los desvíos abiertos que generó también se quitan del seguimiento. No se puede deshacer.`, 'Eliminar'))) return;
      await del('relevamientos', id);
      for (const o of (await getAll('seguimiento')).filter(o => o.relId === id && o.estado === 'Abierto')) await del('seguimiento', o.id);
      toast('Eliminado');
      return render();
    }
    const [doc, modo] = elegido.split('|'), vista = S.view, prev = {empresa: S.empresa, estab: S.estab, relev: S.relev};
    await prepararRelev(id);
    try {
      toast('Preparando el informe…');
      const inf = await generarInformes(doc === 'completo');
      await entregar(modo, inf[doc].nombre, inf[doc].blob);
    } catch (err) { console.error(err); await avisar('No se pudo generar el informe: ' + err.message); }
    if (esRaiz(vista)) Object.assign(S, prev);
  },
  setRelev(t, campo, redibujar){ S.relev[campo] = t.value; saveRelev(); if (redibujar) render(); },
  setObsModulo(t, mi){ S.relev.modulos[mi].observaciones = t.value; saveRelev(); },
  abrirElemento(t, mi, ei){ S.mi = mi; S.ei = ei; go('elemento'); },
  agregarElemento: (t, mi) => agregarElemento(mi),
  abrirGenerales(t, mi){ S.mi = mi; go('generales'); },
  async setFrec(t, id){ await guardarProgramaTema(id, {frec: +t.value, desde: S.estab.programa?.[id]?.desde || hoy()}); toast(+t.value ? `Programado: ${nombreFrec(t.value).toLowerCase()}` : 'Quitado del panel de control'); if (S.view === 'panel') render(); },
  async setRespProg(t, id){ await guardarProgramaTema(id, {responsable: t.value.trim()}); },

  // Carga del elemento
  setSector(t){ el().sector = t.value; saveRelev(); if (mod().tipo_elemento === 'sector') $('#title').textContent = nombreEl(); },
  setAttr(t, k, valor, redibujar){
    el().atributos[k] = valor ?? t.value;
    saveRelev();
    if (redibujar) $('#atributos').innerHTML = atributosHtml();
    $('#checklist').innerHTML = checklistHtml();
    progreso();
  },
  setVal(t, k, v){
    const {holder} = contextoChecklist(), prev = holder[k] || {};
    holder[k] = prev.valor === v ? prev : {valor: v, obs: ''};
    saveRelev();
    $('#checklist').innerHTML = checklistHtml();
    progreso();
    if (v === 'NC') $(`#it-${k} textarea`)?.focus();
  },
  setObs(t, k){ contextoChecklist().holder[k].obs = t.value; saveRelev(); },
  setGrav(t, k, p){ contextoChecklist().holder[k].gravedad = p; saveRelev(); $('#checklist').innerHTML = checklistHtml(); },
  async siguienteElemento(){
    if (!(await validarElemento())) return;
    agregarElemento(S.mi, el().sector);
  },
  async terminarElemento(){
    const {ev} = contextoChecklist();
    if (!ev.completo) {
      if (!(await confirmar(`${nombreEl()} está incompleto. Podés completarlo después desde el resumen.`, 'Salir igual', 'Seguir cargando'))) return;
    } else if (!(await validarElemento())) return;
    go('relev');
  },
  async terminarGenerales(){
    const {ev} = contextoChecklist();
    if (ev.faltan.length && !(await confirmar(`Faltan ${ev.faltan.length} ítem(s) por responder.`, 'Salir igual', 'Seguir'))) return;
    go('relev');
  },
  async eliminarElemento(){
    if (!(await confirmar(`¿Eliminar ${nombreEl()} y sus fotos?`, 'Eliminar'))) return;
    rm().elementos.splice(S.ei, 1);
    saveRelev();
    go('relev');
  },

  // Fotos
  async agregarFotos(t, tipo){
    const lista = listaFotos(tipo);
    try { for (const f of t.files) lista.push({...(await resizeImg(f)), descripcion: ''}); }
    catch (e) { await avisar(e.message); }
    await put('relevamientos', S.relev);
    render();
  },
  descFoto(t, tipo, i){ listaFotos(tipo)[i].descripcion = t.value; saveRelev(); },
  async quitarFoto(t, tipo, i){
    if (!(await confirmar('¿Quitar esta foto?', 'Quitar'))) return;
    listaFotos(tipo).splice(i, 1);
    await put('relevamientos', S.relev);
    render();
  },

  // Informes
  editarTexto(t, k){ S.relev.textos_editados ||= {}; S.relev.textos_editados[k] = t.value; saveRelev(); },
  restaurarTexto(t, k){ delete S.relev.textos_editados[k]; saveRelev(); render(); },
  async generarInforme(t){
    S.relev.fecha_emision ||= hoy();
    const M = await calcularConPrevio();
    if (M.incompletos.length) return avisar('Completá los datos faltantes antes de emitir el informe.');
    t.disabled = true;
    try {
      S.informes = await generarInformes(true);
      S.relev.estado = 'finalizado';
      await put('relevamientos', S.relev);
      await sincronizarSeguimiento(S.relev, S.informes.M);
      $('#resultadoInforme').innerHTML = resultadoInformeHtml();
      $('#resultadoInforme').scrollIntoView({behavior: 'smooth', block: 'center'});
    } catch (err) {
      console.error(err);
      await avisar('No se pudo generar el informe: ' + err.message);
    } finally { t.disabled = false; }
  },
  entregarInforme(t, k, modo){ const u = S.informes?.[k]; if (u) entregar(modo, u.nombre, u.blob); },

  // Informe de desvíos fuera de un relevamiento
  async nuevoInformeDesvios(){
    S.relev = {id: uid(), tipo: 'desvios', empresaId: S.empresa.id, establecimientoId: S.estab.id, creado: Date.now(), fecha_relevamiento: hoy(),
      acompanante: S.estab.responsable || '', desvios: [], estado: 'borrador'};
    await put('relevamientos', S.relev);
    A.agregarDesvio();
  },
  agregarDesvio(){
    S.relev.desvios.push({id: uid(), sector: '', texto: '', accion: '', responsable: S.estab.responsable || '', prioridad: 'MEDIA', fotos: []});
    S.di = S.relev.desvios.length - 1;
    saveRelev();
    go('desvioEl');
  },
  abrirDesvio(t, i){ S.di = i; go('desvioEl'); },
  setDesvio(t, campo){ S.relev.desvios[S.di][campo] = t.value; saveRelev(); },
  setDesvioPrio(t, p){ S.relev.desvios[S.di].prioridad = p; saveRelev(); $('#dv_prio').innerHTML = prioHtml(p); },
  async eliminarDesvio(){
    if (!(await confirmar('¿Eliminar este desvío y sus fotos?', 'Eliminar'))) return;
    S.relev.desvios.splice(S.di, 1);
    await put('relevamientos', S.relev);
    go('desvios');
  },
  async generarInformeDesvios(t){
    const r = S.relev, mal = r.desvios.findIndex(d => !d.sector.trim() || !d.texto.trim());
    if (mal >= 0) { S.di = mal; await avisar(`Al desvío ${mal + 1} le falta el lugar o la descripción.`); return go('desvioEl'); }
    t.disabled = true;
    try {
      S.informes = await generarInformes(false);
      r.estado = 'finalizado'; r.fecha_emision = hoy();
      await put('relevamientos', r);
      await sincronizarSeguimiento(r);
      $('#resultadoInforme').innerHTML = resultadoInformeHtml();
      $('#resultadoInforme').scrollIntoView({behavior: 'smooth', block: 'center'});
    } catch (err) { console.error(err); await avisar('No se pudo generar el informe: ' + err.message); }
    finally { t.disabled = false; }
  },

  // Panel de control
  setAnio(t, y){ S.anio = y; render(); },
  async agregarAlPrograma(){
    const prog = programacion(S.estab, await getAll('relevamientos')).map(p => p.id);
    const libres = CFG.orden.filter(id => CFG.modulos[id] && !prog.includes(id));
    const id = await menu('¿Qué tema querés programar?', libres.map(id => ({txt: CFG.modulos[id].titulo, valor: id})));
    if (!id) return;
    await guardarProgramaTema(id, {frec: 12, desde: hoy()});
    toast('Agregado como anual: cambiá la frecuencia si hace falta');
    render();
  },
  async excelPanel(t, modo){
    const prog = programacion(S.estab, (await getAll('relevamientos')).filter(esRelev));
    if (!prog.some(p => p.frec)) return avisar('Todavía no hay temas programados.');
    entregar(modo, `Programacion_${S.anio}_${limpiarNombre(S.empresa.razonSocial)}_${limpiarNombre(S.estab.nombre)}.xlsx`, excelPanel(prog));
  },

  // Seguimiento de desvíos
  setSegFiltro(t, k){ S.segFiltro = k; render(); },
  async abrirObs(t, id){ S.obs = {...(await getOne('seguimiento', id))}; go('obsForm'); },
  nuevaObs(){ S.obs = {id: uid(), establecimientoId: S.estab.id, sector: '', texto: '', accion: '', responsable: '', fecha: hoy(), prioridad: 'MEDIA', estado: 'Abierto', origen: 'Cargado a mano'}; go('obsForm'); },
  setObsCampo(t, campo, v){
    S.obs[campo] = v;
    if (campo === 'prioridad') $('#o_prio').innerHTML = Motor.PRIORIDADES.map(p => `<button class="${p} ${v === p ? 'on' : ''}" ${on('setObsCampo', 'prioridad', p)}>${p}</button>`).join('');
    else { $('#o_estado').innerHTML = ['Abierto', 'Cerrado'].map(k => `<button class="chip ${v === k ? 'on' : ''}" ${on('setObsCampo', 'estado', k)}>${k}</button>`).join(''); $('#o_cierre').hidden = v !== 'Cerrado'; }
  },
  async guardarObs(){
    const v = id => $('#' + id).value.trim(), o = S.obs;
    if (!v('o_sector') || !v('o_texto')) return avisar('Completá el tipo / sector y la observación.');
    Object.assign(o, {sector: v('o_sector'), texto: v('o_texto'), accion: v('o_accion'), fecha: v('o_fecha') || hoy(), responsable: v('o_resp')});
    if (o.estado === 'Cerrado') Object.assign(o, {fechaCierre: v('o_fcierre') || hoy(), cierre: v('o_ccierre')}); else { delete o.fechaCierre; delete o.cierre; }
    if (!o.n) o.n = Math.max(0, ...(await getAll('seguimiento')).filter(x => x.establecimientoId === S.estab.id).map(x => x.n || 0)) + 1;
    await put('seguimiento', o);
    toast('Guardado');
    go('seguimiento');
  },
  async eliminarObs(){
    if (!(await confirmar(`¿Quitar el desvío N° ${S.obs.n} del seguimiento?`, 'Quitar'))) return;
    await del('seguimiento', S.obs.id);
    go('seguimiento');
  },
  async excelSeguimiento(t, modo){
    const obs = (await getAll('seguimiento')).filter(o => o.establecimientoId === S.estab.id).sort((a, b) => a.n - b.n);
    if (!obs.length) return avisar('Todavía no hay desvíos en el seguimiento.');
    entregar(modo, `Seguimiento_observaciones_${limpiarNombre(S.empresa.razonSocial)}_${limpiarNombre(S.estab.nombre)}.xlsx`, excelSeguimiento(obs));
  },

  // Normativa
  async setEstadoNorma(t, empId, nId, k){
    const clave = empId + '|' + nId;
    NORMAS.estados[clave] === k ? delete NORMAS.estados[clave] : NORMAS.estados[clave] = k;
    await put('config', NORMAS);
    render();
  },
  setNormJur(t, j){ S.normJur = j; render(); },
  buscarNorma(t){ S.normBuscar = t.value; render(); },
  async abrirEmpresaNormas(t, id){ S.empresa = await getOne('empresas', id); volverA = 'normativa'; go('normasEmp'); }
};

// Agenda de visitas (app/agenda.js y app/agenda-informes.js): suma sus pantallas, acciones y "atrás"
Object.assign(VIEWS, AG.views, Sync.views);
Object.assign(A, AG.acciones, Sync.acciones);
Object.assign(PREV, AG.prev, Sync.prev, {categorias: () => S.visitaId ? 'visita' : 'estab'});

// Vuelve a leer lo que la app tiene en memoria (al restaurar una copia o al llegar datos de otro dispositivo)
async function recargarDatos(){
  PERFIL = (await getOne('config', 'perfil')) || {id: 'perfil'};
  NORMAS = {id: 'normas', estados: {}, leidas: {}, ...(await getOne('config', 'normas'))};
  ACTIVIDADES = completarActividades(await getOne('config', 'actividades'));
  await AG.init();
  await AG.legajoInit();
}

// ===== Despachador de eventos =====
function ejecutar(t, clave){
  const fn = A[t.dataset[clave]];
  if (!fn) return;
  Promise.resolve(fn(t, ...JSON.parse(t.dataset.p || '[]'))).catch(err => { console.error(err); avisar('Ocurrió un error: ' + err.message); });
}
let lpTimer, lpHecho = false, lpInicio = null;
function despachar(clave){
  return e => {
    if (clave === 'a' && lpHecho) { lpHecho = false; e.preventDefault(); return; }
    // El botón ⋮ dentro de una fila abre el menú y no la fila
    const t = e.target.closest(`[data-${clave}]`);
    if (!t || t.disabled) return;
    if (clave === 'a') e.preventDefault();
    ejecutar(t, clave);
  };
}
document.addEventListener('click', despachar('a'));
document.addEventListener('input', despachar('in'));
document.addEventListener('change', despachar('ch'));
// Mantener apretado: abre el menú de opciones del elemento (data-lp)
document.addEventListener('pointerdown', e => {
  const t = e.target.closest('[data-lp]');
  if (!t) return;
  lpHecho = false; lpInicio = [e.clientX, e.clientY];
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => { lpHecho = true; navigator.vibrate?.(25); ejecutar(t, 'lp'); }, 550);
});
document.addEventListener('pointermove', e => { if (lpInicio && Math.hypot(e.clientX - lpInicio[0], e.clientY - lpInicio[1]) > 10) clearTimeout(lpTimer); });
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { clearTimeout(lpTimer); lpInicio = null; });
addEventListener('scroll', () => clearTimeout(lpTimer), true);
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-lp]')) e.preventDefault(); });

// Botón atrás del celular (app Android): cierra el diálogo abierto o vuelve una pantalla; en el inicio devuelve false y la app se cierra
window.hysAtras = () => {
  if (!$('#dlg').hidden) { dlgResolver?.(-1); return true; }
  if (S.view === 'empresas') return false;
  if (esRaiz(S.view)) { A.tab(null, 'inicio'); return true; }
  A.atras();
  return true;
};

// ===== Migración: empresas de la versión anterior → razón social con un establecimiento =====
async function migrar(){
  const [emps, ests, rels] = await Promise.all(['empresas', 'establecimientos', 'relevamientos'].map(getAll));
  for (const e of emps) {
    if (ests.some(s => s.empresaId === e.id)) continue;
    const s = {id: uid(), empresaId: e.id, nombre: e.domicilio || 'Establecimiento principal', domicilio: e.domicilio || '', localidad: e.localidad || '',
      provincia: e.provincia || '', responsable: e.responsable || '', superficie: e.superficie || '', trabajadores: e.trabajadores || '', programa: {}};
    await put('establecimientos', s);
    ests.push(s);
  }
  for (const r of rels.filter(r => esRelev(r) && !r.establecimientoId)) {
    const s = ests.find(x => x.empresaId === r.empresaId);
    if (s) { r.establecimientoId = s.id; await put('relevamientos', r); }
  }
  // Los informes ya emitidos pasan sus desvíos al seguimiento (una sola vez)
  for (const r of rels.filter(r => r.modulos && terminado(r) && r.establecimientoId && !r.seguimientoCargado)) {
    S.relev = r; S.estab = ests.find(s => s.id === r.establecimientoId); S.empresa = emps.find(e => e.id === S.estab?.empresaId);
    if (!S.empresa) continue;
    await sincronizarSeguimiento(r, calcular());
    r.seguimientoCargado = true;
    await put('relevamientos', r);
  }
  S.relev = S.estab = S.empresa = null;
}

// ===== Inicio =====
(async () => {
  try { await db; }
  catch {
    $('#app').innerHTML = aviso('error', 'alerta', 'Este navegador no permite guardar datos (puede pasar en modo incógnito o con el almacenamiento bloqueado). Abrí la app en una ventana normal.');
    return;
  }
  try {
    await cargarConfig();
    PERFIL = (await getOne('config', 'perfil')) || {id: 'perfil'};
    NORMAS = {id: 'normas', estados: {}, leidas: {}, ...(await getOne('config', 'normas'))};
    ACTIVIDADES = completarActividades(await getOne('config', 'actividades'));
    await AG.init();
    await AG.legajoInit();
    await migrar();
    render();
    Sync.init();
  } catch (err) {
    console.error(err);
    $('#app').innerHTML = aviso('error', 'alerta', `No se pudo cargar la configuración de los temas (${esc(err.message)}).`);
  }
  // Web instalable: guarda la app para usarla sin señal y pide que el navegador no borre los datos
  if (window.HYS_WEB && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
  }
})();
