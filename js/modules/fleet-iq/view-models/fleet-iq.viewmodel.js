/* ============ FleetWorks — fleet-iq/view-models ============ */

(function () {
  "use strict";

  function impact(input) {
    return FWFleetIQUseCases.iqImpact(input || {});
  }

  function dashboard(input) {
    return {
      impact: impact(input || {}),
      predictions: FWFleetIQUseCases.predictParts(input || {}),
      recommendations: FWFleetIQUseCases.recommendations(input || {}),
      dieselFlags: FWFleetIQUseCases.fuelTheftFlags(input || {}),
    };
  }

  window.FWFleetIQViewModel = window.FWFleetIQViewModel || { impact, dashboard };
  if (window.FWHex) {
    FWHex.registerViewModel("fleetIq.impact", impact);
    FWHex.registerViewModel("fleetIq.dashboard", dashboard);
  }
})();
