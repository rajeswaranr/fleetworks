/* ============ FleetWorks — garage-ops/use-cases ============ */
(function () {
  "use strict";
  function repo() { return window.FWHex && FWHex.adapter("garageOps.repository") || window.FWGarageOpsRepository; }
  function state(input) { return input && input.store || repo().state(); }
  function register(name, fn) { if (window.FWHex) FWHex.registerUseCase(name, fn); return fn; }
  const useCases = {
    approveEstimate: register("garageOps.approveEstimate", input => FWGarageOpsDomain.approveEstimate(state(input), input.id)),
    rejectEstimate: register("garageOps.rejectEstimate", input => FWGarageOpsDomain.rejectEstimate(state(input), input.id)),
    startJob: register("garageOps.startJob", input => FWGarageOpsDomain.advanceJob(state(input), input.id, "In Progress")),
    deliverJob: register("garageOps.deliverJob", input => FWGarageOpsDomain.advanceJob(state(input), input.id, "Delivered")),
    completeJob: register("garageOps.completeJob", input => FWGarageOpsDomain.completeJob(state(input), input.id, input.amount)),
    saveEstimate: register("garageOps.saveEstimate", input => FWGarageOpsDomain.saveEstimate(state(input), input.jobId, input.items || [])),
    saveInspection: register("garageOps.saveInspection", input => FWGarageOpsDomain.saveInspection(state(input), input.jobId, input.checkItems || [], input.formData)),
    saveStockItem: register("garageOps.saveStockItem", input => FWGarageOpsDomain.saveStockItem(state(input), input.fields, input.uidFn)),
    saveProfile: register("garageOps.saveProfile", input => FWGarageOpsDomain.saveProfile(state(input), input.fields)),
    resolveComplaint: register("garageOps.resolveComplaint", input => FWGarageOpsDomain.resolveComplaint(state(input), input.id)),
    payoutSnapshot: register("garageOps.payoutSnapshot", input => FWGarageOpsDomain.payoutSnapshot(state(input))),
    ratingSnapshot: register("garageOps.ratingSnapshot", input => FWGarageOpsDomain.ratingSnapshot(state(input))),
  };
  window.FWGarageOpsUseCases = window.FWGarageOpsUseCases || useCases;
})();
