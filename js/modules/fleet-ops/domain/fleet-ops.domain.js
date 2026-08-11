/* ============ FleetWorks — fleet-ops/domain ============
   Pure FleetOps calculations for overview, risks, priorities, renewals,
   reminders, tyres, and vehicle health. No DOM or Supabase access here. */

(function () {
  "use strict";

  const DEFAULT_DOC_LABELS = {
    insurance: "Insurance",
    puc: "PUC",
    fitness: "Fitness (FC)",
    permit: "Nat. Permit",
    roadtax: "Road Tax",
  };

  function daysUntil(dateStr, now) {
    return Math.round((new Date(dateStr) - (now || new Date())) / 86400000);
  }

  function median(values) {
    const a = (values || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function latestReadings(tyreReadings, vehicleId) {
    const map = {};
    (tyreReadings || []).filter(t => t.vehicleId === vehicleId)
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
      .forEach(t => { map[t.position] = t; });
    return map;
  }

  function reminderStatus(reminders, options) {
    const now = options && options.now || new Date();
    return (reminders || []).map(r => {
      const next = new Date(r.lastDate);
      next.setMonth(next.getMonth() + (+r.everyMonths || 3));
      const nextDate = next.toISOString().slice(0, 10);
      const days = daysUntil(nextDate, now);
      return { ...r, nextDate, overdue: days < 0, dueSoon: days >= 0 && days <= 14 };
    }).sort((a, b) => String(a.nextDate || "").localeCompare(String(b.nextDate || "")));
  }

  function prioritisedIssues(issues, vehicles, options) {
    const now = options && options.now || new Date();
    const sevW = { High: 3, Medium: 2, Low: 1 };
    return (issues || [])
      .filter(i => i.status !== "Resolved")
      .map(i => {
        const v = (vehicles || []).find(x => x.id === i.vehicleId) || { kmPerMonth: 5000 };
        const ageDays = Math.max((now - new Date(i.createdAt)) / 86400000, 0);
        const score = (sevW[i.severity] || 1) * 2 + Math.min(ageDays / 7, 3) + (+v.kmPerMonth || 0) / 10000;
        return { ...i, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((i, idx) => ({ ...i, rank: "P" + Math.min(idx + 1 <= 2 ? 1 : idx + 1 <= 5 ? 2 : 3, 3) }));
  }

  function vehicleName(state, vehicleId) {
    const v = (state.vehicles || []).find(x => x.id === vehicleId);
    return v ? v.name : "—";
  }

  function radarItems(state, options) {
    const now = options && options.now || new Date();
    const items = [];
    const push = (cat, entity, type, date) => { if (date) items.push({ cat, entity, type, date, days: daysUntil(date, now) }); };
    (state.vehicles || []).forEach(v => {
      const c = v.compliance || {};
      push("vehicle", v.name, "Insurance", c.insurance);
      push("vehicle", v.name, "PUC", c.puc);
      push("vehicle", v.name, "Fitness (FC)", c.fitness);
      push("vehicle", v.name, "National Permit", c.permit);
      push("vehicle", v.name, "Road Tax", c.roadtax);
    });
    (state.documents || []).forEach(d => {
      const name = d.entityType === "driver"
        ? ((state.drivers || []).find(x => x.id === d.entityId) || {}).name
        : ((state.vehicles || []).find(x => x.id === d.entityId) || {}).name;
      push(d.entityType, name || "—", d.docType, d.expiryDate);
    });
    (state.drivers || []).forEach(dr => push("driver", dr.name, "Driving Licence", dr.dlExpiry));
    (state.parts || []).forEach(p => push("warranty", p.name, "Warranty", p.warrantyExpiry));
    reminderStatus(state.reminders || [], { now }).forEach(r => push("maintenance", vehicleName(state, r.vehicleId), r.task, r.nextDate));
    return items.sort((a, b) => a.days - b.days);
  }

  function healthScore(vehicle, state, options) {
    const opts = options || {};
    const now = opts.now || new Date();
    const docLabels = opts.docLabels || DEFAULT_DOC_LABELS;
    const warnDays = Number(opts.warnDays || 30);
    const minTread = Number(opts.minTread || 1.6);
    let score = 100;

    const c = vehicle.compliance || {};
    Object.keys(docLabels).forEach(k => {
      if (!c[k]) return;
      const d = daysUntil(c[k], now);
      if (d < 0) score -= 12;
      else if (d <= warnDays) score -= 4;
    });

    let issuePenalty = 0;
    (state.issues || []).filter(i => i.vehicleId === vehicle.id && i.status !== "Resolved")
      .forEach(i => { issuePenalty += i.severity === "High" ? 12 : i.severity === "Medium" ? 6 : 3; });
    score -= Math.min(issuePenalty, 30);

    const inspections = (state.inspections || [])
      .filter(i => i.vehicleId === vehicle.id)
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    if (inspections.length && !inspections[inspections.length - 1].passed) score -= 10;

    const worn = Object.values(latestReadings(state.tyreReadings || [], vehicle.id)).filter(r => r.treadDepth <= minTread).length;
    score -= Math.min(worn * 6, 12);
    score -= Math.min(reminderStatus(state.reminders || [], { now }).filter(r => r.vehicleId === vehicle.id && r.overdue).length * 5, 10);

    const vehicleStats = opts.vehicleStats || [];
    const comparable = vehicleStats.filter(x => x.costPerKm > 0);
    const avg = comparable.length ? comparable.reduce((a, b) => a + b.costPerKm, 0) / comparable.length : 0;
    const mine = comparable.find(x => x.id === vehicle.id);
    if (mine && avg) {
      const dev = (mine.costPerKm - avg) / avg;
      if (dev > 0.4) score -= 15;
      else if (dev > 0.2) score -= 10;
    }

    const predictions = opts.predictions || [];
    score -= Math.min(predictions.filter(p => p.vehicle && p.vehicle.id === vehicle.id && p.lifeUsed >= 1).length * 8, 16);
    return Math.max(5, Math.round(score));
  }

  function computeInsights(state, options) {
    const opts = options || {};
    const now = opts.now || new Date();
    const docLabels = opts.docLabels || DEFAULT_DOC_LABELS;
    const warnDays = Number(opts.warnDays || 30);
    const minTread = Number(opts.minTread || 1.6);
    const fmtDate = opts.fmtDate || (date => String(date || ""));
    const fmtINR = opts.fmtINR || (amount => "Rs " + Number(amount || 0));
    const vName = opts.vName || (id => vehicleName(state, id));
    const mileagePoints = opts.mileagePoints || (() => []);
    const out = [];

    (state.vehicles || []).forEach(v => {
      Object.entries(v.compliance || {}).forEach(([doc, till]) => {
        if (!till) return;
        const d = daysUntil(till, now);
        if (d < 0) out.push({ sev: 4, icon: "document", tag: "Compliance", title: `${v.name}: ${docLabels[doc]} EXPIRED`, detail: `Expired ${-d} days ago (${fmtDate(till)}). Vehicle is non-compliant — renew immediately to avoid penalties.` });
        else if (d <= warnDays) out.push({ sev: 3, icon: "document", tag: "Compliance", title: `${v.name}: ${docLabels[doc]} expires in ${d} days`, detail: `Valid till ${fmtDate(till)}. Renew before expiry to keep the vehicle on the road.` });
      });
    });

    const byCat = {};
    (state.expenses || []).forEach(e => { (byCat[e.category] = byCat[e.category] || []).push(e.amount); });
    (state.expenses || []).slice(-60).forEach(e => {
      const med = median(byCat[e.category] || []);
      if ((byCat[e.category] || []).length >= 4 && e.amount > med * 1.8) {
        out.push({ sev: 2, icon: "receipt", tag: "Review flagged", title: `${vName(e.vehicleId)}: ${e.category} bill ${fmtINR(e.amount)} looks high`, detail: `Your typical ${e.category} spend is ${fmtINR(med)}. Worth confirming the itemised bill (${fmtDate(e.date)}).` });
      }
    });

    const sorted = (state.expenses || []).slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      if (a.vehicleId === b.vehicleId && a.category === b.category &&
        Math.abs(new Date(b.date) - new Date(a.date)) <= 7 * 86400000 && a.category !== "Other" && a.category !== "Engine Oil & Filters") {
        out.push({ sev: 2, icon: "eye", tag: "Review flagged", title: `${vName(a.vehicleId)}: two ${a.category} charges within a week`, detail: `${fmtINR(a.amount)} on ${fmtDate(a.date)} and ${fmtINR(b.amount)} on ${fmtDate(b.date)}. Confirm the second is not a duplicate billing.` });
      }
    }

    (state.vehicles || []).forEach(v => {
      const pts = mileagePoints(v.id) || [];
      if (pts.length >= 4) {
        const base = median(pts.slice(0, -1).map(p => p.kmpl));
        const last = pts[pts.length - 1].kmpl;
        if (last < base * 0.85) {
          out.push({ sev: 3, icon: "fuel", tag: "Fuel anomaly", title: `${v.name}: mileage dropped to ${last.toFixed(1)} km/l`, detail: `Usual is ~${base.toFixed(1)} km/l. Check tyre pressure, air filter, injectors — or possible fuel pilferage.` });
        }
      }
    });

    reminderStatus(state.reminders || [], { now }).forEach(r => {
      if (r.overdue) out.push({ sev: 3, icon: "calendarClock", tag: "Maintenance", title: `${vName(r.vehicleId)}: ${r.task} overdue`, detail: `Was due ${fmtDate(r.nextDate)}. Book it before it becomes a breakdown.` });
    });

    (state.issues || []).filter(i => i.status !== "Resolved" && i.severity === "High").forEach(i => {
      out.push({ sev: 4, icon: "alert", tag: "Issue", title: `${vName(i.vehicleId)}: ${i.title}`, detail: `High-severity issue open since ${fmtDate(i.createdAt)}. Top of the AI priority list.` });
    });

    (state.parts || []).filter(p => p.qty <= p.minQty).forEach(p => {
      out.push({ sev: 1, icon: "boxes", tag: "Godown", title: `Low stock: ${p.name}`, detail: `${p.qty} left (alert level ${p.minQty}). Reorder to avoid workshop delays.` });
    });

    (state.parts || []).forEach(p => {
      if (!p.warrantyExpiry) return;
      const d = daysUntil(p.warrantyExpiry, now);
      if (d < 0) out.push({ sev: 2, icon: "shieldCheck", tag: "Warranty", title: `${p.name}: warranty expired`, detail: `Expired ${-d} days ago${p.vendor ? " · " + p.vendor : ""}. Any pending claims should be raised before replacement.` });
      else if (d <= 30) out.push({ sev: 1, icon: "shieldCheck", tag: "Warranty", title: `${p.name}: warranty expires in ${d} days`, detail: `${p.vendor ? "Vendor: " + p.vendor + ". " : ""}Raise any known defects with the vendor before it lapses.` });
    });

    (state.vehicles || []).forEach(v => {
      const worn = Object.values(latestReadings(state.tyreReadings || [], v.id)).filter(r => r.treadDepth <= minTread);
      if (worn.length) out.push({ sev: 3, icon: "tire", tag: "Tyre health", title: `${v.name}: ${worn.length} tyre(s) worn to ${minTread}mm or below`, detail: `${worn.map(r => r.position).join(", ")} need replacement. Bald tyres fail fitness checks and risk blowouts on highway runs.` });
    });

    (state.drivers || []).forEach(dr => {
      if (!dr.dlExpiry) return;
      const d = daysUntil(dr.dlExpiry, now);
      if (d < 0) out.push({ sev: 4, icon: "driver", tag: "Driver DL", title: `${dr.name}: driving licence EXPIRED`, detail: `Expired ${-d} days ago. Driving without a valid DL risks challans and voids insurance claims.` });
      else if (d <= 30) out.push({ sev: 3, icon: "driver", tag: "Driver DL", title: `${dr.name}: DL expires in ${d} days`, detail: `Valid till ${fmtDate(dr.dlExpiry)}. Start the renewal at the Parivahan portal now.` });
    });

    const warrantyCats = ["Battery", "Tyres", "Clutch", "Suspension"];
    (state.vehicles || []).forEach(v => {
      warrantyCats.forEach(cat => {
        const h = (state.expenses || []).filter(e => e.vehicleId === v.id && e.category === cat).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
        for (let i = 1; i < h.length; i++) {
          const gapM = (new Date(h[i].date) - new Date(h[i - 1].date)) / (30.44 * 86400000);
          if (gapM < 12 && daysUntil(h[i].date, now) > -90) {
            out.push({ sev: 2, icon: "shieldCheck", tag: "Warranty", title: `${v.name}: ${cat} replaced twice in ${Math.round(gapM)} months`, detail: `${fmtINR(h[i].amount)} on ${fmtDate(h[i].date)} may be claimable under the brand warranty from the ${fmtDate(h[i - 1].date)} purchase. Check the bill.` });
          }
        }
      });
    });

    (state.workOrders || []).filter(w => w.status !== "Completed").forEach(w => {
      const age = Math.round((now - new Date(w.createdAt)) / 86400000);
      if (age > 5) out.push({ sev: 2, icon: "wrench", tag: "Job card", title: `${vName(w.vehicleId)}: job card open ${age} days`, detail: `"${w.title}" at ${w.vendor || "workshop"} since ${fmtDate(w.createdAt)}. Follow up — every idle day is lost revenue.` });
    });

    if (!out.length) out.push({ sev: 0, icon: "checkCircle", tag: "All clear", title: "No risks detected", detail: "Compliance, spending, mileage and maintenance all look healthy. The AI keeps watching." });
    return out.sort((a, b) => b.sev - a.sev);
  }

  window.FWFleetOpsDomain = window.FWFleetOpsDomain || {
    DEFAULT_DOC_LABELS,
    daysUntil,
    median,
    latestReadings,
    reminderStatus,
    prioritisedIssues,
    radarItems,
    healthScore,
    computeInsights,
  };
})();
