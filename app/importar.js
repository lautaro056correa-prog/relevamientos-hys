// Carga masiva de clientes desde un Excel (.xlsx): reconoce las columnas por su nombre, muestra una vista previa y recién
// después guarda. No pisa datos: un cliente que ya existe (mismo CUIT o razón social) solo puede sumar establecimientos nuevos.
// Decisión del usuario: todas las columnas son obligatorias menos Notas. Los datos de la razón social se piden en la primera
// fila de cada cliente; cada establecimiento va en su fila, repitiendo solo la razón social.
// Se carga antes que app.js y se suma a AG.views / AG.acciones / AG.prev.
(() => {
  const {views, acciones, prev} = AG;

  // Orden importante: gana el primer campo que coincide ("Teléfono de contacto" es teléfono, "Nombre del establecimiento" es establecimiento)
  const CAMPOS = [
    ['estabTrab', /\b(trabajadores|empleados|dotacion|personal)\b.*\b(establecimiento|sucursal|planta|sede)\b/], ['estabResp', /\bresponsable\b.*\b(establecimiento|sucursal|planta|sede)\b/],
    ['cuit', /\b(cuit|cuil)\b/], ['telefono', /\b(tel|telefono|telefonos|celular|cel|whatsapp|wsp|movil)\b/], ['email', /\b(e ?mail|mail|correo)\b/],
    ['estab', /\b(establecimiento|sucursal|planta|sede)\b/], ['contacto', /\b(contacto|encargado|referente)\b/],
    ['domicilio', /\b(direccion|domicilio|calle)\b/], ['localidad', /\b(localidad|ciudad|municipio)\b/], ['provincia', /\bprovincia\b/],
    ['rubro', /\brubro\b/], ['actividad', /\b(actividad|giro)\b/], ['ciiu', /\bciiu\b/], ['art', /\b(art|aseguradora)\b/],
    ['trabajadores', /\b(trabajadores|empleados|dotacion|personal)\b/], ['responsable', /\bresponsable\b/], ['visitas', /\bvisitas?\b/], ['notas', /\b(notas|observaciones)\b/],
    ['razon', /\b(razon|empresa|cliente|denominacion)\b|^nombre\b/]
  ];
  // Columnas del modelo: primero la razón social (una vez por cliente), después el establecimiento (una fila por cada uno)
  const COL_EMPRESA = [['razon', 'Razón social'], ['cuit', 'CUIT'], ['rubro', 'Rubro'], ['actividad', 'Actividad'], ['art', 'ART'], ['trabajadores', 'Trabajadores (total empresa)'],
    ['responsable', 'Responsable de la empresa'], ['contacto', 'Contacto'], ['telefono', 'Teléfono'], ['email', 'Email']];
  const COL_ESTAB = [['estab', 'Establecimiento'], ['domicilio', 'Dirección'], ['localidad', 'Localidad'], ['provincia', 'Provincia'], ['estabTrab', 'Trabajadores del establecimiento'],
    ['estabResp', 'Responsable del establecimiento'], ['visitas', 'Visitas mensuales'], ['notas', 'Notas (opcional)']];
  const ETIQUETA = {...Object.fromEntries([...COL_EMPRESA, ...COL_ESTAB]), ciiu: 'CIIU', notas: 'Notas'};
  const OBL_EMPRESA = COL_EMPRESA.map(c => c[0]), OBL_ESTAB = COL_ESTAB.map(c => c[0]).filter(k => k !== 'notas');
  const esNumero = s => !isNaN(+String(s).replace(',', '.')) && String(s).trim() !== '';
  // Palabras con las que se reconoce cada rubro de config/rubros.json
  const PALABRAS_RUBRO = {metal: /metal/, alimenticia: /aliment/, quimica: /quimic|plastic/, construccion: /constru|obra/, comercio: /comerc|minorista/, deposito: /deposit|logist|mayorist/,
    gastronomia: /gastro|restaur|bar\b|cocina/, oficina: /ofic|admin/, taller: /taller|mecanic|automotor/, salud: /salud|clinic|consult|sanator/, educacion: /educ|escuela|colegio/, agro: /agro|acopio|granos|campo/, estacion: /estacion|combustible/};

  const normal = s => sinAcentos(s).replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim(); // "C.U.I.T." = "cuit"
  const compacto = s => normal(s).replace(/ /g, '');
  const digitos = s => String(s || '').replace(/\D/g, '');
  const cuitLindo = s => { const d = digitos(s); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}` : String(s || '').trim(); };

  function rubroDe(txt){
    const t = normal(txt);
    if (!t) return '';
    const exacto = CFG.rubros.find(r => r.id === t || normal(r.nombre) === t);
    if (exacto) return exacto.id;
    return Object.keys(PALABRAS_RUBRO).find(id => PALABRAS_RUBRO[id].test(t)) || '';
  }

  // ===== Lectura del .xlsx (es un zip con XML) =====
  const hijos = (n, tag) => [...n.getElementsByTagNameNS('*', tag)];
  const numeroATexto = v => /e/i.test(v) && !isNaN(+v) ? (+v).toLocaleString('fullwide', {useGrouping: false}) : v.replace(/\.0+$/, '');
  const columna = ref => { let c = 0; for (const l of (ref.match(/^[A-Z]+/)?.[0] || '')) c = c * 26 + l.charCodeAt(0) - 64; return c - 1; };

  async function leerExcel(archivo){
    await AG.lib('zip');
    const z = await JSZip.loadAsync(archivo);
    const xml = async p => { const f = z.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
    const libro = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels'), textos = await xml('xl/sharedStrings.xml');
    if (!libro || !rels) throw new Error('sin libro');
    const compartidos = textos ? hijos(textos, 'si').map(si => hijos(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('')) : [];
    const destinos = Object.fromEntries(hijos(rels, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const hojas = [];
    for (const h of hijos(libro, 'sheet')) {
      const rid = [...h.attributes].find(a => a.localName === 'id')?.value, dest = destinos[rid] || '';
      const doc = await xml(dest.startsWith('/') ? dest.slice(1) : 'xl/' + dest);
      if (!doc) continue;
      const filas = hijos(doc, 'row').map(row => {
        const celdas = [];
        hijos(row, 'c').forEach((c, i) => {
          const r = c.getAttribute('r'), t = c.getAttribute('t'), v = hijos(c, 'v')[0]?.textContent ?? '';
          const pos = r ? columna(r) : i;
          celdas[pos] = (t === 's' ? compartidos[+v] ?? '' : t === 'inlineStr' ? hijos(c, 't').map(x => x.textContent).join('') : t === 'b' ? '' : t === 'str' ? v : numeroATexto(v)).trim();
        });
        return {n: +row.getAttribute('r') || 0, celdas};
      });
      hojas.push({nombre: h.getAttribute('name'), filas});
    }
    return hojas;
  }

  // Busca en las primeras filas la que más columnas reconoce y tiene la razón social (arriba puede haber títulos o bandas de color)
  function encontrarEncabezado(hojas){
    for (const h of hojas) {
      let mejor = null;
      for (const [i, f] of h.filas.slice(0, 15).entries()) {
        const mapa = {}, ignoradas = [];
        f.celdas.forEach((txt, col) => {
          if (!txt) return;
          const n = normal(txt), campo = CAMPOS.find(([k, rx]) => rx.test(n) && mapa[k] == null);
          if (campo) mapa[campo[0]] = col; else ignoradas.push(txt);
        });
        if (mapa.razon != null && (!mejor || Object.keys(mapa).length > Object.keys(mejor.mapa).length)) mejor = {hoja: h, inicio: i + 1, mapa, ignoradas};
      }
      if (mejor) return mejor;
    }
    return null;
  }
  // Columnas obligatorias que no están. Un Excel con una sola columna de trabajadores o responsable sirve para los dos niveles.
  const columnasFaltantes = mapa => [...OBL_EMPRESA, ...OBL_ESTAB].filter(k => mapa[k] == null && !(k === 'estabTrab' && mapa.trabajadores != null) && !(k === 'estabResp' && mapa.responsable != null));

  // ===== De filas a clientes, comparando con lo que ya está cargado =====
  function armar(enc, empresas, estabs){
    const {hoja, inicio, mapa} = enc, grupos = new Map(), errores = [], avisos = [];
    const porCuit = new Map(empresas.filter(e => digitos(e.cuit).length === 11).map(e => [digitos(e.cuit), e]));
    const porNombre = new Map(empresas.map(e => [compacto(e.razonSocial), e]));
    for (const f of hoja.filas.slice(inicio)) {
      const dato = k => mapa[k] == null ? '' : (f.celdas[mapa[k]] || '');
      if (!f.celdas.some(Boolean)) continue;
      const razon = dato('razon'), cuit = digitos(dato('cuit'));
      if (!razon) { errores.push(`Fila ${f.n}: falta la razón social.`); continue; }
      const nombre = compacto(razon), clave = cuit.length === 11 ? cuit : nombre;
      let g = grupos.get(clave) || grupos.get(nombre);
      if (!g) {
        const existente = (cuit.length === 11 && porCuit.get(cuit)) || porNombre.get(nombre) || null;
        // La primera fila de un cliente nuevo tiene que traer todos los datos de la razón social
        const faltan = existente ? [] : OBL_EMPRESA.filter(k => !dato(k)).map(k => ETIQUETA[k]);
        const mal = [];
        if (!existente) {
          if (dato('cuit') && cuit.length !== 11) mal.push(`el CUIT "${dato('cuit')}" no tiene 11 números`);
          if (dato('rubro') && !rubroDe(dato('rubro'))) mal.push(`el rubro "${dato('rubro')}" no se reconoce (elegilo de la lista)`);
          if (dato('trabajadores') && !esNumero(dato('trabajadores'))) mal.push('los trabajadores de la empresa tienen que ser un número');
        }
        g = {razon, fila: f.n, cuit: dato('cuit'), rubro: rubroDe(dato('rubro')), actividad: dato('actividad'), art: dato('art'), trabajadores: dato('trabajadores'), responsable: dato('responsable'),
          contactos: dato('contacto') ? [{nombre: dato('contacto'), rol: '', telefono: dato('telefono'), email: dato('email')}] : [], estabs: [], existente, invalido: !!(faltan.length || mal.length)};
        grupos.set(clave, g); grupos.set(nombre, g);
        if (g.invalido) errores.push(`Fila ${f.n} (${razon}): ${[faltan.length ? 'falta ' + faltan.join(', ') : '', ...mal].filter(Boolean).join('; ')}.`);
        else if (!existente && dato('email') && !dato('email').includes('@')) avisos.push(`Fila ${f.n} (${razon}): el email "${dato('email')}" no parece correcto. Se carga igual, revisalo.`);
      } else if (g.invalido) { errores.push(`Fila ${f.n} (${razon}): no se carga hasta corregir la fila ${g.fila}.`); continue; }
      if (g.invalido) continue;
      // Cada fila es un establecimiento
      const nombreEst = dato('estab'), dom = dato('domicilio');
      const coincide = lista => lista.some(s => (nombreEst && compacto(s.nombre) === compacto(nombreEst)) || (dom && compacto(s.domicilio) === compacto(dom)));
      if (coincide(g.existente ? estabs.filter(s => s.empresaId === g.existente.id) : [])) continue;
      if (coincide(g.estabs)) { avisos.push(`Fila ${f.n} (${razon}): el establecimiento está repetido en el Excel y se carga una sola vez.`); continue; }
      const est = {nombre: nombreEst, domicilio: dom, localidad: dato('localidad'), provincia: dato('provincia'), responsable: dato('estabResp') || dato('responsable'), trabajadores: dato('estabTrab') || dato('trabajadores'), visitas: dato('visitas'), notas: dato('notas')};
      const faltanEst = [['estab', est.nombre], ['domicilio', est.domicilio], ['localidad', est.localidad], ['provincia', est.provincia], ['estabTrab', est.trabajadores], ['estabResp', est.responsable], ['visitas', est.visitas]].filter(x => !x[1]).map(x => ETIQUETA[x[0]]);
      const malEst = [est.trabajadores && !esNumero(est.trabajadores) ? 'los trabajadores del establecimiento tienen que ser un número' : '', est.visitas && !(Number.isInteger(+est.visitas) && +est.visitas > 0) ? 'las visitas mensuales tienen que ser un número entero mayor que cero' : ''].filter(Boolean);
      if (faltanEst.length || malEst.length) { errores.push(`Fila ${f.n} (${razon}): ${[faltanEst.length ? 'falta ' + faltanEst.join(', ') : '', ...malEst].filter(Boolean).join('; ')}.`); continue; }
      g.estabs.push(est);
    }
    const lista = [...new Set(grupos.values())].filter(g => !g.invalido);
    for (const g of lista) if (!g.existente && !g.estabs.length) errores.push(`${g.razon}: no se carga porque no tiene ningún establecimiento completo.`);
    return {nuevos: lista.filter(g => !g.existente && g.estabs.length), suman: lista.filter(g => g.existente && g.estabs.length), repetidos: lista.filter(g => g.existente && !g.estabs.length), errores, avisos};
  }

  // ===== Pantalla =====
  prev.importarClientes = () => raiz();
  views.importarClientes = {
    title: () => 'Cargar clientes desde Excel',
    html(){
      const P = S.imp, H = S.impHecho;
      if (H) return `<div class="stack"><div class="okbox">${ic('ok')}<div><b>Carga lista.</b> ${plural(H.empresas.length, 'cliente nuevo', 'clientes nuevos')} y ${plural(H.estabs.length, 'establecimiento', 'establecimientos')}.</div></div>
        ${aviso('info', 'info', 'Si algo salió mal, podés deshacer ahora. Cuando salgas de esta pantalla, ya no.')}
        <button class="btn block" ${on('impIrClientes')}>${ic('edificio')}Ver mis clientes</button>
        <button class="btn ghost block" ${on('impDeshacer')}>Deshacer esta carga</button></div>`;
      const elegir = txt => `<label class="btn ${P ? 'sec' : ''} block">${ic('doc')}${txt}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden ${oc('impArchivo')}></label>`;
      if (!P) return `<div class="stack">
        ${aviso('info', 'info', '<b>1.</b> Bajá la planilla modelo y completala: trae un ejemplo y todas las columnas son obligatorias, menos Notas.<br><b>2.</b> Subila. Antes de guardar, la app te muestra todo para que lo revises.')}
        <button class="btn block" ${on('impModelo')}>${ic('descarga')}Bajar planilla modelo</button>
        <label class="btn sec block">${ic('doc')}Subir la planilla completa<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden ${oc('impArchivo')}></label>
        <p class="sub" style="margin:0">Si un cliente tiene varios establecimientos, va una fila por cada uno repitiendo la razón social. Los clientes que ya tenés no se modifican.</p></div>`;
      const fila = g => `<div class="el"><div><b>${esc(g.razon)}</b><div class="sub">${esc([g.cuit && cuitLindo(g.cuit), plural(g.estabs.length, 'establecimiento', 'establecimientos'), g.existente ? '' : rubro(g.rubro)?.nombre].filter(Boolean).join(' · '))}</div>
        ${g.estabs.length ? `<div class="sub">${esc(g.estabs.map(s => s.nombre).join(' · '))}</div>` : ''}</div></div>`;
      const plegado = (titulo, lista, abierto = false) => lista.length ? `<details class="card fold" ${abierto ? 'open' : ''}><summary><div><b>${titulo}</b></div>${ic('chev', 'chev')}</summary>${lista.join('')}</details>` : '';
      const nota = t => `<div class="el"><div class="sub">${esc(t)}</div></div>`;
      const totalEst = [...P.nuevos, ...P.suman].reduce((t, g) => t + g.estabs.length, 0), hay = P.nuevos.length || P.suman.length;
      return `<div class="stack">
        <div class="card"><b>${esc(P.archivo)}</b><div class="sub">Hoja "${esc(P.hoja)}". Columnas reconocidas: ${esc(P.columnas.join(', '))}.</div>
          ${P.ignoradas.length ? `<p class="hint">No se usan: ${esc(P.ignoradas.join(', '))}.</p>` : ''}</div>
        <div class="kpis">${[[P.nuevos.length, 'Clientes nuevos', 'b-ok'], [totalEst, 'Establecimientos', 'b-azul'], [P.repetidos.length, 'Ya cargados', 'b-na'], [P.errores.length, 'Filas con error', P.errores.length ? 'b-bad' : 'b-na']]
          .map(([n, t, c]) => `<div class="kpi ${c}"><b>${n}</b><span>${t}</span></div>`).join('')}</div>
        ${P.errores.length ? aviso('aviso', 'alerta', 'Las filas con error no se cargan. Podés cargar el resto ahora, corregir esas filas en el Excel y volver a subirlo: lo ya cargado no se duplica.') : ''}
        ${plegado(`Filas con error (${P.errores.length})`, P.errores.map(nota), true)}
        ${plegado(`Para revisar (${P.avisos.length})`, P.avisos.map(nota), true)}
        ${plegado(`Clientes nuevos (${P.nuevos.length})`, P.nuevos.map(fila), true)}
        ${plegado(`Ya cargados: suman establecimientos (${P.suman.length})`, P.suman.map(fila))}
        ${plegado(`Ya cargados: no cambian (${P.repetidos.length})`, P.repetidos.map(g => nota(g.razon)))}
        ${elegir('Elegir otro Excel')}
      </div>
      <div class="bottom-bar"><div class="actions"><button class="btn ghost" ${on('impCancelar')}>Cancelar</button>${hay ? `<button class="btn" ${on('impGuardar')}>${ic('check')}Cargar</button>` : ''}</div></div>`;
    }
  };
  acciones.impAbrir = () => { S.imp = null; S.impHecho = null; go('importarClientes'); };
  acciones.impModelo = async () => {
    const nE = COL_EMPRESA.length, nS = COL_ESTAB.length, ultima = Planilla.col(nE + nS - 1);
    const bandas = alto => ({alto, celdas: [{v: '1. DATOS DE LA RAZÓN SOCIAL: se completan una sola vez por cada cliente', s: 'enc'}, ...Array(nE - 1).fill(null), {v: '2. DATOS DEL ESTABLECIMIENTO: una fila por cada uno', s: 'azul'}]});
    const titulos = {alto: 32, celdas: [...COL_EMPRESA.map(c => ({v: c[1], s: 'enc'})), ...COL_ESTAB.map(c => ({v: c[1], s: 'azul'}))]};
    const anchos = [...COL_EMPRESA, ...COL_ESTAB].map(([k]) => ({razon: 32, rubro: 30, actividad: 28, domicilio: 28, estab: 24, email: 26, notas: 28}[k] || 17));
    const combinar = i => [`A${i}:${Planilla.col(nE - 1)}${i}`, `${Planilla.col(nE)}${i}:${ultima}${i}`];
    const fila = a => a.map(v => v === '' ? '' : {v, s: 'celda'});
    const ejemplo = [
      fila(['Metalúrgica Ejemplo SA', '30-12345678-9', CFG.rubros.find(r => r.id === 'metal').nombre, 'Fabricación de estructuras', 'ART Ejemplo', 40, 'Juan Pérez', 'María Gómez', '341 5000000', 'maria@ejemplo.com', 'Planta Baigorria', 'Ruta 9 km 300', 'Granadero Baigorria', 'Santa Fe', 30, 'Carlos Díaz', 4, '']),
      fila(['Metalúrgica Ejemplo SA', '', '', '', '', '', '', '', '', '', 'Depósito Centro', 'San Martín 1200', 'Rosario', 'Santa Fe', 10, 'Laura Ruiz', 2, 'Mismo cliente, otro establecimiento']),
      fila(['Bar Ejemplo SRL', '30-98765432-1', CFG.rubros.find(r => r.id === 'gastronomia').nombre, 'Restaurante', 'ART Ejemplo', 12, 'Ana Torres', 'Ana Torres', '341 6000000', 'ana@ejemplo.com', 'Local Centro', 'Córdoba 800', 'Rosario', 'Santa Fe', 12, 'Ana Torres', 1, ''])
    ];
    const blob = Planilla.generar([
      {nombre: 'Clientes', filas: [bandas(24), titulos], anchos, combinar: combinar(1), fijarFila: 2,
        listas: [{rango: 'C3:C1000', lista: `Rubros!$A$1:$A$${CFG.rubros.length}`, error: 'Elegí el rubro de la lista.'}]},
      {nombre: 'Ejemplo', anchos, combinar: combinar(5), filas: [[{v: 'Cómo completar la planilla (los datos de esta hoja no se cargan)', s: 'subtitulo'}],
        ['Completá la hoja "Clientes". Todas las columnas son obligatorias, menos Notas.'],
        ['Cliente con varios establecimientos: en la primera fila completá todo. En las siguientes repetí la razón social y completá solo el bloque 2, como Metalúrgica Ejemplo en este ejemplo.'],
        ['Visitas mensuales: cuántas veces por mes vas a ese establecimiento. Con ese número, el Asistente de la app te avisa cuándo te toca agendar la próxima.'], bandas(24), titulos, ...ejemplo]},
      {nombre: 'Rubros', anchos: [45], filas: CFG.rubros.map(r => [r.nombre])}
    ]);
    if (await guardarArchivo('Planilla_clientes.xlsx', blob)) toast('Planilla descargada');
  };
  acciones.impArchivo = async t => {
    const f = t.files?.[0];
    t.value = '';
    if (!f) return;
    toast('Leyendo el Excel…');
    let hojas;
    try { hojas = await leerExcel(f); }
    catch (e) { console.error(e); return avisar('No se pudo leer el archivo. Tiene que ser un Excel .xlsx: si es un .xls viejo, abrilo y guardalo como .xlsx. Sin señal, puede faltar la herramienta de lectura: probá con internet.'); }
    const enc = encontrarEncabezado(hojas);
    if (!enc) return avisar('No encontré la columna de la razón social. Bajá la planilla modelo y completala.');
    const faltan = columnasFaltantes(enc.mapa);
    if (faltan.length) return avisar(`A este Excel le faltan columnas obligatorias: ${faltan.map(k => ETIQUETA[k]).join(', ')}. Bajá la planilla modelo y pasá los datos ahí.`);
    const R = armar(enc, await getAll('empresas'), await getAll('establecimientos'));
    S.imp = {...R, archivo: f.name, hoja: enc.hoja.nombre, columnas: Object.keys(enc.mapa).map(k => ETIQUETA[k]), ignoradas: enc.ignoradas};
    S.impHecho = null;
    render();
    scrollTo(0, 0);
  };
  acciones.impCancelar = () => { S.imp = null; go(raiz()); };
  acciones.impGuardar = async () => {
    const P = S.imp, hecho = {empresas: [], estabs: []}, ahora = Date.now();
    const sumarEstabs = async (g, empresaId) => {
      for (const s of g.estabs) {
        const id = uid();
        await put('establecimientos', {id, empresaId, programa: {}, creado: ahora, nombre: s.nombre, domicilio: s.domicilio, localidad: s.localidad, provincia: s.provincia, responsable: s.responsable,
          trabajadores: s.trabajadores, superficie: '', horario: '', notas: s.notas, lat: null, lng: null, frecVisita: '', visitasMes: +s.visitas, horasMes: '', fotoObligatoria: ''});
        hecho.estabs.push(id);
      }
    };
    toast('Cargando clientes…');
    for (const g of P.nuevos) {
      const id = uid();
      await put('empresas', {id, creado: ahora, razonSocial: g.razon, cuit: cuitLindo(g.cuit), rubro: g.rubro, actividad: g.actividad, ciiu: '', trabajadores: g.trabajadores, art: g.art,
        responsable: g.responsable, notas: '', riesgos: [], programas: [], logo: null, contactos: g.contactos});
      hecho.empresas.push(id);
      await sumarEstabs(g, id);
    }
    for (const g of P.suman) await sumarEstabs(g, g.existente.id);
    S.imp = null;
    S.impHecho = hecho;
    render();
    scrollTo(0, 0);
  };
  acciones.impDeshacer = async () => {
    const H = S.impHecho;
    if (!(await confirmar(`Se borran los ${H.empresas.length} clientes y ${H.estabs.length} establecimientos de esta carga. Lo que ya tenías no se toca. ¿Deshacer?`, 'Deshacer'))) return;
    for (const id of H.estabs) await del('establecimientos', id);
    for (const id of H.empresas) await del('empresas', id);
    S.impHecho = null;
    toast('Carga deshecha');
    render();
  };
  acciones.impIrClientes = () => { S.impHecho = null; A.tab(null, 'clientes'); };
})();
