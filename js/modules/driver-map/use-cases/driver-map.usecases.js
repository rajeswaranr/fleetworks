/* ============ FleetWorks — driver-map/use-cases ============ */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.registerUseCase("driverMap.listPoints", () => {
    const repo = FWHex.adapter("driverMap.repository");
    if (!repo) throw new Error("driverMap.repository adapter is not registered.");
    return repo.listMapPoints();
  });

  FWHex.registerUseCase("driverMap.providerStatus", () => {
    const repo = FWHex.adapter("driverMap.repository");
    if (!repo) throw new Error("driverMap.repository adapter is not registered.");
    return repo.providerStatus();
  });
})();
