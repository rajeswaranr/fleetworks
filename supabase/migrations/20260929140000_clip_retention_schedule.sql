-- Nightly Safe Drive clip retention: delete clips still 'pending' after 3 days (file + row).
-- Runs at 03:20 IST, after fs_retention. Uses the same Vault secrets as the dispatcher
-- (project_url, fleetsafe_cron_key); until those exist the job is a no-op.
select cron.unschedule('fleetsafe-clip-retention') where exists (select 1 from cron.job where jobname = 'fleetsafe-clip-retention');

select cron.schedule('fleetsafe-clip-retention', '50 21 * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/device-media-retention',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'fleetsafe_cron_key')),
    body    := '{}'::jsonb)
  where exists (select 1 from vault.decrypted_secrets where name = 'fleetsafe_cron_key')
    and exists (select 1 from device_media where kind = 'clip' and review_status = 'pending' and captured_at < now() - interval '3 days')
$$);
