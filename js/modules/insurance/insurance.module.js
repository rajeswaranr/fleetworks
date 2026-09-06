/* ============ FleetWorks — insurance module ============ */
(function () {
  "use strict";

  function register() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("insurance")) return true;
    FWPlatform.registerModule({
      id: "insurance",
      name: "Commercial Vehicle Insurance",
      version: "0.1.0",
      layer: "feature",
      order: 75,
      description: "Commercial vehicle premium estimates and insurance quote requests.",
      dependencies: [],
      permissions: ["insurance.quote.create", "insurance.quote.manage"],
      tables: ["insurance_quotes"],
      capabilities: ["insurance.premium_estimate", "insurance.quote_request"],
      init(ctx) {
        ctx.platform.registerCapability("insurance.premium_estimate", { estimate: window.estimatePremium });
      },
    });
    return true;
  }

  if (!register()) setTimeout(register, 0);
})();
