/* ============ FleetWorks — modules/payments ============
   Pluggable payment module contract. It keeps the current Payroll tab and
   UPI/Cashfree flows intact, while documenting the extension points for
   future gateways, approvals, wallet rails, or mobile payment handoff. */

(function () {
  "use strict";

  function drivers() {
    if (window.FWApi) return FWApi.domains.fleet.drivers();
    try { if (typeof db !== "undefined" && Array.isArray(db.drivers)) return db.drivers; } catch { /* lexical global not present */ }
    return (window.db && window.db.drivers) || [];
  }

  const Payments = {
    rails: {
      ownerUpi: {
        id: "owner_upi",
        name: "Owner UPI",
        mode: "client-handoff",
        movesMoneyInsideFleetWorks: false,
      },
      manualLog: {
        id: "manual_log",
        name: "Manual Payment Log",
        mode: "book-entry",
        movesMoneyInsideFleetWorks: false,
      },
      cashfree: {
        id: "cashfree",
        name: "Cashfree Payouts",
        mode: "edge-function-gateway",
        movesMoneyInsideFleetWorks: true,
        edgeFunctions: ["payroll-add-beneficiary", "payroll-transfer", "payroll-webhook"],
      },
    },

    driverPaymentOptions() {
      return drivers().map(d => ({
        driverId: d.id,
        driverName: d.name,
        hasUpi: !!d.upiId,
        hasBank: !!(d.bankAccount && d.bankIfsc),
        upiId: d.upiId || "",
        bankIfsc: d.bankIfsc || "",
      }));
    },

    buildUpiLink(vpa, name, amount, note) {
      if (window.FWApi) return FWApi.domains.payments.buildUpiLink(vpa, name, amount, note);
      const params = new URLSearchParams({ pa: vpa || "", pn: name || "", am: String(amount || 0), cu: "INR" });
      if (note) params.set("tn", String(note).slice(0, 50));
      return "upi://pay?" + params.toString();
    },

    hasCashfreeBridge() {
      return !!(window.fwCloud && fwCloud.callFunction);
    },
  };

  window.FWPayments = window.FWPayments || Payments;

  if (window.FWPlatform) {
    FWPlatform.registerModule({
      id: "payments",
      name: "Payments",
      version: "0.1.0",
      layer: "feature",
      order: 50,
      description: "Payment approvals, manual salary logs, UPI handoff, and Cashfree payout extension points.",
      dependencies: ["drivers", "fleet_fin"],
      permissions: ["payments.view", "payments.request", "payments.approve", "payments.gateway.manage"],
      tables: ["payment_requests", "salary_payments", "driver_payout_details"],
      edgeFunctions: ["payroll-add-beneficiary", "payroll-transfer", "payroll-webhook"],
      navigation: [{ workspace: "fin", tab: "payroll", label: "Payroll — Pay Drivers", icon: "rupee" }],
      capabilities: ["payments.rail.owner_upi", "payments.rail.manual_log", "payments.gateway.cashfree"],
      adapters: Payments.rails,
      init(ctx) {
        ctx.platform.registerCapability("payments.rail.owner_upi", Payments.rails.ownerUpi);
        ctx.platform.registerCapability("payments.rail.manual_log", Payments.rails.manualLog);
        ctx.platform.registerCapability("payments.gateway.cashfree", Payments.rails.cashfree);
      },
    });
  }
})();
