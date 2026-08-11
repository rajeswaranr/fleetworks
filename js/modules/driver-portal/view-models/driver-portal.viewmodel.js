/* ============ FleetWorks — driver-portal/view-models ============ */
(function () {
  "use strict";
  function header(input) {
    const c = FWDriverPortalDomain.normalizeContext(input);
    return { name: c.driverName, vehicleText: c.vehicleName ? "Vehicle: " + c.vehicleName : "No vehicle assigned", valid: FWDriverPortalDomain.isValidContext(c) };
  }
  window.FWDriverPortalViewModel = window.FWDriverPortalViewModel || { header };
  if (window.FWHex) FWHex.registerViewModel("driverPortal.header", header);
})();
