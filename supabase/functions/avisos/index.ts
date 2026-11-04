// Avisos con la app cerrada. Este servidor NO conoce visitas ni clientes: a las 19:00 y a las 08:00 de Argentina (tarea
// programada con la clave AVISOS_CLAVE) solo "despierta" a cada celular suscripto. El mensaje lo arma el service worker
// del celular con sus datos locales y el pronóstico (web/sw.js). Con sesión de usuario y {prueba: true} manda un aviso de prueba.
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

async function enviar(subs: Fila[], mensaje: Fila) {
  let enviados = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(mensaje), { TTL: 6 * 3600 });
      enviados++;
    } catch (e) {
      const st = (e as Fila).statusCode;
      // El celular ya no está suscripto: se borra
      if (st === 404 || st === 410) await sb.from("push_suscripciones").delete().eq("user_id", s.user_id).eq("endpoint", s.endpoint);
      else console.error("push", st, (e as Fila).body ?? e);
    }
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
    return responder({ enviados: await enviar(subs ?? [], { titulo: "Relevamientos HyS", cuerpo: "Los avisos funcionan en este dispositivo.", tag: "prueba" }) });
  }

  // Tarea programada: despierta a todos los celulares
  if (req.headers.get("x-aviso-clave") !== Deno.env.get("AVISOS_CLAVE")) return responder({ error: "clave" }, 401);
  const { data: todas, error } = await sb.from("push_suscripciones").select("*");
  if (error) return responder({ error: error.message }, 500);
  const enviados = await enviar(todas ?? [], { tipo: cuerpo.momento === "noche" ? "noche" : "manana" });
  return responder({ suscripciones: (todas ?? []).length, enviados });
});
