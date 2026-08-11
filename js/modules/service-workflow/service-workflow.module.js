/* ============ FleetWorks — modules/service-workflow ============ */
(function () {
  "use strict";
  const ServiceWorkflow = {
    stages() { return FWServiceWorkflowDomain.STAGES; },
    stageEnum() { return FWServiceWorkflowDomain.ENUM; },
    raise(input) { return FWServiceWorkflowUseCases.raise(input || {}); },
    advance(input) { return FWServiceWorkflowUseCases.advance(input || {}); },
    cloudRowToCard(input) { return FWServiceWorkflowUseCases.cloudRowToCard(input || {}); },
  };
  window.FWServiceWorkflow = window.FWServiceWorkflow || ServiceWorkflow;
  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("serviceWorkflow.repository")) FWHex.definePort("serviceWorkflow.repository", FWServiceWorkflowPort.methods);
    if (!FWHex.adapter("serviceWorkflow.repository")) FWHex.registerAdapter("serviceWorkflow.repository", FWServiceWorkflowRepository, { priority: 10 });
    Object.entries(FWServiceWorkflowUseCases).forEach(([key, fn]) => FWHex.registerUseCase("serviceWorkflow." + key, fn));
    FWHex.registerViewModel("serviceWorkflow.stages", FWServiceWorkflowViewModel.stages);
    return true;
  }
  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("service_workflow")) return true;
    FWPlatform.registerModule({
      id: "service_workflow", name: "Service Workflow", version: "0.1.0", layer: "feature", order: 60,
      description: "Owner-to-workshop service request lifecycle from complaint through invoice, payment, report, and feedback.",
      dependencies: ["maintenance", "garage_ops", "payments"], permissions: ["service.view", "service.manage"],
      tables: ["service_requests", "assessments", "estimates", "estimate_items", "invoices", "payments", "work_reports", "feedback"],
      capabilities: ["service_workflow.lifecycle"],
      init(ctx) { ctx.platform.registerCapability("service_workflow.lifecycle", ServiceWorkflow); },
    });
    return true;
  }
  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
