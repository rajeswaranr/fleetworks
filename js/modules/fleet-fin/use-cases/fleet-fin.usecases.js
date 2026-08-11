/* ============ FleetWorks — fleet-fin/use-cases ============ */

(function () {
  "use strict";

  function repository() {
    if (window.FWHex && FWHex.adapter("fleetFin.repository")) return FWHex.adapter("fleetFin.repository");
    return window.FWFleetFinRepository || null;
  }

  function requireRepository() {
    const repo = repository();
    if (!repo) throw new Error("FleetFin repository is not available.");
    return repo;
  }

  function register(name, fn) {
    if (window.FWHex) FWHex.registerUseCase(name, fn);
    return fn;
  }

  const useCases = {
    createExpense: register("fleetFin.createExpense", async input => {
      const expense = FWFleetFinDomain.normalizeExpense(input);
      if (!expense.vehicleId || !expense.date || !expense.category || !expense.amount) throw new Error("Vehicle, date, category and amount are required.");
      return requireRepository().createExpense(expense);
    }),

    updateExpense: register("fleetFin.updateExpense", async input => {
      if (!input.id) throw new Error("Expense id is required.");
      return requireRepository().updateExpense(input.id, FWFleetFinDomain.expensePatch(input.patch || input));
    }),

    createFuelLog: register("fleetFin.createFuelLog", async input => {
      const fuelLog = FWFleetFinDomain.normalizeFuelLog(input);
      if (!fuelLog.vehicleId || !fuelLog.date) throw new Error("Vehicle and date are required.");
      return requireRepository().createFuelLog(fuelLog);
    }),

    updateFuelLog: register("fleetFin.updateFuelLog", async input => {
      if (!input.id) throw new Error("Fuel log id is required.");
      return requireRepository().updateFuelLog(input.id, FWFleetFinDomain.normalizeFuelLog(input.patch || input));
    }),

    createTrip: register("fleetFin.createTrip", async input => {
      const trip = FWFleetFinDomain.normalizeTrip(input);
      if (!trip.vehicleId || !trip.date || !trip.from || !trip.to || !trip.freight) throw new Error("Vehicle, route, date and freight are required.");
      return requireRepository().createTrip(trip);
    }),

    updateTrip: register("fleetFin.updateTrip", async input => {
      if (!input.id) throw new Error("Trip id is required.");
      return requireRepository().updateTrip(input.id, FWFleetFinDomain.normalizeTrip(input.patch || input));
    }),

    createLedgerEntry: register("fleetFin.createLedgerEntry", async input => {
      const entry = FWFleetFinDomain.normalizeLedgerEntry(input);
      if (!entry.driverId || !entry.date || !entry.amount) throw new Error("Driver, date and amount are required.");
      return requireRepository().createLedgerEntry(entry);
    }),

    updateLedgerEntry: register("fleetFin.updateLedgerEntry", async input => {
      if (!input.id) throw new Error("Ledger entry id is required.");
      return requireRepository().updateLedgerEntry(input.id, FWFleetFinDomain.normalizeLedgerEntry(input.patch || input));
    }),

    totals: register("fleetFin.totals", input => {
      const repo = requireRepository();
      return FWFleetFinDomain.totals(input && input.state || repo.state());
    }),
  };

  window.FWFleetFinUseCases = window.FWFleetFinUseCases || useCases;
})();
