-- ============ FleetWorks — Integrated Service Workflow (production schema) ============
-- Run in Supabase SQL Editor. Idempotent, SELF-CONTAINED — safe to run in any
-- order relative to db/schema-normalized.sql (shared tables use identical
-- definitions guarded by "if not exists"). NO jsonb blobs — fully relational.
-- Files (photos/reports/invoices) go to Supabase Storage; tables hold paths.
--
-- Lifecycle (service_requests.stage):
-- raised → assigned → accepted → reached → assessed → approved →
-- in_progress → completed → invoiced → paid → reported → closed
-- Every transition is audit-logged in status_events by trigger.

-- ---------- Prerequisites (identical subset of schema-normalized.sql) ----------
create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default 'My Fleet',
  gstin            text,
  city             text,
  warn_days        int not null default 30,
  min_tread_mm     numeric not null default 1.6,
  mileage_drop_pct numeric,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.memberships (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'owner' check (role in ('owner','manager','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_org  on public.memberships(org_id);

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or exists (
      select 1 from memberships m
      where m.org_id = p_org and m.user_id = auth.uid()
    );
$$;

create table if not exists public.vehicles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  ext_id         text,
  name           text not null,
  type           text,
  km_per_month   numeric,
  insurance_till date,
  puc_till       date,
  fitness_till   date,
  permit_till    date,
  roadtax_till   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, ext_id)
);
create index if not exists idx_vehicles_org on public.vehicles(org_id);

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.vehicles enable row level security;
drop policy if exists "org_read" on public.organizations;
create policy "org_read" on public.organizations for select to authenticated using (public.is_org_member(id));
drop policy if exists "membership_read" on public.memberships;
create policy "membership_read" on public.memberships for select to authenticated using (user_id = auth.uid() or public.is_org_member(org_id));
drop policy if exists "vehicles_rw" on public.vehicles;
create policy "vehicles_rw" on public.vehicles for all to authenticated using (public.is_org_member(org_id));

-- ---------- Enums ----------
do $$ begin
  create type request_stage as enum ('raised','assigned','accepted','reached','assessed',
    'approved','in_progress','completed','invoiced','paid','reported','closed','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type actor_role as enum ('owner','mechanic','fleetworks','system');
exception when duplicate_object then null; end $$;
do $$ begin
  create type estimate_status as enum ('draft','sent','approved','rejected','expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type invoice_status as enum ('draft','issued','paid','void');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payout_status as enum ('accruing','due','paid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type attachment_kind as enum ('repair_photo','assessment_photo','invoice_pdf','report_pdf','other');
exception when duplicate_object then null; end $$;

-- ---------- Workshops & mechanics (partner side) ----------
create table if not exists public.workshops (
  id          uuid primary key default gen_random_uuid(),
  owner_user  uuid,                                    -- auth user of the partner
  name        text not null,
  city        text,
  address     text,
  lat         double precision,
  lng         double precision,
  phone       text,
  gstin       text,
  services    text[] default '{}',
  rating      numeric(2,1) default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.mechanics (
  id           uuid primary key default gen_random_uuid(),
  workshop_id  uuid not null references public.workshops(id) on delete cascade,
  name         text not null,
  phone        text,
  years_exp    int,
  specialties  text[] default '{}',
  rating       numeric(2,1) default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists mechanics_workshop on public.mechanics(workshop_id);

-- FleetWorks service advisors assigned to partners
create table if not exists public.service_advisors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  cluster     text
);
alter table public.workshops
  add column if not exists advisor_id uuid references public.service_advisors(id);

-- ---------- The service request (one row per complaint/booking) ----------
create table if not exists public.service_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  vehicle_id   uuid not null references public.vehicles(id),
  raised_by    uuid,                                   -- auth user (owner side)
  issue        text not null,
  severity     text not null default 'Medium' check (severity in ('Low','Medium','High')),
  stage        request_stage not null default 'raised',
  workshop_id  uuid references public.workshops(id),
  mechanic_id  uuid references public.mechanics(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sr_org_stage on public.service_requests(org_id, stage);
create index if not exists sr_workshop_stage on public.service_requests(workshop_id, stage);

-- Assignment history (FleetWorks matching; owner acceptance recorded here)
create table if not exists public.request_assignments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.service_requests(id) on delete cascade,
  workshop_id  uuid not null references public.workshops(id),
  mechanic_id  uuid references public.mechanics(id),
  distance_km  numeric(6,1),
  assigned_by  actor_role not null default 'fleetworks',
  assigned_at  timestamptz not null default now(),
  owner_accepted_at timestamptz,
  declined_at  timestamptz,
  decline_reason text
);
create index if not exists ra_request on public.request_assignments(request_id);

-- ---------- Assessment, estimate, approval ----------
create table if not exists public.assessments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.service_requests(id) on delete cascade,
  mechanic_id  uuid references public.mechanics(id),
  notes        text not null,
  tat_hours    int,
  odo_km       int,
  created_at   timestamptz not null default now()
);
create index if not exists assess_request on public.assessments(request_id);

create table if not exists public.estimates (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.service_requests(id) on delete cascade,
  assessment_id uuid references public.assessments(id),
  status        estimate_status not null default 'draft',
  currency      text not null default 'INR',
  valid_till    date,
  sent_at       timestamptz,
  approved_at   timestamptz,
  approved_by   uuid,                                  -- owner-side auth user
  rejected_reason text,
  created_at    timestamptz not null default now()
);
create index if not exists est_request on public.estimates(request_id);

create table if not exists public.estimate_items (
  id           uuid primary key default gen_random_uuid(),
  estimate_id  uuid not null references public.estimates(id) on delete cascade,
  description  text not null,
  qty          numeric(8,2) not null default 1,
  rate         numeric(12,2) not null,
  amount       numeric(12,2) generated always as (qty * rate) stored,
  part_id      uuid                                    -- optional link to parts catalogue
);
create index if not exists esti_estimate on public.estimate_items(estimate_id);

-- ---------- Execution ----------
create table if not exists public.work_logs (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.service_requests(id) on delete cascade,
  mechanic_id  uuid references public.mechanics(id),
  note         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists wl_request on public.work_logs(request_id);

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.service_requests(id) on delete cascade,
  kind         attachment_kind not null default 'repair_photo',
  storage_path text not null,                          -- Supabase Storage object path
  caption      text,
  uploaded_by  actor_role not null,
  created_at   timestamptz not null default now()
);
create index if not exists att_request on public.attachments(request_id);

create table if not exists public.work_reports (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.service_requests(id) on delete cascade,
  summary      text not null,
  parts_replaced text,
  odo_km       int,
  next_service_hint text,
  created_at   timestamptz not null default now()
);

-- ---------- Money: FleetWorks invoices the owner, pays the workshop ----------
create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null unique references public.service_requests(id),
  number       text not null unique,
  status       invoice_status not null default 'issued',
  subtotal     numeric(12,2) not null,
  platform_fee numeric(12,2) not null default 0,       -- owner-side convenience fee if any
  gst_rate     numeric(4,2) not null default 18.00,
  gst_amount   numeric(12,2) not null,
  total        numeric(12,2) not null,
  issued_at    timestamptz not null default now(),
  due_at       date
);

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id),
  amount       numeric(12,2) not null,
  method       text check (method in ('upi','netbanking','card','credit_line','cash')),
  reference    text,
  paid_at      timestamptz not null default now()
);
create index if not exists pay_invoice on public.payments(invoice_id);

