/* ============ FleetWorks — modules/llm-gateway ============
   LLM gateway contract. The current Copilot UI can keep using copilot.js;
   this module defines the future model-router / guardrail / logging boundary. */

(function () {
  "use strict";

  const LlmGateway = {
    providers: {
      ruleBased: { id: "rule_based", name: "Rule-based FleetWorks Copilot", serverSide: false },
      copilotEdge: { id: "copilot_edge", name: "Supabase Copilot Edge Function", serverSide: true },
      modelRouter: { id: "model_router", name: "Future LLM Gateway / Model Router", serverSide: true },
    },

    configured() {
      return !!(window.FW_BACKEND && FW_BACKEND.copilotUrl);
    },

    policy() {
      return {
        maxQuestionChars: 2000,
        maxFleetSummaryChars: 60000,
        requiresTenantContext: true,
        logUsage: "future-server-side",
        guardrails: "future-server-side",
      };
    },

    async ask(question, fleetSummary) {
      const url = (window.FW_BACKEND && FW_BACKEND.copilotUrl || "").replace(/\/$/, "");
      if (!url) throw new Error("LLM gateway is not configured.");
      const headers = { "Content-Type": "application/json" };
      if (window.FW_BACKEND && FW_BACKEND.anonKey) {
        headers.apikey = FW_BACKEND.anonKey;
        headers.Authorization = "Bearer " + FW_BACKEND.anonKey;
      }
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ question, fleet: fleetSummary || {} }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "LLM request failed.");
      return j.answer || "";
    },
  };

  window.FWLlmGateway = window.FWLlmGateway || LlmGateway;

  if (window.FWPlatform) {
    FWPlatform.registerModule({
      id: "llm_gateway",
      name: "LLM Gateway",
      version: "0.1.0",
      layer: "platform",
      order: 60,
      description: "Model routing, prompt versions, guardrails, usage logging, and Copilot extension contract.",
      dependencies: ["fleet_core", "security"],
      permissions: ["llm.ask", "llm.admin", "llm.audit"],
      endpoints: ["/llm/ask", "/llm/evals", "/llm/usage"],
      edgeFunctions: ["copilot"],
      capabilities: ["llm.gateway", "llm.provider.rule_based", "llm.provider.copilot_edge"],
      adapters: LlmGateway.providers,
      init(ctx) {
        ctx.platform.registerCapability("llm.gateway", LlmGateway);
        ctx.platform.registerCapability("llm.provider.rule_based", LlmGateway.providers.ruleBased);
        ctx.platform.registerCapability("llm.provider.copilot_edge", LlmGateway.providers.copilotEdge);
      },
    });
  }
})();
