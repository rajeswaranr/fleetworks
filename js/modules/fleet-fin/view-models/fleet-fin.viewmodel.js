/* ============ FleetWorks — fleet-fin/view-models ============ */

(function () {
  "use strict";

  function summary(input) {
    const totals = FWFleetFinUseCases.totals(input || {});
    return {
      ...totals,
      totalSpend: totals.expenseSpend + totals.fuelSpend,
      grossProfit: totals.freight - totals.expenseSpend - totals.fuelSpend,
      avgFuelPrice: totals.fuelLitres ? totals.fuelSpend / totals.fuelLitres : 0,
    };
  }

  window.FWFleetFinViewModel = window.FWFleetFinViewModel || { summary };
  if (window.FWHex) FWHex.registerViewModel("fleetFin.summary", summary);
})();
