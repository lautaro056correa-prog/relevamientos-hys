// Avisos al celular con la app cerrada. Lo llama una tarea programada de la base (19:00 y 08:00 de Argentina) con la clave
// AVISOS_CLAVE. La noche anterior: visitas de mañana con su clima. A la mañana: visitas pasadas sin cerrar. Siempre: alertas
// de clima nuevas en los próximos 7 días. Con sesión de usuario y {prueba: true} manda un aviso de prueba a sus dispositivos.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aviso-clave",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails("https://lautaro056correa-prog.github.io/relevamientos-hys/", Deno.env.get("VAPID_PUBLICA")!, Deno.env.get("VAPID_PRIVADA")!);

const ZONA = "America/Argentina/Buenos_Aires";
const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
const sumarDias = (f: string, n: number) => new Date(Date.parse(f + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const corta = (f: string) => `${["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][new Date(f + "T12:00:00Z").getUTCDay()]} ${f.slice(8)}/${f.slice(5, 7)}`;
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
const BASE = [-32.9468, -60.6393]; // Rosario, si el establecimiento no tiene ubicación
const CLIMA_POR_DEFECTO = new Set(["act2", "act7", "act8", "act9"]); // PAT, simulacro, matafuegos, aire libre

async function enviar(uid: string, subs: Fila[], titulo: string, cuerpo: string, tag: string) {
  let enviados = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ titulo, cuerpo, tag }), { TTL: 6 * 3600 });
      enviados++;
    } catch (e) {
      const st = (e as Fila).statusCode;
      if (st === 404 || st === 410) await sb.from("push_suscripciones").delete().eq("user_id", uid).eq("endpoint", s.endpoint);
      else console.error("push", st, (e as Fila).body ?? e);
    }
  }
  return enviados;
}
// Devuelve true solo la primera vez que se pide esa clave
async function primeraVez(uid: string, clave: string) {
  const { error } = await sb.from("avisos_enviados").insert({ user_id: uid, clave });
  return !error;
}
async function pronosticos(puntos: string[]) {
  const out: Record<string, Fila> = {};
  for (const k of puntos) {
    const [la, lo] = k.split(",");
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=precipitation_probability_max,precipitation_sum,wind_speed_10m_max,temperature_2m_max&past_days=2&forecast_days=9&timezone=${encodeURIComponent(ZONA)}`);
      if (!r.ok) continue;
      const d = (await r.json()).daily, dias: Fila = {};
      d.time.forEach((f: string, i: number) => dias[f] = { prob: d.precipitation_probability_max[i] ?? 0, mm: d.precipitation_sum[i] ?? 0, viento: d.wind_speed_10m_max[i] ?? 0, max: d.temperature_2m_max[i] });
      out[k] = dias;
    } catch (e) {
      console.error("clima", k, e);
    }
  }
  return out;
}

async function avisosDe(uid: string, subs: Fila[], momento: string) {
  const hoy = hoyAR(), en7 = sumarDias(hoy, 7), man = sumarDias(hoy, 1);
  const leer = async (store: string, columnas = "id,data") => {
    const { data, error } = await sb.from("registros").select(columnas).eq("user_id", uid).eq("store", store).eq("borrado", false).limit(5000);
    if (error) throw error;
    return (data ?? []) as Fila[];
  };
  const { data: visRaw, error: ev } = await sb.from("registros").select("id,data").eq("user_id", uid).eq("store", "visitas").eq("borrado", false)
    .eq("data->>estado", "planificada").lte("data->>fecha", en7).limit(2000);
  if (ev) throw ev;
  const vis = (visRaw ?? []).map((f: Fila) => f.data as Fila);
  if (!vis.length) return 0;

  const [ests, emps, conf] = await Promise.all([leer("establecimientos", "id,nombre:data->>nombre,empresaId:data->>empresaId,lat:data->>lat,lng:data->>lng"), leer("empresas", "id,nombre:data->>razonSocial"), leer("config")]);
  const estab = new Map(ests.map((s) => [s.id, s])), empresa = new Map(emps.map((e) => [e.id, e.nombre]));
  const cfg = (id: string) => conf.find((c) => c.id === id)?.data;
  const clima = { prob: 60, mm: 2, viento: 40, pat: 10, ...(cfg("perfil")?.clima ?? {}) };
  const acts = cfg("actividades")?.lista as Fila[] | undefined;
  const esSensible = (t: Fila) => acts ? !!acts.find((a) => a.id === t.actividadId)?.clima : CLIMA_POR_DEFECTO.has(t.actividadId);
  const punto = (v: Fila) => { const s = estab.get(v.estabId); const la = s?.lat ? +s.lat : BASE[0], lo = s?.lng ? +s.lng : BASE[1]; return `${la.toFixed(2)},${lo.toFixed(2)}`; };
  const cliente = (v: Fila) => empresa.get(estab.get(v.estabId)?.empresaId ?? v.empresaId) ?? "Cliente";

  const futuras = vis.filter((v) => v.fecha >= hoy);
  const prono = await pronosticos([...new Set(futuras.map(punto))]);
  let enviados = 0;

  // Alertas de clima nuevas
  const alertas: string[] = [];
  for (const v of futuras) {
    const sens = (v.tareas ?? []).filter(esSensible), dias = prono[punto(v)], d = dias?.[v.fecha];
    if (!sens.length || !d) continue;
    const m: string[] = [];
    if (d.prob > clima.prob || d.mm > clima.mm) m.push(`lluvia ${d.prob}% (${d.mm} mm)`);
    if (d.viento > clima.viento) m.push(`viento ${Math.round(d.viento)} km/h`);
    if (sens.some((t: Fila) => /\bpat\b|puesta a tierra/i.test(t.nombre))) {
      const previa = [1, 2].reduce((n, i) => n + (dias[sumarDias(v.fecha, -i)]?.mm ?? 0), 0);
      if (previa > clima.pat) m.push(`${Math.round(previa)} mm en las 48 h previas (PAT)`);
    }
    if (m.length && await primeraVez(uid, `clima|${v.id}|${v.fecha}`)) alertas.push(`${cliente(v)} (${corta(v.fecha)}): ${sens.map((t: Fila) => t.nombre).join(", ")}: ${m.join(", ")}`);
  }
  if (alertas.length) enviados += await enviar(uid, subs, "Alerta de clima", alertas.join("\n"), "clima");

  // La noche anterior: las visitas de mañana con su clima
  if (momento === "noche") {
    const vm = futuras.filter((v) => v.fecha === man).sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
    if (vm.length && await primeraVez(uid, `noche|${man}`)) {
      const lineas = vm.map((v) => { const d = prono[punto(v)]?.[man]; return `${v.hora || "Sin hora"} ${cliente(v)}${d ? ` · ${Math.round(d.max)}° · lluvia ${d.prob}%` : ""}`; });
      enviados += await enviar(uid, subs, `Mañana: ${plural(vm.length, "visita", "visitas")}`, lineas.join("\n"), "manana");
    }
  }
  // A la mañana: visitas pasadas sin cerrar
  if (momento === "manana") {
    const sin = vis.filter((v) => v.fecha < hoy).length;
    if (sin && await primeraVez(uid, `sincerrar|${hoy}`)) enviados += await enviar(uid, subs, "Visitas sin cerrar", `Tenés ${plural(sin, "visita pasada", "visitas pasadas")} sin cerrar.`, "sincerrar");
  }
  return enviados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);
  const cuerpo = await req.json().catch(() => ({} as Fila));

  // Aviso de prueba: solo a los dispositivos del usuario con sesión
  if (cuerpo.prueba) {
    const { data: u } = await sb.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return responder({ error: "sin_sesion" }, 401);
    const { data: subs } = await sb.from("push_suscripciones").select("*").eq("user_id", u.user.id);
    const n = await enviar(u.user.id, subs ?? [], "Relevamientos HyS", "Los avisos funcionan en este dispositivo.", "prueba");
    return responder({ enviados: n });
  }

  // Tarea programada
  if (req.headers.get("x-aviso-clave") !== Deno.env.get("AVISOS_CLAVE")) return responder({ error: "clave" }, 401);
  const { data: todas, error } = await sb.from("push_suscripciones").select("*");
  if (error) return responder({ error: error.message }, 500);
  const porUsuario = new Map<string, Fila[]>();
  for (const s of todas ?? []) porUsuario.set(s.user_id, [...(porUsuario.get(s.user_id) ?? []), s]);
  let enviados = 0;
  for (const [uid, subs] of porUsuario) {
    try {
      enviados += await avisosDe(uid, subs, cuerpo.momento === "noche" ? "noche" : "manana");
    } catch (e) {
      console.error("avisos", uid, e);
    }
  }
  return responder({ usuarios: porUsuario.size, enviados });
});
