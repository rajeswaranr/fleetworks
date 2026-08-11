/* ============ FleetWorks — fleet-fin/adapters/legacy ============
   Compatibility adapter over current dbcore.js helpers and local db arrays. */

(function () {
  "use strict";

  function localDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || {};
  }

  function dbBacked() {
    return typeof window.coreDbBacked === "function" ? window.coreDbBacked() :
      !!(window.fwCloud && fwCloud.user && fwCloud.user());
  }

  function makeId() {
    return typeof window.uid === "function" ? window.uid() : Math.random().toString(36).slice(2, 15);
  }

  async function callOrLocal(fnName, localRecord) {
    if (dbBacked() && typeof window[fnName] === "function") return window[fnName](localRecord);
    return { id: makeId(), ...localRecord };
  }

  function okUpdate(fnName, id, patch) {
    if (dbBacked() && typeof window[fnName] === "function") return window[fnName](id, patch);
    return Promise.resolve(true);
  }

  const repo = {
    name: "fleetFin.legacyRepository",

    state() {
      const d = localDb();
      return {
        expenses: d.expenses || [],
        fuelLogs: d.fuelLogs || [],
        trips: d.trips || [],
        driverLedger: d.driverLedger || [],
      };
    },

    createExpense(expense) {
      return callOrLocal("dbCreateExpense", expense);
    },

    updateExpense(id, patch) {
      return okUpdate("dbUpdateExpense", id, patch);
    },

    createFuelLog(fuelLog) {
      return callOrLocal("dbCreateFuelLog", fuelLog);
    },

    updateFuelLog(id, patch) {
      return okUpdate("dbUpdateFuelLog", id, patch);
    },

    createTrip(trip) {
      return callOrLocal("dbCreateTrip", trip);
    },

    updateTrip(id, patch) {
      return okUpdate("dbUpdateTrip", id, patch);
    },

    createLedgerEntry(entry) {
      return callOrLocal("dbCreateLedgerEntry", entry);
    },

    updateLedgerEntry(id, patch) {
      return okUpdate("dbUpdateLedgerEntry", id, patch);
    },
  };

  window.FWFleetFinRepository = window.FWFleetFinRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("fleetFin.repository", repo, { priority: 10 });
})();
