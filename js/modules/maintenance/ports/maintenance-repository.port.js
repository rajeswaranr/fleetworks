/* ============ FleetWorks — maintenance/ports ============ */

(function () {
  "use strict";

  const methods = [
    "state",
    "createIssue",
    "updateIssue",
    "createWorkOrder",
    "updateWorkOrder",
    "createReminder",
    "updateReminder",
    "createInspection",
    "createPart",
    "updatePart",
    "createDocument",
    "createTyreReading",
  ];

  window.FWMaintenancePort = window.FWMaintenancePort || { name: "maintenance.repository", methods };
  if (window.FWHex) FWHex.definePort("maintenance.repository", methods);
})();
