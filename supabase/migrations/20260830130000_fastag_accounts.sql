-- ============ FleetWorks — FASTag accounts and balance tracking ============
-- The Toll & FASTag tab has been a placeholder waiting on telematics. The
-- painful part needs no integration at all: a truck reaching a plaza with
-- insufficient FASTag balance pays roughly double the toll and loses the time
-- arguing about it, and the owner finds out from the driver, at the plaza.
--
-- What we can do without any bank or NETC feed is track the balance the owner
-- already knows and warn before it runs out. Recharges are already logged as
-- expenses under "FASTag Recharge", which gives us a real spend rate per
-- vehicle — so "about 3 days left at your usual toll spend" is computed from
-- the fleet's own history rather than guessed.
--
-- One row per vehicle rather than columns on `vehicles`: a tag can be replaced,
-- issued by a different bank, or deactivated, and none of that should mean
-- editing the vehicle record.

create table if not exists fastag_accounts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  vehicle_id     uuid not null references vehicles(id) on delete cascade,
  tag_id         text,                    -- the FASTag / NETC tag number
  bank           text,                    -- issuing bank: HDFC, ICICI, IDFC, Paytm, SBI...
  vehicle_class  text,                    -- NETC class, e.g. VC12 (2-axle truck), VC15 (multi-axle)
  -- Balance as the owner last observed it, with the moment they observed it.
  -- Both matter: a balance without its timestamp cannot be projected forward.
  balance        numeric,
  balance_at     timestamptz,
  low_threshold  numeric not null default 1000,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One ACTIVE tag per vehicle. A replaced tag is deactivated rather than
-- deleted, so its history survives, and the partial index lets the old row stay.
create unique index if not exists idx_fastag_one_active
  on fastag_accounts(vehicle_id) where is_active;
create index if not exists idx_fastag_org on fastag_accounts(org_id, is_active);

-- Every observed balance, so depletion can be measured rather than assumed.
-- An owner who tops up 5,000 and sees 1,200 eleven days later has told us their
-- real burn rate for that truck, which is better than any average.
create table if not exists fastag_balance_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  account_id  uuid not null references fastag_accounts(id) on delete cascade,
  balance     numeric not null,
  recorded_at timestamptz not null default now(),
  source      text not null default 'manual' check (source in ('manual','recharge','import')),
  note        text
);
create index if not exists idx_fastag_log_acct on fastag_balance_log(account_id, recorded_at desc);

alter table fastag_accounts    enable row level security;
alter table fastag_balance_log enable row level security;

drop policy if exists fastag_member_all on fastag_accounts;
create policy fastag_member_all on fastag_accounts for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

drop policy if exists fastag_log_member_all on fastag_balance_log;
create policy fastag_log_member_all on fastag_balance_log for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

grant select, insert, update, delete on fastag_accounts to authenticated;
grant select, insert, update, delete on fastag_balance_log to authenticated;

-- Keep updated_at honest without trusting the client to send it.
create or replace function set_fastag_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_fastag_updated_at on fastag_accounts;
create trigger trg_fastag_updated_at
  before update on fastag_accounts
  for each row execute function set_fastag_updated_at();

-- Verify after running:
--   select v.name, f.tag_id, f.balance, f.balance_at
--     from fastag_accounts f join vehicles v on v.id = f.vehicle_id;
