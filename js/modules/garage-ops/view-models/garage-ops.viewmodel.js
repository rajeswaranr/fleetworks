/* ============ FleetWorks — garage-ops/view-models ============ */
(function () {
  "use strict";
  function dashboard(input) {
    return { payout: FWGarageOpsUseCases.payoutSnapshot(input || {}), rating: FWGarageOpsUseCases.ratingSnapshot(input || {}) };
  }
  window.FWGarageOpsViewModel = window.FWGarageOpsViewModel || { dashboard };
  if (window.FWHex) FWHex.registerViewModel("garageOps.dashboard", dashboard);
})();
