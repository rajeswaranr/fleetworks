/* ============ FleetWorks — payments/domain ============
   Payment domain helpers without DOM, Supabase, or gateway side effects. */

(function () {
  "use strict";

  function amount(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function validUpi(vpa) {
    return /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/.test(String(vpa || "").trim());
  }

  function buildSalaryRequest(input) {
    const data = input || {};
    const amt = amount(data.amount);
    if (!data.driverExtId) throw new Error("Driver is required.");
    if (!data.period) throw new Error("Payment period is required.");
    if (!amt) throw new Error("Payment amount must be greater than zero.");
    return {
      driverExtId: data.driverExtId,
      period: data.period,
      amount: amt,
      note: (data.note || data.notes || "").trim(),
      method: data.method || "upi",
    };
  }

  function railSummary(rail) {
    return {
      id: rail.id,
      name: rail.name,
      mode: rail.mode,
      movesMoneyInsideFleetWorks: !!rail.movesMoneyInsideFleetWorks,
    };
  }

  window.FWPaymentDomain = window.FWPaymentDomain || {
    amount,
    validUpi,
    buildSalaryRequest,
    railSummary,
  };
})();
