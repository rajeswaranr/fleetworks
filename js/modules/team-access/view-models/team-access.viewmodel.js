/* ============ FleetWorks — team-access/view-models ============ */

(function () {
  "use strict";

  function portal(input) {
    const data = input || {};
    const membership = FWTeamAccessDomain.normalizeMembership(data.membership);
    const role = membership.role;
    const assignmentMap = data.assignmentMap || FWTeamAccessDomain.assignmentMap(data.assignments || []);
    const hasUpdateAccess = Object.values(assignmentMap).includes("update");
    return {
      role,
      roleLabel: FWTeamAccessDomain.roleLabel(role),
      name: FWTeamAccessDomain.profileName(data.profile, data.email),
      accessNote: FWTeamAccessDomain.accessNote(role, hasUpdateAccess),
      canUsePortal: FWTeamAccessDomain.canUseTeamPortal(membership),
      assignmentMap,
      vehicles: data.vehicles || [],
    };
  }

  function ownerPortalUrl(locationRef) {
    const loc = locationRef || window.location;
    return loc.origin + loc.pathname.replace(/[^/]*$/, "team.html");
  }

  window.FWTeamAccessViewModel = window.FWTeamAccessViewModel || { portal, ownerPortalUrl };
  if (window.FWHex) {
    FWHex.registerViewModel("teamAccess.portal", portal);
    FWHex.registerViewModel("teamAccess.ownerPortalUrl", ownerPortalUrl);
  }
})();
