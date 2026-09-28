-- Incident triage: one queue for every incident a fleet has to act on, whether a
-- camera saw it (device_events: collision, drowsiness, phone, lane departure) or
-- the vehicle twin inferred it (ai_events: fuel theft, leak, tyre loss, overheating).
--
--   incident_analyses   the AI root-cause write-up for one incident. Kept, not
--                       regenerated, so what the owner acted on stays on record.
--   resolution_note     why the owner closed an incident, on both event tables.
--
-- The analysis is written by the incident-analysis edge function under the service
-- role, after it has checked that the caller can read the incident through RLS.

create table if not exists incident_analyses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  source        text not null check (source in ('ai','device')),   -- ai_events or device_events
  event_id      uuid not null,
  vehicle_id    uuid references vehicles(id) on delete set null,
  root_cause    text not null,
  risk          text not null,
  action        text not null,
  compliance    text,
  est_loss_inr  numeric,
  confidence    text check (confidence in ('low','medium','high')),
  facts         jsonb not null default '{}'::jsonb,   -- what the model was given, so the write-up can be audited
  model         text,                                  -- null = written by the rules, no model call
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_incident_analyses_event on incident_analyses(source, event_id, created_at desc);
create index if not exists idx_incident_analyses_org on incident_analyses(org_id, created_at desc);

alter table ai_events     add column if not exists resolution_note text;
alter table device_events add column if not exists resolution_note text;

insert into rbac_table_registry(table_name, mode, resource, vehicle_col, org_col, notes) values
 ('incident_analyses', 'generated', 'telemetry', 'vehicle_id', 'org_id', 'AI root-cause write-up per incident')
on conflict (table_name) do update set mode = excluded.mode, resource = excluded.resource, vehicle_col = excluded.vehicle_col;
select rbac_apply('incident_analyses');
grant select on incident_analyses to authenticated;
