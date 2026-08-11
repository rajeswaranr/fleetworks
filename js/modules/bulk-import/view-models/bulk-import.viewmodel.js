/* ============ FleetWorks — bulk-import/view-models ============ */
(function () {
  "use strict";
  function summary(input) {
    const r = input || {};
    return { newCount: (r.news || []).length, duplicateCount: (r.dups || []).length, errorCount: (r.errors || []).length };
  }
  window.FWBulkImportViewModel = window.FWBulkImportViewModel || { summary };
  if (window.FWHex) FWHex.registerViewModel("bulkImport.summary", summary);
})();
