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
      parts: d.parts || [], demo: !!d.demo
    };
  } catch { return { vehicles: [], expenses: [], fuelLogs: [], inspections: [], issues: [], reminders: [], parts: [], demo: false }; }
}
function saveStore() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
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
    out.push({ sev: 1, icon: "🔩", tag: "Inventory", title: `Low stock: ${p.name}`, detail: `${p.qty} left (alert level ${p.minQty}). Reorder to avoid workshop delays.` });
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
    return `<tr><td><strong>${esc(v.name)}</strong><br /><span class="muted">${esc(v.type)} · ${v.kmPerMonth.toLocaleString("en-IN")} km/mo</span></td>
      ${complianceCell(c.insurance)}${complianceCell(c.puc)}${complianceCell(c.fitness)}${complianceCell(c.permit)}${complianceCell(c.roadtax)}</tr>`;
  }).join("");
  document.getElementById("vehicleComplianceTable").innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Insurance</th><th>PUC</th><th>Fitness</th><th>Permit</th><th>Road Tax</th></tr></thead><tbody>${rows}</tbody></table>`;
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
        <span>Reported ${fmtDate(i.createdAt)}${i.source ? " · via " + esc(i.source) : ""}</span>
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
function renderParts() {
  document.getElementById("partsTable").innerHTML = db.parts.length ?
    `<table class="chart-table-el"><thead><tr><th>Part</th><th>In Stock</th><th>Alert Below</th><th>Status</th></tr></thead><tbody>` +
    db.parts.map(p => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${p.minQty}</td>
      <td>${p.qty <= p.minQty ? '<span class="comp-pill" style="background:#fde2e2;color:#991b1b">Reorder</span>' : '<span class="comp-pill" style="background:#dcf5e3;color:#166534">OK</span>'}</td></tr>`).join("") +
    "</tbody></table>" : "<p class='muted'>No parts tracked yet.</p>";
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

  // Parts
  const parts = [
    { id: uid(), name: "Engine Oil 15W-40 (barrel)", qty: 2, minQty: 1 },
    { id: uid(), name: "Air Filter — Tata LPT", qty: 1, minQty: 2 },
    { id: uid(), name: "Brake Liner Set — HCV", qty: 6, minQty: 4 },
    { id: uid(), name: "Fuel Filter — BS6", qty: 3, minQty: 2 },
    { id: uid(), name: "Wheel Nut (100 pcs)", qty: 40, minQty: 50 }
  ];

  db = { vehicles, expenses, fuelLogs, inspections, issues, reminders, parts, demo: true };
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
}

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
  const existing = db.parts.find(p => p.name.toLowerCase() === fd.name.trim().toLowerCase());
  if (existing) { existing.qty = +fd.qty; existing.minQty = +fd.minQty; }
  else db.parts.push({ id: uid(), name: fd.name.trim(), qty: +fd.qty, minQty: +fd.minQty });
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
  renderOverview(); renderVehicles(); renderFuel();
  renderInspectionForm(); renderInspectionHistory();
  renderIssues(); renderReminders(); renderParts();
}
renderAll();
