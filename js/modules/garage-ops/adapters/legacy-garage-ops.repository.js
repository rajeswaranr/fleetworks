/* ============ FleetWorks — garage-ops/adapters/legacy ============ */
(function () {
  "use strict";
  const repo = {
    name: "garageOps.legacyRepository",
    state() {
      try { if (typeof G !== "undefined") return G; } catch { /* lexical global not present */ }
      return window.G || { profile: {}, jobs: [], stock: [], payouts: [], complaints: [] };
    },
    save() {
      if (typeof window.saveG === "function") window.saveG();
      else localStorage.setItem("fw_garage", JSON.stringify(this.state()));
      return true;
    },
  };
  window.FWGarageOpsRepository = window.FWGarageOpsRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("garageOps.repository", repo, { priority: 10 });
})();
