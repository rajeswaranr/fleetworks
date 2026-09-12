-- ============ FleetWorks — driver safety scoring & coaching ============
--
-- device_events already ingests every ADAS and AI-camera event the hardware
-- produces — lane departure, forward collision, phone use, fatigue, harsh
-- braking, overspeed. What is missing is the part that changes driver
-- behaviour: attributing an event to a person, scoring it, putting it in front
-- of that driver, and recording that he saw it.
--
-- An event nobody is accountable for is telemetry. An event attached to a
-- driver, with a score that moves and a coaching note he has acknowledged, is
-- a safety programme.

-- ========================= 1. Who was driving? =========================
-- device_events carries device_id, not driver_id, and deliberately so — the
-- box belongs to the truck, not the man. Attribution therefore has to be
-- reconstructed, and there are two sources of truth of different quality:
--
--   1. The trip that was running when the event happened. Authoritative: it
--      names the driver who was actually at the wheel at that timestamp.
--   2. The vehicle's current driver assignment. A guess, and it gets worse
--      the older the event is — reassign the truck and yesterday's events
--      silently re-attribute to the new man.
--
-- Both are returned, with which one was used, so nothing downstream has to
-- pretend a fallback is a fact. A disputed event can be shown for what it is.

-- Both candidates are ranked in one pass and the best one wins: pref 1 (a trip
-- that was actually running) beats pref 2 (the standing assignment), so the
-- fallback is used only when nothing better exists. Ranking rather than
-- UNION-with-NOT-EXISTS keeps the trip window written once — two copies of that
-- predicate would drift the moment the window changed.
create or replace function driver_for_event(p_vehicle_id uuid, p_at timestamptz)
returns table (driver_id uuid, attribution text)
language sql stable as $$
  select c.driver_id, c.attribution
    from (
      select t.driver_id, 'trip'::text as attribution, 1 as pref, t.actual_start as ord
        from trips t
       where t.vehicle_id = p_vehicle_id
         and t.driver_id is not null
         and t.actual_start is not null
         and p_at >= t.actual_start
         and p_at <= coalesce(t.actual_end, t.actual_start + interval '36 hours')
      union all
      select d.id, 'assignment'::text, 2, null::timestamptz
        from drivers d
       where d.vehicle_id = p_vehicle_id
    ) c
   where c.driver_id is not null
   order by c.pref, c.ord desc nulls last
   limit 1;
$$;

comment on function driver_for_event(uuid, timestamptz) is
  'Resolves the driver responsible for an event. Returns attribution = trip '
  '(authoritative) or assignment (a guess that decays with age). Callers must '
  'surface the difference rather than treating both as fact.';

-- ========================= 2. What each behaviour costs =========================
-- Weights are a safety policy, not a constant, so they live in a table a fleet
-- can argue with and change. Seeded from how severely each behaviour predicts
-- an actual collision: running a red light or falling asleep is not the same
-- as one harsh brake in traffic.

-- org_id null is the shipped default row; a fleet's own row for the same
-- event_type overrides it. That cannot be expressed with org_id in a primary
-- key — PK columns are implicitly NOT NULL — so uniqueness is two partial
-- indexes instead: one default per event_type, one override per org.
create table if not exists safety_event_weights (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade,
  event_type text not null,
  weight     numeric not null default 1 check (weight >= 0),
  is_coachable boolean not null default true
);
create unique index if not exists uq_sew_default on safety_event_weights (event_type)
  where org_id is null;
create unique index if not exists uq_sew_org on safety_event_weights (org_id, event_type)
  where org_id is not null;

alter table safety_event_weights enable row level security;

drop policy if exists sew_read on safety_event_weights;
create policy sew_read on safety_event_weights for select to authenticated
  using (org_id is null or is_org_member(org_id));

drop policy if exists sew_write on safety_event_weights;
create policy sew_write on safety_event_weights for all to authenticated
  using (org_id is not null and is_org_admin(org_id))
  with check (org_id is not null and is_org_admin(org_id));

grant select on safety_event_weights to authenticated;
grant insert, update, delete on safety_event_weights to authenticated;

