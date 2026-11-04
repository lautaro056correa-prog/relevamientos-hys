// Datos de solo lectura para la página del director (director.html). Se accede con un token secreto regenerable.
// Devuelve lo mismo que incluye el informe semanal: visitas, tareas, observaciones, pendientes y números.
// No expone configuración, contactos, fotos ni el detalle de los relevamientos (de estos, solo la fecha).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const huella = async (t: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);
  let token = "";
  try {
    token = String((await req.json()).token ?? "");
  } catch { /* cae en el control de abajo */ }
  if (!/^[0-9a-f]{64}$/.test(token)) return responder({ error: "enlace_invalido" }, 404);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: e } = await sb.from("enlaces_director").select("user_id").eq("token_hash", await huella(token)).maybeSingle();
  if (!e) return responder({ error: "enlace_invalido" }, 404);
  const uid = e.user_id;

  const desde = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const leer = async (store: string, columnas: string, filtro?: (q: Fila) => Fila) => {
    let q: Fila = sb.from("registros").select(columnas).eq("user_id", uid).eq("store", store).eq("borrado", false).limit(5000);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Fila[];
  };
  try {
    const [vis, ests, emps, rels, segs, pens, sems, perfil] = await Promise.all([
      leer("visitas", "id,data", (q) => q.gte("data->>fecha", desde)),
      leer("establecimientos", "id,nombre:data->>nombre,empresaId:data->>empresaId,horasMes:data->>horasMes"),
      leer("empresas", "id,razonSocial:data->>razonSocial"),
      leer("relevamientos", "fecha:data->>fecha_relevamiento", (q) => q.gte("data->>fecha_relevamiento", desde)),
      leer("seguimiento", "fecha:data->>fecha,fechaCierre:data->>fechaCierre,estado:data->>estado"),
      leer("pendientes", "texto:data->>texto,fecha:data->>fecha,visitaId:data->>visitaId,estado:data->>estado,fechaCierre:data->>fechaCierre,cierreVisitaId:data->>cierreVisitaId"),
      leer("semanas", "id,cerrada:data->>cerrada,fechaEnvio:data->>fechaEnvio"),
      leer("config", "nombre:data->>nombre,titulo:data->>titulo,matricula:data->>matricula", (q) => q.eq("id", "perfil")),
    ]);
    const estab = new Map(ests.map((s) => [s.id, s])), empresa = new Map(emps.map((x) => [x.id, x.razonSocial]));
    const visitas = vis.map(({ data: v }) => {
      const s = estab.get(v.estabId);
      return {
        fecha: v.fecha, hora: v.hora, inicio: v.inicio, fin: v.fin, estado: v.estado, motivo: v.motivo,
        cliente: empresa.get(s?.empresaId ?? v.empresaId) ?? "—", establecimiento: s?.nombre ?? "",
        estabId: v.estabId, tareas: (v.tareas ?? []).map((t: Fila) => ({ nombre: t.nombre, hecha: !!t.hecha })),
        observaciones: v.observaciones ?? "",
        pendientes: pens.filter((p) => p.visitaId === v.id || p.cierreVisitaId === v.id).map((p) => ({ texto: p.texto, estado: p.estado })),
      };
    });
    return responder({
      profesional: perfil[0] ?? {},
      generado: new Date().toISOString(),
      visitas,
      establecimientos: ests.map((s) => ({ id: s.id, nombre: s.nombre, cliente: empresa.get(s.empresaId) ?? "—", horasMes: +s.horasMes || 0 })),
      relevamientos: rels.map((r) => r.fecha),
      desvios: segs.map((o) => ({ fecha: o.fecha, fechaCierre: o.fechaCierre, estado: o.estado })),
      pendientes: pens.map((p) => ({ fecha: p.fecha, fechaCierre: p.fechaCierre, estado: p.estado })),
      semanas: sems.filter((x) => x.cerrada === "true").map((x) => ({ lunes: x.id, fechaEnvio: x.fechaEnvio })),
    });
  } catch (err) {
    console.error("director", err);
    return responder({ error: "error_interno" }, 500);
  }
});
