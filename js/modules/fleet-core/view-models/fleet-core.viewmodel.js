/* ============ FleetWorks — fleet-core/view-models ============
   MVVM-facing projection for fleet core UI. */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.registerViewModel("fleetCore.dashboard", () => {
    const summary = FWHex.run("fleetCore.listSummary");
    return {
      cards: [
        { key: "vehicles", label: "Vehicles", value: summary.vehicleCount },
        { key: "drivers", label: "Drivers", value: summary.driverCount },
        { key: "assigned", label: "Assigned", value: summary.assignedVehicleCount },
        { key: "active", label: "Active", value: summary.activeVehicleCount },
      ],
      compliance: summary.compliance,
    };
  });
})();
