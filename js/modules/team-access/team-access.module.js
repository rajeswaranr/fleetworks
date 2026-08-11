/* ============ FleetWorks — modules/team-access ============
   Additive Team Access module for team portal login, assignments, roster,
   and owner-managed invitations. */

(function () {
  "use strict";

  const TeamAccess = {
    loadPortalAccess() { return FWTeamAccessUseCases.loadPortalAccess(); },
    vehicleHistory(input) { return FWTeamAccessUseCases.vehicleHistory(input || {}); },
    createFuelLog(input) { return FWTeamAccessUseCases.createFuelLog(input || {}); },
    requestExpenseChange(input) { return FWTeamAccessUseCases.requestExpenseChange(input || {}); },
    createIssue(input) { return FWTeamAccessUseCases.createIssue(input || {}); },
    ownerOrg() { return FWTeamAccessUseCases.ownerOrg(); },
    listRoster(input) { return FWTeamAccessUseCases.listRoster(input || {}); },
    inviteMember(input) { return FWTeamAccessUseCases.inviteMember(input || {}); },
    portalView(input) { return FWTeamAccessViewModel.portal(input || {}); },
    ownerPortalUrl(input) { return FWTeamAccessViewModel.ownerPortalUrl(input); },
  };

  window.FWTeamAccess = window.FWTeamAccess || TeamAccess;

  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("teamAccess.repository")) FWHex.definePort("teamAccess.repository", window.FWTeamAccessPort.methods);
    if (!FWHex.adapter("teamAccess.repository")) FWHex.registerAdapter("teamAccess.repository", window.FWTeamAccessRepository, { priority: 10 });
    Object.entries(FWTeamAccessUseCases).forEach(([key, fn]) => FWHex.registerUseCase("teamAccess." + key, fn));
    FWHex.registerViewModel("teamAccess.portal", FWTeamAccessViewModel.portal);
    FWHex.registerViewModel("teamAccess.ownerPortalUrl", FWTeamAccessViewModel.ownerPortalUrl);
    return true;
  }

  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("team_access")) return true;
    FWPlatform.registerModule({
      id: "team_access",
      name: "Team Access",
      version: "0.1.0",
      layer: "feature",
      order: 35,
      description: "Driver and supervisor portal access, assignments, roster, and invitations.",
      dependencies: ["fleet_core"],
      permissions: ["team.view", "team.manage", "team.portal"],
      tables: ["memberships", "vehicle_assignments", "expense_change_requests"],
      edgeFunctions: ["team-invite"],
      navigation: [
        { workspace: "account", tab: "team", label: "Team & Access", icon: "users" },
      ],
      capabilities: ["team_access.portal", "team_access.management"],
      init(ctx) {
        ctx.platform.registerCapability("team_access.portal", {
          loadPortalAccess: TeamAccess.loadPortalAccess,
          vehicleHistory: TeamAccess.vehicleHistory,
          createFuelLog: TeamAccess.createFuelLog,
          requestExpenseChange: TeamAccess.requestExpenseChange,
          createIssue: TeamAccess.createIssue,
        });
        ctx.platform.registerCapability("team_access.management", {
          ownerOrg: TeamAccess.ownerOrg,
          listRoster: TeamAccess.listRoster,
          inviteMember: TeamAccess.inviteMember,
        });
      },
    });
    return true;
  }

  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
