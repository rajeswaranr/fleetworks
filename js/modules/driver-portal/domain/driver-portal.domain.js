/* ============ FleetWorks — driver-portal/domain ============ */
(function () {
  "use strict";

  const CHECK_ITEMS = [
    "Tyres & pressure", "Brakes & air system", "Lights & indicators", "Horn",
    "Engine oil leak check", "Coolant level", "Battery & terminals",
    "Documents in cabin (RC/Ins/PUC)", "Load body & tarpaulin", "Cabin & seat belts",
  ];

  function today() { return new Date().toISOString().slice(0, 10); }

  function normalizeContext(input) {
    const c = input || {};
    return {
      ownerId: c.ownerId || c.owner || "",
      token: c.token || "",
      driverName: c.driverName || c.driver || "Driver",
      vehicleName: c.vehicleName || c.vehicle || "",
    };
  }

  function isValidContext(ctx) {
    const c = normalizeContext(ctx);
    return !!(c.ownerId && c.token && c.vehicleName);
  }

  function normalizeFuel(input) {
    const f = input || {};
    return { litres: Number(f.litres || 0), amount: Number(f.amount || 0), odo: Number(f.odo || 0), date: f.date || today() };
  }

  function normalizeIssue(input) {
    const i = input || {};
    return { title: String(i.title || "").trim(), severity: i.severity || "Medium" };
  }

  function normalizeInspection(input) {
    const i = input || {};
    const results = Array.isArray(i.results) ? i.results : [];
    return { results, passed: i.passed == null ? results.every(r => r.ok) : !!i.passed, odo: Number(i.odo || 0), date: i.date || today() };
  }

  function entryRecord(ctx, kind, payload) {
    const c = normalizeContext(ctx);
    return { owner_id: c.ownerId, token: c.token, driver_name: c.driverName, vehicle_name: c.vehicleName, kind, payload };
  }

  window.FWDriverPortalDomain = window.FWDriverPortalDomain || {
    CHECK_ITEMS, today, normalizeContext, isValidContext, normalizeFuel, normalizeIssue, normalizeInspection, entryRecord,
  };
})();
