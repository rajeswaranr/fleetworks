/* ============ FleetWorks — modules/maintenance ============
   Additive maintenance module. Existing fleet.js still owns DOM rendering;
   this module centralizes maintenance workflows behind use cases. */

(function () {
  "use strict";

  const Maintenance = {
    createIssue(input) { return FWMaintenanceUseCases.createIssue(input || {}); },
    resolveIssue(input) { return FWMaintenanceUseCases.resolveIssue(input || {}); },
    createWorkOrder(input) { return FWMaintenanceUseCases.createWorkOrder(input || {}); },
    createReminder(input) { return FWMaintenanceUseCases.createReminder(input || {}); },
    completeReminder(input) { return FWMaintenanceUseCases.completeReminder(input || {}); },
    recordInspection(input) { return FWMaintenanceUseCases.recordInspection(input || {}); },
    savePart(input) { return FWMaintenanceUseCases.savePart(input || {}); },
    createDocument(input) { return FWMaintenanceUseCases.createDocument(input || {}); },
    createTyreReading(input) { return FWMaintenanceUseCases.createTyreReading(input || {}); },
    summary(input) { return FWMaintenanceViewModel.summary(input || {}); },
  };

  window.FWMaintenance = window.FWMaintenance || Maintenance;

  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("maintenance.repository")) FWHex.definePort("maintenance.repository", window.FWMaintenancePort.methods);
    if (!FWHex.adapter("maintenance.repository")) FWHex.registerAdapter("maintenance.repository", window.FWMaintenanceRepository, { priority: 10 });
    Object.entries(FWMaintenanceUseCases).forEach(([key, fn]) => FWHex.registerUseCase("maintenance." + key, fn));
    FWHex.registerViewModel("maintenance.summary", FWMaintenanceViewModel.summary);
    return true;
  }

  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("maintenance")) return true;
    FWPlatform.registerModule({
      id: "maintenance",
      name: "Maintenance",
      version: "0.1.0",
      layer: "feature",
      order: 25,
      description: "Issues, inspections, reminders, work orders, parts, documents, and tyre readings.",
      dependencies: ["fleet_core", "fleet_ops"],
      permissions: ["maintenance.view", "maintenance.manage", "issues.view", "issues.manage"],
      tables: ["issues", "work_orders", "work_order_lines", "bill_reviews", "reminders", "inspections", "parts", "documents", "tyre_readings"],
      edgeFunctions: ["bill-review"],
      navigation: [
        { workspace: "ops", tab: "issues", label: "Issues", icon: "alert" },
        { workspace: "ops", tab: "reminders", label: "Service Reminders", icon: "clock" },
        { workspace: "ops", tab: "tyres", label: "Tyres", icon: "tire" },
      ],
      capabilities: ["maintenance.workflow", "maintenance.inventory", "maintenance.documents", "maintenance.bill_review"],
      init(ctx) {
        ctx.platform.registerCapability("maintenance.workflow", Maintenance);
        ctx.platform.registerCapability("maintenance.inventory", { savePart: Maintenance.savePart });
        ctx.platform.registerCapability("maintenance.documents", { createDocument: Maintenance.createDocument });
        ctx.platform.registerCapability("maintenance.bill_review", { open: window.openBillEntry });
      },
    });
    return true;
  }

  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
