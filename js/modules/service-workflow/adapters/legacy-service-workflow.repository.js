/* ============ FleetWorks — service-workflow/adapters/legacy ============ */
(function () {
  "use strict";
  const repo = {
    name: "serviceWorkflow.legacyRepository",
    state() {
      try { if (typeof WFD !== "undefined") return WFD; } catch { /* lexical global not present */ }
      return window.WFD || [];
    },
    save() { if (typeof window.wfSave === "function") window.wfSave(); else localStorage.setItem("fw_service_requests", JSON.stringify(this.state())); return true; },
  };
  window.FWServiceWorkflowRepository = window.FWServiceWorkflowRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("serviceWorkflow.repository", repo, { priority: 10 });
})();
