-- ============ FleetWorks — admin-issued password resets (audit trail) ============
-- Email-based self-service reset needs working SMTP, which isn't in place. This
-- gives the support desk a route that works today: an owner or partner who is
-- locked out rings their BDM, and an admin issues a temporary password over the
-- phone. For an Indian transport owner that's arguably the more natural channel
-- anyway — they will call before they check an inbox.
--
-- Handing one person the power to set anyone's password is exactly the sort of
-- thing that needs a record, so every use is logged here: who did it, for whom,
-- and when. The password itself is NEVER stored — only the fact of the reset.
--
-- Rows are insert-only for admins and cannot be updated or deleted through the
-- API, so the trail can't be quietly edited after the fact.

create table if not exists admin_password_resets (
  id             uuid primary key default gen_random_uuid(),
  target_user_id uuid not null,
  target_email   text not null,
  performed_by   uuid not null,          -- the admin's auth.users id
  performed_email text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_admin_password_resets_target on admin_password_resets(target_email);
create index if not exists idx_admin_password_resets_when on admin_password_resets(created_at desc);

alter table admin_password_resets enable row level security;

-- Read-only for admins. Writes come from the edge function via the service
-- role, which bypasses RLS — so there is deliberately no insert policy here.
drop policy if exists "admin_read_password_resets" on admin_password_resets;
create policy "admin_read_password_resets" on admin_password_resets
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant select on admin_password_resets to authenticated;

-- Verify after running:
--   select * from admin_password_resets order by created_at desc limit 5;
