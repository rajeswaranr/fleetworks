/* ============ FleetWorks — modules/garage-ops ============ */
(function () {
  "use strict";
  const GarageOps = {
    currentFortnight: FWGarageOpsDomain.currentFortnight,
    approveEstimate(input) { return FWGarageOpsUseCases.approveEstimate(input || {}); },
    rejectEstimate(input) { return FWGarageOpsUseCases.rejectEstimate(input || {}); },
    startJob(input) { return FWGarageOpsUseCases.startJob(input || {}); },
    deliverJob(input) { return FWGarageOpsUseCases.deliverJob(input || {}); },
    completeJob(input) { return FWGarageOpsUseCases.completeJob(input || {}); },
    saveEstimate(input) { return FWGarageOpsUseCases.saveEstimate(input || {}); },
    saveInspection(input) { return FWGarageOpsUseCases.saveInspection(input || {}); },
    saveStockItem(input) { return FWGarageOpsUseCases.saveStockItem(input || {}); },
    saveProfile(input) { return FWGarageOpsUseCases.saveProfile(input || {}); },
    resolveComplaint(input) { return FWGarageOpsUseCases.resolveComplaint(input || {}); },
    dashboard(input) { return FWGarageOpsViewModel.dashboard(input || {}); },
  };
  window.FWGarageOps = window.FWGarageOps || GarageOps;
  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("garageOps.repository")) FWHex.definePort("garageOps.repository", FWGarageOpsPort.methods);
    if (!FWHex.adapter("garageOps.repository")) FWHex.registerAdapter("garageOps.repository", FWGarageOpsRepository, { priority: 10 });
    Object.entries(FWGarageOpsUseCases).forEach(([key, fn]) => FWHex.registerUseCase("garageOps." + key, fn));
    FWHex.registerViewModel("garageOps.dashboard", FWGarageOpsViewModel.dashboard);
    return true;
  }
  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("garage_ops")) return true;
    FWPlatform.registerModule({
      id: "garage_ops", name: "GarageOps", version: "0.1.0", layer: "feature", order: 50,
      description: "Partner workshop jobs, estimates, inspections, stock, payouts, ratings, and complaints.",
      dependencies: ["maintenance", "payments"], permissions: ["garage.view", "garage.manage"],
      tables: ["service_requests", "assessments", "estimates", "estimate_items", "work_reports", "feedback"],
      capabilities: ["garage_ops.workflow", "garage_ops.partner"],
      init(ctx) { ctx.platform.registerCapability("garage_ops.workflow", GarageOps); },
    });
    return true;
  }
  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
