-- ============ FleetWorks — WhatsApp messaging ============
-- Schema and template definitions for driver allotment, wages paid, khata
-- statements and attendance over WhatsApp. Built now so the code is ready when
-- Meta business verification clears — that is the long pole, it takes days, and
-- it needs the same documents as the company registrations.
--
-- CONSENT IS THE TABLE, not a column added later. WhatsApp's Business Policy
-- requires opt-in before a business-initiated message, and the DPDP Act 2023
-- requires the consent be recorded with its purpose and be withdrawable. A
-- contact with opted_in_at null is unmessageable, and the outbound path must
-- check it rather than assume it.
--
-- Cost shape, which drives the design: utility templates are ~Rs 0.115 each in
-- India, marketing ~Rs 0.863 — seven times more — and anything sent inside the
-- 24-hour window opened by an inbound message is free. So every template here
-- is a utility template, and a driver's reply makes the whole conversation that
-- follows cost nothing. That is why attendance-by-reply is worth building.

create table if not exists whatsapp_contacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  phone         text not null,                 -- E.164, e.g. +919444960009
  name          text,
  role          text not null default 'driver'
                check (role in ('owner','driver','supervisor','partner','other')),
  driver_id     uuid references drivers(id) on delete set null,
  -- Consent, recorded rather than assumed.
  opted_in_at   timestamptz,
  opted_in_via  text,                          -- 'signup_form', 'portal', 'verbal_logged', 'whatsapp_reply'
  opted_out_at  timestamptz,
  wa_id         text,                           -- Meta's own contact id, learned on first exchange
  -- Set by an inbound message. Anything sent before this expires is free, so
  -- the sender checks it before spending on a template.
  window_expires_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (org_id, phone)
);
create index if not exists idx_wa_contacts_org on whatsapp_contacts(org_id);
create index if not exists idx_wa_contacts_driver on whatsapp_contacts(driver_id);

create table if not exists whatsapp_messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  contact_id    uuid references whatsapp_contacts(id) on delete set null,
  direction     text not null check (direction in ('out','in')),
  template_name text,                           -- null for free-form replies inside the 24h window
  body          text,
  variables     jsonb,
  status        text not null default 'queued'
                check (status in ('queued','sent','delivered','read','failed','received')),
  wa_message_id text,
  error_code    text,
  error_detail  text,
  -- What this message was about, so a wages query can find its own thread
  -- without parsing message bodies.
  ref_type      text,                           -- 'allotment','wages','statement','attendance','alert'
  ref_id        uuid,
  cost_category text check (cost_category in ('utility','marketing','authentication','service','free')),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index if not exists idx_wa_msg_contact on whatsapp_messages(contact_id, created_at desc);
create index if not exists idx_wa_msg_org on whatsapp_messages(org_id, created_at desc);
create index if not exists idx_wa_msg_ref on whatsapp_messages(ref_type, ref_id);

-- Our own copy of what was submitted to Meta for approval. Meta owns the
-- approval state; this is what we render locally and what we resubmit from, so
-- the wording a driver received months ago is recoverable.
create table if not exists whatsapp_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,           -- must match the name registered with Meta
  category      text not null default 'utility'
                check (category in ('utility','marketing','authentication')),
  language      text not null default 'en',
  body          text not null,
  variables     text[],
  purpose       text,
  approved      boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table whatsapp_contacts  enable row level security;
alter table whatsapp_messages  enable row level security;
alter table whatsapp_templates enable row level security;

drop policy if exists wa_contacts_member on whatsapp_contacts;
create policy wa_contacts_member on whatsapp_contacts for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Messages are written by the send/webhook edge functions under the service
-- role. Members read their org's history; nobody fabricates a sent message from
-- the client, or "we told you on the 3rd" stops being evidence.
drop policy if exists wa_msg_member_read on whatsapp_messages;
create policy wa_msg_member_read on whatsapp_messages for select to authenticated
  using (is_org_member(org_id));

-- Templates are global to FleetWorks, not per-org: they are registered once
-- with Meta against our number. Readable by any signed-in user, writable only
-- by a FleetWorks admin.
drop policy if exists wa_tpl_read on whatsapp_templates;
create policy wa_tpl_read on whatsapp_templates for select to authenticated using (true);
drop policy if exists wa_tpl_admin on whatsapp_templates;
create policy wa_tpl_admin on whatsapp_templates for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

grant select, insert, update, delete on whatsapp_contacts to authenticated;
grant select on whatsapp_messages to authenticated;
grant select, insert, update, delete on whatsapp_templates to authenticated;

-- The four templates to submit to Meta. All utility category: they follow from
-- something the business did, which is what utility means and why they cost a
-- seventh of marketing. Written for a driver reading on a phone, in short lines,
-- because that is the actual reading condition.
insert into whatsapp_templates (name, category, language, body, variables, purpose) values
  ('driver_allotment', 'utility', 'en',
   E'Namaste {{1}},\n\nYou are allotted *{{2}}* from {{3}}.\nRoute: {{4}}\n\nReply OK to confirm.\n— {{5}}',
   array['driver_name','vehicle','from_date','route','fleet_name'],
   'Sent when a driver is assigned to a vehicle.'),

  ('wages_paid', 'utility', 'en',
   E'Namaste {{1}},\n\n*{{2}}* has been paid for {{3}}.\nMode: {{4}}\nReference: {{5}}\n\nQuestions? Reply to this message.\n— {{6}}',
   array['driver_name','amount','period','method','reference','fleet_name'],
   'Sent when a salary or wage payment is recorded.'),

  ('khata_statement', 'utility', 'en',
   E'Namaste {{1}},\n\nYour account to {{2}}:\nAdvances taken: {{3}}\nExpenses paid by you: {{4}}\nSettled: {{5}}\n*Balance: {{6}}*\n\nReply if anything looks wrong.\n— {{7}}',
   array['driver_name','as_of_date','advances','expenses','settled','balance','fleet_name'],
   'Periodic khata statement so the balance is never a surprise at settlement.'),

  ('attendance_check', 'utility', 'en',
   E'Namaste {{1}}, good morning.\n\nAre you on duty today ({{2}})?\n\nReply:\n1 — On duty\n2 — On trip\n3 — Rest day\n4 — Leave\n— {{3}}',
   array['driver_name','date','fleet_name'],
   'Daily attendance prompt. The reply opens a free 24h window, so everything after it costs nothing.')
on conflict (name) do nothing;

-- Verify after running:
--   select name, category, approved from whatsapp_templates order by name;
