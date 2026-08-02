/* ============ FleetWorks — payments/ports ============
   Repository and gateway ports for payment module. */

(function () {
  "use strict";

  if (!window.FWHex) return;

  FWHex.definePort("payments.repository", [
    "listDrivers",
    "listPendingRequests",
    "createPaymentRequest",
    "listSalaryPayments",
  ]);

  FWHex.definePort("payments.gateway", [
    "buildUpiLink",
    "openUpiPayment",
    "cashfreeAvailable",
  ]);
})();