insert into safety_event_weights (org_id, event_type, weight, is_coachable) values
  (null, 'forward_collision', 10, true),
  (null, 'pedestrian_warning', 10, true),
  (null, 'fatigue',            9, true),
  (null, 'no_seatbelt',        7, true),
  (null, 'phone_use',          7, true),
  (null, 'distraction',        6, true),
  (null, 'lane_departure',     5, true),
  (null, 'overspeed',          5, true),
  (null, 'headway_warning',    4, true),
  (null, 'harsh_brake',        3, true),
  (null, 'harsh_corner',       3, true),
  (null, 'harsh_accel',        2, true),
  (null, 'smoking',            2, true),
  -- Not the driver's behaviour. Scoring him for a severed power wire or a
  -- siphoned tank would make the score measure the wrong thing entirely.
  (null, 'fuel_drop',          0, false),
  (null, 'tamper',             0, false),
  (null, 'power_cut',          0, false),
  (null, 'sos',                0, false),
  (null, 'panic',              0, false)
on conflict (event_type) where org_id is null do nothing;

-- ========================= 3. Attributed events =========================
-- A view rather than columns on device_events: attribution is derived, and
-- baking a guess into a stored column is how it later gets mistaken for fact.

create or replace view v_safety_events
with (security_invoker = true) as
select
  e.id,
  e.org_id,
  e.device_id,
  d.vehicle_id,
  e.occurred_at,
  e.event_type,
  e.severity,
  e.latitude,
  e.longitude,
  e.speed_kmph,
  e.video_url,
  e.acknowledged_at,
  e.simulated,
  a.driver_id,
  a.attribution,
  coalesce(w_org.weight, w_def.weight, 1)            as weight,
  coalesce(w_org.is_coachable, w_def.is_coachable, true) as is_coachable
from device_events e
join devices d on d.id = e.device_id
left join lateral driver_for_event(d.vehicle_id, e.occurred_at) a on true
left join safety_event_weights w_org
       on w_org.org_id = e.org_id and w_org.event_type = e.event_type
left join safety_event_weights w_def
       on w_def.org_id is null and w_def.event_type = e.event_type;

grant select on v_safety_events to authenticated;

-- ========================= 4. Driver safety score =========================
-- Out of 100, over a rolling 30 days. Penalty is normalised per 1,000 km so a
-- long-haul driver who runs 12,000 km a month is not automatically worse than
-- a city driver doing 1,500 — raw event counts punish the man who drives more,
-- which is exactly the wrong incentive.
--
-- Below a distance floor the rate is too noisy to be a score: two events in
-- 40 km would read as catastrophic. Those drivers get a null score and an
-- "insufficient data" state, not a bad one.

create or replace view v_driver_safety_score
with (security_invoker = true) as
with win as (select (now() - interval '30 days') as since),
ev as (
  select s.driver_id, s.org_id,
         sum(s.weight)                                        as penalty_raw,
         count(*)                                             as events,
         count(*) filter (where s.severity = 'critical')      as critical_events,
         count(*) filter (where s.acknowledged_at is null)    as unreviewed
    from v_safety_events s, win
   where s.driver_id is not null
     and s.occurred_at >= win.since
     and s.weight > 0
   group by s.driver_id, s.org_id
),
km as (
  select t.driver_id, sum(coalesce(t.km, 0)) as km_driven
    from trips t, win
   where t.driver_id is not null
     and coalesce(t.actual_start, t.trip_date::timestamptz) >= win.since
   group by t.driver_id
)
select
  d.id                                   as driver_id,
  d.org_id,
  d.name                                 as driver_name,
  d.vehicle_id,
  coalesce(ev.events, 0)                 as events_30d,
  coalesce(ev.critical_events, 0)        as critical_30d,
  coalesce(ev.unreviewed, 0)             as unreviewed_30d,
  coalesce(km.km_driven, 0)              as km_30d,
  case
    when coalesce(km.km_driven, 0) < 250 then null
    else round(coalesce(ev.penalty_raw, 0) * 1000.0 / km.km_driven, 2)
  end                                    as penalty_per_1000km,
  case
    when coalesce(km.km_driven, 0) < 250 then null
    else greatest(0, least(100,
           round(100 - (coalesce(ev.penalty_raw, 0) * 1000.0 / km.km_driven) * 2.5)))
  end                                    as safety_score,
  case
    when coalesce(km.km_driven, 0) < 250 then 'insufficient_data'
    when coalesce(ev.penalty_raw, 0) * 1000.0 / km.km_driven <= 4  then 'excellent'
    when coalesce(ev.penalty_raw, 0) * 1000.0 / km.km_driven <= 10 then 'good'
    when coalesce(ev.penalty_raw, 0) * 1000.0 / km.km_driven <= 20 then 'needs_coaching'
    else 'at_risk'
  end                                    as band
