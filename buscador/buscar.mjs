// Buscador de normativa nueva de Higiene y Seguridad (sin librerías, Node 20+).
// Lee el Boletín Oficial de la República Argentina (Primera Sección) y el Boletín Oficial de Santa Fe,
// se queda con las normas relevantes según buscador/palabras-clave.json y las agrega a normativa/novedades.json.
// El cruce con las empresas NO se hace acá: lo hace la app en el celular, así los datos de los clientes no salen del dispositivo.
//
// Uso:  node buscador/buscar.mjs            → desde el día siguiente a la última corrida (los lunes cubre sábado y domingo)
//       node buscador/buscar.mjs --dias 30  → últimos 30 días (prueba)
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'normativa', 'novedades.json');
const REPORTE = join(RAIZ, 'buscador', 'ultima-corrida.json');
const UA = {'user-agent': 'Mozilla/5.0 (compatible; RelevamientosHyS/1.0; buscador de normativa)'};
const CONSERVAR_DIAS = 400;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ENT = {nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', deg: '°', ordm: 'º', ordf: 'ª', ndash: '–', mdash: '—', laquo: '«', raquo: '»'};
const entidades = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&([a-z]+);/gi, (m, n) => {
  if (ENT[n]) return ENT[n];
  const acento = n.match(/^([aeiouAEIOUnN])(acute|tilde|uml)$/);
  return acento ? (acento[1] + {acute: '́', tilde: '̃', uml: '̈'}[acento[2]]).normalize('NFC') : m;
});
const texto = html => entidades(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const iso = d => d.toISOString().slice(0, 10);
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Pausa entre pedidos al mismo sitio: el Boletín Oficial corta con "429" si se le pide muy rápido
let ultimoPedido = 0;
async function traer(url, intentos = 4){
  for (let i = 1; ; i++) {
    await esperar(Math.max(0, ultimoPedido + 1200 - Date.now()));
    ultimoPedido = Date.now();
    try {
      const r = await fetch(url, {headers: UA, signal: AbortSignal.timeout(30000)});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (i >= intentos) throw new Error(`${url}: ${e.message}`);
      await esperar(/429/.test(e.message) ? 20000 * i : 3000 * i);
    }
  }
}

// ---- Palabras clave ----
const PC = JSON.parse(await readFile(join(RAIZ, 'buscador', 'palabras-clave.json'), 'utf8'));
// Las palabras cortas (sga, art…) se buscan como palabra entera para no encontrarlas dentro de otras
const contiene = (t, p) => p.length <= 4 ? new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\b`).test(t) : t.includes(p);
const encontradas = (t, lista) => lista.filter(p => contiene(t, norm(p)));
const porGrupo = (t, grupos) => Object.entries(grupos).filter(([, ps]) => encontradas(t, ps).length).map(([k]) => k);

// Parte resolutiva: lo que sigue a "RESUELVE:", "DISPONE:" o "DECRETA:" (sin los considerandos, que citan de todo)
const resolutiva = cuerpo => { const i = cuerpo.search(/\b(RESUELVE|DISPONE|DECRETA|SANCIONA[\s\S]{0,40}?LEY)\s*:/); return i >= 0 ? cuerpo.slice(i) : cuerpo; };

// Decide si una norma entra. cabecera = organismo + tipo + sumario; cuerpo = texto completo (si se pudo leer)
function clasificar({organismo, cabecera, cuerpo}){
  const parte = resolutiva(cuerpo);
  const c = norm(cabecera), todo = norm(cabecera + '\n' + cuerpo), central = norm(cabecera + '\n' + parte);
  // Lo excluido se busca en el título y en el primer artículo (lo que la norma efectivamente hace)
  const excl = encontradas(c + '\n' + norm(resumen(cuerpo)), PC.excluir);
  const prioritario = PC.organismos_siempre.some(o => norm(organismo).includes(norm(o)));
  const claves = encontradas(todo, PC.incluir);
  if (excl.length) return {ok: false, motivo: 'Excluida por: ' + excl.slice(0, 3).join(', ')};
  if (!prioritario && !claves.length) return {ok: false, motivo: 'Sin palabras clave'};
  return {ok: true, palabras: claves, riesgos: porGrupo(central, PC.riesgos), rubros: porGrupo(central, PC.rubros),
    general: prioritario && /riesgos del trabajo/.test(norm(organismo)) || encontradas(central, PC.general).length > 0};
}

// Resumen sin IA: el primer artículo de la parte resolutiva ("ARTÍCULO 1°.- …"), recortado
function resumen(cuerpo){
  const m = resolutiva(cuerpo).match(/ART[IÍ]CULO\s*1\s*[°º]?\s*\.?\s*[-–:]+\s*([\s\S]{20,600}?)(?=\n|ART[IÍ]CULO\s*2)/i);
  const r = (m?.[1] || '').replace(/\s+/g, ' ').trim();
  return r.length > 300 ? r.slice(0, 297).replace(/\s\S*$/, '') + '…' : r;
}

// ---- Fuente 1: Boletín Oficial de la República Argentina, Primera Sección ----
async function boletinNacional(fecha, reporte){
  const ymd = fecha.replaceAll('-', '');
  const html = await traer(`https://www.boletinoficial.gob.ar/seccion/primera/${ymd}`);
  const avisos = [...html.matchAll(/<a href="(\/detalleAviso\/primera\/(\d+)\/\d+)"[^>]*>\s*<div class="linea-aviso">([\s\S]*?)<\/div>/g)];
  const out = [];
  for (const [, ruta, id, bloque] of avisos) {
    const partes = [...bloque.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => texto(m[1])).filter(Boolean);
    const [organismo = '', norma = '', sumario = ''] = partes;
    const cabecera = [organismo, norma, sumario].join(' — ');
    // Lectura rápida: solo se baja el texto completo si el organismo o el título lo justifican
    const previo = clasificar({organismo, cabecera, cuerpo: ''});
    const candidato = previo.ok || [...PC.organismos_siempre, ...PC.organismos_revisar].some(o => norm(organismo).includes(norm(o)));
    if (!candidato || PC.organismos_excluir.some(o => norm(organismo).includes(norm(o)))) continue;
    let cuerpo = '';
    try { cuerpo = texto((await traer('https://www.boletinoficial.gob.ar' + ruta)).match(/id="cuerpoDetalleAviso"[^>]*>([\s\S]*?)<\/article>/)?.[1] || ''); }
    catch (e) { reporte.errores.push(e.message); }
    const c = clasificar({organismo, cabecera, cuerpo});
    const [tipo, numero] = (norma.match(/^(.*?)\s+([\d.]+\/\d{4})$/) || [null, norma, '']).slice(1);
    const item = {id: 'bo-' + id, fecha, tipo, numero, organismo: titulo(organismo), jurisdiccion: 'Nación', titulo: limpiarSumario(sumario),
      url: `https://www.boletinoficial.gob.ar${ruta}`, fuente: 'Boletín Oficial de la República Argentina'};
    if (!c.ok) { reporte.descartadas.push({...item, motivo: c.motivo}); continue; }
    const res = resumen(cuerpo);
    if (!item.titulo) item.titulo = res ? (res.length > 160 ? res.slice(0, 157).replace(/\s\S*$/, '') + '…' : res) : norma;
    out.push({...item, resumen: res, riesgos: c.riesgos, rubros: c.rubros, general: c.general, palabras: c.palabras});
  }
  return out;
}
const titulo = s => s.toLowerCase().replace(/(^|[\s.(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y|E|En|Para|Por)\b/g, w => w.toLowerCase());
const limpiarSumario = s => s.replace(/^[A-Z]{2,6}-\d{4}-[\w-]+#?\w*\s*-?\s*/, '').trim();

// ---- Fuente 2: Boletín Oficial de la Provincia de Santa Fe ----
const SF = 'https://www.santafe.gov.ar/boletinoficial/';
const SF_IGNORAR = /licitaciones|avisos|convocatorias|contratos|remates|edictos|instituto/;
async function boletinSantaFe(fecha, reporte){
  const html = await traer(`${SF}resumendia.php?dia=${fecha}`);
  const secciones = [...new Set([...html.matchAll(/ver\.php\?seccion=([^"'&]+)/g)].map(m => m[1]))].filter(s => s.includes(fecha) && !SF_IGNORAR.test(s));
  const out = [];
  for (const s of secciones) {
    // Página de cada norma: "DECRETO N°2276  Ref: Homológase …  Link de acceso: https://…"
    const t = texto(await traer(SF + 'ver.php?seccion=' + s)).replace(/[\s\S]*?\}\s*(?=(?:DECRETO|RESOLUCI|LEY|DISPOSICI))/i, '');
    const link = t.match(/https:\/\/www\.santafe\.gob\.ar\/normativa\/item\.php\?id=\d+&(?:amp;)?cod=\w+/)?.[0]?.replace('&amp;', '&');
    const fin = t.search(/Link\s+de\s+acceso|RSS\s*\/\s*SUSCRIPCI/i), cabeza = t.slice(0, fin > 0 ? fin : 600).replace(/\s+/g, ' ').trim();
    const cab = cabeza.match(/(DECRETO|RESOLUCI[ÓO]N|LEY|DISPOSICI[ÓO]N)\s*N?\s*\.?\s*[°º]?\s*([\d.]+(?:\/\d+)?)/i);
    const tipo = cab ? titulo(cab[1]) : s.replace(/^.*\d{2}/, '').replace(/\d*\.html$/, '');
    const numero = cab?.[2]?.replace(/\.$/, '') || '';
    const ref = (cab ? cabeza.slice(cabeza.indexOf(cab[0]) + cab[0].length) : cabeza).replace(/^[\s:.–-]*(?:REF\s*[:.]+)?[\s:.–-]*/i, '').trim();
    const organismo = /ministerio de trabajo/i.test(t) ? 'Ministerio de Trabajo de Santa Fe' : 'Gobierno de Santa Fe';
    const c = clasificar({organismo, cabecera: `${tipo} ${numero} — ${ref}`, cuerpo: t});
    const item = {id: 'sf-' + s.replace(/\W+/g, '-'), fecha, tipo, numero, organismo, jurisdiccion: 'Santa Fe', titulo: ref.slice(0, 300) || `${tipo} ${numero}`,
      url: link || SF + 'ver.php?seccion=' + s, fuente: 'Boletín Oficial de la Provincia de Santa Fe'};
    if (!c.ok) { reporte.descartadas.push({...item, motivo: c.motivo}); continue; }
    out.push({...item, resumen: '', riesgos: c.riesgos, rubros: c.rubros, general: c.general, palabras: c.palabras});
  }
  return out;
}

// ---- Corrida ----
const args = process.argv.slice(2), diasArg = +(args[args.indexOf('--dias') + 1] || 0);
let previo = {actualizado: '', ultima_fecha: '', normas: []};
try { previo = JSON.parse(await readFile(SALIDA, 'utf8')); } catch {}
const hoy = new Date(Date.now() - 3 * 3600e3);   // hora argentina
const desde = diasArg ? new Date(hoy - diasArg * 864e5) : previo.ultima_fecha ? new Date(Date.parse(previo.ultima_fecha) + 864e5) : new Date(hoy - 7 * 864e5);
const fechas = [];
for (let d = new Date(iso(desde)); iso(d) <= iso(hoy); d = new Date(+d + 864e5)) if (d.getUTCDay() % 6) fechas.push(iso(d));   // días hábiles

const reporte = {corrida: new Date().toISOString(), fechas, encontradas: [], descartadas: [], errores: [], fuentes: {}};
const nuevas = [];
for (const [nombre, fn] of [['Boletín Oficial nacional', boletinNacional], ['Boletín Oficial de Santa Fe', boletinSantaFe]]) {
  let n = 0;
  for (const f of fechas) {
    try { const r = await fn(f, reporte); nuevas.push(...r); n += r.length; }
    catch (e) { reporte.errores.push(`${nombre} ${f}: ${e.message}`); }
  }
  reporte.fuentes[nombre] = n;
}
reporte.fuentes['Boletín Oficial de Rosario'] = 'No se lee automáticamente (no tiene listado diario accesible)';

const ids = new Set(previo.normas.map(n => n.id));
const agregadas = nuevas.filter(n => !ids.has(n.id) && ids.add(n.id));
const limite = iso(new Date(hoy - CONSERVAR_DIAS * 864e5));
const normas = [...agregadas, ...previo.normas].filter(n => n.fecha >= limite).sort((a, b) => b.fecha.localeCompare(a.fecha));
reporte.encontradas = agregadas.map(n => `${n.fecha} · ${n.jurisdiccion} · ${n.tipo} ${n.numero} · ${n.titulo} [${n.palabras.slice(0, 4).join(', ')}]${n.riesgos.length ? ' → riesgos: ' + n.riesgos.join(', ') : ''}`);

await mkdir(dirname(SALIDA), {recursive: true});
await writeFile(SALIDA, JSON.stringify({actualizado: new Date().toISOString(), ultima_fecha: fechas[fechas.length - 1] || previo.ultima_fecha, nuevas: agregadas.map(n => n.id), normas}, null, 1));
await writeFile(REPORTE, JSON.stringify(reporte, null, 1));
console.log(`Días revisados: ${fechas.length} · normas nuevas: ${agregadas.length} · descartadas: ${reporte.descartadas.length} · errores: ${reporte.errores.length}`);
reporte.encontradas.forEach(l => console.log('  + ' + l));
if (reporte.errores.length) console.log('Errores:\n  ' + reporte.errores.slice(0, 10).join('\n  '));
// Para el aviso del workflow
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `nuevas=${agregadas.length}\n`, {flag: 'a'});
