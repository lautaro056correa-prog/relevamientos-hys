// Informes de la agenda: informe semanal al director (PDF y Word), cierre de semana, constancia de visita (PDF),
// escaneo de la planilla firmada, Excel de visitas, constancias del mes en .zip, calendario .ics y gráficos de control.
// Se carga después de agenda.js y antes de app.js.
(() => {
  const {views, acciones, lib, datos, cliente, empresaDe, estabDe, ESTADOS, sumarDias, lunesDe, fechaLarga, cap, horasVisita, fmtHoras, porHora, flecha} = AG;
  const AZUL = [31, 56, 100], TINTA = [23, 32, 46], GRIS = [91, 102, 118];

  // ===== Números del período =====
  function resumen(d, desde, hasta){
    const en = f => f && f >= desde && f <= hasta;
    const vs = d.vis.filter(v => en(v.fecha)).sort(porHora), n = k => vs.filter(v => v.estado === k).length;
    const r = {vs, total: vs.length, planificada: n('planificada'), cumplida: n('cumplida'), parcial: n('parcial'), reprogramada: n('reprogramada'), cancelada: n('cancelada')};
    r.pct = r.total ? Math.round((r.cumplida + r.parcial / 2) * 100 / r.total) : 0;
    r.horas = vs.reduce((t, v) => t + horasVisita(v), 0);
    r.relevamientos = d.rels.filter(x => en(x.fecha_relevamiento)).length;
    r.desviosNuevos = d.seg.filter(o => en(o.fecha)).length;
    r.desviosCerrados = d.seg.filter(o => o.estado === 'Cerrado' && en(o.fechaCierre)).length;
    r.pendNuevos = d.pen.filter(p => en(p.fecha)).length;
    r.pendCerrados = d.pen.filter(p => p.estado === 'Cerrado' && en(p.fechaCierre)).length;
    return r;
  }
  const pendientesDe = (d, v) => [...d.pen.filter(p => p.visitaId === v.id).map(p => p.texto + (p.estado === 'Cerrado' ? ' (resuelto)' : '')),
    ...d.pen.filter(p => p.cierreVisitaId === v.id && p.visitaId !== v.id).map(p => 'Resuelto: ' + p.texto),
    ...d.seg.filter(o => o.cierreVisitaId === v.id).map(o => `Desvío N° ${o.n || '-'} cerrado: ${o.texto || ''}`)];
  const horario = v => v.inicio ? `${v.inicio} a ${v.fin || '?'}` : v.hora ? `${v.hora} (plan.)` : '-';
  const tareasTxt = v => v.tareas.map(t => (t.hecha ? '✓ ' : '✗ ') + t.nombre).join('\n').replace(/✓/g, '[x]').replace(/✗/g, '[ ]');
  const noCumplidas = r => r.vs.filter(v => ['reprogramada', 'cancelada', 'parcial', 'planificada'].includes(v.estado));
  const motivoDe = v => v.estado === 'parcial' ? 'Sin hacer: ' + (v.tareas.filter(t => !t.hecha).map(t => t.nombre).join(', ') || '-') : v.estado === 'planificada' ? 'Sin cerrar' : v.motivo || '-';
  const nombreSemana = l => `Informe_semanal_visitas_${l.split('-').reverse().join('-')}.pdf`;
  const profesional = () => [PERFIL.titulo, PERFIL.nombre].filter(Boolean).join(' ') + (PERFIL.matricula ? ` · Mat. ${PERFIL.matricula}` : '');

  // ===== PDF: piezas comunes =====
  async function nuevoPdf(){
    await lib('pdf');
    return new window.jspdf.jsPDF({unit: 'mm', format: 'a4'});
  }
  function encabezadoPdf(doc, titulo, sub){
    doc.setFillColor(...AZUL); doc.rect(0, 0, 210, 26, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(titulo, 14, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(sub, 14, 19);
    if (PERFIL.logo?.data) {
      const h = 18, w = Math.min(40, h * (PERFIL.logo.w || 1) / (PERFIL.logo.h || 1));
      doc.setFillColor(255); doc.roundedRect(196 - w - 2, 3, w + 4, h + 2, 1.5, 1.5, 'F');
      try { doc.addImage(PERFIL.logo.data, 'PNG', 196 - w, 4, w, h); } catch {}
    }
    doc.setTextColor(...TINTA);
  }
  function piePdf(doc){
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...GRIS);
      doc.text(profesional() || 'Relevamientos HyS', 14, 290);
      doc.text(`Página ${i} de ${n}`, 196, 290, {align: 'right'});
    }
  }
  const tabla = (doc, op) => { doc.autoTable({theme: 'grid', margin: {left: 14, right: 14}, styles: {fontSize: 8.5, cellPadding: 1.8, textColor: TINTA, lineColor: [201, 210, 222]},
    headStyles: {fillColor: AZUL, textColor: 255, fontStyle: 'bold'}, ...op}); return doc.lastAutoTable.finalY; };
  function titulo(doc, txt, y){
    if (y > 260) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...AZUL); doc.text(txt.toUpperCase(), 14, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...TINTA);
    return y + 3;
  }

  // ===== Constancia de visita =====
  AG.nombreConstancia = (e, v) => `${limpiarNombre(e?.razonSocial || 'CLIENTE')}_${v.fecha.split('-').reverse().join('-')}.pdf`;
  AG.constanciaPdf = async v => {
    const d = await datos(), s = estabDe(d, v), e = empresaDe(d, s), doc = await nuevoPdf();
    encabezadoPdf(doc, 'CONSTANCIA DE VISITA', 'Servicio de Higiene y Seguridad en el Trabajo');
    let y = tabla(doc, {startY: 32, theme: 'plain', styles: {fontSize: 9.5, cellPadding: 1.4}, columnStyles: {0: {fontStyle: 'bold', cellWidth: 38}},
      body: [['Cliente', e?.razonSocial || ''], ['CUIT', e?.cuit || '-'], ['Establecimiento', s?.nombre || ''], ['Dirección', [s?.domicilio, s?.localidad, s?.provincia].filter(Boolean).join(', ') || '-'],
        ['Fecha', cap(fechaLarga(v.fecha))], ['Ingreso / egreso', v.inicio ? `${v.inicio} a ${v.fin || '-'} (${fmtHoras(horasVisita(v))})` : '-'], ['Profesional', profesional() || '-']]});
    const hechas = v.tareas.filter(t => t.hecha), sin = v.tareas.filter(t => !t.hecha);
    y = titulo(doc, 'Tareas realizadas', y + 8);
    y = tabla(doc, {startY: y, head: [['Tarea', 'Tipo']], body: hechas.length ? hechas.map(t => [t.nombre, t.prevista ? 'Planificada' : 'No prevista']) : [['Sin tareas registradas', '']]});
    if (sin.length) { y = titulo(doc, 'Tareas planificadas no realizadas', y + 8); y = tabla(doc, {startY: y, body: sin.map(t => [t.nombre])}); }
    const rels = d.rels.filter(r => (v.relIds || []).includes(r.id));
    if (rels.length) { y = titulo(doc, 'Relevamientos', y + 8); y = tabla(doc, {startY: y, body: rels.map(r => [r.tipo === 'desvios' ? 'Informe de desvíos' : r.modulos.map(m => CFG.modulos[m.modulo_id]?.titulo || m.modulo_id).join(', ')])}); }
    if (v.observaciones?.trim()) { y = titulo(doc, 'Observaciones', y + 8); y = tabla(doc, {startY: y, theme: 'plain', styles: {fontSize: 9.5}, body: [[v.observaciones.trim()]]}); }
    const pend = pendientesDe(d, v), abiertos = d.pen.filter(p => p.estabId === v.estabId && p.estado === 'Abierto' && p.visitaId !== v.id);
    if (pend.length || abiertos.length) {
      y = titulo(doc, 'Pendientes', y + 8);
      y = tabla(doc, {startY: y, head: [['Detalle', 'Estado']], body: [...pend.map(p => [p, p.startsWith('Resuelto') || p.includes('cerrado') ? 'Resuelto' : 'Nuevo']), ...abiertos.map(p => [p.texto, `Abierto desde ${fmtFecha(p.fecha)}`])]});
    }
    // Firmas
    if (y > 235) { doc.addPage(); y = 20; }
    y = Math.max(y + 22, 245);
    if (PERFIL.firma?.data) { const h = 16, w = Math.min(50, h * (PERFIL.firma.w || 3) / (PERFIL.firma.h || 1)); try { doc.addImage(PERFIL.firma.data, 'PNG', 40 - w / 2, y - h - 1, w, h); } catch {} }
    doc.setDrawColor(...GRIS); doc.line(14, y, 80, y); doc.line(124, y, 196, y);
    doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text(['Firma del profesional', PERFIL.nombre || ''], 47, y + 4, {align: 'center'});
    doc.text(['Recibí conforme', 'Firma, aclaración y cargo'], 160, y + 4, {align: 'center'});
    piePdf(doc);
    return {nombre: AG.nombreConstancia(e, v), data: await AG.aDataUrl(doc.output('blob')), fecha: Date.now()};
  };

  // ===== Escáner de la planilla firmada: detecta la hoja, la endereza (OpenCV + jscanify) y arma el PDF =====
  const cargarImg = f => new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(f); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la foto.')); i.src = u; });
  async function cvListo(){
    if (window.cv instanceof Promise) window.cv = await window.cv;
    if (window.cv?.Mat) return;
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('el escáner tardó demasiado')), 60000); cv.onRuntimeInitialized = () => { clearTimeout(t); res(); }; });
  }
  AG.escanearPlanilla = async (file, nombre) => {
    const img = await cargarImg(file), esc = Math.min(1, 1800 / Math.max(img.width, img.height));
    const base = document.createElement('canvas');
    base.width = Math.round(img.width * esc); base.height = Math.round(img.height * esc);
    base.getContext('2d').drawImage(img, 0, 0, base.width, base.height);
    URL.revokeObjectURL(img.src);
    let hoja = null;
    try {
      await lib('escaner'); await cvListo();
      const sc = new jscanify(), c = sc.extractPaper(base, 1240, 1754);
      // Si "la hoja" detectada es muy chica, la detección falló: se usa la foto entera
      const m = cv.imread(base), cont = sc.findPaperContour(m), area = cont ? cv.contourArea(cont) : 0;
      m.delete();
      if (c && area > base.width * base.height * 0.2) hoja = c;
    } catch (e) { console.warn('Escáner', e); }
    if (!hoja) { toast('No se detectó bien la hoja: se guarda la foto entera'); hoja = base; }
    // Escala de grises con más contraste, como una fotocopia
    const g = hoja.getContext('2d'), px = g.getImageData(0, 0, hoja.width, hoja.height), p = px.data;
    for (let i = 0; i < p.length; i += 4) { let y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; y = Math.max(0, Math.min(255, (y - 128) * 1.35 + 150)); p[i] = p[i + 1] = p[i + 2] = y; }
    g.putImageData(px, 0, 0);
    const jpg = hoja.toDataURL('image/jpeg', 0.8), doc = await nuevoPdf();
    const r = Math.min(210 / hoja.width, 297 / hoja.height), w = hoja.width * r, h = hoja.height * r;
    doc.addImage(jpg, 'JPEG', (210 - w) / 2, (297 - h) / 2, w, h);
    const mini = document.createElement('canvas'), mr = 160 / hoja.height;
    mini.width = Math.round(hoja.width * mr); mini.height = 160;
    mini.getContext('2d').drawImage(hoja, 0, 0, mini.width, mini.height);
    return {nombre, data: await AG.aDataUrl(doc.output('blob')), vista: mini.toDataURL('image/jpeg', 0.7), fecha: Date.now()};
  };

  // ===== Informe semanal (PDF) =====
  async function pdfSemanal(lunes, conFotos){
    const d = await datos(), dom = sumarDias(lunes, 6), r = resumen(d, lunes, dom), doc = await nuevoPdf();
    encabezadoPdf(doc, 'INFORME SEMANAL DE VISITAS', `Período: ${fmtFecha(lunes)} al ${fmtFecha(dom)}`);
    let y = tabla(doc, {startY: 32, theme: 'plain', styles: {fontSize: 9.5, cellPadding: 1.3}, columnStyles: {0: {fontStyle: 'bold', cellWidth: 34}},
      body: [['Profesional', profesional() || '-'], ['Contacto', [PERFIL.telefono, PERFIL.email].filter(Boolean).join(' · ') || '-'],
        ['Destinatario', [PERFIL.directorNombre, PERFIL.directorEmail].filter(Boolean).join(' · ') || '-'], ['Emitido', fmtFecha(hoy())]]});
    y = titulo(doc, 'Resumen', y + 7);
    y = tabla(doc, {startY: y, styles: {fontSize: 9, halign: 'center', cellPadding: 2}, head: [['Programadas', 'Cumplidas', 'Parciales', 'Reprogramadas', 'Canceladas', 'Sin cerrar', 'Cumplimiento']],
      body: [[r.total, r.cumplida, r.parcial, r.reprogramada, r.cancelada, r.planificada, r.pct + ' %']]});
    y = tabla(doc, {startY: y + 2, styles: {fontSize: 9, halign: 'center', cellPadding: 2}, head: [['Horas en planta', 'Relevamientos', 'Desvíos detectados', 'Desvíos cerrados', 'Pendientes nuevos', 'Pendientes resueltos']],
      body: [[fmtHoras(r.horas), r.relevamientos, r.desviosNuevos, r.desviosCerrados, r.pendNuevos, r.pendCerrados]]});
    doc.setFontSize(7.5); doc.setTextColor(...GRIS); doc.text('Cumplimiento = (cumplidas + la mitad de las parciales) / visitas programadas de la semana.', 14, y + 4); doc.setTextColor(...TINTA);
    y = titulo(doc, 'Detalle por visita', y + 12);
    y = tabla(doc, {startY: y, styles: {fontSize: 7.8, cellPadding: 1.5, valign: 'top'}, rowPageBreak: 'avoid',
      columnStyles: {0: {cellWidth: 17}, 1: {cellWidth: 16}, 2: {cellWidth: 28}, 3: {cellWidth: 21}, 4: {cellWidth: 34}},
      head: [['Fecha', 'Horario', 'Cliente', 'Estado', 'Tareas', 'Observaciones', 'Pendientes']],
      body: r.vs.map(v => [fmtFecha(v.fecha).slice(0, 5) + '\n' + AG.cap(fechaLarga(v.fecha).split(' ')[0]), horario(v), cliente(d, estabDe(d, v)), ESTADOS[v.estado][0],
        tareasTxt(v) || '-', (v.observaciones || '').trim() || '-', pendientesDe(d, v).join('\n') || '-'])});
    if (!r.vs.length) { doc.setFontSize(9); doc.text('No hubo visitas programadas en la semana.', 14, y + 6); y += 8; }
    const nc = noCumplidas(r);
    if (nc.length) {
      y = titulo(doc, 'Visitas no cumplidas o incompletas', y + 9);
      y = tabla(doc, {startY: y, styles: {fontSize: 8.5}, columnStyles: {0: {cellWidth: 22}, 2: {cellWidth: 26}},
        head: [['Fecha', 'Cliente', 'Estado', 'Motivo']], body: nc.map(v => [fmtFecha(v.fecha), cliente(d, estabDe(d, v)), ESTADOS[v.estado][0], motivoDe(v)])});
    }
    if (conFotos) {
      const fotos = r.vs.flatMap(v => v.fotos.map(f => ({...f, pie: `${fmtFecha(v.fecha)} · ${cliente(d, estabDe(d, v))}${f.descripcion ? ' · ' + f.descripcion : ''}`})));
      if (fotos.length) {
        doc.addPage(); y = titulo(doc, 'Registro fotográfico', 18) + 2;
        let col = 0;
        for (const f of fotos) {
          const w = 88, h = Math.min(70, w * (f.h || 3) / (f.w || 4));
          if (y + h + 12 > 282) { doc.addPage(); y = 18; col = 0; }
          const x = col ? 108 : 14;
          try { doc.addImage(f.data, 'JPEG', x, y, w, h); } catch {}
          doc.setFontSize(7.5); doc.text(doc.splitTextToSize(f.pie, w), x, y + h + 4);
          if (col) y += 82;
          col = 1 - col;
        }
      }
    }
    piePdf(doc);
    return doc.output('blob');
  }

  // ===== Informe semanal (Word, con la misma librería que los informes de relevamiento) =====
  async function wordSemanal(lunes, conFotos){
    const D = window.docx, d = await datos(), dom = sumarDias(lunes, 6), r = resumen(d, lunes, dom);
    const {Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, ImageRun, Footer, PageNumber} = D;
    const p = (txt, op = {}) => new Paragraph({spacing: {after: 80}, ...op, children: [].concat(txt).map(t => typeof t === 'string' ? new TextRun({text: t, size: 20}) : t)});
    const tit = txt => new Paragraph({spacing: {before: 240, after: 100}, keepNext: true, children: [new TextRun({text: txt.toUpperCase(), bold: true, size: 22, color: '1F3864'})]});
    const celda = (txt, enc, ancho) => new TableCell({width: ancho ? {size: ancho, type: WidthType.PERCENTAGE} : undefined, shading: enc ? {type: ShadingType.CLEAR, fill: '1F3864', color: 'auto'} : undefined,
      children: String(txt ?? '').split('\n').map(l => new Paragraph({children: [new TextRun({text: l, size: 17, bold: enc, color: enc ? 'FFFFFF' : undefined})]}))});
    const tablaW = (head, filas, anchos) => new Table({width: {size: 100, type: WidthType.PERCENTAGE},
      rows: [new TableRow({tableHeader: true, cantSplit: true, children: head.map((h, i) => celda(h, true, anchos?.[i]))}),
        ...filas.map(f => new TableRow({cantSplit: true, children: f.map((c, i) => celda(c, false, anchos?.[i]))}))]});
    const hijos = [
      new Paragraph({children: [new TextRun({text: 'INFORME SEMANAL DE VISITAS', bold: true, size: 32, color: '1F3864'})]}),
      p(`Período: ${fmtFecha(lunes)} al ${fmtFecha(dom)}`),
      p(`Profesional: ${profesional() || '-'}${PERFIL.telefono || PERFIL.email ? ' · ' + [PERFIL.telefono, PERFIL.email].filter(Boolean).join(' · ') : ''}`),
      p(`Destinatario: ${[PERFIL.directorNombre, PERFIL.directorEmail].filter(Boolean).join(' · ') || '-'} · Emitido: ${fmtFecha(hoy())}`),
      tit('Resumen'),
      tablaW(['Programadas', 'Cumplidas', 'Parciales', 'Reprogramadas', 'Canceladas', 'Sin cerrar', 'Cumplimiento'], [[r.total, r.cumplida, r.parcial, r.reprogramada, r.cancelada, r.planificada, r.pct + ' %']]),
      p(''),
      tablaW(['Horas en planta', 'Relevamientos', 'Desvíos detectados', 'Desvíos cerrados', 'Pendientes nuevos', 'Pendientes resueltos'], [[fmtHoras(r.horas), r.relevamientos, r.desviosNuevos, r.desviosCerrados, r.pendNuevos, r.pendCerrados]]),
      p(new TextRun({text: 'Cumplimiento = (cumplidas + la mitad de las parciales) / visitas programadas de la semana.', size: 15, italics: true})),
      tit('Detalle por visita'),
      r.vs.length ? tablaW(['Fecha', 'Horario', 'Cliente', 'Estado', 'Tareas', 'Observaciones', 'Pendientes'], r.vs.map(v => [fmtFecha(v.fecha), horario(v), cliente(d, estabDe(d, v)), ESTADOS[v.estado][0],
        tareasTxt(v) || '-', (v.observaciones || '').trim() || '-', pendientesDe(d, v).join('\n') || '-']), [9, 9, 15, 10, 18, 22, 17]) : p('No hubo visitas programadas en la semana.')
    ];
    const nc = noCumplidas(r);
    if (nc.length) hijos.push(tit('Visitas no cumplidas o incompletas'), tablaW(['Fecha', 'Cliente', 'Estado', 'Motivo'], nc.map(v => [fmtFecha(v.fecha), cliente(d, estabDe(d, v)), ESTADOS[v.estado][0], motivoDe(v)]), [14, 30, 16, 40]));
    if (conFotos) {
      const fotos = r.vs.flatMap(v => v.fotos.map(f => ({...f, pie: `${fmtFecha(v.fecha)} · ${cliente(d, estabDe(d, v))}${f.descripcion ? ' · ' + f.descripcion : ''}`})));
      if (fotos.length) hijos.push(tit('Registro fotográfico'), ...fotos.flatMap(f => {
        const bytes = Uint8Array.from(atob(f.data.split(',')[1]), c => c.charCodeAt(0)), w = 300, h = Math.round(w * (f.h || 3) / (f.w || 4));
        return [new Paragraph({keepNext: true, children: [new ImageRun({type: 'jpg', data: bytes, transformation: {width: w, height: h}})]}), p(new TextRun({text: f.pie, size: 16, italics: true}))];
      }));
    }
    const doc = new Document({sections: [{properties: {page: {margin: {top: 1000, bottom: 1000, left: 1000, right: 1000}}},
      footers: {default: new Footer({children: [new Paragraph({alignment: AlignmentType.RIGHT, children: [new TextRun({children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16})]})]})},
      children: hijos}]});
    return Packer.toBlob(doc);
  }

  // ===== Pantalla: Informes › Visitas =====
  AG.informeVisitasHtml = async () => {
    const d = await datos(), lunes = S.semana ||= lunesDe(hoy()), dom = sumarDias(lunes, 6), r = resumen(d, lunes, dom), sem = AG.semanas()[lunes];
    S.mesCtl ||= hoy().slice(0, 7);
    S.xDesde ||= hoy().slice(0, 8) + '01'; S.xHasta ||= hoy();
    const kpi = (n, txt, cl) => `<div class="kpi ${cl}"><b>${n}</b><span>${txt}</span></div>`;
    // Horas cumplidas vs comprometidas en el mes elegido
    const [y, m] = S.mesCtl.split('-').map(Number), desdeM = `${S.mesCtl}-01`, hastaM = iso(new Date(y, m, 0)), rm = resumen(d, desdeM, hastaM);
    const horas = d.est.map(s => ({s, h: rm.vs.filter(v => v.estabId === s.id).reduce((t, v) => t + horasVisita(v), 0), comp: +s.horasMes || 0})).filter(x => x.h || x.comp).sort((a, b) => b.comp - a.comp || b.h - a.h);
    return `<div class="card semnav"><button class="hbtn mini" ${on('semana', -7)} aria-label="Semana anterior">${flecha(-1)}</button>
        <div><b>Semana del ${fmtFecha(lunes).slice(0, 5)} al ${fmtFecha(dom)}</b><div class="sub">${sem?.cerrada ? `<span class="badge b-ok">Cerrada · enviada el ${fmtFecha(sem.fechaEnvio)}</span>` : 'Abierta'}</div></div>
        <button class="hbtn mini" ${on('semana', 7)} aria-label="Semana siguiente">${flecha(1)}</button></div>
      <div class="kpis" style="margin-top:12px">${kpi(r.total, 'Programadas', 'b-na')}${kpi(r.cumplida, 'Cumplidas', 'b-ok')}${kpi(r.parcial, 'Parciales', 'b-mid')}${kpi(r.reprogramada, 'Reprogr.', 'b-na')}
        ${kpi(r.cancelada, 'Canceladas', 'b-bad')}${kpi(r.pct + '%', 'Cumplim.', 'b-azul')}${kpi(fmtHoras(r.horas), 'En planta', 'b-azul')}${kpi(r.relevamientos, 'Relevam.', 'b-azul')}
        ${kpi(r.desviosNuevos, 'Desvíos nuevos', 'b-bad')}${kpi(r.desviosCerrados + r.pendCerrados, 'Resueltos', 'b-ok')}</div>
      ${r.planificada && !sem?.cerrada && lunes <= lunesDe(hoy()) ? `<div style="margin-top:12px">${aviso('aviso', 'reloj', `${plural(r.planificada, 'visita queda', 'visitas quedan')} sin cerrar en esta semana.`)}</div>` : ''}
      <h3>Visitas de la semana</h3>
      <div class="card fold-list">${r.vs.map(v => `<div class="el" ${on('abrirVisita', v.id)}><span class="hora num">${AG.fechaCorta(v.fecha)}</span><div><b>${esc(cliente(d, estabDe(d, v)))}</b>
        <div class="sub">${esc(v.tareas.map(t => t.nombre).join(', ') || 'Sin tareas')}${horasVisita(v) ? ' · ' + fmtHoras(horasVisita(v)) : ''}</div></div>${AG.badgeEstado(v)}</div>`).join('') || '<p class="sub">No hay visitas en esta semana.</p>'}</div>
      <h3>Informe para el director</h3>
      <div class="card">
        <label class="check"><input type="checkbox" ${S.infFotos ? 'checked' : ''} ${oc('infFotos')}> Incluir las fotos de las visitas</label>
        <div class="actions" style="margin-top:12px">
          <button class="btn sec small" ${on('semanal', 'pdf', 'descargar')}>${ic('descarga')}PDF</button>
          <button class="btn sec small" ${on('semanal', 'pdf', 'compartir')}>${ic('compartir')}Compartir PDF</button>
          <button class="btn sec small" ${on('semanal', 'word', 'descargar')}>${ic('doc')}Word</button></div>
        ${sem?.cerrada ? `<button class="btn ghost block" style="margin-top:12px" ${on('reabrirSemana')}>Reabrir semana</button>`
          : `<button class="btn hazard block" style="margin-top:12px" ${on('cerrarSemana')}>${ic('check')}Emitir y cerrar la semana</button>
             <p class="hint">Al cerrarla, las visitas de la semana quedan bloqueadas (se puede reabrir).</p>`}
      </div>
      <h3>Exportar</h3>
      <div class="card">
        <div class="row"><div class="fld"><label for="x_desde">Desde</label><input id="x_desde" type="date" value="${S.xDesde}" ${oc('xCampo', 'xDesde')}></div>
          <div class="fld"><label for="x_hasta">Hasta</label><input id="x_hasta" type="date" value="${S.xHasta}" ${oc('xCampo', 'xHasta')}></div></div>
        <div class="actions" style="margin-top:12px"><button class="btn sec small" ${on('excelVisitas')}>${ic('panel')}Excel de visitas y horas</button>
          <button class="btn sec small" ${on('zipConstancias')}>${ic('descarga')}Constancias (.zip)</button>
          <button class="btn sec small" ${on('exportarIcs')}>${ic('calendario')}Para Google Calendar (.ics)</button></div>
      </div>
      <h3>Control del mes</h3>
      <div class="card"><label for="m_ctl">Mes</label><input id="m_ctl" type="month" value="${S.mesCtl}" ${oc('xCampo', 'mesCtl')}>
        <h4 style="margin-top:16px">Horas cumplidas vs. comprometidas</h4>
        ${horas.map(x => { const pc = x.comp ? Math.min(100, Math.round(x.h * 100 / x.comp)) : 100;
          return `<div class="barra-fila"><div class="between"><span>${esc(cliente(d, x.s))}</span><b class="num">${fmtHoras(x.h)}${x.comp ? ' / ' + x.comp + ' h' : ''}</b></div>
            <div class="barra"><i style="width:${pc}%" class="${!x.comp ? '' : pc >= 100 ? 'ok' : pc >= 60 ? 'mid' : 'bad'}"></i></div></div>`; }).join('') || '<p class="sub">Cargá las horas comprometidas en los datos de cada establecimiento.</p>'}
      </div>
      <div class="graficos">
        <div class="card"><h4>Cumplimiento mes a mes</h4><canvas id="g_cumpl" height="200"></canvas></div>
        <div class="card"><h4>Visitas por cliente</h4><canvas id="g_vis" height="220"></canvas></div>
        <div class="card"><h4>Actividades más frecuentes</h4><canvas id="g_act" height="220"></canvas></div>
        <div class="card"><h4>Horas por empresa</h4><canvas id="g_horas" height="220"></canvas></div>
      </div>`;
  };
  acciones.semana = (t, n) => { S.semana = sumarDias(S.semana, n); render(); };
  acciones.infFotos = t => { S.infFotos = t.checked; };
  acciones.xCampo = (t, k) => { S[k] = t.value; if (k === 'mesCtl') render(); };

  // Gráficos (Chart.js)
  let charts = [];
  AG.graficos = async () => {
    if (!$('#g_cumpl')) return;
    try { await lib('graficos'); } catch { return; }
    if (!$('#g_cumpl')) return;
    charts.forEach(c => c.destroy()); charts = [];
    const d = await datos(), css = getComputedStyle(document.documentElement), color = n => css.getPropertyValue(n).trim();
    Chart.defaults.color = color('--muted'); Chart.defaults.font.family = css.getPropertyValue('--body');
    Chart.defaults.borderColor = color('--line');
    const [y, m] = S.mesCtl.split('-').map(Number), meses = [];
    for (let i = 5; i >= 0; i--) { const f = new Date(y, m - 1 - i, 1); meses.push([iso(f), iso(new Date(f.getFullYear(), f.getMonth() + 1, 0)), MESES[f.getMonth()]]); }
    const rm = resumen(d, `${S.mesCtl}-01`, iso(new Date(y, m, 0))), hechas = rm.vs.filter(v => v.estado === 'cumplida' || v.estado === 'parcial');
    const contar = (lista, clave) => Object.entries(lista.reduce((o, x) => { const k = clave(x); if (k) o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const porCli = contar(hechas, v => empresaDe(d, estabDe(d, v))?.razonSocial);
    const porAct = contar(hechas.flatMap(v => v.tareas.filter(t => t.hecha)), t => t.nombre);
    const hEmp = Object.entries(hechas.reduce((o, v) => { const k = empresaDe(d, estabDe(d, v))?.razonSocial || '—'; o[k] = (o[k] || 0) + horasVisita(v); return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const barras = (id, pares, col, sufijo = '') => charts.push(new Chart($(id), {type: 'bar', data: {labels: pares.map(p => p[0].length > 18 ? p[0].slice(0, 17) + '…' : p[0]),
      datasets: [{data: pares.map(p => Math.round(p[1] * 10) / 10), backgroundColor: col, borderRadius: 4}]},
      options: {indexAxis: 'y', plugins: {legend: {display: false}, tooltip: {callbacks: {label: c => c.formattedValue + sufijo}}}, scales: {x: {beginAtZero: true, ticks: {precision: 0}}}}}));
    charts.push(new Chart($('#g_cumpl'), {type: 'line', data: {labels: meses.map(x => x[2]), datasets: [{data: meses.map(([a, b]) => resumen(d, a, b).pct), borderColor: color('--navy-2'), backgroundColor: color('--navy-2'), tension: .3}]},
      options: {plugins: {legend: {display: false}, tooltip: {callbacks: {label: c => c.formattedValue + ' %'}}}, scales: {y: {beginAtZero: true, max: 100, ticks: {callback: v => v + '%'}}}}}));
    barras('#g_vis', porCli, color('--azul'));
    barras('#g_act', porAct, color('--verde'));
    barras('#g_horas', hEmp, color('--amarillo'), ' h');
    for (const [id, pares] of [['#g_vis', porCli], ['#g_act', porAct], ['#g_horas', hEmp]]) if (!pares.length) $(id).insertAdjacentHTML('afterend', '<p class="sub">Sin visitas cerradas en el mes.</p>');
  };

  // Acciones del informe
  acciones.semanal = async (t, tipo, modo) => {
    toast('Preparando el informe…');
    try {
      const blob = tipo === 'pdf' ? await pdfSemanal(S.semana, S.infFotos) : await wordSemanal(S.semana, S.infFotos);
      await entregar(modo, nombreSemana(S.semana).replace('.pdf', tipo === 'pdf' ? '.pdf' : '.docx'), blob);
    } catch (e) { console.error(e); avisar('No se pudo generar el informe: ' + e.message); }
  };
  acciones.cerrarSemana = async () => {
    const d = await datos(), lunes = S.semana, r = resumen(d, lunes, sumarDias(lunes, 6));
    if (lunes > lunesDe(hoy()) && !(await confirmar('Esta semana todavía no empezó. ¿La cerrás igual?', 'Cerrar igual'))) return;
    if (r.planificada && !(await confirmar(`Hay ${plural(r.planificada, 'visita', 'visitas')} sin cerrar. En el informe figuran como "sin cerrar". ¿Emitir igual?`, 'Emitir igual'))) return;
    toast('Preparando el informe…');
    let blob;
    try { blob = await pdfSemanal(lunes, S.infFotos); } catch (e) { console.error(e); return avisar('No se pudo generar el informe: ' + e.message); }
    const sem = {...(AG.semanas()[lunes] || {}), id: lunes, cerrada: true, fechaEnvio: hoy(), emitido: Date.now()};
    AG.semanas()[lunes] = sem;
    await put('semanas', sem);
    render();
    const modo = await menu(`Semana cerrada. ¿Cómo le mandás el informe${PERFIL.directorNombre ? ' a ' + PERFIL.directorNombre : ''}?`, [{txt: 'Compartir (WhatsApp, mail…)', icono: 'compartir', valor: 'compartir'}, {txt: 'Descargar', icono: 'descarga', valor: 'descargar'}]);
    if (modo) entregar(modo, nombreSemana(lunes), blob);
  };
  acciones.reabrirSemana = async () => {
    if (!(await confirmar('¿Reabrir la semana? Las visitas se pueden volver a modificar. Si cambiás algo, emití el informe de nuevo.', 'Reabrir'))) return;
    const sem = AG.semanas()[S.semana];
    sem.cerrada = false;
    await put('semanas', sem);
    render();
  };
  acciones.excelVisitas = async () => {
    const d = await datos(), desde = S.xDesde, hasta = S.xHasta;
    if (!desde || !hasta || desde > hasta) return avisar('Revisá las fechas: "desde" tiene que ser anterior a "hasta".');
    const r = resumen(d, desde, hasta);
    if (!r.total) return avisar('No hay visitas en ese período.');
    const enc = t => ({v: t, s: 'enc'}), est = {cumplida: 'ok', parcial: 'medio', cancelada: 'mal'};
    const cab = t => [[{v: t, s: 'titulo'}], [{v: `Período: ${fmtFecha(desde)} al ${fmtFecha(hasta)} · ${profesional()}`, s: 'subtitulo'}], []];
    const visitas = {nombre: 'Visitas', fijarFila: 4, anchos: [11, 11, 30, 22, 13, 28, 8, 8, 8, 40, 40, 40],
      filas: [...cab('Visitas'), ['Fecha', 'Día', 'Cliente', 'Establecimiento', 'Estado', 'Motivo', 'Ingreso', 'Egreso', 'Horas', 'Tareas', 'Observaciones', 'Pendientes'].map(enc),
        ...r.vs.map(v => { const s = estabDe(d, v); return [fmtFecha(v.fecha), AG.cap(fechaLarga(v.fecha).split(' ')[0]), empresaDe(d, s)?.razonSocial || '', s?.nombre || '', {v: ESTADOS[v.estado][0], s: est[v.estado] || 'centro'},
          v.estado === 'parcial' || v.estado === 'planificada' ? motivoDe(v) : v.motivo || '', v.inicio, v.fin, Math.round(horasVisita(v) * 100) / 100, v.tareas.map(t => (t.hecha ? '✓ ' : '✗ ') + t.nombre).join('\n'),
          v.observaciones || '', pendientesDe(d, v).join('\n')].map(c => typeof c === 'object' ? c : {v: c, s: 'celda'}); })]};
    const tareas = {nombre: 'Tareas', fijarFila: 4, anchos: [11, 30, 22, 30, 12, 12],
      filas: [...cab('Tareas'), ['Fecha', 'Cliente', 'Establecimiento', 'Tarea', 'Prevista', 'Realizada'].map(enc),
        ...r.vs.flatMap(v => { const s = estabDe(d, v); return v.tareas.map(t => [fmtFecha(v.fecha), empresaDe(d, s)?.razonSocial || '', s?.nombre || '', t.nombre, t.prevista ? 'Sí' : 'No', {v: t.hecha ? 'Sí' : 'No', s: t.hecha ? 'ok' : 'mal'}]
          .map(c => typeof c === 'object' ? c : {v: c, s: 'celda'})); })]};
    const porEst = d.est.map(s => ({s, vs: r.vs.filter(v => v.estabId === s.id)})).filter(x => x.vs.length);
    const horas = {nombre: 'Horas por cliente', fijarFila: 4, anchos: [30, 24, 12, 12, 12, 16],
      filas: [...cab('Horas por cliente'), ['Cliente', 'Establecimiento', 'Visitas', 'Cumplidas', 'Horas', 'Comprometidas / mes'].map(enc),
        ...porEst.map(x => [empresaDe(d, x.s)?.razonSocial || '', x.s.nombre, x.vs.length, x.vs.filter(v => v.estado === 'cumplida' || v.estado === 'parcial').length,
          Math.round(x.vs.reduce((t, v) => t + horasVisita(v), 0) * 100) / 100, +x.s.horasMes || ''].map(c => ({v: c, s: 'celda'})))]};
    entregar('descargar', `Visitas_${desde}_a_${hasta}.xlsx`, Planilla.generar([visitas, tareas, horas]));
  };
  acciones.zipConstancias = async () => {
    const d = await datos(), vs = d.vis.filter(v => v.fecha >= S.xDesde && v.fecha <= S.xHasta && (v.constancia || v.planilla)).sort(porHora);
    if (!vs.length) return avisar('No hay constancias en ese período. Se generan al cerrar cada visita.');
    toast('Armando el .zip…');
    await lib('zip');
    const z = new JSZip(), usados = {};
    for (const v of vs) {
      const x = v.planilla || v.constancia;
      let n = x.nombre;
      if (usados[n]) n = n.replace('.pdf', `_${++usados[n]}.pdf`); else usados[n] = 1;
      z.file(n, x.data.split(',')[1], {base64: true});
    }
    entregar('descargar', `Constancias_${S.xDesde}_a_${S.xHasta}.zip`, await z.generateAsync({type: 'blob'}));
  };
  // Calendario .ics: visitas desde hace 30 días y las futuras (sin canceladas ni reprogramadas)
  acciones.exportarIcs = async () => {
    const d = await datos(), desde = sumarDias(hoy(), -30);
    const vs = d.vis.filter(v => v.fecha >= desde && v.estado !== 'cancelada' && v.estado !== 'reprogramada');
    if (!vs.length) return avisar('No hay visitas para exportar.');
    const tx = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const utc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Relevamientos HyS//Agenda//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Visitas HyS'];
    for (const v of vs) {
      const s = estabDe(d, v), inicio = Date.parse(`${v.fecha}T${v.hora || '09:00'}:00-03:00`);
      lineas.push('BEGIN:VEVENT', `UID:${v.id}@relevamientos-hys`, `DTSTAMP:${utc(Date.now())}`,
        ...(v.hora ? [`DTSTART:${utc(inicio)}`, `DTEND:${utc(inicio + (+v.duracion || 2) * 3600e3)}`] : [`DTSTART;VALUE=DATE:${v.fecha.replace(/-/g, '')}`]),
        `SUMMARY:${tx('Visita HyS · ' + cliente(d, s))}`, `LOCATION:${tx([s?.domicilio, s?.localidad].filter(Boolean).join(', '))}`,
        `DESCRIPTION:${tx(v.tareas.map(t => t.nombre).join(', ') + (v.notas ? '\n' + v.notas : ''))}`, 'END:VEVENT');
    }
    lineas.push('END:VCALENDAR');
    entregar('descargar', 'Visitas_HyS.ics', new Blob([lineas.join('\r\n')], {type: 'text/calendar'}));
  };
})();
