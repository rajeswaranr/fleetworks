/* ============ FleetWorks — payments/view-models ============ */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.registerViewModel("payments.summary", () => {
    const options = FWHex.run("payments.listDriverPaymentOptions");
    const gateway = FWHex.adapter("payments.gateway");
    return {
      driverCount: options.length,
      upiReadyCount: options.filter(o => o.canPayUpi).length,
      bankReferenceCount: options.filter(o => o.canReferenceBank).length,
      cashfreeAvailable: gateway ? gateway.cashfreeAvailable() : false,
      options,
    };
  });
})();
