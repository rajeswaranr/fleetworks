/* ============ FleetWorks — modules/fleet-core ============
   Core domain contract for vehicles, drivers, assignments, and tenant fleet
   state. Existing CRUD still lives in fleet.js/dbcore.js; this module gives
   future web/mobile/API work a stable platform boundary. */

(function () {
  "use strict";

  function localDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || {};
  }

  const FleetCore = {
    vehicles() { return Array.isArray(localDb().vehicles) ? localDb().vehicles : []; },
    drivers() { return Array.isArray(localDb().drivers) ? localDb().drivers : []; },
    vehicleById(id) { return FleetCore.vehicles().find(v => v.id === id || v.dbId === id) || null; },
    driverById(id) { return FleetCore.drivers().find(d => d.id === id || d.dbId === id) || null; },
    assignments() {
      return FleetCore.vehicles().map(vehicle => ({
        vehicle,
        driver: FleetCore.drivers().find(driver => driver.vehicleId === vehicle.id) || null,
      }));
    },
    signedIn() { return !!(window.fwCloud && fwCloud.user && fwCloud.user()); },
  };

  window.FWFleetCore = window.FWFleetCore || FleetCore;

  if (window.FWPlatform) {
    FWPlatform.registerModule({
      id: "fleet_core",
      name: "Fleet Core",
      version: "0.1.0",
      layer: "domain",
      order: 10,
      description: "Core vehicle, driver, assignment, and tenant fleet contract.",
      dependencies: [],
      permissions: ["fleet.view", "fleet.manage", "drivers.view", "drivers.manage"],
      tables: ["organizations", "memberships", "vehicles", "drivers", "vehicle_assignments"],
      capabilities: ["fleet.core", "fleet.assignments"],
      init(ctx) {
        ctx.platform.registerCapability("fleet.core", FleetCore);
        ctx.platform.registerCapability("fleet.assignments", { list: FleetCore.assignments });
      },
    });
  }
})();
