/* ============ FleetWorks — payments/adapters ============
   Compatibility adapter over current Payroll/FWApi behavior. */

(function () {
  "use strict";

  function drivers() {
    if (window.FWApi) return FWApi.domains.fleet.drivers();
    try { if (typeof db !== "undefined" && Array.isArray(db.drivers)) return db.drivers; } catch { /* lexical global not present */ }
    return [];
  }

  async function orgId() {
    if (window.FWApi) return FWApi.db.orgId();
    if (typeof window.getMyOrgId === "function") return window.getMyOrgId();
    return null;
  }

  const repo = {
    name: "payments.legacyRepository",
    listDrivers() {
      return drivers().map(driver => ({
        id: driver.id,
        name: driver.name,
        upiId: driver.upiId || "",
        bankAccount: driver.bankAccount || "",
        bankIfsc: driver.bankIfsc || "",
      }));
    },
    async listPendingRequests() {
      const org = await orgId();
      if (!org || !window.FWApi) return [];
      return FWApi.domains.payments.pendingRequests(org) || [];
    },
    async createPaymentRequest(input) {
      const org = await orgId();
      if (!org || !window.FWApi) return false;
      const req = FWPaymentDomain.buildSalaryRequest(input);
      return FWApi.rest.insert("payment_requests", {
        org_id: org,
        driver_ext_id: req.driverExtId,
        period: req.period,
        amount: req.amount,
        note: req.notes || null,
        requested_by: FWApi.auth.uid(),
        status: "pending",
      });
    },
    async listSalaryPayments() {
      const org = await orgId();
      if (!org || !window.FWApi) return [];
      return FWApi.rest.get("salary_payments", `select=*&org_id=eq.${org}&order=initiated_at.desc&limit=50`) || [];
    },
  };

  const gateway = {
    name: "payments.legacyGateway",
    buildUpiLink(vpa, name, amount, note) {
      if (window.FWApi) return FWApi.domains.payments.buildUpiLink(vpa, name, amount, note);
      const params = new URLSearchParams({ pa: vpa || "", pn: name || "", am: String(amount || 0), cu: "INR" });
      if (note) params.set("tn", String(note).slice(0, 50));
      return "upi://pay?" + params.toString();
    },
    openUpiPayment(vpa, name, amount, note) {
      const link = gateway.buildUpiLink(vpa, name, amount, note);
      window.location.href = link;
      return link;
    },
    cashfreeAvailable() {
      return !!(window.fwCloud && fwCloud.callFunction);
    },
  };

  window.FWPaymentRepository = window.FWPaymentRepository || repo;
  window.FWPaymentGateway = window.FWPaymentGateway || gateway;
  if (window.FWHex) {
    FWHex.registerAdapter("payments.repository", repo, { priority: 10 });
    FWHex.registerAdapter("payments.gateway", gateway, { priority: 10 });
  }
})();
