/* ============ FleetWorks — communications module ============ */
(function () {
  "use strict";

  function register() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("communications")) return true;
    FWPlatform.registerModule({
      id: "communications",
      name: "Communications",
      version: "0.1.0",
      layer: "feature",
      order: 65,
      description: "Consent-aware WhatsApp messaging, templates, delivery history, and driver communication.",
      dependencies: ["fleet_core", "team_access", "security"],
      permissions: ["communications.view", "communications.send", "communications.manage_consent"],
      tables: ["whatsapp_contacts", "whatsapp_messages", "whatsapp_templates"],
      edgeFunctions: ["whatsapp-send", "whatsapp-webhook"],
      navigation: [{ workspace: "ops", tab: "whatsapp", label: "WhatsApp", icon: "messageCircle" }],
      capabilities: ["communications.whatsapp", "communications.consent"],
      init(ctx) {
        ctx.platform.registerCapability("communications.whatsapp", { open: window.openWhatsApp });
      },
    });
    return true;
  }

  if (!register()) setTimeout(register, 0);
})();
