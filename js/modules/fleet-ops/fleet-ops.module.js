/* ============ FleetWorks — modules/fleet-ops ============
   Additive FleetOps module. Existing fleet.js still renders the UI; this
   module centralizes overview, issue, reminder, radar, and health logic. */

(function () {
  "use strict";

  const FleetOps = {
    computeInsights(input) { return FWFleetOpsUseCases.computeInsights(input || {}); },
    prioritisedIssues(input) { return FWFleetOpsUseCases.prioritisedIssues(input || {}); },
    reminderStatus(input) { return FWFleetOpsUseCases.reminderStatus(input || {}); },
    radarItems(input) { return FWFleetOpsUseCases.radarItems(input || {}); },
    latestReadings(vehicleId, input) { return FWFleetOpsUseCases.latestReadings({ ...(input || {}), vehicleId }); },
    healthScore(vehicle, input) { return FWFleetOpsUseCases.healthScore({ ...(input || {}), vehicle }); },
    overview(input) { return FWFleetOpsViewModel.overview(input || {}); },
  };

  window.FWFleetOps = window.FWFleetOps || FleetOps;

  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("fleetOps.repository")) FWHex.definePort("fleetOps.repository", window.FWFleetOpsPort.methods);
    if (!FWHex.adapter("fleetOps.repository")) FWHex.registerAdapter("fleetOps.repository", window.FWFleetOpsRepository, { priority: 10 });
    FWHex.registerUseCase("fleetOps.computeInsights", FWFleetOpsUseCases.computeInsights);
    FWHex.registerUseCase("fleetOps.prioritisedIssues", FWFleetOpsUseCases.prioritisedIssues);
    FWHex.registerUseCase("fleetOps.reminderStatus", FWFleetOpsUseCases.reminderStatus);
    FWHex.registerUseCase("fleetOps.radarItems", FWFleetOpsUseCases.radarItems);
    FWHex.registerUseCase("fleetOps.latestReadings", FWFleetOpsUseCases.latestReadings);
    FWHex.registerUseCase("fleetOps.healthScore", FWFleetOpsUseCases.healthScore);
    FWHex.registerViewModel("fleetOps.overview", FWFleetOpsViewModel.overview);
    return true;
  }

  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("fleet_ops")) return true;
    FWPlatform.registerModule({
      id: "fleet_ops",
      name: "FleetOps",
      version: "0.1.0",
      layer: "feature",
      order: 20,
      description: "Operational overview, risks, issue priority, reminders, renewals, tyres, and vehicle health.",
      dependencies: ["fleet_core"],
      permissions: ["fleet.view", "fleet.manage", "issues.view", "maintenance.view"],
      tables: ["vehicles", "drivers", "issues", "work_orders", "reminders", "inspections", "documents", "tyre_readings", "parts"],
      navigation: [{ workspace: "ops", tab: "overview", label: "FleetOps Dashboard", icon: "gauge" }],
      capabilities: ["fleet_ops.overview", "fleet_ops.health", "fleet_ops.renewals"],
      init(ctx) {
        ctx.platform.registerCapability("fleet_ops.overview", { viewModel: FleetOps.overview });
        ctx.platform.registerCapability("fleet_ops.health", { score: FleetOps.healthScore });
        ctx.platform.registerCapability("fleet_ops.renewals", { radar: FleetOps.radarItems });
      },
    });
    return true;
  }

  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
