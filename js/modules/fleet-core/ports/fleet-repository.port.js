/* ============ FleetWorks — fleet-core/ports ============
   Repository port for fleet core data. */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.definePort("fleetCore.repository", [
    "listVehicles",
    "listDrivers",
    "listAssignments",
    "getVehicleById",
    "getDriverById",
    "summary",
  ]);
})();
