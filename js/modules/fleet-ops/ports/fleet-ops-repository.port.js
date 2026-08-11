/* ============ FleetWorks — fleet-ops/ports ============ */

(function () {
  "use strict";

  const methods = [
    "state",
    "options",
  ];

  window.FWFleetOpsPort = window.FWFleetOpsPort || { name: "fleetOps.repository", methods };
  if (window.FWHex) FWHex.definePort("fleetOps.repository", methods);
})();
