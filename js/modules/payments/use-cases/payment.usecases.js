/* ============ FleetWorks — payments/use-cases ============ */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.registerUseCase("payments.listDriverPaymentOptions", () => {
    const repo = FWHex.adapter("payments.repository");
    if (!repo) throw new Error("payments.repository adapter is not registered.");
    return repo.listDrivers().map(driver => ({
      driverId: driver.id,
      driverName: driver.name,
      canPayUpi: FWPaymentDomain.validUpi(driver.upiId),
      canReferenceBank: !!(driver.bankAccount && driver.bankIfsc),
    }));
  });

  FWHex.registerUseCase("payments.createPaymentRequest", input => {
    const repo = FWHex.adapter("payments.repository");
    if (!repo) throw new Error("payments.repository adapter is not registered.");
    return repo.createPaymentRequest(input);
  });

  FWHex.registerUseCase("payments.buildUpiLink", input => {
    const gateway = FWHex.adapter("payments.gateway");
    if (!gateway) throw new Error("payments.gateway adapter is not registered.");
    return gateway.buildUpiLink(input.vpa, input.name, input.amount, input.note);
  });
})();
