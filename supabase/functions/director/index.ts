// Página de solo lectura para el director (director.html): con el token secreto del enlace devuelve el resumen de visitas
// que subió la app. El servidor guarda solo ese resumen, lo mismo que va en el informe semanal: nada de relevamientos, fotos,
// legajo ni contactos. Del token se guarda solo la huella, y al regenerar el enlace el anterior deja de servir.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "metodo" }, 405);
  let token = "";
  try {
    token = String((await req.json()).token ?? "");
  } catch { /* cae en el control de abajo */ }
  if (!/^[0-9a-f]{64}$/.test(token)) return responder({ error: "enlace_invalido" }, 404);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.from("enlaces_director").select("datos,actualizado").eq("token_hash", await huella(token)).maybeSingle();
  if (error) {
    console.error("director", error);
    return responder({ error: "error_interno" }, 500);
  }
  if (!data?.datos) return responder({ error: "enlace_invalido" }, 404);
  return responder({ ...data.datos, generado: data.actualizado });
});
