-- ============ FleetWorks — coaching meetings ============
--
-- 20260912130000 modelled coaching as one session per event. That is wrong in
-- practice: it would have a supervisor calling the same driver in five separate
-- times for five events in the same week, and no driver tolerates that twice.
--
-- The real unit is a sitting. A supervisor sits down with one driver, walks
-- through each behaviour that has gone uncoached since last time, and closes
-- the lot in one conversation. So a MEETING is the sitting, and the existing
-- coaching_sessions rows become the per-event items inside it — which is what
-- that table always actually held, one row per coachable event.
--
-- Restructured rather than migrated: the table had no rows yet.

create table if not exists coaching_meetings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  driver_id    uuid not null references drivers(id) on delete cascade,
  coach_user_id uuid references auth.users(id) on delete set null,
  -- The coach's name is stored alongside the id because a coaching record has
  -- to stay readable after that supervisor leaves the company and their auth
  -- row is gone. The history is the point of keeping it at all.
  coach_name   text,
  status       text not null default 'in_progress'
                 check (status in ('in_progress','completed','abandoned')),
  summary_note text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_cmeet_driver on coaching_meetings(driver_id, started_at desc);
create index if not exists idx_cmeet_org    on coaching_meetings(org_id, status, started_at desc);

drop trigger if exists trg_cmeet_updated_at on coaching_meetings;
create trigger trg_cmeet_updated_at
  before update on coaching_meetings for each row execute function set_coaching_updated_at();

-- Each coachable event belongs to at most one meeting. Null means it is waiting
-- to be picked up by the next sitting, which is exactly the queue a supervisor
-- opens the coaching page to see.
alter table coaching_sessions add column if not exists meeting_id uuid
  references coaching_meetings(id) on delete set null;
create index if not exists idx_coach_meeting on coaching_sessions(meeting_id);

-- 'skipped' was missing: a supervisor who moves past a behaviour without
-- coaching it has not dismissed it either — it stays coachable next time, and
-- collapsing that into 'dismissed' would lose the event permanently.
alter table coaching_sessions drop constraint if exists coaching_sessions_status_check;
alter table coaching_sessions add constraint coaching_sessions_status_check
  check (status in ('assigned','acknowledged','completed','dismissed','skipped'));

alter table coaching_meetings enable row level security;

drop policy if exists cmeet_select on coaching_meetings;
create policy cmeet_select on coaching_meetings for select to authenticated
  using (is_org_member(org_id));

drop policy if exists cmeet_write on coaching_meetings;
create policy cmeet_write on coaching_meetings for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- The driver reads his own coaching history from the portal — seeing what was
-- said about him is the whole reason he accepts the next note.
drop policy if exists cmeet_anon on coaching_meetings;
create policy cmeet_anon on coaching_meetings for select to anon
  using (driver_id is not null);

grant select on coaching_meetings to anon;
grant select, insert, update, delete on coaching_meetings to authenticated;

comment on table coaching_meetings is
  'One sitting with one driver covering several behaviours. coaching_sessions '
  'rows are the per-event items inside it; a null meeting_id means the event is '
  'still waiting for the next sitting.';

-- ---------- What is waiting to be coached ----------
-- Groups a driver's uncoached events by behaviour, which is how the session
-- walks them: one step per behaviour, not one step per event.

create or replace view v_coachable_queue
with (security_invoker = true) as
select
  s.driver_id,
  d.name                                   as driver_name,
  s.org_id,
  s.event_type,
  count(*)                                 as events,
  max(s.severity)                          as worst_severity,
  min(s.assigned_at)                       as oldest_at,
  array_agg(s.event_id order by s.assigned_at) filter (where s.event_id is not null) as event_ids
from coaching_sessions s
join drivers d on d.id = s.driver_id
where s.status in ('assigned','skipped')
  and s.meeting_id is null
group by s.driver_id, d.name, s.org_id, s.event_type;

grant select on v_coachable_queue to authenticated;

comment on view v_coachable_queue is
  'Per driver per behaviour, the events still waiting for a coaching sitting. '
  'skipped is included deliberately — skipping a behaviour defers it, it does '
  'not dismiss it.';
