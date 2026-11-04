// Generador del informe técnico en Word (.docx), común a todos los módulos.
// Recibe el modelo que arma Motor.calcular() y construye el documento con la librería docx,
// controlando keepNext / cantSplit / sombreados desde código (sin plantillas .docx).
const Informe = (() => {
  const AZUL = '1F3864', BORDE = 'BFBFBF', GRIS = '595959', SECCION = 'E9EEF5';
  const ANCHO = 9638;          // ancho útil A4 con márgenes de 2 cm, en twips
  const PX_CM = 37.795;        // la librería mide las imágenes en px a 96 dpi
  const COLOR = {
    C: ['E2EFDA', '375623'], NC: ['F4CCCC', 'C00000'], NA: ['F2F2F2', GRIS],
    ALTA: ['F4CCCC', 'C00000'], MEDIA: ['FFF2CC', '7F6000'], BAJA: ['E2EFDA', '375623'],
    CONFORME: ['E2EFDA', '375623'], 'NO CONFORME': ['F4CCCC', 'C00000'],
    Cerrada: ['E2EFDA', '375623'], Pendiente: ['F4CCCC', 'C00000'], 'No verificada': ['F2F2F2', GRIS]
  };
  const ETIQ = {C: 'Cumple', NC: 'No cumple', NA: 'N/A'};

  let D; // window.docx, se toma al generar

  // ---------- Bloques básicos ----------
  const run = (text, o = {}) => new D.TextRun({
    text: String(text ?? ''), bold: o.bold, italics: o.italics, color: o.color, size: o.size,
    shading: o.fill ? {type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill} : undefined
  });

  function par(contenido, o = {}){
    const children = Array.isArray(contenido) ? contenido : [run(contenido, o)];
    return new D.Paragraph({
      children, alignment: o.align, heading: o.heading, pageBreakBefore: o.pageBreakBefore,
      keepNext: !!o.keepNext, keepLines: true,
      spacing: {before: o.before ?? 0, after: o.after ?? 80},
      bullet: o.bullet ? {level: 0} : undefined,
      border: o.borderBottom ? {bottom: {style: D.BorderStyle.SINGLE, size: 8, color: AZUL, space: 2}} : undefined
    });
  }

  // Texto con varias líneas: "• " = viñeta; línea corta que termina en ":" = subtítulo en negrita
  function lineas(texto, o = {}){
    const ls = String(texto || '').split('\n').filter(l => l.trim());
    return ls.map((l, i) => {
      const keep = o.keepNext || i < ls.length - 1;
      if (l.startsWith('• ')) return par(l.slice(2), {bullet: true, keepNext: keep});
      if (l.endsWith(':') && l.length < 60) return par(l, {bold: true, keepNext: true, before: 80});
      return par(l, {keepNext: keep, align: D.AlignmentType.JUSTIFIED});
    });
  }

  const titulo = (txt, nivel, o = {}) => par([run(txt)], {
    heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3][nivel - 1],
    keepNext: true, borderBottom: nivel === 1, pageBreakBefore: o.pageBreakBefore,
    before: nivel === 1 ? 280 : nivel === 2 ? 200 : 160, after: nivel === 1 ? 120 : 80
  });

  function b64(dataUrl){
    const s = atob(dataUrl.split(',')[1]);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  // Imagen ajustada dentro de una caja (cm) sin deformar
  function imagen(img, maxWcm, maxHcm){
    const w = img.w || 1600, h = img.h || 1200;
    const s = Math.min(maxWcm * PX_CM / w, maxHcm * PX_CM / h);
    return new D.ImageRun({type: img.tipo || 'jpg', data: b64(img.data), transformation: {width: Math.round(w * s), height: Math.round(h * s)}});
  }

  // ---------- Tablas ----------
  function celda(c, w, keepNext){
    const o = typeof c === 'object' && c !== null && !Array.isArray(c) && !(c instanceof D.Paragraph) ? c : {t: c};
    let paras;
    if (Array.isArray(o.t) && o.t[0] instanceof D.Paragraph) paras = o.t;
    else if (Array.isArray(o.t)) paras = [par(o.t, {after: 0, keepNext, align: o.align})];
    else paras = String(o.t ?? '').split('\n').map(l => par(l, {after: 0, keepNext, align: o.align, bold: o.bold, color: o.color, size: o.size ?? 18, italics: o.italics}));
    if (o.t instanceof D.Paragraph) paras = [o.t];
    return new D.TableCell({
      children: paras, columnSpan: o.span, verticalAlign: D.VerticalAlign.CENTER,
      width: {size: w, type: D.WidthType.DXA},
      shading: o.fill ? {type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill} : undefined,
      margins: {top: 45, bottom: 45, left: 90, right: 90},
      borders: o.borders
    });
  }

  const estado = (txt, clave) => ({t: txt, fill: COLOR[clave]?.[0], color: COLOR[clave]?.[1], bold: true, align: D.AlignmentType.CENTER});

  /**
   * filas: array de arrays de celdas, o {seccion: 'Título'} para una fila de sección.
   * keep: 'todo' (toda la tabla pegada a lo que sigue), 'auto' (no se corta y queda con su título;
   * si es más larga que ~20 filas se permite el corte repitiendo el encabezado), 'nada'.
   */
  function tabla({encabezados, filas, anchos, keep = 'auto', sinBordes = false, tamano}){
    const largo = filas.length > 20;
    const rows = [];
    const keepFila = i => keep === 'todo' || (keep === 'auto' && (largo ? i < 2 : i < filas.length - 1));
    if (encabezados) rows.push(new D.TableRow({
      tableHeader: true, cantSplit: true,
      children: encabezados.map((h, i) => celda({t: h, fill: AZUL, color: 'FFFFFF', bold: true, size: tamano}, anchos[i], keep !== 'nada' && filas.length > 0))
    }));
    filas.forEach((f, i) => {
      const k = keepFila(i);
      const cells = f.seccion != null
        ? [celda({t: f.seccion, fill: SECCION, bold: true, span: anchos.length, size: tamano}, ANCHO, k)]
        : f.map((c, j) => celda(typeof c === 'object' && c && !Array.isArray(c) ? {size: tamano, ...c} : {t: c, size: tamano}, anchos[j] ?? anchos[0], k));
      rows.push(new D.TableRow({cantSplit: true, children: cells}));
    });
    const b = sinBordes ? {style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF'} : {style: D.BorderStyle.SINGLE, size: 4, color: BORDE};
    return new D.Table({
      rows, columnWidths: anchos, layout: D.TableLayoutType.FIXED,
      width: {size: anchos.reduce((a, b) => a + b, 0), type: D.WidthType.DXA},
      borders: {top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b}
    });
  }

  // Fotos de a dos por fila, mismo tamaño de caja, con epígrafe
  function tablaFotos(fotos, keepTodo){
    const mitad = ANCHO / 2;
    if (!fotos.length) return tabla({filas: [[{t: 'Sin registro fotográfico', fill: 'F2F2F2', color: GRIS, italics: true, align: D.AlignmentType.CENTER}]], anchos: [ANCHO], keep: keepTodo ? 'todo' : 'nada'});
    const filas = [];
    for (let i = 0; i < fotos.length; i += 2) {
      // Word encadena una fila con lo que sigue si CUALQUIER párrafo de la fila tiene keepNext:
      // en la última fila ninguno puede tenerlo, o la ficha se pega al bloque siguiente.
      const keep = keepTodo || i + 2 < fotos.length;
      filas.push([fotos[i], fotos[i + 1]].map((f, j) => f ? {t: [
        par([imagen(f, 7.9, 5.9)], {align: D.AlignmentType.CENTER, after: 40, keepNext: keep}),
        par(`Foto ${i + j + 1}${f.descripcion ? '. ' + f.descripcion : ''}`, {align: D.AlignmentType.CENTER, after: 0, size: 16, italics: true, keepNext: keep})
      ]} : ''));
    }
    return tabla({filas, anchos: [mitad, mitad], keep: keepTodo ? 'todo' : 'auto'});
  }

  // "Planta Norte – Suipacha 955, Granadero Baigorria" (sin repetir si el nombre del establecimiento es la dirección)
  function lugarEstablecimiento(e, conProvincia){
    const dir = [e.domicilio, e.localidad, conProvincia && e.provincia].filter(Boolean).join(', ');
    return [e.establecimiento !== e.domicilio && e.establecimiento, dir].filter(Boolean).join(' – ');
  }

  // ---------- Partes del informe ----------
  function caratula(M, perfil){
    const e = M.empresa, out = [];
    const logoC = e.logo, logoP = perfil.logo;
    if (logoC || logoP) out.push(tabla({sinBordes: true, keep: 'todo', anchos: [ANCHO / 2, ANCHO / 2], filas: [[
      {t: [par(logoC ? [imagen(logoC, 5, 2.6)] : [run('')], {after: 0, keepNext: true})]},
      {t: [par(logoP ? [imagen(logoP, 5, 2.6)] : [run('')], {after: 0, keepNext: true, align: D.AlignmentType.RIGHT})]}
    ]]}));
    out.push(par('INFORME TÉCNICO', {bold: true, size: 56, color: AZUL, align: D.AlignmentType.CENTER, before: 2600, after: 160}));
    out.push(par(M.subtitulo, {size: 30, color: AZUL, align: D.AlignmentType.CENTER, after: 120, borderBottom: true}));
    out.push(par(M.normasCaratula.join('  ·  '), {size: 18, color: GRIS, align: D.AlignmentType.CENTER, before: 120, after: 1400}));
    const rubro = [M.rubroNombre, e.actividad].filter(Boolean).join(' – ');
    const datos = [
      ['Razón social', e.razonSocial], ['CUIT', e.cuit],
      ['Establecimiento', lugarEstablecimiento(e, true)],
      ['Actividad', rubro],
      ['Fecha de relevamiento', Motor.fmtFecha(M.rel.fecha_relevamiento)],
      ['Fecha de emisión', Motor.fmtFecha(M.rel.fecha_emision)],
      ['Profesional actuante', [perfil.nombre, perfil.titulo].filter(Boolean).join(' – ')],
      ['Matrícula', perfil.matricula]
    ].filter(([k, v]) => v || ['Razón social', 'Fecha de relevamiento', 'Profesional actuante'].includes(k));
    out.push(tabla({anchos: [3000, ANCHO - 3000], keep: 'nada', filas: datos.map(([k, v]) => [{t: k, bold: true, fill: 'F2F2F2', size: 20}, {t: v || '—', size: 20}])}));
    return out;
  }

  function encabezado(M, perfil){
    const e = M.empresa, ninguno = {style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF'};
    const bordes = {top: ninguno, left: ninguno, right: ninguno, bottom: {style: D.BorderStyle.SINGLE, size: 8, color: AZUL}};
    const logo = (img, align) => [par(img ? [imagen(img, 3.4, 1.4)] : [run('')], {after: 0, align})];
    return new D.Header({children: [tabla({sinBordes: true, keep: 'nada', anchos: [2300, ANCHO - 4600, 2300], filas: [[
      {t: logo(e.logo, D.AlignmentType.LEFT), borders: bordes},
      {t: [par('INFORME TÉCNICO', {bold: true, color: AZUL, size: 22, align: D.AlignmentType.CENTER, after: 0}),
           par(M.subtitulo, {size: 17, color: GRIS, align: D.AlignmentType.CENTER, after: 0})], borders: bordes},
      {t: logo(perfil.logo, D.AlignmentType.RIGHT), borders: bordes}
    ]]}), par('', {after: 0, size: 8})]});
  }

  function pie(M, perfil){
    const prof = [perfil.nombre, perfil.matricula && 'Mat. ' + perfil.matricula].filter(Boolean).join(' – ');
    const txt = [M.empresa.razonSocial, prof].filter(Boolean).join('  ·  ');
    return new D.Footer({children: [new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      border: {top: {style: D.BorderStyle.SINGLE, size: 4, color: BORDE, space: 4}},
      children: [run(txt + '  ·  ', {size: 16, color: GRIS}),
        new D.TextRun({children: ['Página ', D.PageNumber.CURRENT, ' de ', D.PageNumber.TOTAL_PAGES], size: 16, color: GRIS})]
    })]});
  }

  function filasChecklist(mod, items, ev, conSecciones){
    const filas = [];
    let n = 0;
    const fila = it => {
      const r = ev.res[it.clave];
      return [{t: String(++n), align: D.AlignmentType.CENTER}, it.texto,
        r ? estado(ETIQ[r.valor], r.valor) : {t: '—', align: D.AlignmentType.CENTER},
        r?.obs || ''];
    };
    if (conSecciones && mod.secciones?.length) {
      for (const s of mod.secciones) {
        const its = items.filter(i => i.seccion === s.clave);
        if (its.length) { filas.push({seccion: s.titulo}); its.forEach(it => filas.push(fila(it))); }
      }
      items.filter(i => !i.seccion || !mod.secciones.some(s => s.clave === i.seccion)).forEach(it => filas.push(fila(it)));
    } else items.forEach(it => filas.push(fila(it)));
    return filas;
  }

  function columnasPlanilla(mod){
    const fijas = {nombre: 1500, sector: 1350, resultado: 1350, desvios: 900};
    const cols = (mod.columnas_planilla_resumen || ['nombre', 'sector', 'resultado']).map(c => {
      const at = (mod.atributos || []).find(a => a.clave === c), it = mod.items.find(i => i.clave === c);
      const enc = {nombre: mod.nombre_elemento, sector: 'Sector', resultado: 'Resultado', desvios: 'Desvíos'}[c]
        || at?.etiqueta_corta || at?.etiqueta || it?.etiqueta_corta || it?.texto || c;
      const val = e => {
        if (c === 'nombre') return e.nombre;
        if (c === 'sector') return e.sector;
        if (c === 'resultado') return estado(e.resultado, e.resultado);
        if (c === 'desvios') return {t: String(e.ev.conteo.NC), align: D.AlignmentType.CENTER};
        if (at) return Motor.fmtAtributo(at, e.el.atributos?.[c]);
        const r = e.ev.res[c];
        return r ? estado(ETIQ[r.valor], r.valor) : '—';
      };
      return {c, enc, val, w: fijas[c]};
    });
    const libres = cols.filter(c => !c.w), usado = cols.reduce((s, c) => s + (c.w || 0), 0);
    libres.forEach(c => c.w = Math.floor((ANCHO - usado) / libres.length));
    const dif = ANCHO - cols.reduce((s, c) => s + c.w, 0);
    cols[cols.length - 1].w += dif;
    return cols;
  }

  function tarjetas(ind, usadas){
    const t = [
      {n: ind.elementos, l: 'Elementos relevados', c: ['DEEAF6', AZUL]},
      {n: ind.conformes, l: 'Conformes', c: COLOR.C},
      {n: ind.noConformes, l: 'No conformes', c: COLOR.NC},
      ...(usadas.length ? usadas.map(p => ({n: ind.prioridades[p], l: `Desvíos ${p}`, c: COLOR[p]})) : [{n: 0, l: 'Desvíos', c: COLOR.C}]),
      {n: ind.pct + ' %', l: 'Cumplimiento', c: ['DEEAF6', AZUL]}
    ];
    const w = Math.floor(ANCHO / t.length), anchos = t.map((_, i) => i === t.length - 1 ? ANCHO - w * (t.length - 1) : w);
    return tabla({anchos, keep: 'nada', filas: [t.map(x => ({fill: x.c[0], t: [
      par(String(x.n), {bold: true, size: 36, color: x.c[1], align: D.AlignmentType.CENTER, after: 0}),
      par(x.l, {size: 16, color: x.c[1], align: D.AlignmentType.CENTER, after: 0})
    ]}))]});
  }

  // ---------- Documento completo ----------
  function construir(M, ctx){
    D = window.docx;
    const P = ctx.plantillas, perfil = ctx.perfil || {}, multi = M.multi;
    const body = [];
    let n = 0;
    const H1 = (t, o) => { n++; body.push(titulo(`${n}. ${t.toUpperCase()}`, 1, o)); return n; };
    const nombreEl = (d) => d.elemento ? `${d.elemento.nombre}${d.elemento.sector && d.mod.tipo_elemento === 'equipo' ? ` (${d.elemento.sector})` : ''}` : `General${multi ? ' – ' + d.mod.titulo : ''}`;

    body.push(...caratula(M, perfil));

    // 1. Objetivo
    H1('Objetivo', {pageBreakBefore: true});
    body.push(...lineas(M.textos.objetivo));

    // 2. Alcance
    H1('Alcance');
    body.push(...lineas(M.textos.alcance));

    // 3. Marco normativo
    H1('Marco normativo');
    body.push(par('Se tomó como referencia la siguiente normativa:', {keepNext: true}));
    body.push(tabla({encabezados: ['Norma', 'Aplicación'], anchos: [3600, ANCHO - 3600], filas: M.normas.map(x => [{t: x.codigo, bold: true}, x.aplicacion])}));

    // 4. Metodología
    const s4 = H1('Metodología');
    const acomp = M.rel.acompanante ? `, acompañados por ${M.rel.acompanante}` : '';
    body.push(...lineas(P.metodologia.replace('{acompanante_frase}', acomp)));
    M.modulos.forEach(m => m.mod.textos.metodologia && body.push(...lineas((multi ? m.mod.titulo + ': ' : '') + m.mod.textos.metodologia)));
    let k = 0;
    for (const m of M.modulos) {
      body.push(titulo(`${s4}.${++k} ${multi ? 'Ítems de verificación – ' + m.mod.titulo : 'Ítems de verificación y criterios de aceptación'}`, 2));
      const filas = [];
      let i = 0;
      const fila = it => [{t: String(++i), align: D.AlignmentType.CENTER}, {t: it.texto, bold: true}, it.criterio, it.norma];
      if (m.mod.secciones?.length) m.mod.secciones.forEach(s => {
        const its = m.mod.items.filter(it => it.seccion === s.clave);
        if (its.length) { filas.push({seccion: s.titulo}); its.forEach(it => filas.push(fila(it))); }
      });
      else m.mod.items.forEach(it => filas.push(fila(it)));
      if (m.mod.items_generales?.length) { filas.push({seccion: 'Verificaciones generales'}); m.mod.items_generales.forEach(it => filas.push(fila(it))); }
      body.push(tabla({encabezados: ['N°', 'Ítem', 'Criterio de aceptación', 'Norma'], anchos: [450, 2700, ANCHO - 5350, 2200], filas}));
    }
    body.push(titulo(`${s4}.${++k} Criterio de priorización`, 2));
    if (M.prioridadesUsadas.length) {
      body.push(par('Los desvíos detectados se clasificaron según la siguiente prioridad:', {keepNext: true}));
      body.push(tabla({encabezados: ['Prioridad', 'Criterio', 'Plazo de corrección'], anchos: [1300, ANCHO - 3600, 2300],
        filas: M.prioridadesUsadas.map(p => [estado(p, p), P.prioridades[p].descripcion, P.prioridades[p].plazo])}));
    } else body.push(par('No se detectaron desvíos, por lo que no fue necesario aplicar el criterio de priorización.'));

    // 5. Resumen de resultados
    const s5 = H1('Resumen de resultados');
    body.push(par('Indicadores del relevamiento:', {keepNext: true}));
    body.push(tarjetas(M.total, M.prioridadesUsadas));
    k = 0;
    if (multi) {
      body.push(titulo(`${s5}.${++k} Cumplimiento por módulo`, 2));
      body.push(tabla({encabezados: ['Módulo', 'Elementos', 'Conformes', 'No conformes', 'Desvíos', '% cumplimiento'], anchos: [ANCHO - 7000, 1300, 1300, 1400, 1300, 1700],
        filas: [...M.modulos.map(m => [{t: m.mod.titulo, bold: true}, ...[m.ind.elementos, m.ind.conformes, m.ind.noConformes, m.ind.desvios, m.ind.pct + ' %'].map(v => ({t: String(v), align: D.AlignmentType.CENTER}))]),
          [{t: 'Total', bold: true, fill: 'F2F2F2'}, ...[M.total.elementos, M.total.conformes, M.total.noConformes, M.total.desvios, M.total.pct + ' %'].map(v => ({t: String(v), bold: true, fill: 'F2F2F2', align: D.AlignmentType.CENTER}))]]}));
    }
    for (const m of M.modulos) {
      if (m.mod.tipo_elemento === 'establecimiento') continue;
      body.push(titulo(`${s5}.${++k} Planilla resumen${multi ? ' – ' + m.mod.titulo : ''}`, 2));
      const cols = columnasPlanilla(m.mod);
      body.push(tabla({encabezados: cols.map(c => c.enc), anchos: cols.map(c => c.w), tamano: 17, filas: m.elementos.map(e => cols.map(c => c.val(e)))}));
    }

    // 6. Detalle por elemento
    const s6 = H1('Detalle por elemento');
    k = 0;
    for (const m of M.modulos) {
      if (multi) body.push(titulo(`${s6}.${++k} ${m.mod.titulo}`, 2));
      for (const e of m.elementos) {
        body.push(titulo(e.sector && m.mod.tipo_elemento === 'equipo' ? `${e.nombre} — ${e.sector}` : e.nombre, 3));
        // En los temas por sector o por establecimiento el título ya nombra el lugar: no se repite como dato
        const datos = [...(m.mod.tipo_elemento === 'equipo' ? [['Sector', e.sector]] : []),
          ...(m.mod.atributos || []).map(a => [a.etiqueta, Motor.fmtAtributo(a, e.el.atributos?.[a.clave]) || '—'])];
        const filasDatos = [];
        for (let i = 0; i < datos.length; i += 2) {
          const [a, b] = [datos[i], datos[i + 1] || ['', '']];
          filasDatos.push([{t: a[0], bold: true, fill: 'F2F2F2'}, a[1], {t: b[0], bold: true, fill: b[0] ? 'F2F2F2' : undefined}, b[1]]);
        }
        if (filasDatos.length) body.push(tabla({anchos: [1900, ANCHO / 2 - 1900, 1900, ANCHO / 2 - 1900], keep: 'todo', filas: filasDatos}));
        body.push(par('Lista de verificación', {bold: true, color: AZUL, size: 18, before: 100, after: 40, keepNext: true}));
        body.push(tabla({encabezados: ['N°', 'Ítem', 'Resultado', 'Observación'], anchos: [450, 4500, 1250, ANCHO - 6200], keep: 'todo', filas: filasChecklist(m.mod, m.mod.items, e.ev, true)}));
        body.push(par([run('Resultado: ', {bold: true}), run(` ${e.resultado} `, {bold: true, fill: COLOR[e.resultado][0], color: COLOR[e.resultado][1]}),
          ...(e.ev.conteo.NC ? [run(`   ${Motor.cant(e.ev.conteo.NC, 'desvío', 'desvíos')}`)] : [])], {before: 100, after: 40, keepNext: true}));
        e.ev.observaciones.forEach(o => body.push(par(`Observación: ${o}`, {italics: true, size: 18, keepNext: true})));
        body.push(par('Registro fotográfico', {bold: true, color: AZUL, size: 18, before: 60, after: 40, keepNext: true}));
        body.push(tablaFotos(e.el.fotos || [], false));
      }
      if (m.generales) {
        body.push(titulo(`Verificaciones generales${multi ? ' – ' + m.mod.titulo : ''}`, 3));
        body.push(tabla({encabezados: ['N°', 'Ítem', 'Resultado', 'Observación'], anchos: [450, 4500, 1250, ANCHO - 6200], filas: filasChecklist(m.mod, m.mod.items_generales, m.generales, false)}));
      }
    }

    // 7. Desvíos detectados
    const s7 = H1('Desvíos detectados');
    if (M.desvios.length) {
      body.push(par(`Se detectaron ${Motor.cant(M.desvios.length, 'desvío', 'desvíos')}, ordenados por prioridad:`, {keepNext: true}));
      body.push(tabla({encabezados: ['N°', 'Elemento', 'Desvío', 'Requisito', 'Prioridad'], anchos: [450, 2100, ANCHO - 5750, 2100, 1100],
        filas: M.desvios.map((d, i) => [{t: String(i + 1), align: D.AlignmentType.CENTER}, nombreEl(d), d.texto, d.requisito, estado(d.prioridad, d.prioridad)])}));
    } else body.push(par(P.sin_desvios_tabla));
    body.push(titulo(`${s7}.1 Observaciones no constitutivas de desvío`, 2));
    const obs = M.modulos.flatMap(m => m.observaciones.map(o => multi ? `${m.mod.titulo} – ${o}` : o));
    if (obs.length) obs.forEach((o, i) => body.push(par(o, {bullet: true, keepNext: i < obs.length - 1})));
    else body.push(par(P.sin_observaciones));

    // 8. Plan de acción
    H1('Plan de acción');
    body.push(par('Las acciones se ordenan por prioridad. Los desvíos que se resuelven con una misma acción se agrupan en una sola fila. Al final se incluyen las acciones de gestión.', {keepNext: true, align: D.AlignmentType.JUSTIFIED}));
    body.push(tabla({encabezados: ['N°', 'Acción', 'Elementos', 'Responsable', 'Plazo', 'Prioridad', 'Estado'], anchos: [400, ANCHO - 7250, 1750, 1700, 1100, 1000, 1300], tamano: 17,
      filas: M.plan.map(a => [{t: String(a.n), align: D.AlignmentType.CENTER}, a.accion, a.elementos, a.responsable, P.prioridades[a.prioridad].plazo, estado(a.prioridad, a.prioridad), a.estado])}));

    // 9. Seguimiento del relevamiento anterior
    if (M.seguimiento?.filas.length) {
      H1('Seguimiento del relevamiento anterior');
      body.push(par(`Estado de las acciones correctivas del relevamiento del ${Motor.fmtFecha(M.seguimiento.fecha)}:`, {keepNext: true}));
      body.push(tabla({encabezados: ['Acción', 'Elementos', 'Prioridad', 'Estado actual'], anchos: [ANCHO - 5300, 2100, 1200, 2000],
        filas: M.seguimiento.filas.map(f => [f.accion, f.elementos, estado(f.prioridad, f.prioridad), estado(f.estado, f.estado)])}));
    }

    // Conclusiones, recomendaciones y firmas
    H1('Conclusiones');
    body.push(...lineas(M.textos.conclusion));
    H1('Recomendaciones generales');
    M.recomendaciones.forEach((r, i) => body.push(par(r, {bullet: true, keepNext: i < M.recomendaciones.length - 1})));

    H1('Firmas');
    // Una sola fila que no se parte (cantSplit): no lleva keepNext para no pegarse al anexo
    const linea = '______________________________', c = {align: D.AlignmentType.CENTER, after: 0};
    body.push(tabla({sinBordes: true, keep: 'nada', anchos: [ANCHO / 2, ANCHO / 2], filas: [[
      {t: [
        perfil.firma ? par([imagen(perfil.firma, 5, 2.2)], {...c, before: 200}) : par('', {...c, before: 1100}),
        par(linea, c),
        par(perfil.nombre || 'Profesional actuante', {...c, bold: true}),
        par([perfil.titulo, perfil.matricula && 'Mat. ' + perfil.matricula].filter(Boolean).join(' – '), {...c, size: 18})
      ]},
      {t: [
        par('', {...c, before: 1100}),
        par(linea, c),
        par('Recibido por el establecimiento', {...c, bold: true}),
        par('Aclaración: ____________________', {...c, size: 18, before: 120}),
        par('Fecha: ____ / ____ / ________', {...c, size: 18, before: 120})
      ]}
    ]]}));

    // Anexo fotográfico (fotos generales no asociadas a un elemento)
    if (M.rel.fotos_generales?.length) {
      body.push(titulo('ANEXO FOTOGRÁFICO', 1));
      body.push(tablaFotos(M.rel.fotos_generales, false));
    }

    return new D.Document({
      creator: perfil.nombre || '', title: `Informe técnico – ${M.subtitulo}`,
      styles: {default: {
        document: {run: {font: 'Calibri', size: 20}},
        heading1: {run: {font: 'Calibri', size: 26, bold: true, color: AZUL}, paragraph: {keepNext: true, keepLines: true}},
        heading2: {run: {font: 'Calibri', size: 22, bold: true, color: AZUL}, paragraph: {keepNext: true, keepLines: true}},
        heading3: {run: {font: 'Calibri', size: 20, bold: true, color: AZUL}, paragraph: {keepNext: true, keepLines: true}}
      }},
      sections: [{
        properties: {
          titlePage: true,
          page: {size: {width: 11906, height: 16838}, margin: {top: 1134, bottom: 1134, left: 1134, right: 1134, header: 567, footer: 567}}
        },
        headers: {default: encabezado(M, perfil), first: new D.Header({children: [new D.Paragraph({})]})},
        footers: {default: pie(M, perfil), first: new D.Footer({children: [new D.Paragraph({})]})},
        children: body
      }]
    });
  }

  // ---------- Informe resumido de desvíos (para quien tiene que hacer las correcciones) ----------
  // datos: {empresa, fecha, origen, filas: [{donde, texto, accion, prioridad, responsable, fotos}]}
  function construirDesvios(datos, ctx){
    D = window.docx;
    const P = ctx.plantillas, R = P.resumen_desvios, perfil = ctx.perfil || {}, e = datos.empresa, body = [];
    const plazo = p => {
      const [y, m, d] = datos.fecha.split('-').map(Number), f = new Date(y, m - 1, d + (P.prioridades[p]?.dias || 30));
      return `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}/${f.getFullYear()}`;
    };
    const filas = [...datos.filas].sort((a, b) => Motor.PRIORIDADES.indexOf(a.prioridad) - Motor.PRIORIDADES.indexOf(b.prioridad));

    body.push(par(R.titulo, {bold: true, size: 36, color: AZUL, align: D.AlignmentType.CENTER, after: 40}));
    body.push(par(datos.origen, {size: 22, color: GRIS, align: D.AlignmentType.CENTER, after: 200, borderBottom: true}));
    const lugar = lugarEstablecimiento(e, false);
    body.push(tabla({anchos: [2600, ANCHO - 2600], keep: 'nada', filas: [
      ['Empresa', e.razonSocial], ['Establecimiento', lugar || '—'], ['Fecha de la recorrida', Motor.fmtFecha(datos.fecha)],
      ['Relevó', [perfil.nombre, perfil.matricula && 'Mat. ' + perfil.matricula].filter(Boolean).join(' – ') || '—'],
      ['Entregado a', e.responsable || '']
    ].map(([k, v]) => [{t: k, bold: true, fill: 'F2F2F2', size: 19}, {t: v, size: 19}])}));
    const n = filas.length;
    body.push(par((n ? R.intro : R.intro_sin).replace('{fecha}', Motor.fmtFecha(datos.fecha)).replace('{se_detectaron}', n === 1 ? 'se detectó' : 'se detectaron')
      .replace('{n_desvios}', Motor.cant(n, 'desvío', 'desvíos')),
      {before: 200, after: 120, align: D.AlignmentType.JUSTIFIED}));
    if (n) {
      const usadas = Motor.PRIORIDADES.filter(p => filas.some(f => f.prioridad === p));
      body.push(tabla({anchos: [1500, ANCHO - 1500], keep: 'todo', filas: usadas.map(p => [estado(p, p), `${P.prioridades[p].plazo}. ${P.prioridades[p].descripcion}`])}));
      body.push(par('', {after: 120}));
      body.push(tabla({encabezados: ['N°', 'Dónde', 'Qué se observó', 'Qué hay que hacer', 'Prioridad', 'Corregir antes del', 'Hecho'],
        anchos: [420, 1650, ANCHO - 7690, 2700, 1050, 1150, 720], tamano: 17,
        filas: filas.map((f, i) => [{t: String(i + 1), align: D.AlignmentType.CENTER}, f.donde, f.texto, {t: f.accion + (f.responsable ? `\nResponsable: ${f.responsable}` : '')},
          estado(f.prioridad, f.prioridad), {t: plazo(f.prioridad), align: D.AlignmentType.CENTER, bold: true}, {t: '☐', align: D.AlignmentType.CENTER, size: 26}])}));
      const conFoto = filas.map((f, i) => ({...f, n: i + 1})).filter(f => f.fotos?.length);
      if (conFoto.length) {
        body.push(titulo('FOTOS DE LOS DESVÍOS', 1));
        conFoto.forEach(f => {
          body.push(par(`Desvío N° ${f.n} – ${f.donde}`, {bold: true, color: AZUL, size: 19, before: 120, after: 40, keepNext: true}));
          body.push(tablaFotos(f.fotos.slice(0, 2), false));
        });
      }
    }
    body.push(par(R.cierre, {before: 240, after: 120, italics: true, align: D.AlignmentType.JUSTIFIED}));
    const linea = '______________________________', c = {align: D.AlignmentType.CENTER, after: 0};
    body.push(tabla({sinBordes: true, keep: 'nada', anchos: [ANCHO / 2, ANCHO / 2], filas: [[
      {t: [perfil.firma ? par([imagen(perfil.firma, 4.5, 1.8)], {...c, before: 120}) : par('', {...c, before: 900}), par(linea, c),
        par(perfil.nombre || 'Profesional actuante', {...c, bold: true, size: 18})]},
      {t: [par('', {...c, before: 900}), par(linea, c), par('Recibido por (firma y aclaración)', {...c, bold: true, size: 18})]}
    ]]}));

    const M = {empresa: e, subtitulo: datos.origen};
    return new D.Document({
      creator: perfil.nombre || '', title: `${R.titulo} – ${e.razonSocial}`,
      styles: {default: {document: {run: {font: 'Calibri', size: 20}},
        heading1: {run: {font: 'Calibri', size: 24, bold: true, color: AZUL}, paragraph: {keepNext: true, keepLines: true}}}},
      sections: [{
        properties: {page: {size: {width: 11906, height: 16838}, margin: {top: 1134, bottom: 1134, left: 1134, right: 1134, header: 567, footer: 567}}},
        headers: {default: encabezado(M, perfil)}, footers: {default: pie(M, perfil)}, children: body
      }]
    });
  }

  const limpiar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  function nombreArchivo(M){
    const tema = M.multi ? 'Relevamiento' : limpiar(M.modulos[0].mod.titulo);
    return `Informe_${tema}_${limpiar(M.empresa.razonSocial).toUpperCase()}_${M.rel.fecha_relevamiento.slice(0, 7)}.docx`;
  }

  async function generar(M, ctx){
    return {blob: await window.docx.Packer.toBlob(construir(M, ctx)), nombre: nombreArchivo(M)};
  }

  async function generarDesvios(datos, ctx){
    const nombre = `Desvios_${limpiar(datos.tema || 'relevamiento')}_${limpiar(datos.empresa.razonSocial).toUpperCase()}_${datos.fecha}.docx`;
    return {blob: await window.docx.Packer.toBlob(construirDesvios(datos, ctx)), nombre};
  }

  return {generar, generarDesvios, nombreArchivo};
})();