-- Fortnightly workshop payouts (1–15, 16–eom), net of platform commission
create table if not exists public.payout_cycles (
  id           uuid primary key default gen_random_uuid(),
  workshop_id  uuid not null references public.workshops(id),
  period_start date not null,
  period_end   date not null,
  gross        numeric(12,2) not null default 0,
  commission_rate numeric(4,2) not null default 10.00,
  commission   numeric(12,2) not null default 0,
  net          numeric(12,2) not null default 0,
  status       payout_status not null default 'accruing',
  paid_on      date,
  utr_reference text,
  unique (workshop_id, period_start)
);
create table if not exists public.payout_lines (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references public.payout_cycles(id) on delete cascade,
  request_id   uuid not null references public.service_requests(id),
  amount       numeric(12,2) not null
);
create index if not exists pl_cycle on public.payout_lines(cycle_id);

-- ---------- Feedback & complaints ----------
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null unique references public.service_requests(id),
  rating       int not null check (rating between 1 and 5),
  comments     text,
  created_at   timestamptz not null default now()
);

create table if not exists public.workshop_complaints (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid references public.service_requests(id),
  org_id       uuid references public.organizations(id),
  workshop_id  uuid references public.workshops(id),
  text         text not null,
  status       text not null default 'Open' check (status in ('Open','In Review','Resolved')),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------- Audit trail: every stage change, automatically ----------
create table if not exists public.status_events (
  id           bigint generated always as identity primary key,
  request_id   uuid not null references public.service_requests(id) on delete cascade,
  from_stage   request_stage,
  to_stage     request_stage not null,
  actor        actor_role not null default 'system',
  actor_user   uuid,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists se_request on public.status_events(request_id, created_at);

create or replace function public.trg_sr_stage_audit() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into public.status_events (request_id, from_stage, to_stage, actor, note)
    values (new.id, null, new.stage, 'owner', 'Service request raised');
  elsif new.stage is distinct from old.stage then
    insert into public.status_events (request_id, from_stage, to_stage, actor, note)
    values (new.id, old.stage, new.stage, 'system', null);
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists sr_stage_audit on public.service_requests;
create trigger sr_stage_audit before insert or update on public.service_requests
  for each row execute function public.trg_sr_stage_audit();

-- Auto-invoice when a request reaches 'completed'
create or replace function public.trg_sr_autoinvoice() returns trigger
language plpgsql security definer as $$
declare est_total numeric(12,2);
begin
  if new.stage = 'completed' and old.stage is distinct from 'completed'
     and not exists (select 1 from public.invoices where request_id = new.id) then
    select coalesce(sum(i.amount), 0) into est_total
      from public.estimate_items i
      join public.estimates e on e.id = i.estimate_id
     where e.request_id = new.id and e.status = 'approved';
    insert into public.invoices (request_id, number, subtotal, gst_amount, total, due_at)
    values (new.id, 'FW-INV-' || to_char(now(), 'YYMMDD') || '-' || substr(new.id::text, 1, 6),
            est_total, round(est_total * 0.18, 2), round(est_total * 1.18, 2),
            (now() + interval '7 days')::date);
    new.stage := 'invoiced';
  end if;
  return new;
end $$;
drop trigger if exists sr_autoinvoice on public.service_requests;
create trigger sr_autoinvoice before update on public.service_requests
  for each row execute function public.trg_sr_autoinvoice();

-- ---------- Row-level security ----------
-- Owner side: members of the org. Partner side: the workshop's auth user.
create or replace function public.is_workshop_user(p_workshop uuid)
returns boolean language sql stable security definer as
$$ select exists (select 1 from public.workshops w where w.id = p_workshop and w.owner_user = auth.uid()) $$;

alter table public.service_requests enable row level security;
drop policy if exists sr_owner on public.service_requests;
create policy sr_owner on public.service_requests for all to authenticated
  using (public.is_org_member(org_id));
drop policy if exists sr_partner on public.service_requests;
create policy sr_partner on public.service_requests for select to authenticated
  using (public.is_workshop_user(workshop_id));
drop policy if exists sr_partner_upd on public.service_requests;
create policy sr_partner_upd on public.service_requests for update to authenticated
  using (public.is_workshop_user(workshop_id));

-- Child tables inherit visibility through the request
create or replace function public.can_see_request(p_request uuid)
returns boolean language sql stable security definer as
$$ select exists (
     select 1 from public.service_requests r
      where r.id = p_request
        and (public.is_org_member(r.org_id) or public.is_workshop_user(r.workshop_id))) $$;

do $$ declare t text;
begin
  foreach t in array array['request_assignments','assessments','estimates',
    'work_logs','attachments','work_reports','invoices','feedback','status_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_vis on public.%I', t, t);
    execute format('create policy %I_vis on public.%I for all to authenticated
      using (public.can_see_request(request_id))', t, t);
  end loop;
end $$;

-- estimate_items has no request_id — visibility flows through its estimate
alter table public.estimate_items enable row level security;
drop policy if exists estimate_items_vis on public.estimate_items;
create policy estimate_items_vis on public.estimate_items for all to authenticated
  using (exists (select 1 from public.estimates e
                  where e.id = estimate_id and public.can_see_request(e.request_id)));

-- payments has no request_id — visibility flows through its invoice
alter table public.payments enable row level security;
drop policy if exists payments_vis on public.payments;
create policy payments_vis on public.payments for all to authenticated
  using (exists (select 1 from public.invoices i
                  where i.id = invoice_id and public.can_see_request(i.request_id)));

-- workshop_complaints: request_id is optional — fall back to org / workshop
alter table public.workshop_complaints enable row level security;
drop policy if exists workshop_complaints_vis on public.workshop_complaints;
create policy workshop_complaints_vis on public.workshop_complaints for all to authenticated
  using (
    (request_id is not null and public.can_see_request(request_id))
    or (org_id is not null and public.is_org_member(org_id))
    or (workshop_id is not null and public.is_workshop_user(workshop_id))
  );

alter table public.workshops enable row level security;
drop policy if exists workshops_read on public.workshops;
create policy workshops_read on public.workshops for select to authenticated using (true);
drop policy if exists workshops_own on public.workshops;
create policy workshops_own on public.workshops for update to authenticated using (owner_user = auth.uid());
alter table public.mechanics enable row level security;
drop policy if exists mechanics_read on public.mechanics;
create policy mechanics_read on public.mechanics for select to authenticated using (true);
alter table public.payout_cycles enable row level security;
drop policy if exists payout_partner on public.payout_cycles;
create policy payout_partner on public.payout_cycles for select to authenticated
  using (public.is_workshop_user(workshop_id));
alter table public.payout_lines enable row level security;
drop policy if exists payout_lines_partner on public.payout_lines;
create policy payout_lines_partner on public.payout_lines for select to authenticated
  using (exists (select 1 from public.payout_cycles c where c.id = cycle_id and public.is_workshop_user(c.workshop_id)));

-- Verification:
--   select count(*) from public.service_requests;
--   insert a request, update its stage to 'completed' → invoice appears, events logged.
