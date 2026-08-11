/* ============ FleetWorks — modules/driver-portal ============ */
(function () {
  "use strict";
  const DriverPortal = {
    checkItems() { return FWDriverPortalDomain.CHECK_ITEMS; },
    header(input) { return FWDriverPortalViewModel.header(input || {}); },
    submitFuel(input) { return FWDriverPortalUseCases.submitFuel(input || {}); },
    submitIssue(input) { return FWDriverPortalUseCases.submitIssue(input || {}); },
    submitInspection(input) { return FWDriverPortalUseCases.submitInspection(input || {}); },
    submitEntry(input) { return FWDriverPortalUseCases.submitEntry(input || {}); },
  };
  window.FWDriverPortal = window.FWDriverPortal || DriverPortal;
  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("driverPortal.repository")) FWHex.definePort("driverPortal.repository", FWDriverPortalPort.methods);
    if (!FWHex.adapter("driverPortal.repository")) FWHex.registerAdapter("driverPortal.repository", FWDriverPortalRepository, { priority: 10 });
    Object.entries(FWDriverPortalUseCases).forEach(([key, fn]) => FWHex.registerUseCase("driverPortal." + key, fn));
    FWHex.registerViewModel("driverPortal.header", FWDriverPortalViewModel.header);
    return true;
  }
  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("driver_portal")) return true;
    FWPlatform.registerModule({
      id: "driver_portal", name: "Driver Portal", version: "0.1.0", layer: "feature", order: 45,
      description: "No-login driver link submissions for fuel, issues, and daily checks.",
      dependencies: ["fleet_core"], permissions: ["driver_entries.submit"], tables: ["driver_entries"],
      capabilities: ["driver_portal.entries"],
      init(ctx) { ctx.platform.registerCapability("driver_portal.entries", DriverPortal); },
    });
    return true;
  }
  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
