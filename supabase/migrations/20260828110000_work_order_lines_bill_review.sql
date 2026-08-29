-- ============ FleetWorks — work order line items + AI bill review ============
-- work_orders carried only est_cost and final_cost, so a bill was a single
-- number. You cannot flag a duplicate diagnostic charge, an inflated labour
-- rate or a part replaced too soon without the lines that make up the total —
-- so the lines come first, and the review is built on them.
--
-- bill_reviews stores each assessment rather than recomputing on view. Three
-- reasons: an assessment shown to a vendor has to be reproducible months later,
-- re-running costs an LLM call every page load, and the findings need to carry
-- the evidence they were based on at the time — history moves, and a judgement
-- must be readable against the data that produced it.

-- ---------- line items ----------
create table if not exists work_order_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  line_no       int,
  -- The type is what makes duplicate-diagnostic detection possible at all:
  -- two 'diagnostic' lines on one order is a specific, checkable condition.
  line_type     text not null default 'part'
                check (line_type in ('labour','part','diagnostic','consumable','tax','other')),
  description   text not null,
  part_number   text,
  qty           numeric default 1,
  unit_rate     numeric,
  amount        numeric not null,
  hours         numeric,              -- labour only
  created_at    timestamptz not null default now()
);
create index if not exists idx_wol_order on work_order_lines(work_order_id, line_no);
create index if not exists idx_wol_org on work_order_lines(org_id);
-- Price history is looked up by what the line says it is, so the text is
-- indexed lower-cased for the "have we paid this before" comparison.
create index if not exists idx_wol_desc on work_order_lines(org_id, lower(description));

-- ---------- reviews ----------
create table if not exists bill_reviews (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  assessment    text not null check (assessment in ('approve','review','reject')),
  confidence    text not null check (confidence in ('low','medium','high')),
  -- How many historical records the judgement actually drew on. Shown to the
  -- user, because "Review required" backed by 40 past jobs and by 1 are very
  -- different claims and the reader deserves to tell them apart.
  source_count  int not null default 0,
  summary       text,
  findings      jsonb,                -- [{code, severity, title, detail, evidence{}}]
  computed      jsonb,                -- the benchmarks the model was given, kept for audit
  model         text,
  reviewed_at   timestamptz not null default now(),
  -- What the human decided afterwards. The AI advises; the owner disposes.
  outcome       text check (outcome in ('accepted','disputed','overridden')),
  outcome_note  text,
  outcome_by    uuid references auth.users(id),
  outcome_at    timestamptz
);
create index if not exists idx_bill_reviews_order on bill_reviews(work_order_id, reviewed_at desc);

alter table work_order_lines enable row level security;
alter table bill_reviews     enable row level security;

drop policy if exists wol_member_all on work_order_lines;
create policy wol_member_all on work_order_lines for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Reviews are written by the bill-review edge function under the service role.
-- Members read them and record an outcome, but cannot author an assessment —
-- otherwise "the AI approved it" stops meaning anything.
drop policy if exists bill_reviews_member_read on bill_reviews;
create policy bill_reviews_member_read on bill_reviews for select to authenticated
  using (is_org_member(org_id));
drop policy if exists bill_reviews_member_outcome on bill_reviews;
create policy bill_reviews_member_outcome on bill_reviews for update to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

grant select, insert, update, delete on work_order_lines to authenticated;
grant select, update on bill_reviews to authenticated;

-- Verify after running:
--   select count(*) from work_order_lines;
--   select assessment, confidence, source_count from bill_reviews order by reviewed_at desc limit 5;
