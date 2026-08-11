/* ============ FleetWorks — bulk-import/ports ============ */
(function () {
  "use strict";
  const methods = ["state"];
  window.FWBulkImportPort = window.FWBulkImportPort || { name: "bulkImport.repository", methods };
  if (window.FWHex) FWHex.definePort("bulkImport.repository", methods);
})();
