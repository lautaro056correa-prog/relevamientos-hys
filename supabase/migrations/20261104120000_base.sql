-- Relevamientos HyS: base de la sincronización.
-- La app guarda todo como documentos: una fila por registro de cada "cajón" del celular (empresas, visitas, legajo, config…).
-- Las fotos y los PDF van aparte, al almacenamiento "archivos"; en la fila queda solo una referencia.
-- Regla central: cada fila pertenece a un usuario y solo ese usuario la puede ver o tocar (Row Level Security).

create sequence if not exists public.registros_seq;

create table if not exists public.registros (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  store      text   not null,
  id         text   not null,
  data       jsonb,                                          -- null cuando está borrado
  modificado bigint not null,                                -- hora de la modificación en el dispositivo: gana la última
  borrado    boolean not null default false,
  sync_seq   bigint not null default nextval('public.registros_seq'),  -- los dispositivos piden "lo posterior a N"
  primary key (user_id, store, id)
);
create index if not exists registros_usuario_seq on public.registros (user_id, sync_seq);

alter table public.registros enable row level security;
drop policy if exists "cada usuario ve lo suyo" on public.registros;
create policy "cada usuario ve lo suyo" on public.registros
  for select to authenticated using (user_id = auth.uid());
-- No hay permisos de escritura directa: se escribe solo con sync_guardar, que aplica "gana la última modificación".
revoke insert, update, delete on public.registros from anon, authenticated;
grant select on public.registros to authenticated;
revoke all on public.registros from anon;
revoke all on sequence public.registros_seq from anon, authenticated;

-- Guarda un lote de registros. Si otro dispositivo ya subió una versión más nueva, esa se conserva.
-- Devuelve cuántos se aplicaron.
create or replace function public.sync_guardar(filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  yo uuid := auth.uid();
  f jsonb;
  n integer := 0;
  c integer;
begin
  if yo is null then
    raise exception 'Hay que iniciar sesión';
  end if;
  for f in select * from jsonb_array_elements(filas) loop
    insert into registros as r (user_id, store, id, data, modificado, borrado, sync_seq)
    values (yo, f->>'store', f->>'id', case when coalesce((f->>'borrado')::boolean, false) then null else f->'data' end,
            (f->>'modificado')::bigint, coalesce((f->>'borrado')::boolean, false), nextval('registros_seq'))
    on conflict (user_id, store, id) do update
      set data = excluded.data, modificado = excluded.modificado, borrado = excluded.borrado, sync_seq = excluded.sync_seq
      where excluded.modificado >= r.modificado;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end;
$$;
revoke all on function public.sync_guardar(jsonb) from public, anon;
grant execute on function public.sync_guardar(jsonb) to authenticated;

-- ===== Fotos y documentos: cada usuario solo accede a su propia carpeta =====
insert into storage.buckets (id, name, public)
values ('archivos', 'archivos', false)
on conflict (id) do nothing;

drop policy if exists "archivos: leer lo propio" on storage.objects;
create policy "archivos: leer lo propio" on storage.objects
  for select to authenticated using (bucket_id = 'archivos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "archivos: subir a lo propio" on storage.objects;
create policy "archivos: subir a lo propio" on storage.objects
  for insert to authenticated with check (bucket_id = 'archivos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== Avisos al celular con la app cerrada (Web Push) =====
create table if not exists public.push_suscripciones (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh   text not null,
  auth     text not null,
  creado   timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_suscripciones enable row level security;
drop policy if exists "suscripciones propias" on public.push_suscripciones;
create policy "suscripciones propias" on public.push_suscripciones
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.push_suscripciones from anon;
grant select, insert, update, delete on public.push_suscripciones to authenticated;

-- Para no repetir el mismo aviso (lo usa solo la función del servidor)
create table if not exists public.avisos_enviados (
  user_id uuid not null references auth.users (id) on delete cascade,
  clave   text not null,
  enviado timestamptz not null default now(),
  primary key (user_id, clave)
);
alter table public.avisos_enviados enable row level security;
revoke all on public.avisos_enviados from anon, authenticated;

-- ===== Enlace de solo lectura para el director: se guarda solo la huella del token, nunca el token =====
create table if not exists public.enlaces_director (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token_hash text not null unique,
  creado     timestamptz not null default now()
);
alter table public.enlaces_director enable row level security;
drop policy if exists "enlace propio" on public.enlaces_director;
create policy "enlace propio" on public.enlaces_director
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.enlaces_director from anon;
grant select, insert, update, delete on public.enlaces_director to authenticated;
