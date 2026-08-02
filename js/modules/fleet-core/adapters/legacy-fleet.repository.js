/* ============ FleetWorks — fleet-core/adapters ============
   Adapter around the current browser-global db/FWApi state. This is the
   compatibility bridge that lets new hexagonal code coexist with fleet.js. */

(function () {
  "use strict";

  function localDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || {};
  }

  function vehicles() {
    if (window.FWApi) return FWApi.domains.fleet.vehicles();
    const d = localDb();
    return Array.isArray(d.vehicles) ? d.vehicles : [];
  }

  function drivers() {
    if (window.FWApi) return FWApi.domains.fleet.drivers();
    const d = localDb();
    return Array.isArray(d.drivers) ? d.drivers : [];
  }

  const repo = {
    name: "fleetCore.legacyRepository",
    listVehicles() {
      return vehicles().map(FWFleetCoreDomain.normalizeVehicle);
    },
    listDrivers() {
      return drivers().map(FWFleetCoreDomain.normalizeDriver);
    },
    listAssignments() {
      const allDrivers = repo.listDrivers();
      return repo.listVehicles().map(vehicle => FWFleetCoreDomain.assignment(vehicle, allDrivers));
    },
    getVehicleById(id) {
      return repo.listVehicles().find(v => v.id === id || v.dbId === id) || null;
    },
    getDriverById(id) {
      return repo.listDrivers().find(d => d.id === id || d.dbId === id) || null;
    },
    summary() {
      return FWFleetCoreDomain.summary({ vehicles: repo.listVehicles(), drivers: repo.listDrivers() });
    },
  };

  window.FWFleetCoreRepository = window.FWFleetCoreRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("fleetCore.repository", repo, { priority: 10 });
})();
