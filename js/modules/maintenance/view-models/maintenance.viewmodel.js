/* ============ FleetWorks — maintenance/view-models ============ */

(function () {
  "use strict";

  function summary(input) {
    const state = input && input.state || (window.FWMaintenanceRepository && FWMaintenanceRepository.state()) || {};
    const openIssues = (state.issues || []).filter(i => i.status !== "Resolved");
    const openWorkOrders = (state.workOrders || []).filter(w => w.status !== "Completed");
    const lowStock = (state.parts || []).filter(p => Number(p.qty || 0) <= Number(p.minQty || 0));
    return {
      openIssueCount: openIssues.length,
      highIssueCount: openIssues.filter(i => i.severity === "High").length,
      openWorkOrderCount: openWorkOrders.length,
      lowStockCount: lowStock.length,
    };
  }

  window.FWMaintenanceViewModel = window.FWMaintenanceViewModel || { summary };
  if (window.FWHex) FWHex.registerViewModel("maintenance.summary", summary);
})();
