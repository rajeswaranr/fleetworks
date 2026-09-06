/* ============ FleetWorks — modules/fleet-fin ============
   Additive FleetFin module. Existing renderers remain in fleet.js and
   analytics.js while finance workflows move behind use cases. */

(function () {
  "use strict";

  const FleetFin = {
    createExpense(input) { return FWFleetFinUseCases.createExpense(input || {}); },
    updateExpense(input) { return FWFleetFinUseCases.updateExpense(input || {}); },
    createFuelLog(input) { return FWFleetFinUseCases.createFuelLog(input || {}); },
    updateFuelLog(input) { return FWFleetFinUseCases.updateFuelLog(input || {}); },
    createTrip(input) { return FWFleetFinUseCases.createTrip(input || {}); },
    updateTrip(input) { return FWFleetFinUseCases.updateTrip(input || {}); },
    createLedgerEntry(input) { return FWFleetFinUseCases.createLedgerEntry(input || {}); },
    updateLedgerEntry(input) { return FWFleetFinUseCases.updateLedgerEntry(input || {}); },
    summary(input) { return FWFleetFinViewModel.summary(input || {}); },
  };

  window.FWFleetFin = window.FWFleetFin || FleetFin;

  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("fleetFin.repository")) FWHex.definePort("fleetFin.repository", window.FWFleetFinPort.methods);
    if (!FWHex.adapter("fleetFin.repository")) FWHex.registerAdapter("fleetFin.repository", window.FWFleetFinRepository, { priority: 10 });
    Object.entries(FWFleetFinUseCases).forEach(([key, fn]) => FWHex.registerUseCase("fleetFin." + key, fn));
    FWHex.registerViewModel("fleetFin.summary", FWFleetFinViewModel.summary);
    return true;
  }

  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("fleet_fin")) return true;
    FWPlatform.registerModule({
      id: "fleet_fin",
      name: "FleetFin",
      version: "0.1.0",
      layer: "feature",
      order: 30,
      description: "Fuel logs, expenses, GST bills, trips, driver khata, and financial summaries.",
      dependencies: ["fleet_core"],
      permissions: ["finance.view", "finance.manage", "fuel.manage", "expenses.manage"],
      tables: ["fuel_logs", "expenses", "expense_categories", "trips", "driver_ledger", "expense_change_requests", "fastag_accounts", "fastag_balance_log"],
      navigation: [
        { workspace: "fin", tab: "fuel", label: "Diesel & Mileage", icon: "fuel" },
        { workspace: "fin", tab: "expensehistory", label: "Expenses", icon: "receipt" },
        { workspace: "fin", tab: "gstbills", label: "Bills & GST", icon: "receipt" },
      ],
      capabilities: ["fleet_fin.entries", "fleet_fin.summary", "fleet_fin.fastag"],
      init(ctx) {
        ctx.platform.registerCapability("fleet_fin.entries", FleetFin);
        ctx.platform.registerCapability("fleet_fin.summary", { viewModel: FleetFin.summary });
        ctx.platform.registerCapability("fleet_fin.fastag", { render: window.renderFastag });
      },
    });
    return true;
  }

  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
