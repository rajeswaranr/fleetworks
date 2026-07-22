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
      workOrders: d.workOrders || [], documents: d.documents || [],
      tyreReadings: d.tyreReadings || [], settings: d.settings || {},
      trips: d.trips || [], driverLedger: d.driverLedger || [],
      demo: !!d.demo
    };
  } catch { return { vehicles: [], expenses: [], fuelLogs: [], inspections: [], issues: [], reminders: [], parts: [], drivers: [], workOrders: [], documents: [], tyreReadings: [], settings: {}, trips: [], driverLedger: [], demo: false }; }
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

// Document types for the Document Vault, split by what they attach to.
const DOC_TYPES = {
  vehicle: ["Registration Certificate (RC)", "Insurance Policy", "National Permit", "State Permit",
            "PUC Certificate", "Fitness Certificate (FC)", "Road Tax Receipt", "Green Tax",
            "Goods Carriage Permit", "Fastag / Toll", "Other"],
  driver: ["Driving Licence", "Aadhaar", "PAN Card", "Police Verification",
           "Medical Certificate", "Training Certificate", "Other"]
};

// Wheel positions by vehicle type — used by Tyre Health. Trucks/tippers are
// 10-wheelers (2 front + dual rear on 2 axles); LCV/Bus kept simpler.
const AXLE_LAYOUTS = {
  "Truck (HCV)": ["Front Left", "Front Right", "Rear-1 Left Outer", "Rear-1 Left Inner", "Rear-1 Right Inner", "Rear-1 Right Outer", "Rear-2 Left Outer", "Rear-2 Left Inner", "Rear-2 Right Inner", "Rear-2 Right Outer"],
  "Tipper": ["Front Left", "Front Right", "Rear-1 Left Outer", "Rear-1 Left Inner", "Rear-1 Right Inner", "Rear-1 Right Outer", "Rear-2 Left Outer", "Rear-2 Left Inner", "Rear-2 Right Inner", "Rear-2 Right Outer"],
  "Trailer": ["Front Left", "Front Right", "Rear-1 Left Outer", "Rear-1 Left Inner", "Rear-1 Right Inner", "Rear-1 Right Outer", "Rear-2 Left Outer", "Rear-2 Left Inner", "Rear-2 Right Inner", "Rear-2 Right Outer"],
  "Tanker": ["Front Left", "Front Right", "Rear-1 Left Outer", "Rear-1 Left Inner", "Rear-1 Right Inner", "Rear-1 Right Outer", "Rear-2 Left Outer", "Rear-2 Left Inner", "Rear-2 Right Inner", "Rear-2 Right Outer"],
  "Bus": ["Front Left", "Front Right", "Rear Left Outer", "Rear Left Inner", "Rear Right Inner", "Rear Right Outer"],
  "LCV": ["Front Left", "Front Right", "Rear Left", "Rear Right"]
};
function tyrePositions(vid) {
  const v = db.vehicles.find(x => x.id === vid);
  return AXLE_LAYOUTS[v && v.type] || AXLE_LAYOUTS["LCV"];
}

// Settings-aware thresholds (fall back to sensible Indian defaults).
function warnDays() { return +(db.settings && db.settings.warnDays) || 30; }
function minTread() { return +(db.settings && db.settings.minTread) || 1.6; }

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
      if (d < 0) out.push({ sev: 4, icon: "document", tag: "Compliance", title: `${v.name}: ${DOC_LABELS[doc]} EXPIRED`, detail: `Expired ${-d} days ago (${fmtDate(till)}). Vehicle is non-compliant — renew immediately to avoid penalties.` });
      else if (d <= 30) out.push({ sev: 3, icon: "document", tag: "Compliance", title: `${v.name}: ${DOC_LABELS[doc]} expires in ${d} days`, detail: `Valid till ${fmtDate(till)}. Renew before expiry to keep the vehicle on the road.` });
    });
  });

  // 2. Expense anomalies (Smart Assessment: cost spikes vs category median)
  const byCat = {};
  db.expenses.forEach(e => { (byCat[e.category] = byCat[e.category] || []).push(e.amount); });
  db.expenses.slice(-60).forEach(e => {
    const med = median(byCat[e.category]);
    if (byCat[e.category].length >= 4 && e.amount > med * 1.8) {
      out.push({ sev: 2, icon: "receipt", tag: "Review flagged", title: `${vName(e.vehicleId)}: ${e.category} bill ${fmtINR(e.amount)} looks high`, detail: `Your typical ${e.category} spend is ${fmtINR(med)}. Worth confirming the itemised bill (${fmtDate(e.date)}).` });
    }
  });

  // 3. Possible duplicate charges (same vehicle + category within 7 days)
  const sorted = [...db.expenses].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (a.vehicleId === b.vehicleId && a.category === b.category &&
        Math.abs(new Date(b.date) - new Date(a.date)) <= 7 * 86400000 && a.category !== "Other" && a.category !== "Engine Oil & Filters") {
      out.push({ sev: 2, icon: "eye", tag: "Review flagged", title: `${vName(a.vehicleId)}: two ${a.category} charges within a week`, detail: `${fmtINR(a.amount)} on ${fmtDate(a.date)} and ${fmtINR(b.amount)} on ${fmtDate(b.date)}. Confirm the second is not a duplicate billing.` });
    }
  }

  // 4. Mileage drop
  db.vehicles.forEach(v => {
    const pts = mileagePoints(v.id);
    if (pts.length >= 4) {
      const base = median(pts.slice(0, -1).map(p => p.kmpl));
      const last = pts[pts.length - 1].kmpl;
      if (last < base * 0.85) {
        out.push({ sev: 3, icon: "fuel", tag: "Fuel anomaly", title: `${v.name}: mileage dropped to ${last.toFixed(1)} km/l`, detail: `Usual is ~${base.toFixed(1)} km/l. Check tyre pressure, air filter, injectors — or possible fuel pilferage.` });
      }
    }
  });

  // 5. Overdue PM reminders
  reminderStatus().forEach(r => {
    if (r.overdue) out.push({ sev: 3, icon: "calendarClock", tag: "Maintenance", title: `${vName(r.vehicleId)}: ${r.task} overdue`, detail: `Was due ${fmtDate(r.nextDate)}. Book it before it becomes a breakdown.` });
  });

  // 6. Open high-severity issues
  db.issues.filter(i => i.status !== "Resolved" && i.severity === "High").forEach(i => {
    out.push({ sev: 4, icon: "alert", tag: "Issue", title: `${vName(i.vehicleId)}: ${i.title}`, detail: `High-severity issue open since ${fmtDate(i.createdAt)}. Top of the AI priority list.` });
  });

  // 7. Low parts stock
  db.parts.filter(p => p.qty <= p.minQty).forEach(p => {
    out.push({ sev: 1, icon: "boxes", tag: "Godown", title: `Low stock: ${p.name}`, detail: `${p.qty} left (alert level ${p.minQty}). Reorder to avoid workshop delays.` });
  });

  // 7b. Part warranty expiring
  db.parts.forEach(p => {
    if (!p.warrantyExpiry) return;
    const d = daysUntil(p.warrantyExpiry);
    if (d < 0) out.push({ sev: 2, icon: "shieldCheck", tag: "Warranty", title: `${p.name}: warranty expired`, detail: `Expired ${-d} days ago${p.vendor ? " · " + p.vendor : ""}. Any pending claims should be raised before replacement.` });
    else if (d <= 30) out.push({ sev: 1, icon: "shieldCheck", tag: "Warranty", title: `${p.name}: warranty expires in ${d} days`, detail: `${p.vendor ? "Vendor: " + p.vendor + ". " : ""}Raise any known defects with the vendor before it lapses.` });
  });

  // 7c. Worn tyres (tread at/under the safe limit)
  db.vehicles.forEach(v => {
    const latest = latestReadings(v.id);
    const worn = Object.values(latest).filter(r => r.treadDepth <= minTread());
    if (worn.length) out.push({ sev: 3, icon: "tire", tag: "Tyre health", title: `${v.name}: ${worn.length} tyre(s) worn to ${minTread()}mm or below`, detail: `${worn.map(r => r.position).join(", ")} need replacement. Bald tyres fail fitness checks and risk blowouts on highway runs.` });
  });

  // 8. Driver licence expiry
  db.drivers.forEach(dr => {
    if (!dr.dlExpiry) return;
    const d = daysUntil(dr.dlExpiry);
    if (d < 0) out.push({ sev: 4, icon: "driver", tag: "Driver DL", title: `${dr.name}: driving licence EXPIRED`, detail: `Expired ${-d} days ago. Driving without a valid DL risks challans and voids insurance claims.` });
    else if (d <= 30) out.push({ sev: 3, icon: "driver", tag: "Driver DL", title: `${dr.name}: DL expires in ${d} days`, detail: `Valid till ${fmtDate(dr.dlExpiry)}. Start the renewal at the Parivahan portal now.` });
  });

  // 9. Possible warranty claims (same part failing again within 12 months)
  const warrantyCats = ["Battery", "Tyres", "Clutch", "Suspension"];
  db.vehicles.forEach(v => {
    warrantyCats.forEach(cat => {
      const h = db.expenses.filter(e => e.vehicleId === v.id && e.category === cat).sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < h.length; i++) {
        const gapM = (new Date(h[i].date) - new Date(h[i - 1].date)) / (30.44 * 86400000);
        if (gapM < 12 && daysUntil(h[i].date) > -90) {
          out.push({ sev: 2, icon: "shieldCheck", tag: "Warranty", title: `${v.name}: ${cat} replaced twice in ${Math.round(gapM)} months`, detail: `${fmtINR(h[i].amount)} on ${fmtDate(h[i].date)} may be claimable under the brand warranty from the ${fmtDate(h[i - 1].date)} purchase. Check the bill.` });
        }
      }
    });
  });

  // 10. Job cards pending too long
  db.workOrders.filter(w => w.status !== "Completed").forEach(w => {
    const age = Math.round((now - new Date(w.createdAt)) / 86400000);
    if (age > 5) out.push({ sev: 2, icon: "wrench", tag: "Job card", title: `${vName(w.vehicleId)}: job card open ${age} days`, detail: `"${w.title}" at ${w.vendor || "workshop"} since ${fmtDate(w.createdAt)}. Follow up — every idle day is lost revenue.` });
  });

  // 8. All-clear
  if (!out.length) out.push({ sev: 0, icon: "checkCircle", tag: "All clear", title: "No risks detected", detail: "Compliance, spending, mileage and maintenance all look healthy. The AI keeps watching." });

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

// ---------- Dashboard widget helpers ----------
function monthKeys(n = 6) {
  const out = [], d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}
function miniBars(vals, labels, color) {
  const W = 220, H = 62, pb = 13, max = Math.max(...vals, 1), bw = W / vals.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="dw-chart" preserveAspectRatio="none">`;
  vals.forEach((v, i) => {
    const h = (H - pb - 6) * v / max;
    s += `<rect x="${(i * bw + 4).toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${Math.max(h, 1.5).toFixed(1)}" rx="2" fill="${color || PAL.s1}"/>`;
    s += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="8.5" fill="${PAL.muted}">${labels[i]}</text>`;
  });
  return s + "</svg>";
}
function dwPair(aVal, aLbl, aCol, bVal, bLbl, bCol) {
  return `<div class="dw-pair">
    <div><span class="dw-big" style="color:${aCol}">${aVal}</span><span class="dw-sub">${aLbl}</span></div>
    <div><span class="dw-big" style="color:${bCol}">${bVal}</span><span class="dw-sub">${bLbl}</span></div>
  </div>`;
}
function dw(label, body, cls) { return `<div class="dw${cls ? " " + cls : ""}"><div class="dw-head">${label}</div>${body}</div>`; }

