-- Tareas programadas de los avisos: 22:00 UTC = 19:00 de Argentina (resumen de mañana) y 11:00 UTC = 08:00 (visitas sin cerrar).
-- La clave para llamar a la función está en el Vault de la base (secreto "avisos_clave"), no en este archivo.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('avisos-noche', '0 22 * * *', $$
  select net.http_post(
    url := 'https://obnuhhublcbdaolfpsjh.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-clave', (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_clave')),
    body := '{"momento":"noche"}'::jsonb,
    timeout_milliseconds := 60000)
$$);
select cron.schedule('avisos-manana', '0 11 * * *', $$
  select net.http_post(
    url := 'https://obnuhhublcbdaolfpsjh.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-clave', (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_clave')),
    body := '{"momento":"manana"}'::jsonb,
    timeout_milliseconds := 60000)
$$);
