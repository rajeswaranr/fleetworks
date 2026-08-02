/* ============ FleetWorks — modules/index.js ============
   Boots registered platform modules after the legacy app has loaded. This
   keeps current behavior stable while allowing new modules to declare
   capabilities and lifecycle hooks. */

(function () {
  "use strict";

  function boot() {
    if (!window.FWPlatform || FWPlatform._bootRequested) return;
    FWPlatform._bootRequested = true;
    FWPlatform.boot().catch(err => {
      if (window.console) console.error("[FleetWorks Platform] Boot failed", err);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
})();
