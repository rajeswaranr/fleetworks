/* ============ FleetWorks — driver-map/view-models ============ */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.registerViewModel("driverMap.summary", () => {
    const points = FWHex.run("driverMap.listPoints");
    return {
      summary: FWDriverMapDomain.mapSummary(points),
      providers: FWHex.run("driverMap.providerStatus"),
      points,
    };
  });
})();
