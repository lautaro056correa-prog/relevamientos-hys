// Legajo técnico: catálogo de requisitos (config/legajo.json → editable en el dispositivo), ítems por establecimiento
// (store "legajo"), estados semáforo, aplicabilidad automática, revisión durante la visita con pendientes automáticos,
// panel general, avisos en la agenda y salidas (Excel, Word e índice PDF con carátulas).
// Se carga después de agenda.js / agenda-informes.js y antes de app.js; agrega sus pantallas y acciones a AG.
(() => {
  const {views, acciones, prev, lib, cap, fechaLarga} = AG;
  let CAT = null;   // {id: 'legajoCatalogo', version, umbral_dias, secciones, requisitos}

  // ===== Catálogo =====
  async function cargarCatalogo(){
    const semilla = await fetch('config/legajo.json', {cache: 'no-store'}).then(r => r.json()).catch(() => null);
    CAT = await getOne('config', 'legajoCatalogo');
    if (!CAT && semilla) CAT = {id: 'legajoCatalogo', ...semilla, requisitos: semilla.requisitos.map(r => ({activo: true, actividades: [], ...r}))};
    else if (CAT && semilla && semilla.version > (CAT.version || 0)) {
      // Versión nueva del catálogo: se suman los requisitos que falten, sin pisar lo que el usuario editó
      for (const r of semilla.requisitos) if (!CAT.requisitos.some(x => x.codigo === r.codigo)) CAT.requisitos.push({activo: true, actividades: [], ...r});
      CAT.version = semilla.version;
    }
    CAT ||= {id: 'legajoCatalogo', version: 0, umbral_dias: 60, secciones: [], requisitos: []};
    // Sin pasar por la cola: la semilla no debe pisar en la nube un catálogo que ya se editó en otro dispositivo
    await tx('config', 'readwrite', o => o.put(CAT));
  }
  const umbral = () => +CAT.umbral_dias || 60;
  const reqs = () => CAT.requisitos.filter(r => r.activo !== false);
  const req = cod => CAT.requisitos.find(r => r.codigo === cod);
  const secciones = () => [...new Set([...(CAT.secciones || []), ...reqs().map(r => r.seccion)])];

  // ===== Estados =====
  const EST = {vencido: ['Vencido', 'b-bad', 'alerta'], faltante: ['Faltante', 'b-bad', 'x'], porvencer: ['Por vencer', 'b-mid', 'reloj'], sinrevisar: ['Sin revisar', 'b-blanco', 'info'],
    tramite: ['En trámite', 'b-azul', 'reloj'], vigente: ['Vigente', 'b-ok', 'check'], noaplica: ['No aplica', 'b-na', 'minus']};
  const URGENCIA = ['vencido', 'faltante', 'porvencer', 'sinrevisar', 'tramite', 'vigente', 'noaplica'];
  const badge = (k, txt) => `<span class="badge ${EST[k][1]}">${ic(EST[k][2])}${txt || EST[k][0]}</span>`;
  const VIGENCIAS = {periodica: 'Periódica', anual: 'Anual (vence el 31/12)', fecha_fija: 'Fecha fija anual', documento: 'Según documento', evento: 'Por evento', revision: 'Revisión ante cambios', agrupador: 'Agrupador (solo título)'};
  function textoVigencia(r){
    const v = r.vigencia || {};
    return v.tipo === 'periodica' ? `Cada ${plural(+v.meses || 12, 'mes', 'meses')}` : v.tipo === 'fecha_fija' ? `Antes del ${v.dia}/${String(v.mes).padStart(2, '0')} de cada año`
      : v.tipo === 'revision' ? `Revisión ante cambios (recordatorio cada ${plural(+v.recordatorio_meses || 12, 'mes', 'meses')})` : VIGENCIAS[v.tipo] || '';
  }
  // Vencimiento según la regla (o el cargado a mano)
  function calcVenc(r, it){
    if (it.vencManual && it.vencimiento) return it.vencimiento;
    const v = r.vigencia || {}, e = it.emision;
    if (v.tipo === 'documento') return it.vencimiento || '';
    if (!e) return '';
    if (v.tipo === 'periodica') return sumarMeses(e, +v.meses || 12);
    if (v.tipo === 'anual') return `${e.slice(0, 4)}-12-31`;
    if (v.tipo === 'fecha_fija') return `${+e.slice(0, 4) + 1}-${String(v.mes).padStart(2, '0')}-${String(v.dia).padStart(2, '0')}`;
    if (v.tipo === 'revision') return sumarMeses(e, +v.recordatorio_meses || 12);
    return '';
  }
  // Aplicabilidad propuesta con los datos de la ficha: {aplica, dudoso (falta un dato), motivo}
  function propuesta(r, s, items){
    const a = r.aplica || {}, L = s.legajo || {}, motivos = [];
    let no = false, dudoso = false;
    const si = (cond, txt) => { if (cond === null || cond === undefined) dudoso = true; else if (!cond) { no = true; motivos.push(txt); } };
    if (a.provincia) si(s.provincia ? sinAcentos(s.provincia).includes(sinAcentos(a.provincia)) : null, `fuera de ${a.provincia}`);
    if (a.trabajadores_min) si(s.trabajadores ? +s.trabajadores >= a.trabajadores_min : null, `menos de ${a.trabajadores_min} trabajadores`);
    for (const [k, txt] of [['quimicos', 'no usa productos químicos'], ['residuos', 'no genera residuos peligrosos'], ['ruido', 'sin fuentes de ruido'],
      ['comedor', 'sin comedor ni cocina'], ['cancerigenos', 'el RAR no declara cancerígenos']]) if (a[k]) si(L[k] == null ? null : !!L[k], txt);
    if (a.no_obra && L.obra) { no = true; motivos.push('es obra (Dec. 911/96)'); }
    if (a.depende) { const p = req(a.depende); if (p) { const x = items?.[`${s.id}|${p.codigo}|`]; const ap = x?.aplica ?? propuesta(p, s, items).aplica; if (!ap) { no = true; motivos.push(`no aplica ${p.codigo}`); } } }
    return {aplica: !no, dudoso: !no && dudoso, motivo: motivos.join(', ')};
  }
  function estado(r, it, s, items){
    const ap = it.aplica ?? propuesta(r, s, items).aplica;
    if (!ap) return 'noaplica';
    if (it.manual === 'tramite') return 'tramite';
    if (it.manual === 'faltante') return 'faltante';
    if (it.manual === 'vencido' || it.manual === 'desactualizado') return 'vencido';
    const casos = it.casos || [], revisado = !!(it.revisiones?.length);
    if (r.casos === 'eventos') {
      const ab = casos.filter(c => c.estado !== 'Cerrado');
      if (ab.some(c => c.limite && c.limite < hoy())) return 'vencido';
      if (ab.length) return 'tramite';
      return revisado || casos.length ? 'vigente' : 'sinrevisar';
    }
    if (r.casos === 'productos') {
      if (!casos.length) return revisado ? 'faltante' : 'sinrevisar';
      const max = +r.vigencia?.antiguedad_max_meses || 60, dias = casos.map(c => c.fecha ? diasHasta(sumarMeses(c.fecha, max)) : -1);
      return Math.min(...dias) < 0 ? 'vencido' : Math.min(...dias) <= umbral() ? 'porvencer' : 'vigente';
    }
    const v = calcVenc(r, it);
    if (!it.emision && !v) return revisado ? 'faltante' : 'sinrevisar';
    if (!v) return 'vigente';
    const dd = diasHasta(v);
    if (dd < 0) return r.vigencia?.tipo === 'revision' ? 'porvencer' : 'vencido';
    return dd <= umbral() ? 'porvencer' : 'vigente';
  }
  const idItem = (s, cod, sub = '') => `${s.id}|${cod}|${sub}`;
  // Filas del legajo de un establecimiento: cada requisito activo (desdoblado por punto de suministro)
  function filas(s, guardados){
    const items = {};
    for (const x of guardados) if (x.estabId === s.id) items[x.id] = x;
    const out = [];
    for (const r of reqs()) {
      if (r.vigencia?.tipo === 'agrupador') continue;
      const subs = r.por === 'punto_agua' ? Array.from({length: Math.max(1, +s.legajo?.puntosAgua || 1)}, (_, i) => `Punto ${i + 1}`) : [''];
      for (const sub of subs) {
        const id = idItem(s, r.codigo, sub), it = items[id] || {id, estabId: s.id, codigo: r.codigo, sub, virtual: true};
        const est = estado(r, it, s, items), venc = r.casos === 'eventos' ? '' : calcVenc(r, it), prop = propuesta(r, s, items);
        out.push({r, it, est, venc, dias: venc ? diasHasta(venc) : null, prop, propuesto: it.aplica == null});
      }
    }
    return out;
  }
  function resumen(fs){
    const n = k => fs.filter(f => f.est === k).length, aplicables = fs.filter(f => f.est !== 'noaplica').length;
    const base = aplicables - n('tramite');
    return {n, aplicables, pct: base > 0 ? Math.round(n('vigente') * 100 / base) : 0, ultima: fs.flatMap(f => (f.it.revisiones || []).map(x => x.fecha)).sort().pop() || ''};
  }
  const CRITERIO = 'Cumplimiento = vigentes / (aplicables − en trámite). "Por vencer" todavía no cuenta como vigente.';
  const leerTodo = () => getAll('legajo');
  const nombreReq = f => `${f.r.codigo} · ${f.r.nombre}${f.it.sub ? ' – ' + f.it.sub : ''}`;
  const textoVenc = f => f.est === 'noaplica' ? (f.it.motivoNoAplica || f.prop.motivo || 'No aplica') : f.r.casos === 'eventos' ? `${plural((f.it.casos || []).filter(c => c.estado !== 'Cerrado').length, 'caso abierto', 'casos abiertos')}`
    : f.r.casos === 'productos' ? plural((f.it.casos || []).length, 'producto', 'productos')
    : f.venc ? (f.dias < 0 ? `${f.r.vigencia?.tipo === 'revision' ? 'Revisión pendiente desde' : 'Venció el'} ${fmtFecha(f.venc)}` : `Vence el ${fmtFecha(f.venc)} (${plural(f.dias, 'día', 'días')})`)
    : f.it.emision ? `Emitido el ${fmtFecha(f.it.emision)}` : 'Sin datos';

  // ===== Guardar un ítem: registra la revisión y sincroniza el pendiente =====
  async function guardarItem(it, accion){
    delete it.virtual;
    it.revisiones = [...(it.revisiones || []), {fecha: hoy(), visitaId: S.legVisita || null, accion}];
    it.mod = Date.now();
    await put('legajo', it);
    const s = await getOne('establecimientos', it.estabId);
    await sincronizarPendientes(s, filas(s, await leerTodo()).filter(f => f.it.id === it.id));
  }
  // Faltante o Vencido → pendiente del cliente (mismo circuito que los desvíos); se cierra solo al regularizarse
  async function sincronizarPendientes(s, fs){
    const pens = await getAll('pendientes');
    for (const f of fs) {
      if (f.it.virtual) continue;
      const id = 'leg|' + f.it.id, p = pens.find(x => x.id === id), malo = f.est === 'faltante' || f.est === 'vencido';
      if (malo && (!p || p.estado === 'Cerrado'))
        await put('pendientes', {id, estabId: s.id, texto: `Legajo: ${nombreReq(f)} (${EST[f.est][0].toLowerCase()})`, fecha: hoy(), visitaId: S.legVisita || null, origen: 'legajo', legajoId: f.it.id, estado: 'Abierto'});
      else if (!malo && p?.estado === 'Abierto') await put('pendientes', {...p, estado: 'Cerrado', fechaCierre: hoy(), cierre: 'Legajo regularizado'});
    }
  }
  // Los vencimientos por fecha aparecen solos: se revisan al abrir la app
  async function sincronizarTodo(){
    const [ests, todos] = await Promise.all([getAll('establecimientos'), leerTodo()]);
    for (const s of ests) await sincronizarPendientes(s, filas(s, todos));
  }

  // ===== Pantalla: legajo de un establecimiento =====
  const FILTROS = [['todos', 'Todos'], ['urgentes', 'A resolver'], ['vigente', 'Vigentes'], ['noaplica', 'No aplica']];
  function filaHtml(f, accion = 'abrirLegItem'){
    return `<div class="el" ${on(accion, f.it.codigo, f.it.sub || '')}>
      <div><b>${esc(nombreReq(f))}</b>${f.r.a_confirmar ? ' <span class="badge b-mid">a confirmar</span>' : ''}${f.propuesto && f.est !== 'sinrevisar' ? ' <span class="badge b-blanco">propuesto</span>' : ''}
        <div class="sub">${esc(textoVenc(f))}${f.it.archivo ? ` · ${ic('clip')}adjunto` : ''}</div></div>${badge(f.est)}</div>`;
  }
  views.legajo = {
    title: () => 'Legajo técnico',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    async html(){
      const s = S.estab, fs = filas(s, await leerTodo()), R = resumen(fs), filtro = S.legFiltro || 'todos';
      sincronizarPendientes(s, fs);
      const L = s.legajo || {}, incompleto = ['quimicos', 'residuos', 'ruido', 'comedor'].some(k => L[k] == null) || !s.provincia || !s.trabajadores;
      const ver = fs.filter(f => filtro === 'todos' || (filtro === 'urgentes' ? ['vencido', 'faltante', 'porvencer', 'sinrevisar'].includes(f.est) : f.est === filtro));
      const k = (e, n) => `<div class="kpi ${EST[e][1]}"><b>${n}</b><span>${EST[e][0]}</span></div>`;
      return `<div class="card"><div class="between"><div><div class="sub">Cumplimiento del legajo</div><div style="font:700 34px/1.1 var(--display)">${R.pct}%</div></div>
          <div class="sub" style="text-align:right">${R.aplicables} aplicables<br>${R.ultima ? 'Última revisión ' + fmtFecha(R.ultima) : 'Sin revisar todavía'}</div></div>
          <div class="barra" style="margin-top:10px"><i style="width:${R.pct}%" class="${R.pct >= 80 ? 'ok' : R.pct >= 50 ? 'mid' : 'bad'}"></i></div>
          <p class="hint">${CRITERIO}</p>
          <div class="kpis" style="margin-top:12px">${URGENCIA.map(e => k(e, R.n(e))).join('')}</div></div>
        ${incompleto ? `<div style="margin-top:12px">${aviso('info', 'info', `Completá en los datos del establecimiento la provincia, los trabajadores y los datos para el legajo (químicos, residuos, ruido, agua, comedor): con eso la app propone qué requisitos aplican. <a class="link" ${on('editarEstab')}>Completar datos</a>`)}</div>` : ''}
        <div class="actions" style="margin-top:12px"><button class="btn" ${on('legRevisar')}>${ic('lista')}Revisar legajo</button>
          <button class="btn sec" ${on('legSalidas')}>${ic('descarga')}Exportar</button></div>
        <div class="chips" style="margin-top:16px">${FILTROS.map(([kk, t]) => `<button class="chip small ${filtro === kk ? 'on' : ''}" ${on('legFiltro', kk)}>${t}</button>`).join('')}</div>
        ${secciones().map(sec => { const xs = ver.filter(f => f.r.seccion === sec); const ag = reqs().find(r => r.seccion === sec && r.vigencia?.tipo === 'agrupador');
          return xs.length ? `<div class="secc"><h3>${ag ? esc(ag.codigo) + ' · ' : ''}${esc(sec)}</h3><div class="card fold-list">${xs.map(f => filaHtml(f)).join('')}</div></div>` : ''; }).join('')
          || `<div style="margin-top:16px">${vacio('ok', 'No hay ítems con ese filtro.')}</div>`}`;
    }
  };
  prev.legajo = () => S.legajoVolver && S.legajoVolver !== 'legajo' && S.legajoVolver !== 'legajoItem' ? S.legajoVolver : 'estab';
  acciones.legFiltro = (t, k) => { S.legFiltro = k; render(); };
  acciones.abrirLegajo = async (t, estabId) => {
    S.estab = await getOne('establecimientos', estabId); S.empresa = await getOne('empresas', S.estab.empresaId);
    S.legajoVolver = S.view; go('legajo');
  };

  // ===== Pantalla: un ítem del legajo =====
  acciones.abrirLegItem = async (t, cod, sub) => {
    const s = S.estab, todos = await leerTodo(), f = filas(s, todos).find(x => x.it.codigo === cod && (x.it.sub || '') === (sub || ''));
    if (!f) return;
    S.legItem = structuredClone(f.it); S.legItemVolver = S.view === 'legajoItem' ? S.legItemVolver : S.view;
    go('legajoItem');
  };
  prev.legajoItem = () => S.legItemVolver || 'legajo';
  views.legajoItem = {
    title: () => S.legItem.codigo + (S.legItem.sub ? ' · ' + S.legItem.sub : ''),
    subtitle: () => req(S.legItem.codigo)?.nombre || '',
    async html(){
      const s = S.estab, it = S.legItem, r = req(it.codigo), todos = await leerTodo(), items = Object.fromEntries(todos.map(x => [x.id, x]));
      const est = estado(r, it, s, items), prop = propuesta(r, s, items), ap = it.aplica ?? prop.aplica, venc = calcVenc(r, it), tipo = r.vigencia?.tipo;
      const manual = [['', 'Automático'], ['tramite', 'En trámite'], ['faltante', 'Faltante'], [tipo === 'revision' ? 'desactualizado' : 'vencido', tipo === 'revision' ? 'Desactualizado' : 'Vencido']];
      const casoNombre = {eventos: 'Casos (actuaciones o siniestros)', registros: 'Registros', productos: 'Productos y sus FDS'}[r.casos];
      return `<div class="card"><div class="between"><b style="font-size:17px">${esc(r.nombre)}${it.sub ? ' – ' + esc(it.sub) : ''}</b>${badge(est)}</div>
          <p class="sub" style="margin:8px 0 0">${esc(r.normativa)}<br>Vigencia: ${esc(textoVigencia(r))}${r.evidencia ? '<br>Evidencia: ' + esc(r.evidencia) : ''}${r.nota ? '<br>' + esc(r.nota) : ''}</p>
          ${r.a_confirmar ? `<div style="margin-top:10px">${aviso('aviso', 'alerta', 'La vigencia de este requisito es un criterio a confirmar.')}</div>` : ''}</div>
        <h3>¿Aplica a este establecimiento?</h3>
        <div class="card"><div class="seg"><button class="${ap ? 'on' : ''}" ${on('legCampo', 'aplica', true)}>Aplica</button><button class="${!ap ? 'on' : ''}" ${on('legCampo', 'aplica', false)}>No aplica</button></div>
          ${it.aplica == null ? `<p class="hint">Propuesto por la app${prop.dudoso ? ' (faltan datos en la ficha)' : ''}${prop.motivo ? ': ' + esc(prop.motivo) : ''}. Tocá una opción para confirmarlo.</p>` : ''}
          ${!ap ? `<label for="lg_motivo">Motivo</label><input id="lg_motivo" value="${esc(it.motivoNoAplica || prop.motivo || '')}" ${oi('legTexto', 'motivoNoAplica')}>` : ''}</div>
        ${ap ? `<h3>Estado y documento</h3>
        <div class="card">
          <label>Estado</label><div class="chips">${manual.map(([k, t]) => `<button class="chip small ${(it.manual || '') === k ? 'on' : ''}" ${on('legCampo', 'manual', k)}>${t}</button>`).join('')}</div>
          <p class="hint">"Automático" calcula el estado con las fechas. Usá los otros cuando lo sabés por otro medio.</p>
          ${r.casos !== 'eventos' && r.casos !== 'productos' ? `<div class="row"><div class="fld"><label for="lg_emi">Fecha de emisión o realización</label><input id="lg_emi" type="date" value="${it.emision || ''}" ${oc('legTexto', 'emision', true)}></div>
            <div class="fld"><label for="lg_ven">Vencimiento</label><input id="lg_ven" type="date" value="${venc || ''}" ${tipo !== 'documento' && !it.vencManual ? 'disabled' : ''} ${oc('legTexto', 'vencimiento', true)}></div></div>
            ${tipo !== 'documento' ? `<label class="check" style="margin-top:8px"><input type="checkbox" ${it.vencManual ? 'checked' : ''} ${oc('legVencManual')}> Cargar el vencimiento a mano</label>` : ''}` : ''}
          <label for="lg_int">Profesional o laboratorio interviniente</label><input id="lg_int" value="${esc(it.interviniente || '')}" ${oi('legTexto', 'interviniente')}>
          <label>Documento</label>
          ${it.archivo ? `<div class="el" style="border-top:0"><div class="tile t-menta chico">${ic('doc')}</div><div><b>${esc(it.archivo.nombre)}</b><div class="sub">Cargado el ${fmtFecha(it.archivo.fecha)}</div></div>
            <button class="hbtn mini" ${on('legVerArchivo', -1)} aria-label="Descargar documento">${ic('descarga')}</button></div>` : '<p class="sub" style="margin:0 0 8px">Sin documento adjunto.</p>'}
          <div class="photo-btns"><label class="btn sec">${ic('camara')}Foto<input type="file" accept="image/*" capture="environment" hidden ${oc('legArchivo')}></label>
            <label class="btn sec">${ic('clip')}PDF o imagen<input type="file" accept="application/pdf,image/*" hidden ${oc('legArchivo')}></label></div>
          ${it.emision || it.archivo ? `<button class="btn ghost block" style="margin-top:10px" ${on('legRenovar')}>Cargar una versión nueva (la actual pasa al historial)</button>` : ''}
          <label for="lg_obs">Observaciones</label><textarea id="lg_obs" ${oi('legTexto', 'observaciones')}>${esc(it.observaciones || '')}</textarea>
        </div>
        ${r.casos ? `<h3>${casoNombre}</h3><div class="card">${(it.casos || []).map((c, i) => `<div class="el" style="cursor:default"><div><b>${esc(c.titulo || 'Sin título')}</b>
            <div class="sub">${fmtFecha(c.fecha)}${c.limite ? ' · plazo ' + fmtFecha(c.limite) : ''}${r.casos === 'productos' && c.fecha ? ` · FDS ${diasHasta(sumarMeses(c.fecha, +r.vigencia?.antiguedad_max_meses || 60)) < 0 ? 'con más de 5 años' : 'vigente'}` : ''}${c.archivo ? ' · adjunto' : ''}</div></div>
            ${r.casos === 'eventos' ? `<button class="btn ${c.estado === 'Cerrado' ? 'ghost' : 'sec'} small" ${on('legCasoEstado', i)}>${c.estado === 'Cerrado' ? 'Cerrado' : 'Cerrar'}</button>` : ''}
            ${c.archivo ? `<button class="hbtn mini" ${on('legVerArchivo', i)} aria-label="Descargar">${ic('descarga')}</button>` : ''}
            <button class="hbtn mini" ${on('legCasoQuitar', i)} aria-label="Quitar">${ic('basura')}</button></div>`).join('') || '<p class="sub" style="margin:0">Todavía no hay ninguno cargado.</p>'}
          <div class="row" style="margin-top:12px"><div class="fld"><label for="lc_tit">${r.casos === 'productos' ? 'Producto' : r.casos === 'eventos' ? 'Detalle' : 'Registro'}</label><input id="lc_tit"></div>
            <div class="fld"><label for="lc_fecha">${r.casos === 'productos' ? 'Fecha de la FDS' : 'Fecha'}</label><input id="lc_fecha" type="date" value="${hoy()}"></div></div>
          ${r.casos === 'eventos' ? '<label for="lc_lim">Plazo de respuesta o cierre</label><input id="lc_lim" type="date">' : ''}
          <label class="btn ghost block" style="margin-top:10px">${ic('clip')}Adjuntar al nuevo (opcional)<input id="lc_arch" type="file" accept="application/pdf,image/*" hidden ${oc('legCasoArchivo')}></label>
          <div class="hint" id="lc_archTxt"></div>
          <button class="btn sec block" style="margin-top:10px" ${on('legCasoAgregar')}>${ic('plus')}Agregar</button></div>` : ''}` : ''}
        ${(it.versiones || []).length ? `<h3>Versiones anteriores</h3><div class="card fold-list">${it.versiones.map((x, i) => `<div class="el" style="cursor:default"><div><b>Emitido ${fmtFecha(x.emision) || '–'}</b>
          <div class="sub">${x.vencimiento ? 'Vencía ' + fmtFecha(x.vencimiento) + ' · ' : ''}reemplazado el ${fmtFecha(x.reemplazado)}${x.interviniente ? ' · ' + esc(x.interviniente) : ''}</div></div>
          ${x.archivo ? `<button class="hbtn mini" ${on('legVerVersion', i)} aria-label="Descargar versión">${ic('descarga')}</button>` : ''}</div>`).join('')}</div>` : ''}
        ${(it.revisiones || []).length ? `<h3>Revisiones</h3><div class="card fold-list">${it.revisiones.slice().reverse().slice(0, 12).map(x => `<div class="el" style="cursor:default"><div><b>${fmtFecha(x.fecha)}</b> <span class="sub">${esc(x.accion)}${x.visitaId ? ' · en una visita' : ''}</span></div></div>`).join('')}</div>` : ''}
        <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('atras')}>Volver</button><button class="btn" ${on('legGuardar')}>${ic('check')}Guardar</button></div></div>`;
    }
  };
  acciones.legCampo = (t, campo, v) => { S.legItem[campo] = v; render(); };
  acciones.legTexto = (t, campo, redibujar) => { S.legItem[campo] = t.value; if (redibujar) render(); };
  acciones.legVencManual = t => { S.legItem.vencManual = t.checked; if (t.checked && !S.legItem.vencimiento) S.legItem.vencimiento = calcVenc(req(S.legItem.codigo), {...S.legItem, vencManual: false}); render(); };
  async function leerArchivo(f){
    if (f.type.startsWith('image/')) { const img = await resizeImg(f, 1600); return {nombre: f.name.replace(/\.\w+$/, '') + '.jpg', tipo: 'image/jpeg', data: img.data, fecha: hoy()}; }
    if (f.size > 12e6) throw new Error('El archivo pesa más de 12 MB. Achicalo antes de adjuntarlo.');
    return {nombre: f.name, tipo: f.type || 'application/pdf', data: await AG.aDataUrl(f), fecha: hoy()};
  }
  acciones.legArchivo = async t => {
    const f = t.files?.[0]; t.value = '';
    if (!f) return;
    try { S.legItem.archivo = await leerArchivo(f); } catch (e) { return avisar(e.message); }
    toast('Documento adjuntado: tocá Guardar');
    render();
  };
  acciones.legVerArchivo = async (t, i) => { const a = i < 0 ? S.legItem.archivo : S.legItem.casos[i].archivo; if (a) entregar('descargar', a.nombre, await AG.aBlob(a.data)); };
  acciones.legVerVersion = async (t, i) => { const a = S.legItem.versiones[i].archivo; if (a) entregar('descargar', a.nombre, await AG.aBlob(a.data)); };
  acciones.legRenovar = async () => {
    if (!(await confirmar('La fecha, el vencimiento, el interviniente y el documento actuales pasan al historial de versiones, y cargás los nuevos.', 'Cargar versión nueva'))) return;
    const it = S.legItem;
    it.versiones = [{emision: it.emision, vencimiento: calcVenc(req(it.codigo), it), interviniente: it.interviniente, archivo: it.archivo, observaciones: it.observaciones, reemplazado: hoy()}, ...(it.versiones || [])];
    Object.assign(it, {emision: '', vencimiento: '', vencManual: false, archivo: null, manual: ''});
    render();
  };
  let casoArchivo = null;
  acciones.legCasoArchivo = async t => {
    const f = t.files?.[0];
    if (!f) return;
    try { casoArchivo = await leerArchivo(f); $('#lc_archTxt').textContent = 'Adjunto: ' + casoArchivo.nombre; } catch (e) { avisar(e.message); }
  };
  acciones.legCasoAgregar = () => {
    const tit = $('#lc_tit').value.trim();
    if (!tit) return avisar('Escribí el detalle.');
    S.legItem.casos = [...(S.legItem.casos || []), {id: uid(), titulo: tit, fecha: $('#lc_fecha').value, limite: $('#lc_lim')?.value || '', estado: 'Abierto', archivo: casoArchivo}];
    casoArchivo = null;
    render();
  };
  acciones.legCasoEstado = (t, i) => { const c = S.legItem.casos[i]; c.estado = c.estado === 'Cerrado' ? 'Abierto' : 'Cerrado'; c.cierre = c.estado === 'Cerrado' ? hoy() : ''; render(); };
  acciones.legCasoQuitar = async (t, i) => { if (await confirmar('¿Quitar este registro?', 'Quitar')) { S.legItem.casos.splice(i, 1); render(); } };
  acciones.legGuardar = async () => {
    const it = S.legItem, r = req(it.codigo);
    if (it.aplica === false && !String(it.motivoNoAplica || '').trim()) it.motivoNoAplica = propuesta(r, S.estab, {}).motivo;
    if (it.aplica === false && !String(it.motivoNoAplica || '').trim()) return avisar('Escribí el motivo por el que no aplica.');
    if (r.vigencia?.tipo === 'documento' && it.emision && !it.vencimiento && !r.casos && !(await confirmar('No cargaste el vencimiento del documento. ¿Guardar igual?', 'Guardar'))) return;
    await guardarItem(it, it.aplica === false ? 'Marcado como no aplica' : `Actualizado (${EST[estado(r, it, S.estab, {})][0].toLowerCase()})`);
    toast('Guardado');
    A.atras();
  };

  // ===== Revisión de legajo (dentro de la visita o del relevamiento): ordenada por urgencia, acciones de un toque =====
  acciones.legRevisar = () => { S.legRevVolver = S.view; S.legVisita = S.view === 'visita' ? S.vid : S.legVisita; go('legajoRevision'); };
  acciones.legRevisarVisita = async () => {
    const v = await getOne('visitas', S.vid), s = await getOne('establecimientos', v.estabId);
    S.estab = s; S.empresa = await getOne('empresas', s.empresaId); S.legVisita = v.id; S.legRevVolver = 'visita';
    go('legajoRevision');
  };
  prev.legajoRevision = () => S.legRevVolver || 'legajo';
  views.legajoRevision = {
    title: () => 'Revisión de legajo',
    subtitle: () => `${S.empresa.razonSocial} · ${S.estab.nombre}`,
    async html(){
      const fs = filas(S.estab, await leerTodo()).sort((a, b) => URGENCIA.indexOf(a.est) - URGENCIA.indexOf(b.est) || (a.dias ?? 9999) - (b.dias ?? 9999));
      const R = resumen(fs);
      const b = (f, k, txt, clase = 'sec') => `<button class="btn ${clase} small" ${on('legRapido', f.it.codigo, f.it.sub || '', k)}>${txt}</button>`;
      return `${aviso('info', 'info', `Primero los vencidos y faltantes. Cada toque queda registrado con la fecha${S.legVisita ? ' y esta visita' : ''}. Faltante o Vencido crea un pendiente del cliente.`)}
        <p class="sub">Cumplimiento: <b>${R.pct}%</b> · ${R.n('vencido') + R.n('faltante')} a resolver · ${R.n('porvencer')} por vencer · ${R.n('sinrevisar')} sin revisar</p>
        <div class="stack">${fs.map(f => `<div class="card"><div class="between" ${on('abrirLegItem', f.it.codigo, f.it.sub || '')} style="cursor:pointer"><div><b>${esc(nombreReq(f))}</b><div class="sub">${esc(textoVenc(f))}</div></div>${badge(f.est)}</div>
          <div class="actions" style="margin-top:10px">${b(f, 'vigente', ic('check') + 'Vigente')}${b(f, 'faltante', 'Faltante', 'ghost')}${b(f, 'vencido', 'Vencido', 'ghost')}${b(f, 'tramite', 'En trámite', 'ghost')}${b(f, 'noaplica', 'No aplica', 'ghost')}</div></div>`).join('')}</div>`;
    }
  };
  acciones.legRapido = async (t, cod, sub, k) => {
    const fs = filas(S.estab, await leerTodo()), f = fs.find(x => x.it.codigo === cod && (x.it.sub || '') === sub);
    if (!f) return;
    const it = structuredClone(f.it);
    if (k === 'vigente') {
      // Vigente pide la fecha y el documento: se abre la ficha del ítem ya marcada como vigente
      Object.assign(it, {aplica: true, manual: ''});
      if (!it.emision && f.r.casos !== 'eventos' && f.r.casos !== 'productos') it.emision = hoy();
      S.legItem = it; S.legItemVolver = 'legajoRevision';
      toast('Revisá la fecha y adjuntá la foto o el PDF del documento');
      return go('legajoItem');
    }
    if (k === 'noaplica') {
      const m = await AG.pedirMotivo(`¿Por qué no aplica ${cod}?`, [f.prop.motivo, 'No corresponde por la actividad', 'Lo gestiona otro establecimiento'].filter(Boolean));
      if (!m) return;
      Object.assign(it, {aplica: false, motivoNoAplica: m});
    } else Object.assign(it, {aplica: true, manual: k});
    await guardarItem(it, {faltante: 'Marcado faltante', vencido: 'Marcado vencido', tramite: 'Marcado en trámite', noaplica: 'Marcado no aplica: ' + it.motivoNoAplica}[k]);
    toast(EST[k][0]);
    render();
  };

  // ===== Cerrar una visita con tareas hechas: renueva los requisitos vinculados (pide el documento) =====
  AG.legajoDesdeVisita = async (v, s) => {
    const todos = await leerTodo(), renovados = [];
    for (const t of v.tareas.filter(t => t.hecha && t.actividadId)) for (const r of reqs().filter(r => (r.actividades || []).includes(t.actividadId))) {
      const id = idItem(s, r.codigo), it = todos.find(x => x.id === id) || {id, estabId: s.id, codigo: r.codigo, sub: ''};
      if (it.emision && it.emision >= v.fecha) continue;
      if (it.emision || it.archivo) it.versiones = [{emision: it.emision, vencimiento: calcVenc(r, it), interviniente: it.interviniente, archivo: it.archivo, observaciones: it.observaciones, reemplazado: v.fecha}, ...(it.versiones || [])];
      Object.assign(it, {aplica: true, manual: '', emision: v.fecha, vencManual: false, archivo: null, interviniente: PERFIL.nombre || it.interviniente || ''});
      S.legVisita = v.id;
      await guardarItem(it, `Realizado en la visita (${t.nombre})`);
      renovados.push(r.codigo);
    }
    return renovados;
  };

  // ===== Resumen para la pantalla del establecimiento y la visita =====
  let cacheTodos = [];
  AG.legajoResumen = s => {
    const fs = filas(s, cacheTodos), R = resumen(fs), malos = R.n('vencido') + R.n('faltante');
    return {txt: `${R.pct}% de cumplimiento · ${malos ? plural(malos, 'ítem a resolver', 'ítems a resolver') : 'nada vencido'}`, badge: malos ? `<span class="badge b-bad esq">${malos}</span>` : R.n('porvencer') ? `<span class="badge b-mid esq">${R.n('porvencer')}</span>` : '', R};
  };
  AG.legajoRefrescar = async () => { cacheTodos = await leerTodo(); };
  // Avisos para la agenda y el inicio: vencidos y por vencer de todos los clientes
  AG.legajoAvisos = (ests) => {
    const out = [];
    for (const s of ests) for (const f of filas(s, cacheTodos)) if ((f.est === 'vencido' || f.est === 'porvencer' || f.est === 'faltante') && !f.it.virtual) out.push({s, ...f});
    return out.sort((a, b) => (a.dias ?? -9999) - (b.dias ?? -9999));
  };

  // ===== Panel general: todos los clientes + vencimientos de los próximos 90 días =====
  views.legajoPanel = {
    title: () => 'Legajo técnico',
    subtitle: () => 'Panel de control',
    async html(){
      const [emps, ests, todos] = await Promise.all([getAll('empresas'), getAll('establecimientos'), leerTodo()]);
      cacheTodos = todos;
      const tab = S.lpTab || 'clientes', q = sinAcentos(S.lpBuscar || '');
      const seg = `<div class="segmento">${[['clientes', 'Clientes'], ['vencimientos', 'Próximos 90 días']].map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" ${on('lpTab', k)}>${t}</button>`).join('')}</div>`;
      const nombre = s => { const e = emps.find(x => x.id === s.empresaId); return e ? e.razonSocial + (ests.filter(x => x.empresaId === e.id).length > 1 ? ' · ' + s.nombre : '') : s.nombre; };
      if (tab === 'vencimientos') {
        const lim = 90, xs = [];
        for (const s of ests) for (const f of filas(s, todos)) if (f.est !== 'noaplica' && f.venc && f.dias <= lim) xs.push({s, ...f});
        xs.sort((a, b) => a.dias - b.dias);
        let mes = '';
        return `${seg}<p class="sub">Vencidos y vencimientos de los próximos ${lim} días, de todos los clientes.</p>
          ${xs.map(x => { const m = x.venc.slice(0, 7), cab = m !== mes ? `<h3>${x.dias < 0 && x.venc < hoy().slice(0, 7) + '-01' ? 'Vencidos antes' : MESES[+m.slice(5) - 1] + ' ' + m.slice(0, 4)}</h3>` : ''; mes = m;
            return cab + `<div class="card rowcard" ${on('abrirLegajoItemDe', x.s.id, x.it.codigo, x.it.sub || '')}><div class="tile ${x.dias < 0 ? 't-rojo' : x.dias <= 30 ? 't-amarillo' : 't-menta'} chico">${ic('reloj')}</div>
              <div><b>${esc(nombreReq(x))}</b><div class="sub">${esc(nombre(x.s))} · ${esc(textoVenc(x))}</div></div>${badge(x.est)}</div>`; }).join('') || vacio('ok', 'No hay vencimientos en los próximos 90 días.')}`;
      }
      const orden = S.lpOrden || 'pct';
      let rows = ests.map(s => { const fs = filas(s, todos), R = resumen(fs); return {s, R, nom: nombre(s), malos: R.n('vencido') + R.n('faltante')}; }).filter(x => !q || sinAcentos(x.nom).includes(q));
      rows.sort({pct: (a, b) => a.R.pct - b.R.pct, vencidos: (a, b) => b.R.n('vencido') - a.R.n('vencido'), faltantes: (a, b) => b.R.n('faltante') - a.R.n('faltante'),
        porvencer: (a, b) => b.R.n('porvencer') - a.R.n('porvencer'), cliente: (a, b) => a.nom.localeCompare(b.nom), revision: (a, b) => (a.R.ultima || '').localeCompare(b.R.ultima || '')}[orden]);
      return `${seg}
        <div class="row" style="margin-top:12px"><div class="search">${ic('search')}<input id="lp_q" placeholder="Buscar cliente" aria-label="Buscar cliente" value="${esc(S.lpBuscar || '')}" ${oc('lpBuscar')}></div>
          <select aria-label="Ordenar" ${oc('lpOrden')}>${[['pct', 'Menor cumplimiento'], ['vencidos', 'Más vencidos'], ['faltantes', 'Más faltantes'], ['porvencer', 'Más por vencer'], ['cliente', 'Cliente (A-Z)'], ['revision', 'Revisión más vieja']]
            .map(([k, t]) => `<option value="${k}" ${orden === k ? 'selected' : ''}>Ordenar: ${t}</option>`).join('')}</select></div>
        <p class="hint">${CRITERIO}</p>
        <div class="card tabla-scroll" style="margin-top:12px"><table class="prog legtab"><thead><tr><th>Cliente</th><th>%</th><th>Venc.</th><th>Falt.</th><th>Por venc.</th><th>Última revisión</th></tr></thead>
          <tbody>${rows.map(x => `<tr ${on('abrirLegajo', x.s.id)} style="cursor:pointer"><td class="t"><b>${esc(x.nom)}</b></td><td><b class="${x.R.pct >= 80 ? 'txt-ok' : x.R.pct >= 50 ? 'txt-mid' : 'txt-bad'}">${x.R.pct}%</b></td>
            <td class="${x.R.n('vencido') ? 'txt-bad' : ''}">${x.R.n('vencido')}</td><td class="${x.R.n('faltante') ? 'txt-bad' : ''}">${x.R.n('faltante')}</td><td class="${x.R.n('porvencer') ? 'txt-mid' : ''}">${x.R.n('porvencer')}</td>
            <td>${x.R.ultima ? fmtFecha(x.R.ultima) : '—'}</td></tr>`).join('') || `<tr><td colspan="6" class="sub" style="padding:16px">Todavía no hay establecimientos.</td></tr>`}</tbody></table></div>
        <button class="btn sec block" style="margin-top:16px" ${on('go', 'legajoCatalogo')}>${ic('libro')}Catálogo de requisitos</button>`;
    }
  };
  prev.legajoPanel = 'mas';
  acciones.lpTab = (t, k) => { S.lpTab = k; render(); };
  acciones.lpOrden = t => { S.lpOrden = t.value; render(); };
  acciones.lpBuscar = t => { S.lpBuscar = t.value; render(); };
  acciones.abrirLegajoItemDe = async (t, estabId, cod, sub) => {
    S.estab = await getOne('establecimientos', estabId); S.empresa = await getOne('empresas', S.estab.empresaId);
    S.legajoVolver = S.view;
    await acciones.abrirLegItem(t, cod, sub);
  };

  // ===== Catálogo de requisitos (editable) =====
  views.legajoCatalogo = {
    title: () => 'Catálogo de requisitos',
    html: () => `${aviso('info', 'info', 'Es el listado que se aplica a cada establecimiento. Podés editar cualquier requisito, agregar nuevos o desactivarlos (no se borran los datos ya cargados).')}
      <div class="card" style="margin-top:12px"><label for="lc_umb">Avisar "por vencer" con (días de anticipación)</label><input id="lc_umb" type="number" inputmode="numeric" value="${umbral()}" ${oc('lcUmbral')}></div>
      ${secciones().map(sec => `<div class="secc"><h3>${esc(sec)}</h3><div class="card fold-list">${CAT.requisitos.filter(r => r.seccion === sec).map(r => `<div class="el" ${on('lcEditar', r.codigo)}>
        <div><b>${esc(r.codigo)} · ${esc(r.nombre)}</b>${r.a_confirmar ? ' <span class="badge b-mid">a confirmar</span>' : ''}${r.activo === false ? ' <span class="badge b-na">desactivado</span>' : ''}
        <div class="sub">${esc(textoVigencia(r))} · ${esc(r.normativa)}</div></div>${ic('chev', 'chev')}</div>`).join('')}</div></div>`).join('')}
      <div class="bottom-bar"><div class="actions"><button class="btn" ${on('lcEditar', '')}>${ic('plus')}Agregar requisito</button></div></div>`
  };
  prev.legajoCatalogo = 'legajoPanel';
  acciones.lcUmbral = async t => { CAT.umbral_dias = Math.max(1, +t.value || 60); await put('config', CAT); toast('Guardado'); };
  const REGLAS = [['siempre', 'Siempre'], ['provincia', 'Provincia'], ['trabajadores_min', 'Desde N trabajadores'], ['quimicos', 'Usa productos químicos'], ['residuos', 'Genera residuos peligrosos'],
    ['ruido', 'Tiene fuentes de ruido'], ['comedor', 'Tiene comedor o cocina'], ['cancerigenos', 'El RAR declara cancerígenos'], ['no_obra', 'No es obra (Dec. 911/96)'], ['depende', 'Si aplica otro requisito']];
  acciones.lcEditar = (t, cod) => {
    const r = cod ? req(cod) : null;
    S.lcReq = r ? structuredClone(r) : {codigo: '', nombre: '', seccion: secciones()[0] || '', normativa: 'Buenas prácticas', vigencia: {tipo: 'periodica', meses: 12}, aplica: {siempre: true}, evidencia: '', nota: '', a_confirmar: false, activo: true, actividades: [], nuevo: true};
    go('legajoReq');
  };
  prev.legajoReq = 'legajoCatalogo';
  views.legajoReq = {
    title: () => S.lcReq.nuevo ? 'Nuevo requisito' : S.lcReq.codigo,
    html(){
      const r = S.lcReq, v = r.vigencia, campo = (id, lbl, val, extra = '') => `<div class="fld"><label for="${id}">${lbl}</label><input id="${id}" value="${esc(val ?? '')}" ${extra}></div>`;
      return `<div class="stack"><div class="card">
          <div class="row">${campo('lr_cod', 'Código *', r.codigo, r.nuevo ? '' : 'disabled')}${campo('lr_sec', 'Sección', r.seccion, 'list="lr_secs"')}</div>
          <datalist id="lr_secs">${secciones().map(s => `<option value="${esc(s)}">`).join('')}</datalist>
          ${campo('lr_nom', 'Nombre (carátula) *', r.nombre)}
          ${campo('lr_norma', 'Normativa de referencia', r.normativa)}
          ${campo('lr_evid', 'Evidencia esperada', r.evidencia)}
          <label for="lr_nota">Nota</label><textarea id="lr_nota">${esc(r.nota)}</textarea>
          <label class="check" style="margin-top:12px"><input type="checkbox" id="lr_conf" ${r.a_confirmar ? 'checked' : ''}> Vigencia a confirmar</label>
          <label class="check"><input type="checkbox" id="lr_act" ${r.activo !== false ? 'checked' : ''}> Activo</label></div>
        <div class="card"><h4>Vigencia</h4>
          <select id="lr_vtipo" aria-label="Tipo de vigencia" ${oc('lrVigencia')}>${Object.entries(VIGENCIAS).map(([k, t]) => `<option value="${k}" ${v.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
          ${v.tipo === 'periodica' ? campo('lr_meses', 'Cada cuántos meses', v.meses, 'type="number" inputmode="numeric"') : ''}
          ${v.tipo === 'revision' ? campo('lr_rec', 'Recordatorio de revisión (meses)', v.recordatorio_meses || 12, 'type="number" inputmode="numeric"') : ''}
          ${v.tipo === 'fecha_fija' ? `<div class="row">${campo('lr_dia', 'Día', v.dia, 'type="number" inputmode="numeric"')}${campo('lr_mes', 'Mes', v.mes, 'type="number" inputmode="numeric"')}</div>` : ''}
          <label for="lr_casos">Registros dentro del ítem</label><select id="lr_casos">${[['', 'Ninguno'], ['eventos', 'Casos con plazo (actuaciones, siniestros)'], ['registros', 'Registros (capacitaciones, reuniones, retiros)'], ['productos', 'Productos (FDS)']]
            .map(([k, t]) => `<option value="${k}" ${(r.casos || '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <label class="check" style="margin-top:12px"><input type="checkbox" id="lr_punto" ${r.por === 'punto_agua' ? 'checked' : ''}> Un ítem por punto de suministro de agua</label></div>
        <div class="card"><h4>Cuándo aplica</h4><p class="sub" style="margin-top:0">Se tienen que cumplir todas las condiciones marcadas.</p>
          ${REGLAS.map(([k, t]) => `<label class="check"><input type="checkbox" data-regla="${k}" ${r.aplica?.[k] ? 'checked' : ''}> ${t}${k === 'provincia' ? `: <input id="lr_prov" style="min-height:40px;width:140px;margin-left:6px" value="${esc(typeof r.aplica?.provincia === 'string' ? r.aplica.provincia : 'Santa Fe')}" aria-label="Provincia">`
            : k === 'trabajadores_min' ? `: <input id="lr_trab" type="number" inputmode="numeric" style="min-height:40px;width:90px;margin-left:6px" value="${r.aplica?.trabajadores_min || 10}" aria-label="Trabajadores">`
            : k === 'depende' ? `: <input id="lr_dep" style="min-height:40px;width:90px;margin-left:6px" value="${esc(r.aplica?.depende || '')}" placeholder="L04" aria-label="Código">` : ''}</label>`).join('')}</div>
        <div class="card"><h4>Tareas de la agenda que lo renuevan</h4><p class="sub" style="margin-top:0">Al cerrar una visita con esa tarea hecha, el requisito queda renovado con la fecha de la visita.</p>
          <div class="chips">${ACTIVIDADES.lista.map(a => `<button class="chip small ${(r.actividades || []).includes(a.id) ? 'on' : ''}" ${on('lrActividad', a.id)}>${esc(a.nombre)}</button>`).join('')}</div></div>
      </div>
      <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('atras')}>Cancelar</button><button class="btn" ${on('lrGuardar')}>${ic('check')}Guardar</button></div></div>`;
    }
  };
  // Lee el formulario del requisito (para no perder lo escrito al redibujar)
  function leerReq(){
    const r = S.lcReq, val = id => $('#' + id)?.value.trim() ?? '';
    Object.assign(r, {codigo: r.nuevo ? val('lr_cod') : r.codigo, seccion: val('lr_sec') || 'Otros', nombre: val('lr_nom'), normativa: val('lr_norma') || 'Buenas prácticas', evidencia: val('lr_evid'),
      nota: val('lr_nota'), a_confirmar: $('#lr_conf').checked, activo: $('#lr_act').checked, casos: val('lr_casos') || undefined, por: $('#lr_punto').checked ? 'punto_agua' : undefined});
    const v = {tipo: $('#lr_vtipo').value};
    if (v.tipo === 'periodica') v.meses = +val('lr_meses') || 12;
    if (v.tipo === 'revision') v.recordatorio_meses = +val('lr_rec') || 12;
    if (v.tipo === 'fecha_fija') { v.dia = +val('lr_dia') || 1; v.mes = +val('lr_mes') || 1; }
    if (r.vigencia?.antiguedad_max_meses) v.antiguedad_max_meses = r.vigencia.antiguedad_max_meses;
    r.vigencia = v;
    const a = {};
    document.querySelectorAll('[data-regla]').forEach(c => { if (!c.checked) return; const k = c.dataset.regla;
      a[k] = k === 'provincia' ? val('lr_prov') || 'Santa Fe' : k === 'trabajadores_min' ? +val('lr_trab') || 10 : k === 'depende' ? val('lr_dep').toUpperCase() : true; });
    r.aplica = Object.keys(a).length ? a : {siempre: true};
  }
  acciones.lrVigencia = () => { leerReq(); render(); };
  acciones.lrActividad = (t, id) => { leerReq(); const l = S.lcReq.actividades ||= []; l.includes(id) ? l.splice(l.indexOf(id), 1) : l.push(id); render(); };
  acciones.lrGuardar = async () => {
    leerReq();
    const r = S.lcReq;
    if (!r.codigo || !r.nombre) return avisar('El código y el nombre son obligatorios.');
    if (r.nuevo && req(r.codigo)) return avisar('Ya existe un requisito con ese código.');
    const nuevo = r.nuevo; delete r.nuevo;
    if (nuevo) CAT.requisitos.push(r); else CAT.requisitos[CAT.requisitos.findIndex(x => x.codigo === r.codigo)] = r;
    if (!(CAT.secciones || []).includes(r.seccion)) CAT.secciones = [...(CAT.secciones || []), r.seccion];
    await put('config', CAT);
    toast('Requisito guardado');
    go('legajoCatalogo');
  };

  // ===== Salidas: Excel, Word e índice PDF =====
  acciones.legSalidas = async () => {
    const k = await menu('¿Qué querés generar?', [
      {txt: 'Excel "Estado del legajo" (toda la empresa)', icono: 'panel', valor: 'excel'},
      {txt: 'Word "Informe de estado del legajo técnico"', icono: 'doc', valor: 'word'},
      {txt: 'PDF "Índice del legajo" con carátulas', icono: 'carpeta', valor: 'indice'}]);
    if (!k) return;
    const modo = await menu('¿Descargar o compartir?', [{txt: 'Descargar', icono: 'descarga', valor: 'descargar'}, {txt: 'Compartir (WhatsApp, mail…)', icono: 'compartir', valor: 'compartir'}]);
    if (!modo) return;
    toast('Preparando el archivo…');
    try {
      const x = k === 'excel' ? await excelLegajo(S.empresa) : k === 'word' ? await wordLegajo(S.empresa, S.estab) : await indicePdf(S.empresa, S.estab);
      await entregar(modo, x.nombre, x.blob);
    } catch (e) { console.error(e); avisar('No se pudo generar el archivo: ' + e.message); }
  };
  const ESTILO_XLS = {vigente: 'ok', porvencer: 'medio', vencido: 'mal', faltante: 'mal', tramite: 'azul', noaplica: 'gris', sinrevisar: 'centro'};
  async function excelLegajo(e){
    const ests = (await getAll('establecimientos')).filter(s => s.empresaId === e.id).sort((a, b) => a.nombre.localeCompare(b.nombre)), todos = await leerTodo();
    const hojas = ests.map(s => {
      const fs = filas(s, todos), R = resumen(fs), enc = t => ({v: t, s: 'enc'}), c = v => ({v, s: 'celda'});
      return {nombre: s.nombre, fijarFila: 5, anchos: [8, 42, 26, 34, 14, 12, 12, 24, 40],
        filas: [[{v: 'Estado del legajo técnico', s: 'titulo'}], [{v: `${e.razonSocial}${e.cuit ? ' · CUIT ' + e.cuit : ''} · ${s.nombre} · ${[s.domicilio, s.localidad].filter(Boolean).join(', ')}`, s: 'subtitulo'}],
          [{v: `Cumplimiento: ${R.pct}% · ${CRITERIO} · Generado el ${fmtFecha(hoy())}`, s: 'texto'}], [],
          ['Código', 'Requisito', 'Sección', 'Normativa', 'Estado', 'Emisión', 'Vencimiento', 'Interviniente', 'Observaciones'].map(enc),
          ...fs.map(f => [c(f.r.codigo), c(f.r.nombre + (f.it.sub ? ' – ' + f.it.sub : '') + (f.r.a_confirmar ? ' (vigencia a confirmar)' : '')), c(f.r.seccion), c(f.r.normativa),
            {v: EST[f.est][0], s: ESTILO_XLS[f.est]}, c(fmtFecha(f.it.emision)), c(fmtFecha(f.venc)), c(f.it.interviniente || ''),
            c([f.est === 'noaplica' ? f.it.motivoNoAplica || f.prop.motivo : '', f.it.observaciones, (f.it.casos || []).length ? plural(f.it.casos.length, 'registro', 'registros') : ''].filter(Boolean).join(' · '))])]};
    });
    if (!hojas.length) throw new Error('la empresa no tiene establecimientos');
    return {nombre: `Estado_legajo_${limpiarNombre(e.razonSocial)}_${hoy()}.xlsx`, blob: Planilla.generar(hojas)};
  }
  // Word: carátula sola en la hoja 1; tablas que no se cortan y pegadas a su texto; sin títulos colgados ni párrafos partidos
  async function wordLegajo(e, s){
    const D = window.docx, fs = filas(s, await leerTodo()), R = resumen(fs);
    const {Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, Footer, Header, PageNumber, BorderStyle} = D;
    const COL = {vigente: ['E2EFDA', '375623'], porvencer: ['FFF2CC', '7F6000'], vencido: ['F4CCCC', 'C00000'], faltante: ['F4CCCC', 'C00000'], tramite: ['DDEBF7', '1F4E79'], noaplica: ['EDEDED', '595959'], sinrevisar: ['FFFFFF', '595959']};
    const run = (t, o = {}) => new TextRun({text: String(t ?? ''), size: 20, ...o});
    const p = (t, o = {}) => new Paragraph({spacing: {after: 100}, keepLines: true, ...o, children: [].concat(t).map(x => typeof x === 'string' ? run(x) : x)});
    const tit = t => new Paragraph({spacing: {before: 280, after: 120}, keepNext: true, keepLines: true, children: [run(t, {bold: true, size: 26, color: '1F3864'})]});
    const intro = t => p(t, {keepNext: true});
    // Tabla que no se corta: todos los párrafos llevan keepNext salvo los de la última fila (si no, se pega a lo que sigue)
    function tabla(head, rows, anchos){
      const celda = (txt, ultima, op = {}) => new TableCell({width: anchos ? {size: op.ancho, type: WidthType.PERCENTAGE} : undefined, shading: op.fill ? {type: ShadingType.CLEAR, fill: op.fill, color: 'auto'} : undefined,
        children: String(txt ?? '').split('\n').map(l => new Paragraph({keepNext: !ultima, keepLines: true, children: [run(l, {size: 18, bold: !!op.bold, color: op.color})]}))});
      return new Table({width: {size: 100, type: WidthType.PERCENTAGE}, rows: [
        new TableRow({tableHeader: true, cantSplit: true, children: head.map((h, i) => celda(h, !rows.length, {fill: '1F3864', color: 'FFFFFF', bold: true, ancho: anchos?.[i]}))}),
        ...rows.map((r, ri) => new TableRow({cantSplit: true, children: r.map((c, i) => celda(c.v ?? c, ri === rows.length - 1, {fill: c.fill, color: c.color, bold: c.bold, ancho: anchos?.[i]}))}))]});
    }
    const estadoCelda = f => ({v: EST[f.est][0], fill: COL[f.est][0], color: COL[f.est][1], bold: true});
    const caratula = [
      new Paragraph({spacing: {before: 2400, after: 200}, alignment: AlignmentType.CENTER, children: [run('INFORME DE ESTADO DEL', {bold: true, size: 40, color: '1F3864'})]}),
      new Paragraph({spacing: {after: 600}, alignment: AlignmentType.CENTER, children: [run('LEGAJO TÉCNICO', {bold: true, size: 40, color: '1F3864'})]}),
      ...[['Empresa', e.razonSocial], ['CUIT', e.cuit || '-'], ['Establecimiento', s.nombre], ['Dirección', [s.domicilio, s.localidad, s.provincia].filter(Boolean).join(', ') || '-'],
        ['Fecha', fmtFecha(hoy())], ['Profesional', [PERFIL.titulo, PERFIL.nombre].filter(Boolean).join(' ') + (PERFIL.matricula ? ' · Mat. ' + PERFIL.matricula : '') || '-']]
        .map(([k, v]) => new Paragraph({alignment: AlignmentType.CENTER, spacing: {after: 120}, children: [run(k + ': ', {bold: true, size: 24}), run(v, {size: 24})]}))];
    const cuerpo = [
      new Paragraph({pageBreakBefore: true, spacing: {after: 120}, keepNext: true, children: [run('1. OBJETIVO', {bold: true, size: 26, color: '1F3864'})]}),
      p(`Informar al empleador el estado de la documentación del legajo técnico de Higiene y Seguridad del establecimiento ${s.nombre}, con su vigencia y las acciones necesarias para regularizar lo pendiente.`),
      tit('2. RESUMEN'),
      intro(`Cumplimiento del legajo: ${R.pct}%. ${CRITERIO}`),
      tabla(['Vigentes', 'Por vencer', 'Vencidos', 'Faltantes', 'En trámite', 'No aplica', 'Sin revisar'], [['vigente', 'porvencer', 'vencido', 'faltante', 'tramite', 'noaplica', 'sinrevisar'].map(k => ({v: String(R.n(k)), fill: COL[k][0], color: COL[k][1], bold: true}))]),
      tit('3. ESTADO POR SECCIÓN')
    ];
    for (const sec of secciones()) {
      const xs = fs.filter(f => f.r.seccion === sec);
      if (!xs.length) continue;
      cuerpo.push(new Paragraph({spacing: {before: 200, after: 80}, keepNext: true, keepLines: true, children: [run(sec, {bold: true, size: 22})]}),
        intro(`${plural(xs.length, 'requisito', 'requisitos')}: ${xs.filter(f => f.est === 'vigente').length} vigentes.`),
        tabla(['Código', 'Requisito', 'Estado', 'Emisión', 'Vencimiento'], xs.map(f => [f.r.codigo, f.r.nombre + (f.it.sub ? ' – ' + f.it.sub : ''), estadoCelda(f), fmtFecha(f.it.emision) || '-', f.est === 'noaplica' ? '-' : fmtFecha(f.venc) || '-']), [10, 46, 16, 14, 14]));
    }
    const acc = fs.filter(f => ['vencido', 'faltante', 'porvencer'].includes(f.est)).sort((a, b) => URGENCIA.indexOf(a.est) - URGENCIA.indexOf(b.est));
    cuerpo.push(tit('4. ACCIONES REQUERIDAS'));
    if (acc.length) cuerpo.push(intro('Documentación a regularizar, de lo más urgente a lo menos urgente:'),
      tabla(['Código', 'Requisito', 'Estado', 'Acción'], acc.map(f => [f.r.codigo, f.r.nombre + (f.it.sub ? ' – ' + f.it.sub : ''), estadoCelda(f), f.est === 'porvencer' ? `Renovar antes del ${fmtFecha(f.venc)}` : `Presentar: ${f.r.evidencia || 'documentación'}`]), [10, 40, 16, 34]));
    else cuerpo.push(p('No hay documentación vencida, faltante ni por vencer.'));
    const nr = fs.filter(f => f.est === 'noaplica');
    if (nr.length) cuerpo.push(tit('5. REQUISITOS QUE NO APLICAN'), intro('Con el motivo registrado:'), tabla(['Código', 'Requisito', 'Motivo'], nr.map(f => [f.r.codigo, f.r.nombre, f.it.motivoNoAplica || f.prop.motivo || '-']), [12, 48, 40]));
    cuerpo.push(new Paragraph({spacing: {before: 600}, keepLines: true, alignment: AlignmentType.RIGHT, children: [run('_______________________________')]}),
      new Paragraph({alignment: AlignmentType.RIGHT, keepLines: true, children: [run([PERFIL.titulo, PERFIL.nombre].filter(Boolean).join(' ') || 'Profesional de Higiene y Seguridad', {bold: true})]}),
      ...(PERFIL.matricula ? [new Paragraph({alignment: AlignmentType.RIGHT, children: [run('Mat. ' + PERFIL.matricula)]})] : []));
    const doc = new Document({sections: [{properties: {page: {margin: {top: 1100, bottom: 1000, left: 1100, right: 1100}}, titlePage: true},
      headers: {default: new Header({children: [new Paragraph({alignment: AlignmentType.RIGHT, border: {bottom: {style: BorderStyle.SINGLE, size: 4, color: '1F3864', space: 4}}, children: [run(`Legajo técnico · ${e.razonSocial} · ${s.nombre}`, {size: 16, color: '595959'})]})]})},
      footers: {default: new Footer({children: [new Paragraph({alignment: AlignmentType.RIGHT, children: [new TextRun({children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16})]})]})},
      children: [...caratula, ...cuerpo]}]});
    return {nombre: `Informe_legajo_${limpiarNombre(e.razonSocial)}_${limpiarNombre(s.nombre)}_${hoy()}.docx`, blob: await Packer.toBlob(doc)};
  }
  // PDF para la carpeta física: índice + una carátula por requisito (L12 hace de separador de Mediciones)
  async function indicePdf(e, s){
    await lib('pdf');
    const doc = new window.jspdf.jsPDF({unit: 'mm', format: 'a4'}), fs = filas(s, await leerTodo()).filter(f => f.est !== 'noaplica');
    const AZ = [18, 63, 66], datos = [e.razonSocial, e.cuit ? 'CUIT ' + e.cuit : '', s.nombre, [s.domicilio, s.localidad, s.provincia].filter(Boolean).join(', ')].filter(Boolean);
    doc.setFillColor(...AZ); doc.rect(0, 0, 210, 34, 'F'); doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('LEGAJO TÉCNICO', 14, 16);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.text('Higiene y Seguridad en el Trabajo', 14, 25);
    doc.setTextColor(32, 39, 37); doc.setFontSize(11); doc.text(datos, 14, 46);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('ÍNDICE', 14, 74);
    const ags = reqs().filter(r => r.vigencia?.tipo === 'agrupador');
    const caras = [];
    for (const sec of secciones()) {
      const ag = ags.find(r => r.seccion === sec), xs = fs.filter(f => f.r.seccion === sec);
      if (!xs.length) continue;
      if (ag) caras.push({cod: ag.codigo, nom: ag.nombre, sec, sep: true});
      xs.forEach(f => caras.push({cod: f.r.codigo + (f.it.sub ? ' ' + f.it.sub : ''), nom: f.r.nombre, sec, norma: f.r.normativa}));
    }
    doc.autoTable({startY: 78, margin: {left: 14, right: 14}, theme: 'grid', styles: {fontSize: 9, cellPadding: 1.6}, headStyles: {fillColor: AZ}, columnStyles: {0: {cellWidth: 26}, 2: {cellWidth: 52}},
      head: [['Código', 'Documento', 'Sección']], body: caras.map(c => [c.cod, c.nom, c.sec])});
    for (const c of caras) {
      doc.addPage();
      doc.setFillColor(...AZ); doc.rect(0, 0, 14, 297, 'F');
      doc.setTextColor(...AZ); doc.setFont('helvetica', 'bold'); doc.setFontSize(64); doc.text(c.cod, 105, 110, {align: 'center'});
      doc.setFontSize(22); doc.setTextColor(32, 39, 37); doc.text(doc.splitTextToSize(c.nom.toUpperCase(), 160), 105, 135, {align: 'center'});
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(98, 110, 105);
      doc.text(c.sep ? 'Separador de sección' : c.sec, 105, 170, {align: 'center'});
      if (c.norma) doc.text(doc.splitTextToSize(c.norma, 150), 105, 180, {align: 'center'});
      doc.setDrawColor(220, 227, 223); doc.line(30, 250, 196, 250); doc.setFontSize(10); doc.text(datos, 30, 258);
    }
    return {nombre: `Indice_legajo_${limpiarNombre(e.razonSocial)}_${limpiarNombre(s.nombre)}.pdf`, blob: doc.output('blob')};
  }

  // ===== Datos viejos: los "Vencimientos" de cada establecimiento pasan al legajo (una sola vez) =====
  async function migrarVencimientos(){
    const ests = await getAll('establecimientos'), todos = await leerTodo();
    for (const s of ests.filter(s => s.venc && !s.vencMigrado)) {
      for (const [actId, x] of Object.entries(s.venc)) {
        const r = reqs().find(r => (r.actividades || []).includes(actId));
        if (!r || !x.ultimo) continue;
        const id = idItem(s, r.codigo), it = todos.find(y => y.id === id) || {id, estabId: s.id, codigo: r.codigo, sub: ''};
        if (!it.emision || it.emision < x.ultimo) { Object.assign(it, {aplica: true, emision: x.ultimo, revisiones: [...(it.revisiones || []), {fecha: hoy(), visitaId: null, accion: 'Traído de Vencimientos'}]}); await put('legajo', it); }
      }
      s.vencMigrado = true;
      await put('establecimientos', s);
    }
  }

  AG.legajoInit = async () => {
    await cargarCatalogo();
    await migrarVencimientos();
    cacheTodos = await leerTodo();
    sincronizarTodo().catch(e => console.warn('Legajo', e));
  };
  AG.legajoBorrarEstab = async id => { for (const x of (await leerTodo()).filter(x => x.estabId === id)) await del('legajo', x.id); };
  AG.legajoCatalogo = () => CAT;
  AG.legajoReq = req;
})();
