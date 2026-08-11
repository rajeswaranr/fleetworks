/* ============ FleetWorks — team-access/adapters/legacy ============
   Compatibility adapter over the current fwCloud Supabase helpers. */

(function () {
  "use strict";

  function cloud() {
    return window.fwCloud || null;
  }

  function requireCloud() {
    const api = cloud();
    if (!api) throw new Error("FleetWorks cloud is not available.");
    return api;
  }

  function userId() {
    const api = cloud();
    return api && api.uid ? api.uid() : "";
  }

  const repo = {
    name: "teamAccess.legacyRepository",

    currentUserId() {
      return userId();
    },

    currentUserEmail() {
      const api = cloud();
      return api && api.user ? api.user() : "";
    },

    currentProfile() {
      const api = cloud();
      return api && api.profile ? api.profile() : null;
    },

    async getPortalMembership(uid) {
      const id = uid || userId();
      const rows = await requireCloud().authGet("memberships", `select=id,role,org_id,user_id&user_id=eq.${id}&limit=1`);
      return rows && rows[0] ? rows[0] : null;
    },

    async ownerOrg() {
      const rows = await requireCloud().authGet("memberships", "select=org_id&role=in.(owner,manager)&limit=1").catch(() => null);
      return rows && rows[0] ? rows[0].org_id : null;
    },

    async listAssignments(uid, orgId) {
      const id = uid || userId();
      return await requireCloud().authGet("vehicle_assignments", `select=vehicle_ext_id,access&user_id=eq.${id}&org_id=eq.${orgId}`) || [];
    },

    async listVehicles() {
      return await requireCloud().authGet("vehicles", "select=*&order=name.asc") || [];
    },

    async vehicleHistory(vehicleId) {
      const api = requireCloud();
      const [fuel, expenses, issues, inspections, pendingExpenses] = await Promise.all([
        api.authGet("fuel_logs", `select=*&vehicle_id=eq.${vehicleId}&order=log_date.desc&limit=8`),
        api.authGet("expenses", `select=*&vehicle_id=eq.${vehicleId}&order=expense_date.desc&limit=8`),
        api.authGet("issues", `select=*&vehicle_id=eq.${vehicleId}&order=reported_at.desc.nullslast&limit=8`),
        api.authGet("inspections", `select=*&vehicle_id=eq.${vehicleId}&order=inspection_date.desc&limit=5`),
        api.authGet("expense_change_requests", `select=*&vehicle_id=eq.${vehicleId}&status=eq.pending&order=created_at.desc&limit=8`),
      ]);
      return { fuel, expenses, issues, inspections, pendingExpenses };
    },

    createFuelLog(record) {
      return requireCloud().authInsert("fuel_logs", record);
    },

    requestExpenseChange(record) {
      return requireCloud().authInsert("expense_change_requests", record);
    },

    createIssue(record) {
      return requireCloud().authInsert("issues", record);
    },

    listRoster(orgId) {
      return requireCloud().authRpc("team_roster", { p_org: orgId });
    },

    inviteMember(input) {
      return requireCloud().callFunction("team-invite", input);
    },
  };

  window.FWTeamAccessRepository = window.FWTeamAccessRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("teamAccess.repository", repo, { priority: 10 });
})();
