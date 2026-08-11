/* ============ FleetWorks — driver-portal/adapters/legacy ============ */
(function () {
  "use strict";
  const repo = {
    name: "driverPortal.legacyRepository",
    async submitEntry(record) {
      const r = await fetch(FW_BACKEND.url + "/rest/v1/driver_entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": FW_BACKEND.anonKey, "Prefer": "return=minimal" },
        body: JSON.stringify(record),
      });
      if (!r.ok) throw new Error("Could not submit driver entry.");
      return true;
    },
  };
  window.FWDriverPortalRepository = window.FWDriverPortalRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("driverPortal.repository", repo, { priority: 10 });
})();
