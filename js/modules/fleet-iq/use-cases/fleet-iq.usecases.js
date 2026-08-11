/* ============ FleetWorks — fleet-iq/use-cases ============ */

(function () {
  "use strict";

  function repository() {
    if (window.FWHex && FWHex.adapter("fleetIq.repository")) return FWHex.adapter("fleetIq.repository");
    return window.FWFleetIQRepository || null;
  }

  function requireRepository() {
    const repo = repository();
    if (!repo) throw new Error("FleetIQ repository is not available.");
    return repo;
  }

  function register(name, fn) {
    if (window.FWHex) FWHex.registerUseCase(name, fn);
    return fn;
  }

  function state(input) {
    return input && input.state || requireRepository().state();
  }

  function filters(input) {
    return input && input.filters || requireRepository().filters();
  }

  const useCases = {
    filteredExpenses: register("fleetIq.filteredExpenses", input => FWFleetIQDomain.filteredExpenses(state(input), filters(input))),
    monthlySeries: register("fleetIq.monthlySeries", input => FWFleetIQDomain.monthlySeries(input && input.expenses || [])),
    forecastMonthly: register("fleetIq.forecastMonthly", input => FWFleetIQDomain.forecastMonthly(input && input.totals || [], input && input.horizon || 3)),
    vehicleStats: register("fleetIq.vehicleStats", input => FWFleetIQDomain.vehicleStats(state(input), filters(input))),
    partStats: register("fleetIq.partStats", input => FWFleetIQDomain.partStats(input && input.expenses || FWFleetIQDomain.filteredExpenses(state(input), filters(input)))),
    predictParts: register("fleetIq.predictParts", input => FWFleetIQDomain.predictParts(state(input))),
    iqImpact: register("fleetIq.iqImpact", input => {
      const repo = requireRepository();
      const signals = input && input.signals != null ? input.signals : repo.insights().filter(i => i.sev >= 2).length;
      return FWFleetIQDomain.iqImpact(state(input), signals);
    }),
    recurrentRows: register("fleetIq.recurrentRows", input => FWFleetIQDomain.recurrentRows(state(input))),
    deviationRows: register("fleetIq.deviationRows", input => FWFleetIQDomain.deviationRows(state(input), filters(input))),
    anomalyRows: register("fleetIq.anomalyRows", input => FWFleetIQDomain.anomalyRows(state(input))),
    recommendations: register("fleetIq.recommendations", input => {
      const repo = requireRepository();
      const insightRows = input && input.insights || repo.insights();
      return FWFleetIQDomain.recommendationItems(state(input), insightRows, filters(input));
    }),
    fuelTheftFlags: register("fleetIq.fuelTheftFlags", input => FWFleetIQDomain.fuelTheftFlags(state(input))),
    whatIfBase: register("fleetIq.whatIfBase", input => FWFleetIQDomain.whatIfBase(state(input))),
    projectWhatIf: register("fleetIq.projectWhatIf", input => {
      const base = input && input.base || FWFleetIQDomain.whatIfBase(state(input));
      return FWFleetIQDomain.projectWhatIf(base, input || {});
    }),
  };

  window.FWFleetIQUseCases = window.FWFleetIQUseCases || useCases;
})();
