/* ============ FleetWorks — driver-map/adapters ============
   Adapter around the current depot/city map and future telemetry facade. */

(function () {
  "use strict";

  const repo = {
    name: "driverMap.legacyRepository",
    listMapPoints() {
      if (window.FWDriverMap && FWDriverMap.mapPoints) {
        return FWDriverMap.mapPoints().map(point => FWDriverMapDomain.mapPoint({
          ...point,
          source: point.lat && point.lng ? "telemetry" : "depot",
        }));
      }
      return [];
    },
    providerStatus() {
      if (window.FWDriverMap && FWDriverMap.getProviderStatus) return FWDriverMap.getProviderStatus();
      return [];
    },
  };

  window.FWDriverMapRepository = window.FWDriverMapRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("driverMap.repository", repo, { priority: 10 });
})();
