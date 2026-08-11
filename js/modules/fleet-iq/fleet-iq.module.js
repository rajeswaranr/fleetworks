/* ============ FleetWorks — modules/fleet-iq ============
   Additive FleetIQ module. Existing analytics.js keeps DOM rendering while
   prediction, forecasting, anomaly, recommendation, and what-if logic move here. */

(function () {
  "use strict";

  const FleetIQ = {
    filteredExpenses(input) { return FWFleetIQUseCases.filteredExpenses(input || {}); },
    monthlySeries(input) { return FWFleetIQUseCases.monthlySeries(input || {}); },
    forecastMonthly(input) { return FWFleetIQUseCases.forecastMonthly(input || {}); },
    vehicleStats(input) { return FWFleetIQUseCases.vehicleStats(input || {}); },
    partStats(input) { return FWFleetIQUseCases.partStats(input || {}); },
    predictParts(input) { return FWFleetIQUseCases.predictParts(input || {}); },
    iqImpact(input) { return FWFleetIQUseCases.iqImpact(input || {}); },
    recurrentRows(input) { return FWFleetIQUseCases.recurrentRows(input || {}); },
    deviationRows(input) { return FWFleetIQUseCases.deviationRows(input || {}); },
    anomalyRows(input) { return FWFleetIQUseCases.anomalyRows(input || {}); },
    recommendations(input) { return FWFleetIQUseCases.recommendations(input || {}); },
    fuelTheftFlags(input) { return FWFleetIQUseCases.fuelTheftFlags(input || {}); },
    whatIfBase(input) { return FWFleetIQUseCases.whatIfBase(input || {}); },
    projectWhatIf(input) { return FWFleetIQUseCases.projectWhatIf(input || {}); },
    dashboard(input) { return FWFleetIQViewModel.dashboard(input || {}); },
  };

  window.FWFleetIQ = window.FWFleetIQ || FleetIQ;

  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("fleetIq.repository")) FWHex.definePort("fleetIq.repository", window.FWFleetIQPort.methods);
    if (!FWHex.adapter("fleetIq.repository")) FWHex.registerAdapter("fleetIq.repository", window.FWFleetIQRepository, { priority: 10 });
    Object.entries(FWFleetIQUseCases).forEach(([key, fn]) => FWHex.registerUseCase("fleetIq." + key, fn));
    FWHex.registerViewModel("fleetIq.impact", FWFleetIQViewModel.impact);
    FWHex.registerViewModel("fleetIq.dashboard", FWFleetIQViewModel.dashboard);
    return true;
  }

  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("fleet_iq")) return true;
    FWPlatform.registerModule({
      id: "fleet_iq",
      name: "FleetIQ",
      version: "0.1.0",
      layer: "feature",
      order: 40,
      description: "Forecasting, part replacement prediction, anomaly detection, diesel-watch, recommendations, and what-if planning.",
      dependencies: ["fleet_core", "fleet_ops", "fleet_fin"],
      permissions: ["iq.view", "iq.forecast", "iq.recommend"],
      tables: ["expenses", "fuel_logs", "issues", "vehicles"],
      navigation: [
        { workspace: "iq", tab: "analytics", label: "FleetIQ Dashboard", icon: "brain" },
        { workspace: "iq", tab: "forecasting", label: "Forecasting", icon: "trendUp" },
        { workspace: "iq", tab: "recommend", label: "Recommendations", icon: "checkCircle" },
      ],
      capabilities: ["fleet_iq.predictions", "fleet_iq.analytics", "fleet_iq.what_if"],
      init(ctx) {
        ctx.platform.registerCapability("fleet_iq.predictions", {
          predictParts: FleetIQ.predictParts,
          fuelTheftFlags: FleetIQ.fuelTheftFlags,
        });
        ctx.platform.registerCapability("fleet_iq.analytics", {
          forecastMonthly: FleetIQ.forecastMonthly,
          vehicleStats: FleetIQ.vehicleStats,
          partStats: FleetIQ.partStats,
          recommendations: FleetIQ.recommendations,
        });
        ctx.platform.registerCapability("fleet_iq.what_if", {
          whatIfBase: FleetIQ.whatIfBase,
          projectWhatIf: FleetIQ.projectWhatIf,
        });
      },
    });
    return true;
  }

  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
