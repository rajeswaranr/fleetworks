/* ============ FleetWorks — fleet-iq/ports ============ */

(function () {
  "use strict";

  const methods = ["state", "filters", "insights"];

  window.FWFleetIQPort = window.FWFleetIQPort || { name: "fleetIq.repository", methods };
  if (window.FWHex) FWHex.definePort("fleetIq.repository", methods);
})();
