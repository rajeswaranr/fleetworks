/* ============ FleetWorks — bulk-import/adapters/legacy ============ */
(function () {
  "use strict";
  const repo = {
    name: "bulkImport.legacyRepository",
    state() {
      try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
      return window.db || { vehicles: [], drivers: [] };
    },
  };
  window.FWBulkImportRepository = window.FWBulkImportRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("bulkImport.repository", repo, { priority: 10 });
})();
