/* ============ FleetWorks — team-access/use-cases ============ */

(function () {
  "use strict";

  function repository() {
    if (window.FWHex && FWHex.adapter("teamAccess.repository")) return FWHex.adapter("teamAccess.repository");
    return window.FWTeamAccessRepository || null;
  }

  function requireRepository() {
    const repo = repository();
    if (!repo) throw new Error("Team access repository is not available.");
    return repo;
  }

  function register(name, fn) {
    if (window.FWHex) FWHex.registerUseCase(name, fn);
    return fn;
  }

  const useCases = {
    loadPortalAccess: register("teamAccess.loadPortalAccess", async () => {
      const repo = requireRepository();
      const uid = repo.currentUserId();
      const membership = FWTeamAccessDomain.normalizeMembership(await repo.getPortalMembership(uid));
      const profile = repo.currentProfile();
      const email = repo.currentUserEmail();
      if (!membership.orgId || !FWTeamAccessDomain.canUseTeamPortal(membership)) {
        return { uid, membership, profile, email, assignments: [], assignmentMap: {}, vehicles: [] };
      }
      const assignments = (await repo.listAssignments(uid, membership.orgId)).map(FWTeamAccessDomain.normalizeAssignment);
      const vehicles = await repo.listVehicles();
      return { uid, membership, profile, email, assignments, assignmentMap: FWTeamAccessDomain.assignmentMap(assignments), vehicles };
    }),

    vehicleHistory: register("teamAccess.vehicleHistory", input => {
      if (!input || !input.vehicleId) throw new Error("Vehicle id is required.");
      return requireRepository().vehicleHistory(input.vehicleId);
    }),

    createFuelLog: register("teamAccess.createFuelLog", input => {
      const fuelLog = FWTeamAccessDomain.normalizeFuelLog(input);
      if (!fuelLog.org_id || !fuelLog.vehicle_id || !fuelLog.amount) throw new Error("Organization, vehicle and amount are required.");
      return requireRepository().createFuelLog(fuelLog);
    }),

    requestExpenseChange: register("teamAccess.requestExpenseChange", input => {
      const repo = requireRepository();
      const request = FWTeamAccessDomain.normalizeExpenseRequest({
        ...input,
        requestedBy: input && input.requestedBy || repo.currentUserId(),
      });
      if (!request.org_id || !request.vehicle_id || !request.patch.category || !request.patch.amount) throw new Error("Vehicle, category and amount are required.");
      return repo.requestExpenseChange(request);
    }),

    createIssue: register("teamAccess.createIssue", input => {
      const issue = FWTeamAccessDomain.normalizeIssue(input);
      if (!issue.org_id || !issue.vehicle_id || !issue.title) throw new Error("Vehicle and issue title are required.");
      return requireRepository().createIssue(issue);
    }),

    ownerOrg: register("teamAccess.ownerOrg", () => requireRepository().ownerOrg()),

    listRoster: register("teamAccess.listRoster", input => {
      if (!input || !input.orgId) throw new Error("Organization id is required.");
      return requireRepository().listRoster(input.orgId);
    }),

    inviteMember: register("teamAccess.inviteMember", input => {
      const data = input || {};
      if (!data.email || !data.password || !data.name || !data.role) throw new Error("Name, email, password and role are required.");
      if (!Array.isArray(data.vehicles) || !data.vehicles.length) throw new Error("Assign at least one vehicle.");
      return requireRepository().inviteMember(data);
    }),
  };

  window.FWTeamAccessUseCases = window.FWTeamAccessUseCases || useCases;
})();
