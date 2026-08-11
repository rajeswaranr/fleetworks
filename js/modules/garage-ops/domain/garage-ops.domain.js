/* ============ FleetWorks — garage-ops/domain ============ */
(function () {
  "use strict";
  const COMMISSION = 0.10;
  function iso(d) { return d.toISOString().slice(0, 10); }
  function fortnightOf(dateStr) {
    const d = new Date(dateStr), y = d.getFullYear(), m = d.getMonth();
    if (d.getDate() <= 15) return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m, 15)) };
    return { start: iso(new Date(y, m, 16)), end: iso(new Date(y, m + 1, 0)) };
  }
  function currentFortnight() { return fortnightOf(iso(new Date())); }
  function advanceJob(store, id, status, patch) {
    const job = (store.jobs || []).find(j => j.id === id);
    if (!job) return null;
    Object.assign(job, patch || {}, { status });
    return job;
  }
  function approveEstimate(store, id) {
    const job = (store.jobs || []).find(j => j.id === id);
    if (!job || !job.estimate) return null;
    job.estimate.status = "Approved"; job.status = "Approved"; return job;
  }
  function rejectEstimate(store, id) {
    const job = (store.jobs || []).find(j => j.id === id);
    if (!job || !job.estimate) return null;
    job.estimate.status = "Rejected"; job.status = "Planned"; return job;
  }
  function completeJob(store, id, amount) {
    const job = (store.jobs || []).find(j => j.id === id);
    if (!job) return null;
    const suggested = job.estimate ? job.estimate.total : 0;
    job.finalAmount = Number(amount || suggested || 0);
    job.status = "Completed"; job.completedAt = iso(new Date());
    return job;
  }
  function saveEstimate(store, jobId, items) {
    const job = (store.jobs || []).find(j => j.id === jobId);
    if (!job) return null;
    const clean = (items || []).filter(it => it.desc);
    if (!clean.length) return null;
    job.estimate = { items: clean, total: clean.reduce((s, it) => s + Number(it.qty || 1) * Number(it.rate || 0), 0), status: "Sent" };
    job.status = "Estimate Sent";
    return job;
  }
  function saveInspection(store, jobId, checkItems, formData) {
    const job = (store.jobs || []).find(j => j.id === jobId);
    if (!job) return null;
    job.inspection = {
      items: checkItems.map((item, i) => ({ item, ok: formData.get("gchk" + i) === "on" })),
      notes: (formData.get("notes") || "").trim(),
    };
    return job;
  }
  function saveStockItem(store, input, uidFn) {
    const fd = input || {};
    const existing = (store.stock || []).find(p => p.name.toLowerCase() === String(fd.name || "").trim().toLowerCase());
    if (existing) {
      existing.qty = +fd.qty; existing.minQty = +fd.minQty; if (fd.unitCost) existing.unitCost = +fd.unitCost;
      return { item: existing, updated: true };
    }
    const item = { id: uidFn(), name: fd.name.trim(), partNo: (fd.partNo || "").trim(), qty: +fd.qty, minQty: +fd.minQty, unitCost: fd.unitCost ? +fd.unitCost : null };
    store.stock.push(item);
    return { item, updated: false };
  }
  function saveProfile(store, input) {
    const fd = input || {};
    store.profile = { ...store.profile, name: fd.name.trim(), city: fd.city.trim(), phone: fd.phone.trim(), gstin: fd.gstin.trim().toUpperCase() };
    return store.profile;
  }
  function resolveComplaint(store, id) {
    const c = (store.complaints || []).find(x => x.id === id);
    if (c) c.status = "Resolved";
    return c || null;
  }
  function payoutSnapshot(store) {
    const fn = currentFortnight();
    const doneFn = (store.jobs || []).filter(j => j.completedAt && j.completedAt >= fn.start && j.completedAt <= fn.end);
    const gross = doneFn.reduce((s, j) => s + Number(j.finalAmount || 0), 0);
    return { period: fn, jobs: doneFn.length, gross, commission: Math.round(gross * COMMISSION), net: Math.round(gross * (1 - COMMISSION)) };
  }
  function ratingSnapshot(store) {
    const rated = (store.jobs || []).filter(j => j.rating);
    const avg = rated.length ? rated.reduce((s, j) => s + j.rating, 0) / rated.length : 0;
    return { rated: rated.length, avg, fiveStarPct: rated.length ? Math.round(rated.filter(j => j.rating === 5).length / rated.length * 100) : 0, openComplaints: (store.complaints || []).filter(c => c.status !== "Resolved").length };
  }
  window.FWGarageOpsDomain = window.FWGarageOpsDomain || {
    COMMISSION, fortnightOf, currentFortnight, advanceJob, approveEstimate, rejectEstimate, completeJob,
    saveEstimate, saveInspection, saveStockItem, saveProfile, resolveComplaint, payoutSnapshot, ratingSnapshot,
  };
})();
