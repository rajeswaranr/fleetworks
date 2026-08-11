/* ============ FleetWorks — fleet-ops/view-models ============ */

(function () {
  "use strict";

  function overview(input) {
    return {
      insights: FWFleetOpsUseCases.computeInsights(input || {}),
      reminders: FWFleetOpsUseCases.reminderStatus(input || {}),
      issues: FWFleetOpsUseCases.prioritisedIssues(input || {}),
      radar: FWFleetOpsUseCases.radarItems(input || {}),
    };
  }

  window.FWFleetOpsViewModel = window.FWFleetOpsViewModel || { overview };
  if (window.FWHex) FWHex.registerViewModel("fleetOps.overview", overview);
})();
