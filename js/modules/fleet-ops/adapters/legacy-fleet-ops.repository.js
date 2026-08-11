/* ============ FleetWorks — fleet-ops/adapters/legacy ============
   Compatibility adapter over the current browser-global FleetWorks state. */

(function () {
  "use strict";

  function localDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || {};
  }

  function callGlobal(name, fallback) {
    const fn = window[name];
    return typeof fn === "function" ? fn : fallback;
  }

  function state() {
    const d = localDb();
    return {
      vehicles: d.vehicles || [],
      drivers: d.drivers || [],
      expenses: d.expenses || [],
      fuelLogs: d.fuelLogs || [],
      issues: d.issues || [],
      workOrders: d.workOrders || [],
      reminders: d.reminders || [],
      inspections: d.inspections || [],
      parts: d.parts || [],
      documents: d.documents || [],
      tyreReadings: d.tyreReadings || [],
      settings: d.settings || {},
    };
  }

  function options() {
    const d = localDb();
    const fmtDate = callGlobal("fmtDate", date => String(date || ""));
    const fmtINR = callGlobal("fmtINR", amount => "Rs " + Number(amount || 0));
    const vName = callGlobal("vName", id => {
      const v = (d.vehicles || []).find(x => x.id === id);
      return v ? v.name : "—";
    });
    const mileagePoints = callGlobal("mileagePoints", () => []);
    const vehicleStats = callGlobal("vehicleStats", () => []);
    const predictParts = callGlobal("predictParts", () => []);
    return {
      docLabels: window.DOC_LABELS || FWFleetOpsDomain.DEFAULT_DOC_LABELS,
      warnDays: +(d.settings && d.settings.warnDays) || 30,
      minTread: +(d.settings && d.settings.minTread) || 1.6,
      fmtDate,
      fmtINR,
      vName,
      mileagePoints,
      vehicleStats: vehicleStats(),
      predictions: predictParts(),
    };
  }

  const repo = { name: "fleetOps.legacyRepository", state, options };

  window.FWFleetOpsRepository = window.FWFleetOpsRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("fleetOps.repository", repo, { priority: 10 });
})();
