/* ============ FleetWorks — garage-ops/ports ============ */
(function () {
  "use strict";
  const methods = ["state", "save"];
  window.FWGarageOpsPort = window.FWGarageOpsPort || { name: "garageOps.repository", methods };
  if (window.FWHex) FWHex.definePort("garageOps.repository", methods);
})();
