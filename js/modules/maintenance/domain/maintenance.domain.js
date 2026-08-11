/* ============ FleetWorks — maintenance/domain ============
   Pure maintenance helpers: issues, inspections, reminders, documents,
   parts and tyre readings. No DOM, fetch, Supabase, or localStorage here. */

(function () {
  "use strict";

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeIssue(input) {
    const i = input || {};
    return {
      ...(i.id ? { id: i.id } : {}),
      vehicleId: i.vehicleId || "",
      title: String(i.title || "").trim(),
      severity: i.severity || "Medium",
      status: i.status || "Open",
      createdAt: i.createdAt || today(),
      source: i.source || "Manual",
    };
  }

  function normalizeReminder(input) {
    const r = input || {};
    return {
      ...(r.id ? { id: r.id } : {}),
      vehicleId: r.vehicleId || "",
      task: String(r.task || "").trim(),
      everyMonths: Number(r.everyMonths || 3),
      lastDate: r.lastDate || today(),
    };
  }

  function normalizeDocument(input) {
    const d = input || {};
    return {
      ...(d.id ? { id: d.id } : {}),
      entityType: d.entityType || "vehicle",
      entityId: d.entityId || "",
      docType: d.docType || "",
      number: String(d.number || "").trim(),
      issueDate: d.issueDate || null,
      expiryDate: d.expiryDate || null,
      note: String(d.note || "").trim(),
    };
  }

  function normalizeTyreReading(input) {
    const t = input || {};
    return {
      ...(t.id ? { id: t.id } : {}),
      vehicleId: t.vehicleId || "",
      position: t.position || "",
      treadDepth: Number(t.treadDepth || 0),
      pressure: t.pressure == null || t.pressure === "" ? null : Number(t.pressure),
      odo: t.odo == null || t.odo === "" ? null : Number(t.odo),
      date: t.date || today(),
    };
  }

  function normalizePart(input) {
    const p = input || {};
    return {
      ...(p.id ? { id: p.id } : {}),
      name: String(p.name || "").trim(),
      partNumber: String(p.partNumber || "").trim(),
      make: String(p.make || "").trim(),
      category: p.category || "",
      sourcing: p.sourcing || "",
      vendor: String(p.vendor || "").trim(),
      vendorContact: p.vendorContact || "",
      unitCost: p.unitCost ? Number(p.unitCost) : null,
      qty: Number(p.qty || 0),
      minQty: Number(p.minQty || 0),
      location: String(p.location || "").trim(),
      purchaseDate: p.purchaseDate || null,
      warrantyExpiry: p.warrantyExpiry || null,
    };
  }

  function buildInspection(input) {
    const ins = input || {};
    const results = Array.isArray(ins.results) ? ins.results : [];
    return {
      vehicleId: ins.vehicleId || "",
      date: ins.date || today(),
      passed: results.every(r => r.ok),
      results,
      odo: ins.odo || undefined,
      notes: ins.notes || undefined,
    };
  }

  function inspectionFaults(inspection) {
    return (inspection.results || []).filter(r => !r.ok).map(r => normalizeIssue({
      vehicleId: inspection.vehicleId,
      title: r.item + " — inspection fault",
      severity: String(r.item || "").includes("Brake") || String(r.item || "").includes("Tyre") ? "High" : "Medium",
      status: "Open",
      createdAt: inspection.date || today(),
      source: "Inspection",
    }));
  }

  function partRestockPatch(partData) {
    const patch = {};
    Object.entries(normalizePart(partData)).forEach(([key, value]) => {
      if (key === "qty" || key === "minQty" || key === "name") patch[key] = value;
      else if (value !== "" && value !== null) patch[key] = value;
    });
    return patch;
  }

  window.FWMaintenanceDomain = window.FWMaintenanceDomain || {
    today,
    normalizeIssue,
    normalizeReminder,
    normalizeDocument,
    normalizeTyreReading,
    normalizePart,
    buildInspection,
    inspectionFaults,
    partRestockPatch,
  };
})();