from drivers d
left join ev on ev.driver_id = d.id
left join km on km.driver_id = d.id;

grant select on v_driver_safety_score to authenticated;

comment on view v_driver_safety_score is
  'Rolling 30-day driver safety score out of 100, penalty normalised per '
  '1000 km so distance does not decide the ranking. Under 250 km the rate is '
  'too noisy to score, and those drivers return null with band '
  'insufficient_data rather than a misleading number.';

-- ========================= 5. Coaching =========================
-- The loop that makes any of this worth collecting: a supervisor assigns an
-- event, the driver sees it and acknowledges, the session closes.
--
-- driver_id is stored here, not derived, precisely because coaching is a
-- conversation with a named person. If the truck is reassigned tomorrow, the
-- session that already happened must not follow the vehicle to someone else.

create table if not exists coaching_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  driver_id     uuid not null references drivers(id) on delete cascade,
  event_id      uuid references device_events(id) on delete set null,
  vehicle_id    uuid references vehicles(id) on delete set null,
  event_type    text,
  severity      text,
  status        text not null default 'assigned'
                  check (status in ('assigned','acknowledged','completed','dismissed')),
  coach_note    text,
  driver_note   text,
  -- Why a session was dropped matters: "camera misfired" and "driver disputes
  -- it" are different outcomes and a safety programme that cannot tell them
  -- apart will keep coaching people for faults in the hardware.
  dismiss_reason text check (dismiss_reason in
                  ('false_positive','not_driver_fault','duplicate','other')),
  assigned_by   uuid references auth.users(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  acknowledged_at timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One session per event. Two supervisors opening the same event is a
  -- collision, not two coaching conversations.
  unique (event_id)
);
create index if not exists idx_coach_driver on coaching_sessions(driver_id, status, assigned_at desc);
create index if not exists idx_coach_org    on coaching_sessions(org_id, status, assigned_at desc);

create or replace function set_coaching_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_coaching_updated_at on coaching_sessions;
create trigger trg_coaching_updated_at
  before update on coaching_sessions for each row execute function set_coaching_updated_at();

alter table coaching_sessions enable row level security;

-- Supervisors coach the drivers on the trucks they run, so this is
-- vehicle-scoped like everything else rather than admin-only.
drop policy if exists coach_select on coaching_sessions;
create policy coach_select on coaching_sessions for select to authenticated
  using (can_view_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id));

drop policy if exists coach_insert on coaching_sessions;
create policy coach_insert on coaching_sessions for insert to authenticated
  with check (can_update_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id));

drop policy if exists coach_update on coaching_sessions;
create policy coach_update on coaching_sessions for update to authenticated
  using (can_update_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id))
  with check (can_update_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id));

drop policy if exists coach_delete on coaching_sessions;
create policy coach_delete on coaching_sessions for delete to authenticated
  using (is_org_admin(org_id));

-- Driver (anon) reads his own sessions and acknowledges them from the portal.
-- He may write driver_note and move assigned -> acknowledged; he cannot
-- complete or dismiss his own coaching, which the column grant enforces.
drop policy if exists coach_anon_select on coaching_sessions;
create policy coach_anon_select on coaching_sessions for select to anon
  using (driver_id is not null);

drop policy if exists coach_anon_update on coaching_sessions;
create policy coach_anon_update on coaching_sessions for update to anon
  using (driver_id is not null and status = 'assigned')
  with check (driver_id is not null and status in ('assigned','acknowledged'));

grant select on coaching_sessions to anon;
grant update (status, driver_note, acknowledged_at, updated_at) on coaching_sessions to anon;
grant select, insert, update, delete on coaching_sessions to authenticated;

comment on table coaching_sessions is
  'One coaching conversation per safety event. driver_id is stored rather than '
  'derived so a session stays with the person it was about even after the '
  'vehicle is reassigned.';

-- ========================= 6. Verify =========================
--   select band, count(*) from v_driver_safety_score group by band;
--   select event_type, weight from safety_event_weights where org_id is null order by weight desc;
