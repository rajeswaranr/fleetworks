-- Safe Drive clip review and 3-day retention.
--
-- Every recorded clip starts 'pending'. The owner or supervisor reviews it in Incident
-- Triage and either ARCHIVES it (kept) or DELETES it. Anything still 'pending' after 3
-- days is deleted automatically by the device-media-retention job, which also removes the
-- stored file. So a recording is always, within 3 days, verified-and-archived or gone.
alter table device_media add column if not exists review_status text not null default 'pending'
  check (review_status in ('pending', 'archived'));
alter table device_media add column if not exists reviewed_at timestamptz;
alter table device_media add column if not exists reviewed_by uuid;

-- owner/supervisor can update the review status (RBAC telemetry:update already generated)
grant update on device_media to authenticated;

create index if not exists idx_device_media_retention on device_media(captured_at)
  where kind = 'clip' and review_status = 'pending';
