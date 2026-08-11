/* ============ FleetWorks — service-workflow/ports ============ */
(function () {
  "use strict";
  const methods = ["state", "save"];
  window.FWServiceWorkflowPort = window.FWServiceWorkflowPort || { name: "serviceWorkflow.repository", methods };
  if (window.FWHex) FWHex.definePort("serviceWorkflow.repository", methods);
})();
