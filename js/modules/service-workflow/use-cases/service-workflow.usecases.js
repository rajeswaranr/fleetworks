/* ============ FleetWorks — service-workflow/use-cases ============ */
(function () {
  "use strict";
  function repo() { return window.FWHex && FWHex.adapter("serviceWorkflow.repository") || window.FWServiceWorkflowRepository; }
  function state(input) { return input && input.requests || repo().state(); }
  function register(name, fn) { if (window.FWHex) FWHex.registerUseCase(name, fn); return fn; }
  const useCases = {
    raise: register("serviceWorkflow.raise", input => FWServiceWorkflowDomain.raise(input || {})),
    advance: register("serviceWorkflow.advance", input => FWServiceWorkflowDomain.advance(state(input), input.id, input.toIdx, input.by, input.note, input.patch)),
    cloudRowToCard: register("serviceWorkflow.cloudRowToCard", input => FWServiceWorkflowDomain.cloudRowToCard(input || {})),
  };
  window.FWServiceWorkflowUseCases = window.FWServiceWorkflowUseCases || useCases;
})();
