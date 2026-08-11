/* ============ FleetWorks — maintenance/adapters/legacy ============
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

  const repo = {
    name: "maintenance.legacyRepository",

    state() {
      const d = localDb();
      return {
        issues: d.issues || [],
        workOrders: d.workOrders || [],
        reminders: d.reminders || [],
        inspections: d.inspections || [],
        parts: d.parts || [],
        documents: d.documents || [],
        tyreReadings: d.tyreReadings || [],
      };
    },

    createIssue(issue) {
      return callOrLocal("dbCreateIssue", issue);
    },

    updateIssue(id, patch) {
      if (dbBacked() && typeof window.dbUpdateIssue === "function") return window.dbUpdateIssue(id, patch);
      return Promise.resolve(true);
    },

    createWorkOrder(workOrder) {
      return callOrLocal("dbCreateWorkOrder", workOrder);
    },

    updateWorkOrder(id, patch) {
      if (dbBacked() && typeof window.dbUpdateWorkOrder === "function") return window.dbUpdateWorkOrder(id, patch);
      return Promise.resolve(true);
    },

    createReminder(reminder) {
      return callOrLocal("dbCreateReminder", reminder);
    },

    updateReminder(id, patch) {
      if (dbBacked() && typeof window.dbUpdateReminder === "function") return window.dbUpdateReminder(id, patch);
      return Promise.resolve(true);
    },

    createInspection(inspection) {
      return callOrLocal("dbCreateInspection", inspection);
    },

    createPart(part) {
      return callOrLocal("dbCreatePart", part);
    },

    updatePart(id, patch) {
      if (dbBacked() && typeof window.dbUpdatePart === "function") return window.dbUpdatePart(id, patch);
      return Promise.resolve(true);
    },

    createDocument(document) {
      return callOrLocal("dbCreateDocument", document);
    },

    createTyreReading(reading) {
      return callOrLocal("dbCreateTyreReading", reading);
    },
  };

  window.FWMaintenanceRepository = window.FWMaintenanceRepository || repo;
  if (window.FWHex) FWHex.registerAdapter("maintenance.repository", repo, { priority: 10 });
})();
