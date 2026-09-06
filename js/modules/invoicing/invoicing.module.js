/* ============ FleetWorks — invoicing module ============ */
(function () {
  "use strict";

  function register() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("invoicing")) return true;
    FWPlatform.registerModule({
      id: "invoicing",
      name: "Invoicing",
      version: "0.1.0",
      layer: "feature",
      order: 35,
      description: "Parties, items, GST-aware sales invoices, invoice lines, and payment status.",
      dependencies: ["fleet_core", "fleet_fin"],
      permissions: ["invoices.view", "invoices.manage"],
      tables: ["parties", "items", "sales_invoices", "sales_invoice_lines"],
      navigation: [{ workspace: "fin", tab: "invoices", label: "Invoices", icon: "receipt" }],
      capabilities: ["invoicing.sales", "invoicing.tax"],
      init(ctx) {
        ctx.platform.registerCapability("invoicing.sales", { load: window.loadInvoices });
        ctx.platform.registerCapability("invoicing.tax", {
          calculate: window.invoiceTax,
          validateGstin: window.gstinProblem,
        });
      },
    });
    return true;
  }

  if (!register()) setTimeout(register, 0);
})();
