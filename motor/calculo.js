// Motor de cálculo del relevamiento.
// Aplica las reglas automáticas, evalúa cada elemento y arma desvíos, plan de acción,
// indicadores, seguimiento y conclusiones. No tiene lógica propia de ningún módulo:
// todo sale de la configuración (modulos/*.json) y de las plantillas (textos/plantillas.json).
const Motor = (() => {
  const PRIORIDADES = ['ALTA', 'MEDIA', 'BAJA'];
  const VALOR_TXT = {C: 'Cumple', NC: 'No cumple', NA: 'No aplica'};

  const tpl = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
  const fmtFecha = f => f ? f.split('-').reverse().join('/') : '';
  const fmtMes = m => m ? m.split('-').reverse().join('/') : '';
  const lista = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
  const sinPunto = s => String(s || '').replace(/\.\s*$/, '');
  const minuscula = s => s ? s[0].toLowerCase() + s.slice(1) : s;
  const cant = (n, sing, pl) => `${n} ${n === 1 ? sing : pl}`;
  const pluralDe = mod => mod.nombre_elemento_plural || mod.nombre_elemento + 's';

  function fmtAtributo(def, v){
    if (v == null || v === '') return '';
    if (def?.tipo === 'mes') return fmtMes(v);
    if (def?.tipo === 'fecha') return fmtFecha(v);
    const txt = def?.tipo === 'numero' ? String(v).replace('.', ',') : String(v);
    return def?.unidad ? `${txt} ${def.unidad}` : txt;
  }

  // Días que faltan para el vencimiento (negativo si ya venció). Un 'mes' vence el último día de ese mes.
  function diasHasta(def, v, fechaRel){
    const [y, m, d] = v.split('-').map(Number);
    const fin = def?.tipo === 'mes' ? new Date(y, m, 0) : new Date(y, m - 1, d);
    const [ry, rm, rd] = fechaRel.split('-').map(Number);
    return Math.round((fin - new Date(ry, rm - 1, rd)) / 86400000);
  }

  function cumpleCondicion(c, mod, el, fechaRel){
    if (c.atributo) {
      const def = (mod.atributos || []).find(a => a.clave === c.atributo);
      const v = el.atributos?.[c.atributo];
      const vacio = v == null || v === '';
      if (c.operador === 'vacio') return vacio;
      if (vacio) return false;
      switch (c.operador) {
        case 'vencido': return diasHasta(def, v, fechaRel) < 0;
        case 'vigente': return diasHasta(def, v, fechaRel) >= 0;
        case 'vence_en_dias': { const d = diasHasta(def, v, fechaRel); return d >= 0 && d <= c.valor; }
        case 'igual': return String(v) === String(c.valor);
        case 'distinto': return String(v) !== String(c.valor);
        case 'en': return c.valor.map(String).includes(String(v));
        case 'no_en': return !c.valor.map(String).includes(String(v));
      }
      return false;
    }
    const v = el.resultados?.[c.item]?.valor;
    switch (c.operador) {
      case 'vacio': return !v;
      case 'igual': return v === c.valor;
      case 'distinto': return !!v && v !== c.valor;
      case 'en': return c.valor.includes(v);
      case 'no_en': return !!v && !c.valor.includes(v);
    }
    return false;
  }

  // Resultado final de cada ítem: lo cargado a mano, pisado por las reglas automáticas que se cumplan
  function evaluar(mod, el, items, fechaRel, conReglas = true){
    const res = {}, observaciones = [];
    for (const it of items) {
      const m = el.resultados?.[it.clave];
      if (m?.valor) res[it.clave] = {valor: m.valor, obs: m.valor === 'NC' ? (m.obs || '') : '', gravedad: m.gravedad || it.gravedad};
    }
    if (conReglas) for (const r of mod.reglas_automaticas || []) {
      if (!cumpleCondicion(r.cuando, mod, el, fechaRel)) continue;
      const vars = {};
      for (const a of mod.atributos || []) vars[a.clave] = fmtAtributo(a, el.atributos?.[a.clave]);
      const obs = tpl(r.entonces.observacion, vars);
      if (r.entonces.valor && r.entonces.items) {
        for (const k of r.entonces.items) {
          const it = items.find(i => i.clave === k);
          if (!it) continue;
          res[k] = {valor: r.entonces.valor, obs: obs || (r.entonces.valor === 'NC' ? res[k]?.obs || '' : ''),
            gravedad: r.entonces.gravedad || it.gravedad, auto: true, motivo: r.descripcion || ''};
        }
      } else if (obs) observaciones.push(obs);
    }
    const conteo = {C: 0, NC: 0, NA: 0};
    for (const k in res) conteo[res[k].valor]++;
    const faltan = items.filter(it => !res[it.clave]).map(it => it.clave);
    const faltanAtributos = conReglas ? (mod.atributos || []).filter(a => a.obligatorio && (el.atributos?.[a.clave] ?? '') === '').map(a => a.etiqueta) : [];
    if (conReglas && !el.sector && mod.tipo_elemento !== 'establecimiento') faltanAtributos.unshift(mod.tipo_elemento === 'sector' ? mod.nombre_elemento : 'Sector');
    return {res, observaciones, conteo, faltan, faltanAtributos, completo: !faltan.length && !faltanAtributos.length};
  }

  function nombreElemento(mod, el, i){
    if (mod.tipo_elemento === 'establecimiento') return mod.titulo;
    if (mod.tipo_elemento === 'sector') return el.sector || `${mod.nombre_elemento} ${i + 1}`;
    return `${mod.nombre_elemento} N° ${i + 1}`;
  }

  // "Extintor N° 2" / "Extintores N° 1, 3 y 4" / "Cocina, Depósito y Salón"
  function listaElementos(mod, elems){
    const unicos = [...new Map(elems.map(e => [e.num, e])).values()].sort((a, b) => a.num - b.num);
    if (mod.tipo_elemento !== 'equipo') return lista(unicos.map(e => e.nombre));
    return unicos.length === 1 ? unicos[0].nombre : `${pluralDe(mod)} N° ${lista(unicos.map(e => String(e.num)))}`;
  }

  function contarPrioridades(desvios){
    const c = {ALTA: 0, MEDIA: 0, BAJA: 0};
    desvios.forEach(d => c[d.prioridad]++);
    return c;
  }

  // "1 desvío de prioridad ALTA" / "8 desvíos: 3 de prioridad ALTA y 5 de prioridad MEDIA"
  function resumenDesvios(c){
    const usados = PRIORIDADES.filter(p => c[p]);
    const total = usados.reduce((s, p) => s + c[p], 0);
    if (usados.length === 1) return `${cant(total, 'desvío', 'desvíos')} de prioridad ${usados[0]}`;
    return `${total} desvíos: ${lista(usados.map(p => `${c[p]} de prioridad ${p}`))}`;
  }

  function indicadores(elementos, evals, desvios){
    const ind = {elementos: elementos.length, conformes: 0, noConformes: 0, C: 0, NC: 0, NA: 0};
    elementos.forEach(e => e.resultado === 'CONFORME' ? ind.conformes++ : ind.noConformes++);
    evals.forEach(ev => { ind.C += ev.conteo.C; ind.NC += ev.conteo.NC; ind.NA += ev.conteo.NA; });
    ind.evaluados = ind.C + ind.NC + ind.NA;
    ind.pct = ind.C + ind.NC ? Math.round(ind.C * 100 / (ind.C + ind.NC)) : 100;
    ind.prioridades = contarPrioridades(desvios);
    ind.desvios = desvios.length;
    return ind;
  }

  function sumar(inds){
    const t = {elementos: 0, conformes: 0, noConformes: 0, C: 0, NC: 0, NA: 0, desvios: 0, prioridades: {ALTA: 0, MEDIA: 0, BAJA: 0}};
    for (const i of inds) {
      for (const k of ['elementos', 'conformes', 'noConformes', 'C', 'NC', 'NA', 'desvios']) t[k] += i[k];
      for (const p of PRIORIDADES) t.prioridades[p] += i.prioridades[p];
    }
    t.evaluados = t.C + t.NC + t.NA;
    t.pct = t.C + t.NC ? Math.round(t.C * 100 / (t.C + t.NC)) : 100;
    return t;
  }

  const ordenPrio = p => PRIORIDADES.indexOf(p);

  // Agrupa en una fila los desvíos que se resuelven con la misma acción
  function planDeModulo(mod, desvios){
    const grupos = new Map();
    for (const d of desvios) {
      const clave = mod.id + '|' + d.accion;
      if (!grupos.has(clave)) grupos.set(clave, {clave, moduloId: mod.id, mod, accion: d.accion, responsable: d.responsable, prioridad: d.prioridad, desvios: [], origen: 'desvio', estado: 'Pendiente'});
      const g = grupos.get(clave);
      g.desvios.push(d);
      if (ordenPrio(d.prioridad) < ordenPrio(g.prioridad)) g.prioridad = d.prioridad;
    }
    return [...grupos.values()].map(g => {
      const conEl = g.desvios.filter(d => d.elemento).map(d => d.elemento);
      const partes = [];
      if (conEl.length) partes.push(listaElementos(mod, conEl));
      if (g.desvios.some(d => !d.elemento)) partes.push('General');
      return {...g, elementos: partes.join(' / ')};
    });
  }

  function conclusionModulo(P, mod, m){
    const ind = m.ind, n = ind.elementos;
    const vars = {
      se_relevaron: n === 1 ? 'Se relevó' : 'Se relevaron',
      elementos: cant(n, mod.nombre_elemento.toLowerCase(), pluralDe(mod).toLowerCase()),
      estado_elementos: ind.noConformes ? `${ind.noConformes} ${ind.noConformes === 1 ? 'presenta' : 'presentan'} desvíos`
        : (n === 1 ? 'no presenta desvíos propios' : 'ninguno presenta desvíos propios'),
      pct: ind.pct,
      se_registran: ind.desvios === 1 ? 'Se registra' : 'Se registran',
      desvios_resumen: ind.desvios ? resumenDesvios(ind.prioridades) : ''
    };
    if (mod.tipo_elemento === 'establecimiento') Object.assign(vars, {
      se_relevaron: 'Se relevaron', elementos: `los ítems de ${minuscula(mod.titulo)}`,
      estado_elementos: `${ind.NC} ${ind.NC === 1 ? 'no cumple' : 'no cumplen'}`
    });
    // Desvíos ALTA agrupados por ítem: "extintor con carga vencida (Extintores N° 2 y 5)"
    const altas = new Map();
    for (const d of m.desvios.filter(d => d.prioridad === 'ALTA')) {
      if (!altas.has(d.item.clave)) altas.set(d.item.clave, {texto: d.item.desvio_defecto, elems: [], general: false});
      const a = altas.get(d.item.clave);
      d.elemento ? a.elems.push(d.elemento) : a.general = true;
    }
    vars.lista_alta = [...altas.values()].map(a => `${minuscula(sinPunto(a.texto))}${a.elems.length ? ` (${listaElementos(mod, a.elems)})` : ''}`).join('; ');
    let txt = tpl(!ind.desvios ? P.conclusion.sin_desvios : ind.prioridades.ALTA ? P.conclusion.alta : P.conclusion.media_baja, vars);
    // Sector con más desvíos
    const porSector = {};
    m.desvios.filter(d => d.elemento?.sector).forEach(d => porSector[d.elemento.sector] = (porSector[d.elemento.sector] || 0) + 1);
    const max = Math.max(0, ...Object.values(porSector));
    const top = Object.keys(porSector).filter(s => porSector[s] === max);
    if (max && mod.tipo_elemento !== 'establecimiento') txt += ' ' + (top.length === 1
      ? tpl(P.conclusion.sector, {sector: top[0], n_sector: cant(max, 'desvío', 'desvíos')})
      : tpl(P.conclusion.sectores_empate, {sectores: lista(top), n_sector: cant(max, 'desvío', 'desvíos')}));
    return txt;
  }

  function calcular(rel, ctx, conSeguimiento = true){
    const P = ctx.plantillas, fecha = rel.fecha_relevamiento;
    const modulos = rel.modulos.filter(rm => ctx.modulos[rm.modulo_id]).map((rm, mi) => {
      const mod = ctx.modulos[rm.modulo_id];
      const elementos = rm.elementos.map((el, i) => {
        const ev = evaluar(mod, el, mod.items, fecha);
        return {id: el.id, num: i + 1, nombre: nombreElemento(mod, el, i), sector: el.sector || '', el, ev,
          resultado: ev.conteo.NC ? 'NO CONFORME' : 'CONFORME'};
      });
      const generales = (mod.items_generales || []).length
        ? evaluar(mod, {resultados: rm.generales || {}}, mod.items_generales, fecha, false) : null;

      const desvios = [];
      const agregar = (it, idx, r, elemento) => desvios.push({mod, moduloIdx: mi, elemento, item: it, itemIdx: idx,
        texto: r.obs || it.desvio_defecto, requisito: it.norma, prioridad: r.gravedad || it.gravedad,
        accion: it.accion_defecto, responsable: it.responsable_defecto});
      for (const e of elementos) mod.items.forEach((it, idx) => { const r = e.ev.res[it.clave]; if (r?.valor === 'NC') agregar(it, idx, r, e); });
      if (generales) mod.items_generales.forEach((it, idx) => { const r = generales.res[it.clave]; if (r?.valor === 'NC') agregar(it, idx, r, null); });
      desvios.sort((a, b) => ordenPrio(a.prioridad) - ordenPrio(b.prioridad)
        || (a.elemento ? a.elemento.num : 1e9) - (b.elemento ? b.elemento.num : 1e9) || a.itemIdx - b.itemIdx);

      const observaciones = [];
      for (const e of elementos) e.ev.observaciones.forEach(o => observaciones.push(`${e.nombre}${e.sector && mod.tipo_elemento === 'equipo' ? ` (${e.sector})` : ''}: ${o}`));
      if (rm.observaciones?.trim()) observaciones.push(rm.observaciones.trim());

      const ind = indicadores(elementos, [...elementos.map(e => e.ev), ...(generales ? [generales] : [])], desvios);
      const plan = planDeModulo(mod, desvios);
      const gestion = (mod.acciones_gestion || []).map(a => ({clave: mod.id + '|' + a.accion, moduloId: mod.id, mod, accion: a.accion,
        responsable: a.responsable, prioridad: 'BAJA', elementos: 'General', origen: 'gestion', estado: 'Pendiente', desvios: []}));
      const incompletos = [
        ...elementos.filter(e => !e.ev.completo).map(e => ({nombre: e.nombre, faltan: [...e.ev.faltanAtributos, ...e.ev.faltan.map(k => mod.items.find(i => i.clave === k).texto)]})),
        ...(generales && generales.faltan.length ? [{nombre: 'Verificaciones generales', faltan: generales.faltan.map(k => mod.items_generales.find(i => i.clave === k).texto)}] : [])
      ];
      const m = {mod, rm, elementos, generales, desvios, observaciones, ind, plan, gestion, incompletos};
      m.conclusion = conclusionModulo(P, mod, m);
      return m;
    });

    const multi = modulos.length > 1;
    const total = sumar(modulos.map(m => m.ind));
    const desvios = modulos.flatMap(m => m.desvios).sort((a, b) => ordenPrio(a.prioridad) - ordenPrio(b.prioridad) || a.moduloIdx - b.moduloIdx);
    const plan = [...modulos.flatMap(m => m.plan).sort((a, b) => ordenPrio(a.prioridad) - ordenPrio(b.prioridad)), ...modulos.flatMap(m => m.gestion)];
    plan.forEach((p, i) => p.n = i + 1);

    // Seguimiento de las acciones del relevamiento anterior
    let seguimiento = null;
    if (conSeguimiento && ctx.previo) {
      const ant = calcular(ctx.previo, {...ctx, previo: null}, false);
      seguimiento = {fecha: ctx.previo.fecha_relevamiento, filas: ant.plan.filter(a => a.origen === 'desvio').map(a => {
        const actual = plan.find(p => p.clave === a.clave);
        const verificado = rel.modulos.some(m => m.modulo_id === a.moduloId);
        if (actual) actual.estado = 'Pendiente (reiterada)';
        return {accion: a.accion, elementos: a.elementos, prioridad: a.prioridad,
          estado: !verificado ? 'No verificada' : actual ? 'Pendiente' : 'Cerrada'};
      })};
    }

    const normas = [...new Map(modulos.flatMap(m => m.mod.normas).map(n => [n.codigo, n])).values()];
    // Carátula: la ley marco y la norma principal de cada módulo, completando hasta 4
    const esLey = n => /^Ley\b/.test(n.codigo);
    const normasCaratula = [...new Set([...normas.filter(esLey), ...modulos.map(m => m.mod.normas.find(n => !esLey(n))).filter(Boolean), ...normas]
      .map(n => n.codigo))].slice(0, Math.max(4, modulos.length + 1));
    const sectores = [...new Set(modulos.flatMap(m => m.elementos.map(e => e.sector)).filter(Boolean))];
    const e = ctx.empresa;

    const objetivo = multi
      ? [tpl(P.objetivo_general, {modulos: lista(modulos.map(m => minuscula(m.mod.titulo)))}), ...modulos.map(m => `• ${m.mod.titulo}: ${minuscula(m.mod.textos.objetivo)}`)].join('\n')
      : modulos[0]?.mod.textos.objetivo || '';
    const domicilio = [e.domicilio, e.localidad, e.provincia].filter(Boolean).join(', ');
    const alcance = [
      tpl(P.alcance, {
        fecha: fmtFecha(fecha), razon_social: e.razonSocial,
        domicilio_frase: domicilio ? `, ubicado en ${domicilio}` : '',
        elementos_relevados: lista(modulos.map(m => m.mod.tipo_elemento === 'establecimiento' ? minuscula(m.mod.titulo)
          : cant(m.ind.elementos, m.mod.nombre_elemento.toLowerCase(), pluralDe(m.mod).toLowerCase()))),
        sectores_frase: sectores.length === 1 ? ` en el sector ${sectores[0]}` : sectores.length ? ` en los sectores ${lista(sectores)}` : ''
      }),
      'Límites de la inspección:',
      `• ${P.alcance_limite_comun}`,
      ...modulos.filter(m => m.mod.textos.alcance_extra).map(m => `• ${multi ? m.mod.titulo + ': ' : ''}${m.mod.textos.alcance_extra}`)
    ].join('\n');
    const conclusion = multi
      ? [...modulos.map(m => `${m.mod.titulo}: ${m.conclusion}`),
         tpl(!total.desvios ? P.conclusion.general_sin_desvios : total.prioridades.ALTA ? P.conclusion.general_alta : P.conclusion.general_media_baja,
           {pct: total.pct, desvios_resumen: total.desvios ? resumenDesvios(total.prioridades) : ''})].join('\n')
      : modulos[0]?.conclusion || '';

    return {
      rel, empresa: e, multi, modulos, total, desvios, plan, seguimiento, normas, normasCaratula, sectores,
      subtitulo: multi ? P.subtitulo_general : modulos[0]?.mod.subtitulo_informe || P.subtitulo_general,
      recomendaciones: [...new Set(modulos.flatMap(m => m.mod.textos.recomendaciones || []))],
      prioridadesUsadas: PRIORIDADES.filter(p => total.prioridades[p]),
      incompletos: modulos.flatMap(m => m.incompletos.map(i => ({...i, modulo: m.mod.titulo}))),
      textosAuto: {objetivo, alcance, conclusion},
      textos: {
        objetivo: rel.textos_editados?.objetivo ?? objetivo,
        alcance: rel.textos_editados?.alcance ?? alcance,
        conclusion: rel.textos_editados?.conclusion ?? conclusion
      }
    };
  }

  return {calcular, evaluar, nombreElemento, fmtAtributo, fmtFecha, fmtMes, VALOR_TXT, PRIORIDADES, lista, cant};
})();
