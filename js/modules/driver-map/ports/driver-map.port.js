/* ============ FleetWorks — driver-map/ports ============ */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.definePort("driverMap.repository", [
    "listMapPoints",
    "providerStatus",
  ]);
})();
