-- FleetSafe scheduler and media storage.
--
-- Kept apart from the logic migrations because it needs Supabase platform pieces
-- (pg_cron, pg_net, Storage) that the in-process test database does not have.
--
-- Jobs:
--   every 5 min   fs_device_health()        trackers gone quiet / back
--   every minute  fleetsafe-dispatch         only when SMS alerts are waiting (outbox drain)
--   02:30 IST     fs_cold_chain_daily()     yesterday's reefer compliance
--   03:00 IST     fs_retention()            prune old readings
--
-- The dispatcher call needs two Vault secrets, set once outside this file so no key is
-- ever committed:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as FLEETSAFE_CRON_KEY>', 'fleetsafe_cron_key');
-- Until they exist the dispatch job does nothing and alerts stay in the in-app inbox.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------- media bucket ----------
-- Paths are <org_id>/<vehicle_id or device_id>/<yyyy>/<mm>/<dd>/<file>. Only the
-- device-media edge function writes (service role); members read what RLS lets them see.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('device-media', 'device-media', false, 104857600,
        array['video/mp4','video/quicktime','video/webm','video/x-matroska','image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function rbac_media_ok(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+' then false
    else case rbac_scope(split_part(p_path, '/', 1)::uuid, 'telemetry:read')
           when 'all' then true
           when 'assigned' then rbac_vehicle_ok(split_part(p_path, '/', 1)::uuid, split_part(p_path, '/', 2)::uuid, false)
           else false end
  end
$$;
drop policy if exists device_media_read on storage.objects;
create policy device_media_read on storage.objects for select to authenticated
  using (bucket_id = 'device-media' and rbac_media_ok(name));

-- ---------- jobs ----------
do $$ begin perform cron.unschedule(jobname) from cron.job where jobname like 'fleetsafe-%'; end $$;

select cron.schedule('fleetsafe-device-health', '*/5 * * * *', $$ select public.fs_device_health() $$);
select cron.schedule('fleetsafe-cold-chain-daily', '0 21 * * *', $$ select public.fs_cold_chain_daily() $$);   -- 21:00 UTC = 02:30 IST
select cron.schedule('fleetsafe-retention', '30 21 * * *', $$ select public.fs_retention() $$);               -- 03:00 IST

-- Outbox drain: call the dispatcher only when something is waiting, so the job costs
-- one index probe a minute on a quiet fleet.
select cron.schedule('fleetsafe-dispatch', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fleetsafe-dispatch',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'fleetsafe_cron_key')),
    body    := '{}'::jsonb)
  where exists (select 1 from public.fleet_alerts where delivery = 'pending')
    and exists (select 1 from vault.decrypted_secrets where name = 'fleetsafe_cron_key')
$$);
