/* ============ FleetWorks — driver-portal/use-cases ============ */
(function () {
  "use strict";

  function repository() {
    if (window.FWHex && FWHex.adapter("driverPortal.repository")) return FWHex.adapter("driverPortal.repository");
    return window.FWDriverPortalRepository || null;
  }
  function requireRepository() {
    const repo = repository();
    if (!repo) throw new Error("Driver portal repository is not available.");
    return repo;
  }
  function register(name, fn) { if (window.FWHex) FWHex.registerUseCase(name, fn); return fn; }
  function submit(ctx, kind, payload) {
    if (!FWDriverPortalDomain.isValidContext(ctx)) throw new Error("Invalid driver link.");
    return requireRepository().submitEntry(FWDriverPortalDomain.entryRecord(ctx, kind, payload));
  }

  const useCases = {
    submitFuel: register("driverPortal.submitFuel", input => submit(input && input.context, "fuel", FWDriverPortalDomain.normalizeFuel(input && input.payload))),
    submitIssue: register("driverPortal.submitIssue", input => submit(input && input.context, "issue", FWDriverPortalDomain.normalizeIssue(input && input.payload))),
    submitInspection: register("driverPortal.submitInspection", input => submit(input && input.context, "inspection", FWDriverPortalDomain.normalizeInspection(input && input.payload))),
    submitEntry: register("driverPortal.submitEntry", input => submit(input && input.context, input && input.kind, input && input.payload)),
  };
  window.FWDriverPortalUseCases = window.FWDriverPortalUseCases || useCases;
})();
