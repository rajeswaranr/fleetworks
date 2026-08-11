/* ============ FleetWorks — fleet-iq/adapters/legacy ============
   Compatibility adapter over the current global db and filter controls. */

(function () {
  "use strict";

  function localDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || {};
  }

  function selected(id, fallback) {
    const el = document.getElementById(id);
    return el ? el.value : fallback;
  }

  const repo = {
    name: "fleetIq.legacyRepository",

    state() {
      const d = localDb();
      return {
        vehicles: d.vehicles || [],
        expenses: d.expenses || [],
        issues: d.issues || [],
        fuelLogs: d.fuelLogs || [],
      };
    },

    filters() {
      return {
        vehicleId: selected("vehicleFilter", selected("iqVehicleFilter", "all")) || "all",
        period: Number(selected("periodFilter", selected("iqPeriodFilter", 12)) || 12),
      };
    },

    insights() {
      return typeof window.computeInsights === "function" ? window.computeInsights() : [];
    },
  };

  window.FWFleetIQRepository = window.FWFleetIQRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("fleetIq.repository", repo, { priority: 10 });
})();
