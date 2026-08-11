/* ============ FleetWorks — fleet-fin/ports ============ */

(function () {
  "use strict";

  const methods = [
    "state",
    "createExpense",
    "updateExpense",
    "createFuelLog",
    "updateFuelLog",
    "createTrip",
    "updateTrip",
    "createLedgerEntry",
    "updateLedgerEntry",
  ];

  window.FWFleetFinPort = window.FWFleetFinPort || { name: "fleetFin.repository", methods };
  if (window.FWHex) FWHex.definePort("fleetFin.repository", methods);
})();