// ---------- Render: overview widget dashboard ----------
function renderDashboard() {
  const grid = document.getElementById("dashGrid");
  if (!grid) return;
  const now = new Date();
  const months = monthKeys(6);
  const mL = months.map(m => new Date(m + "-01").toLocaleDateString("en-IN", { month: "short" }));

  // reminders / renewals
  const rs = reminderStatus();
  const remO = rs.filter(r => r.overdue).length, remS = rs.filter(r => r.dueSoon).length;
  const radar = radarItems();
  const seg = cat => {
    const it = radar.filter(i => i.cat === cat);
    return [it.filter(i => i.days < 0).length, it.filter(i => i.days >= 0 && i.days <= warnDays()).length];
  };
  const [vrO, vrS] = seg("vehicle"), [drO, drS] = seg("driver"), [wtO, wtS] = seg("warranty");

  // issues
  const openIss = db.issues.filter(i => i.status !== "Resolved");
  const highOpen = openIss.filter(i => i.severity === "High").length;
  const resolved = db.issues.filter(i => i.resolvedAt);
  const avgResolve = resolved.length ? (resolved.reduce((s, i) => s + (new Date(i.resolvedAt) - new Date(i.createdAt)) / 86400000, 0) / resolved.length) : 0;
  const issM = months.map(m => db.issues.filter(i => i.createdAt && i.createdAt.startsWith(m)).length);

  // job cards / vehicle status / assignments
  const openWO = db.workOrders.filter(w => w.status !== "Completed");
  const oldestWO = openWO.length ? Math.max(...openWO.map(w => Math.round((now - new Date(w.createdAt)) / 86400000))) : 0;
  const inShop = new Set(openWO.map(w => w.vehicleId)).size;
  const assigned = new Set(db.drivers.filter(d => d.vehicleId).map(d => d.vehicleId)).size;

  // costs
  const sumM = (arr, key) => months.map(m => arr.filter(x => x[key] && x[key].startsWith(m)).reduce((s, x) => s + x.amount, 0));
  const fuelM = sumM(db.fuelLogs, "date"), svcM = sumM(db.expenses, "date");
  const totM = months.map((_, i) => fuelM[i] + svcM[i]);

  // cost per km (lifetime, from odometer spans)
  let km = 0;
  db.vehicles.forEach(v => { const f = vehicleFills(v.id); if (f.length > 1) km += f[f.length - 1].odo - f[0].odo; });
  const costAll = db.expenses.reduce((s, e) => s + e.amount, 0) + db.fuelLogs.reduce((s, f) => s + f.amount, 0);
  const cpk = km ? costAll / km : 0;

  // top repair spend categories
  const byCat = {};
  db.expenses.forEach(e => byCat[e.category] = (byCat[e.category] || 0) + e.amount);
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCat = topCats.length ? topCats[0][1] : 1;

  // meters
  const meters = db.vehicles.map(v => { const f = vehicleFills(v.id); return { name: v.name, odo: f.length ? f[f.length - 1].odo : 0 }; })
    .sort((a, b) => b.odo - a.odo).slice(0, 5);
  const maxOdo = meters.length ? meters[0].odo : 1;

  // inspections
  const insp30 = db.inspections.filter(i => (now - new Date(i.date)) / 86400000 <= 30).length;
  const items = db.inspections.reduce((s, i) => s + i.results.length, 0);
  const fails = db.inspections.reduce((s, i) => s + i.results.filter(r => !r.ok).length, 0);
  const failRate = items ? Math.round(fails / items * 100) : 0;
  const onTime = rs.length ? Math.round(rs.filter(r => !r.overdue).length / rs.length * 100) : 100;

  // tyres
  const worn = db.vehicles.reduce((n, v) => n + Object.values(latestReadings(v.id)).filter(r => r.treadDepth <= minTread()).length, 0);

  // breakdown ageing (open issues by age bucket)
  const ages = [0, 0, 0, 0];
  openIss.forEach(i => {
    if (!i.createdAt) return;
    const d = (now - new Date(i.createdAt)) / 86400000;
    if (d <= 7) ages[0]++; else if (d <= 30) ages[1]++; else if (d <= 90) ages[2]++; else ages[3]++;
  });

  // inspection item failures per month
  const failM = months.map(m => db.inspections.filter(i => i.date && i.date.startsWith(m))
    .reduce((s, i) => s + i.results.filter(r => !r.ok).length, 0));

  // regulatory non-compliance by document type (+ driver DLs)
  const regRows = Object.entries(DOC_LABELS).map(([k, label]) => {
    let o = 0, s = 0;
    db.vehicles.forEach(v => {
      const till = v.compliance && v.compliance[k];
      if (!till) return;
      const d = daysUntil(till);
      if (d < 0) o++; else if (d <= warnDays()) s++;
    });
    return { label, o, s };
  });
  let dlO = 0, dlS = 0;
  db.drivers.forEach(d => {
    if (!d.dlExpiry) return;
    const x = daysUntil(d.dlExpiry);
    if (x < 0) dlO++; else if (x <= warnDays()) dlS++;
  });
  regRows.push({ label: "Driver DL", o: dlO, s: dlS });

  // recent activity
  const acts = [
    ...db.issues.map(i => ({ d: i.resolvedAt || i.createdAt, t: `${vName(i.vehicleId)} — ${i.title} (${i.status})`, ic: i.status === "Resolved" ? "checkCircle" : "wrench" })),
    ...db.workOrders.filter(w => w.completedAt).map(w => ({ d: w.completedAt, t: `Job card closed: ${w.title} · ${fmtINR(w.finalCost || 0)}`, ic: "checkCircle" })),
    ...db.inspections.map(i => ({ d: i.date, t: `Inspection ${i.passed ? "passed" : "failed"} — ${vName(i.vehicleId)}`, ic: "clipboardCheck" }))
  ].filter(a => a.d).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6);

  const R = "#c62828", A = "#b26a00", G = "#148a4e", N = "#0f1e33";
  grid.innerHTML = [
    dw("Service Reminders", dwPair(remO, "Overdue", remO ? R : G, remS, "Due Soon", remS ? A : G)),
    dw("Vehicle Renewals · RTO", dwPair(vrO, "Overdue", vrO ? R : G, vrS, "Due Soon", vrS ? A : G)),
    dw("Driver Renewals · DL", dwPair(drO, "Overdue", drO ? R : G, drS, "Due Soon", drS ? A : G)),
    dw("Warranties", dwPair(wtO, "Expired", wtO ? R : G, wtS, "Expiring", wtS ? A : G)),
    dw("Open Issues", `<div class="dw-pair"><div><span class="dw-big">${openIss.length}</span><span class="dw-sub">Open now</span></div><div><span class="dw-big" style="color:${highOpen ? R : G}">${highOpen}</span><span class="dw-sub">Critical</span></div></div>` + miniBars(issM, mL, PAL.serious)),
    dw("Time to Resolve", `<span class="dw-big">${avgResolve ? avgResolve.toFixed(1) : "—"}<small>days</small></span><span class="dw-sub">Average, resolved issues</span>`),
    dw("Job Cards", dwPair(openWO.length, "In workshop", openWO.length ? A : G, oldestWO, "Oldest (days)", oldestWO > 5 ? R : N)),
    dw("Vehicle Status", dwPair(db.vehicles.length - inShop, "Active", G, inShop, "In Shop", inShop ? A : G)),
    dw("Assignments", dwPair(assigned, "Assigned", N, Math.max(db.vehicles.length - assigned, 0), "Unassigned", db.vehicles.length - assigned ? A : G)),
    dw("On-Time Maintenance", `<span class="dw-big" style="color:${onTime >= 90 ? G : onTime >= 70 ? A : R}">${onTime}%</span><span class="dw-sub">PM schedules on time</span>`),
    dw("Inspections · 30 days", dwPair(insp30, "Submitted", N, failRate + "%", "Item fail rate", failRate ? A : G)),
    dw("Tyre Health", `<span class="dw-big" style="color:${worn ? R : G}">${worn}</span><span class="dw-sub">Tyres at/under ${minTread()}mm</span>`),
    dw("Breakdown Ageing", miniBars(ages, ["≤7d", "8–30", "31–90", ">90d"], PAL.serious) + `<span class="dw-sub">${openIss.length} open issue${openIss.length === 1 ? "" : "s"} by age</span>`),
    dw("Inspection Failures", miniBars(failM, mL, PAL.critical) + `<span class="dw-sub">Failed checklist items per month</span>`),
    dw("Regulatory Non-Compliance", regRows.map(r =>
      `<div class="dw-rank"><span class="dw-rank-l">${esc(r.label)}</span><span class="dw-rank-v" style="color:${r.o ? R : G}">${r.o} overdue</span><span class="dw-rank-v" style="color:${r.s ? A : G}">${r.s} due soon</span></div>`).join(""), "dw-w2"),
    dw("Latest Meter Readings", meters.map(m =>
      `<div class="dw-rank"><span class="dw-rank-l">${esc(m.name)}</span><span class="dw-rank-bar"><i style="width:${Math.round(m.odo / maxOdo * 100)}%"></i></span><span class="dw-rank-v">${m.odo.toLocaleString("en-IN")} km</span></div>`).join("") || "<span class='dw-sub'>No fuel logs yet</span>", "dw-w2"),
    dw("Recent Activity", acts.map(a =>
      `<div class="dw-act">${FWIcon(a.ic, { size: 14, cls: "ic-muted" })}<span>${esc(a.t)}</span><time>${fmtDate(a.d)}</time></div>`).join("") || "<span class='dw-sub'>No activity yet</span>", "dw-w2")
  ].join("");

  // cost widgets live on the FleetFin dashboard
  const finGrid = document.getElementById("finGrid");
  if (finGrid) finGrid.innerHTML = [
    dw("Fuel Costs", miniBars(fuelM, mL, PAL.s1) + `<span class="dw-sub">This month: <strong>${fmtINR(fuelM[fuelM.length - 1])}</strong></span>`),
    dw("Service Costs", miniBars(svcM, mL, PAL.s3) + `<span class="dw-sub">This month: <strong>${fmtINR(svcM[svcM.length - 1])}</strong></span>`),
    dw("Total Costs", miniBars(totM, mL, PAL.s2) + `<span class="dw-sub">6-month total: <strong>${fmtINR(totM.reduce((a, b) => a + b, 0))}</strong></span>`),
    dw("Cost per km", `<span class="dw-big">₹${cpk ? cpk.toFixed(1) : "—"}</span><span class="dw-sub">All-in, from ${km.toLocaleString("en-IN")} km logged</span>`),
    dw("Top Repair Spend", topCats.map(([c, amt]) =>
      `<div class="dw-rank"><span class="dw-rank-l">${esc(c)}</span><span class="dw-rank-bar"><i style="width:${Math.round(amt / maxCat * 100)}%"></i></span><span class="dw-rank-v">${fmtINR(amt)}</span></div>`).join("") || "<span class='dw-sub'>No expenses yet</span>", "dw-w2"),
    dw("Recurrent Expenses", Object.entries(byCat)
      .map(([c, amt]) => ({ c, amt, n: db.expenses.filter(e => e.category === c).length }))
      .filter(x => x.n >= 3).sort((a, b) => b.n - a.n).slice(0, 5)
      .map(x => `<div class="dw-rank"><span class="dw-rank-l">${esc(x.c)}</span><span class="dw-rank-v">${x.n}×</span><span class="dw-rank-v">avg ${fmtINR(x.amt / x.n)}</span></div>`).join("") || "<span class='dw-sub'>No repeating categories yet</span>", "dw-w2")
  ].join("");

  const upd = document.getElementById("dashUpdated");
  if (upd) upd.textContent = "Live · updated " + now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function renderOverview() {
  const insights = computeInsights();
  renderDashboard();

  const sevColor = s => s >= 4 ? PAL.critical : s === 3 ? PAL.serious : s === 2 ? PAL.warn : s === 1 ? PAL.s1 : PAL.good;
  // severity -> [icon name, tile colour class] : one professional SVG per row
  const sevIcon = s => s >= 4 ? ["alert", "danger"] : s === 3 ? ["shieldAlert", "warning"] :
    s === 2 ? ["eye", "info"] : s === 1 ? ["bell", "brand"] : ["shieldCheck", "success"];
  document.getElementById("insightsFeed").innerHTML = insights.map(i => {
    const [ic, tone] = sevIcon(i.sev);
    return `
    <div class="insight-row" style="border-left-color:${sevColor(i.sev)}">
      <span class="ic-tile ${tone}">${FWIcon(ic, { size: 20 })}</span>
      <div>
        <div class="insight-title">${esc(i.title)} <span class="insight-tag">${esc(i.tag)}</span></div>
        <div class="insight-detail">${esc(i.detail)}</div>
      </div>
    </div>`; }).join("");
}

