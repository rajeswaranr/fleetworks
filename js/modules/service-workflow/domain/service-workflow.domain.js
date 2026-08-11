/* ============ FleetWorks — service-workflow/domain ============ */
(function () {
  "use strict";
  const STAGES = [
    { k: "raised", label: "Complaint Raised", actor: "Owner" },
    { k: "assigned", label: "Mechanic Identified", actor: "FleetWorks" },
    { k: "accepted", label: "Owner OK — Quote Asked", actor: "Owner" },
    { k: "reached", label: "Vehicle at Workshop", actor: "Owner" },
    { k: "assessed", label: "Assessment & Estimate", actor: "Mechanic" },
    { k: "approved", label: "Estimate Approved", actor: "Owner" },
    { k: "inprogress", label: "Work in Progress", actor: "Mechanic" },
    { k: "completed", label: "Work Completed", actor: "Mechanic" },
    { k: "invoiced", label: "Invoice Raised", actor: "FleetWorks" },
    { k: "paid", label: "Owner Paid", actor: "Owner" },
    { k: "reported", label: "Photos & Final Report", actor: "Mechanic" },
    { k: "closed", label: "Feedback — Vehicle Out", actor: "Owner" },
  ];
  const ENUM = ["raised", "assigned", "accepted", "reached", "assessed", "approved", "in_progress", "completed", "invoiced", "paid", "reported", "closed"];
  function now() { return new Date().toISOString(); }
  function uid() { return "sr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function raise(input) {
    const data = input || {};
    const mechanic = data.mechanic;
    const r = {
      id: data.id || uid(), vehicle: data.vehicle, issue: data.issue, severity: data.severity || "Medium", createdAt: now(), stage: 1,
      mechanic, owner: data.owner || {}, assessment: null, invoice: null, finalAmount: null, photos: [], postReport: null, feedback: null,
      events: [
        { stage: 0, at: now(), by: "Owner", note: "Complaint raised: " + data.issue },
        { stage: 1, at: now(), by: "FleetWorks", note: `Matched ${mechanic.name} (${mechanic.rating}★, ${mechanic.km} km away) — ${mechanic.shop}` },
      ],
    };
    return r;
  }
  function advance(requests, id, toIdx, by, note, patch) {
    const r = (requests || []).find(x => x.id === id);
    if (!r || toIdx !== r.stage + 1) return null;
    r.stage = toIdx;
    r.events.push({ stage: toIdx, at: now(), by, note: note || STAGES[toIdx].label });
    if (patch) Object.assign(r, patch);
    if (STAGES[toIdx].k === "completed") {
      const sub = r.finalAmount || (r.assessment && r.assessment.total) || 0;
      const gst = Math.round(sub * 0.18);
      r.invoice = { number: "FW-INV-" + String(1000 + requests.indexOf(r) + 1), subtotal: sub, gst, total: sub + gst, issuedAt: now() };
      r.stage = toIdx + 1;
      r.events.push({ stage: toIdx + 1, at: now(), by: "FleetWorks", note: "Invoice " + r.invoice.number + " raised — ₹" + Math.round(r.invoice.total).toLocaleString("en-IN") + " (incl. 18% GST)" });
    }
    return r;
  }
  function cloudRowToCard(input) {
    const row = input.row || {}, idx = Math.max(0, ENUM.indexOf(row.stage));
    const mechanic = input.mechanic, profile = input.profile || {};
    return {
      id: "sr" + String(row.id || "").replace(/-/g, "").slice(0, 10), cloudId: row.id,
      vehicle: row.vehicles && row.vehicles.name || row.vehicle_name || "Vehicle",
      issue: row.issue || "Service request", severity: row.severity || "Medium",
      createdAt: row.created_at || row.updated_at || now(), stage: idx, mechanic,
      owner: { name: profile.transport_name || profile.full_name || "FleetWorks owner", phone: profile.mobile || "" },
      assessment: null, invoice: null, finalAmount: null, photos: [], postReport: null, feedback: null,
      events: [
        { stage: 0, at: row.created_at || now(), by: "Owner", note: "Complaint raised: " + (row.issue || "Service request") },
        { stage: idx, at: row.updated_at || row.created_at || now(), by: "FleetWorks", note: "Synced from cloud — " + (row.stage || "raised") },
      ],
    };
  }
  window.FWServiceWorkflowDomain = window.FWServiceWorkflowDomain || { STAGES, ENUM, now, uid, raise, advance, cloudRowToCard };
})();
