/* ============ FleetWorks — modules/security ============
   Security foundation contract. Current hard enforcement remains Supabase
   RLS and Edge Functions; this module centralizes permission names and audit
   hooks for future API/BFF and plugin work. */

(function () {
  "use strict";

  const PERMISSIONS = {
    fleet: ["fleet.view", "fleet.manage"],
    drivers: ["drivers.view", "drivers.manage"],
    maps: ["maps.view", "maps.manage", "telemetry.read"],
    payments: ["payments.view", "payments.request", "payments.approve", "payments.gateway.manage"],
    llm: ["llm.ask", "llm.admin", "llm.audit"],
    telemetry: ["telemetry.read", "telemetry.ingest", "telemetry.manage_devices"],
    security: ["security.audit.read", "security.permissions.manage"],
  };

  function role() {
    const profile = window.fwCloud && fwCloud.profile ? fwCloud.profile() : {};
    return profile.fleetworks_role || profile.role || "owner";
  }

  const Security = {
    permissions: PERMISSIONS,
    role,
    hasPermission(permission) {
      // Client-side helper only. Server-side checks must remain in RLS/API.
      if (!permission) return false;
      const r = role();
      if (r === "owner" || r === "manager" || r === "admin") return true;
      return ["fleet.view", "drivers.view", "maps.view", "telemetry.read", "llm.ask"].includes(permission);
    },
    audit(action, details) {
      const event = {
        action,
        details: details || {},
        user: window.fwCloud && fwCloud.user ? fwCloud.user() : null,
        at: new Date().toISOString(),
        source: "web-client",
      };
      if (window.FWPlatform) FWPlatform.emit("security:audit", event);
      return event;
    },
  };

  window.FWSecurity = window.FWSecurity || Security;

  if (window.FWPlatform) {
    FWPlatform.registerModule({
      id: "security",
      name: "Security Foundation",
      version: "0.1.0",
      layer: "platform",
      order: 20,
      description: "Permission names, client audit hooks, and future security policy contract.",
      dependencies: [],
      permissions: PERMISSIONS.security,
      tables: ["audit_events", "security_policy_versions"],
      endpoints: ["/audit/events", "/security/permissions"],
      capabilities: ["security.permissions", "security.audit"],
      init(ctx) {
        ctx.platform.registerCapability("security.permissions", Security);
        ctx.platform.registerCapability("security.audit", { record: Security.audit });
      },
    });
  }
})();
