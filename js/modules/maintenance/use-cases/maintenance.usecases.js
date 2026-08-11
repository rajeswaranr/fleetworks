/* ============ FleetWorks — maintenance/use-cases ============ */

(function () {
  "use strict";

  function repository() {
    if (window.FWHex && FWHex.adapter("maintenance.repository")) return FWHex.adapter("maintenance.repository");
    return window.FWMaintenanceRepository || null;
  }

  function requireRepository() {
    const repo = repository();
    if (!repo) throw new Error("Maintenance repository is not available.");
    return repo;
  }

  function register(name, fn) {
    if (window.FWHex) FWHex.registerUseCase(name, fn);
    return fn;
  }

  const useCases = {
    createIssue: register("maintenance.createIssue", async input => {
      const issue = FWMaintenanceDomain.normalizeIssue(input);
      if (!issue.vehicleId || !issue.title) throw new Error("Vehicle and issue title are required.");
      return requireRepository().createIssue(issue);
    }),

    resolveIssue: register("maintenance.resolveIssue", async input => {
      const resolvedAt = input.resolvedAt || FWMaintenanceDomain.today();
      return requireRepository().updateIssue(input.id, { status: "Resolved", resolvedAt });
    }),

    createWorkOrder: register("maintenance.createWorkOrder", async input => {
      const w = {
        issueId: input.issueId || "",
        vehicleId: input.vehicleId || "",
        title: String(input.title || "").trim(),
        vendor: String(input.vendor || "").trim() || undefined,
        estCost: input.estCost == null || input.estCost === "" ? null : Number(input.estCost),
        status: input.status || "Open",
        createdAt: input.createdAt || FWMaintenanceDomain.today(),
      };
      if (!w.vehicleId || !w.title) throw new Error("Vehicle and work-order title are required.");
      const saved = await requireRepository().createWorkOrder(w);
      if (saved && input.issueId) await requireRepository().updateIssue(input.issueId, { status: "In Progress" });
      return saved;
    }),

    createReminder: register("maintenance.createReminder", async input => {
      const reminder = FWMaintenanceDomain.normalizeReminder(input);
      if (!reminder.vehicleId || !reminder.task) throw new Error("Vehicle and reminder task are required.");
      return requireRepository().createReminder(reminder);
    }),

    completeReminder: register("maintenance.completeReminder", async input => {
      const lastDate = input.lastDate || FWMaintenanceDomain.today();
      return requireRepository().updateReminder(input.id, { lastDate });
    }),

    recordInspection: register("maintenance.recordInspection", async input => {
      const inspection = FWMaintenanceDomain.buildInspection(input);
      if (!inspection.vehicleId) throw new Error("Vehicle is required.");
      const repo = requireRepository();
      const savedInspection = await repo.createInspection(inspection);
      if (!savedInspection) return null;
      const faults = FWMaintenanceDomain.inspectionFaults(inspection);
      const savedFaults = [];
      for (const fault of faults) {
        const saved = await repo.createIssue(fault);
        if (saved) savedFaults.push(saved);
      }
      return { inspection: savedInspection, faults: savedFaults, passed: inspection.passed };
    }),

    savePart: register("maintenance.savePart", async input => {
      const part = FWMaintenanceDomain.normalizePart(input.part || input);
      if (!part.name) throw new Error("Part name is required.");
      const existing = input.existing || null;
      if (existing) {
        const patch = FWMaintenanceDomain.partRestockPatch(part);
        const ok = await requireRepository().updatePart(existing.id, patch);
        return ok ? { existing: true, patch } : null;
      }
      return requireRepository().createPart(part);
    }),

    createDocument: register("maintenance.createDocument", async input => {
      const document = FWMaintenanceDomain.normalizeDocument(input);
      if (!document.entityId) throw new Error("Choose an entity before attaching the document.");
      if (!document.docType) throw new Error("Document type is required.");
      return requireRepository().createDocument(document);
    }),

    createTyreReading: register("maintenance.createTyreReading", async input => {
      const reading = FWMaintenanceDomain.normalizeTyreReading(input);
      if (!reading.vehicleId || !reading.position) throw new Error("Vehicle and tyre position are required.");
      return requireRepository().createTyreReading(reading);
    }),
  };

  window.FWMaintenanceUseCases = window.FWMaintenanceUseCases || useCases;
})();
