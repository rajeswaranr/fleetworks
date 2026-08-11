/* ============ FleetWorks — team-access/ports ============ */

(function () {
  "use strict";

  const methods = [
    "currentUserId",
    "currentUserEmail",
    "currentProfile",
    "getPortalMembership",
    "ownerOrg",
    "listAssignments",
    "listVehicles",
    "vehicleHistory",
    "createFuelLog",
    "requestExpenseChange",
    "createIssue",
    "listRoster",
    "inviteMember",
  ];

  window.FWTeamAccessPort = window.FWTeamAccessPort || { name: "teamAccess.repository", methods };
  if (window.FWHex) FWHex.definePort("teamAccess.repository", methods);
})();
