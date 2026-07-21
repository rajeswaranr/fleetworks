/* ============ FleetWorks — fleet.js ============
   Fleet Manager: RTO compliance, fuel & mileage, digital inspections,
   AI-prioritised issues, PM reminders, parts inventory, and the
   Smart Assessments insights feed. Shares the "ff_fleet" localStorage
   store with the AI Dashboard. */

"use strict";

// ---------- Store ----------
const STORE_KEY = "ff_fleet";
function loadStore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      vehicles: d.vehicles || [], expenses: d.expenses || [],
      fuelLogs: d.fuelLogs || [], inspections: d.inspections || [],
      issues: d.issues || [], reminders: d.reminders || [],
      parts: d.parts || [], drivers: d.drivers || [],
      workOrders: d.workOrders || [], demo: !!d.demo
    };
  } catch { return { vehicles: [], expenses: [], fuelLogs: [], inspections: [], issues: [], reminders: [], parts: [], drivers: [], workOrders: [], demo: false }; }
}
function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(db));
  if (window.fwCloud) window.fwCloud.push(db);
}
let db = loadStore();

// ---------- Utils ----------
const PAL = {
  s1: "#2a78d6", s2: "#1baf7a", s3: "#eda100",
  good: "#0ca30c", warn: "#fab219", serious: "#ec835a", critical: "#d03b3b",
  ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", baseline: "#c3c2b7"
};
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmtINR(v) {
  if (v >= 10000000) return "₹" + (v / 10000000).toFixed(1) + "Cr";
  if (v >= 100000) return "₹" + (v / 100000).toFixed(1) + "L";
  if (v >= 1000) return "₹" + (v / 1000).toFixed(1) + "K";
  return "₹" + Math.round(v);
}
function fmtDate(d) { return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
function daysUntil(dateStr) { return Math.round((new Date(dateStr) - new Date()) / 86400000); }
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function vName(id) { const v = db.vehicles.find(x => x.id === id); return v ? v.name : "Unknown"; }
function uid() { return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const DOC_LABELS = { insurance: "Insurance", puc: "PUC", fitness: "Fitness (FC)", permit: "Nat. Permit", roadtax: "Road Tax" };
const EXPECTED_KMPL = { "Truck (HCV)": 4.0, "LCV": 8.5, "Bus": 4.5, "Tipper": 3.2, "Trailer": 3.6, "Tanker": 3.8 };

const INSPECTION_ITEMS = [
  "Tyres & pressure", "Brakes & air system", "Lights & indicators", "Horn",
  "Engine oil leak check", "Coolant level", "Battery & terminals",
  "Documents in cabin (RC/Ins/PUC)", "Load body & tarpaulin", "Cabin & seat belts"
];

// ---------- Fuel maths ----------
function vehicleFills(vid) {
  return db.fuelLogs.filter(f => f.vehicleId === vid).sort((a, b) => a.odo - b.odo);
}
function mileagePoints(vid) {
  const fills = vehicleFills(vid);
  const pts = [];
  for (let i = 1; i < fills.length; i++) {
    const dist = fills[i].odo - fills[i - 1].odo;
    if (dist > 0 && fills[i].litres > 0) {
      pts.push({ date: fills[i].date, kmpl: dist / fills[i].litres, dist, cost: fills[i].amount });
    }
  }
  return pts;
}

// ---------- AI: Smart Assessments (insights feed) ----------
function computeInsights() {
  const out = [];
  const now = new Date();

  // 1. RTO compliance
  db.vehicles.forEach(v => {
    Object.entries(v.compliance || {}).forEach(([doc, till]) => {
      if (!till) return;
      const d = daysUntil(till);
      if (d < 0) out.push({ sev: 4, icon: "🔴", tag: "Compliance", title: `${v.name}: ${DOC_LABELS[doc]} EXPIRED`, detail: `Expired ${-d} days ago (${fmtDate(till)}). Vehicle is non-compliant — renew immediately to avoid penalties.` });
      else if (d <= 30) out.push({ sev: 3, icon: "🟠", tag: "Compliance", title: `${v.name}: ${DOC_LABELS[doc]} expires in ${d} days`, detail: `Valid till ${fmtDate(till)}. Renew before expiry to keep the vehicle on the road.` });
    });
  });

  // 2. Expense anomalies (Smart Assessment: cost spikes vs category median)
  const byCat = {};
  db.expenses.forEach(e => { (byCat[e.category] = byCat[e.category] || []).push(e.amount); });
  db.expenses.slice(-60).forEach(e => {
    const med = median(byCat[e.category]);
    if (byCat[e.category].length >= 4 && e.amount > med * 1.8) {
      out.push({ sev: 2, icon: "🧾", tag: "Review flagged", title: `${vName(e.vehicleId)}: ${e.category} bill ${fmtINR(e.amount)} looks high`, detail: `Your typical ${e.category} spend is ${fmtINR(med)}. Worth confirming the itemised bill (${fmtDate(e.date)}).` });
    }
  });

  // 3. Possible duplicate charges (same vehicle + category within 7 days)
  const sorted = [...db.expenses].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (a.vehicleId === b.vehicleId && a.category === b.category &&
        Math.abs(new Date(b.date) - new Date(a.date)) <= 7 * 86400000 && a.category !== "Other" && a.category !== "Engine Oil & Filters") {
      out.push({ sev: 2, icon: "👀", tag: "Review flagged", title: `${vName(a.vehicleId)}: two ${a.category} charges within a week`, detail: `${fmtINR(a.amount)} on ${fmtDate(a.date)} and ${fmtINR(b.amount)} on ${fmtDate(b.date)}. Confirm the second is not a duplicate billing.` });
    }
  }

  // 4. Mileage drop
  db.vehicles.forEach(v => {
    const pts = mileagePoints(v.id);
    if (pts.length >= 4) {
      const base = median(pts.slice(0, -1).map(p => p.kmpl));
      const last = pts[pts.length - 1].kmpl;
      if (last < base * 0.85) {
        out.push({ sev: 3, icon: "⛽", tag: "Fuel anomaly", title: `${v.name}: mileage dropped to ${last.toFixed(1)} km/l`, detail: `Usual is ~${base.toFixed(1)} km/l. Check tyre pressure, air filter, injectors — or possible fuel pilferage.` });
      }
    }
  });

  // 5. Overdue PM reminders
  reminderStatus().forEach(r => {
    if (r.overdue) out.push({ sev: 3, icon: "🗓️", tag: "Maintenance", title: `${vName(r.vehicleId)}: ${r.task} overdue`, detail: `Was due ${fmtDate(r.nextDate)}. Book it before it becomes a breakdown.` });
  });

  // 6. Open high-severity issues
  db.issues.filter(i => i.status !== "Resolved" && i.severity === "High").forEach(i => {
    out.push({ sev: 4, icon: "⚠️", tag: "Issue", title: `${vName(i.vehicleId)}: ${i.title}`, detail: `High-severity issue open since ${fmtDate(i.createdAt)}. Top of the AI priority list.` });
  });

  // 7. Low parts stock
  db.parts.filter(p => p.qty <= p.minQty).forEach(p => {
    out.push({ sev: 1, icon: "🔩", tag: "Godown", title: `Low stock: ${p.name}`, detail: `${p.qty} left (alert level ${p.minQty}). Reorder to avoid workshop delays.` });
  });

  // 7b. Part warranty expiring
  db.parts.forEach(p => {
    if (!p.warrantyExpiry) return;
    const d = daysUntil(p.warrantyExpiry);
    if (d < 0) out.push({ sev: 2, icon: "🛡️", tag: "Warranty", title: `${p.name}: warranty expired`, detail: `Expired ${-d} days ago${p.vendor ? " · " + p.vendor : ""}. Any pending claims should be raised before replacement.` });
    else if (d <= 30) out.push({ sev: 1, icon: "🛡️", tag: "Warranty", title: `${p.name}: warranty expires in ${d} days`, detail: `${p.vendor ? "Vendor: " + p.vendor + ". " : ""}Raise any known defects with the vendor before it lapses.` });
  });

  // 8. Driver licence expiry
  db.drivers.forEach(dr => {
    if (!dr.dlExpiry) return;
    const d = daysUntil(dr.dlExpiry);
    if (d < 0) out.push({ sev: 4, icon: "🪪", tag: "Driver DL", title: `${dr.name}: driving licence EXPIRED`, detail: `Expired ${-d} days ago. Driving without a valid DL risks challans and voids insurance claims.` });
    else if (d <= 30) out.push({ sev: 3, icon: "🪪", tag: "Driver DL", title: `${dr.name}: DL expires in ${d} days`, detail: `Valid till ${fmtDate(dr.dlExpiry)}. Start the renewal at Parivahan Sarathi portal now.` });
  });

  // 9. Possible warranty claims (same part failing again within 12 months)
  const warrantyCats = ["Battery", "Tyres", "Clutch", "Suspension"];
  db.vehicles.forEach(v => {
    warrantyCats.forEach(cat => {
      const h = db.expenses.filter(e => e.vehicleId === v.id && e.category === cat).sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < h.length; i++) {
        const gapM = (new Date(h[i].date) - new Date(h[i - 1].date)) / (30.44 * 86400000);
        if (gapM < 12 && daysUntil(h[i].date) > -90) {
          out.push({ sev: 2, icon: "🛡️", tag: "Warranty", title: `${v.name}: ${cat} replaced twice in ${Math.round(gapM)} months`, detail: `${fmtINR(h[i].amount)} on ${fmtDate(h[i].date)} may be claimable under the brand warranty from the ${fmtDate(h[i - 1].date)} purchase. Check the bill.` });
        }
      }
    });
  });

  // 10. Job cards pending too long
  db.workOrders.filter(w => w.status !== "Completed").forEach(w => {
    const age = Math.round((now - new Date(w.createdAt)) / 86400000);
    if (age > 5) out.push({ sev: 2, icon: "🔧", tag: "Job card", title: `${vName(w.vehicleId)}: job card open ${age} days`, detail: `"${w.title}" at ${w.vendor || "workshop"} since ${fmtDate(w.createdAt)}. Follow up — every idle day is lost revenue.` });
  });

  // 8. All-clear
  if (!out.length) out.push({ sev: 0, icon: "✅", tag: "All clear", title: "No risks detected", detail: "Compliance, spending, mileage and maintenance all look healthy. The AI keeps watching." });

  return out.sort((a, b) => b.sev - a.sev);
}

