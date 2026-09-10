-- ============ FleetWorks — Automation Engine ============
-- Intent-based workflow automation: fleet owners define rules in plain
-- English (AI parses them) or pick from templates. Rules run on a daily
-- schedule via pg_cron + this migration, or on-demand from automation.html.
--
-- Trigger types:
--   document_expiry  — vehicle insurance/PUC/fitness/permit/roadtax expiring soon
--   odometer_service — km since last service exceeds interval
--   expense_stale    — expense change requests pending > N days
--   high_issue_open  — High/Critical issues open > N days
--   fuel_efficiency  — fleet avg fuel efficiency drops by X%
--
-- Action types:
--   create_reminder  — adds to reminders table (visible in fleet dashboard)
--   create_work_order— adds to work_orders table
--   create_issue     — adds to issues table with source='automation'
--   whatsapp_notify  — calls whatsapp-send edge function
--
-- Real-time DB trigger: every High/Critical issue auto-creates a work order
-- immediately (doesn't wait for pg_cron).

-- ========================= 1. AUTOMATION RULES =========================

create table if not exists automation_rules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  description     text,
  intent_text     text,
  trigger_type    text not null check (trigger_type in (
                    'document_expiry','odometer_service','expense_stale',
                    'high_issue_open','fuel_efficiency'
                  )),
  trigger_config  jsonb not null default '{}',
  action_type     text not null check (action_type in (
                    'create_reminder','create_work_order','create_issue','whatsapp_notify'
                  )),
  action_config   jsonb not null default '{}',
  enabled         boolean not null default true,
  last_run_at     timestamptz,
  last_run_status text,
  run_count       int not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index if not exists idx_automation_rules_org     on automation_rules(org_id);
create index if not exists idx_automation_rules_enabled on automation_rules(org_id, enabled);

alter table automation_rules enable row level security;

drop policy if exists automation_rules_select on automation_rules;
drop policy if exists automation_rules_insert on automation_rules;
drop policy if exists automation_rules_update on automation_rules;
drop policy if exists automation_rules_delete on automation_rules;

create policy automation_rules_select on automation_rules for select to authenticated
  using (is_org_admin(org_id));
create policy automation_rules_insert on automation_rules for insert to authenticated
  with check (is_org_admin(org_id));
create policy automation_rules_update on automation_rules for update to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy automation_rules_delete on automation_rules for delete to authenticated
  using (is_org_admin(org_id));

grant select, insert, update, delete on automation_rules to authenticated;

-- ========================= 2. AUTOMATION RUN LOG =========================

create table if not exists automation_runs (
  id              uuid primary key default gen_random_uuid(),
  rule_id         uuid references automation_rules(id) on delete set null,
  org_id          uuid not null,
  rule_name       text,
  triggered_at    timestamptz not null default now(),
  vehicles_checked int not null default 0,
  actions_taken   int not null default 0,
  status          text not null default 'ok' check (status in ('ok','error','skipped')),
  details         jsonb
);

create index if not exists idx_automation_runs_org  on automation_runs(org_id, triggered_at desc);
create index if not exists idx_automation_runs_rule on automation_runs(rule_id);

alter table automation_runs enable row level security;

drop policy if exists automation_runs_select on automation_runs;
create policy automation_runs_select on automation_runs for select to authenticated
  using (is_org_admin(org_id));

grant select on automation_runs to authenticated;

-- ========================= 3. EXTEND REMINDERS =========================
-- Add source + rule_id so automation-created reminders are distinguishable
-- from manually added ones and traceable back to the rule that made them.

alter table reminders
  add column if not exists source  text,
  add column if not exists rule_id uuid references automation_rules(id) on delete set null,
  add column if not exists due_date date;

-- ========================= 4. REAL-TIME DB TRIGGER =========================
-- Any new High or Critical issue → auto-create a work order immediately.
-- Uses SECURITY DEFINER so the insert into work_orders bypasses the caller's
-- RLS (the function itself is trusted code, not user input).

create or replace function fn_auto_issue_to_workorder()
returns trigger language plpgsql security definer as $$
begin
  if new.severity in ('High', 'Critical') and coalesce(new.status, 'Open') = 'Open' then
    if not exists (
      select 1 from work_orders wo
      where wo.issue_id = new.id
        and wo.status not in ('Completed', 'Cancelled')
    ) then
      insert into work_orders (org_id, vehicle_id, issue_id, title, status, created_at)
      values (
        new.org_id,
        new.vehicle_id,
        new.id,
        coalesce(new.title, 'Issue') || ' — fix required',
        'Open',
        now()
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_issue_to_workorder on issues;
create trigger trg_auto_issue_to_workorder
  after insert on issues
  for each row execute function fn_auto_issue_to_workorder();

-- ========================= 5. PG_CRON DAILY SCHEDULE =========================
-- Runs the automation-run edge function at 06:30 IST (01:00 UTC) every day.
-- Requires pg_net extension (enabled by default in Supabase).
-- The AUTOMATION_SECRET must be set as a Supabase Edge Function secret and
-- also stored here as a DB parameter:
--   alter database postgres set app.automation_secret = 'your-secret-here';
--
-- To activate: run this block manually in Supabase SQL Editor after setting
-- the DB parameter above.
--
-- select cron.schedule(
--   'fleetworks-automation-daily',
--   '0 1 * * *',
--   $$
--   select net.http_post(
--     url  := 'https://crdblxeufbhysglbbtxi.supabase.co/functions/v1/automation-run',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-automation-key', current_setting('app.automation_secret', true)
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
