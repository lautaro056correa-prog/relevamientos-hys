-- Sin sincronización, el enlace del director muestra el resumen de visitas que sube la app (lo mismo que el informe semanal).
alter table public.enlaces_director
  add column if not exists datos jsonb,
  add column if not exists actualizado timestamptz;
