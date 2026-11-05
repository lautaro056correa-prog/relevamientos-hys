// Agenda de visitas: calendario asistente, clima, ejecución de la visita, vencimientos, historial, buscador y sugerencias.
// Se carga ANTES que app.js y solo define funciones: app.js suma AG.views a sus pantallas y AG.acciones a su despachador.
// Los informes de visitas (PDF, Word, Excel, gráficos, constancias) están en agenda-informes.js.
const AG = (() => {
  const views = {}, acciones = {}, prev = {};

  // ===== Librerías externas: se cargan solo cuando hacen falta (quedan guardadas para usar sin señal) =====
  const LIB = {
    calendario: ['https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js', 'https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.15/locales/es.global.min.js'],
    mapa: ['https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'],
    pdf: ['https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'],
    graficos: ['https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'],
    zip: ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'],
    escaner: ['https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/opencv.js', 'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/jscanify.js'],
    supabase: ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js']
  };
  const cargados = {};
  const cargarUno = url => cargados[url] ||= new Promise((res, rej) => {
    const css = url.endsWith('.css'), e = document.createElement(css ? 'link' : 'script');
    if (css) { e.rel = 'stylesheet'; e.href = url; } else e.src = url;
    e.onload = res;
    e.onerror = () => { delete cargados[url]; e.remove(); rej(new Error('No se pudo cargar una parte de la app. Revisá la señal y probá de nuevo.')); };
    document.head.appendChild(e);
  });
  async function lib(k){ for (const u of LIB[k]) await cargarUno(u); }

  // ===== Fechas =====
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const sumarDias = (f, n) => { const d = aFecha(f); d.setDate(d.getDate() + n); return iso(d); };
  const lunesDe = f => sumarDias(f, -((aFecha(f).getDay() + 6) % 7));
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const fechaLarga = f => `${DIAS[aFecha(f).getDay()]} ${fmtFecha(f)}`;
  const fechaCorta = f => `${DIAS[aFecha(f).getDay()].slice(0, 3)} ${fmtFecha(f).slice(0, 5)}`;
  const ahoraHM = () => new Date().toTimeString().slice(0, 5);
  const minutos = hm => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + m; };
  const horasVisita = v => v.inicio && v.fin ? Math.max(0, minutos(v.fin) - minutos(v.inicio)) / 60 : 0;
  const fmtHoras = h => (Math.round(h * 10) / 10).toString().replace('.', ',') + ' h';
  const flecha = dir => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${dir < 0 ? 'M15 5l-7 7 7 7' : 'm9 5 7 7-7 7'}"/></svg>`;

  // ===== Datos =====
  let SEMANAS = {}, FERIADOS = {}, CLIMA = {id: 'clima', puntos: {}, avisadas: {}};
  async function datos(){
    const [emp, est, vis, pen, seg, rels] = await Promise.all(['empresas', 'establecimientos', 'visitas', 'pendientes', 'seguimiento', 'relevamientos'].map(getAll));
    return {emp: emp.sort((a, b) => a.razonSocial.localeCompare(b.razonSocial)), est, vis, pen, seg, rels: rels.filter(esRelev)};
  }
  const empresaDe = (d, s) => d.emp.find(e => e.id === s?.empresaId);
  const estabDe = (d, v) => d.est.find(s => s.id === v.estabId);
  // Nombre para listas: razón social, y el establecimiento si la empresa tiene más de uno
  const cliente = (d, s) => { const e = empresaDe(d, s); if (!e) return s?.nombre || '—'; return d.est.filter(x => x.empresaId === e.id).length > 1 ? `${e.razonSocial} · ${s.nombre}` : e.razonSocial; };
  const actividad = id => ACTIVIDADES.lista.find(a => a.id === id);
  const ESTADOS = {planificada: ['Planificada', 'b-menta'], cumplida: ['Cumplida', 'b-ok'], parcial: ['Parcial', 'b-mid'], reprogramada: ['Reprogramada', 'b-na'], cancelada: ['Cancelada', 'b-bad']};
  const badgeEstado = v => `<span class="badge ${ESTADOS[v.estado][1]}">${ESTADOS[v.estado][0]}</span>`;
  const semanaCerrada = f => !!SEMANAS[lunesDe(f)]?.cerrada;
  const bloqueada = v => semanaCerrada(v.fecha);
  const porHora = (a, b) => (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99'));
  const nuevaVisita = (s, fecha, hora, actIds, extra = {}) => ({id: uid(), estabId: s.id, empresaId: s.empresaId, fecha, hora: hora || '', duracion: 2, estado: 'planificada', motivo: '',
    tareas: actIds.map(id => ({id: uid(), actividadId: id, nombre: actividad(id)?.nombre || id, hecha: false, prevista: true})),
    inicio: '', fin: '', observaciones: '', notas: '', fotos: [], relIds: [], historial: [], creado: Date.now(), ...extra});
  const fotoObligatoria = s => s?.fotoObligatoria === 'si' || (!s?.fotoObligatoria && !!PERFIL.fotoObligatoria);
  const aBlob = u => fetch(u).then(r => r.blob());
  const aDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

  // ===== Feriados nacionales: los trae de argentinadatos.com; sin señal, usa los fijos y los de Pascua =====
  const FIJOS = [['01-01', 'Año nuevo'], ['03-24', 'Día de la Memoria'], ['04-02', 'Día de Malvinas'], ['05-01', 'Día del Trabajador'], ['05-25', 'Revolución de Mayo'],
    ['06-20', 'Día de la Bandera'], ['07-09', 'Día de la Independencia'], ['12-08', 'Inmaculada Concepción'], ['12-25', 'Navidad']];
  function pascua(y){
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return iso(new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  }
  const feriadosBase = y => { const p = pascua(y); return [...FIJOS.map(([md, nombre]) => ({fecha: `${y}-${md}`, nombre})),
    {fecha: sumarDias(p, -48), nombre: 'Carnaval'}, {fecha: sumarDias(p, -47), nombre: 'Carnaval'}, {fecha: sumarDias(p, -2), nombre: 'Viernes Santo'}]; };
  async function cargarFeriados(y){
    if (FERIADOS[y]?.completo || !navigator.onLine) return;
    try {
      const r = await fetch(`https://api.argentinadatos.com/v1/feriados/${y}`);
      if (!r.ok) throw new Error(r.status);
      FERIADOS[y] = {completo: true, lista: (await r.json()).map(f => ({fecha: f.fecha, nombre: f.nombre}))};
      await put('config', {id: 'feriados', ...FERIADOS});
    } catch (e) { console.warn('Feriados', e); }
  }
  const feriado = f => (FERIADOS[f.slice(0, 4)]?.lista || feriadosBase(+f.slice(0, 4))).find(x => x.fecha === f) || null;
  const habil = f => { const d = aFecha(f).getDay(); return d !== 0 && d !== 6 && !feriado(f); };

  // ===== Clima (Open-Meteo, sin clave): pronóstico de 16 días + 2 días anteriores por ubicación =====
  const BASE = [-32.9468, -60.6393];   // Rosario: se usa cuando el establecimiento no tiene ubicación cargada
  const UMBRAL = () => ({prob: 60, mm: 2, viento: 40, pat: 10, ...PERFIL.clima});
  const coordsDe = s => s && s.lat != null ? [s.lat, s.lng] : BASE;
  const claveP = ([la, lo]) => `${(+la).toFixed(2)},${(+lo).toFixed(2)}`;
  async function actualizarClima(estabs, forzar = false){
    const puntos = [...new Set([BASE, ...estabs.map(coordsDe)].map(claveP))];
    const viejos = puntos.filter(k => forzar || !CLIMA.puntos[k] || Date.now() - CLIMA.puntos[k].t > 3 * 3600e3);
    if (!viejos.length || !navigator.onLine) return false;
    try {
      for (let i = 0; i < viejos.length; i += 40) {
        const grupo = viejos.slice(i, i + 40), la = grupo.map(k => k.split(',')[0]).join(','), lo = grupo.map(k => k.split(',')[1]).join(',');
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min&past_days=2&forecast_days=16&timezone=America%2FArgentina%2FBuenos_Aires`);
        if (!r.ok) throw new Error('Open-Meteo ' + r.status);
        const j = [].concat(await r.json());
        grupo.forEach((k, n) => {
          const d = j[n].daily, dias = {};
          d.time.forEach((f, x) => dias[f] = {code: d.weather_code[x], prob: d.precipitation_probability_max[x] ?? 0, mm: d.precipitation_sum[x] ?? 0,
            viento: d.wind_speed_10m_max[x] ?? 0, max: d.temperature_2m_max[x], min: d.temperature_2m_min[x]});
          CLIMA.puntos[k] = {t: Date.now(), dias};
        });
      }
      await put('config', CLIMA);
      return true;
    } catch (e) { console.warn('Clima', e); return false; }
  }
  const climaDia = (s, f) => CLIMA.puntos[claveP(coordsDe(s))]?.dias[f] || null;
  // Código del tiempo (WMO) → [ícono, nombre]
  const TIEMPO = c => c == null ? null : c === 0 ? ['sol', 'Despejado'] : c <= 2 ? ['solnube', 'Algo nublado'] : c === 3 ? ['nube', 'Nublado'] : c <= 48 ? ['niebla', 'Niebla']
    : c <= 67 ? ['lluvia', 'Lluvia'] : c <= 77 ? ['nieve', 'Nieve'] : c <= 82 ? ['lluvia', 'Chaparrones'] : ['tormenta', 'Tormenta'];
  const icClima = c => TIEMPO(c) ? `<span title="${TIEMPO(c)[1]}" aria-label="${TIEMPO(c)[1]}" role="img">${ic(TIEMPO(c)[0])}</span>` : '';
  const grados = x => x == null ? '–' : Math.round(x) + '°';
  // Para la pantalla (con ícono) y para diálogos y avisos (solo texto)
  const textoPlano = d => d ? `${TIEMPO(d.code)[1]} ${grados(d.min)} / ${grados(d.max)} · lluvia ${d.prob}% (${d.mm} mm) · viento ${Math.round(d.viento)} km/h` : 'Sin pronóstico para ese día';
  const textoClima = d => d ? `<span class="clima-txt">${icClima(d.code)}${esc(textoPlano(d))}</span>` : 'Sin pronóstico para ese día';
  const esPAT = t => /\bpat\b|puesta a tierra/i.test(t.nombre);
  // Alertas de una visita planificada con tareas sensibles al clima
  function alertasClima(v, s, fecha = v.fecha){
    if (v.estado !== 'planificada') return [];
    const sens = v.tareas.filter(t => actividad(t.actividadId)?.clima);
    const d = sens.length && climaDia(s, fecha);
    if (!d) return [];
    const u = UMBRAL(), m = [];
    if (d.prob > u.prob || d.mm > u.mm) m.push(`lluvia ${d.prob}% (${d.mm} mm)`);
    if (d.viento > u.viento) m.push(`viento ${Math.round(d.viento)} km/h`);
    if (sens.some(esPAT)) {
      const previa = [1, 2].reduce((t, n) => t + (climaDia(s, sumarDias(fecha, -n))?.mm || 0), 0);
      if (previa > u.pat) m.push(`${Math.round(previa)} mm en las 48 h previas (PAT)`);
    }
    return m.length ? [`${sens.map(t => t.nombre).join(', ')}: ${m.join(', ')}`] : [];
  }
  // Próximos días hábiles con buen pronóstico para esa visita
  function diasBuenos(v, s){
    const out = [];
    for (let f = sumarDias(hoy(), 1), i = 0; i < 16 && out.length < 4; f = sumarDias(f, 1), i++)
      if (f !== v.fecha && habil(f) && !semanaCerrada(f) && climaDia(s, f) && !alertasClima(v, s, f).length) out.push(f);
    return out;
  }

  // ===== Avisos (con la app abierta; las notificaciones con la app cerrada llegan con el servidor, etapa 1B) =====
  function notificar(titulo, cuerpo){
    toast(`${titulo}: ${cuerpo.split('\n')[0]}`);
    if (window.Notification?.permission !== 'granted') return;
    const op = {body: cuerpo, icon: 'iconos/icon-192.png', tag: titulo};
    (navigator.serviceWorker?.getRegistration() || Promise.resolve(null))
      .then(r => r ? r.showNotification(titulo, op) : new Notification(titulo, op)).catch(() => {});
  }
  let ultimoChequeo = 0;
  async function chequeo(){
    if (Date.now() - ultimoChequeo < 5 * 60e3) return;
    ultimoChequeo = Date.now();
    const d = await datos(), h = hoy(), hora = new Date().getHours();
    await actualizarClima(d.est);
    // Alertas de clima nuevas en los próximos 7 días
    const nuevas = [];
    for (const v of d.vis.filter(v => v.estado === 'planificada' && v.fecha >= h && v.fecha <= sumarDias(h, 7))) {
      const s = estabDe(d, v), al = alertasClima(v, s), k = v.id + '|' + v.fecha;
      if (al.length && !CLIMA.avisadas[k]) { CLIMA.avisadas[k] = Date.now(); nuevas.push(`${cliente(d, s)} (${fechaCorta(v.fecha)}): ${al[0]}`); }
    }
    if (nuevas.length) { await put('config', CLIMA); notificar('Alerta de clima', nuevas.join('\n')); }
    // La noche anterior: resumen de las visitas de mañana con su clima
    const man = sumarDias(h, 1), vm = d.vis.filter(v => v.fecha === man && v.estado === 'planificada').sort(porHora);
    const yaAviso = (await getOne('config', 'avisosLocal')) || {};   // lo que ya avisó el service worker con la app cerrada
    if (hora >= 19 && vm.length && pref.get('avisoManiana') !== h && yaAviso.noche !== h) {
      pref.set('avisoManiana', h);
      notificar(`Mañana: ${plural(vm.length, 'visita', 'visitas')}`, vm.map(v => { const s = estabDe(d, v), c = climaDia(s, man); return `${v.hora || ''} ${cliente(d, s)} ${c ? TIEMPO(c.code)[1].toLowerCase() + ' ' + grados(c.max) : ''}`.trim(); }).join('\n'));
    }
    // Visitas pasadas sin cerrar (una vez por día)
    const sin = d.vis.filter(v => v.estado === 'planificada' && v.fecha < h).length;
    if (sin && hora >= 8 && pref.get('avisoSinCerrar') !== h && yaAviso.manana !== h) { pref.set('avisoSinCerrar', h); notificar('Visitas sin cerrar', `Tenés ${plural(sin, 'visita pasada', 'visitas pasadas')} sin cerrar.`); }
  }

  // ===== Qué toca relevar: tema más atrasado del Panel de control y sector que hace más que no se releva =====
  function tocaRelevar(s, d){
    const partes = [], prog = programacion(s, d.rels).filter(p => p.frec && p.dias != null).sort((a, b) => a.dias - b.dias);
    if (prog[0] && prog[0].dias <= 30) partes.push(`<b>${esc(prog[0].mod.titulo)}</b> (${textoVence(prog[0])})`);
    const sectores = {};
    for (const r of d.rels.filter(r => r.establecimientoId === s.id && r.modulos))
      for (const m of r.modulos) for (const el of m.elementos) {
        const n = (el.sector || '').trim();
        if (n && (!sectores[n.toLowerCase()] || sectores[n.toLowerCase()].f < r.fecha_relevamiento)) sectores[n.toLowerCase()] = {n, f: r.fecha_relevamiento};
      }
    const lista = Object.values(sectores).sort((a, b) => a.f.localeCompare(b.f));
    if (lista.length > 1) partes.push(`sector <b>${esc(lista[0].n)}</b> (último relevamiento ${fmtFecha(lista[0].f)})`);
    return partes.length ? `Toca relevar: ${partes.join(' · ')}` : '';
  }

  // ===== Sugerencias del asistente =====
  const DIAS_FREC = {semanal: 7, quincenal: 14, mensual: 30};
  function sugerencias(d){
    const out = [], h = hoy(), en7 = sumarDias(h, 7);
    for (const v of d.vis.filter(v => v.estado === 'planificada' && v.fecha < h).sort(porHora))
      out.push({prio: 0, icono: 'reloj', color: 'rojo', txt: `Visita sin cerrar: <b>${esc(cliente(d, estabDe(d, v)))}</b> del ${fechaCorta(v.fecha)}`, accion: ['abrirVisita', v.id], boton: 'Cerrar'});
    for (const v of d.vis.filter(v => v.estado === 'planificada' && v.fecha >= h && v.fecha <= en7).sort(porHora)) {
      const al = alertasClima(v, estabDe(d, v));
      if (al.length) out.push({prio: 1, icono: 'lluvia', color: 'amarillo', txt: `Clima: <b>${esc(cliente(d, estabDe(d, v)))}</b> ${fechaCorta(v.fecha)} · ${esc(al[0])}`, accion: ['diasBuenos', v.id], boton: 'Reprogramar'});
    }
    for (const s of d.est.filter(s => DIAS_FREC[s.frecVisita])) {
      const vs = d.vis.filter(v => v.estabId === s.id);
      const ult = vs.filter(v => v.estado === 'cumplida' || v.estado === 'parcial').map(v => v.fecha).sort().pop();
      const prox = vs.filter(v => v.estado === 'planificada' && v.fecha >= h).map(v => v.fecha).sort()[0];
      const toca = ult ? sumarDias(ult, DIAS_FREC[s.frecVisita]) : h;
      if ((!prox || prox > toca) && toca <= en7)
        out.push({prio: toca <= h ? 1 : 2, icono: 'calendario', color: 'menta', txt: `<b>${esc(cliente(d, s))}</b>: visita ${s.frecVisita} ${ult ? `(última ${fmtFecha(ult)})` : '(sin visitas registradas)'}${prox ? `, la próxima agendada es el ${fmtFecha(prox)}` : ', sin visita agendada'}`,
          accion: ['agendar', s.id, '', toca < h ? h : toca], boton: 'Agendar'});
    }
    // Legajo técnico: vencidos, faltantes y por vencer (si tienen una tarea que los renueva, se ofrece agendarla)
    for (const x of AG.legajoAvisos(d.est)) {
      const act = (x.r.actividades || [])[0], agendada = act && d.vis.some(v => v.estabId === x.s.id && v.estado === 'planificada' && v.fecha >= h && v.tareas.some(t => t.actividadId === act));
      if (agendada) continue;
      const que = x.est === 'faltante' ? 'falta' : x.dias < 0 ? 'venció' : `vence en ${plural(x.dias, 'día', 'días')}`;
      out.push({prio: x.est === 'porvencer' ? 2 : 1, icono: 'carpeta', color: x.est === 'porvencer' ? 'amarillo' : 'rojo',
        txt: `Legajo: <b>${esc(x.r.nombre)}</b> de ${esc(cliente(d, x.s))} ${que}${act ? ', coordinar ' + esc(actividad(act)?.nombre.toLowerCase() || 'la tarea') : ''}`,
        accion: act ? ['agendar', x.s.id, act, x.dias == null || x.dias < 7 ? h : sumarDias(x.venc, -7)] : ['abrirLegajoItemDe', x.s.id, x.r.codigo, x.it.sub || ''], boton: act ? 'Agendar' : 'Ver'});
    }
    // Próxima visita de cada cliente en la semana: qué toca relevar
    const vistos = new Set();
    for (const v of d.vis.filter(v => v.estado === 'planificada' && v.fecha >= h && v.fecha <= en7).sort(porHora)) {
      if (vistos.has(v.estabId)) continue;
      vistos.add(v.estabId);
      const s = estabDe(d, v), t = s && tocaRelevar(s, d);
      if (t) out.push({prio: 3, icono: 'lista', color: 'verde', txt: `<b>${esc(cliente(d, s))}</b> (${fechaCorta(v.fecha)}) · ${t}`, accion: ['abrirVisita', v.id], boton: 'Ver'});
    }
    return out.sort((a, b) => a.prio - b.prio);
  }
  function sugerenciasHtml(sug, max){
    const ver = S.verSug ? sug : sug.slice(0, max);
    return `<div class="card alertas sugs"><div class="between"><b>${ic('campana')} Asistente</b><span class="badge ${sug.some(x => x.prio <= 1) ? 'b-bad' : 'b-mid'}">${sug.length}</span></div>
      ${ver.map(x => `<div class="el"><div class="tile t-${x.color} chico">${ic(x.icono)}</div><div><div class="sugtxt">${x.txt}</div></div>
        <button class="btn sec small" ${on(...x.accion)}>${x.boton}</button></div>`).join('')}
      ${sug.length > max ? `<a class="link" style="display:block;padding-top:8px" ${on('verSug')}>${S.verSug ? 'Ver menos' : `Ver las ${sug.length}`}</a>` : ''}</div>`;
  }
  acciones.verSug = () => { S.verSug = !S.verSug; render(); };

  // ===== Motivo obligatorio (reprogramar / cancelar): diálogo con motivos rápidos + texto =====
  async function pedirMotivo(texto, rapidos = ['Clima', 'Pedido del cliente', 'Superposición de agenda', 'Feriado o asueto', 'Enfermedad']){
    for (;;) {
      const p = dialogo(texto, [{txt: 'Volver', clase: 'ghost', valor: null}, {txt: 'Confirmar', valor: 'ok'}]);
      const extra = document.createElement('div');
      extra.id = 'dlgExtra';
      extra.innerHTML = `<div class="chips">${rapidos.map(r => `<button class="chip small" ${on('dlgMotivo', r)}>${esc(r)}</button>`).join('')}</div>
        <input id="dlgInput" placeholder="Escribí el motivo" aria-label="Motivo" style="margin:12px 0 16px">`;
      $('#dlgBtns').before(extra);
      const r = await p, val = $('#dlgInput').value.trim();
      extra.remove();
      if (!r) return null;
      if (val) return val;
      await avisar('El motivo es obligatorio.');
    }
  }
  acciones.dlgMotivo = (t, m) => { $('#dlgInput').value = m; };

  // Reprogramar: si la visita es de esta semana o anterior, queda registrada como "reprogramada" (cuenta en el informe
  // del director) y se crea la nueva; si es de una semana futura, solo se mueve. Devuelve la visita que queda vigente.
  async function reprogramar(v, fecha, motivo){
    const hist = [...(v.historial || []), {cuando: hoy(), de: v.fecha, a: fecha, motivo}];
    if (v.fecha >= sumarDias(lunesDe(hoy()), 7)) {
      Object.assign(v, {fecha, historial: hist});
      await put('visitas', v);
      return v;
    }
    const n = {...structuredClone(v), id: uid(), fecha, estado: 'planificada', motivo: '', origenId: v.id, creado: Date.now(), historial: hist,
      inicio: '', fin: '', fotos: [], relIds: [], constancia: null, planilla: null};
    n.tareas.forEach(t => t.hecha = false);
    Object.assign(v, {estado: 'reprogramada', motivo, reprogramadaA: n.id});
    await put('visitas', v);
    await put('visitas', n);
    return n;
  }
  const avisoSemanaCerrada = () => avisar('Esa semana ya está cerrada porque se emitió el resumen. Para cambiar algo, reabrila desde Informes › Visitas.');
  async function moverVisita(id, fecha){
    const v = await getOne('visitas', id);
    if (!v || v.fecha === fecha) return null;
    if (bloqueada(v) || semanaCerrada(fecha)) { await avisoSemanaCerrada(); return null; }
    if (!habil(fecha) && !(await confirmar(`El ${fechaLarga(fecha)} es ${feriado(fecha)?.nombre || 'fin de semana'}. ¿La movés igual?`, 'Mover igual'))) return null;
    const motivo = await pedirMotivo(`Reprogramar la visita del ${fechaLarga(v.fecha)} al ${fechaLarga(fecha)}. ¿Por qué se cambia?`);
    if (!motivo) return null;
    const n = await reprogramar(v, fecha, motivo);
    toast('Visita reprogramada');
    return n;
  }

  // ===== Calendario (FullCalendar) =====
  let cal = null, mapa = null;
  function eventos(d){
    return d.vis.filter(v => v.estado !== 'reprogramada').map(v => {
      const s = estabDe(d, v), al = alertasClima(v, s), cl = v.estado === 'planificada' ? climaDia(s, v.fecha) : null;
      const movible = v.estado === 'planificada' && !bloqueada(v), e = empresaDe(d, s);
      const icono = al.length ? ic('alerta') : cl ? icClima(cl.code) : v.estado === 'cumplida' ? ic('check') : v.estado === 'cancelada' ? ic('x') : '';
      const corto = (e?.razonSocial || s?.nombre || '').replace(/^(la|el|los|las)\s+/i, '').split(/\s+/)[0];
      return {id: v.id, start: v.hora ? `${v.fecha}T${v.hora}` : v.fecha, allDay: !v.hora, startEditable: movible,
        classNames: ['ev', 'ev-' + v.estado, al.length ? 'ev-alerta' : ''],
        extendedProps: {
          mes: `<div class="evt">${icono}${esc(corto)}</div>`,
          lista: `<div class="evl"><b>${esc(cliente(d, s))}</b> ${badgeEstado(v)}<div class="sub">${icono} ${esc(v.tareas.map(t => t.nombre).join(', ') || 'Sin tareas')}${al.length ? ' · ' + esc(al[0]) : ''}</div></div>`}};
    });
  }
  async function montarCalendario(){
    if (!$('#cal')) return;
    try { await lib('calendario'); } catch (e) { $('#cal').innerHTML = aviso('error', 'alerta', esc(e.message)); return; }
    const d = await datos(), y = +S.agFecha.slice(0, 4);
    await Promise.all([cargarFeriados(y), cargarFeriados(y + 1)]);
    const el = $('#cal');
    if (!el) return;   // cambió de pantalla mientras cargaba
    cal?.destroy();
    cal = new FullCalendar.Calendar(el, {
      locale: 'es', firstDay: 1, height: 'auto', initialDate: S.agFecha, fixedWeekCount: false, dayMaxEvents: 3,
      initialView: S.agVista === 'semana' ? 'listWeek' : 'dayGridMonth', noEventsContent: 'No hay visitas esta semana',
      headerToolbar: {left: 'prev,next', center: 'title', right: 'today'}, buttonText: {today: 'Hoy'},
      editable: true, eventDurationEditable: false, longPressDelay: 350, eventLongPressDelay: 350, displayEventTime: false, eventDisplay: 'block',
      events: eventos(d),
      eventContent: a => ({html: a.event.extendedProps[a.view.type === 'listWeek' ? 'lista' : 'mes']}),
      eventDrop: async info => { const n = await moverVisita(info.event.id, iso(info.event.start)); if (!n) info.revert(); else render(); },
      eventClick: info => { info.jsEvent.preventDefault(); A.abrirVisita(null, info.event.id); },
      dateClick: info => { S.agFecha = info.dateStr; S.agVista = 'dia'; render(); scrollTo(0, 0); },
      dayCellClassNames: a => feriado(iso(a.date)) ? ['es-feriado'] : [],
      dayCellContent: a => { const f = iso(a.date), c = climaDia(null, f); return {html: `${c ? `<span class="cl">${icClima(c.code)}</span>` : ''}<span>${a.dayNumberText}</span>`}; },
      datesSet: a => { S.agFecha = iso(a.view.currentStart); }
    });
    cal.render();
  }
  const rutaUrl = pts => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${pts[pts.length - 1].join(',')}${pts.length > 1 ? '&waypoints=' + encodeURIComponent(pts.slice(0, -1).map(p => p.join(',')).join('|')) : ''}`;
  async function montarMapa(){
    if (!$('#mapa')) return;
    try { await lib('mapa'); } catch { $('#mapa').innerHTML = '<p class="sub" style="padding:16px">No se pudo cargar el mapa (¿hay señal?).</p>'; return; }
    const d = await datos(), el = $('#mapa');
    if (!el) return;
    const vs = d.vis.filter(v => v.fecha === S.agFecha && v.estado !== 'reprogramada' && v.estado !== 'cancelada' && estabDe(d, v)?.lat != null).sort(porHora);
    mapa?.remove();
    mapa = L.map(el, {scrollWheelZoom: false});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap'}).addTo(mapa);
    const pts = vs.map((v, i) => {
      const s = estabDe(d, v), p = [s.lat, s.lng];
      L.marker(p, {icon: L.divIcon({className: 'pin', html: String(i + 1), iconSize: [30, 30]})}).addTo(mapa).bindPopup(`<b>${esc(cliente(d, s))}</b><br>${esc(v.hora || '')} ${esc(s.domicilio || '')}`);
      return p;
    });
    if (pts.length > 1) mapa.fitBounds(pts, {padding: [30, 30]}); else if (pts.length) mapa.setView(pts[0], 15);
  }

  function tarjetaVisita(d, v){
    const s = estabDe(d, v), e = empresaDe(d, s), al = alertasClima(v, s), cl = v.estado === 'planificada' ? climaDia(s, v.fecha) : null;
    const tel = (e?.contactos || []).some(c => c.telefono);
    return `<div class="card visita ${al.length ? 'alerta' : ''} ${v.estado}">
      <div class="vcab" ${on('abrirVisita', v.id)}><div class="hora num">${esc(v.hora || '—')}</div>
        <div><b>${esc(e?.razonSocial || '—')}</b><div class="sub">${esc(s?.nombre || '')}${cl ? ` · ${TIEMPO(cl.code)[1].toLowerCase()} ${grados(cl.max)} · lluvia ${cl.prob}%` : ''}</div></div>${badgeEstado(v)}</div>
      ${v.tareas.length ? `<div class="chips mini">${v.tareas.map(t => `<span class="chip small ${t.hecha ? 'on' : ''}">${actividad(t.actividadId)?.clima ? ic('lluvia') : ''}${esc(t.nombre)}</span>`).join('')}</div>` : ''}
      ${v.motivo ? `<p class="sub" style="margin:8px 0 0">Motivo: ${esc(v.motivo)}</p>` : ''}
      ${al.map(a => `<div style="margin-top:10px">${aviso('aviso', 'lluvia', `<b>Alerta de clima.</b> ${esc(a)}. <a class="link" ${on('diasBuenos', v.id)}>Ver días con buen pronóstico</a>`)}</div>`).join('')}
      ${v.estado === 'planificada' ? `<div class="actions acc">${tel ? `<button class="btn sec small" ${on('whatsappVisita', v.id)}>${ic('chat')}Confirmar</button>` : ''}
        ${s?.lat != null ? `<a class="btn sec small" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">${ic('ubicacion')}Cómo llegar</a>` : ''}
        <button class="btn small" ${on('abrirVisita', v.id)}>Abrir</button></div>` : ''}
    </div>`;
  }
  function diaHtml(d, f){
    const vs = d.vis.filter(v => v.fecha === f && v.estado !== 'reprogramada').sort(porHora);
    const fer = feriado(f), cl = climaDia(null, f);
    const pts = vs.filter(v => v.estado !== 'cancelada').map(v => estabDe(d, v)).filter(s => s?.lat != null).map(s => [s.lat, s.lng]);
    return `<div class="dianav card"><button class="hbtn mini" ${on('agDia', -1)} aria-label="Día anterior">${flecha(-1)}</button>
        <div><b>${cap(fechaLarga(f))}</b>${f === hoy() ? ' <span class="badge b-menta">Hoy</span>' : ''}
          <div class="sub">${fer ? `<span class="fer">${esc(fer.nombre)}</span> · ` : ''}${cl ? textoClima(cl) : 'Sin pronóstico'}</div></div>
        <button class="hbtn mini" ${on('agDia', 1)} aria-label="Día siguiente">${flecha(1)}</button></div>
      ${f !== hoy() ? `<button class="btn ghost small block" style="margin-top:8px" ${on('agHoy')}>Ir a hoy</button>` : ''}
      <div class="list" style="margin-top:12px">${vs.map(v => tarjetaVisita(d, v)).join('') || vacio('calendario', 'No hay visitas este día.')}</div>
      ${pts.length ? `<h3>Mapa del día</h3><div id="mapa" class="mapa"></div>
        <a class="btn sec block" style="margin-top:10px" href="${rutaUrl(pts)}" target="_blank" rel="noopener">${ic('ubicacion')}Abrir ruta en Google Maps</a>` : ''}`;
  }

  views.agenda = {
    title: () => 'Agenda',
    right: () => `<button class="hbtn" ${on('go', 'buscar')} aria-label="Buscar">${ic('search')}</button>`,
    async html(){
      const d = await datos();
      S.agFecha ||= hoy(); S.agVista ||= 'mes';
      actualizarClima(d.est).then(ok => ok && S.view === 'agenda' && render());
      const seg = [['mes', 'Mes'], ['semana', 'Semana'], ['dia', 'Día']].map(([k, t]) => `<button class="${S.agVista === k ? 'on' : ''}" ${on('agVista', k)}>${t}</button>`).join('');
      const sug = sugerencias(d);
      const cuerpo = S.agVista === 'dia' ? diaHtml(d, S.agFecha) : `<div id="cal" class="cal card"><div class="loading">Cargando calendario…</div></div>
        <p class="hint">${S.agVista === 'semana' ? 'Tocá una visita para abrirla. Para reprogramar arrastrando, usá la vista Mes.'
          : 'Tocá un día para ver el detalle, el mapa y la ruta. Para reprogramar, mantené apretada una visita y arrastrala a otro día.'}</p>
        ${S.agVista === 'semana' ? `<button class="btn sec block" ${on('duplicarSemana')}>${ic('plus')}Copiar esta semana a la siguiente</button>` : ''}`;
      return `<div class="segmento">${seg}</div>
        ${sug.length ? `<div style="margin-top:12px">${sugerenciasHtml(sug, 3)}</div>` : ''}
        <div style="margin-top:12px">${cuerpo}</div>
        <div class="bottom-bar"><div class="actions"><button class="btn hazard" ${on('nuevaVisita')}>${ic('plus')}Agendar visita</button></div></div>`;
    },
    despues: () => S.agVista === 'dia' ? montarMapa() : montarCalendario()
  };
  // Al cambiar de vista: si se está mirando el mes actual, se va a hoy
  acciones.agVista = (t, k) => { S.agVista = k; if (k !== 'mes' && (k === 'dia' || S.agFecha.slice(0, 7) === hoy().slice(0, 7))) S.agFecha = hoy(); render(); };
  acciones.agDia = (t, n) => { S.agFecha = sumarDias(S.agFecha, n); render(); };
  acciones.agHoy = () => { S.agFecha = hoy(); render(); };
  acciones.irAgendaHoy = () => { S.agFecha = hoy(); S.agVista = 'dia'; A.tab(null, 'agenda'); };
  acciones.duplicarSemana = async () => {
    const lunes = lunesDe(S.agFecha), d = await datos();
    const vs = d.vis.filter(v => v.fecha >= lunes && v.fecha <= sumarDias(lunes, 6) && v.estado !== 'reprogramada');
    if (!vs.length) return avisar('Esta semana no tiene visitas para copiar.');
    if (semanaCerrada(sumarDias(lunes, 7))) return avisoSemanaCerrada();
    if (!(await confirmar(`¿Copiar ${plural(vs.length, 'visita', 'visitas')} de la semana del ${fmtFecha(lunes)} a la semana siguiente? Se copian como planificadas, con las mismas tareas y horarios.`, 'Copiar'))) return;
    for (const v of vs) await put('visitas', nuevaVisita(estabDe(d, v), sumarDias(v.fecha, 7), v.hora, v.tareas.filter(t => t.prevista).map(t => t.actividadId), {duracion: v.duracion, notas: v.notas}));
    S.agFecha = sumarDias(lunes, 7);
    toast('Semana copiada');
    render();
  };

  // ===== WhatsApp y clima de una visita =====
  acciones.whatsappVisita = async (t, id) => {
    const d = await datos(), v = d.vis.find(x => x.id === id), s = estabDe(d, v), e = empresaDe(d, s);
    const cs = (e?.contactos || []).filter(c => c.telefono);
    if (!cs.length) return avisar('Este cliente no tiene contactos con teléfono. Cargalos en los datos de la empresa.');
    const c = cs.length === 1 ? cs[0] : await menu('¿A quién le escribís?', cs.map(c => ({txt: `${c.nombre || c.telefono} (${c.rol})`, icono: 'chat', valor: c})));
    if (!c) return;
    const cuando = v.fecha === hoy() ? 'de hoy' : v.fecha === sumarDias(hoy(), 1) ? 'de mañana' : `del ${fechaLarga(v.fecha)}`;
    const txt = `Hola${c.nombre ? ' ' + c.nombre.split(' ')[0] : ''}, te escribo para confirmar la visita de Higiene y Seguridad ${cuando}${v.hora ? ` a las ${v.hora} h` : ''} en ${s.nombre}${v.tareas.length ? ` (${v.tareas.map(t => t.nombre.toLowerCase()).join(', ')})` : ''}. ¿Te queda bien? ${PERFIL.nombre ? 'Saludos, ' + PERFIL.nombre.split(' ')[0] : 'Saludos'}.`;
    window.open(`https://wa.me/${numeroWa(c.telefono)}?text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
  };
  acciones.diasBuenos = async (t, id) => {
    const d = await datos(), v = d.vis.find(x => x.id === id), s = estabDe(d, v);
    if (bloqueada(v)) return avisoSemanaCerrada();
    const ops = diasBuenos(v, s);
    if (!ops.length) return avisar('No encontré días hábiles con buen pronóstico en las próximas dos semanas. Probá más adelante: el pronóstico se actualiza varias veces por día.');
    const f = await menu(`Días hábiles con buen pronóstico para ${cliente(d, s)}. Elegí uno y se reprograma con motivo "clima":`,
      ops.map(f => ({txt: `${cap(fechaLarga(f))} · ${textoPlano(climaDia(s, f))}`, icono: 'calendario', valor: f})));
    if (!f) return;
    const n = await reprogramar(v, f, 'Clima');
    toast(`Reprogramada al ${fechaCorta(f)}`);
    if (S.view === 'visita') S.vid = n.id;
    render();
  };

  // ===== Agendar / editar visita =====
  function abrirForm(F){ S.vform = {hora: '09:00', duracion: 2, repetir: '', notas: '', ...F, acts: new Set(F.acts || [])}; S.vform.hasta ||= sumarMeses(S.vform.fecha, 3); S.vformVolver = S.view; go('visitaForm'); }
  acciones.nuevaVisita = () => abrirForm({estabId: S.view === 'estab' ? S.estab.id : '', fecha: S.view === 'agenda' && S.agVista === 'dia' && S.agFecha >= hoy() ? S.agFecha : hoy()});
  acciones.agendar = (t, estabId, actId, fecha) => abrirForm({estabId, fecha: fecha || hoy(), acts: actId ? [actId] : []});
  acciones.editarVisita = async () => {
    const v = await getOne('visitas', S.vid);
    if (bloqueada(v)) return avisoSemanaCerrada();
    abrirForm({id: v.id, estabId: v.estabId, fecha: v.fecha, hora: v.hora, duracion: v.duracion || 2, notas: v.notas || '', acts: v.tareas.filter(t => t.prevista).map(t => t.actividadId)});
  };
  prev.visitaForm = () => S.vformVolver || 'agenda';
  const chipsActs = () => ACTIVIDADES.lista.filter(a => a.activa || S.vform.acts.has(a.id))
    .map(a => `<button class="chip ${S.vform.acts.has(a.id) ? 'on' : ''}" ${on('vfAct', a.id)}>${a.clima ? ic('lluvia') : ''}${esc(a.nombre)}</button>`).join('');
  views.visitaForm = {
    title: () => S.vform.id ? 'Editar visita' : 'Agendar visita',
    async html(){
      const d = await datos(), F = S.vform;
      if (!d.est.length) return vacio('edificio', 'Primero cargá un cliente con su establecimiento en la pestaña Clientes.');
      const opts = d.emp.map(e => { const ests = d.est.filter(s => s.empresaId === e.id); return ests.length ? `<optgroup label="${esc(e.razonSocial)}">${ests.map(s =>
        `<option value="${s.id}" ${F.estabId === s.id ? 'selected' : ''}>${esc(ests.length > 1 ? `${e.razonSocial} · ${s.nombre}` : e.razonSocial)}</option>`).join('')}</optgroup>` : ''; }).join('');
      const s = d.est.find(x => x.id === F.estabId), toca = s && tocaRelevar(s, d), fer = F.fecha && feriado(F.fecha), cl = s && F.fecha && climaDia(s, F.fecha);
      const abiertos = s ? d.pen.filter(p => p.estabId === s.id && p.estado === 'Abierto').length + d.seg.filter(o => o.establecimientoId === s.id && o.estado === 'Abierto').length : 0;
      return `<div class="stack"><div class="card">
          <label for="vf_estab">Cliente</label><select id="vf_estab" ${oc('vfCampo', 'estabId', true)}><option value="">Elegí el cliente…</option>${opts}</select>
          ${toca ? `<div class="auto">${ic('info')}<div>${toca}</div></div>` : ''}
          ${abiertos ? `<div class="auto">${ic('alerta')}<div>${plural(abiertos, 'pendiente o desvío abierto', 'pendientes o desvíos abiertos')}: aparecen en la visita para revisarlos.</div></div>` : ''}
          <div class="row"><div class="fld"><label for="vf_fecha">Fecha</label><input id="vf_fecha" type="date" value="${F.fecha}" ${oc('vfCampo', 'fecha', true)}></div>
            <div class="fld"><label for="vf_hora">Hora</label><input id="vf_hora" type="time" value="${F.hora}" ${oc('vfCampo', 'hora')}></div></div>
          ${fer ? `<div class="hint fer">Es feriado: ${esc(fer.nombre)}</div>` : F.fecha && !habil(F.fecha) ? '<div class="hint">Es fin de semana.</div>' : ''}
          ${cl ? `<div class="hint">Pronóstico: ${textoClima(cl)}</div>` : ''}
          <label for="vf_dur">Duración estimada (horas)</label><input id="vf_dur" type="number" inputmode="decimal" step="0.5" min="0.5" value="${F.duracion}" ${oc('vfCampo', 'duracion')}>
        </div>
        <div class="card"><h4>Tareas planificadas</h4><p class="sub" style="margin-top:0">${ic('lluvia')} = sensible al clima: si el pronóstico es malo, la app te avisa.</p><div class="chips" id="vf_acts">${chipsActs()}</div></div>
        ${F.id ? '' : `<div class="card"><h4>Repetir</h4><select id="vf_rep" aria-label="Repetir" ${oc('vfCampo', 'repetir', true)}>${[['', 'No se repite'], ['7', 'Cada semana'], ['14', 'Cada 2 semanas'], ['m', 'Cada mes']]
          .map(([k, txt]) => `<option value="${k}" ${F.repetir === k ? 'selected' : ''}>${txt}</option>`).join('')}</select>
          ${F.repetir ? `<label for="vf_hasta">Hasta</label><input id="vf_hasta" type="date" value="${F.hasta}" ${oc('vfCampo', 'hasta')}>` : ''}</div>`}
        <div class="card"><label for="vf_notas">Notas para la visita</label><textarea id="vf_notas" ${oi('vfCampo', 'notas')}>${esc(F.notas)}</textarea></div>
        ${F.id ? `<button class="btn danger block" ${on('eliminarVisita')}>${ic('basura')}Eliminar visita</button>` : ''}
      </div>
      <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('atras')}>Cancelar</button><button class="btn" ${on('guardarVisita')}>${ic('check')}Guardar</button></div></div>`;
    }
  };
  acciones.vfCampo = (t, campo, redibujar) => { S.vform[campo] = t.value; if (redibujar) render(); };
  acciones.vfAct = (t, id) => { S.vform.acts.has(id) ? S.vform.acts.delete(id) : S.vform.acts.add(id); $('#vf_acts').innerHTML = chipsActs(); };
  acciones.guardarVisita = async () => {
    const F = S.vform, d = await datos(), s = d.est.find(x => x.id === F.estabId);
    if (!s) return avisar('Elegí el cliente.');
    if (!F.fecha) return avisar('Poné la fecha de la visita.');
    if (semanaCerrada(F.fecha)) return avisoSemanaCerrada();
    const acts = [...F.acts], dur = +F.duracion || 2;
    if (F.id) {
      let v = await getOne('visitas', F.id);
      if (v.fecha !== F.fecha) { v = await moverVisita(v.id, F.fecha); if (!v) return; }
      const quedan = v.tareas.filter(t => !t.prevista || t.hecha || acts.includes(t.actividadId));
      for (const id of acts) if (!quedan.some(t => t.actividadId === id)) quedan.push({id: uid(), actividadId: id, nombre: actividad(id)?.nombre || id, hecha: false, prevista: true});
      Object.assign(v, {estabId: s.id, empresaId: s.empresaId, hora: F.hora, duracion: dur, notas: F.notas, tareas: quedan});
      await put('visitas', v);
      toast('Visita guardada');
    } else {
      const fechas = [F.fecha];
      if (F.repetir) {
        const hasta = F.hasta && F.hasta > F.fecha ? (F.hasta < sumarMeses(F.fecha, 12) ? F.hasta : sumarMeses(F.fecha, 12)) : F.fecha;
        for (let f = F.fecha, i = 1; i < 60; i++) { f = F.repetir === 'm' ? sumarMeses(F.fecha, i) : sumarDias(F.fecha, i * +F.repetir); if (f > hasta) break; fechas.push(f); }
      }
      const serieId = fechas.length > 1 ? uid() : undefined, validas = fechas.filter(f => !semanaCerrada(f));
      for (const f of validas) await put('visitas', nuevaVisita(s, f, F.hora, acts, {duracion: dur, notas: F.notas, serieId}));
      toast(validas.length > 1 ? `${validas.length} visitas agendadas` : 'Visita agendada');
    }
    S.agFecha = F.fecha;
    go(prev.visitaForm());
  };
  acciones.eliminarVisita = async () => {
    const v = await getOne('visitas', S.vform.id), d = await datos();
    if (bloqueada(v)) return avisoSemanaCerrada();
    const serie = v.serieId ? d.vis.filter(x => x.serieId === v.serieId && x.fecha > v.fecha && x.estado === 'planificada' && !bloqueada(x)) : [];
    let borrar = [v];
    if (serie.length) {
      const r = await menu('Esta visita se repite. ¿Qué querés eliminar?', [{txt: 'Solo esta visita', valor: 'una'}, {txt: `Esta y las ${serie.length} siguientes`, valor: 'serie', clase: 'danger'}]);
      if (!r) return;
      if (r === 'serie') borrar = [v, ...serie];
    } else if (!(await confirmar(`¿Eliminar la visita del ${fechaLarga(v.fecha)}? Si no se hizo, conviene más "Cancelar visita" (queda registrada con su motivo para el informe).`, 'Eliminar'))) return;
    for (const x of borrar) await del('visitas', x.id);
    toast('Eliminada');
    S.vformVolver = S.vformVolver === 'visita' ? 'agenda' : S.vformVolver;
    go(prev.visitaForm());
  };

  // ===== Visita: ejecución =====
  acciones.abrirVisita = (t, id) => { if (S.view !== 'visita') S.visitaVolver = S.view; S.vid = id; go('visita'); };
  prev.visita = () => S.visitaVolver && S.visitaVolver !== 'visita' ? S.visitaVolver : 'agenda';
  let guardarTimer;
  const guardarV = (inmediato) => { clearTimeout(guardarTimer); return inmediato ? put('visitas', S.vis) : (guardarTimer = setTimeout(() => put('visitas', S.vis), 400)); };
  // Antes de cualquier cambio: la visita no puede estar en una semana cerrada
  const editable = async () => { if (!S.vis) return false; if (bloqueada(S.vis)) { await avisoSemanaCerrada(); return false; } return true; };

  function pendientesHtml(d, v, lock){
    const h = (txt, sub, botones) => `<div class="el pend"><div><div>${txt}</div><div class="sub">${sub}</div></div>${lock ? '' : botones}</div>`;
    // Los pendientes del legajo se resuelven en el legajo (se cierran solos al regularizar el ítem)
    const legs = d.pen.filter(p => p.estabId === v.estabId && p.origen === 'legajo' && p.estado === 'Abierto');
    const pens = d.pen.filter(p => p.estabId === v.estabId && p.origen !== 'legajo' && (p.estado === 'Abierto' || p.cierreVisitaId === v.id) && p.visitaId !== v.id);
    const segs = d.seg.filter(o => o.establecimientoId === v.estabId && (o.estado === 'Abierto' || o.cierreVisitaId === v.id));
    const propios = d.pen.filter(p => p.visitaId === v.id && p.origen !== 'legajo');
    const btn = (tipo, x) => x.estado === 'Abierto' ? `<button class="btn sec small" ${on('vResolver', tipo, x.id)}>${ic('check')}Resuelto</button>`
      : `<span class="badge b-ok">Resuelto hoy</span><button class="hbtn mini" ${on('vResolver', tipo, x.id)} aria-label="Deshacer">${ic('x')}</button>`;
    return `${pens.map(p => h(esc(p.texto), `Pendiente del ${fmtFecha(p.fecha)}`, btn('p', p))).join('')}
      ${segs.map(o => h(esc(o.texto || o.desvio || 'Desvío'), `Desvío N° ${o.n || '–'} · ${fmtFecha(o.fecha)}${o.prioridad ? ' · ' + o.prioridad : ''}`, btn('s', o))).join('')}
      ${propios.map(p => h(esc(p.texto), 'Nuevo en esta visita', `<button class="hbtn mini" ${on('vQuitarPend', p.id)} aria-label="Quitar">${ic('basura')}</button>`)).join('')}
      ${legs.map(p => { const [eid, cod, sub] = (p.legajoId || '').split('|'); return h(esc(p.texto), `Desde el ${fmtFecha(p.fecha)} · se cierra al regularizar el legajo`, `<button class="btn sec small" ${on('abrirLegajoItemDe', eid, cod, sub || '')}>Ver legajo</button>`); }).join('')}
      ${!pens.length && !segs.length && !propios.length && !legs.length ? '<p class="sub" style="margin:0">No hay pendientes ni desvíos abiertos.</p>' : ''}
      ${lock ? '' : `<div class="addrow"><input id="v_pend" placeholder="Nuevo pendiente (ej.: entregar registro de EPP)" aria-label="Nuevo pendiente"><button class="btn sec small" ${on('vPendiente')}>${ic('plus')}</button></div>`}`;
  }
  const fotosVisitaHtml = (v, lock) => `<div class="photos">${v.fotos.map((f, i) => `<div class="photo"><img src="${f.data}" alt="">
      <textarea placeholder="Comentario" aria-label="Comentario de la foto" ${lock ? 'disabled' : oi('vFotoDesc', i)}>${esc(f.descripcion)}</textarea>
      ${lock ? '' : `<button class="btn ghost small block" style="margin-top:6px" ${on('vFotoQuitar', i)}>${ic('basura')}Quitar</button>`}</div>`).join('')}</div>
    ${lock ? '' : `<div class="photo-btns" style="margin-top:10px"><label class="btn sec">${ic('camara')}Cámara<input type="file" accept="image/*" capture="environment" hidden ${oc('vFoto')}></label>
      <label class="btn sec">${ic('imagen')}Galería<input type="file" accept="image/*" multiple hidden ${oc('vFoto')}></label></div>`}`;

  views.visita = {
    title: () => 'Visita',
    subtitle: () => S.vis ? cap(fechaLarga(S.vis.fecha)) + (S.vis.hora ? ' · ' + S.vis.hora + ' h' : '') : '',
    async html(){
      const d = await datos(), v = d.vis.find(x => x.id === S.vid);
      S.vis = v;
      if (!v) return vacio('calendario', 'Esta visita ya no existe.');
      $('#subtitle').textContent = this.subtitle(); $('#subtitle').hidden = false;
      const s = estabDe(d, v), e = empresaDe(d, s), lock = bloqueada(v), plan = v.estado === 'planificada', cerr = v.estado === 'cumplida' || v.estado === 'parcial';
      const al = alertasClima(v, s), cl = climaDia(s, v.fecha), toca = s && tocaRelevar(s, d), h = horasVisita(v);
      const rels = d.rels.filter(r => (v.relIds || []).includes(r.id));
      const tel = (e?.contactos || []).some(c => c.telefono), dis = lock || !(plan || cerr) ? 'disabled' : '';
      const tareasEditables = !lock && (plan || cerr);
      return `<div class="card rowcard" style="cursor:default">${e ? avatar(e) : ''}
          <div><b>${esc(e?.razonSocial || '—')}</b><div class="sub">${esc([s?.nombre, s?.domicilio, s?.localidad].filter(Boolean).join(' · '))}</div></div>${badgeEstado(v)}</div>
        <div class="stack" style="margin-top:12px">
        ${lock ? aviso('aviso', 'info', `Semana cerrada: el resumen ya se emitió (${fmtFecha(SEMANAS[lunesDe(v.fecha)].fechaEnvio)}). Para modificar la visita, reabrí la semana en Informes › Visitas.`) : ''}
        ${v.estado === 'reprogramada' ? aviso('aviso', 'calendario', `Reprogramada. Motivo: <b>${esc(v.motivo)}</b>. <a class="link" ${on('abrirVisita', v.reprogramadaA)}>Ver la nueva visita</a>`) : ''}
        ${v.estado === 'cancelada' ? aviso('error', 'x', `Cancelada. Motivo: <b>${esc(v.motivo)}</b>`) : ''}
        ${v.historial?.length ? `<p class="sub" style="margin:0">${v.historial.map(x => `Movida del ${fmtFecha(x.de)} al ${fmtFecha(x.a)} (${esc(x.motivo)})`).join('<br>')}</p>` : ''}
        ${plan && cl ? `<div class="card clima">${textoClima(cl)}${s?.lat == null ? '<div class="sub">Pronóstico de Rosario: cargá la ubicación del establecimiento para afinarlo.</div>' : ''}</div>` : ''}
        ${al.map(a => aviso('aviso', 'lluvia', `<b>Alerta de clima.</b> ${esc(a)}. <a class="link" ${on('diasBuenos', v.id)}>Ver días con buen pronóstico</a>`)).join('')}
        ${v.notas ? aviso('okbox', 'info', esc(v.notas)) : ''}
        <div class="actions">${plan && tel ? `<button class="btn sec small" ${on('whatsappVisita', v.id)}>${ic('chat')}Confirmar por WhatsApp</button>` : ''}
          ${s?.lat != null ? `<a class="btn sec small" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">${ic('ubicacion')}Cómo llegar</a>` : ''}
          ${plan && !lock ? `<button class="btn ghost small" ${on('editarVisita')}>Editar</button>` : ''}</div>
        </div>

        <h3>Horario</h3>
        <div class="card"><div class="row">
          <div class="fld"><label for="v_ini">Ingreso</label><input id="v_ini" type="time" value="${v.inicio}" ${dis} ${oc('vHora', 'inicio')}></div>
          <div class="fld"><label for="v_fin">Egreso</label><input id="v_fin" type="time" value="${v.fin}" ${dis} ${oc('vHora', 'fin')}></div></div>
          ${dis ? '' : v.fecha < hoy() ? (!v.inicio || !v.fin ? '<p class="hint">Visita de una fecha pasada: cargá a mano la hora de ingreso y de egreso.</p>' : '') : `<div class="actions" style="margin-top:12px">${!v.inicio ? `<button class="btn" ${on('vMarcar', 'inicio')}>${ic('reloj')}Empezar</button>` : !v.fin ? `<button class="btn" ${on('vMarcar', 'fin')}>${ic('reloj')}Terminar</button>` : ''}</div>`}
          ${h ? `<p class="sub" style="margin:10px 0 0">Tiempo en planta: <b>${fmtHoras(h)}</b></p>` : ''}</div>

        <h3>Tareas</h3>
        <div class="card"><div class="list" id="v_tareas">${v.tareas.map((t, i) => `<div class="el tarea">
            <button class="check ${t.hecha ? 'on' : ''}" ${tareasEditables ? on('vTarea', i) : 'disabled'} aria-label="Marcar ${esc(t.nombre)}">${ic('check')}</button>
            <div><b>${esc(t.nombre)}</b><div class="sub">${t.prevista ? 'Planificada' : 'No prevista'}${actividad(t.actividadId)?.clima ? ' · sensible al clima' : ''}</div></div>
            ${!t.prevista && tareasEditables ? `<button class="hbtn mini" ${on('vQuitarTarea', i)} aria-label="Quitar">${ic('basura')}</button>` : ''}</div>`).join('') || '<p class="sub" style="margin:0">Sin tareas planificadas.</p>'}</div>
          ${tareasEditables ? `<div class="addrow"><select id="v_nueva" aria-label="Tarea no prevista"><option value="">Sumar tarea no prevista…</option>${ACTIVIDADES.lista.filter(a => a.activa).map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}<option value="otra">Otra (escribirla)</option></select>
            <button class="btn sec small" ${on('vAgregarTarea')}>${ic('plus')}</button></div>` : ''}</div>

        <h3>Relevamientos</h3>
        <div class="stack">${toca ? `<div class="auto" style="margin:0">${ic('info')}<div>${toca}</div></div>` : ''}
          ${rels.length ? `<div class="card fold-list">${rels.map(r => filaRelevHtml(r, s)).join('')}</div>` : ''}
          ${tareasEditables ? `<button class="btn sec block" ${on('vRelevar')}>${ic('lista')}Iniciar relevamiento</button>` : ''}</div>

        <h3>Revisión de legajo</h3>
        <div class="card rowcard" ${on('legRevisarVisita')}><div class="tile t-menta">${ic('carpeta')}</div>
          <div><b>Legajo técnico</b><div class="sub">${s ? (await AG.legajoRefrescar(), esc(AG.legajoResumen(s).txt)) : ''} · opcional</div></div>${ic('chev', 'chev')}</div>

        <h3>Pendientes y desvíos</h3>
        <div class="card">${pendientesHtml(d, v, lock || !(plan || cerr))}</div>

        <h3>Observaciones</h3>
        <div class="card"><textarea id="v_obs" rows="5" placeholder="Lo que viste, lo que hablaste con el cliente…" ${dis} ${oi('vObs')}>${esc(v.observaciones)}</textarea>
          ${dis ? '' : `<div class="actions" style="margin-top:10px"><button class="btn sec small" id="v_mic" ${on('vDictar')}>${ic('mic')}Dictar</button></div>`}</div>

        <h3>Fotos</h3>
        <div class="card" id="v_fotos">${v.fotos.length || !dis ? fotosVisitaHtml(v, !!dis) : '<p class="sub" style="margin:0">Sin fotos.</p>'}
          ${fotoObligatoria(s) && !dis ? '<p class="hint">Este cliente pide al menos una foto para cerrar la visita.</p>' : ''}</div>

        ${cerr ? `<h3>Constancia</h3>
        <div class="card">
          ${v.constancia ? `<div class="el"><div class="tile t-menta">${ic('doc')}</div><div><b>${esc(v.constancia.nombre)}</b><div class="sub">Generada por la app</div></div></div>
            <div class="actions" style="margin-top:10px"><button class="btn sec small" ${on('vArchivo', 'constancia', 'descargar')}>${ic('descarga')}Descargar</button><button class="btn sec small" ${on('vArchivo', 'constancia', 'compartir')}>${ic('compartir')}Compartir</button>
            ${lock ? '' : `<button class="btn ghost small" ${on('vRegenerar')}>Regenerar</button>`}</div>` : ''}
          ${v.planilla ? `<div class="el" style="margin-top:10px"><img class="miniplanilla" src="${v.planilla.vista}" alt="Planilla escaneada"><div><b>Planilla firmada</b><div class="sub">${esc(v.planilla.nombre)}</div></div></div>
            <div class="actions" style="margin-top:10px"><button class="btn sec small" ${on('vArchivo', 'planilla', 'descargar')}>${ic('descarga')}Descargar</button><button class="btn sec small" ${on('vArchivo', 'planilla', 'compartir')}>${ic('compartir')}Compartir</button></div>` : ''}
          ${lock ? '' : `<label class="btn sec block" style="margin-top:12px">${ic('camara')}${v.planilla ? 'Volver a escanear' : 'Escanear planilla firmada en papel'}<input type="file" accept="image/*" capture="environment" hidden ${oc('vEscanear')}></label>
            <p class="hint">La app detecta la hoja, la endereza como un escáner y la guarda en PDF con el mismo nombre de la constancia.</p>`}
        </div>` : ''}

        ${lock || v.estado === 'reprogramada' ? '' : `<div class="bottom-bar"><div class="actions">${plan
          ? `<button class="btn ghost" ${on('vCancelar')}>Cancelar visita</button><button class="btn hazard" ${on('vCerrar')}>${ic('check')}Cerrar visita</button>`
          : `<button class="btn ghost" ${on('vReabrir')}>Reabrir visita</button>`}</div></div>`}`;
    }
  };
  acciones.vMarcar = async (t, campo) => { if (!(await editable())) return; S.vis[campo] = ahoraHM(); await guardarV(true); render(); };
  acciones.vHora = async (t, campo) => { if (!(await editable())) return; S.vis[campo] = t.value; await guardarV(true); render(); };
  acciones.vTarea = async (t, i) => { if (!(await editable())) return; S.vis.tareas[i].hecha = !S.vis.tareas[i].hecha; await guardarV(true); t.classList.toggle('on', S.vis.tareas[i].hecha); };
  acciones.vQuitarTarea = async (t, i) => { if (!(await editable())) return; S.vis.tareas.splice(i, 1); await guardarV(true); render(); };
  acciones.vAgregarTarea = async () => {
    if (!(await editable())) return;
    const id = $('#v_nueva').value;
    if (!id) return avisar('Elegí la tarea en la lista.');
    let nombre = actividad(id)?.nombre;
    if (id === 'otra') {
      nombre = await pedirMotivo('¿Qué tarea hiciste?', ['Recorrida general', 'Charla con el encargado', 'Revisión de documentación']);
      if (!nombre) return;
    }
    S.vis.tareas.push({id: uid(), actividadId: id === 'otra' ? '' : id, nombre, hecha: true, prevista: false});
    await guardarV(true);
    render();
  };
  acciones.vRelevar = async () => {
    if (!(await editable())) return;
    const s = await getOne('establecimientos', S.vis.estabId);
    S.estab = s; S.empresa = await getOne('empresas', s.empresaId);
    S.visitaId = S.vis.id;
    setModo(false); S.verOtros = false;
    go('categorias');
  };
  // Al crear un relevamiento desde una visita: queda vinculado y la tarea "Relevamiento" se marca hecha
  async function vincularRelev(r){
    if (!S.visitaId) return;
    const v = await getOne('visitas', S.visitaId);
    if (!v || v.estabId !== r.establecimientoId) return;
    v.relIds = [...new Set([...(v.relIds || []), r.id])];
    const t = v.tareas.find(t => /^relevamiento/i.test(t.nombre));
    if (t) t.hecha = true; else v.tareas.push({id: uid(), actividadId: 'act0', nombre: 'Relevamiento', hecha: true, prevista: false});
    await put('visitas', v);
  }
  acciones.vPendiente = async () => {
    if (!(await editable())) return;
    const txt = $('#v_pend').value.trim();
    if (!txt) return avisar('Escribí el pendiente.');
    await put('pendientes', {id: uid(), estabId: S.vis.estabId, texto: txt, fecha: S.vis.fecha, visitaId: S.vis.id, estado: 'Abierto'});
    render();
  };
  acciones.vQuitarPend = async (t, id) => { if (!(await editable())) return; await del('pendientes', id); render(); };
  acciones.vResolver = async (t, tipo, id) => {
    if (!(await editable())) return;
    const store = tipo === 'p' ? 'pendientes' : 'seguimiento', x = await getOne(store, id);
    if (x.estado === 'Abierto') Object.assign(x, {estado: 'Cerrado', fechaCierre: S.vis.fecha, cierreVisitaId: S.vis.id, cierre: `Verificado en la visita del ${fmtFecha(S.vis.fecha)}`});
    else { x.estado = 'Abierto'; delete x.fechaCierre; delete x.cierreVisitaId; delete x.cierre; }
    await put(store, x);
    render();
  };
  acciones.vObs = t => { S.vis.observaciones = t.value; guardarV(); };
  // Dictado por voz del navegador (Chrome en Android lo trae; en iPhone, Safari)
  let reco = null;
  acciones.vDictar = async () => {
    if (!(await editable())) return;
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return avisar('Este navegador no permite dictar. En el celular usá el micrófono del teclado.');
    if (reco) { reco.stop(); return; }
    reco = new R();
    Object.assign(reco, {lang: 'es-AR', continuous: true, interimResults: false});
    const base = () => { const ta = $('#v_obs'); return ta ? ta.value.replace(/\s+$/, '') : ''; };
    reco.onresult = ev => {
      const ta = $('#v_obs');
      if (!ta) return;
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) {
        const txt = ev.results[i][0].transcript.trim();
        ta.value = base() + (base() ? ' ' : '') + txt.charAt(0).toUpperCase() + txt.slice(1) + '.';
      }
      S.vis.observaciones = ta.value; guardarV();
    };
    reco.onend = () => { reco = null; const b = $('#v_mic'); if (b) { b.innerHTML = ic('mic') + 'Dictar'; b.classList.remove('grabando'); } };
    reco.onerror = e => { if (e.error === 'not-allowed') avisar('Hay que permitir el micrófono para dictar.'); };
    reco.start();
    const b = $('#v_mic'); b.innerHTML = ic('stop') + 'Detener dictado'; b.classList.add('grabando');
  };
  acciones.vFoto = async t => {
    if (!(await editable())) return;
    const files = [...(t.files || [])];
    t.value = '';
    try { for (const f of files) { const img = await resizeImg(f, 1280); S.vis.fotos.push({id: uid(), ...img, descripcion: ''}); } }
    catch (e) { return avisar(e.message); }
    await guardarV(true);
    $('#v_fotos').innerHTML = fotosVisitaHtml(S.vis, false);
  };
  acciones.vFotoDesc = (t, i) => { S.vis.fotos[i].descripcion = t.value; guardarV(); };
  acciones.vFotoQuitar = async (t, i) => {
    if (!(await editable()) || !(await confirmar('¿Quitar esta foto?', 'Quitar'))) return;
    S.vis.fotos.splice(i, 1);
    await guardarV(true);
    $('#v_fotos').innerHTML = fotosVisitaHtml(S.vis, false);
  };
  acciones.vCancelar = async () => {
    if (!(await editable())) return;
    const motivo = await pedirMotivo('¿Por qué se cancela la visita?', ['Clima', 'Pedido del cliente', 'Planta cerrada', 'Enfermedad', 'Superposición de agenda']);
    if (!motivo) return;
    Object.assign(S.vis, {estado: 'cancelada', motivo});
    await guardarV(true);
    toast('Visita cancelada');
    render();
  };
  acciones.vCerrar = async () => {
    if (!(await editable())) return;
    const v = S.vis, s = await getOne('establecimientos', v.estabId);
    if (v.fecha > hoy() && !(await confirmar('La visita es de una fecha futura. ¿La cerrás igual?', 'Cerrar igual'))) return;
    const faltan = v.tareas.filter(t => !t.hecha);
    const estado = await menu(`¿Cómo resultó la visita?${faltan.length ? `\n\nTareas sin marcar: ${faltan.map(t => t.nombre).join(', ')}.` : ''}`, [
      {txt: 'Cumplida', icono: 'ok', valor: 'cumplida'}, {txt: 'Parcial (quedaron cosas sin hacer)', icono: 'minus', valor: 'parcial'}]);
    if (!estado) return;
    if (fotoObligatoria(s) && !v.fotos.length) return avisar('Para cerrar la visita de este cliente hace falta al menos una foto. Sacala en la sección Fotos.');
    if (!v.inicio && !(await confirmar('No cargaste la hora de ingreso y egreso: la visita va a sumar 0 horas. ¿Cerrar igual?', 'Cerrar igual'))) return;
    if (v.inicio && !v.fin) v.fin = v.fecha === hoy() ? ahoraHM() : v.inicio;
    Object.assign(v, {estado, motivo: '', cerradaEn: Date.now()});
    // Legajo: cada tarea hecha renueva el requisito vinculado (PAT, iluminación, RAR…); después se adjunta el protocolo
    const renovados = await AG.legajoDesdeVisita(v, s);
    if (renovados.length) toast(`Legajo actualizado: ${renovados.join(', ')}. Adjuntá el protocolo cuando lo tengas.`);
    toast('Generando la constancia…');
    try { v.constancia = await AG.constanciaPdf(v); } catch (e) { console.error(e); await avisar('La visita se cerró, pero no se pudo generar la constancia: ' + e.message + '. Podés regenerarla después.'); }
    await guardarV(true);
    render();
    if (v.constancia) {
      const r = await menu('Visita cerrada. ¿Qué hacés con la constancia?', [{txt: 'Compartir (WhatsApp, mail…)', icono: 'compartir', valor: 'compartir'}, {txt: 'Descargar', icono: 'descarga', valor: 'descargar'}]);
      if (r) acciones.vArchivo(null, 'constancia', r);
    }
  };
  acciones.vRegenerar = async () => {
    if (!(await editable())) return;
    toast('Generando la constancia…');
    S.vis.constancia = await AG.constanciaPdf(S.vis);
    await guardarV(true);
    render();
  };
  acciones.vReabrir = async () => {
    if (!(await editable())) return;
    if (!(await confirmar('¿Reabrir la visita? Vuelve a "planificada" y al cerrarla se genera de nuevo la constancia.', 'Reabrir'))) return;
    Object.assign(S.vis, {estado: 'planificada', motivo: ''});
    await guardarV(true);
    render();
  };
  acciones.vArchivo = async (t, cual, modo) => { const x = S.vis[cual]; if (x) entregar(modo, x.nombre, await aBlob(x.data)); };
  acciones.vEscanear = async t => {
    const f = t.files?.[0];
    t.value = '';
    if (!f || !(await editable())) return;
    toast('Escaneando la planilla… (la primera vez tarda porque descarga el escáner)');
    try {
      const d = await datos(), e = empresaDe(d, estabDe(d, S.vis));
      S.vis.planilla = await AG.escanearPlanilla(f, AG.nombreConstancia(e, S.vis));
      await guardarV(true);
      toast('Planilla guardada en PDF');
      render();
    } catch (e) { console.error(e); avisar('No se pudo escanear la planilla: ' + e.message); }
  };

  // ===== Historial del establecimiento: visitas, relevamientos, desvíos y pendientes por fecha =====
  views.historial = {
    title: () => 'Historial',
    subtitle: () => S.estab.nombre,
    async html(){
      const d = await datos(), s = S.estab, items = [];
      for (const v of d.vis.filter(v => v.estabId === s.id && v.fecha <= sumarDias(hoy(), 60)))
        items.push({f: v.fecha, html: `<div class="el" ${on('abrirVisita', v.id)}><div class="tile t-menta chico">${ic('calendario')}</div><div><b>Visita</b> ${badgeEstado(v)}
          <div class="sub">${esc([v.tareas.filter(t => t.hecha).map(t => t.nombre).join(', '), v.motivo && 'Motivo: ' + v.motivo, horasVisita(v) && fmtHoras(horasVisita(v)),
            v.fotos.length && plural(v.fotos.length, 'foto', 'fotos'), v.constancia && 'constancia', v.planilla && 'planilla firmada'].filter(Boolean).join(' · '))}</div>
          ${v.observaciones ? `<div class="sub obs">${esc(v.observaciones.slice(0, 160))}${v.observaciones.length > 160 ? '…' : ''}</div>` : ''}</div></div>`});
      for (const r of d.rels.filter(r => r.establecimientoId === s.id)) items.push({f: r.fecha_relevamiento, html: filaRelevHtml(r, null)});
      for (const o of d.seg.filter(o => o.establecimientoId === s.id)) {
        items.push({f: o.fecha, html: `<div class="el"><div class="tile t-rojo chico">${ic('alerta')}</div><div><b>Desvío N° ${o.n || '–'}</b> <span class="badge ${o.estado === 'Abierto' ? 'b-bad' : 'b-ok'}">${o.estado}</span><div class="sub">${esc(o.texto || '')}</div></div></div>`});
      }
      for (const p of d.pen.filter(p => p.estabId === s.id))
        items.push({f: p.fecha, html: `<div class="el"><div class="tile t-amarillo chico">${ic('lista')}</div><div><b>Pendiente</b> <span class="badge ${p.estado === 'Abierto' ? 'b-mid' : 'b-ok'}">${p.estado === 'Abierto' ? 'Abierto' : 'Resuelto ' + fmtFecha(p.fechaCierre)}</span><div class="sub">${esc(p.texto)}</div></div></div>`});
      items.sort((a, b) => b.f.localeCompare(a.f));
      let mes = '';
      return items.map(x => { const m = x.f.slice(0, 7), cab = m !== mes ? `<h3>${MESES[+m.slice(5) - 1]} ${m.slice(0, 4)}</h3>` : ''; mes = m; return cab + `<div class="card fold-list hist"><div class="sub fecha">${fmtFecha(x.f)}</div>${x.html}</div>`; }).join('')
        || vacio('reloj', 'Todavía no hay movimientos para este establecimiento.');
    }
  };
  prev.historial = 'estab';

  // ===== Buscador general =====
  views.buscar = {
    title: () => 'Buscar',
    html: () => `<div class="search">${ic('search')}<input id="bq" placeholder="Cliente, tarea, pendiente, desvío…" value="${esc(S.bq || '')}" ${oi('buscarTodo')}></div>
      <div id="bres" style="margin-top:12px"></div>`,
    async despues(){ $('#bq')?.focus(); if (S.bq) $('#bres').innerHTML = await resultados(S.bq); }
  };
  prev.buscar = () => S.buscarVolver || 'empresas';
  acciones.buscarTodo = async t => { S.bq = t.value; const q = t.value; const html = await resultados(q); if (S.bq === q && $('#bres')) $('#bres').innerHTML = html; };
  async function resultados(q){
    q = sinAcentos(q.trim());
    if (q.length < 2) return '<p class="sub">Escribí al menos 2 letras.</p>';
    const d = await datos(), has = (...t) => sinAcentos(t.filter(Boolean).join(' ')).includes(q), grupo = (t, filas) => filas.length ? `<h3>${t}</h3><div class="card fold-list">${filas.slice(0, 20).join('')}</div>` : '';
    const fila = (accion, icono, color, titulo, sub) => `<div class="el" ${on(...accion)}><div class="tile t-${color} chico">${ic(icono)}</div><div><b>${titulo}</b><div class="sub">${sub}</div></div>${ic('chev', 'chev')}</div>`;
    const emp = d.emp.filter(e => has(e.razonSocial, e.cuit, e.art, ...(e.contactos || []).map(c => c.nombre))).map(e => fila(['elegirEmpresa', e.id], 'edificio', 'menta', esc(e.razonSocial), esc(e.cuit || '')));
    const est = d.est.filter(s => has(s.nombre, s.domicilio, s.localidad)).map(s => fila(['abrirEstab', s.id], 'ubicacion', 'verde', esc(s.nombre), esc(empresaDe(d, s)?.razonSocial || '')));
    const vis = d.vis.filter(v => { const s = estabDe(d, v); return has(cliente(d, s), v.observaciones, v.notas, v.motivo, ...v.tareas.map(t => t.nombre)); }).sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map(v => fila(['abrirVisita', v.id], 'calendario', 'menta', `${esc(cliente(d, estabDe(d, v)))}`, `${fmtFecha(v.fecha)} · ${ESTADOS[v.estado][0]} · ${esc(v.tareas.map(t => t.nombre).join(', '))}`));
    const pen = d.pen.filter(p => has(p.texto)).map(p => fila(['abrirEstab', p.estabId], 'lista', 'amarillo', esc(p.texto), `${esc(cliente(d, d.est.find(s => s.id === p.estabId)))} · ${p.estado === 'Abierto' ? 'abierto' : 'resuelto'}`));
    const seg = d.seg.filter(o => has(o.texto, o.accion, o.sector)).map(o => fila(['abrirSeguimiento', o.establecimientoId], 'alerta', 'rojo', esc(o.texto || 'Desvío'), `${esc(cliente(d, d.est.find(s => s.id === o.establecimientoId)))} · ${o.estado}`));
    return (grupo('Clientes', emp) + grupo('Establecimientos', est) + grupo('Visitas y tareas', vis) + grupo('Pendientes', pen) + grupo('Desvíos', seg)) || vacio('search', 'Sin resultados.');
  }
  acciones.abrirEstab = async (t, id) => { S.estab = await getOne('establecimientos', id); S.empresa = await getOne('empresas', S.estab.empresaId); S.visitaId = null; setModo(false); go('estab'); };
  acciones.abrirSeguimiento = async (t, id) => { await acciones.abrirEstab(t, id); go('seguimiento'); };
  acciones.buscar = () => { S.buscarVolver = S.view; go('buscar'); };

  // ===== Inicio: próxima visita, visitas de hoy, resumen del día y sugerencias =====
  async function inicioPartes(){
    const d = await datos(), h = hoy();
    actualizarClima(d.est).then(ok => ok && S.view === 'empresas' && render());
    const vs = d.vis.filter(v => v.fecha === h && v.estado !== 'reprogramada').sort(porHora), sug = sugerencias(d);
    const cerradas = vs.filter(v => v.estado !== 'planificada');
    let resumen = '';
    if (vs.length && (cerradas.length === vs.length || new Date().getHours() >= 18)) {
      const horas = vs.reduce((t, v) => t + horasVisita(v), 0), tareas = vs.reduce((t, v) => t + v.tareas.filter(x => x.hecha).length, 0);
      const pend = d.pen.filter(p => p.fecha === h && p.visitaId).length, res = d.pen.filter(p => p.fechaCierre === h).length + d.seg.filter(o => o.fechaCierre === h).length;
      const rels = d.rels.filter(r => r.fecha_relevamiento === h).length;
      S.resumenTxt = `Resumen del ${fmtFecha(h)}: ${cerradas.length} de ${plural(vs.length, 'visita cerrada', 'visitas cerradas')}, ${fmtHoras(horas)} en planta, ${plural(tareas, 'tarea hecha', 'tareas hechas')}, ${plural(rels, 'relevamiento', 'relevamientos')}, ${plural(pend, 'pendiente nuevo', 'pendientes nuevos')} y ${plural(res, 'pendiente o desvío resuelto', 'pendientes o desvíos resueltos')}.`;
      resumen = `<div class="card resumen"><b>${ic('ok')} Resumen del día</b><p style="margin:8px 0">${esc(S.resumenTxt.replace(/^Resumen del [^:]+: /, ''))}</p>
        <button class="btn sec small" ${on('compartirResumen')}>${ic('compartir')}Compartir</button></div>`;
    }
    // Próxima visita planificada (hoy o más adelante) y el resto de las de hoy
    const prox = d.vis.filter(v => v.estado === 'planificada' && v.fecha >= h).sort(porHora)[0];
    const otrasHoy = vs.filter(v => v !== prox);
    let proxima;
    if (prox) {
      const s = estabDe(d, prox), e = empresaDe(d, s), c = climaDia(s, prox.fecha), al = alertasClima(prox, s);
      const cuando = prox.fecha === h ? 'Hoy' : prox.fecha === sumarDias(h, 1) ? 'Mañana' : cap(fechaLarga(prox.fecha));
      proxima = `<div class="card proxima"><div class="sub">Próxima visita</div>
        <div class="between" style="margin-top:6px" ${on('abrirVisita', prox.id)}><div><div class="hora-grande num">${esc(prox.hora || 'Sin hora')}</div><div class="sub">${cuando}</div></div>${badgeEstado(prox)}</div>
        <div style="margin-top:10px" ${on('abrirVisita', prox.id)}><b style="font-size:17px">${esc(e?.razonSocial || '—')}</b><div class="sub">${esc([s?.nombre, s?.domicilio].filter(Boolean).join(' · '))}</div>
          ${prox.tareas.length ? `<div class="sub">${esc(prox.tareas.map(t => t.nombre).join(', '))}</div>` : ''}
          ${c ? `<div class="sub" style="margin-top:4px">${textoClima(c)}</div>` : ''}</div>
        ${al.length ? `<div style="margin-top:10px">${aviso('aviso', 'lluvia', `<b>Alerta de clima.</b> ${esc(al[0])}`)}</div>` : ''}
        <div class="actions" style="margin-top:12px"><button class="btn small" ${on('abrirVisita', prox.id)}>Abrir visita</button><button class="btn sec small" ${on('irAgendaHoy')}>${ic('calendario')}Ver agenda</button></div>
        ${otrasHoy.length ? `<div style="margin-top:12px">${otrasHoy.map(v => { const s = estabDe(d, v), cc = v.estado === 'planificada' && climaDia(s, h), a = alertasClima(v, s).length;
          return `<div class="el" ${on('abrirVisita', v.id)}><span class="hora num">${esc(v.hora || '—')}</span><div><b>${esc(cliente(d, s))}</b><div class="sub">Hoy · ${esc(v.tareas.map(t => t.nombre).join(', ') || 'Sin tareas')}</div></div>
            ${a ? `<span class="fer" aria-label="Alerta de clima">${ic('alerta')}</span>` : cc ? icClima(cc.code) : ''}${badgeEstado(v)}</div>`; }).join('')}</div>` : ''}</div>`;
    } else proxima = `<div class="card proxima"><div class="sub">Próxima visita</div><p style="margin:6px 0 12px">No tenés visitas agendadas${vs.length ? ' pendientes para hoy' : ''}.</p>
      ${vs.length ? vs.map(v => `<div class="el" ${on('abrirVisita', v.id)}><span class="hora num">${esc(v.hora || '—')}</span><div><b>${esc(cliente(d, estabDe(d, v)))}</b><div class="sub">Hoy</div></div>${badgeEstado(v)}</div>`).join('') : ''}
      <button class="btn sec small block" ${on('nuevaVisita')}>${ic('plus')}Agendar visita</button></div>`;
    return {visitasHoy: vs.length, proxima, resumen, asistente: sug.length ? sugerenciasHtml(sug, 4) : ''};
  }
  acciones.compartirResumen = async () => {
    if (navigator.share) { try { await navigator.share({text: S.resumenTxt}); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    window.open('https://wa.me/?text=' + encodeURIComponent(S.resumenTxt), '_blank', 'noopener');
  };
  acciones.activarAvisos = async () => {
    if (!window.Notification) return avisar('Este navegador no permite avisos. En iPhone, primero instalá la app en la pantalla de inicio.');
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Avisos activados en este dispositivo' : 'No se activaron los avisos');
    render();
  };

  // ===== Borrar todo lo de un establecimiento (al eliminar empresa o establecimiento) =====
  async function borrarDeEstab(id){
    for (const v of (await getAll('visitas')).filter(v => v.estabId === id)) await del('visitas', v.id);
    for (const p of (await getAll('pendientes')).filter(p => p.estabId === id)) await del('pendientes', p.id);
    await AG.legajoBorrarEstab(id);
  }

  let iniciado = false;
  async function init(){
    const [sem, fer, cli] = await Promise.all([getAll('semanas'), getOne('config', 'feriados'), getOne('config', 'clima')]);
    SEMANAS = {};
    sem.forEach(x => SEMANAS[x.id] = x);
    if (fer) { const {id, ...resto} = fer; FERIADOS = resto; }
    if (cli) CLIMA = {...CLIMA, ...cli};
    for (const [k, t] of Object.entries(CLIMA.avisadas)) if (Date.now() - t > 30 * 864e5) delete CLIMA.avisadas[k];
    if (iniciado) return;   // al restaurar una copia solo se recargan los datos
    iniciado = true;
    cargarFeriados(new Date().getFullYear());
    setTimeout(chequeo, 2500);
    setInterval(chequeo, 30 * 60e3);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && chequeo());
  }

  return {views, acciones, prev, init, inicioPartes, textoClima, textoPlano, icClima, climaDia, actualizarClima, sugerencias, pedirMotivo, vincularRelev, borrarDeEstab, lib, datos, cliente, empresaDe, estabDe, actividad, ESTADOS, sumarDias, lunesDe,
    fechaLarga, fechaCorta, cap, horasVisita, fmtHoras, porHora, flecha, badgeEstado, aBlob, aDataUrl, feriado, tocaRelevar, UMBRAL,
    semanas: () => SEMANAS, semanaCerrada};
})();
