/* ============ FleetWorks — fleet-core/use-cases ============
   Application use cases for fleet core. */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.registerUseCase("fleetCore.listSummary", () => {
    const repo = FWHex.adapter("fleetCore.repository");
    if (!repo) throw new Error("fleetCore.repository adapter is not registered.");
    return repo.summary();
  });

  FWHex.registerUseCase("fleetCore.listAssignments", () => {
    const repo = FWHex.adapter("fleetCore.repository");
    if (!repo) throw new Error("fleetCore.repository adapter is not registered.");
    return repo.listAssignments();
  });
})();