// ---------- AI: issue priority (Smart Priorities) ----------
function prioritisedIssues() {
  const sevW = { High: 3, Medium: 2, Low: 1 };
  return db.issues
    .filter(i => i.status !== "Resolved")
    .map(i => {
      const v = db.vehicles.find(x => x.id === i.vehicleId) || { kmPerMonth: 5000 };
      const ageDays = Math.max((new Date() - new Date(i.createdAt)) / 86400000, 0);
      const score = sevW[i.severity] * 2 + Math.min(ageDays / 7, 3) + v.kmPerMonth / 10000;
      return { ...i, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((i, idx) => ({ ...i, rank: "P" + Math.min(idx + 1 <= 2 ? 1 : idx + 1 <= 5 ? 2 : 3, 3) }));
}

// ---------- PM reminder status ----------
function reminderStatus() {
  return db.reminders.map(r => {
    const next = new Date(r.lastDate);
    next.setMonth(next.getMonth() + (+r.everyMonths || 3));
    const nextDate = next.toISOString().slice(0, 10);
    return { ...r, nextDate, overdue: daysUntil(nextDate) < 0, dueSoon: daysUntil(nextDate) >= 0 && daysUntil(nextDate) <= 14 };
  }).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

// ---------- Render: overview ----------
function renderOverview() {
  const openIssues = db.issues.filter(i => i.status !== "Resolved").length;
  const expiring = db.vehicles.reduce((n, v) => n + Object.values(v.compliance || {}).filter(t => t && daysUntil(t) <= 30).length, 0);
  const fuelSpend = db.fuelLogs.reduce((s, f) => s + f.amount, 0);
  const insights = computeInsights();
  const critical = insights.filter(i => i.sev >= 3).length;

  document.getElementById("fleetStats").innerHTML = `
    <div class="stat-tile"><span class="stat-label">AI alerts needing action</span><span class="stat-value" style="color:${critical ? PAL.critical : PAL.good}">${critical}</span><span class="stat-sub">${insights.length} total insights</span></div>
    <div class="stat-tile"><span class="stat-label">Open issues</span><span class="stat-value">${openIssues}</span><span class="stat-sub">AI prioritised</span></div>
    <div class="stat-tile"><span class="stat-label">Docs expiring ≤ 30 days</span><span class="stat-value">${expiring}</span><span class="stat-sub">Insurance · PUC · FC · Permit · Tax</span></div>
    <div class="stat-tile"><span class="stat-label">Fuel spend (logged)</span><span class="stat-value">${fmtINR(fuelSpend)}</span><span class="stat-sub">${db.fuelLogs.length} fills</span></div>`;

  const sevColor = s => s >= 4 ? PAL.critical : s === 3 ? PAL.serious : s === 2 ? PAL.warn : s === 1 ? PAL.s1 : PAL.good;
  document.getElementById("insightsFeed").innerHTML = insights.map(i => `
    <div class="insight-row" style="border-left-color:${sevColor(i.sev)}">
      <span class="insight-icon">${i.icon}</span>
      <div>
        <div class="insight-title">${esc(i.title)} <span class="insight-tag">${esc(i.tag)}</span></div>
        <div class="insight-detail">${esc(i.detail)}</div>
      </div>
    </div>`).join("");
}

// ---------- Render: vehicles & compliance ----------
function complianceCell(till) {
  if (!till) return `<td class="comp-cell"><span class="comp-pill" style="background:#eee;color:#666">Not set</span></td>`;
  const d = daysUntil(till);
  const [bg, fg, label] = d < 0 ? ["#fde2e2", "#991b1b", "Expired"] :
    d <= 30 ? ["#fdedd3", "#92400e", d + "d left"] : ["#dcf5e3", "#166534", fmtDate(till)];
  return `<td class="comp-cell"><span class="comp-pill" style="background:${bg};color:${fg}" title="${fmtDate(till)}">${label}</span></td>`;
}
function renderVehicles() {
  const rows = db.vehicles.map(v => {
    const c = v.compliance || {};
    const driver = db.drivers.find(d => d.vehicleId === v.id);
    return `<tr class="veh-row" data-vid="${v.id}" style="cursor:pointer">
      <td><strong>${esc(v.name)}</strong><br /><span class="muted">${esc(v.type)} · ${v.kmPerMonth.toLocaleString("en-IN")} km/mo${driver ? " · 👨‍✈️ " + esc(driver.name) : ""}</span></td>
      ${complianceCell(c.insurance)}${complianceCell(c.puc)}${complianceCell(c.fitness)}${complianceCell(c.permit)}${complianceCell(c.roadtax)}</tr>
      <tr class="veh-history" data-hist="${v.id}" hidden><td colspan="6" style="background:#f8fafc">${serviceHistoryHTML(v.id)}</td></tr>`;
  }).join("");
  document.getElementById("vehicleComplianceTable").innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Insurance</th><th>PUC</th><th>Fitness</th><th>Permit</th><th>Road Tax</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.querySelectorAll(".veh-row").forEach(r => r.addEventListener("click", () => {
    const hist = document.querySelector(`[data-hist="${r.dataset.vid}"]`);
    hist.hidden = !hist.hidden;
  }));
}

function serviceHistoryHTML(vid) {
  const events = [
    ...db.expenses.filter(e => e.vehicleId === vid).map(e => ({ date: e.date, txt: `${e.category} — ${fmtINR(e.amount)}`, icon: "🧾" })),
    ...db.workOrders.filter(w => w.vehicleId === vid && w.status === "Completed").map(w => ({ date: w.completedAt, txt: `Job card: ${w.title} at ${w.vendor || "workshop"} — ${fmtINR(w.finalCost || 0)}`, icon: "🔧" })),
    ...db.inspections.filter(i => i.vehicleId === vid).map(i => ({ date: i.date, txt: `Inspection — ${i.passed ? "passed" : i.results.filter(r => !r.ok).length + " fault(s)"}`, icon: i.passed ? "✅" : "❌" }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const total = db.expenses.filter(e => e.vehicleId === vid).reduce((s, e) => s + e.amount, 0);
  return `<div style="padding:6px 4px"><strong style="font-size:0.85rem">Service history</strong> <span class="muted">· lifetime spend ${fmtINR(total)}</span><br />` +
    (events.length ? events.map(ev => `<span style="display:block;font-size:0.82rem;margin-top:5px">${ev.icon} ${fmtDate(ev.date)} — ${esc(ev.txt)}</span>`).join("") : "<span class='muted'>No history yet.</span>") + "</div>";
}

// ---------- Render: drivers ----------
function renderDrivers() {
  document.getElementById("driversTable").innerHTML = db.drivers.length ?
    `<table class="chart-table-el"><thead><tr><th>Driver</th><th>DL Number</th><th>DL Validity</th><th>Assigned Vehicle</th></tr></thead><tbody>` +
    db.drivers.map(d => {
      const days = d.dlExpiry ? daysUntil(d.dlExpiry) : null;
      const pill = days === null ? '<span class="comp-pill" style="background:#eee;color:#666">Not set</span>' :
        days < 0 ? '<span class="comp-pill" style="background:#fde2e2;color:#991b1b">Expired</span>' :
        days <= 30 ? `<span class="comp-pill" style="background:#fdedd3;color:#92400e">${days}d left</span>` :
        `<span class="comp-pill" style="background:#dcf5e3;color:#166534">${fmtDate(d.dlExpiry)}</span>`;
      return `<tr><td><strong>${esc(d.name)}</strong>${d.phone ? "<br /><span class='muted'>📞 " + esc(d.phone) + "</span>" : ""}</td>
        <td>${esc(d.dlNo)}</td><td>${pill}</td><td>${d.vehicleId ? esc(vName(d.vehicleId)) : "<span class='muted'>—</span>"}</td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>No drivers added yet.</p>";
}

// ---------- Render: work orders (job cards) ----------
function renderWorkOrders() {
  const open = db.workOrders.filter(w => w.status !== "Completed");
  const done = db.workOrders.filter(w => w.status === "Completed").slice(-5).reverse();
  document.getElementById("workOrdersList").innerHTML = (open.length ? open.map(w => `
    <div class="pred-row">
      <div class="pred-main"><span>🔧 <strong>${esc(vName(w.vehicleId))}</strong> — ${esc(w.title)}</span>
        <span class="pred-status" style="color:${PAL.serious}">In workshop</span></div>
      <div class="pred-detail">
        <span>${w.vendor ? esc(w.vendor) + " · " : ""}opened ${fmtDate(w.createdAt)}${w.estCost ? " · est. " + fmtINR(w.estCost) : ""}</span>
        <button class="link-btn" onclick="completeWorkOrder('${w.id}')">Complete &amp; Bill ✓</button>
      </div>
    </div>`).join("") : "<p class='muted'>No open job cards.</p>") +
    (done.length ? `<details class="chart-table"><summary>Completed job cards (${done.length})</summary>` +
      done.map(w => `<p class="muted" style="margin:6px 0">✅ ${esc(vName(w.vehicleId))} — ${esc(w.title)} · ${fmtINR(w.finalCost || 0)} (${fmtDate(w.completedAt)})</p>`).join("") + "</details>" : "");
}

function createWorkOrder(issueId) {
  const i = db.issues.find(x => x.id === issueId);
  if (!i) return;
  const vendor = prompt("Workshop / mechanic name for this job card:", "FleetWorks partner workshop");
  if (vendor === null) return;
  const est = prompt("Estimated cost (₹, optional):", "");
  db.workOrders.push({ id: uid(), issueId, vehicleId: i.vehicleId, title: i.title, vendor: vendor.trim(), estCost: est ? +est : null, status: "Open", createdAt: new Date().toISOString().slice(0, 10) });
  i.status = "In Progress";
  saveStore(); renderIssues(); renderWorkOrders(); renderOverview();
}

function completeWorkOrder(id) {
  const w = db.workOrders.find(x => x.id === id);
  if (!w) return;
  const cost = prompt("Final bill amount (₹):", w.estCost || "");
  if (cost === null || !+cost) return;
  const cat = prompt("Expense category (Tyres / Battery / Brakes / Clutch / Engine Oil & Filters / Suspension / Electrical / Body & Paint / Other):", "Other");
  if (cat === null) return;
  w.status = "Completed"; w.completedAt = new Date().toISOString().slice(0, 10); w.finalCost = +cost;
  db.expenses.push({ vehicleId: w.vehicleId, date: w.completedAt, category: cat.trim() || "Other", amount: +cost });
  const i = db.issues.find(x => x.id === w.issueId);
  if (i) { i.status = "Resolved"; i.resolvedAt = w.completedAt; }
  saveStore(); renderIssues(); renderWorkOrders(); renderVehicles(); renderOverview();
  alert("Job card closed. The expense has been added to your books automatically — it will appear in the AI Dashboard and Tally export.");
}

// ---------- Render: fuel ----------
function renderFuel() {
  const sel = document.getElementById("fuelVehicleFilter");
  const vid = sel.value || (db.vehicles[0] && db.vehicles[0].id);
  const v = db.vehicles.find(x => x.id === vid);
  const pts = vid ? mileagePoints(vid) : [];
  const totalL = db.fuelLogs.reduce((s, f) => s + f.litres, 0);
  const totalAmt = db.fuelLogs.reduce((s, f) => s + f.amount, 0);
  const fleetKmpl = db.vehicles.map(x => mileagePoints(x.id)).flat();
  const avgKmpl = fleetKmpl.length ? fleetKmpl.reduce((s, p) => s + p.kmpl, 0) / fleetKmpl.length : 0;

  document.getElementById("fuelStats").innerHTML = `
    <div class="stat-tile"><span class="stat-label">Total fuel spend</span><span class="stat-value">${fmtINR(totalAmt)}</span><span class="stat-sub">${Math.round(totalL).toLocaleString("en-IN")} litres logged</span></div>
    <div class="stat-tile"><span class="stat-label">Avg price paid</span><span class="stat-value">₹${totalL ? (totalAmt / totalL).toFixed(1) : 0}</span><span class="stat-sub">per litre (diesel)</span></div>
    <div class="stat-tile"><span class="stat-label">Fleet avg mileage</span><span class="stat-value">${avgKmpl.toFixed(1)}</span><span class="stat-sub">km/l across fills</span></div>
    <div class="stat-tile"><span class="stat-label">Fuel cost per km</span><span class="stat-value">₹${fleetKmpl.length ? (fleetKmpl.reduce((s, p) => s + p.cost, 0) / fleetKmpl.reduce((s, p) => s + p.dist, 0)).toFixed(1) : 0}</span><span class="stat-sub">from logged fills</span></div>`;

  const box = document.getElementById("mileageChart");
  if (pts.length < 2) { box.innerHTML = "<p class='muted'>Need at least 3 fuel entries with odometer readings for a mileage trend.</p>"; }
  else {
    const H = 220, padL = 44, padB = 30, padT = 16, padR = 14;
    const W = Math.max(480, padL + padR + pts.length * 56);
    const expected = v ? (EXPECTED_KMPL[v.type] || 4) : 4;
    const maxV = Math.max(...pts.map(p => p.kmpl), expected) * 1.2;
    const y = val => padT + (H - padT - padB) * (1 - val / maxV);
    const x = i => padL + (W - padL - padR) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${Math.min(W, 860)}px;display:block;font-family:inherit">`;
    [0, maxV / 2, maxV].forEach(t => {
      s += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${t === 0 ? PAL.baseline : PAL.grid}" stroke-width="1"/>`;
      s += `<text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${PAL.muted}">${t.toFixed(1)}</text>`;
    });
    s += `<line x1="${padL}" y1="${y(expected)}" x2="${W - padR}" y2="${y(expected)}" stroke="${PAL.s3}" stroke-width="1.5" stroke-dasharray="none" opacity="0.85"/>`;
    s += `<text x="${W - padR}" y="${y(expected) - 5}" text-anchor="end" font-size="10.5" fill="${PAL.ink2}">expected ${expected.toFixed(1)} km/l (${esc(v ? v.type : "")})</text>`;
    s += `<polyline fill="none" stroke="${PAL.s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p, i) => x(i) + "," + y(p.kmpl)).join(" ")}"/>`;
    pts.forEach((p, i) => {
      s += `<circle cx="${x(i)}" cy="${y(p.kmpl)}" r="4.5" fill="${PAL.s1}" stroke="#fff" stroke-width="2" data-tip="${esc(`<strong>${fmtDate(p.date)}</strong><br>${p.kmpl.toFixed(2)} km/l · ${p.dist} km`)}"/>`;
      if (i === pts.length - 1) s += `<text x="${x(i)}" y="${y(p.kmpl) - 10}" text-anchor="middle" font-size="11" font-weight="600" fill="${PAL.ink2}">${p.kmpl.toFixed(1)}</text>`;
      if (i % Math.ceil(pts.length / 8) === 0) s += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="${PAL.muted}">${new Date(p.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}</text>`;
    });
    s += "</svg>";
    box.innerHTML = s;
    bindTips(box);
  }

  document.getElementById("fuelTable").innerHTML =
    `<table><thead><tr><th>Date</th><th>Vehicle</th><th>Litres</th><th>Amount</th><th>Odometer</th></tr></thead><tbody>` +
    [...db.fuelLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
      .map(f => `<tr><td>${fmtDate(f.date)}</td><td>${esc(vName(f.vehicleId))}</td><td>${f.litres}</td><td>${fmtINR(f.amount)}</td><td>${f.odo.toLocaleString("en-IN")} km</td></tr>`).join("") +
    "</tbody></table>";
}

// ---------- Render: inspections ----------
function renderInspectionForm() {
  document.getElementById("inspChecklist").innerHTML = INSPECTION_ITEMS.map((item, i) => `
    <div class="insp-item">
      <span>${esc(item)}</span>
      <div class="insp-toggle">
        <label class="chip"><input type="radio" name="item${i}" value="ok" checked /><span>✅ OK</span></label>
        <label class="chip"><input type="radio" name="item${i}" value="fail" /><span>❌ Fault</span></label>
      </div>
    </div>`).join("");
}
function renderInspectionHistory() {
  const hist = [...db.inspections].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  document.getElementById("inspectionHistory").innerHTML = hist.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Result</th><th>Faults</th></tr></thead><tbody>` +
    hist.map(i => `<tr><td>${fmtDate(i.date)}</td><td>${esc(vName(i.vehicleId))}</td>
      <td>${i.passed ? '<span class="comp-pill" style="background:#dcf5e3;color:#166534">Passed</span>' : '<span class="comp-pill" style="background:#fde2e2;color:#991b1b">' + i.results.filter(r => !r.ok).length + " fault(s)</span>"}</td>
      <td>${esc(i.results.filter(r => !r.ok).map(r => r.item).join(", ") || "—")}</td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No inspections yet. Run your first 10-point check above.</p>";
}

// ---------- Render: issues ----------
function renderIssues() {
  const list = prioritisedIssues();
  const resolved = db.issues.filter(i => i.status === "Resolved").slice(-5).reverse();
  const rankColor = { P1: PAL.critical, P2: PAL.serious, P3: PAL.warn };
  document.getElementById("issuesList").innerHTML = (list.length ? list.map(i => `
    <div class="pred-row">
      <div class="pred-main">
        <span><span class="rank-pill" style="background:${rankColor[i.rank]}">${i.rank}</span> <strong>${esc(vName(i.vehicleId))}</strong> — ${esc(i.title)}</span>
        <span class="pred-status" style="color:${i.severity === "High" ? PAL.critical : i.severity === "Medium" ? PAL.serious : PAL.muted}">${esc(i.severity)}</span>
      </div>
      <div class="pred-detail">
        <span>Reported ${fmtDate(i.createdAt)}${i.source ? " · via " + esc(i.source) : ""}${i.status === "In Progress" ? " · <em>job card open</em>" : ""}</span>
        ${i.status !== "In Progress" ? `<button class="link-btn" onclick="createWorkOrder('${i.id}')">Open Job Card 🔧</button>` : ""}
        <button class="link-btn" onclick="resolveIssue('${i.id}')">Mark Resolved ✓</button>
      </div>
    </div>`).join("") : "<p class='muted'>No open issues. 🎉</p>") +
    (resolved.length ? `<details class="chart-table"><summary>Recently resolved (${resolved.length})</summary>` +
      resolved.map(i => `<p class="muted" style="margin:6px 0">✅ ${esc(vName(i.vehicleId))} — ${esc(i.title)} (${fmtDate(i.resolvedAt)})</p>`).join("") + "</details>" : "");
}
function resolveIssue(id) {
  const i = db.issues.find(x => x.id === id);
  if (i) { i.status = "Resolved"; i.resolvedAt = new Date().toISOString().slice(0, 10); saveStore(); renderIssues(); renderOverview(); }
}

// ---------- Render: reminders ----------
function renderReminders() {
  const list = reminderStatus();
  document.getElementById("remindersList").innerHTML = list.length ? list.map(r => {
    const d = daysUntil(r.nextDate);
    const color = r.overdue ? PAL.critical : r.dueSoon ? PAL.serious : PAL.good;
    const label = r.overdue ? `Overdue by ${-d} days` : d === 0 ? "Due today" : `Due in ${d} days`;
    return `<div class="pred-row">
      <div class="pred-main"><span><strong>${esc(vName(r.vehicleId))}</strong> — ${esc(r.task)}</span>
        <span class="pred-status" style="color:${color}">${label}</span></div>
      <div class="pred-detail"><span>Every ${r.everyMonths} months · last done ${fmtDate(r.lastDate)} · next ${fmtDate(r.nextDate)}</span>
        <button class="link-btn" onclick="completeReminder('${r.id}')">Done Today ✓</button></div>
    </div>`;
  }).join("") : "<p class='muted'>No PM schedules yet — add one below.</p>";
}
function completeReminder(id) {
  const r = db.reminders.find(x => x.id === id);
  if (r) { r.lastDate = new Date().toISOString().slice(0, 10); saveStore(); renderReminders(); renderOverview(); }
}

// ---------- Render: parts ----------
function warrantyPill(dateStr) {
  if (!dateStr) return '<span class="comp-pill" style="background:#eee;color:#666">Not set</span>';
  const d = daysUntil(dateStr);
  if (d < 0) return '<span class="comp-pill" style="background:#fde2e2;color:#991b1b">Expired</span>';
  if (d <= 30) return `<span class="comp-pill" style="background:#fdedd3;color:#92400e">${d}d left</span>`;
  return `<span class="comp-pill" style="background:#dcf5e3;color:#166534">Till ${fmtDate(dateStr)}</span>`;
}
function renderParts() {
  const box = document.getElementById("partsTable");
  if (!db.parts.length) { box.innerHTML = "<p class='muted'>No parts tracked yet.</p>"; return; }
  const rows = db.parts.map(p => {
    const stockPill = p.qty <= p.minQty
      ? '<span class="comp-pill" style="background:#fde2e2;color:#991b1b">Reorder</span>'
      : '<span class="comp-pill" style="background:#dcf5e3;color:#166534">OK</span>';
    return `<tr class="veh-row" data-pid="${p.id}" style="cursor:pointer">
        <td><strong>${esc(p.name)}</strong>${p.partNumber ? "<br /><span class='muted'>#" + esc(p.partNumber) + "</span>" : ""}</td>
        <td>${esc(p.make || "—")}</td>
        <td>${esc(p.category || "—")}</td>
        <td>${esc(p.vendor || "—")}</td>
        <td>${p.qty} <span class="muted">/ min ${p.minQty}</span></td>
        <td>${p.unitCost != null ? fmtINR(p.unitCost) : "—"}</td>
        <td>${stockPill}</td>
        <td>${warrantyPill(p.warrantyExpiry)}</td>
      </tr>
      <tr class="veh-history" data-hist="${p.id}" hidden><td colspan="8" style="background:#f8fafc">${partDetailHTML(p)}</td></tr>`;
  }).join("");
  box.innerHTML = `<table class="chart-table-el"><thead><tr>
      <th>Part</th><th>Make</th><th>Category</th><th>Vendor</th><th>Qty</th><th>Unit Cost</th><th>Stock</th><th>Warranty</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  document.querySelectorAll("#partsTable .veh-row").forEach(r => r.addEventListener("click", () => {
    const hist = document.querySelector(`[data-hist="${r.dataset.pid}"]`);
    hist.hidden = !hist.hidden;
  }));
}

function partDetailHTML(p) {
  const rows = [
    ["Sourcing", p.sourcing],
    ["Vendor contact", p.vendorContact ? "📞 " + p.vendorContact : null],
    ["Storage location", p.location],
    ["Purchase date", p.purchaseDate ? fmtDate(p.purchaseDate) : null],
    ["Warranty expiry", p.warrantyExpiry ? fmtDate(p.warrantyExpiry) : null]
  ].filter(([, v]) => v);
  return `<div style="padding:6px 4px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 18px">` +
    (rows.length ? rows.map(([label, v]) => `<span style="font-size:0.82rem"><strong>${esc(label)}:</strong> ${esc(v)}</span>`).join("")
      : "<span class='muted'>No further details recorded.</span>") + "</div>";
}

// ---------- Tooltip ----------
const tip = () => document.getElementById("vizTooltip");
function bindTips(container) {
  container.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("mousemove", ev => {
      const t = tip(); t.innerHTML = el.dataset.tip; t.hidden = false;
      let x = ev.clientX + 14, y = ev.clientY + 14;
      const r = t.getBoundingClientRect();
      if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
      t.style.left = x + "px"; t.style.top = y + "px";
    });
    el.addEventListener("mouseleave", () => { tip().hidden = true; });
  });
}

// ---------- Demo data ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function loadDemoFleet() {
  const rnd = mulberry32(42);
  const now = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

  // Vehicles (same fleet as the AI Dashboard demo) + compliance dates
  const vehicles = [
    { id: "v1", name: "TN-01-AB-1234", type: "Truck (HCV)", kmPerMonth: 9000 },
    { id: "v2", name: "TN-09-CD-5678", type: "Truck (HCV)", kmPerMonth: 7500 },
    { id: "v3", name: "TN-22-EF-3456", type: "Tipper", kmPerMonth: 4200 },
    { id: "v4", name: "KA-05-GH-7890", type: "Bus", kmPerMonth: 11000 },
    { id: "v5", name: "TN-45-JK-2468", type: "LCV", kmPerMonth: 5200 }
  ];
  const compOffsets = [[300, 45, 400, 200, 500], [25, -12, 180, 90, 365], [150, 60, 22, 320, 400], [80, 200, 95, -5, 250], [365, 120, 240, 150, 18]];
  vehicles.forEach((v, i) => {
    const [ins, puc, fit, per, tax] = compOffsets[i];
    v.compliance = { insurance: daysFromNow(ins), puc: daysFromNow(puc), fitness: daysFromNow(fit), permit: daysFromNow(per), roadtax: daysFromNow(tax) };
  });

  // Expenses (identical generator to the dashboard demo)
  const expenses = [];
  const start = new Date(now.getFullYear(), now.getMonth() - 17, 1);
  const partPlans = {
    "Engine Oil & Filters": { every: 2, cost: [7000, 10500], jitter: 1 },
    "Brakes": { every: 7, cost: [7500, 12000], jitter: 2 },
    "Tyres": { every: 9, cost: [52000, 78000], jitter: 3 },
    "Battery": { every: 13, cost: [11500, 16500], jitter: 3 },
    "Electrical": { every: 6, cost: [2500, 8000], jitter: 2 },
    "Suspension": { every: 10, cost: [9000, 19000], jitter: 3 },
    "Clutch": { every: 15, cost: [18000, 26000], jitter: 3 }
  };
  vehicles.forEach(v => {
    Object.entries(partPlans).forEach(([cat, plan]) => {
      let m = Math.floor(rnd() * plan.every);
      while (m < 18) {
        const d = new Date(start.getFullYear(), start.getMonth() + m, 3 + Math.floor(rnd() * 24));
        if (d <= now) {
          const scale = v.type === "LCV" ? 0.55 : v.type === "Tipper" ? 1.15 : 1;
          expenses.push({ vehicleId: v.id, date: iso(d), category: cat, amount: Math.round((plan.cost[0] + rnd() * (plan.cost[1] - plan.cost[0])) * scale / 100) * 100 });
        }
        m += plan.every + Math.floor(rnd() * plan.jitter);
      }
    });
    for (let m = 0; m < 18; m++) {
      if (rnd() < 0.25) {
        const d = new Date(start.getFullYear(), start.getMonth() + m, 5 + Math.floor(rnd() * 20));
        if (d <= now) expenses.push({ vehicleId: v.id, date: iso(d), category: "Other", amount: Math.round((1500 + rnd() * 6000) / 100) * 100 });
      }
    }
  });

  // Fuel logs: last ~10 fills per vehicle
  const fuelLogs = [];
  vehicles.forEach(v => {
    const kmpl = (EXPECTED_KMPL[v.type] || 4) * (0.92 + rnd() * 0.16);
    let odo = 80000 + Math.floor(rnd() * 90000);
    for (let f = 10; f >= 1; f--) {
      const d = new Date(now); d.setDate(d.getDate() - f * (6 + Math.floor(rnd() * 4)));
      const dist = Math.round(v.kmPerMonth / 4.5 * (0.8 + rnd() * 0.4));
      odo += dist;
      // last fill of v3 simulates a mileage drop
      const eff = (v.id === "v3" && f === 1) ? kmpl * 0.72 : kmpl * (0.94 + rnd() * 0.12);
      const litres = Math.round(dist / eff);
      const price = 92 + rnd() * 6;
      fuelLogs.push({ id: uid(), vehicleId: v.id, date: iso(d), litres, amount: Math.round(litres * price), odo });
    }
  });

  // Inspections: a few, one with faults
  const inspections = [
    { id: uid(), vehicleId: "v1", date: daysFromNow(-3), passed: true, results: INSPECTION_ITEMS.map(item => ({ item, ok: true })) },
    { id: uid(), vehicleId: "v4", date: daysFromNow(-1), passed: false, results: INSPECTION_ITEMS.map((item, i) => ({ item, ok: i !== 1 && i !== 2 })) },
    { id: uid(), vehicleId: "v2", date: daysFromNow(-6), passed: true, results: INSPECTION_ITEMS.map(item => ({ item, ok: true })) }
  ];

  // Issues
  const issues = [
    { id: uid(), vehicleId: "v4", title: "Brakes & air system — inspection fault", severity: "High", status: "Open", createdAt: daysFromNow(-1), source: "Inspection" },
    { id: uid(), vehicleId: "v4", title: "Lights & indicators — inspection fault", severity: "Medium", status: "Open", createdAt: daysFromNow(-1), source: "Inspection" },
    { id: uid(), vehicleId: "v2", title: "Coolant temperature climbing on ghats", severity: "High", status: "Open", createdAt: daysFromNow(-9), source: "Driver report" },
    { id: uid(), vehicleId: "v5", title: "AC not cooling in cabin", severity: "Low", status: "Open", createdAt: daysFromNow(-20), source: "Driver report" },
    { id: uid(), vehicleId: "v1", title: "Wiper blades worn out", severity: "Low", status: "Resolved", createdAt: daysFromNow(-30), resolvedAt: daysFromNow(-25), source: "Inspection" }
  ];

  // PM reminders
  const reminders = [
    { id: uid(), vehicleId: "v1", task: "Engine Oil & Filters", everyMonths: 2, lastDate: daysFromNow(-70) },
    { id: uid(), vehicleId: "v2", task: "General Service (PMS)", everyMonths: 3, lastDate: daysFromNow(-80) },
    { id: uid(), vehicleId: "v3", task: "Greasing & Lubrication", everyMonths: 1, lastDate: daysFromNow(-12) },
    { id: uid(), vehicleId: "v4", task: "Wheel Alignment & Balancing", everyMonths: 4, lastDate: daysFromNow(-40) },
    { id: uid(), vehicleId: "v5", task: "Coolant Top-up / Flush", everyMonths: 6, lastDate: daysFromNow(-150) }
  ];

  // Drivers (one DL expiring soon, one healthy set)
  const drivers = [
    { id: uid(), name: "Suresh Kumar", phone: "9840012345", dlNo: "TN01 20180012345", dlExpiry: daysFromNow(400), vehicleId: "v1" },
    { id: uid(), name: "Manoj Yadav", phone: "9944056789", dlNo: "UP32 20150098765", dlExpiry: daysFromNow(21), vehicleId: "v2" },
    { id: uid(), name: "Ravi Shankar", phone: "9500123456", dlNo: "TN22 20190045678", dlExpiry: daysFromNow(700), vehicleId: "v3" },
    { id: uid(), name: "Peter D'Souza", phone: "9880234567", dlNo: "KA05 20170034567", dlExpiry: daysFromNow(-8), vehicleId: "v4" },
    { id: uid(), name: "Abdul Rahman", phone: "9790345678", dlNo: "TN45 20200056789", dlExpiry: daysFromNow(250), vehicleId: "v5" }
  ];

  // Job cards: one open (linked to the coolant issue), one completed
  const workOrders = [
    { id: uid(), issueId: issues[2].id, vehicleId: "v2", title: "Coolant temperature climbing on ghats", vendor: "Annai Auto Works, Salem", estCost: 6500, status: "Open", createdAt: daysFromNow(-7) },
    { id: uid(), issueId: null, vehicleId: "v1", title: "Silencer mounting weld", vendor: "Highway Motors, Chennai", estCost: 1500, status: "Completed", createdAt: daysFromNow(-40), completedAt: daysFromNow(-38), finalCost: 1800 }
  ];
  issues[2].status = "In Progress";

  // Parts
  const parts = [
    { id: uid(), name: "Engine Oil 15W-40 (barrel)", partNumber: "CAS-15W40-210L", make: "Castrol CRB", category: "Engine", sourcing: "OEM (Original)", vendor: "Sri Ganesh Auto Spares", vendorContact: "9840011223", unitCost: 18500, qty: 2, minQty: 1, location: "Rack A-1", purchaseDate: daysFromNow(-40), warrantyExpiry: null },
    { id: uid(), name: "Air Filter — Tata LPT", partNumber: "TML-AF-1613X", make: "Tata Genuine", category: "Filters", sourcing: "OEM (Original)", vendor: "Tata Motors Authorised Dealer", vendorContact: "9884022334", unitCost: 950, qty: 1, minQty: 2, location: "Rack B-2", purchaseDate: daysFromNow(-15), warrantyExpiry: null },
    { id: uid(), name: "Brake Liner Set — HCV", partNumber: "BL-HCV-450", make: "Bosch", category: "Brakes", sourcing: "Aftermarket", vendor: "Annai Auto Works, Salem", vendorContact: "9500123456", unitCost: 4200, qty: 6, minQty: 4, location: "Rack C-1", purchaseDate: daysFromNow(-90), warrantyExpiry: daysFromNow(20) },
    { id: uid(), name: "Fuel Filter — BS6", partNumber: "FF-BS6-220", make: "Mahle", category: "Filters", sourcing: "OEM (Original)", vendor: "Sri Ganesh Auto Spares", vendorContact: "9840011223", unitCost: 780, qty: 3, minQty: 2, location: "Rack B-3", purchaseDate: daysFromNow(-25), warrantyExpiry: null },
    { id: uid(), name: "Wheel Nut (100 pcs)", partNumber: "WN-M22-100", make: "Local Make", category: "Suspension", sourcing: "Local Market", vendor: "Chennai Steel Traders", vendorContact: "9600234567", unitCost: 3500, qty: 40, minQty: 50, location: "Rack D-1", purchaseDate: daysFromNow(-60), warrantyExpiry: null },
    { id: uid(), name: "Alternator — 12V 90A", partNumber: "ALT-12V90-BL", make: "Bosch", category: "Electrical", sourcing: "Aftermarket", vendor: "Highway Motors, Chennai", vendorContact: "9840345678", unitCost: 6800, qty: 2, minQty: 1, location: "Rack E-2", purchaseDate: daysFromNow(-200), warrantyExpiry: daysFromNow(-5) }
  ];

  db = { vehicles, expenses, fuelLogs, inspections, issues, reminders, parts, drivers, workOrders, demo: true };
  saveStore();
  renderAll();
}

// ---------- Forms & events ----------
function fillVehicleSelects() {
  const opts = db.vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
  ["compVehicle", "fuelVehicle", "inspVehicle", "issueVehicle", "remVehicle", "fuelVehicleFilter"].forEach(id => {
    const el = document.getElementById(id);
    const keep = el.value;
    el.innerHTML = opts;
    if ([...el.options].some(o => o.value === keep)) el.value = keep;
  });
  const dv = document.getElementById("driverVehicle");
  const keepD = dv.value;
  dv.innerHTML = '<option value="">Not assigned</option>' + opts;
  if ([...dv.options].some(o => o.value === keepD)) dv.value = keepD;
}

document.getElementById("driverForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const existing = db.drivers.find(d => d.dlNo.toLowerCase() === fd.dlNo.trim().toLowerCase());
  if (existing) Object.assign(existing, { name: fd.name.trim(), phone: fd.phone, dlExpiry: fd.dlExpiry, vehicleId: fd.vehicleId });
  else db.drivers.push({ id: uid(), name: fd.name.trim(), phone: fd.phone, dlNo: fd.dlNo.trim(), dlExpiry: fd.dlExpiry, vehicleId: fd.vehicleId });
  saveStore(); e.target.reset(); renderDrivers(); renderVehicles(); renderOverview();
});

document.getElementById("complianceForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const v = db.vehicles.find(x => x.id === fd.vehicleId);
  if (v) { v.compliance = v.compliance || {}; v.compliance[fd.doc] = fd.validTill; saveStore(); renderVehicles(); renderOverview(); }
  e.target.reset();
});

document.getElementById("fuelForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.fuelLogs.push({ id: uid(), vehicleId: fd.vehicleId, date: fd.date, litres: +fd.litres, amount: +fd.amount, odo: +fd.odo });
  saveStore(); e.target.reset(); renderFuel(); renderOverview();
});

document.getElementById("inspectionForm").addEventListener("submit", e => {
  e.preventDefault();
  const vid = document.getElementById("inspVehicle").value;
  const results = INSPECTION_ITEMS.map((item, i) => ({ item, ok: e.target["item" + i].value === "ok" }));
  const passed = results.every(r => r.ok);
  db.inspections.push({ id: uid(), vehicleId: vid, date: new Date().toISOString().slice(0, 10), passed, results });
  results.filter(r => !r.ok).forEach(r => {
    db.issues.push({ id: uid(), vehicleId: vid, title: r.item + " — inspection fault", severity: r.item.includes("Brake") || r.item.includes("Tyre") ? "High" : "Medium", status: "Open", createdAt: new Date().toISOString().slice(0, 10), source: "Inspection" });
  });
  saveStore(); renderInspectionForm(); renderInspectionHistory(); renderIssues(); renderOverview();
  alert(passed ? "Inspection passed — all 10 points OK ✅" : "Inspection recorded. Failed items have been added to Issues for AI prioritisation.");
});

document.getElementById("issueForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.issues.push({ id: uid(), vehicleId: fd.vehicleId, title: fd.title.trim(), severity: fd.severity, status: "Open", createdAt: new Date().toISOString().slice(0, 10), source: "Manual" });
  saveStore(); e.target.reset(); renderIssues(); renderOverview();
});

document.getElementById("reminderForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.reminders.push({ id: uid(), vehicleId: fd.vehicleId, task: fd.task, everyMonths: +fd.everyMonths, lastDate: fd.lastDate });
  saveStore(); e.target.reset(); renderReminders(); renderOverview();
});

document.getElementById("partForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const partData = {
    name: fd.name.trim(), partNumber: fd.partNumber.trim(), make: fd.make.trim(),
    category: fd.category, sourcing: fd.sourcing,
    vendor: fd.vendor.trim(), vendorContact: fd.vendorContact,
    unitCost: fd.unitCost ? +fd.unitCost : null,
    qty: +fd.qty, minQty: +fd.minQty, location: fd.location.trim(),
    purchaseDate: fd.purchaseDate || null, warrantyExpiry: fd.warrantyExpiry || null
  };
  const existing = db.parts.find(p => p.name.toLowerCase() === partData.name.toLowerCase());
  if (existing) {
    // Restocking (qty/minQty/name) always applies; other fields only overwrite
    // if actually filled in this time, so a quick re-add doesn't wipe vendor/
    // warranty/etc. already on file.
    Object.entries(partData).forEach(([k, v]) => {
      if (k === "qty" || k === "minQty" || k === "name") existing[k] = v;
      else if (v !== "" && v !== null) existing[k] = v;
    });
  } else {
    db.parts.push({ id: uid(), ...partData });
  }
  saveStore(); e.target.reset(); renderParts(); renderOverview();
});

document.getElementById("fuelVehicleFilter").addEventListener("change", renderFuel);
document.getElementById("demoBtn").addEventListener("click", loadDemoFleet);

// Tabs
document.getElementById("tabBar").addEventListener("click", e => {
  if (!e.target.dataset.tab) return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === e.target));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + e.target.dataset.tab));
});

// Navbar
const navbar = document.getElementById("navbar");
window.addEventListener("scroll", () => navbar.classList.toggle("scrolled", window.scrollY > 10));
document.getElementById("hamburger").addEventListener("click", () =>
  document.getElementById("navLinks").classList.toggle("open"));

// ---------- Orchestration ----------
function renderAll() {
  const has = db.vehicles.length > 0;
  document.getElementById("emptyState").hidden = has;
  document.getElementById("fleetContent").hidden = !has;
  if (!has) return;
  // demo store from the dashboard may lack fleet-manager collections — extend it once
  if (db.demo !== true && db.vehicles.length && !db.fuelLogs.length && db.expenses.length && db.vehicles[0].id === "v1" && !db.vehicles[0].compliance) {
    loadDemoFleet(); return;
  }
  fillVehicleSelects();
  renderOverview(); renderVehicles(); renderDrivers(); renderFuel();
  renderInspectionForm(); renderInspectionHistory();
  renderIssues(); renderWorkOrders(); renderReminders(); renderParts();
}
renderAll();
