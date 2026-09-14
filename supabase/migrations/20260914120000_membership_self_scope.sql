-- ============ FleetWorks — membership identity isolation ============
--
-- The original membership_read policy allowed any organization member to read
-- every membership in that organization. Apart from exposing the roster, that
-- made an unqualified client lookup for role=owner return the owner's row when
-- the caller was actually a driver or supervisor.
--
-- A team member needs only their own membership to resolve org + role. Owners
-- and managers retain roster access through the existing is_org_admin-backed
-- membership_admin_manage policy and the team_roster() RPC.

drop policy if exists membership_read on memberships;
create policy membership_read on memberships for select to authenticated
  using (user_id = auth.uid());