// ---------- Render: trips & revenue ----------
function renderTrips() {
  const tbl = document.getElementById("tripsTable"), pt = document.getElementById("profitTable");
  if (!tbl || !pt) return;
  const trips = [...(db.trips || [])].sort((a, b) => b.date.localeCompare(a.date));
  tbl.innerHTML = trips.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Route</th><th>Freight</th></tr></thead><tbody>` +
    trips.slice(0, 50).map(t => `<tr><td>${fmtDate(t.date)}</td><td><strong>${esc(vName(t.vehicleId))}</strong></td><td>${esc(t.from)} &rarr; ${esc(t.to)}</td><td><strong>${fmtINR(t.freight)}</strong></td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No trips yet — log your first load above and profit-per-vehicle lights up.</p>";
  const rows = db.vehicles.map(v => {
    const vt = (db.trips || []).filter(t => t.vehicleId === v.id);
    if (!vt.length) return null;
    const from = vt.map(t => t.date).sort()[0]; // compare cost over the same window as logged trips
    const rev = vt.reduce((s, t) => s + t.freight, 0);
    const cost = db.expenses.filter(e => e.vehicleId === v.id && e.date >= from).reduce((s, e) => s + e.amount, 0) +
      (db.fuelLogs || []).filter(f => f.vehicleId === v.id && f.date >= from).reduce((s, f) => s + f.amount, 0);
    return { v, rev, cost, profit: rev - cost };
  }).filter(Boolean).sort((a, b) => b.profit - a.profit);
  pt.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Freight earned</th><th>All-in cost</th><th>Profit</th><th>Margin</th></tr></thead><tbody>` +
    rows.map(r => {
      const m = r.rev ? Math.round(r.profit / r.rev * 100) : null;
      const good = r.profit >= 0;
      return `<tr><td><strong>${esc(r.v.name)}</strong></td><td>${fmtINR(r.rev)}</td><td>${fmtINR(r.cost)}</td>
        <td style="color:${good ? "#006300" : PAL.critical}"><strong>${good ? "" : "−"}${fmtINR(Math.abs(r.profit))}</strong></td>
        <td>${m === null ? "—" : `<span class="fw-badge ${m >= 25 ? "ok" : m >= 0 ? "soon" : "overdue"}">${m}%</span>`}</td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>Nothing to compare yet.</p>";
}

