/* ============ FleetWorks — driver-portal/ports ============ */
(function () {
  "use strict";
  const methods = ["submitEntry"];
  window.FWDriverPortalPort = window.FWDriverPortalPort || { name: "driverPortal.repository", methods };
  if (window.FWHex) FWHex.definePort("driverPortal.repository", methods);
})();
