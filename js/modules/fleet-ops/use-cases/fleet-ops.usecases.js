/* ============ FleetWorks — fleet-ops/use-cases ============ */

(function () {
  "use strict";

  function repository() {
    if (window.FWHex && FWHex.adapter("fleetOps.repository")) return FWHex.adapter("fleetOps.repository");
    return window.FWFleetOpsRepository || null;
  }

  function requireRepository() {
    const repo = repository();
    if (!repo) throw new Error("FleetOps repository is not available.");
    return repo;
  }

  function register(name, fn) {
    if (window.FWHex) FWHex.registerUseCase(name, fn);
    return fn;
  }

  function ctx(input) {
    const repo = requireRepository();
    return {
      state: input && input.state || repo.state(),
      options: { ...repo.options(), ...(input && input.options || {}) },
    };
  }

  const useCases = {
    computeInsights: register("fleetOps.computeInsights", input => {
      const c = ctx(input);
      return FWFleetOpsDomain.computeInsights(c.state, c.options);
    }),

    prioritisedIssues: register("fleetOps.prioritisedIssues", input => {
      const c = ctx(input);
      return FWFleetOpsDomain.prioritisedIssues(c.state.issues, c.state.vehicles, c.options);
    }),

    reminderStatus: register("fleetOps.reminderStatus", input => {
      const c = ctx(input);
      return FWFleetOpsDomain.reminderStatus(c.state.reminders, c.options);
    }),

    radarItems: register("fleetOps.radarItems", input => {
      const c = ctx(input);
      return FWFleetOpsDomain.radarItems(c.state, c.options);
    }),

    latestReadings: register("fleetOps.latestReadings", input => {
      const c = ctx(input);
      return FWFleetOpsDomain.latestReadings(c.state.tyreReadings, input && input.vehicleId);
    }),

    healthScore: register("fleetOps.healthScore", input => {
      const c = ctx(input);
      return FWFleetOpsDomain.healthScore(input && input.vehicle, c.state, c.options);
    }),
  };

  window.FWFleetOpsUseCases = window.FWFleetOpsUseCases || useCases;
})();
