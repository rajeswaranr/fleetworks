/* ============ FleetWorks — service-workflow/view-models ============ */
(function () {
  "use strict";
  function stages() { return FWServiceWorkflowDomain.STAGES; }
  window.FWServiceWorkflowViewModel = window.FWServiceWorkflowViewModel || { stages };
  if (window.FWHex) FWHex.registerViewModel("serviceWorkflow.stages", stages);
})();