// ---------- Render: driver khata ----------
const KHATA_LABEL = { advance: "Advance given", expense: "Trip expense", settlement: "Cash returned" };
function renderKhata() {
  const bal = document.getElementById("khataBalances"), tbl = document.getElementById("khataTable");
  if (!bal || !tbl) return;
  const sel = document.getElementById("khataDriver");
  if (sel) {
    const keep = sel.value;
    sel.innerHTML = db.drivers.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  }
  const ledger = db.driverLedger || [];
  bal.innerHTML = db.drivers.length ?
    `<table class="chart-table-el"><thead><tr><th>Driver</th><th>Advances</th><th>Expenses</th><th>Returned</th><th>With driver</th></tr></thead><tbody>` +
    db.drivers.map(d => {
      const sum = type => ledger.filter(l => l.driverId === d.id && l.type === type).reduce((s, l) => s + l.amount, 0);
      const adv = sum("advance"), exp = sum("expense"), set = sum("settlement");
      const b = adv - exp - set;
      return `<tr><td><strong>${esc(d.name)}</strong>${d.vehicleId ? "<br /><span class='muted'>" + esc(vName(d.vehicleId)) + "</span>" : ""}</td>
        <td>${fmtINR(adv)}</td><td>${fmtINR(exp)}</td><td>${fmtINR(set)}</td>
        <td><span class="fw-badge ${b > 0 ? "soon" : "ok"}">${b < 0 ? "−" : ""}${fmtINR(Math.abs(b))}</span></td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>Add drivers first — the khata tracks advances against each driver.</p>";
  const rows = [...ledger].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  tbl.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Driver</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead><tbody>` +
    rows.map(l => {
      const d = db.drivers.find(x => x.id === l.driverId);
      return `<tr><td>${fmtDate(l.date)}</td><td><strong>${d ? esc(d.name) : "—"}</strong></td><td>${KHATA_LABEL[l.type] || l.type}</td><td>${fmtINR(l.amount)}</td><td>${esc(l.note || "")}</td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>No khata entries yet.</p>";
}

// ---------- Vehicle Health Score (0–100) ----------
// One number per truck: compliance + open issues + inspections + tyres +
// overdue PM + cost deviation + overdue predictions. Higher is healthier.
function healthScore(v) {
  let s = 100;
  const c = v.compliance || {};
  Object.keys(DOC_LABELS).forEach(k => {
    if (!c[k]) return;
    const d = daysUntil(c[k]);
    if (d < 0) s -= 12; else if (d <= warnDays()) s -= 4;
  });
  let pen = 0;
  db.issues.filter(i => i.vehicleId === v.id && i.status !== "Resolved")
    .forEach(i => pen += i.severity === "High" ? 12 : i.severity === "Medium" ? 6 : 3);
  s -= Math.min(pen, 30);
  const insp = db.inspections.filter(i => i.vehicleId === v.id).sort((a, b) => a.date.localeCompare(b.date));
  if (insp.length && !insp[insp.length - 1].passed) s -= 10;
  const worn = Object.values(latestReadings(v.id)).filter(r => r.treadDepth <= minTread()).length;
  s -= Math.min(worn * 6, 12);
  s -= Math.min(reminderStatus().filter(r => r.vehicleId === v.id && r.overdue).length * 5, 10);
  if (typeof vehicleStats === "function") {
    const vs = vehicleStats().filter(x => x.costPerKm > 0);
    const avg = vs.length ? vs.reduce((a, b) => a + b.costPerKm, 0) / vs.length : 0;
    const me = vs.find(x => x.id === v.id);
    if (me && avg) { const dev = (me.costPerKm - avg) / avg; if (dev > 0.4) s -= 15; else if (dev > 0.2) s -= 10; }
  }
  if (typeof predictParts === "function")
    s -= Math.min(predictParts().filter(p => p.vehicle.id === v.id && p.lifeUsed >= 1).length * 8, 16);
  return Math.max(5, Math.round(s));
}
function healthColor(s) { return s >= 80 ? PAL.good : s >= 60 ? PAL.warn : PAL.critical; }
function healthBadge(s) {
  return `<span class="fw-badge ${s >= 80 ? "ok" : s >= 60 ? "soon" : "overdue"}" title="Health score">${s}/100</span>`;
}

function renderHealth() {
  const el = document.getElementById("healthStrip");
  if (!el) return;
  if (!db.vehicles.length) { el.innerHTML = "<p class='muted'>Add vehicles to see their health scores.</p>"; return; }
  const scored = db.vehicles.map(v => ({ v, s: healthScore(v) })).sort((a, b) => a.s - b.s);
  const avg = Math.round(scored.reduce((a, b) => a + b.s, 0) / scored.length);
  el.innerHTML =
    `<div class="hp-chip hp-avg"><span class="hp-score" style="background:${healthColor(avg)}">${avg}</span><span class="hp-name">Fleet average</span><span class="muted hp-sub">weakest first</span></div>` +
    scored.map(x => `<div class="hp-chip"><span class="hp-score" style="background:${healthColor(x.s)}">${x.s}</span><span class="hp-name">${esc(x.v.name)}</span><span class="muted hp-sub">${esc(x.v.type)}</span></div>`).join("");
}

// ---------- Action Inbox (Home) — everything pending, across all workspaces ----------
function renderActionInbox() {
  const el = document.getElementById("actionInbox");
  if (!el) return;
  const items = [];
  radarItems().forEach(i => {
    if (i.days < 0) items.push({ p: 0, ic: "alert", tone: "danger", t: `${i.type} for ${i.entity} expired ${-i.days} day${-i.days === 1 ? "" : "s"} ago`, a: "Renew", tab: "radar" });
    else if (i.days <= warnDays()) items.push({ p: 2, ic: "clock", tone: "warning", t: `${i.type} for ${i.entity} due in ${i.days}d`, a: "Plan", tab: "radar" });
  });
  db.issues.filter(i => i.status !== "Resolved" && i.severity === "High").forEach(i =>
    items.push({ p: 0, ic: "wrench", tone: "danger", t: `Critical issue on ${vName(i.vehicleId)}: ${i.title}`, a: "Fix", tab: "issues" }));
  db.workOrders.filter(w => w.status !== "Completed").forEach(w => {
    const age = Math.round((new Date() - new Date(w.createdAt)) / 86400000);
    if (age > 5) items.push({ p: 1, ic: "tools", tone: "warning", t: `Job card "${w.title}" (${vName(w.vehicleId)}) open ${age} days`, a: "Chase", tab: "workorders" });
  });
  if (typeof predictParts === "function")
    predictParts().filter(p => p.lifeUsed >= 1).slice(0, 3).forEach(p =>
      items.push({ p: 1, ic: "trendUp", tone: "warning", t: `${p.category} on ${p.vehicle.name} past predicted life — ~${fmtINR(p.estCost)} planned`, a: "Book", tab: "analytics" }));
  if (typeof fuelTheftFlags === "function")
    fuelTheftFlags().slice(0, 3).forEach(f =>
      items.push({ p: 0, ic: "fuel", tone: "danger", t: `${f.vehicle}: ≈${Math.round(f.missing)} L diesel unaccounted on ${fmtDate(f.date)} (~${fmtINR(f.cost)})`, a: "Check", tab: "fin" }));
  items.sort((a, b) => a.p - b.p);
  el.innerHTML = items.length ?
    items.slice(0, 10).map(i => `<div class="pred-row inbox-row" data-goto="${i.tab}"><div class="pred-main" style="display:flex;align-items:center;gap:10px;font-size:0.88rem"><span class="ic-tile ${i.tone}" style="width:30px;height:30px;flex:none">${FWIcon(i.ic, { size: 15 })}</span><span style="flex:1;min-width:0;text-align:left">${esc(i.t)}</span><span class="link-btn" style="flex:none">${i.a} &rarr;</span></div></div>`).join("") +
      (items.length > 10 ? `<p class="muted" style="padding:8px 16px">+ ${items.length - 10} more inside the workspaces</p>` : "")
    : `<p class="muted" style="padding:14px 16px">${FWIcon("checkCircle", { size: 14, cls: "ic-success" })} All clear — nothing pending today.</p>`;
  el.querySelectorAll(".inbox-row").forEach(r => r.addEventListener("click", () =>
    document.querySelector(`#tabBar .tab-btn[data-tab="${r.dataset.goto}"]`)?.click()));
}

// ---------- Driver Link (no-login entry page for drivers) ----------
function copyDriverLink(driverId) {
  const d = db.drivers.find(x => x.id === driverId);
  if (!d) return;
  const ownerId = window.fwCloud && fwCloud.uid && fwCloud.uid();
  if (!ownerId) { alert("Sign in to your FleetWorks account first — driver links send entries to your cloud fleet."); return; }
  if (!d.linkToken) { d.linkToken = uid(); saveStore(); }
  const veh = d.vehicleId ? vName(d.vehicleId) : "";
  const url = location.origin + location.pathname.replace(/[^/]*$/, "driver.html") +
    "?o=" + encodeURIComponent(ownerId) + "&t=" + encodeURIComponent(d.linkToken) +
    "&n=" + encodeURIComponent(d.name) + "&v=" + encodeURIComponent(veh);
  const done = () => alert("Driver link copied!\n\nSend it to " + d.name + " on WhatsApp. From that page they can log diesel fills, report problems and submit the daily check — no app, no login.");
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("Copy this driver link:", url));
  else prompt("Copy this driver link:", url);
}

// ---------- Render: vehicles & compliance ----------
function complianceCell(till) {
  if (!till) return `<td class="comp-cell"><span class="fw-badge upcoming">Not set</span></td>`;
  const d = daysUntil(till);
  const [cls, ic, label] = d < 0 ? ["overdue", "alert", "Expired"] :
    d <= 30 ? ["soon", "clock", d + "d left"] : ["ok", "shieldCheck", fmtDate(till)];
  return `<td class="comp-cell"><span class="fw-badge ${cls}" title="${fmtDate(till)}">${FWIcon(ic, { size: 13 })}${label}</span></td>`;
}
function renderVehicles() {
  const rows = db.vehicles.map(v => {
    const c = v.compliance || {};
    const driver = db.drivers.find(d => d.vehicleId === v.id);
    return `<tr class="veh-row" data-vid="${v.id}" style="cursor:pointer">
      <td><strong>${esc(v.name)}</strong><br /><span class="muted">${esc(v.type)} · ${v.kmPerMonth.toLocaleString("en-IN")} km/mo${driver ? " · " + FWIcon("driver", { size: 13, cls: "ic-muted" }) + " " + esc(driver.name) : ""}</span></td>
      <td>${healthBadge(healthScore(v))}</td>
      ${complianceCell(c.insurance)}${complianceCell(c.puc)}${complianceCell(c.fitness)}${complianceCell(c.permit)}${complianceCell(c.roadtax)}</tr>
      <tr class="veh-history" data-hist="${v.id}" hidden><td colspan="7" style="background:#f8fafc">${serviceHistoryHTML(v.id)}</td></tr>`;
  }).join("");
  document.getElementById("vehicleComplianceTable").innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Health</th><th>Insurance</th><th>PUC</th><th>Fitness</th><th>Permit</th><th>Road Tax</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.querySelectorAll(".veh-row").forEach(r => r.addEventListener("click", () => {
    const hist = document.querySelector(`[data-hist="${r.dataset.vid}"]`);
    hist.hidden = !hist.hidden;
  }));
}

function serviceHistoryHTML(vid) {
  const events = [
    ...db.expenses.filter(e => e.vehicleId === vid).map(e => ({ date: e.date, txt: `${e.category} — ${fmtINR(e.amount)}`, icon: FWIcon("receipt", { size: 14, cls: "ic-muted" }) })),
    ...db.workOrders.filter(w => w.vehicleId === vid && w.status === "Completed").map(w => ({ date: w.completedAt, txt: `Job card: ${w.title} at ${w.vendor || "workshop"} — ${fmtINR(w.finalCost || 0)}`, icon: FWIcon("wrench", { size: 14, cls: "ic-warning" }) })),
    ...db.inspections.filter(i => i.vehicleId === vid).map(i => ({ date: i.date, txt: `Inspection — ${i.passed ? "passed" : i.results.filter(r => !r.ok).length + " fault(s)"}`, icon: FWIcon(i.passed ? "checkCircle" : "xCircle", { size: 14, cls: i.passed ? "ic-success" : "ic-danger" }) }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const total = db.expenses.filter(e => e.vehicleId === vid).reduce((s, e) => s + e.amount, 0);
  return `<div style="padding:6px 4px"><strong style="font-size:0.85rem">Service history</strong> <span class="muted">· lifetime spend ${fmtINR(total)}</span><br />` +
    (events.length ? events.map(ev => `<span style="display:block;font-size:0.82rem;margin-top:5px">${ev.icon} ${fmtDate(ev.date)} — ${esc(ev.txt)}</span>`).join("") : "<span class='muted'>No history yet.</span>") + "</div>";
}

// ---------- Render: drivers ----------
function renderDrivers() {
  document.getElementById("driversTable").innerHTML = db.drivers.length ?
    `<table class="chart-table-el"><thead><tr><th>Driver</th><th>DL Number</th><th>DL Validity</th><th>Assigned Vehicle</th><th>Driver Link</th></tr></thead><tbody>` +
    db.drivers.map(d => {
      const days = d.dlExpiry ? daysUntil(d.dlExpiry) : null;
      const pill = days === null ? '<span class="fw-badge upcoming">Not set</span>' :
        days < 0 ? '<span class="fw-badge overdue">' + FWIcon("alert", { size: 13 }) + 'Expired</span>' :
        days <= 30 ? `<span class="fw-badge soon">${FWIcon("clock", { size: 13 })}${days}d left</span>` :
        `<span class="fw-badge ok">${FWIcon("shieldCheck", { size: 13 })}${fmtDate(d.dlExpiry)}</span>`;
      return `<tr><td><strong>${esc(d.name)}</strong>${d.phone ? "<br /><span class='muted'>" + FWIcon("phone", { size: 13, cls: "ic-muted" }) + " " + esc(d.phone) + "</span>" : ""}</td>
        <td>${esc(d.dlNo)}</td><td>${pill}</td><td>${d.vehicleId ? esc(vName(d.vehicleId)) : "<span class='muted'>—</span>"}</td>
        <td><button class="link-btn" onclick="copyDriverLink('${d.id}')">${FWIcon("link", { size: 13 })} Copy link</button></td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>No drivers added yet.</p>";
}

// ---------- Render: work orders (job cards) ----------
function renderWorkOrders() {
  const open = db.workOrders.filter(w => w.status !== "Completed");
  const done = db.workOrders.filter(w => w.status === "Completed").slice(-5).reverse();
  document.getElementById("workOrdersList").innerHTML = (open.length ? open.map(w => `
    <div class="pred-row">
      <div class="pred-main"><span class="fw-chip is-pending"><span class="dot"></span>In workshop</span> <strong>${esc(vName(w.vehicleId))}</strong> — ${esc(w.title)}</div>
      <div class="pred-detail">
        <span>${w.vendor ? esc(w.vendor) + " · " : ""}opened ${fmtDate(w.createdAt)}${w.estCost ? " · est. " + fmtINR(w.estCost) : ""}</span>
        <button class="link-btn" onclick="completeWorkOrder('${w.id}')">${FWIcon("check", { size: 14 })} Complete &amp; Bill</button>
      </div>
    </div>`).join("") : "<p class='muted'>No open job cards.</p>") +
    (done.length ? `<details class="chart-table"><summary>Completed job cards (${done.length})</summary>` +
      done.map(w => `<p class="muted" style="margin:6px 0">${FWIcon("checkCircle", { size: 14, cls: "ic-success" })} ${esc(vName(w.vehicleId))} — ${esc(w.title)} · ${fmtINR(w.finalCost || 0)} (${fmtDate(w.completedAt)})</p>`).join("") + "</details>" : "");
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
        <label class="chip"><input type="radio" name="item${i}" value="ok" checked /><span>${FWIcon("check", { size: 14, cls: "ic-success" })} OK</span></label>
        <label class="chip"><input type="radio" name="item${i}" value="fail" /><span>${FWIcon("close", { size: 14, cls: "ic-danger" })} Fault</span></label>
      </div>
    </div>`).join("");
}
function renderInspectionHistory() {
  const hist = [...db.inspections].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  document.getElementById("inspectionHistory").innerHTML = hist.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Result</th><th>Faults</th></tr></thead><tbody>` +
    hist.map(i => `<tr><td>${fmtDate(i.date)}</td><td>${esc(vName(i.vehicleId))}</td>
      <td>${i.passed ? '<span class="fw-badge ok">' + FWIcon("checkCircle", { size: 13 }) + 'Passed</span>' : '<span class="fw-badge overdue">' + FWIcon("alert", { size: 13 }) + i.results.filter(r => !r.ok).length + " fault(s)</span>"}</td>
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
        <span class="fw-badge ${i.severity === "High" ? "high" : i.severity === "Medium" ? "medium" : "low"}">${esc(i.severity)}</span>
      </div>
      <div class="pred-detail">
        <span>Reported ${fmtDate(i.createdAt)}${i.source ? " · via " + esc(i.source) : ""}${i.status === "In Progress" ? " · <em>job card open</em>" : ""}</span>
        ${i.status !== "In Progress" ? `<button class="link-btn" onclick="createWorkOrder('${i.id}')">${FWIcon("wrench", { size: 14 })} Open Job Card</button>` : ""}
        <button class="link-btn" onclick="resolveIssue('${i.id}')">${FWIcon("check", { size: 14 })} Mark Resolved</button>
      </div>
    </div>`).join("") : "<p class='muted'>No open issues.</p>") +
    (resolved.length ? `<details class="chart-table"><summary>Recently resolved (${resolved.length})</summary>` +
      resolved.map(i => `<p class="muted" style="margin:6px 0">${FWIcon("checkCircle", { size: 14, cls: "ic-success" })} ${esc(vName(i.vehicleId))} — ${esc(i.title)} (${fmtDate(i.resolvedAt)})</p>`).join("") + "</details>" : "");
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
    const cls = r.overdue ? "overdue" : r.dueSoon ? "soon" : "ok";
    const bic = r.overdue ? "alert" : r.dueSoon ? "clock" : "checkCircle";
    const label = r.overdue ? `Overdue by ${-d} days` : d === 0 ? "Due today" : `Due in ${d} days`;
    return `<div class="pred-row">
      <div class="pred-main"><span><strong>${esc(vName(r.vehicleId))}</strong> — ${esc(r.task)}</span>
        <span class="fw-badge ${cls}">${FWIcon(bic, { size: 13 })}${label}</span></div>
      <div class="pred-detail"><span>Every ${r.everyMonths} months · last done ${fmtDate(r.lastDate)} · next ${fmtDate(r.nextDate)}</span>
        <button class="link-btn" onclick="completeReminder('${r.id}')">${FWIcon("check", { size: 14 })} Done Today</button></div>
    </div>`;
  }).join("") : "<p class='muted'>No PM schedules yet — add one below.</p>";
}
function completeReminder(id) {
  const r = db.reminders.find(x => x.id === id);
  if (r) { r.lastDate = new Date().toISOString().slice(0, 10); saveStore(); renderReminders(); renderOverview(); }
}

// ---------- Render: parts ----------
function warrantyPill(dateStr) {
  if (!dateStr) return '<span class="fw-badge upcoming">Not set</span>';
  const d = daysUntil(dateStr);
  if (d < 0) return '<span class="fw-badge overdue">' + FWIcon("alert", { size: 13 }) + 'Expired</span>';
  if (d <= 30) return `<span class="fw-badge soon">${FWIcon("clock", { size: 13 })}${d}d left</span>`;
  return `<span class="fw-badge ok">${FWIcon("shieldCheck", { size: 13 })}Till ${fmtDate(dateStr)}</span>`;
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
    ["Vendor contact", p.vendorContact || null],
    ["Storage location", p.location],
    ["Purchase date", p.purchaseDate ? fmtDate(p.purchaseDate) : null],
    ["Warranty expiry", p.warrantyExpiry ? fmtDate(p.warrantyExpiry) : null]
  ].filter(([, v]) => v);
  return `<div style="padding:6px 4px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 18px">` +
    (rows.length ? rows.map(([label, v]) => `<span style="font-size:0.82rem"><strong>${esc(label)}:</strong> ${esc(v)}</span>`).join("")
      : "<span class='muted'>No further details recorded.</span>") + "</div>";
}

// ---------- Render: Compliance Radar (unified renewals) ----------
// Aggregate every dated renewal in the fleet into one urgency-ranked list.
function radarItems() {
  const items = [];
  const push = (cat, entity, type, date) => { if (date) items.push({ cat, entity, type, date, days: daysUntil(date) }); };
  db.vehicles.forEach(v => {
    const c = v.compliance || {};
    push("vehicle", v.name, "Insurance", c.insurance);
    push("vehicle", v.name, "PUC", c.puc);
    push("vehicle", v.name, "Fitness (FC)", c.fitness);
    push("vehicle", v.name, "National Permit", c.permit);
    push("vehicle", v.name, "Road Tax", c.roadtax);
  });
  db.documents.forEach(d => {
    const name = d.entityType === "driver"
      ? (db.drivers.find(x => x.id === d.entityId) || {}).name
      : (db.vehicles.find(x => x.id === d.entityId) || {}).name;
    push(d.entityType, name || "—", d.docType, d.expiryDate);
  });
  db.drivers.forEach(dr => push("driver", dr.name, "Driving Licence", dr.dlExpiry));
  db.parts.forEach(p => push("warranty", p.name, "Warranty", p.warrantyExpiry));
  reminderStatus().forEach(r => push("maintenance", vName(r.vehicleId), r.task, r.nextDate));
  // de-dup: a vehicle doc and a compliance field of the same type/entity — keep the earlier
  return items.sort((a, b) => a.days - b.days);
}
function radarBadge(days) {
  if (days < 0) return `<span class="fw-badge overdue">${FWIcon("alert", { size: 13 })}Overdue ${-days}d</span>`;
  if (days <= warnDays()) return `<span class="fw-badge soon">${FWIcon("clock", { size: 13 })}${days === 0 ? "Due today" : days + "d left"}</span>`;
  return `<span class="fw-badge ok">${FWIcon("shieldCheck", { size: 13 })}${days}d</span>`;
}
const RADAR_ICON = { vehicle: "truck", driver: "driver", warranty: "shieldCheck", maintenance: "calendarClock" };
let radarFilter = "all";
function renderRadar() {
  const all = radarItems();
  const overdue = all.filter(i => i.days < 0).length;
  const soon = all.filter(i => i.days >= 0 && i.days <= warnDays()).length;
  const ok = all.length - overdue - soon;
  document.getElementById("radarStats").innerHTML = `
    <div class="stat-tile"><span class="ic-tile danger">${FWIcon("alert", { size: 22 })}</span><span class="stat-label">Overdue now</span><span class="stat-value" style="color:${overdue ? PAL.critical : PAL.good}">${overdue}</span><span class="stat-sub">renew immediately</span></div>
    <div class="stat-tile"><span class="ic-tile warning">${FWIcon("clock", { size: 22 })}</span><span class="stat-label">Due within ${warnDays()} days</span><span class="stat-value">${soon}</span><span class="stat-sub">plan renewals</span></div>
    <div class="stat-tile"><span class="ic-tile success">${FWIcon("shieldCheck", { size: 22 })}</span><span class="stat-label">In good standing</span><span class="stat-value">${ok}</span><span class="stat-sub">no action needed</span></div>
    <div class="stat-tile"><span class="ic-tile brand">${FWIcon("bell", { size: 22 })}</span><span class="stat-label">Total tracked</span><span class="stat-value">${all.length}</span><span class="stat-sub">renewals on radar</span></div>`;

  const filters = [["all", "All"], ["overdue", "Overdue"], ["soon", "Due soon"], ["vehicle", "Vehicle docs"], ["driver", "Driver docs"], ["warranty", "Warranty"], ["maintenance", "Maintenance"]];
  document.getElementById("radarFilters").innerHTML = filters.map(([k, l]) =>
    `<button class="radar-chip${radarFilter === k ? " active" : ""}" data-rf="${k}">${l}</button>`).join("");

  let rows = all;
  if (radarFilter === "overdue") rows = all.filter(i => i.days < 0);
  else if (radarFilter === "soon") rows = all.filter(i => i.days >= 0 && i.days <= warnDays());
  else if (["vehicle", "driver", "warranty", "maintenance"].includes(radarFilter)) rows = all.filter(i => i.cat === radarFilter);

  document.getElementById("radarTable").innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Entity</th><th>Renewal</th><th>Valid Till</th><th>Status</th></tr></thead><tbody>` +
    rows.map(i => `<tr>
      <td><span class="cell-ic">${FWIcon(RADAR_ICON[i.cat] || "document", { size: 15, cls: "ic-muted" })}<strong>${esc(i.entity)}</strong></span></td>
      <td>${esc(i.type)}</td>
      <td>${fmtDate(i.date)}</td>
      <td>${radarBadge(i.days)}</td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>Nothing in this view. Add vehicle compliance dates, documents or driver licences to populate the radar.</p>";
}

// ---------- Render: Document Vault ----------
function docTypeOptions(entityType) {
  return (DOC_TYPES[entityType] || DOC_TYPES.vehicle).map(t => `<option>${t}</option>`).join("");
}
function fillDocEntitySelect() {
  const type = document.getElementById("docEntityType").value;
  const list = type === "driver" ? db.drivers : db.vehicles;
  document.getElementById("docEntitySelect").innerHTML =
    list.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("") ||
    `<option value="">No ${type}s added yet</option>`;
  document.getElementById("docTypeSelect").innerHTML = docTypeOptions(type);
}
function renderDocuments() {
  const rows = [...db.documents].sort((a, b) => (a.expiryDate || "").localeCompare(b.expiryDate || ""));
  document.getElementById("documentsTable").innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Attached To</th><th>Document</th><th>Number</th><th>Valid Till</th><th></th></tr></thead><tbody>` +
    rows.map(d => {
      const name = d.entityType === "driver"
        ? (db.drivers.find(x => x.id === d.entityId) || {}).name
        : (db.vehicles.find(x => x.id === d.entityId) || {}).name;
      const days = d.expiryDate ? daysUntil(d.expiryDate) : null;
      const badge = days === null ? '<span class="fw-badge upcoming">No expiry</span>' : radarBadge(days);
      return `<tr>
        <td><span class="cell-ic">${FWIcon(d.entityType === "driver" ? "driver" : "truck", { size: 15, cls: "ic-muted" })}<strong>${esc(name || "—")}</strong></span></td>
        <td>${esc(d.docType)}</td>
        <td>${d.number ? esc(d.number) : "<span class='muted'>—</span>"}</td>
        <td>${d.expiryDate ? fmtDate(d.expiryDate) + " " : ""}${badge}</td>
        <td><button class="icon-btn" title="Delete" onclick="deleteDocument('${d.id}')">${FWIcon("trash", { size: 16, cls: "ic-danger" })}</button></td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>No documents stored yet. Add your first RC, insurance or permit below — expiries will show on the Compliance Radar.</p>";
}
function deleteDocument(id) {
  if (!confirm("Delete this document?")) return;
  db.documents = db.documents.filter(d => d.id !== id);
  saveStore(); renderDocuments(); renderRadar(); renderOverview();
}

// ---------- Render: Tyre Health ----------
function latestReadings(vid) {
  const map = {};
  db.tyreReadings.filter(t => t.vehicleId === vid)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(t => { map[t.position] = t; });
  return map;
}
function renderTyres() {
  const sel = document.getElementById("tyreVehicleFilter");
  const vid = sel.value || (db.vehicles[0] && db.vehicles[0].id);
  const box = document.getElementById("tyreLayout");
  if (!vid) { box.innerHTML = "<p class='muted'>Add a vehicle first.</p>"; return; }
  const positions = tyrePositions(vid);
  const latest = latestReadings(vid);
  const worn = positions.filter(p => latest[p] && latest[p].treadDepth <= minTread()).length;
  const cards = positions.map(pos => {
    const r = latest[pos];
    const cls = !r ? "empty" : r.treadDepth <= minTread() ? "bad" : r.treadDepth <= minTread() + 1.5 ? "warn" : "good";
    return `<div class="tyre-cell ${cls}">
      <span class="tyre-pos">${FWIcon("tire", { size: 16 })} ${esc(pos)}</span>
      ${r ? `<span class="tyre-read">${r.treadDepth}mm${r.pressure ? " · " + r.pressure + " psi" : ""}</span>
             <span class="tyre-date">${fmtDate(r.date)}</span>` : `<span class="tyre-read muted">No reading</span>`}
    </div>`;
  }).join("");
  box.innerHTML = `
    <div class="tyre-summary">${worn ? `<span class="fw-badge overdue">${FWIcon("alert", { size: 13 })}${worn} tyre(s) at/under ${minTread()}mm — replace</span>` : `<span class="fw-badge ok">${FWIcon("shieldCheck", { size: 13 })}All tyres above the ${minTread()}mm safe limit</span>`} <span class="muted">Safe limit is set in Settings.</span></div>
    <div class="tyre-grid">${cards}</div>`;
}

// ---------- Render: Settings ----------
function renderSettings() {
  const s = db.settings || {};
  const f = document.getElementById("settingsForm");
  f.businessName.value = s.businessName || "";
  f.gstin.value = s.gstin || "";
  f.city.value = s.city || "";
  f.warnDays.value = s.warnDays || "30";
  f.minTread.value = s.minTread || "";
  f.mileageDropPct.value = s.mileageDropPct || "";
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

  // Documents: a few stored certificates, incl. one expiring soon and a driver doc
  const documents = [
    { id: uid(), entityType: "vehicle", entityId: "v1", docType: "Registration Certificate (RC)", number: "TN01AB1234", issueDate: daysFromNow(-1400), expiryDate: daysFromNow(1200), note: "RTO Chennai Central" },
    { id: uid(), entityType: "vehicle", entityId: "v2", docType: "National Permit", number: "NP-TN-2024-5678", issueDate: daysFromNow(-320), expiryDate: daysFromNow(40), note: "5-year national permit" },
    { id: uid(), entityType: "vehicle", entityId: "v3", docType: "Fitness Certificate (FC)", number: "FC-TN22-3456", issueDate: daysFromNow(-350), expiryDate: daysFromNow(-15), note: "Renew at RTO Salem" },
    { id: uid(), entityType: "vehicle", entityId: "v4", docType: "Green Tax", number: "GT-KA05-7890", issueDate: daysFromNow(-200), expiryDate: daysFromNow(160), note: "" },
    { id: uid(), entityType: "driver", entityId: drivers[1].id, docType: "Medical Certificate", number: "MED-2025-4471", issueDate: daysFromNow(-300), expiryDate: daysFromNow(65), note: "Annual HGV medical" }
  ];

  // Tyre readings: v1 (10-wheeler) fully logged with one worn tyre; v4 (bus) partial
  const tyreReadings = [];
  const v1pos = AXLE_LAYOUTS["Truck (HCV)"];
  const v1tread = [7.8, 8.1, 5.5, 6.0, 5.8, 1.4, 6.6, 6.9, 7.1, 3.0]; // Rear-1 Right Outer worn out, Rear-2 outer getting low
  v1pos.forEach((pos, i) => tyreReadings.push({ id: uid(), vehicleId: "v1", position: pos, treadDepth: v1tread[i], pressure: i < 2 ? 110 : 100, odo: 168000, date: daysFromNow(-4) }));
  const v4pos = AXLE_LAYOUTS["Bus"];
  const v4tread = [6.2, 5.9, 4.1, 4.5, 3.0, 4.8];
  v4pos.forEach((pos, i) => tyreReadings.push({ id: uid(), vehicleId: "v4", position: pos, treadDepth: v4tread[i], pressure: 95, odo: 205000, date: daysFromNow(-2) }));

  const settings = { businessName: "SR Transports", gstin: "", city: "Coimbatore", warnDays: 30, minTread: 1.6, mileageDropPct: 15 };

  // Every third workshop bill came with a proper GST invoice
  expenses.forEach((e, i) => { if (i % 3 === 0) e.gstin = "33ABCDE1234F1Z5"; });

  // Trips & freight revenue, last 6 months
  const trips = [];
  const freightBase = { "Truck (HCV)": [52000, 90000], "Tipper": [30000, 55000], "Bus": [60000, 95000], "LCV": [12000, 26000], "Trailer": [55000, 95000], "Tanker": [50000, 85000] };
  const routes = [["Coimbatore", "Chennai"], ["Salem", "Bengaluru"], ["Coimbatore", "Kochi"], ["Erode", "Hyderabad"], ["Tiruppur", "Mumbai"]];
  vehicles.forEach(v => {
    const [lo, hi] = freightBase[v.type] || [30000, 60000];
    for (let m = 5; m >= 0; m--) {
      const n = 1 + Math.floor(rnd() * 2);
      for (let t = 0; t < n; t++) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 2 + Math.floor(rnd() * 24));
        if (d > now) continue;
        const r = routes[Math.floor(rnd() * routes.length)];
        trips.push({ id: uid(), vehicleId: v.id, date: iso(d), from: r[0], to: r[1], freight: Math.round((lo + rnd() * (hi - lo)) / 500) * 500, km: null });
      }
    }
  });

  // Driver khata: advances out, en-route expenses, some cash returned
  const driverLedger = [];
  drivers.forEach((d, i) => {
    driverLedger.push({ id: uid(), driverId: d.id, date: daysFromNow(-25 - i * 3), type: "advance", amount: 15000 + i * 2000, note: "Trip advance" });
    driverLedger.push({ id: uid(), driverId: d.id, date: daysFromNow(-20 - i * 3), type: "expense", amount: 6000 + Math.floor(rnd() * 4000), note: "Diesel + food en route" });
    if (i % 2 === 0) driverLedger.push({ id: uid(), driverId: d.id, date: daysFromNow(-10 - i), type: "settlement", amount: 4000 + Math.floor(rnd() * 3000), note: "Cash returned" });
  });

  db = { vehicles, expenses, fuelLogs, inspections, issues, reminders, parts, drivers, workOrders, documents, tyreReadings, settings, trips, driverLedger, demo: true };
  saveStore();
  renderAll();
}

// ---------- Forms & events ----------
function fillVehicleSelects() {
  const opts = db.vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
  ["compVehicle", "fuelVehicle", "inspVehicle", "issueVehicle", "remVehicle", "fuelVehicleFilter",
   "tyreVehicleFilter", "tyreFormVehicle", "tripVehicle", "billVehicle"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const keep = el.value;
    el.innerHTML = opts;
    if ([...el.options].some(o => o.value === keep)) el.value = keep;
  });
  const dv = document.getElementById("driverVehicle");
  const keepD = dv.value;
  dv.innerHTML = '<option value="">Not assigned</option>' + opts;
  if ([...dv.options].some(o => o.value === keepD)) dv.value = keepD;
  fillDocEntitySelect();
  fillTyrePositions();
}
function fillTyrePositions() {
  const vsel = document.getElementById("tyreFormVehicle");
  const psel = document.getElementById("tyrePosition");
  if (!vsel || !psel) return;
  const keep = psel.value;
  psel.innerHTML = tyrePositions(vsel.value).map(p => `<option>${p}</option>`).join("");
  if ([...psel.options].some(o => o.value === keep)) psel.value = keep;
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
  alert(passed ? "Inspection passed — all 10 points OK" : "Inspection recorded. Failed items have been added to Issues for AI prioritisation.");
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

// ---- Documents ----
document.getElementById("docEntityType").addEventListener("change", fillDocEntitySelect);
document.getElementById("documentForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  if (!fd.entityId) { alert("Add a " + fd.entityType + " first, then attach the document."); return; }
  db.documents.push({
    id: uid(), entityType: fd.entityType, entityId: fd.entityId,
    docType: fd.docType, number: fd.number.trim(),
    issueDate: fd.issueDate || null, expiryDate: fd.expiryDate, note: fd.note.trim()
  });
  saveStore(); e.target.reset(); fillDocEntitySelect();
  renderDocuments(); renderRadar(); renderOverview();
});

// ---- Tyre Health ----
document.getElementById("tyreVehicleFilter").addEventListener("change", renderTyres);
document.getElementById("tyreFormVehicle").addEventListener("change", fillTyrePositions);
document.getElementById("tyreForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.tyreReadings.push({
    id: uid(), vehicleId: fd.vehicleId, position: fd.position,
    treadDepth: +fd.treadDepth, pressure: fd.pressure ? +fd.pressure : null,
    odo: fd.odo ? +fd.odo : null, date: fd.date
  });
  saveStore(); e.target.reset();
  document.getElementById("tyreVehicleFilter").value = fd.vehicleId;
  renderTyres(); renderOverview();
});

// ---- Settings ----
document.getElementById("settingsForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.settings = {
    businessName: fd.businessName.trim(), gstin: fd.gstin.trim(), city: fd.city.trim(),
    warnDays: +fd.warnDays, minTread: fd.minTread ? +fd.minTread : null,
    mileageDropPct: fd.mileageDropPct ? +fd.mileageDropPct : null
  };
  saveStore(); renderRadar(); renderTyres(); renderOverview();
  alert("Settings saved.");
});
document.getElementById("exportDataBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fleetworks-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click(); URL.revokeObjectURL(a.href);
});
document.getElementById("clearDemoBtn").addEventListener("click", () => {
  if (!db.demo) { alert("No demo data loaded — your own records are untouched."); return; }
  if (!confirm("Remove the sample demo fleet? Your own added records stay.")) return;
  localStorage.removeItem(STORE_KEY);
  db = loadStore(); renderAll();
});

// ---- Compliance Radar filter chips ----
document.getElementById("radarFilters").addEventListener("click", e => {
  const b = e.target.closest(".radar-chip");
  if (!b) return;
  radarFilter = b.dataset.rf;
  renderRadar();
});

// ---------- Workspaces (Home hub → FleetOps / FleetFin / FleetIQ) ----------
// The sidebar shows only the menus of the active workspace; Home shows none.
function setWorkspace(ws) {
  document.querySelectorAll("#tabBar [data-ws]").forEach(el => { el.hidden = el.dataset.ws !== ws; });
  document.body.dataset.ws = ws;
}

// Sidebar nav (enterprise shell) — closest() so clicks on the inner SVG icon
// still resolve to the .tab-btn that carries data-tab. Updates the page title
// and closes the mobile drawer.
document.getElementById("tabBar").addEventListener("click", e => {
  // group expand/collapse
  const parent = e.target.closest(".side-parent");
  if (parent) { parent.closest(".side-group")?.classList.toggle("open"); return; }
  const btn = e.target.closest(".tab-btn");
  if (!btn || !btn.dataset.tab) return;
  // Radar presets (Vehicle/Driver Renewals, Warranties) pre-filter the Radar
  if (btn.dataset.radar !== undefined) { radarFilter = btn.dataset.radar || "all"; renderRadar(); }
  // scoped to the sidebar / top-level panels so the My Account inner tabs are untouched
  document.querySelectorAll("#tabBar .tab-btn").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll("#fleetContent > .tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
  const title = document.getElementById("pageTitle");
  if (title) title.textContent = (btn.textContent || "").trim();
  document.getElementById("appSide")?.classList.remove("open");
  clearPageSearch();
  updateToolbarCounts();
  history.replaceState(null, "", "#" + btn.dataset.tab);
  // switch workspace to wherever the clicked tab lives (hub, deep link, or sidebar)
  if (btn.dataset.tab === "home") setWorkspace("home");
  else { const w = btn.closest("[data-ws]"); if (w) setWorkspace(w.dataset.ws); }
  // Home & My Account work even with an empty fleet
  if (!db.vehicles.length) {
    const exempt = btn.dataset.tab === "account" || btn.dataset.tab === "home";
    document.getElementById("emptyState").hidden = exempt;
    document.getElementById("fleetContent").hidden = !exempt;
  }
  if (btn.dataset.tab === "account" && window.renderAuthState) renderAuthState();
});

// ---------- Top-bar page search (filters the active panel's lists) ----------
function clearPageSearch() {
  const inp = document.getElementById("globalSearch");
  if (!inp) return;
  inp.value = "";
  document.querySelectorAll(".tab-panel tbody tr, .tab-panel .pred-row, .tab-panel .tyre-cell")
    .forEach(el => { el.style.display = ""; });
}
document.getElementById("globalSearch")?.addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  const panel = document.querySelector(".tab-panel.active");
  if (!panel) return;
  panel.querySelectorAll("tbody tr:not(.veh-history)").forEach(tr => {
    tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
  panel.querySelectorAll(".pred-row, .tyre-cell").forEach(el => {
    el.style.display = !q || el.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});

// ---------- Section list-toolbars (Fleetio-style) ----------
// Injected once per section: live record count, a "+ Add" button that
// reveals the section's entry form (collapsed by default), and CSV export
// on the Compliance Radar.
const TAB_META = {
  vehicles:  { count: () => db.vehicles.length,   label: "vehicles",      add: "Update Compliance" },
  drivers:   { count: () => db.drivers.length,    label: "drivers",       add: "Add Driver" },
  fuel:      { count: () => db.fuelLogs.length,   label: "fuel entries",  add: "Log Fuel Fill" },
  inspections: { count: () => db.inspections.length, label: "inspections" },
  issues:    { count: () => db.issues.filter(i => i.status !== "Resolved").length, label: "open issues", add: "Report Issue" },
  reminders: { count: () => db.reminders.length,  label: "PM schedules",  add: "Add Schedule" },
  parts:     { count: () => db.parts.length,      label: "parts",         add: "Add / Update Part" },
  radar:     { count: () => radarItems().length,  label: "renewals tracked" },
  documents: { count: () => db.documents.length,  label: "documents",     add: "Add Document" },
  tyres:     { count: () => db.tyreReadings.length, label: "readings",    add: "Log Reading" },
  workorders: { count: () => db.workOrders.filter(w => w.status !== "Completed").length, label: "open job cards" },
  assignments: { count: () => db.vehicles.length, label: "vehicles" },
  meters:    { count: () => db.fuelLogs.length,   label: "meter readings" },
  expensehistory: { count: () => db.expenses.length, label: "expense entries" },
  itemfailures: { count: () => db.inspections.reduce((s, i) => s + i.results.filter(r => !r.ok).length, 0), label: "failed items" },
  servicehistory: { count: () => db.expenses.length + db.workOrders.filter(w => w.status === "Completed").length, label: "service records" },
  vendors:   { count: () => { const s = new Set(); db.parts.forEach(p => p.vendor && s.add(p.vendor)); db.workOrders.forEach(w => w.vendor && s.add(w.vendor)); return s.size; }, label: "vendors" }
};

function initListToolbars() {
  Object.entries(TAB_META).forEach(([tab, meta]) => {
    const panel = document.getElementById("tab-" + tab);
    if (!panel || panel.querySelector(".list-toolbar")) return;
    const formCards = [...panel.querySelectorAll(".chart-card")].filter(c => c.querySelector("form.entry-form"));
    const bar = document.createElement("div");
    bar.className = "list-toolbar";
    let html = `<span class="lt-count" data-count="${tab}">—</span><span class="lt-spacer"></span>`;
    if (tab === "radar") html += `<button type="button" class="btn btn-outline btn-sm" id="radarExport">${FWIcon("download", { size: 15 })} Export CSV</button>`;
    if (meta.add && formCards.length) {
      formCards.forEach(c => c.classList.add("form-card", "collapsed"));
      html += `<button type="button" class="btn btn-primary btn-sm lt-add">${FWIcon("plus", { size: 15 })} ${meta.add}</button>`;
    }
    bar.innerHTML = html;
    panel.prepend(bar);
    bar.querySelector(".lt-add")?.addEventListener("click", () => {
      const opening = formCards[0].classList.contains("collapsed");
      formCards.forEach(c => c.classList.toggle("collapsed"));
      if (opening) formCards[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
  document.getElementById("radarExport")?.addEventListener("click", exportRadarCsv);
}

function updateToolbarCounts() {
  Object.entries(TAB_META).forEach(([tab, meta]) => {
    const el = document.querySelector(`.lt-count[data-count="${tab}"]`);
    if (!el) return;
    try { el.textContent = meta.count().toLocaleString("en-IN") + " " + meta.label; }
    catch { el.textContent = ""; }
  });
}

function exportRadarCsv() {
  const rows = [["Category", "Entity", "Renewal", "Valid Till", "Days Left", "Status"]];
  radarItems().forEach(i => rows.push([
    i.cat, i.entity, i.type, i.date, i.days,
    i.days < 0 ? "Overdue" : i.days <= warnDays() ? "Due Soon" : "Upcoming"
  ]));
  downloadCsv(rows, "fleetworks-compliance-radar.csv");
}
function downloadCsv(rows, name) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click(); URL.revokeObjectURL(a.href);
}
function exportExpensesCsv() {
  const rows = [["Date", "Vehicle", "Category", "Amount (INR)"]];
  [...db.expenses].sort((a, b) => b.date.localeCompare(a.date))
    .forEach(e => rows.push([e.date, vName(e.vehicleId), e.category, e.amount]));
  db.fuelLogs.forEach(f => rows.push([f.date, vName(f.vehicleId), "Diesel", f.amount]));
  downloadCsv(rows, "fleetworks-expenses.csv");
}

// ---------- Dynamic panels (full navigation tree) ----------
function soonCard(title, desc, icon) {
  return `<div class="chart-card"><div class="empty-state" style="padding:44px 20px">
    <div class="empty-icon">${FWIcon(icon, { size: 40 })}</div>
    <h2>${title}</h2>
    <p style="max-width:48ch;margin:0 auto">${desc}</p>
    <span class="fw-badge upcoming" style="margin-top:12px">Coming soon</span>
  </div></div>`;
}
function panelCard(title, sub, bodyId) {
  return `<div class="chart-card"><div class="chart-head"><div><h2>${title}</h2><p class="muted">${sub}</p></div></div>
    <div class="chart-scroll"><div id="${bodyId}"></div></div></div>`;
}
function buildDynamicPanels() {
  const host = document.getElementById("fleetContent");
  const mk = (id, inner) => {
    if (document.getElementById("tab-" + id)) return;
    const s = document.createElement("section");
    s.className = "tab-panel"; s.id = "tab-" + id; s.innerHTML = inner;
    host.appendChild(s);
  };
  mk("map", soonCard("Fleet Map", "Live vehicle locations on a map arrive with the GPS / telematics integration.", "mapPin"));
  mk("assignments", panelCard("Vehicle Assignments", "Which driver operates which vehicle right now", "assignTable"));
  mk("meters", panelCard("Meter History", "Odometer readings captured with every fuel fill, newest first", "meterTable"));
  mk("expensehistory", panelCard("Expense History", "Every expense entry across the fleet, newest first", "expHistTable"));
  mk("replacement", panelCard("Replacement Analysis", "Lifetime running cost per vehicle — spot the vehicles costing more than they earn", "replTable"));
  mk("itemfailures", panelCard("Inspection Item Failures", "Checklist items that failed, across all inspections", "failTable"));
  mk("forms", panelCard("Inspection Forms", "The daily 10-point check every driver runs before rolling out", "formsList"));
  mk("servicehistory", panelCard("Service History", "Every completed job card and recorded expense, newest first", "svcHistTable"));
  mk("servicetasks", panelCard("Service Task Library", "Standard maintenance tasks and how your fleet uses them", "taskLibTable"));
  mk("vendors", panelCard("Vendors", "Workshops and suppliers your fleet works with", "vendorTable"));
  mk("integrations", `<div class="chart-card"><div class="chart-head"><div><h2>Integrations</h2><p class="muted">Connect FleetWorks to the tools your business already runs on</p></div></div><div class="integ-grid" id="integGrid"></div></div>`);
  mk("reports", `<div class="chart-card"><div class="chart-head"><div><h2>Standard Reports</h2><p class="muted">One-click exports, ready for Excel and your accountant</p></div></div><div class="integ-grid" id="reportGrid"></div></div>`);
  // FleetIQ study panels (rendered by analytics.js)
  mk("recurrent", panelCard("Recurrent Issues & Repeat Repairs", "The same part failing twice is a pattern, not bad luck — FleetIQ surfaces every repeat", "recurTable"));
  mk("deviation", panelCard("Deviation Analysis", "Vehicles running meaningfully above or below your fleet's cost per km", "devTable"));
  mk("anomaly", panelCard("Anomaly Detection", "Bills that look too big against your own history for that part", "anomTable"));
  mk("forecasting", `<div class="chart-card"><div class="chart-head"><div><h2>Expense Forecasting</h2><p class="muted">Least-squares ML regression on your monthly spend, damped against noisy months — next 3 months projected</p></div><div class="chart-legend" id="fcastLegend"></div></div><div class="chart-scroll"><div id="fcastChart" class="chart-area"></div></div><details class="chart-table"><summary>View as table</summary><div id="fcastTable"></div></details></div>`);
  mk("recommend", `<div class="chart-card"><div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile brand"><i data-icon="brain" data-icon-size="22"></i></span> Recommendations</h2><p class="muted">What FleetWorks AI would do this week, in priority order</p></div></div><div id="recoList" class="predictions"></div></div>`);
  mk("trips", `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile brand"><i data-icon="mapPin" data-icon-size="22"></i></span> Trips &amp; Loads</h2><p class="muted">Log every trip's freight — FleetWorks turns cost-per-km into profit-per-km</p></div></div>
    <form id="tripForm" class="entry-form">
      <div class="form-row">
        <label>Vehicle<select name="vehicleId" id="tripVehicle" required></select></label>
        <label>Date<input type="date" name="date" required /></label>
      </div>
      <div class="form-row">
        <label>From<input type="text" name="from" placeholder="e.g. Coimbatore" required /></label>
        <label>To<input type="text" name="to" placeholder="e.g. Chennai" required /></label>
      </div>
      <div class="form-row">
        <label>Freight received (&#8377;)<input type="number" name="freight" min="0" required inputmode="numeric" /></label>
        <label>Trip distance (km, optional)<input type="number" name="km" min="0" inputmode="numeric" /></label>
      </div>
      <button type="submit" class="btn btn-primary"><i data-icon="plus" data-icon-size="16"></i> Save Trip</button>
    </form>
  </div>
  <div class="chart-card"><div class="chart-head"><div><h2>Profit per Vehicle</h2><p class="muted">Freight earned vs all-in cost (maintenance + diesel) since each vehicle's first logged trip</p></div></div><div class="chart-scroll"><div id="profitTable"></div></div></div>
  <div class="chart-card"><div class="chart-head"><div><h2>Trip Log</h2></div></div><div class="chart-scroll"><div id="tripsTable"></div></div></div>`);
  mk("khata", `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile success"><i data-icon="driver" data-icon-size="22"></i></span> Driver Khata</h2><p class="muted">The advance-and-settlement notebook, digital — who holds how much of your cash right now</p></div></div>
    <form id="khataForm" class="entry-form">
      <div class="form-row">
        <label>Driver<select name="driverId" id="khataDriver" required></select></label>
        <label>Entry type
          <select name="type" required>
            <option value="advance">Advance given to driver</option>
            <option value="expense">Trip expense (from advance)</option>
            <option value="settlement">Cash returned / settled</option>
          </select>
        </label>
      </div>
      <div class="form-row">
        <label>Amount (&#8377;)<input type="number" name="amount" min="1" required inputmode="numeric" /></label>
        <label>Date<input type="date" name="date" required /></label>
      </div>
      <label>Note (optional)<input type="text" name="note" placeholder="e.g. Chennai trip advance" /></label>
      <button type="submit" class="btn btn-primary"><i data-icon="plus" data-icon-size="16"></i> Add Khata Entry</button>
    </form>
  </div>
  <div class="chart-card"><div class="chart-head"><div><h2>Balances</h2><p class="muted">Positive balance = cash with the driver, still to be accounted</p></div></div><div class="chart-scroll"><div id="khataBalances"></div></div></div>
  <div class="chart-card"><div class="chart-head"><div><h2>Ledger</h2></div></div><div class="chart-scroll"><div id="khataTable"></div></div></div>`);
  mk("gstbills", `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile success"><i data-icon="receipt" data-icon-size="22"></i></span> Bill Capture &amp; GST</h2><p class="muted">Snap the workshop bill — FleetWorks reads the amount, date and GSTIN on your phone, and tracks your input-tax credit</p></div></div>
    <div class="settings-actions">
      <button type="button" class="btn btn-primary" id="billScanBtn"><i data-icon="receipt" data-icon-size="16"></i> Scan a Bill (photo)</button>
      <button type="button" class="btn btn-outline" id="billManualBtn">Enter Manually</button>
      <input type="file" id="billFile" accept="image/*" hidden />
      <span class="muted" id="billScanStatus"></span>
    </div>
    <form id="billForm" class="entry-form" hidden>
      <div class="form-row">
        <label>Vehicle<select name="vehicleId" id="billVehicle" required></select></label>
        <label>Date<input type="date" name="date" required /></label>
      </div>
      <div class="form-row">
        <label>Category
          <select name="category" required>
            <option value="">Select</option>
            <option>Tyres</option><option>Battery</option><option>Brakes</option>
            <option>Clutch</option><option>Engine Oil &amp; Filters</option><option>Suspension</option>
            <option>Electrical</option><option>Body &amp; Paint</option><option>Other</option>
          </select>
        </label>
        <label>Amount (&#8377;)<input type="number" name="amount" min="1" required inputmode="numeric" /></label>
      </div>
      <div class="form-row">
        <label>Vendor GSTIN (blank = non-GST bill)<input type="text" name="gstin" maxlength="15" style="text-transform:uppercase" /></label>
        <label>Bill No (optional)<input type="text" name="billNo" /></label>
      </div>
      <button type="submit" class="btn btn-primary"><i data-icon="check" data-icon-size="16"></i> Save Bill as Expense</button>
    </form>
    <p class="disclaimer">First scan downloads the free on-device reader (~15 MB, one time). Bill photos never leave your phone — OCR runs entirely in your browser.</p>
  </div>
  <section class="stat-row" id="gstTiles"></section>
  <div class="chart-card"><div class="chart-head"><div><h2>GST vs Non-GST Bills</h2><p class="muted">Bills with a GSTIN earn input-tax credit; the rest is leakage worth chasing</p></div></div><div class="chart-scroll"><div id="gstBillsTable"></div></div></div>`);
  mk("benchmark", `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile info"><i data-icon="chartBar" data-icon-size="22"></i></span> Peer Benchmarking</h2><p class="muted">Your fleet vs Indian CV industry reference numbers — cost per km, mileage and part prices</p></div></div>
    <div id="benchTables"></div>
    <p class="disclaimer">Benchmarks are indicative India CV market references. As more fleets join FleetWorks, these become live anonymised peer comparisons for your region and vehicle class.</p>
  </div>`);
  mk("whatif", `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile info"><i data-icon="eye" data-icon-size="22"></i></span> What-if Analysis</h2><p class="muted">Move the sliders — FleetIQ reprojects your monthly cost instantly from your own last-12-month numbers</p></div></div>
    <div class="whatif-grid">
      <label>Diesel price <span class="wi-val" id="wiFuelV">+0%</span><input type="range" id="wiFuel" min="-20" max="30" value="0" /></label>
      <label>Monthly running <span class="wi-val" id="wiKmV">+0%</span><input type="range" id="wiKm" min="-30" max="30" value="0" /></label>
      <label>Extra vehicles <span class="wi-val" id="wiVehV">+0</span><input type="range" id="wiVeh" min="0" max="5" value="0" /></label>
    </div>
    <section class="stat-row" id="wiOut"></section>
    <p class="disclaimer">Assumes maintenance scales ~60% with distance and added vehicles behave like your current average. Indicative planning aid, not a quotation.</p>
  </div>`);
  [
    ["faults", "Faults", "Engine fault codes surface here automatically with the OBD / telematics integration.", "alert"],
    ["invoices", "Invoices", "Customer and vendor invoices arrive with the billing module.", "document"],
    ["toll", "Toll & FASTag", "FASTag toll books per vehicle and route arrive with the telematics integration.", "mapPin"],
    ["def", "DEF / AdBlue", "DEF consumption and cost-per-km tracking for BS6 vehicles is on the way.", "spray"],
    ["recalls", "Recalls", "Manufacturer recall tracking for your vehicle makes is on the way.", "bell"],
    ["charging", "EV Charging", "Charging sessions, kWh and cost per km arrive with the EV module.", "charge"],
    ["places", "Places", "Saved depots, customer sites and geofences arrive with the GPS integration.", "mapPin"],
    ["purchaseorders", "Purchase Orders", "Raise and track spare-part purchase orders against vendors.", "receipt"],
    ["programs", "Service Programs", "Bundle service tasks into recurring programs and assign vehicles to them.", "calendarClock"],
    ["inspschedules", "Inspection Schedules", "Assign inspection forms to vehicles on a repeating schedule.", "clipboardCheck"]
  ].forEach(([id, t, d, ic]) => mk(id, soonCard(t, d, ic)));
}

// ---------- Render: dynamic data panels ----------
function renderAssignments() {
  const el = document.getElementById("assignTable");
  if (!el) return;
  el.innerHTML = db.vehicles.length ?
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Type</th><th>Driver</th><th>Contact</th><th>DL Validity</th></tr></thead><tbody>` +
    db.vehicles.map(v => {
      const d = db.drivers.find(x => x.vehicleId === v.id);
      const days = d && d.dlExpiry ? daysUntil(d.dlExpiry) : null;
      const badge = !d ? '<span class="fw-badge soon">Unassigned</span>' :
        days === null ? '<span class="fw-badge upcoming">Not set</span>' :
        days < 0 ? '<span class="fw-badge overdue">Expired</span>' :
        days <= 30 ? `<span class="fw-badge soon">${days}d left</span>` : '<span class="fw-badge ok">Valid</span>';
      return `<tr><td><strong>${esc(v.name)}</strong></td><td>${esc(v.type)}</td><td>${d ? esc(d.name) : "<span class='muted'>—</span>"}</td><td>${d && d.phone ? esc(d.phone) : "—"}</td><td>${badge}</td></tr>`;
    }).join("") + "</tbody></table>" : "<p class='muted'>Add vehicles first.</p>";
}
function renderMeters() {
  const el = document.getElementById("meterTable");
  if (!el) return;
  const rows = [...db.fuelLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  el.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Odometer</th><th>Since last</th></tr></thead><tbody>` +
    rows.map(f => {
      const fills = vehicleFills(f.vehicleId);
      const i = fills.findIndex(x => x.id === f.id);
      const delta = i > 0 ? f.odo - fills[i - 1].odo : null;
      return `<tr><td>${fmtDate(f.date)}</td><td><strong>${esc(vName(f.vehicleId))}</strong></td><td>${f.odo.toLocaleString("en-IN")} km</td><td>${delta ? "+" + delta.toLocaleString("en-IN") + " km" : "<span class='muted'>—</span>"}</td></tr>`;
    }).join("") + "</tbody></table>" : "<p class='muted'>Meter readings appear as you log fuel fills.</p>";
}
function renderExpenseHistory() {
  const el = document.getElementById("expHistTable");
  if (!el) return;
  const rows = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  el.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Category</th><th>Amount</th></tr></thead><tbody>` +
    rows.map(e => `<tr><td>${fmtDate(e.date)}</td><td><strong>${esc(vName(e.vehicleId))}</strong></td><td>${esc(e.category)}</td><td>${fmtINR(e.amount)}</td></tr>`).join("") +
    "</tbody></table>" : "<p class='muted'>No expenses recorded yet.</p>";
}
function renderReplacement() {
  const el = document.getElementById("replTable");
  if (!el) return;
  const rows = db.vehicles.map(v => {
    const spend = db.expenses.filter(e => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0);
    const fuel = db.fuelLogs.filter(f => f.vehicleId === v.id).reduce((s, f) => s + f.amount, 0);
    const fills = vehicleFills(v.id);
    const km = fills.length > 1 ? fills[fills.length - 1].odo - fills[0].odo : 0;
    const cpk = km ? (spend + fuel) / km : 0;
    return { v, spend: spend + fuel, km, cpk };
  }).sort((a, b) => b.cpk - a.cpk);
  const avg = rows.filter(r => r.cpk).reduce((s, r) => s + r.cpk, 0) / (rows.filter(r => r.cpk).length || 1);
  el.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Lifetime Spend</th><th>KM Logged</th><th>Cost / km</th><th>Verdict</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td><strong>${esc(r.v.name)}</strong><br /><span class="muted">${esc(r.v.type)}</span></td>
      <td>${fmtINR(r.spend)}</td><td>${r.km.toLocaleString("en-IN")}</td><td>${r.cpk ? "₹" + r.cpk.toFixed(1) : "—"}</td>
      <td>${!r.cpk ? '<span class="fw-badge upcoming">Need data</span>' : r.cpk > avg * 1.3 ? '<span class="fw-badge overdue">Review — costly</span>' : r.cpk > avg * 1.1 ? '<span class="fw-badge soon">Watch</span>' : '<span class="fw-badge ok">Healthy</span>'}</td></tr>`).join("") +
    "</tbody></table><p class='muted' style='margin-top:10px'>Verdicts compare each vehicle's all-in cost per km against the fleet average (₹" + avg.toFixed(1) + "/km).</p>" : "<p class='muted'>Add vehicles first.</p>";
}
function renderItemFailures() {
  const el = document.getElementById("failTable");
  if (!el) return;
  const fails = [];
  db.inspections.forEach(i => i.results.filter(r => !r.ok).forEach(r => fails.push({ date: i.date, veh: vName(i.vehicleId), item: r.item })));
  fails.sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = fails.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Failed Item</th></tr></thead><tbody>` +
    fails.map(f => `<tr><td>${fmtDate(f.date)}</td><td><strong>${esc(f.veh)}</strong></td><td><span class="fw-badge overdue">${FWIcon("alert", { size: 12 })}${esc(f.item)}</span></td></tr>`).join("") +
    "</tbody></table>" : "<p class='muted'>No failed inspection items — good discipline.</p>";
}
function renderForms() {
  const el = document.getElementById("formsList");
  if (!el) return;
  el.innerHTML = `<div class="forms-def"><h3 class="forms-def-t">${FWIcon("clipboardCheck", { size: 18 })} Daily 10-Point Check</h3>` +
    INSPECTION_ITEMS.map((it, i) => `<div class="forms-item"><span class="forms-num">${i + 1}</span>${esc(it)}</div>`).join("") +
    `<p class="muted" style="margin-top:12px">Failed items automatically become Issues for the AI to prioritise. Custom forms are coming with the multi-user upgrade.</p></div>`;
}
function renderServiceHistory() {
  const el = document.getElementById("svcHistTable");
  if (!el) return;
  const evts = [
    ...db.expenses.map(e => ({ d: e.date, veh: vName(e.vehicleId), what: e.category, amt: e.amount, kind: "Expense" })),
    ...db.workOrders.filter(w => w.status === "Completed").map(w => ({ d: w.completedAt, veh: vName(w.vehicleId), what: w.title + (w.vendor ? " · " + w.vendor : ""), amt: w.finalCost || 0, kind: "Job card" }))
  ].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 60);
  el.innerHTML = evts.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Work / Category</th><th>Type</th><th>Cost</th></tr></thead><tbody>` +
    evts.map(e => `<tr><td>${fmtDate(e.d)}</td><td><strong>${esc(e.veh)}</strong></td><td>${esc(e.what)}</td><td><span class="fw-chip ${e.kind === "Job card" ? "is-done" : "is-void"}"><span class="dot"></span>${e.kind}</span></td><td>${fmtINR(e.amt)}</td></tr>`).join("") +
    "</tbody></table>" : "<p class='muted'>Service history builds up as you record expenses and close job cards.</p>";
}
const TASK_CATALOG = ["Engine Oil & Filters", "Wheel Alignment & Balancing", "Greasing & Lubrication", "Air Filter Cleaning", "Coolant Top-up / Flush", "Brake Inspection", "General Service (PMS)"];
function renderServiceTasks() {
  const el = document.getElementById("taskLibTable");
  if (!el) return;
  el.innerHTML = `<table class="chart-table-el"><thead><tr><th>Task</th><th>Active Schedules</th><th>Times Recorded</th><th>Last Done</th></tr></thead><tbody>` +
    TASK_CATALOG.map(t => {
      const scheds = db.reminders.filter(r => r.task === t);
      const done = db.expenses.filter(e => e.category === t).length;
      const last = scheds.map(s => s.lastDate).sort().pop();
      return `<tr><td><strong>${esc(t)}</strong></td><td>${scheds.length || "<span class='muted'>—</span>"}</td><td>${done || "<span class='muted'>—</span>"}</td><td>${last ? fmtDate(last) : "<span class='muted'>—</span>"}</td></tr>`;
    }).join("") + "</tbody></table>";
}
function renderVendors() {
  const el = document.getElementById("vendorTable");
  if (!el) return;
  const map = {};
  db.parts.forEach(p => { if (p.vendor) { map[p.vendor] = map[p.vendor] || { parts: 0, jobs: 0, contact: "" }; map[p.vendor].parts++; if (p.vendorContact) map[p.vendor].contact = p.vendorContact; } });
  db.workOrders.forEach(w => { if (w.vendor) { map[w.vendor] = map[w.vendor] || { parts: 0, jobs: 0, contact: "" }; map[w.vendor].jobs++; } });
  const rows = Object.entries(map);
  el.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Vendor</th><th>Supplies</th><th>Parts</th><th>Job Cards</th><th>Contact</th></tr></thead><tbody>` +
    rows.map(([name, v]) => `<tr><td><strong>${esc(name)}</strong></td><td>${v.parts && v.jobs ? "Parts + Service" : v.parts ? "Parts" : "Service"}</td><td>${v.parts || "—"}</td><td>${v.jobs || "—"}</td><td>${v.contact ? esc(v.contact) : "<span class='muted'>—</span>"}</td></tr>`).join("") +
    "</tbody></table>" : "<p class='muted'>Vendors appear automatically as you add parts and job cards.</p>";
}
function renderIntegrations() {
  const el = document.getElementById("integGrid");
  if (!el) return;
  const card = (icon, name, desc, live, href) => `<div class="integ-card">
    <span class="ic-tile ${live ? "success" : "brand"}">${FWIcon(icon, { size: 20 })}</span>
    <div><h4>${name} ${live ? '<span class="fw-badge ok">Active</span>' : '<span class="fw-badge upcoming">Soon</span>'}</h4><p>${desc}</p></div>
    ${href ? `<a class="btn btn-outline btn-sm" href="${href}">Open</a>` : ""}</div>`;
  el.innerHTML =
    card("receipt", "Tally Export", "Push every expense as Tally-ready vouchers for GST filing.", true, "dashboard.html") +
    card("truck", "VAHAN / Parivahan", "Auto-fill RC, insurance and fitness dates from the registration number.", false) +
    card("mapPin", "GPS / Telematics", "Live locations, route history and engine fault codes.", false) +
    card("fuel", "Fuel Cards", "Automatic fuel-fill capture from card transactions.", false) +
    card("phone", "WhatsApp Alerts", "Compliance and breakdown alerts straight to your phone.", false);
}
function renderReports() {
  const el = document.getElementById("reportGrid");
  if (!el) return;
  const card = (icon, name, desc, btnLabel, action) => `<div class="integ-card">
    <span class="ic-tile info">${FWIcon(icon, { size: 20 })}</span>
    <div><h4>${name}</h4><p>${desc}</p></div>
    <button class="btn btn-outline btn-sm" data-report="${action}">${btnLabel}</button></div>`;
  el.innerHTML =
    card("shieldCheck", "Compliance Report", "Every renewal — RTO documents, licences, warranties — with due status.", "Export CSV", "radar") +
    card("rupee", "Expense Report", "All expenses and diesel fills, ready for Excel or your accountant.", "Export CSV", "expenses") +
    card("download", "Full Backup", "Your entire fleet data as a JSON file you own.", "Download", "backup");
  el.querySelectorAll("[data-report]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.report;
    if (k === "radar") exportRadarCsv();
    else if (k === "expenses") exportExpensesCsv();
    else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: "application/json" }));
      a.download = "fleetworks-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click(); URL.revokeObjectURL(a.href);
    }
  }));
}

// Sidebar drawer toggle (mobile)
document.getElementById("sideToggle")?.addEventListener("click", () =>
  document.getElementById("appSide")?.classList.toggle("open"));
document.getElementById("sideClose")?.addEventListener("click", () =>
  document.getElementById("appSide")?.classList.remove("open"));

// ---------- Orchestration ----------
function renderAll() {
  const has = db.vehicles.length > 0;
  const activeId = document.querySelector("#fleetContent > .tab-panel.active")?.id;
  const exempt = activeId === "tab-home" || activeId === "tab-account";
  document.getElementById("emptyState").hidden = has || exempt;
  document.getElementById("fleetContent").hidden = !(has || exempt);
  if (!has) return;
  // demo store from the dashboard may lack fleet-manager collections — extend it once
  if (db.demo !== true && db.vehicles.length && !db.fuelLogs.length && db.expenses.length && db.vehicles[0].id === "v1" && !db.vehicles[0].compliance) {
    loadDemoFleet(); return;
  }
  fillVehicleSelects();
  renderOverview(); renderVehicles(); renderDrivers(); renderFuel();
  renderInspectionForm(); renderInspectionHistory();
  renderIssues(); renderWorkOrders(); renderReminders(); renderParts();
  renderRadar(); renderDocuments(); renderTyres(); renderSettings();
  renderAssignments(); renderMeters(); renderExpenseHistory(); renderReplacement();
  renderItemFailures(); renderForms(); renderServiceHistory(); renderServiceTasks();
  renderVendors(); renderIntegrations(); renderReports();
  if (window.renderAnalyticsAll) renderAnalyticsAll();
  if (window.renderAccountPortal) renderAccountPortal();
  renderTrips();
  renderKhata();
  renderHealth();
  renderActionInbox();
  const org = document.getElementById("topOrg");
  if (org) org.textContent = (db.settings && db.settings.businessName) || "My Fleet";
  updateToolbarCounts();
}
buildDynamicPanels();
initListToolbars();

// Trips & khata entry forms (panels are built dynamically above)
document.getElementById("tripForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.trips.push({ id: uid(), vehicleId: fd.vehicleId, date: fd.date, from: fd.from.trim(), to: fd.to.trim(), freight: +fd.freight, km: fd.km ? +fd.km : null });
  saveStore(); e.target.reset(); renderAll();
});
document.getElementById("khataForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.driverLedger.push({ id: uid(), driverId: fd.driverId, date: fd.date, type: fd.type, amount: +fd.amount, note: (fd.note || "").trim() });
  saveStore(); e.target.reset(); renderAll();
});

renderAll();

// Home hub cards open their workspace and land on its dashboard
document.querySelectorAll(".hub-card").forEach(c => c.addEventListener("click", () => {
  const target = { ops: "overview", fin: "fin", iq: "analytics" }[c.dataset.hub];
  document.querySelector(`#tabBar .tab-btn[data-tab="${target}"]`)?.click();
}));
setWorkspace("home");

// ---------- Breakdown SOS ----------
// One tap on the road: logs a High issue + open job card, then opens
// WhatsApp to the FleetWorks helpline with vehicle, issue and location.
function openSOS() {
  if (document.getElementById("sosModal")) return;
  const wrap = document.createElement("div");
  wrap.id = "sosModal";
  wrap.innerHTML = `<div class="sos-box">
    <h3>${FWIcon("alert", { size: 20 })} Breakdown SOS</h3>
    <p class="muted">We'll log it instantly and alert the FleetWorks 24×7 helpline — nearest partner workshop gets arranged.</p>
    <label>Vehicle
      <select id="sosVeh">${db.vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("") || "<option value=''>No vehicles yet</option>"}</select>
    </label>
    <label>What happened?
      <input id="sosWhat" type="text" placeholder="e.g. Engine overheated near Salem toll" />
    </label>
    <div class="sos-actions">
      <a class="btn btn-outline" href="tel:+919740799722">${FWIcon("phone", { size: 15 })} Call Helpline</a>
      <button type="button" class="btn btn-primary" id="sosSend">${FWIcon("alert", { size: 15 })} Send SOS on WhatsApp</button>
    </div>
    <button type="button" class="link-btn sos-close" id="sosClose">Close</button>
  </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById("sosClose").addEventListener("click", () => wrap.remove());
  document.getElementById("sosSend").addEventListener("click", () => {
    const vid = document.getElementById("sosVeh").value;
    const what = document.getElementById("sosWhat").value.trim() || "Breakdown on road";
    const today = new Date().toISOString().slice(0, 10);
    if (vid) {
      const issueId = uid();
      db.issues.push({ id: issueId, vehicleId: vid, title: "Breakdown: " + what, severity: "High", status: "In Progress", createdAt: today, source: "Breakdown SOS" });
      db.workOrders.push({ id: uid(), issueId, vehicleId: vid, title: "Breakdown: " + what, vendor: "FleetWorks partner network", estCost: null, status: "Open", createdAt: today });
      saveStore(); renderAll();
    }
    const msg = "BREAKDOWN SOS\nVehicle: " + (vid ? vName(vid) : "—") + "\nIssue: " + what +
      "\nFleet: " + ((db.settings && db.settings.businessName) || "FleetWorks owner") +
      "\nPlease arrange the nearest partner workshop.";
    const go = loc => window.open("https://wa.me/919740799722?text=" +
      encodeURIComponent(msg + (loc ? "\nLocation: https://maps.google.com/?q=" + loc : "")), "_blank");
    if (navigator.geolocation) {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; go(null); } }, 2500);
      navigator.geolocation.getCurrentPosition(
        p => { if (!done) { done = true; clearTimeout(t); go(p.coords.latitude + "," + p.coords.longitude); } },
        () => { if (!done) { done = true; clearTimeout(t); go(null); } },
        { timeout: 2000 });
    } else go(null);
    wrap.remove();
  });
}
document.getElementById("sosBtn")?.addEventListener("click", openSOS);
