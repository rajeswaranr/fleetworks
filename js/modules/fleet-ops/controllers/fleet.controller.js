/* ============ FleetWorks — fleet-ops/controllers/fleet ============
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
  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    // All 12 core entities are DB-direct now — never persist them into the
    // blob (local storage OR the cloud push) once signed in, so a stale
    // copy can never linger to contaminate the next load or silently
    // overwrite fresh DB data. Only settings/demo still go through the blob.
    const { vehicles, drivers, expenses, fuelLogs, issues, workOrders, reminders,
      inspections, parts, documents, tyreReadings, trips, driverLedger, ...rest } = db;
    localStorage.setItem(STORE_KEY, JSON.stringify(rest));
    if (window.fwCloud) window.fwCloud.push(rest);
    return;
  }
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

// ---------- WhatsApp (click-to-chat) ----------
// Opens WhatsApp (app on mobile, web on desktop) with a pre-filled message.
// A 10-digit Indian number gets the 91 prefix. No API/token — works today.
function waNorm(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.length === 10) p = "91" + p;
  return p;
}
function waSend(phone, msg) {
  const p = waNorm(phone);
  if (!p) { alert("No WhatsApp number on file for this contact."); return; }
  window.open("https://wa.me/" + p + "?text=" + encodeURIComponent(msg || ""), "_blank", "noopener");
}
// HTML-escapes a JS value serialized for embedding inside a quoted HTML
// attribute (e.g. onclick='fn(JSON_HERE)'). JSON.stringify alone only makes
// a string JS-safe (escapes " and \) — it does NOT escape ' or < / >, so a
// driver/vehicle name or note containing a single quote can break straight
// out of a single-quoted attribute and inject arbitrary markup/script. The
// browser HTML-decodes the attribute before the inline JS ever parses it,
// so escaping here is transparent to the actual onclick handler.
function escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function waBtn(phone, msg, label) {
  if (!waNorm(phone)) return "";
  return `<button type="button" class="link-btn wa-btn" onclick='waSend(${escAttr(JSON.stringify(waNorm(phone)))},${escAttr(JSON.stringify(msg))})'>${FWIcon("chat", { size: 13 })} ${label || "WhatsApp"}</button>`;
}
function ownerName() { return (db.settings && db.settings.businessName) || "FleetWorks owner"; }

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
  if (window.FWFleetOps && FWFleetOps.computeInsights) return FWFleetOps.computeInsights();
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
  if (window.FWFleetOps && FWFleetOps.prioritisedIssues) return FWFleetOps.prioritisedIssues();
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
  if (window.FWFleetOps && FWFleetOps.reminderStatus) return FWFleetOps.reminderStatus();
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

  // filter-aware data scope
  const fVehs  = filteredVehicles ? filteredVehicles() : db.vehicles;
  const fVIds  = new Set(fVehs.map(v => v.id));
  const fExps  = db.expenses.filter(e => !e.vehicleId || fVIds.has(e.vehicleId));
  const fFuels = db.fuelLogs.filter(f => !f.vehicleId || fVIds.has(f.vehicleId));
  const fIssues= db.issues.filter(i => !i.vehicleId || fVIds.has(i.vehicleId));
  const fWOs   = db.workOrders.filter(w => !w.vehicleId || fVIds.has(w.vehicleId));

  // reminders / renewals (vehicle-scoped by filter)
  const rs = reminderStatus();
  const remO = rs.filter(r => r.overdue && (!r.vehicleId || fVIds.has(r.vehicleId))).length;
  const remS = rs.filter(r => r.dueSoon && (!r.vehicleId || fVIds.has(r.vehicleId))).length;
  const radar = radarItems();
  const seg = cat => {
    const it = radar.filter(i => i.cat === cat && (!i.vehicleId || fVIds.has(i.vehicleId)));
    return [it.filter(i => i.days < 0).length, it.filter(i => i.days >= 0 && i.days <= warnDays()).length];
  };
  const [vrO, vrS] = seg("vehicle"), [drO, drS] = seg("driver"), [wtO, wtS] = seg("warranty");

  // issues (filter-scoped)
  const openIss  = fIssues.filter(i => i.status !== "Resolved");
  const highOpen = openIss.filter(i => i.severity === "High").length;
  const resolved = fIssues.filter(i => i.resolvedAt);
  const avgResolve = resolved.length ? (resolved.reduce((s, i) => s + (new Date(i.resolvedAt) - new Date(i.createdAt)) / 86400000, 0) / resolved.length) : 0;
  const issM = months.map(m => fIssues.filter(i => i.createdAt && i.createdAt.startsWith(m)).length);

  // job cards / vehicle status / assignments
  const openWO = fWOs.filter(w => w.status !== "Completed");
  const oldestWO = openWO.length ? Math.max(...openWO.map(w => Math.round((now - new Date(w.createdAt)) / 86400000))) : 0;
  const inShop = new Set(openWO.map(w => w.vehicleId)).size;
  const fDriverVehIds = new Set(db.drivers.filter(d => d.vehicleId && fVIds.has(d.vehicleId)).map(d => d.vehicleId));
  const assigned = fDriverVehIds.size;

  // costs (filter-scoped)
  const sumM = (arr, key) => months.map(m => arr.filter(x => x[key] && x[key].startsWith(m)).reduce((s, x) => s + x.amount, 0));
  const fuelM = sumM(fFuels, "date"), svcM = sumM(fExps, "date");
  const totM = months.map((_, i) => fuelM[i] + svcM[i]);

  // cost per km (filter-scoped, from odometer spans)
  let km = 0;
  fVehs.forEach(v => { const f = vehicleFills(v.id); if (f.length > 1) km += f[f.length - 1].odo - f[0].odo; });
  const costAll = fExps.reduce((s, e) => s + e.amount, 0) + fFuels.reduce((s, f) => s + f.amount, 0);
  const cpk = km ? costAll / km : 0;

  // top repair spend categories (filter-scoped)
  const byCat = {};
  fExps.forEach(e => byCat[e.category] = (byCat[e.category] || 0) + e.amount);
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCat = topCats.length ? topCats[0][1] : 1;

  // meters (filter-scoped)
  const meters = fVehs.map(v => { const f = vehicleFills(v.id); return { name: v.name, odo: f.length ? f[f.length - 1].odo : 0 }; })
    .sort((a, b) => b.odo - a.odo).slice(0, 5);
  const maxOdo = meters.length ? meters[0].odo : 1;

  // inspections (filter-scoped)
  const fInsp = db.inspections.filter(i => !i.vehicleId || fVIds.has(i.vehicleId));
  const insp30 = fInsp.filter(i => (now - new Date(i.date)) / 86400000 <= 30).length;
  const items  = fInsp.reduce((s, i) => s + i.results.length, 0);
  const fails  = fInsp.reduce((s, i) => s + i.results.filter(r => !r.ok).length, 0);
  const failRate = items ? Math.round(fails / items * 100) : 0;
  const onTime = rs.length ? Math.round(rs.filter(r => !r.overdue).length / rs.length * 100) : 100;

  // tyres (filter-scoped)
  const worn = fVehs.reduce((n, v) => n + Object.values(latestReadings(v.id)).filter(r => r.treadDepth <= minTread()).length, 0);

  // breakdown ageing (open issues by age bucket, filter-scoped)
  const ages = [0, 0, 0, 0];
  openIss.forEach(i => {
    if (!i.createdAt) return;
    const d = (now - new Date(i.createdAt)) / 86400000;
    if (d <= 7) ages[0]++; else if (d <= 30) ages[1]++; else if (d <= 90) ages[2]++; else ages[3]++;
  });

  // inspection item failures per month (filter-scoped)
  const failM = months.map(m => fInsp.filter(i => i.date && i.date.startsWith(m))
    .reduce((s, i) => s + i.results.filter(r => !r.ok).length, 0));

  // regulatory non-compliance by document type (filter-scoped)
  const regRows = Object.entries(DOC_LABELS).map(([k, label]) => {
    let o = 0, s = 0;
    fVehs.forEach(v => {
      const till = v.compliance && v.compliance[k];
      if (!till) return;
      const d = daysUntil(till);
      if (d < 0) o++; else if (d <= warnDays()) s++;
    });
    return { label, o, s };
  });
  let dlO = 0, dlS = 0;
  db.drivers.filter(d => !d.vehicleId || fVIds.has(d.vehicleId)).forEach(d => {
    if (!d.dlExpiry) return;
    const x = daysUntil(d.dlExpiry);
    if (x < 0) dlO++; else if (x <= warnDays()) dlS++;
  });
  regRows.push({ label: "Driver DL", o: dlO, s: dlS });

  // recent activity (filter-scoped)
  const acts = [
    ...fIssues.map(i => ({ d: i.resolvedAt || i.createdAt, t: `${vName(i.vehicleId)} — ${i.title} (${i.status})`, ic: i.status === "Resolved" ? "checkCircle" : "wrench" })),
    ...fWOs.filter(w => w.completedAt).map(w => ({ d: w.completedAt, t: `Job card closed: ${w.title} · ${fmtINR(w.finalCost || 0)}`, ic: "checkCircle" })),
    ...fInsp.map(i => ({ d: i.date, t: `Inspection ${i.passed ? "passed" : "failed"} — ${vName(i.vehicleId)}`, ic: "clipboardCheck" }))
  ].filter(a => a.d).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6);

  const filterNote = _dashFilter.by !== "all" ? ` <span class="muted" style="font-size:0.72rem">· ${_dashFilter.label}</span>` : "";
  const R = "#c62828", A = "#b26a00", G = "#148a4e", N = "#0f1e33";
  grid.innerHTML = [
    dw("Service Reminders" + filterNote, dwPair(remO, "Overdue", remO ? R : G, remS, "Due Soon", remS ? A : G)),
    dw("Vehicle Renewals · RTO", dwPair(vrO, "Overdue", vrO ? R : G, vrS, "Due Soon", vrS ? A : G)),
    dw("Driver Renewals · DL", dwPair(drO, "Overdue", drO ? R : G, drS, "Due Soon", drS ? A : G)),
    dw("Warranties", dwPair(wtO, "Expired", wtO ? R : G, wtS, "Expiring", wtS ? A : G)),
    dw("Open Issues", `<div class="dw-pair"><div><span class="dw-big">${openIss.length}</span><span class="dw-sub">Open now</span></div><div><span class="dw-big" style="color:${highOpen ? R : G}">${highOpen}</span><span class="dw-sub">Critical</span></div></div>` + miniBars(issM, mL, PAL.serious)),
    dw("Time to Resolve", `<span class="dw-big">${avgResolve ? avgResolve.toFixed(1) : "—"}<small>days</small></span><span class="dw-sub">Average, resolved issues</span>`),
    dw("Job Cards", dwPair(openWO.length, "In workshop", openWO.length ? A : G, oldestWO, "Oldest (days)", oldestWO > 5 ? R : N)),
    dw("Vehicle Status", dwPair(fVehs.length - inShop, "Active", G, inShop, "In Shop", inShop ? A : G)),
    dw("Assignments", dwPair(assigned, "Assigned", N, Math.max(fVehs.length - assigned, 0), "Unassigned", fVehs.length - assigned ? A : G)),
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

  // cost widgets live on the FleetFin dashboard (filter-scoped)
  const finGrid = document.getElementById("finGrid");
  if (finGrid) finGrid.innerHTML = [
    dw("Fuel Costs" + filterNote, miniBars(fuelM, mL, PAL.s1) + `<span class="dw-sub">This month: <strong>${fmtINR(fuelM[fuelM.length - 1])}</strong></span>`),
    dw("Service Costs", miniBars(svcM, mL, PAL.s3) + `<span class="dw-sub">This month: <strong>${fmtINR(svcM[svcM.length - 1])}</strong></span>`),
    dw("Total Costs", miniBars(totM, mL, PAL.s2) + `<span class="dw-sub">6-month total: <strong>${fmtINR(totM.reduce((a, b) => a + b, 0))}</strong></span>`),
    dw("Cost per km", `<span class="dw-big">₹${cpk ? cpk.toFixed(1) : "—"}</span><span class="dw-sub">All-in, from ${km.toLocaleString("en-IN")} km logged</span>`),
    dw("Top Repair Spend", topCats.map(([c, amt]) =>
      `<div class="dw-rank"><span class="dw-rank-l">${esc(c)}</span><span class="dw-rank-bar"><i style="width:${Math.round(amt / maxCat * 100)}%"></i></span><span class="dw-rank-v">${fmtINR(amt)}</span></div>`).join("") || "<span class='dw-sub'>No expenses yet</span>", "dw-w2"),
    dw("Recurrent Expenses", Object.entries(byCat)
      .map(([c, amt]) => ({ c, amt, n: fExps.filter(e => e.category === c).length }))
      .filter(x => x.n >= 3).sort((a, b) => b.n - a.n).slice(0, 5)
      .map(x => `<div class="dw-rank"><span class="dw-rank-l">${esc(x.c)}</span><span class="dw-rank-v">${x.n}×</span><span class="dw-rank-v">avg ${fmtINR(x.amt / x.n)}</span></div>`).join("") || "<span class='dw-sub'>No repeating categories yet</span>", "dw-w2")
  ].join("");

  const upd = document.getElementById("dashUpdated");
  if (upd) upd.textContent = "Live · updated " + now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// ════════════════════════════════════════════════════════════════════════════
// SMS NOTIFICATION SETTINGS (home page)
// ════════════════════════════════════════════════════════════════════════════

const SMS_NOTIF_EVENTS = [
  { key: "sos",            label: "SOS / Breakdown alert",        desc: "Instantly when driver triggers SOS" },
  { key: "halt",           label: "Vehicle Halt / Breakdown",     desc: "When dispatch status changes to Halt or Maintenance" },
  { key: "driver_assign",  label: "Driver Assigned to Vehicle",   desc: "When a driver is linked to a vehicle" },
  { key: "supervisor_assign", label: "Supervisor Assigned to Site", desc: "When a supervisor is assigned to a site" },
  { key: "dispatch_plan",  label: "Daily Dispatch Plan Ready",    desc: "When today's plan is created" },
  { key: "loading_done",   label: "Loading Done",                 desc: "When dispatch task type = loading is completed" },
  { key: "unloading_done", label: "Unloading Done",               desc: "When dispatch task type = unloading is completed" },
  { key: "workorder",      label: "New Job Card Raised",          desc: "When a work order is created" },
  { key: "workorder_done", label: "Job Card Completed",           desc: "When a work order is marked completed" },
  { key: "salary_paid",    label: "Salary / Payment Sent",        desc: "When a driver payment is processed" },
  { key: "document",       label: "Document Expiry Reminder",     desc: "30 days and 7 days before expiry" },
  { key: "payment",        label: "Payment Request from Driver",  desc: "When driver raises a payment request" },
];

function _notifSettingsHtml(phoneId, scope) {
  const prefs = db.settings?.smsNotifs || {};
  const ownerPhone = db.settings?.ownerPhone || db.settings?.contactPhone || "";
  return `
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <label style="font-size:0.85rem;font-weight:600">Owner mobile for SMS:</label>
      <input type="tel" id="${phoneId}" value="${escAttr(ownerPhone)}" placeholder="e.g. 9876543210"
        style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;font-size:0.85rem;width:180px;background:var(--surface);color:var(--text)" />
      <span class="muted" style="font-size:0.76rem">All SMS alerts go to this number</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">
      ${SMS_NOTIF_EVENTS.map(ev => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;cursor:pointer">
          <input type="checkbox" data-notif="${ev.key}" data-scope="${scope}" ${prefs[ev.key] !== false ? "checked" : ""}
            style="margin-top:3px;accent-color:var(--brand);width:16px;height:16px;flex-shrink:0" />
          <span>
            <strong style="font-size:0.85rem;display:block">${esc(ev.label)}</strong>
            <span class="muted" style="font-size:0.76rem">${esc(ev.desc)}</span>
          </span>
        </label>`).join("")}
    </div>`;
}

function renderNotifSettings() {
  const hub = document.getElementById("hubNotifSettings");
  if (hub) hub.innerHTML = _notifSettingsHtml("notifPhone", "hub");
  const tab = document.getElementById("smsnotifTabBody");
  if (tab) tab.innerHTML = _notifSettingsHtml("smsnotifPhone", "tab");
}

window.saveNotifSettings = async function(scope) {
  scope = scope || "hub";
  const phoneId = scope === "tab" ? "smsnotifPhone" : "notifPhone";
  const phoneEl = document.getElementById(phoneId);
  const phone   = (phoneEl?.value || "").trim();
  const prefs   = {};
  document.querySelectorAll(`[data-notif][data-scope="${scope}"]`).forEach(cb => {
    prefs[cb.dataset.notif] = cb.checked;
  });
  db.settings = { ...db.settings, ownerPhone: phone, smsNotifs: prefs };
  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const orgId = await dbOrgId();
    if (orgId) await fwCloud.authPatch(`organizations?id=eq.${orgId}`, { settings: db.settings });
  }
  saveStore();
  renderNotifSettings();
  toast("Notification settings saved.");
};

// returns true if a given event is enabled in settings (default on)
function smsEnabled(eventKey) {
  const prefs = db.settings?.smsNotifs;
  if (!prefs) return true;
  return prefs[eventKey] !== false;
}

// ── SMS helper ─────────────────────────────────────────────────────────────
// Fire-and-forget — never blocks the UI. Silently skips if not signed in,
// if MSG91 secrets are not yet configured, or if the event is toggled off.
async function sendSms(event, recipients) {
  if (!window.fwCloud || !fwCloud.user()) return;
  if (!smsEnabled(event)) return;
  const valid = recipients.filter(r => (r.mobile || r.mobiles || "").replace(/\D/g,"").length >= 10);
  if (!valid.length) return;
  try {
    await fwCloud.authFn("send-sms", { event, recipients: valid });
  } catch (e) {
    console.warn("SMS send failed (non-blocking):", e);
  }
}

// ── nav helper ─────────────────────────────────────────────────────────────
window.switchTab = function(tabName) {
  document.querySelector(`#tabBar .tab-btn[data-tab="${tabName}"]`)?.click();
};

// ── Hub Sites & Projects summary (home page) ───────────────────────────────
function renderHubSites() {
  const el = document.getElementById("hubSitesList");
  if (!el) return;
  if (!coreDbBacked()) {
    el.innerHTML = "<p class='muted' style='padding:8px'>Sign in to manage sites and projects.</p>";
    return;
  }
  const active = _sites.filter(s => s.status === "active");
  if (!active.length) {
    el.innerHTML = `<p class='muted' style='padding:10px 4px'>No active sites yet — create your first site or project above.</p>`;
    return;
  }
  const BILLING_LABELS = { trip:"Per Trip", tonnage:"Per MT", monthly_rental:"Monthly Rental", hourly:"Hourly", km_based:"Per KM", custom:"Custom" };
  const PTYPE_LABELS   = { intercity:"Intercity", local_movement:"Local", long_haul:"Long Haul", depot:"Depot", yard:"Yard", customer_site:"Customer Site", construction:"Construction", mining:"Mining", agriculture:"Agriculture", logistics_hub:"Logistics Hub", other:"Other" };
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;padding:4px 0 8px">` +
    active.map(s => {
      const vehs   = (_siteVeh[s.id] || []).filter(a => !a.removed_date).length;
      const staff  = (_siteStaff[s.id] || []).filter(a => !a.left_date).length;
      const billing= BILLING_LABELS[s.billing_basis] || s.billing_basis || "";
      const ptype  = PTYPE_LABELS[s.project_type] || s.project_type || "";
      return `<div style="border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="font-size:0.97rem">${esc(s.name)}</strong>
          <span class="fw-badge upcoming" style="font-size:0.7rem">${ptype}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:0.8rem;color:var(--text-muted)">
          <span>${FWIcon("truck",{size:12})} <strong>${vehs}</strong> vehicle${vehs!==1?"s":""}</span>
          <span>${FWIcon("driver",{size:12})} <strong>${staff}</strong> staff</span>
          ${billing ? `<span>${FWIcon("rupee",{size:12})} ${billing}</span>` : "<span></span>"}
          ${s.supervisor_name ? `<span>${FWIcon("user",{size:12})} ${esc(s.supervisor_name)}</span>` : "<span></span>"}
          ${s.client_name ? `<span style="grid-column:1/-1">${FWIcon("user",{size:12})} Client: ${esc(s.client_name)}</span>` : ""}
          ${s.manager_name ? `<span style="grid-column:1/-1">${FWIcon("user",{size:12})} Manager: ${esc(s.manager_name)}</span>` : ""}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto">
          <button class="btn btn-outline btn-sm" onclick="openAssignSiteVehicles('${s.id}')">${FWIcon("truck",{size:13})} Vehicles</button>
          <button class="btn btn-outline btn-sm" onclick="openAssignSiteStaff('${s.id}')">${FWIcon("driver",{size:13})} Staff</button>
          <button class="btn btn-outline btn-sm" onclick="openEditSite('${s.id}')">${FWIcon("document",{size:13})} Edit</button>
        </div>
      </div>`;
    }).join("") + `</div>`;
  if (window.FWIcons) FWIcons.hydrate(el);
}

function renderOverview() {
  const insights = computeInsights();
  if (window.renderGfOps) renderGfOps();
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

// ---------- Add Vehicle (FleetOps main page) ----------
function vehicleFieldsFromForm(fd) {
  return {
    name: (fd.name || "").trim().toUpperCase(),
    type: fd.type,
    kmPerMonth: +fd.kmPerMonth || 0,
    status: fd.status || "Active",
    make: (fd.make || "").trim() || undefined,
    model: (fd.model || "").trim() || undefined,
    year: fd.year ? +fd.year : undefined,
    chassisNo: (fd.chassisNo || "").trim().toUpperCase() || undefined,
    engineNo: (fd.engineNo || "").trim().toUpperCase() || undefined,
    ownership: fd.ownership || undefined,
    group: (fd.group || "").trim() || undefined,
    depot: (fd.depot || "").trim() || undefined,
    emission: fd.emission || undefined,
    fuelType: fd.fuelType || undefined,
    tankCapacity: fd.tankCapacity ? +fd.tankCapacity : undefined,
    color: (fd.color || "").trim() || undefined,
    gvw: fd.gvw ? +fd.gvw : undefined,
    payload: fd.payload ? +fd.payload : undefined,
    axleConfig: fd.axleConfig || undefined,
    tyreFrontPsi: fd.tyreFrontPsi ? +fd.tyreFrontPsi : undefined,
    tyreRearPsi: fd.tyreRearPsi ? +fd.tyreRearPsi : undefined,
    tyreSize: (fd.tyreSize || "").trim() || undefined,
    rto: (fd.rto || "").trim() || undefined,
    purchaseDate: fd.purchaseDate || undefined,
    purchasePrice: fd.purchasePrice ? +fd.purchasePrice : undefined,
    purchaseVendor: (fd.purchaseVendor || "").trim() || undefined,
    inServiceDate: fd.inServiceDate || undefined,
    serviceLifeMonths: fd.serviceLifeMonths ? +fd.serviceLifeMonths : undefined,
    resaleValue: fd.resaleValue ? +fd.resaleValue : undefined,
    notes: (fd.notes || "").trim() || undefined,
    compliance: {
      insurance: fd.insurance || "", puc: fd.puc || "", fitness: fd.fitness || "",
      permit: fd.permit || "", roadtax: fd.roadtax || ""
    }
  };
}
async function saveNewVehicle(form) {
  const fd = Object.fromEntries(new FormData(form));
  const v = { id: uid(), ...vehicleFieldsFromForm(fd) };
  if (!v.name || !v.type) { alert("Registration number and vehicle type are required."); return null; }
  if (db.vehicles.some(x => x.name === v.name)) { alert(v.name + " is already in your fleet."); return null; }

  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateVehicle(v);
    if (!saved) { alert("Could not save this vehicle — check your connection and try again."); return null; }
    Object.assign(v, saved); // picks up dbId; id stays the same (we sent it as ext_id)
    db.vehicles.push(v);
    // opening odometer becomes the first meter reading
    if (fd.odo) {
      const fl = { vehicleId: v.id, date: new Date().toISOString().slice(0, 10), litres: 0, amount: 0, odo: +fd.odo, opening: true };
      const savedFl = await dbCreateFuelLog(fl);
      if (savedFl) db.fuelLogs.push(savedFl);
    }
    if (fd.driverId) {
      const d = db.drivers.find(x => x.id === fd.driverId);
      if (d) { d.vehicleId = v.id; if (d.dbId && v.dbId) await dbAssignVehicleToDriver(d.dbId, v.dbId); }
    }
  } else {
    db.vehicles.push(v);
    if (fd.odo) db.fuelLogs.push({ id: uid(), vehicleId: v.id, date: new Date().toISOString().slice(0, 10), litres: 0, amount: 0, odo: +fd.odo, opening: true });
    if (fd.driverId) { const d = db.drivers.find(x => x.id === fd.driverId); if (d) d.vehicleId = v.id; }
  }
  saveStore();
  renderAll();
  return v;
}

// ---------- Vehicle edit (reuses the Add Vehicle form) ----------
let vehicleEditId = null;
async function updateVehicleInPlace(form, id) {
  const v = db.vehicles.find(x => x.id === id);
  if (!v) return null;
  const fd = Object.fromEntries(new FormData(form));
  const fields = vehicleFieldsFromForm(fd);
  if (!fields.name || !fields.type) { alert("Registration number and vehicle type are required."); return null; }
  if (db.vehicles.some(x => x.id !== id && x.name === fields.name)) { alert(fields.name + " is already used by another vehicle."); return null; }

  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const ok = await dbUpdateVehicleFields(v.id, fields);
    if (!ok) { alert("Could not save this vehicle — check your connection and try again."); return null; }
  }
  Object.assign(v, fields);

  // driver (re)assignment, mirroring saveNewVehicle's create-time logic
  const currentDriver = db.drivers.find(d => d.vehicleId === v.id);
  const newDriverId = fd.driverId || "";
  if (newDriverId !== (currentDriver ? currentDriver.id : "")) {
    if (currentDriver) {
      currentDriver.vehicleId = "";
      if (typeof coreDbBacked === "function" && coreDbBacked() && currentDriver.dbId) await dbUpdateDriver(currentDriver.id, { vehicleId: "" });
    }
    if (newDriverId) {
      const d = db.drivers.find(x => x.id === newDriverId);
      if (d) {
        d.vehicleId = v.id;
        if (typeof coreDbBacked === "function" && coreDbBacked() && d.dbId && v.dbId) await dbAssignVehicleToDriver(d.dbId, v.dbId);
      }
    }
  }
  saveStore();
  renderAll();
  return v;
}
function openEditVehicle(id) {
  const v = db.vehicles.find(x => x.id === id);
  if (!v) return;
  vehicleEditId = id;
  const form = document.getElementById("addVehForm");
  form.reset();
  form.name.value = v.name || ""; form.type.value = v.type || ""; form.status.value = v.status || "Active";
  form.make.value = v.make || ""; form.model.value = v.model || ""; form.year.value = v.year || "";
  form.chassisNo.value = v.chassisNo || ""; form.engineNo.value = v.engineNo || ""; form.ownership.value = v.ownership || "";
  form.kmPerMonth.value = v.kmPerMonth || "";
  const currentDriver = db.drivers.find(d => d.vehicleId === v.id);
  fillDriverSelect(currentDriver ? currentDriver.id : "");
  if (currentDriver) form.driverId.value = currentDriver.id;
  form.group.value = v.group || ""; form.depot.value = v.depot || ""; form.emission.value = v.emission || "";
  form.fuelType.value = v.fuelType || "Diesel"; form.tankCapacity.value = v.tankCapacity || ""; form.color.value = v.color || "";
  form.gvw.value = v.gvw || ""; form.payload.value = v.payload || ""; form.axleConfig.value = v.axleConfig || "";
  form.tyreFrontPsi.value = v.tyreFrontPsi || ""; form.tyreRearPsi.value = v.tyreRearPsi || ""; form.tyreSize.value = v.tyreSize || "";
  const c = v.compliance || {};
  form.insurance.value = c.insurance || ""; form.puc.value = c.puc || ""; form.fitness.value = c.fitness || "";
  form.permit.value = c.permit || ""; form.roadtax.value = c.roadtax || ""; form.rto.value = v.rto || "";
  form.purchaseDate.value = v.purchaseDate || ""; form.purchasePrice.value = v.purchasePrice || ""; form.purchaseVendor.value = v.purchaseVendor || "";
  form.inServiceDate.value = v.inServiceDate || ""; form.serviceLifeMonths.value = v.serviceLifeMonths || ""; form.resaleValue.value = v.resaleValue || "";
  form.notes.value = v.notes || "";
  // odo is an opening-meter-reading field, meaningful only when a vehicle is
  // first created — leave blank and out of the way during edit.
  form.odo.value = ""; form.odo.disabled = true; form.odo.placeholder = "Only set when a vehicle is first added";

  document.getElementById("addVehSubmitBtn").innerHTML = `${FWIcon("check", { size: 18 })} Save Changes`;
  document.getElementById("avSaveAdd").hidden = true;
  document.getElementById("addVehCancelEdit").hidden = false;
  document.querySelector('#tabBar .tab-btn[data-tab="addvehicle"]')?.click();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}
function resetVehicleFormToAddMode() {
  vehicleEditId = null;
  const form = document.getElementById("addVehForm");
  form.reset();
  form.odo.disabled = false; form.odo.placeholder = "meter reading today";
  document.getElementById("addVehSubmitBtn").innerHTML = `${FWIcon("check", { size: 18 })} Save Vehicle`;
  document.getElementById("avSaveAdd").hidden = false;
  document.getElementById("addVehCancelEdit").hidden = true;
}
document.getElementById("addVehCancelEdit")?.addEventListener("click", resetVehicleFormToAddMode);

function fillDriverSelect(includeAssignedToId) {
  const sel = document.getElementById("avDriver");
  if (!sel) return;
  sel.innerHTML = '<option value="">Not assigned</option>' +
    db.drivers.filter(d => !d.vehicleId || d.id === includeAssignedToId).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
}

// ---------- Getting Started (signed-in, empty fleet) ----------
function renderGettingStarted() {
  const list = document.getElementById("gsList");
  if (!list) return;
  const nameEl = document.getElementById("gsName");
  if (nameEl && window.ownerDisplayName) nameEl.textContent = ownerDisplayName();
  const steps = [
    { t: "Add your first vehicle", d: "Registration, type and monthly running — that's all it takes to start.", done: db.vehicles.length > 0, tab: "addvehicle" },
    { t: "Add your drivers", d: "Keep DL validity tracked, and give each driver a no-login entry link.", done: db.drivers.length > 0, tab: "drivers" },
    { t: "Log diesel or an expense", d: "Scan a bill or type it in — mileage and cost-per-km start computing.", done: (db.fuelLogs || []).length > 0 || db.expenses.length > 0, tab: "gstbills" },
    { t: "Set service reminders", d: "Oil change, PMS, greasing — FleetWorks warns you before they're due.", done: db.reminders.length > 0, tab: "reminders" },
    { t: "Fill RTO renewal dates", d: "Insurance, PUC, FC, permit and road tax — never miss a renewal again.", done: db.vehicles.some(v => v.compliance && Object.values(v.compliance).some(Boolean)), tab: "vehicles" }
  ];
  list.innerHTML = steps.map((s, i) => `
    <button type="button" class="gs-item ${s.done ? "done" : ""}" onclick="document.querySelector('#tabBar .tab-btn[data-tab=${s.tab}]').click()">
      <span class="gs-num">${s.done ? FWIcon("check", { size: 15 }) : i + 1}</span>
      <span class="gs-txt"><strong>${esc(s.t)}</strong><span class="muted">${esc(s.d)}</span></span>
      <span class="gs-go">${s.done ? "Done" : "Start →"}</span>
    </button>`).join("");
}

// ---------- Render: trips & revenue ----------
function renderTrips() {
  const tbl = document.getElementById("tripsTable"), pt = document.getElementById("profitTable");
  if (!tbl || !pt) return;
  const trips = [...(db.trips || [])].sort((a, b) => b.date.localeCompare(a.date));
  tbl.innerHTML = trips.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Route</th><th>Freight</th><th></th></tr></thead><tbody>` +
    trips.slice(0, 50).map(t => `<tr><td>${fmtDate(t.date)}</td><td><strong>${esc(vName(t.vehicleId))}</strong></td><td>${esc(t.from)} &rarr; ${esc(t.to)}</td><td><strong>${fmtINR(t.freight)}</strong></td><td><button class="link-btn" onclick="openEditTrip('${t.id}')">Edit</button></td></tr>`).join("") + "</tbody></table>"
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
function openEditTrip(id) {
  const t = (db.trips || []).find(x => x.id === id);
  if (!t) return;
  openEditModal("Edit Trip", `
    <div class="form-row">
      <label>Vehicle<select name="vehicleId" required>${vehicleOptionsHtml(t.vehicleId)}</select></label>
      <label>Date<input type="date" name="date" value="${t.date || ""}" required /></label>
    </div>
    <div class="form-row">
      <label>From<input type="text" name="from" value="${escAttr(t.from || "")}" required /></label>
      <label>To<input type="text" name="to" value="${escAttr(t.to || "")}" required /></label>
    </div>
    <div class="form-row">
      <label>Freight (&#8377;)<input type="number" name="freight" min="0" value="${t.freight}" required /></label>
      <label>KM (optional)<input type="number" name="km" min="0" value="${t.km != null ? t.km : ""}" /></label>
    </div>`, async fd => {
    const patch = {
      vehicleId: fd.vehicleId, date: fd.date, from: fd.from.trim(), to: fd.to.trim(),
      freight: +fd.freight, km: fd.km ? +fd.km : undefined,
    };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateTrip(t.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(t, patch);
    saveStore(); renderTrips(); renderOverview();
    closeEditModal(); toast("Trip updated.");
  });
}

// ---------- Trip Workflow Engine (owner side) ----------

const TRIP_STATUS_LABEL = {
  planned: "Planned", assigned: "Assigned", acknowledged: "Acknowledged",
  started: "In Progress", completed: "Completed", cancelled: "Cancelled"
};
const TRIP_STATUS_COLOR = {
  planned: "#64748b", assigned: "#2563eb", acknowledged: "#7c3aed",
  started: "#d97706", completed: "#059669", cancelled: "#dc2626"
};

let _tripWorkflowInterval = null;

async function loadActiveTripWorkflow() {
  if (!window.fwCloud || !fwCloud.user()) return;
  try {
    const sb = fwCloud.supabase();
    // Active trips
    const { data: trips } = await sb.from("trips")
      .select("id,vehicle_id,from_loc,to_loc,cargo_description,status,driver_name,planned_start,planned_end,actual_start,freight,km")
      .in("status", ["planned","assigned","acknowledged","started"])
      .order("planned_start", { ascending: true })
      .limit(20);

    renderActiveTrips(trips || []);

    // Pending requests
    const { data: reqs } = await sb.from("trip_requests")
      .select("id,trip_id,request_type,amount,reason,status,created_at,trips(from_loc,to_loc,vehicle_id,driver_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    renderTripRequests(reqs || []);
  } catch (e) {
    console.warn("Trip workflow load failed:", e);
  }
}

function renderActiveTrips(trips) {
  const el = document.getElementById("activeTripsTable");
  if (!el) return;
  if (!trips.length) {
    el.innerHTML = "<p class='muted' style='padding:12px'>No active trips. Click <strong>Plan Trip</strong> to start.</p>";
    return;
  }
  el.innerHTML = `<table class="chart-table-el"><thead><tr>
    <th>Vehicle</th><th>Driver</th><th>Route</th><th>Cargo</th><th>Status</th><th>Planned</th><th></th>
  </tr></thead><tbody>` +
  trips.map(t => {
    const veh = (db.vehicles || []).find(v => v.id === t.vehicle_id);
    const st = TRIP_STATUS_LABEL[t.status] || t.status;
    const sc = TRIP_STATUS_COLOR[t.status] || "#64748b";
    return `<tr>
      <td><strong>${esc(veh ? veh.name : t.vehicle_id)}</strong></td>
      <td>${esc(t.driver_name || "—")}</td>
      <td>${esc(t.from_loc || "—")} → ${esc(t.to_loc || "—")}</td>
      <td class="muted">${esc(t.cargo_description || "—")}</td>
      <td><span class="fw-badge" style="background:${sc}20;color:${sc};border:1px solid ${sc}40">${st}</span></td>
      <td class="muted">${t.planned_start ? fmtDate(t.planned_start.slice(0,10)) : "—"}</td>
      <td>
        ${t.status === "started" ? `<button class="link-btn" onclick="completeTripWorkflow('${t.id}')">Complete</button>` : ""}
        ${t.status === "assigned" || t.status === "acknowledged" ? `<button class="link-btn" onclick="cancelTripWorkflow('${t.id}')">Cancel</button>` : ""}
      </td>
    </tr>`;
  }).join("") + "</tbody></table>";
  if (window.FWIcon) el.querySelectorAll("[data-icon]").forEach(i => { i.innerHTML = FWIcon(i.dataset.icon, {size:+i.dataset.iconSize||14}); });
}

function renderTripRequests(reqs) {
  const card = document.getElementById("tripRequestsCard");
  const el = document.getElementById("tripRequestsList");
  if (!card || !el) return;
  card.hidden = reqs.length === 0;
  if (!reqs.length) return;

  const TYPE_ICON = { diesel: "fuel", advance: "wallet", toll: "mapPin" };
  const TYPE_LABEL = { diesel: "Diesel", advance: "Advance", toll: "Toll" };

  el.innerHTML = reqs.map(r => {
    const trip = r.trips || {};
    const veh = (db.vehicles || []).find(v => v.id === trip.vehicle_id);
    return `<div class="trip-req-row">
      <div class="trip-req-icon"><i data-icon="${TYPE_ICON[r.request_type]||'alert'}" data-icon-size="18"></i></div>
      <div class="trip-req-body">
        <strong>${TYPE_LABEL[r.request_type]||r.request_type} Request</strong>
        <span class="muted">${esc(veh ? veh.name : "")} · ${esc(trip.driver_name || "")} · ${trip.from_loc||""} → ${trip.to_loc||""}</span>
        ${r.reason ? `<span class="muted">${esc(r.reason)}</span>` : ""}
      </div>
      <div class="trip-req-amt">₹${fmtINR(r.amount || 0)}</div>
      <button class="btn btn-primary btn-sm" onclick="openApproveModal('${r.id}','${r.request_type}',${r.amount||0},'${esc(trip.driver_name||"")}')">Approve</button>
    </div>`;
  }).join("");

  if (window.FWIcon) el.querySelectorAll("[data-icon]").forEach(i => { i.innerHTML = FWIcon(i.dataset.icon, {size:+i.dataset.iconSize||18}); });
}

// Plan trip modal
window.openPlanTripModal = function() {
  const modal = document.getElementById("planTripModal");
  if (!modal) return;
  // populate vehicle select
  const vs = document.getElementById("planTripVehicle");
  vs.innerHTML = vehicleOptionsHtml("");
  // populate driver select
  const ds = document.getElementById("planTripDriver");
  ds.innerHTML = '<option value="">Select driver…</option>' +
    (db.drivers || []).filter(d => d.linkToken).map(d =>
      `<option value="${d.id}" data-token="${d.linkToken}" data-name="${escAttr(d.name)}">${esc(d.name)}</option>`
    ).join("");
  // default planned_start to now rounded to next hour
  const now = new Date(); now.setMinutes(0,0,0); now.setHours(now.getHours()+1);
  const f = document.querySelector("#planTripForm [name='planned_start']");
  if (f) f.value = now.toISOString().slice(0,16);
  modal.style.display = "flex";
};
window.closePlanTripModal = function() {
  const modal = document.getElementById("planTripModal");
  if (modal) modal.style.display = "none";
};

document.getElementById("planTripForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target;
    const fd = Object.fromEntries(new FormData(form));
    const errEl = document.getElementById("planTripErr");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; errEl.hidden = true;
    try {
      const sb = fwCloud.supabase();
      const driverOpt = document.querySelector(`#planTripDriver option[value="${fd.driverId}"]`);
      const driverName = driverOpt ? driverOpt.dataset.name : "";
      const driverToken = driverOpt ? driverOpt.dataset.token : "";

      // fetch FASTag balance for vehicle
      let fastagBal = null, fastagAt = null;
      try {
        const { data: ft } = await sb.from("fastag_accounts")
          .select("balance,balance_at").eq("vehicle_id", fd.vehicleId).eq("is_active", true).single();
        if (ft) { fastagBal = ft.balance; fastagAt = ft.balance_at; }
      } catch { /* FASTag optional */ }

      const { error } = await sb.from("trips").insert({
        org_id: fwCloud.orgId(),
        vehicle_id: fd.vehicleId,
        driver_id: fd.driverId || null,
        driver_name: driverName,
        driver_link_token: driverToken,
        from_loc: fd.from_loc.trim(),
        to_loc: fd.to_loc.trim(),
        cargo_description: fd.cargo_description.trim() || null,
        planned_start: fd.planned_start || null,
        planned_end: fd.planned_end || null,
        freight: +fd.freight || null,
        km: +fd.km || null,
        trip_date: fd.planned_start ? fd.planned_start.slice(0,10) : new Date().toISOString().slice(0,10),
        status: "assigned",
        fastag_balance: fastagBal,
        fastag_balance_at: fastagAt,
      });
      if (error) throw error;
      toast("Trip assigned — driver will see it in their app.");
      closePlanTripModal();
      form.reset();
      loadActiveTripWorkflow();
    } catch (err) {
      errEl.textContent = "Could not save — " + (err.message || "check connection.");
      errEl.hidden = false;
    }
    btn.disabled = false;
});

// Complete / cancel trip
window.completeTripWorkflow = async function(tripId) {
  if (!confirm("Mark this trip as completed?")) return;
  try {
    const { error } = await fwCloud.supabase().from("trips")
      .update({ status: "completed", actual_end: new Date().toISOString() })
      .eq("id", tripId).eq("org_id", fwCloud.orgId());
    if (error) throw error;
    toast("Trip marked complete.");
    loadActiveTripWorkflow();
  } catch { toast("Could not update — check connection.", true); }
};
window.cancelTripWorkflow = async function(tripId) {
  if (!confirm("Cancel this trip?")) return;
  try {
    const { error } = await fwCloud.supabase().from("trips")
      .update({ status: "cancelled" }).eq("id", tripId).eq("org_id", fwCloud.orgId());
    if (error) throw error;
    toast("Trip cancelled.");
    loadActiveTripWorkflow();
  } catch { toast("Could not update — check connection.", true); }
};

// Approve request modal
let _pendingReqId = null;
window.openApproveModal = function(reqId, type, amount, driverName) {
  _pendingReqId = reqId;
  document.getElementById("approveReqTitle").textContent = (type === "diesel" ? "Diesel" : type === "advance" ? "Advance" : "Toll") + " Request";
  document.getElementById("approveReqSub").textContent = "From " + driverName;
  document.getElementById("approveReqAmt").value = amount || "";
  document.getElementById("approveReqModal").style.display = "flex";
};
window.closeApproveModal = function() {
  document.getElementById("approveReqModal").style.display = "none";
  _pendingReqId = null;
};
window.confirmApproveRequest = async function() {
  if (!_pendingReqId) return;
  const amt = +document.getElementById("approveReqAmt").value;
  if (!amt) { alert("Enter an approved amount."); return; }
  const sb = fwCloud.supabase();
  try {
    // 1. Approve the request
    const { data: req, error } = await sb.from("trip_requests")
      .update({ status: "approved", paid_amount: amt, approved_at: new Date().toISOString(), approved_by: fwCloud.user()?.email || "owner" })
      .eq("id", _pendingReqId)
      .select("request_type,trip_id,org_id").single();
    if (error) throw error;

    // 2. Auto-create FleetFin entries when approved
    if (req) {
      try {
        // Fetch trip to get vehicle_id + driver_id
        const { data: trip } = await sb.from("trips")
          .select("vehicle_id,driver_id,driver_name,from_loc,to_loc").eq("id", req.trip_id).single();

        const today = new Date().toISOString().slice(0, 10);
        if (req.request_type === "diesel" && trip?.vehicle_id) {
          // Create fuel log entry
          await sb.from("fuel_logs").insert({
            org_id: req.org_id, vehicle_id: trip.vehicle_id,
            date: today, litres: 0, amount: amt,
            note: "Trip diesel advance — " + (trip.from_loc || "") + "→" + (trip.to_loc || ""),
          });
        } else if (req.request_type === "advance" && trip?.driver_id) {
          // Create driver ledger advance entry
          await sb.from("driver_ledger").insert({
            org_id: req.org_id, driver_id: trip.driver_id,
            entry_date: today, type: "advance", amount: amt,
            note: "Trip advance — " + (trip.from_loc || "") + "→" + (trip.to_loc || ""),
          });
        }
      } catch { /* FleetFin entry optional, don't block */ }
    }

    toast("Request approved — driver notified. FleetFin updated.");
    closeApproveModal();
    loadActiveTripWorkflow();
  } catch { toast("Could not approve — check connection.", true); }
};
window.confirmRejectRequest = async function() {
  if (!_pendingReqId) return;
  if (!confirm("Reject this request?")) return;
  try {
    const { error } = await fwCloud.supabase().from("trip_requests")
      .update({ status: "rejected" }).eq("id", _pendingReqId);
    if (error) throw error;
    toast("Request rejected.");
    closeApproveModal();
    loadActiveTripWorkflow();
  } catch { toast("Could not reject — check connection.", true); }
};

// Legacy trip form toggle
window.openLegacyTripForm = function() {
  const card = document.getElementById("legacyTripFormCard");
  if (!card) return;
  card.hidden = false;
  const vs = document.getElementById("tripVehicleSelect");
  if (vs) vs.innerHTML = vehicleOptionsHtml("");
  const d = card.querySelector('[name="date"]');
  if (d) d.value = new Date().toISOString().slice(0,10);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
};

// Poll for new requests every 45s while trips tab is active (started by activateTab)

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
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Driver</th><th>Type</th><th>Amount</th><th>Note</th><th></th></tr></thead><tbody>` +
    rows.map(l => {
      const d = db.drivers.find(x => x.id === l.driverId);
      return `<tr><td>${fmtDate(l.date)}</td><td><strong>${d ? esc(d.name) : "—"}</strong></td><td>${KHATA_LABEL[l.type] || l.type}</td><td>${fmtINR(l.amount)}</td><td>${esc(l.note || "")}</td><td><button class="link-btn" onclick="openEditKhata('${l.id}')">Edit</button></td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>No khata entries yet.</p>";
}
function openEditKhata(id) {
  const l = (db.driverLedger || []).find(x => x.id === id);
  if (!l) return;
  openEditModal("Edit Khata Entry", `
    <div class="form-row">
      <label>Driver<select name="driverId" required>${driverOptionsHtml(l.driverId)}</select></label>
      <label>Entry type
        <select name="type" required>
          <option value="advance" ${l.type === "advance" ? "selected" : ""}>Advance given to driver</option>
          <option value="expense" ${l.type === "expense" ? "selected" : ""}>Trip expense (from advance)</option>
          <option value="settlement" ${l.type === "settlement" ? "selected" : ""}>Cash returned / settled</option>
        </select>
      </label>
    </div>
    <div class="form-row">
      <label>Amount (&#8377;)<input type="number" name="amount" min="1" value="${l.amount}" required /></label>
      <label>Date<input type="date" name="date" value="${l.date || ""}" required /></label>
    </div>
    <label>Note<input type="text" name="note" value="${escAttr(l.note || "")}" /></label>`, async fd => {
    const patch = { driverId: fd.driverId, type: fd.type, amount: +fd.amount, date: fd.date, note: fd.note.trim() || undefined };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateLedgerEntry(l.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(l, patch);
    saveStore(); renderKhata(); renderOverview();
    closeEditModal(); toast("Khata entry updated.");
  });
}

// ---------- Vehicle Health Score (0–100) ----------
// One number per truck: compliance + open issues + inspections + tyres +
// overdue PM + cost deviation + overdue predictions. Higher is healthier.
function healthScore(v) {
  if (window.FWFleetOps && FWFleetOps.healthScore) return FWFleetOps.healthScore(v);
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
  const itemsHtml = items.length
    ? items.slice(0, 12).map(i => `<div class="pred-row inbox-row" data-goto="${i.tab}" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--bg-alt)"><div style="display:flex;align-items:center;gap:10px;font-size:0.87rem"><span class="ic-tile ${i.tone}" style="width:28px;height:28px;flex:none">${FWIcon(i.ic,{size:14})}</span><span style="flex:1;min-width:0">${esc(i.t)}</span><span class="link-btn" style="flex:none;font-size:0.8rem">${i.a} &rarr;</span></div></div>`).join("") +
      (items.length > 12 ? `<p class="muted" style="padding:8px 16px;font-size:0.82rem">+ ${items.length - 12} more inside the workspaces</p>` : "")
    : `<p class="muted" style="padding:16px;text-align:center;font-size:0.85rem">${FWIcon("checkCircle",{size:14,cls:"ic-success"})} All clear — nothing pending today.</p>`;
  el.innerHTML = itemsHtml;
  el.querySelectorAll(".inbox-row").forEach(r => r.addEventListener("click", () => {
    const p = document.getElementById("notifPanel"); if (p) p.setAttribute("hidden", "");
    if (typeof activateTab === "function") activateTab(r.dataset.goto, { replaceHistory: true });
  }));
  // Update bell badge
  const badge = document.getElementById("notifBadge");
  if (badge) { badge.textContent = items.length; badge.hidden = items.length === 0; }
  // Update home hub summary
  const summBadge = document.getElementById("inboxSummaryBadge");
  const summText  = document.getElementById("inboxSummaryText");
  if (summBadge) { summBadge.textContent = items.length + " pending"; summBadge.hidden = !items.length; }
  if (summText)  summText.textContent = items.length ? `${items.length} item${items.length===1?"":"s"} need your attention — click to view` : "All clear — nothing pending today.";
}

window.toggleNotifPanel = function() {
  const p = document.getElementById("notifPanel");
  if (!p) return;
  const isOpen = !p.hasAttribute("hidden");
  if (isOpen) p.setAttribute("hidden", ""); else p.removeAttribute("hidden");
};
document.addEventListener("click", e => {
  const p = document.getElementById("notifPanel");
  if (!p || p.hasAttribute("hidden")) return;
  if (!p.contains(e.target) && !document.getElementById("notifBell")?.contains(e.target))
    p.setAttribute("hidden", "");
});

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
    "&n=" + encodeURIComponent(d.name) + "&v=" + encodeURIComponent(veh) +
    (d.vehicleId ? "&vid=" + encodeURIComponent(d.vehicleId) : "") +
    "&did=" + encodeURIComponent(d.id);
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
    return `<tr class="veh-row" data-vid="${v.id}">
      <td style="cursor:pointer"><strong>${esc(v.name)}</strong><br /><span class="muted">${esc(v.type)} · ${v.kmPerMonth.toLocaleString("en-IN")} km/mo${driver ? " · " + FWIcon("driver", { size: 13, cls: "ic-muted" }) + " " + esc(driver.name) : ""}</span></td>
      <td style="cursor:pointer">${healthBadge(healthScore(v))}</td>
      ${complianceCell(c.insurance)}${complianceCell(c.puc)}${complianceCell(c.fitness)}${complianceCell(c.permit)}${complianceCell(c.roadtax)}
      <td><button class="link-btn" onclick="event.stopPropagation();openEditVehicle('${v.id}')">Edit</button></td></tr>
      <tr class="veh-history" data-hist="${v.id}" hidden><td colspan="8" style="background:#f8fafc">${serviceHistoryHTML(v.id)}</td></tr>`;
  }).join("");
  document.getElementById("vehicleComplianceTable").innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Health</th><th>Insurance</th><th>PUC</th><th>Fitness</th><th>Permit</th><th>Road Tax</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
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
    `<table class="chart-table-el"><thead><tr><th>Driver</th><th>DL Number</th><th>DL Validity</th><th>Assigned Vehicle</th><th>Message</th><th>Driver Link</th><th></th></tr></thead><tbody>` +
    db.drivers.map(d => {
      const days = d.dlExpiry ? daysUntil(d.dlExpiry) : null;
      const pill = days === null ? '<span class="fw-badge upcoming">Not set</span>' :
        days < 0 ? '<span class="fw-badge overdue">' + FWIcon("alert", { size: 13 }) + 'Expired</span>' :
        days <= 30 ? `<span class="fw-badge soon">${FWIcon("clock", { size: 13 })}${days}d left</span>` :
        `<span class="fw-badge ok">${FWIcon("shieldCheck", { size: 13 })}${fmtDate(d.dlExpiry)}</span>`;
      // contextual message: nudge on DL expiry, else a general check-in
      const veh = d.vehicleId ? vName(d.vehicleId) : "";
      const msg = days !== null && days < 30
        ? `Namaste ${d.name}, aapka Driving Licence ${days < 0 ? "expire ho chuka hai" : days + " din mein expire ho raha hai"}. Kripya jaldi renew karayein. — ${ownerName()}`
        : `Namaste ${d.name}${veh ? " (" + veh + ")" : ""}, ${ownerName()} FleetWorks se. `;
      return `<tr><td><strong>${esc(d.name)}</strong>${d.phone ? "<br /><span class='muted'>" + FWIcon("phone", { size: 13, cls: "ic-muted" }) + " " + esc(d.phone) + "</span>" : ""}</td>
        <td>${esc(d.dlNo)}</td><td>${pill}</td><td>${d.vehicleId ? esc(vName(d.vehicleId)) : "<span class='muted'>—</span>"}</td>
        <td>${d.phone ? waBtn(d.phone, msg, "WhatsApp") : "<span class='muted'>No number</span>"}</td>
        <td><button class="link-btn" onclick="copyDriverLink('${d.id}')">${FWIcon("link", { size: 13 })} Copy link</button></td>
        <td><button class="link-btn" onclick="openEditDriver('${d.id}')">Edit</button></td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>No drivers added yet.</p>";
}

// ---------- Render: purchase orders ----------
// In-memory store — loaded fresh from Supabase every renderAll() for signed-in orgs.
// Unsigned/demo mode shows an empty list (no PO support without an account).
let _pos = [];        // purchase_orders rows
let _poLines = {};    // { poId: [lines] }
let _poByExpId = {};  // { expenseId: po } reverse index

const PO_STATUS_META = {
  draft:     { label: "Draft",    cls: "upcoming" },
  approved:  { label: "Approved", cls: "ok" },
  ordered:   { label: "Ordered",  cls: "soon" },
  partial:   { label: "Partial",  cls: "soon" },
  received:  { label: "Received", cls: "ok" },
  cancelled: { label: "Cancelled",cls: "overdue" },
};

async function loadPOs() {
  if (!coreDbBacked()) { _pos = []; _poLines = {}; return; }
  const rows = await fwCloud.authGet("purchase_orders",
    "select=*&order=created_at.desc") || [];
  _pos = rows;
  _poByExpId = {};
  rows.forEach(p => { if (p.expense_id) _poByExpId[p.expense_id] = p; });
  // load lines for visible POs (limit to 100 most recent for performance)
  const ids = rows.slice(0, 100).map(r => r.id);
  if (ids.length) {
    const lines = await fwCloud.authGet("purchase_order_lines",
      `select=*&po_id=in.(${ids.join(",")})&order=created_at.asc`) || [];
    _poLines = {};
    lines.forEach(l => { (_poLines[l.po_id] = _poLines[l.po_id] || []).push(l); });
  } else {
    _poLines = {};
  }
}

function renderPurchaseOrders() {
  const box = document.getElementById("poList");
  if (!box) return;
  if (!coreDbBacked()) {
    box.innerHTML = "<p class='muted'>Sign in to raise and track purchase orders.</p>";
    return;
  }
  if (!_pos.length) {
    box.innerHTML = `<p class='muted' style='text-align:center;padding:32px'>No purchase orders yet — click <strong>New PO</strong> to raise one.</p>`;
    return;
  }
  const open   = _pos.filter(p => !["received","cancelled"].includes(p.status));
  const closed = _pos.filter(p => ["received","cancelled"].includes(p.status));

  function poCard(p) {
    const vm  = PO_STATUS_META[p.status] || { label: p.status, cls: "upcoming" };
    const veh = p.vehicle_id ? (db.vehicles.find(v => v.dbId === p.vehicle_id || v.id === p.vehicle_id)?.name || "Vehicle") : "";
    const lines = _poLines[p.id] || [];
    const linesHtml = lines.length
      ? `<details style="margin-top:6px"><summary style="font-size:0.78rem;cursor:pointer;color:var(--text-muted)">
           ${lines.length} line item${lines.length > 1 ? "s" : ""} — ₹${fmtINR(p.total_amount || 0)} incl. GST</summary>
           <div style="overflow-x:auto;margin-top:6px">
           <table class="chart-table-el" style="font-size:0.78rem">
             <thead><tr><th>Part</th><th>Part No.</th><th>Make</th><th>S/N</th><th>Qty</th><th>Unit ₹</th><th>GST%</th><th>Total ₹</th></tr></thead>
             <tbody>${lines.map(l => `<tr>
               <td>${esc(l.part_name)}</td>
               <td>${l.part_number ? esc(l.part_number) : "<span class='muted'>—</span>"}</td>
               <td>${l.make ? esc(l.make) : "<span class='muted'>—</span>"}</td>
               <td>${l.serial_number ? esc(l.serial_number) : "<span class='muted'>—</span>"}</td>
               <td style="text-align:right">${+l.quantity} ${esc(l.unit)}</td>
               <td style="text-align:right">${fmtINR(l.unit_price)}</td>
               <td style="text-align:right">${l.gst_rate}%</td>
               <td style="text-align:right">${fmtINR(l.line_total)}</td>
             </tr>`).join("")}</tbody>
           </table></div></details>`
      : `<p class="muted" style="font-size:0.78rem;margin-top:4px">No line items yet.</p>`;
    const linkedExp = p.expense_id ? db.expenses.find(e => e.id === p.expense_id) : null;
    const expBadge = p.status === "received"
      ? `<div style="margin-top:6px;padding:6px 12px;background:var(--bg-alt);border-radius:8px;font-size:0.82rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${FWIcon("receipt",{size:13})} <span>Expense posted${linkedExp ? `: ₹${fmtINR(linkedExp.amount)}` : ""} · ${fmtDate(p.received_date || p.order_date)}</span>
          <button class="link-btn" onclick="viewPoExpense('${p.expense_id || ""}')">View Expense →</button>
        </div>`
      : "";
    const actions = [];
    if (p.status === "draft")    actions.push(`<button class="link-btn" onclick="poSetStatus('${p.id}','approved')">Approve</button>`);
    if (p.status === "approved") actions.push(`<button class="link-btn" onclick="poSetStatus('${p.id}','ordered')">Mark Ordered</button>`);
    if (["approved","ordered","partial"].includes(p.status))
                                 actions.push(`<button class="link-btn" onclick="poMarkReceived('${p.id}')">Mark Received</button>`);
    if (!["received","cancelled"].includes(p.status))
                                 actions.push(`<button class="link-btn" onclick="openEditPO('${p.id}')">Edit</button>`);
    if (p.status === "received") actions.push(`<button class="link-btn" onclick="openEditPoNotes('${p.id}')">Edit Notes</button>`);
    if (!["received","cancelled"].includes(p.status))
                                 actions.push(`<button class="link-btn" style="color:#ef4444" onclick="poCancelConfirm('${p.id}')">Cancel</button>`);
    return `<div class="pred-row" id="po-${p.id}">
      <div class="pred-main">
        <span class="fw-chip is-pending"><span class="fw-badge ${vm.cls}" style="margin:0">${vm.label}</span></span>
        <strong>${esc(p.po_number)}</strong> — ${esc(p.vendor_name)}
        ${veh ? `<span class="muted"> · ${esc(veh)}</span>` : ""}
        <span class="muted" style="font-size:0.8rem"> · ${fmtDate(p.order_date)}</span>
      </div>
      ${linesHtml}
      ${expBadge}
      <div class="pred-detail" style="margin-top:6px">${actions.join(" ")}</div>
    </div>`;
  }

  box.innerHTML =
    (open.length  ? open.map(poCard).join("")  : "<p class='muted'>No open POs.</p>") +
    (closed.length
      ? `<details class="chart-table" style="margin-top:12px"><summary>Completed / Cancelled (${closed.length})</summary>
         ${closed.map(poCard).join("")}</details>`
      : "");
}

// ── Purchase Invoice list (FleetFin) ──────────────────────────────────────
function renderPurchaseInvoices() {
  const el = document.getElementById("purchaseInvoiceList");
  if (!el) return;
  if (!coreDbBacked()) {
    el.innerHTML = "<p class='muted'>Sign in to view purchase invoices.</p>";
    return;
  }
  const received = _pos.filter(p => p.status === "received");
  if (!received.length) {
    el.innerHTML = "<p class='muted' style='text-align:center;padding:32px'>No purchase invoices yet — they are created when you mark a PO received.</p>";
    return;
  }
  const PAY_META = {
    pending: { label: "Pending",  cls: "soon",    next: "paid",    nextLabel: "Mark Paid" },
    paid:    { label: "Paid",     cls: "ok",       next: "pending", nextLabel: "Reopen" },
    partial: { label: "Partial",  cls: "upcoming", next: "paid",    nextLabel: "Mark Paid" },
  };
  el.innerHTML = `<div style="overflow-x:auto"><table class="chart-table-el">
    <thead><tr>
      <th>PO #</th><th>Vendor</th><th>Vehicle</th><th>Bill No.</th>
      <th>Date</th><th>Amount</th><th>Payment</th><th>Comments</th><th></th>
    </tr></thead>
    <tbody>` +
    received.map(p => {
      const veh = p.vehicle_id ? (db.vehicles.find(v => v.dbId === p.vehicle_id)?.name || "—") : "—";
      const pm  = PAY_META[p.payment_status || "pending"] || PAY_META.pending;
      return `<tr>
        <td><button class="link-btn" onclick="viewExpensePO('${p.id}')">${esc(p.po_number)}</button></td>
        <td>${esc(p.vendor_name)}</td>
        <td>${esc(veh)}</td>
        <td>${p.vendor_bill_no ? esc(p.vendor_bill_no) : "<span class='muted'>—</span>"}</td>
        <td>${fmtDate(p.received_date || p.order_date)}</td>
        <td style="font-weight:600;text-align:right">₹${fmtINR(p.total_amount || 0)}</td>
        <td><span class="fw-badge ${pm.cls}">${pm.label}</span></td>
        <td style="max-width:180px;font-size:0.8rem">${p.po_comments ? esc(p.po_comments) : "<span class='muted'>—</span>"}</td>
        <td style="white-space:nowrap">
          <button class="link-btn" onclick="piSetPayment('${p.id}','${pm.next}')">${pm.nextLabel}</button>
          <button class="link-btn" onclick="piEditComments('${p.id}')">Edit</button>
          ${p.expense_id ? `<button class="link-btn" onclick="viewPoExpense('${p.expense_id}')">Expense →</button>` : ""}
        </td>
      </tr>`;
    }).join("") +
    "</tbody></table></div>" +
    `<div style="margin-top:12px;display:flex;gap:16px;font-size:0.82rem;flex-wrap:wrap">
      <span>${FWIcon("check",{size:13,cls:"ic-success"})} Paid: ₹${fmtINR(received.filter(p=>p.payment_status==="paid").reduce((a,p)=>a+(p.total_amount||0),0))}</span>
      <span style="color:var(--warn)">${FWIcon("alert",{size:13})} Pending: ₹${fmtINR(received.filter(p=>p.payment_status!=="paid").reduce((a,p)=>a+(p.total_amount||0),0))}</span>
    </div>`;
  if (window.FWIcons) FWIcons.hydrate(el);
}

window.piSetPayment = async function(poId, status) {
  const ok = await fwCloud.authPatch(`purchase_orders?id=eq.${poId}`, { payment_status: status });
  if (!ok) { toast("Could not update — try again.", "warn"); return; }
  const po = _pos.find(p => p.id === poId);
  if (po) po.payment_status = status;
  renderPurchaseInvoices();
  toast(`Payment status → ${status}.`);
};

window.piEditComments = function(poId) {
  const p = _pos.find(x => x.id === poId);
  if (!p) return;
  openEditModal(`Invoice — ${p.po_number}`, `
    <div class="form-row">
      <label>Vendor bill / invoice no.<input type="text" name="vendorBillNo" value="${escAttr(p.vendor_bill_no||"")}" placeholder="e.g. INV-2024-001" /></label>
      <label>Payment status
        <select name="paymentStatus">
          <option value="pending" ${(p.payment_status||"pending")==="pending"?"selected":""}>Pending</option>
          <option value="paid"    ${p.payment_status==="paid"?"selected":""}>Paid</option>
          <option value="partial" ${p.payment_status==="partial"?"selected":""}>Partial</option>
        </select>
      </label>
    </div>
    <label>Comments / Notes
      <textarea name="poComments" rows="3" style="width:100%">${esc(p.po_comments||"")}</textarea>
    </label>
  `, async fd => {
    const ok = await fwCloud.authPatch(`purchase_orders?id=eq.${poId}`, {
      vendor_bill_no: fd.vendorBillNo.trim() || null,
      payment_status: fd.paymentStatus || "pending",
      po_comments: fd.poComments.trim() || null,
    });
    if (!ok) throw new Error("Could not save — check your connection and try again.");
    // update local cache
    Object.assign(p, { vendor_bill_no: fd.vendorBillNo.trim() || null, payment_status: fd.paymentStatus, po_comments: fd.poComments.trim() || null });
    closeEditModal();
    toast("Invoice updated.");
    renderPurchaseInvoices(); renderPurchaseOrders();
  });
};
window.renderPurchaseInvoices = renderPurchaseInvoices;

// ── PO modal helpers ───────────────────────────────────────────────────────
function poLineRow(l) {
  const v = l || {};
  const qty   = parseFloat(v.quantity  || 1);
  const price = parseFloat(v.unit_price || 0);
  const gst   = parseFloat(v.gst_rate !== undefined ? v.gst_rate : 18);
  const lineTotal = qty * price * (1 + gst / 100);
  const totalDisp = price > 0 ? "₹" + fmtINR(Math.round(lineTotal * 100) / 100) : "—";
  return `<tr class="po-line-row">
    <td><input type="text" class="po-line-part" value="${escAttr(v.part_name||"")}" placeholder="Part name *" required style="width:100%;min-width:120px" /></td>
    <td><input type="text" class="po-line-partno" value="${escAttr(v.part_number||"")}" placeholder="Part no." style="width:90px" /></td>
    <td><input type="text" class="po-line-make" value="${escAttr(v.make||"")}" placeholder="Brand" style="width:80px" /></td>
    <td><input type="text" class="po-line-sn" value="${escAttr(v.serial_number||"")}" placeholder="S/N" style="width:90px" /></td>
    <td><input type="number" class="po-line-qty" value="${v.quantity||1}" min="0.001" step="any" style="width:60px" oninput="updatePoLineTotals(this)" /></td>
    <td><select class="po-line-unit" style="width:64px">
      ${["pcs","set","litre","kg","metre"].map(u => `<option${(v.unit||"pcs")===u?" selected":""}>${u}</option>`).join("")}
    </select></td>
    <td><input type="number" class="po-line-price" value="${v.unit_price||""}" min="0" step="any" placeholder="0.00" style="width:80px" oninput="updatePoLineTotals(this)" /></td>
    <td><input type="number" class="po-line-gst" value="${v.gst_rate??18}" min="0" max="100" step="any" style="width:56px" oninput="updatePoLineTotals(this)" /></td>
    <td class="po-line-total-cell" style="text-align:right;font-weight:600;font-size:0.82rem;white-space:nowrap">${totalDisp}</td>
    <td><button type="button" class="link-btn" style="color:#ef4444" onclick="this.closest('tr').remove();updatePoGrandTotal()">✕</button></td>
  </tr>`;
}

window.updatePoLineTotals = function(input) {
  const row = input.closest(".po-line-row");
  if (!row) return;
  const qty   = parseFloat(row.querySelector(".po-line-qty")?.value   || 0) || 0;
  const price = parseFloat(row.querySelector(".po-line-price")?.value  || 0) || 0;
  const gst   = parseFloat(row.querySelector(".po-line-gst")?.value   || 0) || 0;
  const lineTotal = qty * price * (1 + gst / 100);
  const cell = row.querySelector(".po-line-total-cell");
  if (cell) cell.textContent = price > 0 ? "₹" + fmtINR(Math.round(lineTotal * 100) / 100) : "—";
  updatePoGrandTotal();
};

window.updatePoGrandTotal = function() {
  let subtotal = 0, totalGst = 0;
  document.querySelectorAll("#poLineTbody .po-line-row").forEach(row => {
    const qty   = parseFloat(row.querySelector(".po-line-qty")?.value   || 0) || 0;
    const price = parseFloat(row.querySelector(".po-line-price")?.value  || 0) || 0;
    const gst   = parseFloat(row.querySelector(".po-line-gst")?.value   || 0) || 0;
    const base  = qty * price;
    subtotal += base;
    totalGst += base * gst / 100;
  });
  const total = subtotal + totalGst;
  const footer = document.getElementById("poTotalsFooter");
  if (footer) footer.innerHTML =
    `<tr style="font-size:0.8rem;color:var(--text-muted)"><td colspan="7" style="text-align:right;padding-top:6px">Subtotal (excl. GST)</td><td style="text-align:right">₹${fmtINR(Math.round(subtotal*100)/100)}</td><td colspan="2"></td></tr>` +
    `<tr style="font-size:0.8rem;color:var(--text-muted)"><td colspan="7" style="text-align:right">Total GST</td><td style="text-align:right">₹${fmtINR(Math.round(totalGst*100)/100)}</td><td colspan="2"></td></tr>` +
    `<tr style="font-weight:700;border-top:2px solid var(--border)"><td colspan="7" style="text-align:right;padding-top:4px">Grand Total</td><td style="text-align:right">₹${fmtINR(Math.round(total*100)/100)}</td><td colspan="2"></td></tr>`;
};

function openNewPO() {
  openEditModal("New Purchase Order", `
    <div class="form-row">
      <label>Vehicle<select name="vehicleId">${vehicleOptionsHtml("")}</select></label>
      <label>Order Date<input type="date" name="orderDate" value="${today()}" required /></label>
    </div>
    <div class="form-row">
      <label>Vendor name<input type="text" name="vendorName" required placeholder="e.g. Bosch Parts Dealer" /></label>
      <label>Vendor contact<input type="text" name="vendorContact" placeholder="Phone / email" /></label>
    </div>
    <div class="form-row">
      <label>Vendor GSTIN<input type="text" name="vendorGstin" maxlength="15" placeholder="15-char GST number" /></label>
      <label>Expected delivery<input type="date" name="expectedDelivery" /></label>
    </div>
    <label>Notes<textarea name="notes" rows="2" style="width:100%"></textarea></label>
    <h3 style="margin:12px 0 6px">Line Items</h3>
    <div style="overflow-x:auto">
    <table class="chart-table-el" id="poLineTable" style="width:100%;font-size:0.82rem">
      <thead><tr><th>Part *</th><th>Part No.</th><th>Make</th><th>S/N</th><th>Qty</th><th>Unit</th><th>Unit ₹ *</th><th>GST %</th><th>Line ₹</th><th></th></tr></thead>
      <tbody id="poLineTbody">${poLineRow(null)}</tbody>
      <tfoot id="poTotalsFooter"></tfoot>
    </table></div>
    <button type="button" class="link-btn" onclick="document.getElementById('poLineTbody').insertAdjacentHTML('beforeend', poLineRow(null));updatePoGrandTotal()" style="margin-top:6px">${FWIcon("plus",{size:13})} Add line</button>
  `, async fd => {
    const lines = collectPoLines();
    if (!lines) throw new Error("Fix the line items first (part name and unit price required for each row).");
    const orgId = await dbOrgId();
    if (!orgId) throw new Error("Could not determine your organisation — check your session.");
    const vehRow = fd.vehicleId ? db.vehicles.find(v => v.id === fd.vehicleId) : null;
    const totals = calcPoTotals(lines);
    const po = await fwCloud.authInsertRet("purchase_orders", {
      org_id: orgId,
      vehicle_id: vehRow?.dbId || null,
      vendor_name: fd.vendorName.trim(),
      vendor_gstin: fd.vendorGstin.trim() || null,
      vendor_contact: fd.vendorContact.trim() || null,
      order_date: fd.orderDate,
      expected_delivery: fd.expectedDelivery || null,
      notes: fd.notes.trim() || null,
      subtotal: totals.subtotal,
      total_gst: totals.gst,
      total_amount: totals.total,
      created_by: fwCloud.uid(),
    });
    if (!po) throw new Error("Could not save — check your connection and try again.");
    for (const l of lines) {
      await fwCloud.authInsert("purchase_order_lines", { ...l, po_id: po.id, org_id: orgId });
    }
    closeEditModal();
    toast(`PO ${po.po_number} created.`);
    await loadPOs(); renderPurchaseOrders();
  });
  updatePoGrandTotal();
}

function openEditPO(id) {
  const p = _pos.find(x => x.id === id);
  if (!p) return;
  const lines = _poLines[id] || [];
  const vehLocalId = p.vehicle_id
    ? (db.vehicles.find(v => v.dbId === p.vehicle_id)?.id || "")
    : "";
  openEditModal("Edit Purchase Order", `
    <div class="form-row">
      <label>Vehicle<select name="vehicleId">${vehicleOptionsHtml(vehLocalId)}</select></label>
      <label>Order Date<input type="date" name="orderDate" value="${p.order_date}" required /></label>
    </div>
    <div class="form-row">
      <label>Vendor name<input type="text" name="vendorName" value="${escAttr(p.vendor_name)}" required /></label>
      <label>Vendor contact<input type="text" name="vendorContact" value="${escAttr(p.vendor_contact||"")}" /></label>
    </div>
    <div class="form-row">
      <label>Vendor GSTIN<input type="text" name="vendorGstin" value="${escAttr(p.vendor_gstin||"")}" maxlength="15" /></label>
      <label>Expected delivery<input type="date" name="expectedDelivery" value="${p.expected_delivery||""}" /></label>
    </div>
    <label>Notes<textarea name="notes" rows="2" style="width:100%">${esc(p.notes||"")}</textarea></label>
    <h3 style="margin:12px 0 6px">Line Items</h3>
    <div style="overflow-x:auto">
    <table class="chart-table-el" style="width:100%;font-size:0.82rem">
      <thead><tr><th>Part *</th><th>Part No.</th><th>Make</th><th>S/N</th><th>Qty</th><th>Unit</th><th>Unit ₹ *</th><th>GST %</th><th>Line ₹</th><th></th></tr></thead>
      <tbody id="poLineTbody">${lines.map(poLineRow).join("") || poLineRow(null)}</tbody>
      <tfoot id="poTotalsFooter"></tfoot>
    </table></div>
    <button type="button" class="link-btn" onclick="document.getElementById('poLineTbody').insertAdjacentHTML('beforeend', poLineRow(null));updatePoGrandTotal()" style="margin-top:6px">${FWIcon("plus",{size:13})} Add line</button>
  `, async fd => {
    const lines2 = collectPoLines();
    if (!lines2) throw new Error("Fix the line items first.");
    const vehRow = fd.vehicleId ? db.vehicles.find(v => v.id === fd.vehicleId) : null;
    const totals = calcPoTotals(lines2);
    const ok = await fwCloud.authPatch(`purchase_orders?id=eq.${id}`, {
      vehicle_id: vehRow?.dbId || null,
      vendor_name: fd.vendorName.trim(),
      vendor_gstin: fd.vendorGstin.trim() || null,
      vendor_contact: fd.vendorContact.trim() || null,
      order_date: fd.orderDate,
      expected_delivery: fd.expectedDelivery || null,
      notes: fd.notes.trim() || null,
      subtotal: totals.subtotal,
      total_gst: totals.gst,
      total_amount: totals.total,
    });
    if (!ok) throw new Error("Could not save — check your connection and try again.");
    // replace lines: delete old, insert new
    const orgId = await dbOrgId();
    await fwCloud.authDelete("purchase_order_lines", `po_id=eq.${id}`);
    for (const l of lines2) {
      await fwCloud.authInsert("purchase_order_lines", { ...l, po_id: id, org_id: orgId });
    }
    closeEditModal();
    toast("Purchase order updated.");
    await loadPOs(); renderPurchaseOrders();
  });
  updatePoGrandTotal();
}

function openEditPoNotes(id) {
  const p = _pos.find(x => x.id === id);
  if (!p) return;
  openEditModal(`PO ${p.po_number} — Edit Notes`, `
    <p class="muted" style="margin-bottom:12px;padding:8px 12px;background:var(--bg-alt);border-radius:8px">
      This PO has been received — only notes and expected delivery can be updated (the financials are fixed).</p>
    <label>Notes<textarea name="notes" rows="3" style="width:100%">${esc(p.notes||"")}</textarea></label>
    <label style="margin-top:10px;display:block">Expected delivery<input type="date" name="expectedDelivery" value="${p.expected_delivery||""}" /></label>
  `, async fd => {
    const ok = await fwCloud.authPatch(`purchase_orders?id=eq.${id}`, {
      notes: fd.notes.trim() || null,
      expected_delivery: fd.expectedDelivery || null,
    });
    if (!ok) throw new Error("Could not save — check your connection and try again.");
    closeEditModal();
    toast("PO notes updated.");
    await loadPOs(); renderPurchaseOrders();
  });
}
window.openEditPoNotes = openEditPoNotes;

function collectPoLines() {
  const rows = document.querySelectorAll("#poLineTbody .po-line-row");
  const out = [];
  for (const row of rows) {
    const partName = (row.querySelector(".po-line-part")?.value || "").trim();
    const price    = parseFloat(row.querySelector(".po-line-price")?.value || "0");
    if (!partName) return null;
    if (isNaN(price) || price < 0) return null;
    out.push({
      part_name:     partName,
      part_number:   (row.querySelector(".po-line-partno")?.value || "").trim() || null,
      make:          (row.querySelector(".po-line-make")?.value   || "").trim() || null,
      serial_number: (row.querySelector(".po-line-sn")?.value     || "").trim() || null,
      quantity:      parseFloat(row.querySelector(".po-line-qty")?.value  || "1") || 1,
      unit:          row.querySelector(".po-line-unit")?.value || "pcs",
      unit_price:    price,
      gst_rate:      parseFloat(row.querySelector(".po-line-gst")?.value  || "18") || 0,
    });
  }
  return out.length ? out : null;
}

function calcPoTotals(lines) {
  let subtotal = 0, gst = 0;
  for (const l of lines) {
    const base = l.quantity * l.unit_price;
    const g    = Math.round(base * l.gst_rate) / 100;
    subtotal  += base;
    gst       += g;
  }
  return { subtotal: Math.round(subtotal * 100) / 100, gst: Math.round(gst * 100) / 100, total: Math.round((subtotal + gst) * 100) / 100 };
}

async function poSetStatus(id, status) {
  const ok = await fwCloud.authPatch(`purchase_orders?id=eq.${id}`, { status });
  if (!ok) { toast("Could not update — try again.", "warn"); return; }
  toast(`PO marked ${status}.`);
  await loadPOs(); renderPurchaseOrders();
}

async function poMarkReceived(id) {
  const p = _pos.find(x => x.id === id);
  if (!p) return;
  const lines = _poLines[id] || [];
  const vehLocalId = p.vehicle_id
    ? (db.vehicles.find(v => v.dbId === p.vehicle_id)?.id || "")
    : "";

  // Collect receipt + payment details before posting
  openEditModal(`Receive PO ${p.po_number}`, `
    <div style="padding:10px 14px;background:var(--bg-alt);border-radius:10px;margin-bottom:14px;font-size:0.85rem">
      <strong>${esc(p.vendor_name)}</strong> &nbsp;·&nbsp; ₹${fmtINR(p.total_amount || 0)} total
      ${vehLocalId ? `&nbsp;·&nbsp; ${esc(db.vehicles.find(v => v.id === vehLocalId)?.name || "")}` : ""}
    </div>
    <div class="form-row">
      <label>Received date<input type="date" name="receivedDate" value="${today()}" required /></label>
      <label>Vendor bill / invoice no.<input type="text" name="vendorBillNo" value="${escAttr(p.vendor_bill_no||p.po_number||"")}" placeholder="e.g. INV-2024-001" /></label>
    </div>
    <div class="form-row">
      <label style="flex:1">Payment status
        <select name="paymentStatus">
          <option value="pending" ${(p.payment_status||"pending")==="pending"?"selected":""}>Pending — will pay later</option>
          <option value="paid"    ${p.payment_status==="paid"?"selected":""}>Paid — already settled</option>
          <option value="partial" ${p.payment_status==="partial"?"selected":""}>Partial — part paid</option>
        </select>
      </label>
    </div>
    <label>Comments / Notes (internal)
      <textarea name="poComments" rows="2" placeholder="e.g. Delivery complete, 2 items backordered" style="width:100%">${esc(p.po_comments||"")}</textarea>
    </label>
    <p class="muted" style="font-size:0.78rem;margin-top:10px">
      ${FWIcon("receipt",{size:13})} This will post an expense to Expense History and create a purchase invoice in FleetFin.
    </p>
  `, async fd => {
    const expenseData = {
      vehicleId: vehLocalId || null,
      date: fd.receivedDate || today(),
      category: "Spare Parts",
      amount: p.total_amount || 0,
      title: `PO ${p.po_number} — ${p.vendor_name}`,
      vendor: p.vendor_name,
      gstin: p.vendor_gstin || undefined,
      billNo: fd.vendorBillNo.trim() || p.po_number,
      items: lines.map(l => ({
        description: [l.part_name, l.part_number, l.make].filter(Boolean).join(" / "),
        partNumber: l.part_number || undefined,
        serialNumber: l.serial_number || undefined,
        make: l.make || undefined,
        qty: l.quantity,
        unit: l.unit,
        unitPrice: l.unit_price,
        gstRate: l.gst_rate,
        gstAmount: Math.round(l.quantity * l.unit_price * l.gst_rate) / 100,
        amount: Math.round(l.quantity * l.unit_price * (1 + l.gst_rate / 100) * 100) / 100,
      })),
    };
    const saved = coreDbBacked() ? await dbCreateExpense(expenseData) : null;
    if (coreDbBacked() && !saved) throw new Error("Could not post expense — check your connection.");
    if (saved) db.expenses.push(saved);

    const patch = {
      status: "received",
      received_date: fd.receivedDate || today(),
      payment_status: fd.paymentStatus || "pending",
      vendor_bill_no: fd.vendorBillNo.trim() || null,
      po_comments: fd.poComments.trim() || null,
    };
    if (saved) patch.expense_id = saved.id;
    await fwCloud.authPatch(`purchase_orders?id=eq.${id}`, patch);

    closeEditModal();
    toast(`PO ${p.po_number} received — expense + purchase invoice created.`);
    await loadPOs(); renderPurchaseOrders();
    renderExpenseHistory(); renderOverview();
    if (window.renderPurchaseInvoices) renderPurchaseInvoices();
  });
}

async function poCancelConfirm(id) {
  const p = _pos.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Cancel PO ${p.po_number}?`)) return;
  await poSetStatus(id, "cancelled");
}

// Cross-navigation: PO ↔ Expense
window.viewPoExpense = function(expenseId) {
  if (!expenseId) return;
  document.querySelector('#tabBar .tab-btn[data-tab="expensehistory"]')?.click();
  setTimeout(() => {
    const row = document.querySelector(`[data-expense-id="${expenseId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.style.outline = "2px solid var(--brand)";
      row.style.borderRadius = "6px";
      setTimeout(() => { row.style.outline = ""; row.style.borderRadius = ""; }, 2200);
    }
  }, 250);
};

window.viewExpensePO = function(poId) {
  document.querySelector('#tabBar .tab-btn[data-tab="purchaseorders"]')?.click();
  setTimeout(() => {
    const row = document.getElementById(`po-${poId}`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.style.outline = "2px solid var(--brand)";
      row.style.borderRadius = "6px";
      setTimeout(() => { row.style.outline = ""; row.style.borderRadius = ""; }, 2200);
    }
  }, 250);
};

// Expose globals needed for inline onclick= attributes
window.openNewPO    = openNewPO;
window.openEditPO   = openEditPO;
window.poSetStatus  = poSetStatus;
window.poMarkReceived = poMarkReceived;
window.poCancelConfirm = poCancelConfirm;
window.poLineRow    = poLineRow;

// ════════════════════════════════════════════════════════════════════════════
// DAILY DISPATCH
// ════════════════════════════════════════════════════════════════════════════

// ── dispatch state ─────────────────────────────────────────────────────────
let _dispatch = [];   // rows for the selected date

const DISPATCH_STATUS = {
  planned:     { label: "Planned",     cls: "upcoming", icon: "clock",       next: ["running","halt","maintenance","cancelled"] },
  running:     { label: "Running",     cls: "ok",       icon: "trendUp",     next: ["halt","maintenance","completed"] },
  halt:        { label: "Halt",        cls: "soon",     icon: "pause",       next: ["running","maintenance","completed","cancelled"] },
  maintenance: { label: "Maintenance", cls: "overdue",  icon: "wrench",      next: ["halt","running","completed","cancelled"] },
  completed:   { label: "Completed",   cls: "ok",       icon: "checkCircle", next: [] },
  cancelled:   { label: "Cancelled",   cls: "overdue",  icon: "close",       next: ["planned"] },
};

const TASK_TYPES = ["trip","loading","unloading","standby","service","idle","other"];

// ── load dispatch for date ─────────────────────────────────────────────────
window.loadDispatch = async function() {
  const dateEl = document.getElementById("dispatchDate");
  const date   = dateEl ? dateEl.value : today();
  if (!coreDbBacked()) { _dispatch = []; renderDispatch(); return; }
  _dispatch = await fwCloud.authGet("daily_dispatch",
    `select=*&dispatch_date=eq.${date}&order=created_at.asc`) || [];
  renderDispatch();
};

// ── render dispatch board ─────────────────────────────────────────────────
function renderDispatch() {
  const sumEl  = document.getElementById("dispatchSummary");
  const board  = document.getElementById("dispatchBoard");
  if (!board) return;

  const dateEl = document.getElementById("dispatchDate");
  const date   = dateEl ? dateEl.value : today();

  if (!coreDbBacked()) {
    board.innerHTML = "<p class='muted'>Sign in to use the Daily Dispatch board.</p>"; return;
  }

  // Build a map: vehicleId → dispatch row (null if not yet planned)
  const byVeh = Object.fromEntries(_dispatch.map(r => [r.vehicle_id, r]));

  // Filter by active dashboard filter (site / supervisor)
  const vehs = filteredVehicles ? filteredVehicles() : db.vehicles;

  // Summary counts
  const counts = { planned:0, running:0, halt:0, maintenance:0, completed:0, cancelled:0, notset:0 };
  vehs.forEach(v => {
    const r = byVeh[v.dbId];
    if (r) counts[r.status] = (counts[r.status]||0)+1;
    else counts.notset++;
  });

  if (sumEl) {
    sumEl.innerHTML = Object.entries(counts).filter(([,n]) => n > 0).map(([k, n]) => {
      const m = DISPATCH_STATUS[k] || { label: "Not Set", cls: "upcoming", icon: "truck" };
      return `<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid var(--border);font-size:0.82rem">
        <span class="fw-badge ${m.cls}" style="font-size:0.68rem;margin:0">${m.label}</span>
        <strong>${n}</strong>
      </div>`;
    }).join("") + (vehs.length === 0 ? "<p class='muted' style='padding:4px'>No vehicles — add vehicles first.</p>" : "");
  }

  if (!vehs.length) { board.innerHTML = ""; return; }

  // Build table rows
  const rows = vehs.map(v => {
    const r      = byVeh[v.dbId];
    const driver = r?.driver_name || (db.drivers.find(d => d.vehicleId === v.id)?.name) || "—";
    const sm     = r ? (DISPATCH_STATUS[r.status] || DISPATCH_STATUS.planned) : null;
    const site   = _vehSiteMap[v.dbId]?.site;

    // Status badge + quick-action buttons
    const stBadge = sm
      ? `<span class="fw-badge ${sm.cls}" style="font-size:0.72rem">${FWIcon(sm.icon,{size:12})} ${sm.label}</span>`
      : `<span class="fw-badge upcoming" style="font-size:0.72rem">Not set</span>`;

    const quickBtns = r
      ? (DISPATCH_STATUS[r.status]?.next || []).map(ns => {
          const nm = DISPATCH_STATUS[ns];
          return `<button class="link-btn" style="font-size:0.72rem;padding:3px 8px;border:1px solid var(--border);border-radius:6px"
            onclick="dispatchUpdateStatus('${r.id}','${ns}')">${FWIcon(nm.icon,{size:12})} ${nm.label}</button>`;
        }).join("")
      : `<button class="link-btn" style="font-size:0.72rem;padding:3px 8px;border:1px solid var(--border);border-radius:6px"
           onclick="openDispatchRow('${v.id}','${v.dbId}')">+ Plan</button>`;

    const timeSince = r?.status_updated_at
      ? `<span class="muted" style="font-size:0.72rem">${timeSinceStr(r.status_updated_at)}</span>` : "";

    const taskText = r?.task_description
      ? `<span style="font-size:0.76rem">${esc(r.destination||"")}${r.destination&&r.task_description?" · ":""} ${esc(r.task_description)}</span>` : "";

    return `<tr id="dd-${v.id}">
      <td>
        <strong>${esc(v.name)}</strong><br/>
        <span class="muted" style="font-size:0.75rem">${esc(v.type)}${site?" · "+esc(site.name):""}</span>
      </td>
      <td>
        <span style="font-size:0.85rem">${esc(driver)}</span>
        <button class="link-btn" style="font-size:0.72rem;margin-left:4px" onclick="openDispatchRow('${v.id}','${v.dbId}')" title="Edit dispatch">${FWIcon("document",{size:12})}</button>
      </td>
      <td>${stBadge} ${timeSince}</td>
      <td>${taskText}</td>
      <td style="white-space:nowrap">${quickBtns}</td>
    </tr>`;
  }).join("");

  board.innerHTML = `<div style="overflow-x:auto"><table class="chart-table-el" style="width:100%">
    <thead><tr>
      <th>Vehicle</th><th>Driver</th><th>Status</th><th>Task / Destination</th><th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  if (window.FWIcons) FWIcons.hydrate(board);
}

function timeSinceStr(ts) {
  if (!ts) return "";
  const mins = Math.round((Date.now() - new Date(ts)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}

// ── open dispatch row editor ───────────────────────────────────────────────
window.openDispatchRow = async function(vehLocalId, vehDbId) {
  const v    = db.vehicles.find(x => x.id === vehLocalId); if (!v) return;
  const dateEl = document.getElementById("dispatchDate");
  const date   = dateEl ? dateEl.value : today();
  const existing = _dispatch.find(r => r.vehicle_id === vehDbId);
  const defDriver = db.drivers.find(d => d.vehicleId === vehLocalId);
  const site      = _vehSiteMap[vehDbId]?.site;

  const driverOpts = db.drivers.map(d =>
    `<option value="${d.id}|${escAttr(d.name)}"${existing?.driver_ext_id===d.id||(!existing&&d.vehicleId===vehLocalId)?" selected":""}>${esc(d.name)}</option>`).join("");

  const statusOpts = Object.entries(DISPATCH_STATUS)
    .filter(([k]) => !["completed","cancelled"].includes(k))
    .map(([k,m]) => `<option value="${k}"${(existing?.status||"planned")===k?" selected":""}>${m.label}</option>`).join("");

  const taskOpts = TASK_TYPES.map(t => `<option${(existing?.task_type||"trip")===t?" selected":""}>${t}</option>`).join("");

  openEditModal(`Dispatch — ${v.name} · ${fmtDate(date)}`, `
    <div class="form-row">
      <label>Driver for today
        <select name="driverPick">
          <option value="">— Type name below —</option>${driverOpts}
        </select>
      </label>
      <label>Or enter name<input type="text" name="driverName" value="${escAttr(existing?.driver_name||defDriver?.name||"")}" placeholder="Driver name" /></label>
    </div>
    <div class="form-row">
      <label>Movement status<select name="status">${statusOpts}</select></label>
      <label>Task type<select name="taskType">${taskOpts}</select></label>
    </div>
    <div class="form-row">
      <label>Destination<input type="text" name="destination" value="${escAttr(existing?.destination||"")}" placeholder="e.g. Madurai, TN" /></label>
      <label>Load details<input type="text" name="loadDetail" value="${escAttr(existing?.load_detail||"")}" placeholder="e.g. 20 MT sand" /></label>
    </div>
    <div class="form-row">
      <label>Task description<input type="text" name="taskDesc" value="${escAttr(existing?.task_description||"")}" placeholder="Brief task note" /></label>
      <label>Planned start<input type="time" name="plannedStart" value="${existing?.planned_start||""}" /></label>
    </div>
    <label>Notes<textarea name="notes" rows="2" style="width:100%">${esc(existing?.notes||"")}</textarea></label>
  `, async fd => {
    const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
    // resolve driver
    let driverExtId = null, driverName = (fd.driverName||"").trim();
    if (fd.driverPick && fd.driverPick !== "") {
      const [dId, dName] = fd.driverPick.split("|");
      driverExtId = dId;
      if (!driverName) driverName = dName;
    }
    const row = {
      org_id: orgId, vehicle_id: vehDbId, dispatch_date: date,
      site_id: site?.id || null,
      driver_ext_id: driverExtId||null, driver_name: driverName||null,
      status: fd.status || "planned",
      task_type: fd.taskType || "trip",
      task_description: (fd.taskDesc||"").trim()||null,
      destination: (fd.destination||"").trim()||null,
      load_detail: (fd.loadDetail||"").trim()||null,
      planned_start: fd.plannedStart||null,
      notes: (fd.notes||"").trim()||null,
    };
    let ok;
    if (existing) {
      ok = await fwCloud.authPatch(`daily_dispatch?id=eq.${existing.id}`, row);
    } else {
      ok = await fwCloud.authInsert("daily_dispatch", { ...row, created_by: fwCloud.uid() });
    }
    if (!ok) throw new Error("Could not save — check your connection.");
    toast(`${v.name} dispatch saved.`);
    closeEditModal();
    await loadDispatch();
  });
};

// ── quick status update ────────────────────────────────────────────────────
window.dispatchUpdateStatus = async function(dispId, newStatus) {
  const ok = await fwCloud.authPatch(`daily_dispatch?id=eq.${dispId}`, {
    status: newStatus,
    actual_start: newStatus === "running" ? new Date().toTimeString().slice(0,5) : undefined,
    completed_at: newStatus === "completed" ? new Date().toTimeString().slice(0,5) : undefined,
  });
  if (!ok) { toast("Could not update — try again.", "warn"); return; }
  const row = _dispatch.find(r => r.id === dispId);
  if (row) {
    row.status = newStatus;
    row.status_updated_at = new Date().toISOString();
  }
  const st = DISPATCH_STATUS[newStatus];
  toast(`Status → ${st?.label || newStatus}.`);

  // SMS on halt or maintenance — notify owner
  if (newStatus === "halt" || newStatus === "maintenance") {
    const veh = row ? db.vehicles.find(v => v.dbId === row.vehicle_id) : null;
    const ownerPhone = db.settings?.ownerPhone || db.settings?.contactPhone || "";
    if (ownerPhone && veh) {
      const supName = row.supervisor_name || "Supervisor";
      sendSms("halt", [{ mobile: ownerPhone, var1: veh.name, var2: supName, var3: st?.label || newStatus }]);
    }
  }

  renderDispatch();
};

// ── plan all un-planned vehicles for today ─────────────────────────────────
window.dispatchPlanAll = async function() {
  const dateEl = document.getElementById("dispatchDate");
  const date   = dateEl ? dateEl.value : today();
  const orgId  = await dbOrgId(); if (!orgId) return;
  const already= new Set(_dispatch.map(r => r.vehicle_id));
  let added = 0;
  for (const v of db.vehicles) {
    if (!v.dbId || already.has(v.dbId)) continue;
    const driver = db.drivers.find(d => d.vehicleId === v.id);
    const site   = _vehSiteMap[v.dbId]?.site;
    await fwCloud.authInsert("daily_dispatch", {
      org_id: orgId, vehicle_id: v.dbId, dispatch_date: date,
      site_id: site?.id||null,
      driver_ext_id: driver?.id||null, driver_name: driver?.name||null,
      status: "planned", task_type: "trip", created_by: fwCloud.uid(),
    });
    added++;
  }
  toast(added ? `${added} vehicle${added>1?"s":""} added to today's plan.` : "All vehicles already planned.");
  await loadDispatch();
};

// ════════════════════════════════════════════════════════════════════════════
// SITES & PROJECTS
// ════════════════════════════════════════════════════════════════════════════

// ── in-memory state ────────────────────────────────────────────────────────
let _sites    = [];   // site rows from DB
let _siteVeh  = {};   // { siteId: [site_vehicle_assignments rows] }
let _siteStaff = {};  // { siteId: [site_staff_assignments rows] }
// reverse map: vehicleDbId → { site, sva row }
let _vehSiteMap  = {};
// vehicle manual status overrides: vehicleId → 'moving'|'halted'|null
const _vstatus = {};

// ── global dashboard filter ────────────────────────────────────────────────
let _dashFilter = { by: "all", value: "", label: "" };

window.setDashFilter = function(by, value) {
  if (by === "all") {
    _dashFilter = { by: "all", value: "", label: "" };
  } else {
    if (!value) { _dashFilter = { by: "all", value: "", label: "" }; by = "all"; }
    else {
      const labels = { site: "Site", supervisor: "Supervisor", driver: "Driver" };
      _dashFilter = { by, value, label: labels[by] + ": " + value };
    }
  }
  syncFilterBarUI();
  renderVehicleStatusBoard();
  renderDashboard();
};

function syncFilterBarUI() {
  const { by, value, label } = _dashFilter;
  // "All" button
  ["fltAll","fltAllFin"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("is-active", by === "all");
  });
  // reset all selects to blank when filter is "all"
  if (by === "all") {
    ["fltSite","fltSiteFin","fltSupervisor","fltDriver","fltDriverFin"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
  }
  // labels
  ["fltLabel","fltLabelFin"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = label;
  });
}

function filteredVehicles() {
  const { by, value } = _dashFilter;
  if (by === "all" || !value) return db.vehicles;
  if (by === "site") {
    const svaRows = _siteVeh[value] || [];
    const vDbIds  = new Set(svaRows.filter(r => !r.removed_date).map(r => r.vehicle_id));
    return db.vehicles.filter(v => vDbIds.has(v.dbId));
  }
  if (by === "supervisor") {
    const siteIds = _sites.filter(s => s.supervisor_name === value || s.supervisor_user_id === value).map(s => s.id);
    const vDbIds  = new Set();
    siteIds.forEach(sid => (_siteVeh[sid] || []).filter(r => !r.removed_date).forEach(r => vDbIds.add(r.vehicle_id)));
    return db.vehicles.filter(v => vDbIds.has(v.dbId));
  }
  if (by === "driver") {
    const d = db.drivers.find(d => d.id === value || d.name === value);
    return d && d.vehicleId ? db.vehicles.filter(v => v.id === d.vehicleId) : [];
  }
  return db.vehicles;
}

// ── data load ──────────────────────────────────────────────────────────────
async function loadSites() {
  if (!coreDbBacked()) { _sites = []; _siteVeh = {}; _siteStaff = {}; _vehSiteMap = {}; return; }
  _sites = await fwCloud.authGet("sites", "select=*&status=neq.cancelled&order=created_at.desc") || [];
  if (!_sites.length) { _siteVeh = {}; _siteStaff = {}; _vehSiteMap = {}; return; }
  const ids = _sites.map(s => s.id);
  const vaRows = await fwCloud.authGet("site_vehicle_assignments",
    `select=*&site_id=in.(${ids.join(",")})&order=assigned_date.desc`) || [];
  const ssRows = await fwCloud.authGet("site_staff_assignments",
    `select=*&site_id=in.(${ids.join(",")})&left_date=is.null&order=joined_date.desc`) || [];
  _siteVeh   = {};
  _siteStaff = {};
  _vehSiteMap = {};
  vaRows.forEach(r => {
    (_siteVeh[r.site_id] = _siteVeh[r.site_id] || []).push(r);
    if (!r.removed_date) _vehSiteMap[r.vehicle_id] = { site: _sites.find(s => s.id === r.site_id), sva: r };
  });
  ssRows.forEach(r => { (_siteStaff[r.site_id] = _siteStaff[r.site_id] || []).push(r); });
  populateFilterDropdowns();
}

function populateFilterDropdowns() {
  const siteOpts = _sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  ["fltSite","fltSiteFin"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">— Site / Project —</option>${siteOpts}`;
    el.value = cur;
  });

  const sups = [...new Set(_sites.filter(s => s.supervisor_name).map(s => s.supervisor_name))];
  const supOpts = sups.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  const supEl = document.getElementById("fltSupervisor");
  if (supEl) supEl.innerHTML = `<option value="">— Supervisor —</option>${supOpts}`;

  const drvOpts = db.drivers.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  ["fltDriver","fltDriverFin"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<option value="">— Driver —</option>${drvOpts}`;
  });
}

// ── vehicle status helpers ─────────────────────────────────────────────────
const OP_STATUS = {
  moving:    { label: "Moving",    cls: "ok",       icon: "trendUp" },
  halted:    { label: "Halted",    cls: "soon",     icon: "pause" },
  repair:    { label: "In Repair", cls: "overdue",  icon: "wrench" },
  planned:   { label: "Planned",   cls: "upcoming", icon: "calendar" },
  no_driver: { label: "No Driver", cls: "soon",     icon: "driver" },
  active:    { label: "Active",    cls: "ok",       icon: "check" },
};

function vehicleOpStatus(v) {
  if (_vstatus[v.id]) return _vstatus[v.id];
  if (db.workOrders.some(w => w.status !== "Completed" && w.vehicleId === v.id)) return "repair";
  if (db.reminders.some(r => r.dueDate === today() && (r.vehicleId === v.id || !r.vehicleId))) return "planned";
  if (!db.drivers.find(d => d.vehicleId === v.id)) return "no_driver";
  return "active";
}

function vehiclePendency(v) {
  const now = Date.now();
  const ages = [
    ...db.issues.filter(i => i.status !== "Resolved" && i.vehicleId === v.id && i.createdAt)
      .map(i => Math.round((now - new Date(i.createdAt)) / 86400000)),
    ...db.workOrders.filter(w => w.status !== "Completed" && w.vehicleId === v.id && w.createdAt)
      .map(w => Math.round((now - new Date(w.createdAt)) / 86400000)),
  ];
  return ages.length ? Math.max(...ages) : 0;
}

// ── Vehicle Status Board ───────────────────────────────────────────────────
function renderVehicleStatusBoard() {
  const el = document.getElementById("vehicleStatusBoard");
  if (!el) return;
  const vehs = filteredVehicles();
  if (!vehs.length) { el.innerHTML = ""; return; }

  // Build summary counts
  const counts = { moving: 0, halted: 0, repair: 0, planned: 0, no_driver: 0, active: 0 };
  vehs.forEach(v => counts[vehicleOpStatus(v)]++);

  const summaryTiles = Object.entries(counts).map(([k, n]) => {
    if (!n && k !== "active") return "";
    const m = OP_STATUS[k];
    return `<div class="vsb-tile" onclick="setVsbStatusFilter('${k}')" title="Click to filter">
      <span class="fw-badge ${m.cls}" style="font-size:0.7rem">${FWIcon(m.icon,{size:12})} ${m.label}</span>
      <span class="vsb-count">${n}</span>
    </div>`;
  }).filter(Boolean).join("");

  // Build rows
  const rows = vehs.map(v => {
    const driver   = db.drivers.find(d => d.vehicleId === v.id);
    const siteInfo = _vehSiteMap[v.dbId];
    const site     = siteInfo?.site;
    const opSt     = vehicleOpStatus(v);
    const stMeta   = OP_STATUS[opSt] || OP_STATUS.active;
    const pendAge  = vehiclePendency(v);

    // staff at this site
    const siteStaff = site ? (_siteStaff[site.id] || []) : [];
    const siteSup   = site ? (site.supervisor_name || "—") : "—";

    const pendCell = pendAge > 0
      ? `<span class="fw-badge ${pendAge > 14 ? "overdue" : pendAge > 7 ? "soon" : "upcoming"}">${pendAge}d</span>`
      : `<span class="muted">—</span>`;

    // manual status toggle buttons
    const isMov = _vstatus[v.id] === "moving";
    const isHalt= _vstatus[v.id] === "halted";
    return `<tr>
      <td><strong>${esc(v.name)}</strong><br/><span class="muted" style="font-size:0.75rem">${esc(v.type)}</span></td>
      <td>${site ? `<strong>${esc(site.name)}</strong><br/><span class="muted" style="font-size:0.73rem">${esc(SITE_TYPE_LABELS[site.project_type]||site.project_type)}</span>` : `<span class="muted">—</span>`}</td>
      <td>${site?.manager_name ? esc(site.manager_name) : `<span class="muted">—</span>`}</td>
      <td>${siteSup !== "—" ? esc(siteSup) : `<span class="muted">—</span>`}</td>
      <td>${driver ? esc(driver.name) : `<span class="fw-badge soon" style="font-size:0.7rem">No Driver</span>`}</td>
      <td><span class="fw-badge ${stMeta.cls}" style="font-size:0.72rem">${FWIcon(stMeta.icon,{size:12})} ${stMeta.label}</span>
          <div style="display:inline-flex;gap:4px;margin-left:6px">
            <button class="link-btn" style="font-size:0.72rem;padding:2px 6px;border:1px solid var(--border);border-radius:6px;${isMov?"background:var(--accent-dim)":""}" onclick="toggleVStatus('${v.id}','moving')" title="Mark Moving">▶ Mov</button>
            <button class="link-btn" style="font-size:0.72rem;padding:2px 6px;border:1px solid var(--border);border-radius:6px;${isHalt?"background:var(--accent-dim)":""}" onclick="toggleVStatus('${v.id}','halted')" title="Mark Halted">⏸ Halt</button>
          </div>
      </td>
      <td>${pendCell}</td>
      <td>
        <button class="link-btn" onclick="openAssignVehicleToSite('${v.id}')">${FWIcon("mapPin",{size:13})} Site</button>
      </td>
    </tr>`;
  }).join("");

  el.innerHTML = `<div class="chart-card" style="padding:0;overflow:hidden">
    <div class="chart-head" style="padding:12px 16px 8px">
      <div><h2 style="margin:0">Fleet Status Board</h2>
      <p class="muted" style="margin:2px 0 0;font-size:0.8rem">Live deployment view — ${vehs.length} vehicle${vehs.length===1?"":"s"}${_dashFilter.by!=="all"?" · filtered":""}. Move/Halt is manual; Repair/Planned/No Driver are auto-derived.</p></div>
    </div>
    <div style="display:flex;gap:10px;padding:0 16px 12px;flex-wrap:wrap">${summaryTiles}</div>
    <div style="overflow-x:auto">
    <table class="chart-table-el" style="width:100%">
      <thead><tr>
        <th>Vehicle</th><th>Site / Project</th><th>Manager</th><th>Supervisor</th>
        <th>Driver</th><th>Status</th><th>Pending Age</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
  if (window.FWIcons) FWIcons.hydrate(el);
}

window.toggleVStatus = function(vehId, newSt) {
  _vstatus[vehId] = _vstatus[vehId] === newSt ? null : newSt;
  renderVehicleStatusBoard();
};

// ── Sites render ───────────────────────────────────────────────────────────
const SITE_TYPE_LABELS = {
  intercity: "Intercity", local_movement: "Local Movement", long_haul: "Long Haul",
  depot: "Depot", yard: "Yard", customer_site: "Customer Site",
  construction: "Construction", mining: "Mining", agriculture: "Agriculture",
  logistics_hub: "Logistics Hub", other: "Other",
};

function renderSites() {
  const box = document.getElementById("sitesList");
  if (!box) return;
  if (!coreDbBacked()) {
    box.innerHTML = "<p class='muted'>Sign in to manage sites and projects.</p>"; return;
  }
  if (!_sites.length) {
    box.innerHTML = `<p class='muted' style='text-align:center;padding:32px'>No sites or projects yet — click <strong>New Site</strong> to create one.</p>`;
    return;
  }
  box.innerHTML = _sites.map(s => {
    const vvas   = (_siteVeh[s.id]   || []).filter(r => !r.removed_date);
    const ssas   = (_siteStaff[s.id] || []).filter(r => !r.left_date);
    const typeLbl= SITE_TYPE_LABELS[s.project_type] || s.project_type;
    const stMeta = { active: "ok", paused: "soon", completed: "upcoming", cancelled: "overdue" }[s.status] || "upcoming";
    const vehNames = vvas.map(r => {
      const v = db.vehicles.find(x => x.dbId === r.vehicle_id); return v ? v.name : "?";
    });
    const staffRoles = ssas.reduce((m, r) => { m[r.staff_role] = (m[r.staff_role]||0)+1; return m; }, {});
    return `<div class="pred-row site-card" id="site-${s.id}" style="border-left:3px solid ${s.site_type==="project"?"#a855f7":"#22d3ee"}">
      <div class="pred-main">
        <span class="fw-badge ${stMeta}" style="font-size:0.7rem">${s.status}</span>
        <strong style="margin-left:8px">${esc(s.name)}</strong>
        <span class="fw-chip is-pending" style="margin-left:8px;font-size:0.75rem">${s.site_type==="project"?"Project":"Site"} · ${esc(typeLbl)}</span>
        ${s.location ? `<span class="muted" style="font-size:0.78rem"> · ${FWIcon("mapPin",{size:12})} ${esc(s.location)}</span>` : ""}
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:0.8rem">
        ${s.client_name     ? `<span>${FWIcon("document",{size:12})} Client: <strong>${esc(s.client_name)}</strong>${s.client_contact?` · ${esc(s.client_contact)}`:""}</span>` : ""}
        ${s.manager_name    ? `<span>${FWIcon("driver",{size:12})} Manager: <strong>${esc(s.manager_name)}</strong></span>` : ""}
        ${s.supervisor_name ? `<span>${FWIcon("eye",{size:12})} Supervisor: <strong>${esc(s.supervisor_name)}</strong></span>` : ""}
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:0.8rem">
        <span>${FWIcon("truck",{size:12})} <strong>${vehNames.length}</strong> truck${vehNames.length===1?"":"s"}${vehNames.length ? ": " + vehNames.slice(0,4).map(esc).join(", ") + (vehNames.length>4?" +"+(vehNames.length-4)+" more":"") : ""}</span>
        ${Object.entries(staffRoles).map(([r,n]) => `<span>${FWIcon("driver",{size:12})} ${n} ${r}${n>1?"s":""}</span>`).join("")}
        ${(() => { const bl = BILLING_BASIS_OPTIONS.find(b=>b[0]===s.billing_basis); return bl ? `<span>${FWIcon("receipt",{size:12})} <strong>${bl[1]}</strong>${s.rate_per_unit?` · ₹${fmtINR(s.rate_per_unit)}/${bl[1].split(" ").pop()}`:""}${s.target_quantity?` · Target: ${s.target_quantity} ${bl[1].split(" ").pop()}`:""}</span>` : ""; })()}
        ${s.contract_value  ? `<span>${FWIcon("rupee",{size:12})} Contract: <strong>${fmtINR(s.contract_value)}</strong></span>` : ""}
        ${s.contract_start  ? `<span class="muted">From ${fmtDate(s.contract_start)}${s.contract_end?" to "+fmtDate(s.contract_end):""}</span>` : ""}
        ${(s.vehicle_types||[]).length ? `<span class="muted">${(s.vehicle_types).join(", ")}</span>` : ""}
      </div>
      <div class="pred-detail" style="margin-top:8px">
        <button class="link-btn" onclick="openEditSite('${s.id}')">${FWIcon("document",{size:13})} Edit</button>
        <button class="link-btn" onclick="openAssignSiteVehicles('${s.id}')">${FWIcon("truck",{size:13})} Vehicles</button>
        <button class="link-btn" onclick="openAssignSiteStaff('${s.id}')">${FWIcon("driver",{size:13})} Staff</button>
        <button class="link-btn" style="color:#ef4444" onclick="siteArchive('${s.id}')">${FWIcon("trash",{size:13})} Archive</button>
      </div>
    </div>`;
  }).join("");
  if (window.FWIcons) FWIcons.hydrate(box);
}

// ── Site CRUD ──────────────────────────────────────────────────────────────
const SITE_TYPE_OPTIONS = [
  ["intercity","Intercity Movement"], ["local_movement","Local Movement"],
  ["long_haul","Long Haul"], ["depot","Depot / Warehouse"],
  ["yard","Yard / Parking"], ["customer_site","Customer Site"],
  ["construction","Construction"], ["mining","Mining / Quarry"],
  ["agriculture","Agriculture"], ["logistics_hub","Logistics Hub"],
  ["other","Other"],
];

const BILLING_BASIS_OPTIONS = [
  ["trip",           "Per Trip",          "Per completed trip / load"],
  ["tonnage",        "Per MT / Tonnage",  "Per metric tonne transported"],
  ["monthly_rental", "Monthly Rental",    "Fixed monthly rate per vehicle"],
  ["hourly",         "Hourly",            "Per hour of vehicle deployment"],
  ["km_based",       "Per KM",            "Rate per kilometre run"],
  ["custom",         "Custom",            "Custom or negotiated terms"],
];

const VEHICLE_TYPE_OPTIONS = [
  "Tipper","Trailer","Tanker","Container Truck","Flatbed","LMV / Pickup",
  "Maxi Cab","Bus","Mini Truck","Crane","Compactor","Concrete Mixer",
  "Reefer","Car Carrier","Other",
];

function siteFormHtml(s) {
  s = s || {};
  const curVTypes = s.vehicle_types || [];
  const curBilling = s.billing_basis || "trip";
  return `
    <div class="form-row">
      <label>Name *<input type="text" name="name" value="${escAttr(s.name||"")}" required placeholder="e.g. Hyderabad Metro — Phase 2" /></label>
      <label>Category
        <select name="siteType">
          <option value="site"${s.site_type!=="project"?" selected":""}>Site / Depot</option>
          <option value="project"${s.site_type==="project"?" selected":""}>Project</option>
        </select>
      </label>
    </div>
    <div class="form-row">
      <label>Project / Movement Type
        <select name="projectType">
          ${SITE_TYPE_OPTIONS.map(([v,l]) => `<option value="${v}"${(s.project_type||"other")===v?" selected":""}>${l}</option>`).join("")}
        </select>
      </label>
      <label>Status
        <select name="status">
          ${["active","paused","completed","cancelled"].map(st => `<option${(s.status||"active")===st?" selected":""}>${st}</option>`).join("")}
        </select>
      </label>
    </div>

    <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)" />
    <p style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin:0 0 8px">Client &amp; Location</p>
    <div class="form-row">
      <label>Client / Company name<input type="text" name="clientName" value="${escAttr(s.client_name||"")}" placeholder="Who is the work for?" /></label>
      <label>Client contact<input type="text" name="clientContact" value="${escAttr(s.client_contact||"")}" placeholder="Phone / email" /></label>
    </div>
    <div class="form-row">
      <label>Location / City<input type="text" name="location" value="${escAttr(s.location||"")}" placeholder="e.g. Hyderabad, Telangana" /></label>
      <label>Address / GPS<input type="text" name="address" value="${escAttr(s.address||"")}" placeholder="Full address or coordinates" /></label>
    </div>

    <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)" />
    <p style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin:0 0 8px">People</p>
    <div class="form-row">
      <label>Manager<input type="text" name="managerName" value="${escAttr(s.manager_name||"")}" placeholder="Manager responsible for this site" /></label>
      <label>Supervisor<input type="text" name="supervisorName" value="${escAttr(s.supervisor_name||"")}" placeholder="On-site daily supervisor" /></label>
    </div>

    <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)" />
    <p style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin:0 0 8px">Service &amp; Billing</p>
    <div class="form-row">
      <label>Billing basis
        <select name="billingBasis" id="siteBillingBasis" onchange="siteFormBillingChange()">
          ${BILLING_BASIS_OPTIONS.map(([v,l,d]) => `<option value="${v}"${curBilling===v?" selected":""} title="${d}">${l}</option>`).join("")}
        </select>
      </label>
      <label><span id="siteBillingRateLabel">Rate per Trip (₹)</span>
        <input type="number" name="ratePerUnit" min="0" step="0.01" value="${s.rate_per_unit||""}" placeholder="0.00" />
      </label>
    </div>
    <div class="form-row">
      <label>Target quantity <span class="muted" style="font-size:0.75rem" id="siteTargetLabel">(planned trips)</span>
        <input type="number" name="targetQty" min="0" step="any" value="${s.target_quantity||""}" placeholder="optional" />
      </label>
      <label>Total contract value (₹)
        <input type="number" name="contractValue" min="0" step="0.01" value="${s.contract_value||""}" placeholder="Total ₹ amount" />
      </label>
    </div>

    <p style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin:8px 0 6px">Vehicle types deployed at this site</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px" id="siteVTypeGrid">
      ${VEHICLE_TYPE_OPTIONS.map(t => `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;padding:4px 8px;border:1px solid var(--border);border-radius:8px;cursor:pointer;${curVTypes.includes(t)?"background:var(--accent-dim);border-color:var(--accent)":""}">
        <input type="checkbox" name="vtype_${t.replace(/[^a-zA-Z]/g,"_")}" value="${escAttr(t)}" ${curVTypes.includes(t)?"checked":""} style="margin:0" />${esc(t)}
      </label>`).join("")}
    </div>

    <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)" />
    <p style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin:0 0 8px">Schedule</p>
    <div class="form-row">
      <label>Contract / Work starts<input type="date" name="contractStart" value="${s.contract_start||s.start_date||""}" /></label>
      <label>Contract / Work ends<input type="date" name="contractEnd" value="${s.contract_end||s.end_date||""}" /></label>
    </div>
    <label>Notes<textarea name="notes" rows="2" style="width:100%">${esc(s.notes||"")}</textarea></label>`;
}

// Updates rate label when billing basis changes
window.siteFormBillingChange = function() {
  const sel  = document.getElementById("siteBillingBasis");
  const lbl  = document.getElementById("siteBillingRateLabel");
  const tl   = document.getElementById("siteTargetLabel");
  if (!sel || !lbl) return;
  const labels = {
    trip: ["Rate per Trip (₹)", "(planned trips)"],
    tonnage: ["Rate per MT (₹)", "(target MT)"],
    monthly_rental: ["Monthly rate per vehicle (₹)", "(months)"],
    hourly: ["Rate per hour (₹)", "(target hours)"],
    km_based: ["Rate per KM (₹)", "(target KMs)"],
    custom: ["Custom rate (₹)", "(quantity)"],
  };
  const [rl, tl2] = labels[sel.value] || ["Rate (₹)", ""];
  lbl.textContent = rl;
  if (tl) tl.textContent = tl2;
};

function siteRowFromForm(fd, orgId, extra) {
  const vtypes = VEHICLE_TYPE_OPTIONS.filter(t =>
    document.querySelector(`input[name="vtype_${t.replace(/[^a-zA-Z]/g,"_")}"]`)?.checked
  );
  return {
    org_id: orgId, name: (fd.name||"").trim(),
    site_type: fd.siteType, project_type: fd.projectType,
    location: (fd.location||"").trim()||null,
    address:  (fd.address||"").trim()||null,
    client_name:    (fd.clientName||"").trim()||null,
    client_contact: (fd.clientContact||"").trim()||null,
    manager_name:    (fd.managerName||"").trim()||null,
    supervisor_name: (fd.supervisorName||"").trim()||null,
    billing_basis:   fd.billingBasis || "trip",
    rate_per_unit:   fd.ratePerUnit  ? +fd.ratePerUnit  : null,
    target_quantity: fd.targetQty    ? +fd.targetQty    : null,
    contract_value:  fd.contractValue? +fd.contractValue: null,
    vehicle_types:   vtypes,
    contract_start:  fd.contractStart || null,
    contract_end:    fd.contractEnd   || null,
    start_date:      fd.contractStart || null,
    end_date:        fd.contractEnd   || null,
    status: fd.status,
    notes:  (fd.notes||"").trim()||null,
    ...(extra||{}),
  };
}

window.openNewSite = async function() {
  openEditModal("New Site / Project", siteFormHtml(null), async fd => {
    const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
    const ok = await fwCloud.authInsert("sites", siteRowFromForm(fd, orgId, { created_by: fwCloud.uid() }));
    if (!ok) throw new Error("Could not save — check your connection.");
    toast(`"${(fd.name||"").trim()}" created.`);
    closeEditModal();
    await loadSites(); renderSites(); renderHubSites(); renderVehicleStatusBoard(); populateFilterDropdowns();
  });
};

window.openEditSite = async function(id) {
  const s = _sites.find(x => x.id === id); if (!s) return;
  openEditModal("Edit Site / Project", siteFormHtml(s), async fd => {
    const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
    const ok = await fwCloud.authPatch(`sites?id=eq.${id}`, siteRowFromForm(fd, orgId));
    if (!ok) throw new Error("Could not save — check your connection.");
    toast("Site updated.");
    closeEditModal();
    await loadSites(); renderSites(); renderHubSites(); renderVehicleStatusBoard(); populateFilterDropdowns();
  });
};

window.siteArchive = async function(id) {
  const s = _sites.find(x => x.id === id); if (!s) return;
  if (!confirm(`Archive "${s.name}"? It will be hidden but data is preserved.`)) return;
  await fwCloud.authPatch(`sites?id=eq.${id}`, { status: "cancelled" });
  toast("Site archived.");
  await loadSites(); renderSites(); renderHubSites(); renderVehicleStatusBoard();
};

// ── Assign vehicles to site (with per-vehicle billing) ────────────────────
window.openAssignSiteVehicles = function(siteId) {
  const s = _sites.find(x => x.id === siteId); if (!s) return;
  const active       = (_siteVeh[siteId] || []).filter(r => !r.removed_date);
  const assignedDbIds= new Set(active.map(r => r.vehicle_id));
  const activeBySvId = Object.fromEntries(active.map(r => [r.vehicle_id, r]));

  const billingOpts = BILLING_BASIS_OPTIONS.map(([v,l]) =>
    `<option value="${v}"${v===s.billing_basis?" selected":""}>${l}</option>`).join("");

  const rows = db.vehicles.map(v => {
    const cur  = activeBySvId[v.dbId];
    const chk  = cur ? "checked" : "";
    const other= !cur && v.dbId ? _vehSiteMap[v.dbId] : null;
    const otherNote = other ? `<span class="muted" style="font-size:0.73rem">(at ${esc(other.site?.name||"?")})</span>` : "";
    return `<div class="sva-row" style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
        <input type="checkbox" class="sva-chk" data-dbid="${v.dbId}" ${chk} />
        ${esc(v.name)} <span class="muted" style="font-weight:400;font-size:0.8rem">${esc(v.type)}</span> ${otherNote}
      </label>
      <div class="sva-detail" style="display:${cur?"flex":"none"};gap:10px;margin-top:8px;flex-wrap:wrap">
        <label style="font-size:0.8rem">Billing basis
          <select class="sva-billing" style="height:28px;font-size:0.8rem">
            <option value="site_default">Use site default (${BILLING_BASIS_OPTIONS.find(b=>b[0]===s.billing_basis)?.[1]||s.billing_basis})</option>
            ${billingOpts}
          </select>
        </label>
        <label style="font-size:0.8rem">Rate (₹) <span class="muted">(blank = use site rate)</span>
          <input type="number" class="sva-rate" min="0" step="0.01" value="${cur?.rate_per_unit||""}" placeholder="${s.rate_per_unit||"0"}" style="width:90px;height:28px;font-size:0.8rem" />
        </label>
        <label style="font-size:0.8rem">Assigned from
          <input type="date" class="sva-date" value="${cur?.assigned_date||today()}" style="height:28px;font-size:0.8rem" />
        </label>
      </div>
    </div>`;
  }).join("");

  // toggle detail pane when checkbox changes
  const html = `<p class="muted" style="font-size:0.82rem;margin-bottom:10px">Tick trucks for this site. Each vehicle can have its own billing basis and rate, or inherit the site default.</p>
    <div id="svaList">${rows}</div>`;

  openEditModal(`Assign Vehicles — ${s.name}`, html, async () => {
    const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
    const rows2 = document.querySelectorAll("#svaList .sva-row");
    const domChecked = new Set();
    const perVeh = {};
    rows2.forEach(row => {
      const chk = row.querySelector(".sva-chk");
      if (!chk) return;
      const dbId = chk.dataset.dbid;
      if (chk.checked) {
        domChecked.add(dbId);
        perVeh[dbId] = {
          billing: row.querySelector(".sva-billing")?.value || "site_default",
          rate:    row.querySelector(".sva-rate")?.value    || null,
          date:    row.querySelector(".sva-date")?.value    || today(),
        };
      }
    });
    // Remove unchecked
    for (const r of active) {
      if (!domChecked.has(r.vehicle_id)) {
        await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${r.id}`, { removed_date: today() });
      }
    }
    // Add new + update existing
    for (const dbId of domChecked) {
      const p = perVeh[dbId] || {};
      const patch = {
        billing_basis: p.billing !== "site_default" ? p.billing : "site_default",
        rate_per_unit: p.rate ? +p.rate : null,
      };
      if (assignedDbIds.has(dbId)) {
        const existing = activeBySvId[dbId];
        if (existing) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${existing.id}`, patch);
      } else {
        const prev = _vehSiteMap[dbId];
        if (prev) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${prev.sva.id}`, { removed_date: today() });
        await fwCloud.authInsert("site_vehicle_assignments", {
          site_id: siteId, vehicle_id: dbId, org_id: orgId,
          assigned_date: p.date || today(),
          billing_basis: patch.billing_basis, rate_per_unit: patch.rate_per_unit,
        });
      }
    }
    toast("Vehicle assignments saved.");
    closeEditModal();
    await loadSites(); renderSites(); renderHubSites(); renderVehicleStatusBoard();
  });

  // Bind checkbox toggles to show/hide detail after modal renders
  requestAnimationFrame(() => {
    document.querySelectorAll("#svaList .sva-chk").forEach(chk => {
      chk.addEventListener("change", () => {
        const detail = chk.closest(".sva-row")?.querySelector(".sva-detail");
        if (detail) detail.style.display = chk.checked ? "flex" : "none";
      });
    });
  });
};

// ── Assign staff to site ────────────────────────────────────────────────────
window.openAssignSiteStaff = function(siteId) {
  const s = _sites.find(x => x.id === siteId); if (!s) return;
  const active = (_siteStaff[siteId] || []).filter(r => !r.left_date);

  const staffList = active.length
    ? active.map(r => `<div class="pred-row" style="padding:8px 0" id="ssa-${r.id}">
        <span class="fw-badge upcoming" style="font-size:0.7rem">${r.staff_role}</span>
        <strong style="margin:0 8px">${esc(r.staff_name)}</strong>
        <span class="muted" style="font-size:0.76rem">since ${fmtDate(r.joined_date)}</span>
        <button class="link-btn" style="color:#ef4444;float:right" onclick="removeSiteStaff('${r.id}','${siteId}')">Remove</button>
      </div>`).join("")
    : "<p class='muted'>No staff assigned yet.</p>";

  const driverOpts = db.drivers.map(d =>
    `<option value="${d.id}|driver|${escAttr(d.name)}">${esc(d.name)} (driver)</option>`).join("");

  openEditModal(`Staff — ${s.name}`,
    `<div id="siteStaffList">${staffList}</div>
     <h3 style="margin:16px 0 8px">Add Staff Member</h3>
     <div class="form-row">
       <label>Name<input type="text" name="staffName" placeholder="Full name" /></label>
       <label>Role
         <select name="staffRole">
           <option value="driver">Driver</option>
           <option value="supervisor">Supervisor</option>
           <option value="helper">Helper</option>
           <option value="operator">Operator</option>
           <option value="manager">Manager</option>
         </select>
       </label>
     </div>
     <div class="form-row">
       <label>OR pick a driver from fleet<select name="driverPick">
         <option value="">— pick driver —</option>${driverOpts}
       </select></label>
       <label>Joined date<input type="date" name="joinedDate" value="${today()}" /></label>
     </div>`,
    async fd => {
      const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
      let name = (fd.staffName||"").trim();
      let role = fd.staffRole;
      let driverExtId = null;
      if (fd.driverPick && fd.driverPick !== "") {
        const [drvId, drvRole, drvName] = fd.driverPick.split("|");
        if (!name) name = drvName;
        if (!role || role === "driver") role = drvRole;
        driverExtId = drvId;
      }
      if (!name) throw new Error("Enter a staff member name or pick a driver.");
      const ok = await fwCloud.authInsert("site_staff_assignments", {
        site_id: siteId, org_id: orgId, staff_name: name, staff_role: role,
        driver_ext_id: driverExtId || null, joined_date: fd.joinedDate || today(),
      });
      if (!ok) throw new Error("Could not save — check your connection.");
      toast(`${name} added to ${s.name}.`);
      closeEditModal();
      await loadSites(); renderSites(); renderHubSites(); renderVehicleStatusBoard();
    }
  );
};

window.removeSiteStaff = async function(ssaId, siteId) {
  if (!confirm("Remove this staff member from the site?")) return;
  await fwCloud.authPatch(`site_staff_assignments?id=eq.${ssaId}`, { left_date: today() });
  toast("Staff member removed from site.");
  await loadSites(); renderSites(); renderHubSites();
};

// ── Assign vehicle to site from the Status Board ───────────────────────────
window.openAssignVehicleToSite = function(vehLocalId) {
  const v = db.vehicles.find(x => x.id === vehLocalId); if (!v) return;
  const cur = _vehSiteMap[v.dbId];
  const siteOpts = _sites.filter(s => s.status === "active").map(s =>
    `<option value="${s.id}"${cur?.site?.id===s.id?" selected":""}>${esc(s.name)}</option>`).join("");

  openEditModal(`Assign Site — ${v.name}`,
    `<label>Current site: <strong>${cur ? esc(cur.site?.name||"Unknown") : "None"}</strong></label>
     <label style="margin-top:12px;display:block">Assign to site
       <select name="siteId">
         <option value="">— None —</option>${siteOpts}
       </select>
     </label>
     <label>From date<input type="date" name="fromDate" value="${today()}" /></label>`,
    async fd => {
      const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
      if (cur) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${cur.sva.id}`, { removed_date: today() });
      if (fd.siteId) {
        await fwCloud.authInsert("site_vehicle_assignments", {
          site_id: fd.siteId, vehicle_id: v.dbId, org_id: orgId, assigned_date: fd.fromDate || today(),
        });
      }
      const siteName = fd.siteId ? (_sites.find(s=>s.id===fd.siteId)?.name || "site") : "none";
      toast(`${v.name} → ${fd.siteId ? siteName : "unassigned"}.`);
      closeEditModal();
      await loadSites(); renderSites(); renderHubSites(); renderVehicleStatusBoard();
    }
  );
};

// ---------- Render: work orders (job cards) ----------
function renderWorkOrders() {
  const open = db.workOrders.filter(w => w.status !== "Completed");
  const done = db.workOrders.filter(w => w.status === "Completed").slice(-5).reverse();
  document.getElementById("workOrdersList").innerHTML = (open.length ? open.map(w => `
    <div class="pred-row">
      <div class="pred-main"><span class="fw-chip is-pending"><span class="dot"></span>In workshop</span> <strong>${esc(vName(w.vehicleId))}</strong> — ${esc(w.title)}</div>
      <div class="pred-detail">
        <span>${w.vendor ? esc(w.vendor) + " · " : ""}opened ${fmtDate(w.createdAt)}${w.estCost ? " · est. " + fmtINR(w.estCost) : ""}</span>
        <button class="link-btn" onclick="startBilling('${w.id}')">${FWIcon("check", { size: 14 })} Complete &amp; Bill</button>
        <button class="link-btn" onclick="openEditWorkOrder('${w.id}')">${FWIcon("document", { size: 14 })} Edit</button>
      </div>
    </div>`).join("") : "<p class='muted'>No open job cards.</p>") +
    (done.length ? `<details class="chart-table"><summary>Completed job cards (${done.length})</summary>` +
      done.map(w => `<p class="muted" style="margin:6px 0">${FWIcon("checkCircle", { size: 14, cls: "ic-success" })} ${esc(vName(w.vehicleId))} — ${esc(w.title)} · ${fmtINR(w.finalCost || 0)} (${fmtDate(w.completedAt)})</p>`).join("") + "</details>" : "");
}
function openEditWorkOrder(id) {
  const w = db.workOrders.find(x => x.id === id);
  if (!w) return;
  openEditModal("Edit Job Card", `
    <label>Vehicle<select name="vehicleId" required>${vehicleOptionsHtml(w.vehicleId)}</select></label>
    <label>Title<input type="text" name="title" value="${escAttr(w.title || "")}" required /></label>
    <div class="form-row">
      <label>Vendor / Workshop<input type="text" name="vendor" value="${escAttr(w.vendor || "")}" /></label>
      <label>Estimated Cost (&#8377;)<input type="number" name="estCost" min="0" value="${w.estCost != null ? w.estCost : ""}" /></label>
    </div>`, async fd => {
    const patch = { vehicleId: fd.vehicleId, title: fd.title.trim(), vendor: fd.vendor.trim() || undefined, estCost: fd.estCost ? +fd.estCost : undefined };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateWorkOrder(w.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(w, patch);
    saveStore(); renderWorkOrders(); renderOverview();
    closeEditModal(); toast("Job card updated.");
  });
}

async function createWorkOrder(issueId) {
  const i = db.issues.find(x => x.id === issueId);
  if (!i) return;
  const vendor = prompt("Workshop / mechanic name for this job card:", "FleetWorks partner workshop");
  if (vendor === null) return;
  const est = prompt("Estimated cost (₹, optional):", "");
  const w = { issueId, vehicleId: i.vehicleId, title: i.title, vendor: vendor.trim(), estCost: est ? +est : null, status: "Open", createdAt: new Date().toISOString().slice(0, 10) };
  if (window.FWMaintenance && FWMaintenance.createWorkOrder) {
    const saved = await FWMaintenance.createWorkOrder(w);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.workOrders.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateWorkOrder(w);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.workOrders.push(saved);
    await dbUpdateIssue(i.id, { status: "In Progress" });
  } else {
    db.workOrders.push({ id: uid(), ...w });
  }
  i.status = "In Progress";
  saveStore(); renderIssues(); renderWorkOrders(); renderOverview();
}

// Where "Complete & Bill" goes. Signed-in fleets get the itemised bill and the
// AI check; everyone else keeps the single-total prompt, which still works.
function startBilling(id) {
  const dbBacked = typeof coreDbBacked === "function" && coreDbBacked();
  if (dbBacked && typeof openBillEntry === "function") return openBillEntry(id);
  return completeWorkOrder(id);
}

async function completeWorkOrder(id) {
  const w = db.workOrders.find(x => x.id === id);
  if (!w) return;
  const cost = prompt("Final bill amount (₹):", w.estCost || "");
  if (cost === null || !+cost) return;
  const cat = prompt("Expense category (Tyres / Battery / Brakes / Clutch / Engine Oil & Filters / Suspension / Electrical / Body & Paint / DEF / Greasing / Water Wash / RTO / Police / Other — or type your own):", "Other");
  if (cat === null) return;
  await finishWorkOrder(w, +cost, cat.trim() || "Other");
  alert("Job card closed. The expense has been added to your books automatically — it will appear in the AI Dashboard and Tally export.");
}

// Closing a job card, shared by the prompt() flow and the itemised bill modal.
async function finishWorkOrder(w, cost, category) {
  w.status = "Completed"; w.completedAt = new Date().toISOString().slice(0, 10); w.finalCost = +cost;
  const ex = { vehicleId: w.vehicleId, date: w.completedAt, category: category || "Other", amount: +cost };
  const i = db.issues.find(x => x.id === w.issueId);
  if (window.FWFleetFin && FWFleetFin.createExpense) {
    const saved = await FWFleetFin.createExpense(ex);
    if (saved) db.expenses.push(saved);
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      await dbUpdateWorkOrder(w.id, { status: w.status, completedAt: w.completedAt, finalCost: w.finalCost });
      if (i) await dbUpdateIssue(i.id, { status: "Resolved", resolvedAt: w.completedAt });
    }
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateExpense(ex);
    if (saved) db.expenses.push(saved);
    await dbUpdateWorkOrder(w.id, { status: w.status, completedAt: w.completedAt, finalCost: w.finalCost });
    if (i) await dbUpdateIssue(i.id, { status: "Resolved", resolvedAt: w.completedAt });
  } else {
    db.expenses.push(ex);
  }
  if (i) { i.status = "Resolved"; i.resolvedAt = w.completedAt; }
  rememberExpenseCategory(ex.category);
  saveStore(); renderIssues(); renderWorkOrders(); renderVehicles(); renderOverview();
  refreshCrossCutting();
}

// Entry point for the itemised bill modal: the line items are already saved, so
// this only needs the total and a category for the books.
async function completeWorkOrderWithTotal(id, total, category) {
  const w = db.workOrders.find(x => x.id === id);
  if (!w) throw new Error("Job card not found.");
  await finishWorkOrder(w, total, category || "Other");
  if (typeof toast === "function") toast("Job card closed — expense recorded in your books.");
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
    `<table><thead><tr><th>Date</th><th>Vehicle</th><th>Litres</th><th>Amount</th><th>Odometer</th><th></th></tr></thead><tbody>` +
    [...db.fuelLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
      .map(f => `<tr><td>${fmtDate(f.date)}</td><td>${esc(vName(f.vehicleId))}</td><td>${f.litres}</td><td>${fmtINR(f.amount)}</td><td>${f.odo.toLocaleString("en-IN")} km</td><td><button class="link-btn" onclick="openEditFuelLog('${f.id}')">Edit</button></td></tr>`).join("") +
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
        <button class="link-btn" onclick="openEditIssue('${i.id}')">${FWIcon("document", { size: 14 })} Edit</button>
      </div>
    </div>`).join("") : "<p class='muted'>No open issues.</p>") +
    (resolved.length ? `<details class="chart-table"><summary>Recently resolved (${resolved.length})</summary>` +
      resolved.map(i => `<p class="muted" style="margin:6px 0">${FWIcon("checkCircle", { size: 14, cls: "ic-success" })} ${esc(vName(i.vehicleId))} — ${esc(i.title)} (${fmtDate(i.resolvedAt)})</p>`).join("") + "</details>" : "");
}
function openEditIssue(id) {
  const i = db.issues.find(x => x.id === id);
  if (!i) return;
  openEditModal("Edit Issue", `
    <label>Vehicle<select name="vehicleId" required>${vehicleOptionsHtml(i.vehicleId)}</select></label>
    <label>Title<input type="text" name="title" value="${escAttr(i.title || "")}" required /></label>
    <label>Severity
      <select name="severity" required>
        <option value="High" ${i.severity === "High" ? "selected" : ""}>High</option>
        <option value="Medium" ${i.severity === "Medium" ? "selected" : ""}>Medium</option>
        <option value="Low" ${i.severity === "Low" ? "selected" : ""}>Low</option>
      </select>
    </label>`, async fd => {
    const patch = { vehicleId: fd.vehicleId, title: fd.title.trim(), severity: fd.severity };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateIssue(i.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(i, patch);
    saveStore(); renderIssues(); renderOverview();
    closeEditModal(); toast("Issue updated.");
  });
}
async function resolveIssue(id) {
  const i = db.issues.find(x => x.id === id);
  if (!i) return;
  i.status = "Resolved"; i.resolvedAt = new Date().toISOString().slice(0, 10);
  if (window.FWMaintenance && FWMaintenance.resolveIssue) {
    const ok = await FWMaintenance.resolveIssue({ id: i.id, resolvedAt: i.resolvedAt });
    if (!ok) { toast("Could not save — check your connection and try again.", "err"); return; }
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const ok = await dbUpdateIssue(i.id, { status: i.status, resolvedAt: i.resolvedAt });
    if (!ok) { toast("Could not save — check your connection and try again.", "err"); return; }
  }
  saveStore(); renderIssues(); renderOverview();
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
        <button class="link-btn" onclick="completeReminder('${r.id}')">${FWIcon("check", { size: 14 })} Done Today</button>
        <button class="link-btn" onclick="openEditReminder('${r.id}')">${FWIcon("document", { size: 14 })} Edit</button></div>
    </div>`;
  }).join("") : "<p class='muted'>No PM schedules yet — add one below.</p>";
}
async function completeReminder(id) {
  const r = db.reminders.find(x => x.id === id);
  if (!r) return;
  r.lastDate = new Date().toISOString().slice(0, 10);
  if (window.FWMaintenance && FWMaintenance.completeReminder) {
    const ok = await FWMaintenance.completeReminder({ id: r.id, lastDate: r.lastDate });
    if (!ok) { toast("Could not save — check your connection and try again.", "err"); return; }
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const ok = await fwCloud.authPatch(`reminders?id=eq.${r.id}`, { last_date: r.lastDate });
    if (!ok) { toast("Could not save — check your connection and try again.", "err"); return; }
  }
  saveStore(); renderReminders(); renderOverview();
}
function openEditReminder(id) {
  const r = db.reminders.find(x => x.id === id);
  if (!r) return;
  openEditModal("Edit Reminder", `
    <label>Vehicle<select name="vehicleId" required>${vehicleOptionsHtml(r.vehicleId)}</select></label>
    <label>Task<input type="text" name="task" value="${escAttr(r.task)}" required /></label>
    <div class="form-row">
      <label>Every (months)<input type="number" name="everyMonths" min="1" value="${r.everyMonths}" required /></label>
      <label>Last done<input type="date" name="lastDate" value="${r.lastDate || ""}" required /></label>
    </div>`, async fd => {
    const patch = { vehicleId: fd.vehicleId, task: fd.task.trim(), everyMonths: +fd.everyMonths, lastDate: fd.lastDate };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateReminder(r.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(r, patch);
    saveStore(); renderReminders(); renderOverview();
    closeEditModal(); toast("Reminder updated.");
  });
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
    return `<tr class="veh-row" data-pid="${p.id}">
        <td style="cursor:pointer"><strong>${esc(p.name)}</strong>${p.partNumber ? "<br /><span class='muted'>#" + esc(p.partNumber) + "</span>" : ""}</td>
        <td style="cursor:pointer">${esc(p.make || "—")}</td>
        <td style="cursor:pointer">${esc(p.category || "—")}</td>
        <td style="cursor:pointer">${esc(p.vendor || "—")}</td>
        <td style="cursor:pointer">${p.qty} <span class="muted">/ min ${p.minQty}</span></td>
        <td style="cursor:pointer">${p.unitCost != null ? fmtINR(p.unitCost) : "—"}</td>
        <td style="cursor:pointer">${stockPill}</td>
        <td style="cursor:pointer">${warrantyPill(p.warrantyExpiry)}</td>
        <td><button class="link-btn" onclick="event.stopPropagation();openEditPart('${p.id}')">Edit</button></td>
      </tr>
      <tr class="veh-history" data-hist="${p.id}" hidden><td colspan="9" style="background:#f8fafc">${partDetailHTML(p)}</td></tr>`;
  }).join("");
  box.innerHTML = `<table class="chart-table-el"><thead><tr>
      <th>Part</th><th>Make</th><th>Category</th><th>Vendor</th><th>Qty</th><th>Unit Cost</th><th>Stock</th><th>Warranty</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  document.querySelectorAll("#partsTable .veh-row").forEach(r => r.addEventListener("click", () => {
    const hist = document.querySelector(`[data-hist="${r.dataset.pid}"]`);
    hist.hidden = !hist.hidden;
  }));
}

function openEditPart(id) {
  const p = db.parts.find(x => x.id === id);
  if (!p) return;
  openEditModal("Edit Part", `
    <label>Part Name<input type="text" name="name" value="${escAttr(p.name)}" required /></label>
    <div class="form-row">
      <label>Part Number<input type="text" name="partNumber" value="${escAttr(p.partNumber || "")}" /></label>
      <label>Make / Brand<input type="text" name="make" value="${escAttr(p.make || "")}" /></label>
    </div>
    <div class="form-row">
      <label>Category<input type="text" name="category" value="${escAttr(p.category || "")}" /></label>
      <label>Vendor<input type="text" name="vendor" value="${escAttr(p.vendor || "")}" /></label>
    </div>
    <div class="form-row">
      <label>Qty<input type="number" name="qty" min="0" value="${p.qty}" required /></label>
      <label>Min Qty<input type="number" name="minQty" min="0" value="${p.minQty}" required /></label>
    </div>
    <div class="form-row">
      <label>Unit Cost (&#8377;)<input type="number" name="unitCost" min="0" value="${p.unitCost != null ? p.unitCost : ""}" /></label>
      <label>Warranty Expiry<input type="date" name="warrantyExpiry" value="${p.warrantyExpiry || ""}" /></label>
    </div>`, async fd => {
    const patch = {
      name: fd.name.trim(), partNumber: fd.partNumber.trim() || undefined, make: fd.make.trim() || undefined,
      category: fd.category.trim() || undefined, vendor: fd.vendor.trim() || undefined,
      qty: +fd.qty, minQty: +fd.minQty,
      unitCost: fd.unitCost ? +fd.unitCost : undefined, warrantyExpiry: fd.warrantyExpiry || undefined,
    };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdatePart(p.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(p, patch);
    saveStore(); renderParts(); renderOverview();
    closeEditModal(); toast("Part updated.");
  });
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
  if (window.FWFleetOps && FWFleetOps.radarItems) return FWFleetOps.radarItems();
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
        <td><button class="link-btn" onclick="openEditDocument('${d.id}')">Edit</button> <button class="icon-btn" title="Delete" onclick="deleteDocument('${d.id}')">${FWIcon("trash", { size: 16, cls: "ic-danger" })}</button></td></tr>`;
    }).join("") + "</tbody></table>"
    : "<p class='muted'>No documents stored yet. Add your first RC, insurance or permit below — expiries will show on the Compliance Radar.</p>";
}
function openEditDocument(id) {
  const d = db.documents.find(x => x.id === id);
  if (!d) return;
  const entityListHtml = type => (type === "driver" ? db.drivers : db.vehicles)
    .map(x => `<option value="${x.id}" ${x.id === d.entityId ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const docTypeListHtml = type => (DOC_TYPES[type] || DOC_TYPES.vehicle)
    .map(t => `<option ${t === d.docType ? "selected" : ""}>${t}</option>`).join("");
  openEditModal("Edit Document", `
    <div class="form-row">
      <label>Attached to
        <select name="entityType" id="editDocEntityType">
          <option value="vehicle" ${d.entityType === "vehicle" ? "selected" : ""}>Vehicle</option>
          <option value="driver" ${d.entityType === "driver" ? "selected" : ""}>Driver</option>
        </select>
      </label>
      <label>${d.entityType === "driver" ? "Driver" : "Vehicle"}
        <select name="entityId" id="editDocEntityId">${entityListHtml(d.entityType)}</select>
      </label>
    </div>
    <label>Document Type<select name="docType" id="editDocType">${docTypeListHtml(d.entityType)}</select></label>
    <div class="form-row">
      <label>Number<input type="text" name="number" value="${escAttr(d.number || "")}" /></label>
      <label>Valid Till<input type="date" name="expiryDate" value="${d.expiryDate || ""}" /></label>
    </div>
    <label>Issue Date<input type="date" name="issueDate" value="${d.issueDate || ""}" /></label>
    <label>Note<input type="text" name="note" value="${escAttr(d.note || "")}" /></label>`, async fd => {
    const patch = {
      entityType: fd.entityType, entityId: fd.entityId, docType: fd.docType,
      number: fd.number.trim() || undefined, issueDate: fd.issueDate || undefined,
      expiryDate: fd.expiryDate || undefined, note: fd.note.trim() || undefined,
    };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateDocument(d.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(d, patch);
    saveStore(); renderDocuments(); renderRadar(); renderOverview();
    closeEditModal(); toast("Document updated.");
  });
  document.getElementById("editDocEntityType").addEventListener("change", e => {
    document.getElementById("editDocEntityId").innerHTML = entityListHtml(e.target.value);
    document.getElementById("editDocType").innerHTML = docTypeListHtml(e.target.value);
  });
}
async function deleteDocument(id) {
  const doc = db.documents.find(x => x.id === id);
  if (!confirmDestructive(`Delete this document?${doc ? `\n\n${doc.docType}${doc.number ? " · " + doc.number : ""}` : ""}`)) return;
  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const ok = await dbDeleteDocument(id);
    if (!ok) { toast("Could not delete — check your connection and try again.", "err"); return; }
  }
  db.documents = db.documents.filter(d => d.id !== id);
  saveStore(); renderDocuments(); renderRadar(); renderOverview();
}

// ---------- Render: Tyre Manager ----------
function latestReadings(vid) {
  if (window.FWFleetOps && FWFleetOps.latestReadings) return FWFleetOps.latestReadings(vid);
  const map = {};
  db.tyreReadings.filter(t => t.vehicleId === vid)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(t => { map[t.position] = t; });
  return map;
}

let _tyreData = { tyres: [], fitments: [], viewRows: [] };
let _retreadTyreId = null;

async function loadTyreManager() {
  if (!window.fwCloud || !fwCloud.user()) { renderTyres(); return; }
  const sb = fwCloud.sb();
  try {
    const [r1, r2, r3] = await Promise.all([
      sb.from("tyres").select("*").order("status").order("created_at"),
      sb.from("tyre_fitments").select("*,tyres(brand,size,serial_no,retread_count,new_tread_mm)").eq("is_current", true),
      sb.from("v_tyre_manager").select("*")
    ]);
    _tyreData = { tyres: r1.data || [], fitments: r2.data || [], viewRows: r3.data || [] };
  } catch(e) { _tyreData = { tyres: [], fitments: [], viewRows: [] }; }
  renderTyres();
}

function _tyreWearCls(tread, min) {
  if (tread <= min) return "bad";
  if (tread <= min + 1.5) return "warn";
  return "good";
}

function _projectedKm(tread, wearPer1000, min) {
  if (!wearPer1000 || wearPer1000 <= 0) return null;
  return Math.round((tread - min) / wearPer1000 * 1000);
}

function renderTyreAxleBlock(vid, positions, localReadings) {
  const axles = {};
  positions.forEach(pos => {
    let a = "Front Axle";
    if (/Rear-2/i.test(pos)) a = "Rear Axle 2";
    else if (/Rear-1/i.test(pos)) a = "Rear Axle 1";
    else if (/Rear/i.test(pos)) a = "Rear Axle";
    (axles[a] = axles[a] || []).push(pos);
  });
  const min = minTread();
  return Object.entries(axles).map(([axleName, axlePositions]) => {
    const left = [...axlePositions].filter(p => /Left/i.test(p)).reverse();
    const right = axlePositions.filter(p => /Right/i.test(p));
    const cell = pos => {
      const lr = localReadings[pos];
      const vr = _tyreData.viewRows.find(v => v.vehicle_id === vid && v.position === pos);
      const fit = _tyreData.fitments.find(f => f.vehicle_id === vid && f.position === pos);
      const tyre = fit ? (fit.tyres || _tyreData.tyres.find(t => t.id === fit.tyre_id)) : null;
      const tread = vr?.tread_latest ?? lr?.treadDepth ?? null;
      const wr = vr?.wear_rate_mm_per_1000km ?? null;
      const proj = tread != null ? _projectedKm(tread, wr, min) : null;
      const cls = tread != null ? _tyreWearCls(tread, min) : "empty";
      const lbl = pos.replace(/^(Front|Rear-?\d?)\s*/i,"").replace("Outer","O").replace("Inner","I").trim()||pos;
      const brandLine = tyre ? `<span style="font-size:.68rem;opacity:.65;display:block">${esc(tyre.brand||"")} ${esc(tyre.size||"")}</span>` : "";
      const projLine = proj != null
        ? `<span class="tyre-proj">${proj > 0 ? proj.toLocaleString("en-IN")+"km" : "⚠ Replace"}</span>` : "";
      const editBtn = lr ? ` onclick="openEditTyreReading('${lr.id}')" title="Edit reading" style="cursor:pointer"` : "";
      const fitBtn = !fit ? `<button class="link-btn" style="font-size:.66rem;color:var(--brand);display:block;margin-top:2px" onclick="openFitTyreModal('${vid}','${esc(pos)}','')">+ Fit</button>` : "";
      return `<div class="tyre-cell ${cls}"${editBtn}>
        <span class="tyre-pos">${lbl}</span>
        ${tread != null ? `<span class="tyre-read">${tread}mm${lr?.pressure ? " · "+lr.pressure+"psi" : ""}</span>` : `<span class="tyre-read muted">—</span>`}
        ${brandLine}${projLine}${fitBtn}
      </div>`;
    };
    return `<div class="tyre-axle-row">
      <span class="tyre-axle-label">${axleName}</span>
      <div class="tyre-side tyre-side-left">${left.map(cell).join("")}</div>
      <div class="tyre-axle-beam"></div>
      <div class="tyre-side tyre-side-right">${right.map(cell).join("")}</div>
    </div>`;
  }).join("");
}

function renderTyres() {
  const sel = document.getElementById("tyreVehicleFilter");
  const vid = sel?.value || (db.vehicles[0]?.id);
  const diagramBox = document.getElementById("tyreAxleDiagram");
  const titleEl = document.getElementById("tyreAxleTitle");
  const subEl = document.getElementById("tyreAxleSub");
  const summaryBar = document.getElementById("tyreSummaryBar");
  const inventoryBox = document.getElementById("tyreInventoryTable");
  const retreadCard = document.getElementById("tyreRetreadCard");
  const retreadList = document.getElementById("tyreRetreadList");

  if (!vid) {
    if (diagramBox) diagramBox.innerHTML = "<p class='muted'>Add a vehicle first.</p>";
    return;
  }
  const vehicle = db.vehicles.find(v => v.id === vid);
  if (titleEl) titleEl.textContent = (vehicle?.name || "Vehicle") + " — Axle View";
  if (subEl) subEl.textContent = [vehicle?.type, vehicle?.regNo].filter(Boolean).join(" · ");

  const positions = tyrePositions(vid);
  const localReadings = latestReadings(vid);
  const min = minTread();

  // Summary chips
  if (summaryBar) {
    const worn = positions.filter(p => {
      const t = _tyreData.viewRows.find(v => v.vehicle_id === vid && v.position === p)?.tread_latest ?? localReadings[p]?.treadDepth;
      return t != null && t <= min;
    }).length;
    const warn = positions.filter(p => {
      const t = _tyreData.viewRows.find(v => v.vehicle_id === vid && v.position === p)?.tread_latest ?? localReadings[p]?.treadDepth;
      return t != null && t > min && t <= min + 1.5;
    }).length;
    const fitted = _tyreData.fitments.filter(f => f.vehicle_id === vid).length;
    summaryBar.innerHTML = [
      worn  ? `<span class="fw-badge overdue">${FWIcon("alert",{size:13})} ${worn} worn</span>` : "",
      warn  ? `<span class="fw-badge warn">${FWIcon("alert",{size:13})} ${warn} warning</span>` : "",
      !worn && !warn ? `<span class="fw-badge ok">${FWIcon("shieldCheck",{size:13})} All tyres OK</span>` : "",
      fitted ? `<span class="fw-badge neutral">${fitted}/${positions.length} positions tracked</span>` : ""
    ].filter(Boolean).join("");
  }

  // Axle diagram
  if (diagramBox) diagramBox.innerHTML = renderTyreAxleBlock(vid, positions, localReadings);

  // Retread candidates (Supabase mode)
  const candidates = _tyreData.tyres.filter(t => {
    if ((t.retread_count || 0) >= 3) return false;
    const f = _tyreData.fitments.find(f => f.tyre_id === t.id && f.vehicle_id === vid);
    if (!f) return false;
    const tread = _tyreData.viewRows.find(v => v.vehicle_id === vid && v.position === f.position)?.tread_latest ?? f.fitted_tread;
    return tread != null && tread < 3 && tread > min;
  });
  if (retreadCard) retreadCard.hidden = candidates.length === 0;
  if (retreadList) retreadList.innerHTML = candidates.map(t => {
    const f = _tyreData.fitments.find(f => f.tyre_id === t.id && f.vehicle_id === vid);
    const tread = _tyreData.viewRows.find(v => v.vehicle_id === vid && v.position === f?.position)?.tread_latest ?? "?";
    return `<div class="trip-req-row">
      <div class="trip-req-icon">${FWIcon("tire",{size:20})}</div>
      <div class="trip-req-body"><strong>${esc(t.brand||"Unknown")} ${esc(t.size||"")} · ${esc(f?.position||"")}</strong>
        <span class="muted">Tread: ${tread}mm · Retread #${(t.retread_count||0)+1}</span></div>
      <button class="btn btn-primary btn-sm" onclick="openRetreadModal('${t.id}','${esc((t.brand||"")+" "+(t.size||""))}')">Send for Retread</button>
    </div>`;
  }).join("");

  // Inventory table
  if (inventoryBox) {
    if (_tyreData.tyres.length === 0) {
      // local/demo fallback — show positions with readings
      const rows = positions.map(pos => {
        const r = localReadings[pos];
        const tread = r?.treadDepth;
        const cls = tread == null ? "neutral" : _tyreWearCls(tread, min);
        const badge = {bad:"overdue",warn:"warn",good:"ok",neutral:"neutral"}[cls];
        return `<tr>
          <td>${esc(pos)}</td><td>${tread != null ? tread+" mm" : "—"}</td>
          <td>${r?.pressure ? r.pressure+" psi" : "—"}</td>
          <td><span class="fw-badge ${badge}">${tread == null ? "No reading" : cls === "bad" ? "Replace" : cls === "warn" ? "Warning" : "OK"}</span></td>
          <td>—</td><td>—</td>
        </tr>`;
      }).join("");
      inventoryBox.innerHTML = `<table class="data-table"><thead><tr><th>Position</th><th>Tread</th><th>Pressure</th><th>Status</th><th>Wear Rate</th><th>Proj. km</th></tr></thead><tbody>${rows||"<tr><td colspan='6' class='muted' style='padding:12px'>Log a tyre reading to get started.</td></tr>"}</tbody></table>`;
    } else {
      const rows = _tyreData.tyres.map(t => {
        const f = _tyreData.fitments.find(f => f.tyre_id === t.id);
        const vr = f ? _tyreData.viewRows.find(v => v.position === f.position && v.vehicle_id === f.vehicle_id) : null;
        const tread = vr?.tread_latest ?? f?.fitted_tread;
        const wr = vr?.wear_rate_mm_per_1000km;
        const proj = (tread != null && wr) ? _projectedKm(tread, wr, min) : null;
        const stCls = {fitted:"ok",stock:"neutral",retread_pending:"warn",scrapped:"overdue"}[t.status]||"neutral";
        return `<tr>
          <td>${esc(t.serial_no||"—")}</td>
          <td>${esc(t.brand||"—")} <span class="muted">${esc(t.size||"")}</span></td>
          <td><span class="fw-badge ${stCls}">${t.status}</span></td>
          <td>${f ? esc(f.position||"") : "—"}</td>
          <td>${tread != null ? tread+" mm" : "—"}</td>
          <td>${wr ? wr+" mm/1000km" : "—"}</td>
          <td>${proj != null ? proj.toLocaleString("en-IN")+" km" : "—"}</td>
          <td>${t.retread_count||0}</td>
          <td style="white-space:nowrap;display:flex;gap:4px;padding:8px 4px">
            ${t.status==="stock" ? `<button class="btn btn-outline btn-sm" onclick="openFitTyreModal('${vid}','','${t.id}')">Fit</button>` : ""}
            ${t.status==="fitted"&&tread!=null&&tread<3&&tread>min&&(t.retread_count||0)<3 ? `<button class="btn btn-primary btn-sm" onclick="openRetreadModal('${t.id}','${esc((t.brand||"")+" "+(t.size||""))}')">Retread</button>` : ""}
          </td>
        </tr>`;
      }).join("");
      inventoryBox.innerHTML = `<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Serial</th><th>Brand / Size</th><th>Status</th><th>Position</th><th>Tread</th><th>Wear Rate</th><th>Proj. km</th><th>Retreads</th><th></th></tr></thead><tbody>${rows||"<tr><td colspan='9' class='muted' style='padding:12px'>No tyres in inventory — click Add Tyre</td></tr>"}</tbody></table></div>`;
    }
  }
}

// ---- Tyre Manager modal helpers ----
function openLogReadingCard() {
  const c = document.getElementById("tyreLogCard");
  if (!c) return;
  c.hidden = false;
  c.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const vf = document.getElementById("tyreVehicleFilter");
  const vr = document.getElementById("tyreFormVehicle");
  if (vf?.value && vr) { vr.value = vf.value; fillTyrePositions(); }
}

function openAddTyreModal() {
  const m = document.getElementById("addTyreModal");
  if (!m) return;
  m.style.display = "flex";
  const vs = document.getElementById("addTyreFitVehicle");
  if (vs) {
    vs.innerHTML = '<option value="">Not yet — add to stock</option>' +
      db.vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
  }
}
function closeAddTyreModal() {
  const m = document.getElementById("addTyreModal");
  if (m) { m.style.display = "none"; document.getElementById("addTyreForm")?.reset(); }
  const e = document.getElementById("addTyreErr"); if (e) e.hidden = true;
}

function openFitTyreModal(vid, position, tyreId) {
  const m = document.getElementById("fitTyreModal");
  if (!m) return;
  m.style.display = "flex";
  document.getElementById("fitTyreTitle").textContent = position ? "Fit Tyre to " + position : "Fit Tyre";
  const v = db.vehicles.find(x => x.id === vid);
  document.getElementById("fitTyreSub").textContent = v ? v.name : "";
  const sel = document.getElementById("fitTyreSelect");
  const stock = _tyreData.tyres.filter(t => t.status === "stock");
  sel.innerHTML = stock.length
    ? stock.map(t => `<option value="${t.id}" ${t.id===tyreId?"selected":""}>${esc(t.brand||"")} ${esc(t.size||"")} ${t.serial_no?"· "+t.serial_no:""} (${t.retread_count||0} retreads)</option>`).join("")
    : "<option value=''>No tyres in stock — Add Tyre first</option>";
  const f = document.getElementById("fitTyreForm");
  f.dataset.vid = vid; f.dataset.position = position || "";
}
function closeFitTyreModal() {
  const m = document.getElementById("fitTyreModal"); if (m) m.style.display = "none";
}

function openRetreadModal(tyreId, label) {
  const m = document.getElementById("retreadModal");
  if (!m) return;
  _retreadTyreId = tyreId;
  document.getElementById("retreadModalSub").textContent = label;
  document.getElementById("retreadDate").value = new Date().toISOString().slice(0,10);
  m.style.display = "flex";
}
function closeRetreadModal() {
  const m = document.getElementById("retreadModal"); if (m) m.style.display = "none";
}
function openEditTyreReading(id) {
  const t = db.tyreReadings.find(x => x.id === id);
  if (!t) return;
  openEditModal("Edit Tyre Reading", `
    <label>Vehicle<select name="vehicleId" required>${vehicleOptionsHtml(t.vehicleId)}</select></label>
    <label>Position<input type="text" name="position" value="${escAttr(t.position)}" required /></label>
    <div class="form-row">
      <label>Tread Depth (mm)<input type="number" name="treadDepth" step="0.1" min="0" value="${t.treadDepth}" required /></label>
      <label>Pressure (psi)<input type="number" name="pressure" value="${t.pressure != null ? t.pressure : ""}" /></label>
    </div>
    <div class="form-row">
      <label>Odometer (km)<input type="number" name="odo" value="${t.odo != null ? t.odo : ""}" /></label>
      <label>Date<input type="date" name="date" value="${t.date || ""}" required /></label>
    </div>`, async fd => {
    const patch = {
      vehicleId: fd.vehicleId, position: fd.position.trim(), treadDepth: +fd.treadDepth,
      pressure: fd.pressure ? +fd.pressure : undefined, odo: fd.odo ? +fd.odo : undefined, date: fd.date,
    };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateTyreReading(t.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(t, patch);
    saveStore(); renderTyres(); renderOverview();
    closeEditModal(); toast("Tyre reading updated.");
  });
}

// ---------- Render: Settings ----------
function renderSettings() {
  const s = db.settings || {};
  const f = document.getElementById("settingsForm");
  f.businessName.value = s.businessName || "";
  f.gstin.value = s.gstin || "";
  if (f.ownerPhone) f.ownerPhone.value = s.ownerPhone || "";
  if (f.ownerUpi) f.ownerUpi.value = s.ownerUpi || "";
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
  // Hard guard: demo data must never exist in a signed-in session — it would
  // get written to the real database. Signed-in accounts start clean.
  if (window.fwCloud && fwCloud.user()) {
    alert("Demo data is not available on a signed-in account — add your real vehicles instead.");
    return;
  }
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
   "tyreVehicleFilter", "tyreFormVehicle", "tripVehicle", "billVehicle", "svcVehicle",
   "fastagVehicle", "finFastagVehicle", "invVehicle"].forEach(id => {
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

// ---------- Toll & FASTag ----------
let FASTAG = [];

// NETC FASTag UPI handle per issuer bank.
// VPA format is netc.<VEHICLE_REGISTRATION>@<handle>
// Derived from NPCI/NETC documentation and issuer apps; verify with your bank before paying.
const NETC_ISSUER_HANDLES = {
  "AIRTEL PAYMENTS BANK":      "airtelnetc",
  "AXIS BANK":                 "axisnetc",
  "AU SMALL FINANCE BANK":     "aunetc",
  "BANK OF BARODA":            "bobnetc",
  "EQUITAS SMALL FINANCE BANK":"equitas",
  "FEDERAL BANK":              "federalnetc",
  "FINO PAYMENTS BANK":        "fino",
  "HDFC BANK":                 "hdfcnetc",
  "ICICI BANK":                "icici",
  "IDFC FIRST BANK":           "idfcnetc",
  "INDUSIND BANK":             "indusindnetc",
  "JAMMU & KASHMIR BANK":      "jkbnetc",
  "KARNATAKA BANK":            "kbnetc",
  "KARUR VYSYA BANK":          "kvbnetc",
  "KOTAK MAHINDRA BANK":       "kmbl",
  "PUNJAB & SIND BANK":        "psbnetc",
  "PUNJAB NATIONAL BANK":      "pnbnetc",
  "SARASWAT BANK":             "saraswatnetc",
  "SOUTH INDIAN BANK":         "siblnetc",
  "STATE BANK OF INDIA":       "sbinetc",
  "UNION BANK OF INDIA":       "ubinnetc",
  "YES BANK":                  "yesnetc",
};

// Bound lazily: the panel is built by mk() at render time, so the form does not
// exist when this file first runs.
// FleetFin's recharge entry. Writes the expense and moves the tag balance in
// one action — logging them separately is how the books and the tag drift apart.
function bindFinFastagForm() {
  const form = document.getElementById("finFastagForm");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  const dateEl = form.elements.date;
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = document.getElementById("finFastagErr");
    err.hidden = true;
    const fd = Object.fromEntries(new FormData(form));
    const veh = db.vehicles.find(v => v.id === fd.vehicleId);
    if (!veh) { err.textContent = "Pick a vehicle first."; err.hidden = false; return; }

    const ex = { vehicleId: veh.id, date: fd.date, category: "FASTag Recharge", amount: +fd.amount };
    try {
      if (typeof coreDbBacked === "function" && coreDbBacked()) {
        const saved = await dbCreateExpense(ex);
        if (!saved) throw new Error("Could not save the expense — check your connection.");
        db.expenses.push(saved);

        // Move the balance too. If the owner told us what the tag read after
        // recharging, trust that; otherwise add the recharge to what we last
        // knew, which is the best available answer and clearly derived.
        const org = await dbOrgId();
        const acct = FASTAG.find(a => a.vehicleExtId === veh.id);
        const stated = fd.balanceAfter === "" ? null : +fd.balanceAfter;
        const newBal = stated != null ? stated : ((acct ? +acct.balance || 0 : 0) + (+fd.amount));
        const now = new Date().toISOString();
        let acctId = acct ? acct.id : null;
        if (acct) {
          await fwCloud.authPatch(`fastag_accounts?id=eq.${acct.id}`, { balance: newBal, balance_at: now });
        } else if (org && veh.dbId) {
          const row = await fwCloud.authInsertRet("fastag_accounts",
            { org_id: org, vehicle_id: veh.dbId, balance: newBal, balance_at: now, is_active: true });
          acctId = row ? row.id : null;
        }
        if (org && acctId) {
          await fwCloud.authInsert("fastag_balance_log",
            { org_id: org, account_id: acctId, balance: newBal, source: "recharge" }).catch(() => {});
        }
        await loadFastag();
      } else {
        db.expenses.push(ex);
      }
      rememberExpenseCategory("FASTag Recharge");
      form.reset();
      form.elements.date.value = new Date().toISOString().slice(0, 10);
      saveStore();
      renderAll();
      toast("Recharge logged — expense recorded and FASTag balance updated.");
    } catch (ex2) {
      err.textContent = ex2.message || "Could not save.";
      err.hidden = false;
    }
  });
}

function bindFastagForm() {
  const form = document.getElementById("fastagForm");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = document.getElementById("fastagErr");
    err.hidden = true;
    const fd = Object.fromEntries(new FormData(form));
    if (typeof coreDbBacked !== "function" || !coreDbBacked()) {
      err.textContent = "Sign in to save FASTag balances — they sync across your devices.";
      err.hidden = false; return;
    }
    try {
      const org = await dbOrgId();
      const veh = db.vehicles.find(v => v.id === fd.vehicleId);
      if (!org || !veh || !veh.dbId) throw new Error("Pick a vehicle first.");
      const now = new Date().toISOString();
      const existing = FASTAG.find(a => a.vehicleExtId === fd.vehicleId);
      const patch = {
        tag_id: (fd.tagId || "").trim() || null,
        bank: (fd.bank || "").trim() || null,
        balance: +fd.balance,
        balance_at: now,
        low_threshold: +fd.lowThreshold || 1000,
      };
      let acctId = existing ? existing.id : null;
      if (existing) {
        await fwCloud.authPatch(`fastag_accounts?id=eq.${existing.id}`, patch);
      } else {
        const row = await fwCloud.authInsertRet("fastag_accounts",
          { org_id: org, vehicle_id: veh.dbId, is_active: true, ...patch });
        acctId = row ? row.id : null;
      }
      // Every observed balance is logged, so depletion can be measured from
      // what actually happened rather than extrapolated forever from one point.
      if (acctId) {
        await fwCloud.authInsert("fastag_balance_log",
          { org_id: org, account_id: acctId, balance: +fd.balance, source: "manual" }).catch(() => {});
      }
      form.reset();
      form.elements.lowThreshold.value = 1000;
      await loadFastag();
      toast("FASTag balance saved.");
    } catch (ex) {
      err.textContent = ex.message || "Could not save — check your connection.";
      err.hidden = false;
    }
  });
}

// Daily toll spend for one vehicle, from its own FASTag/Toll expense history.
// Returns null rather than a fleet average when a truck has too little history:
// a projection built on one recharge is a guess wearing a number's clothes, and
// "we don't know yet" is more useful to an owner than a confident wrong figure.
function fastagDailySpend(vehicleId) {
  const rows = (db.expenses || []).filter(e =>
    e.vehicleId === vehicleId && /fastag|toll/i.test(e.category || ""));
  if (rows.length < 2) return null;
  const dates = rows.map(e => new Date(e.date)).sort((a, b) => a - b);
  const days = Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / 86400000));
  if (days < 7) return null;                       // too short a window to extrapolate
  const total = rows.reduce((s, e) => s + (+e.amount || 0), 0);
  return total / days;
}

// Balance as of now, reduced by estimated spend since it was last observed.
// The stored number is only true at balance_at; showing it unadjusted would
// overstate every truck that has been running since.
function fastagProjected(acct) {
  const bal = +acct.balance || 0;
  const rate = fastagDailySpend(acct.vehicleExtId);
  if (!acct.balance_at || rate == null) return { balance: bal, rate, daysLeft: null, stale: false };
  const elapsed = Math.max(0, (Date.now() - new Date(acct.balance_at)) / 86400000);
  const projected = Math.max(0, bal - rate * elapsed);
  return {
    balance: projected, rate,
    daysLeft: rate > 0 ? projected / rate : null,
    stale: elapsed > 14,
  };
}

async function loadFastag() {
  if (typeof coreDbBacked !== "function" || !coreDbBacked()) { FASTAG = []; renderFastag(); return; }
  try {
    const org = await dbOrgId();
    if (!org) { FASTAG = []; renderFastag(); return; }
    const rows = await fwCloud.authGet("fastag_accounts",
      `select=*,vehicles(ext_id)&org_id=eq.${org}&is_active=eq.true`);
    FASTAG = (rows || []).map(r => ({ ...r, vehicleExtId: r.vehicles ? r.vehicles.ext_id : null }));
    // Balance history drives the "is anyone actually topping this up?" check.
    const log = await fwCloud.authGet("fastag_balance_log",
      `select=account_id,balance,recorded_at&org_id=eq.${org}&order=recorded_at.desc&limit=400`).catch(() => null);
    FASTAG_LOG = {};
    (log || []).forEach(r => { (FASTAG_LOG[r.account_id] ||= []).push(r); });
  } catch { FASTAG = []; FASTAG_LOG = {}; }
  renderFastag();
}

// What this owner usually puts on this tag. Median of their own past FASTag
// recharges for the vehicle, so one unusual top-up does not drag the figure;
// falling back to a month at the tag's measured daily burn, and only then to a
// flat default. Computed, never guessed — the same rule as the rest of FleetFin.
// ---------- Is this tag actually being topped up? ----------
// Auto-recharge set at the issuer bank does not pass through FleetWorks, so it
// cannot be confirmed from the expense book — a bank top-up leaves no expense
// row. What it DOES leave is a balance that goes back up. So the signal is the
// balance history itself: a tag sitting below its threshold with no observed
// rise, for longer than that tag's own usual gap between top-ups, is a tag
// nobody is refilling.
//
// This is the one thing FleetWorks can see that no single issuer app can: every
// tag at once, and the moment one stops recovering. Today the owner finds out
// from the driver, at the plaza.
//
// Deliberately conservative. Balances are entered by hand, so absence of a
// reading is not absence of a top-up — an account with no recent observation is
// reported as UNKNOWN, never as broken. Crying wolf here would train owners to
// ignore the one alert that matters.
function fastagTopUpGap(acctId) {
  const log = (FASTAG_LOG[acctId] || []).slice().sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
  const rises = [];
  for (let i = 1; i < log.length; i++) {
    if (+log[i].balance > +log[i - 1].balance) rises.push(new Date(log[i].recorded_at));
  }
  if (rises.length < 2) return { lastRise: rises[0] || null, typicalDays: null };
  const gaps = [];
  for (let i = 1; i < rises.length; i++) gaps.push((rises[i] - rises[i - 1]) / 86400000);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return {
    lastRise: rises[rises.length - 1],
    typicalDays: gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2,
  };
}

function fastagAutoRechargeCheck(acct) {
  const p = fastagProjected(acct);
  const thr = +acct.low_threshold || 1000;
  if (p.balance >= thr) return { state: "ok" };
  // A stale reading means we cannot tell, and saying so is the honest answer.
  if (p.stale) return { state: "unknown", reason: "no balance reading in over two weeks" };

  const { lastRise, typicalDays } = fastagTopUpGap(acct.id);
  if (!lastRise) return { state: "unknown", reason: "no top-up history recorded yet" };

  const daysSince = (Date.now() - lastRise) / 86400000;
  const expected = typicalDays == null ? 14 : Math.max(3, typicalDays * 1.5);
  if (daysSince <= expected) return { state: "ok" };
  return {
    state: "not_topping_up",
    daysSince: Math.round(daysSince),
    typicalDays: typicalDays == null ? null : Math.round(typicalDays),
  };
}

function fastagSuggestedAmount(vehicleExtId, acct) {
  const past = db.expenses
    .filter(e => e.vehicleId === vehicleExtId && e.category === "FASTag Recharge" && +e.amount > 0)
    .map(e => +e.amount).sort((a, b) => a - b);
  if (past.length) {
    const mid = Math.floor(past.length / 2);
    const med = past.length % 2 ? past[mid] : (past[mid - 1] + past[mid]) / 2;
    return Math.max(500, Math.round(med / 500) * 500);
  }
  const p = acct ? fastagProjected(acct) : null;
  if (p && p.rate > 0) return Math.max(500, Math.round((p.rate * 30) / 500) * 500);
  return 2000;
}

// ---------- Recharge by UPI QR ----------
// A NETC tag is rechargeable from any UPI app by paying a virtual address of
// the form netc.<VEHICLENUMBER>@<issuer handle>. FleetWorks builds the left
// side from the registration it already holds; the handle differs per issuer,
// so it is confirmed once and stored rather than guessed.
//
// FleetWorks never moves the money. It renders the standard NPCI upi://pay URI
// as a QR; the owner scans it with their own UPI app and confirms there. The
// address is shown in full first, because a wrong VPA pays a stranger.
// Derive the NETC VPA from bank name + vehicle registration.
// Returns a complete address (netc.TN01AB1234@icici) when the bank is in the
// known list, or a partial one (netc.TN01AB1234@) when it is not.
function fastagVpaSuggestion(vehicleExtId, bank) {
  const v = db.vehicles.find(x => x.id === vehicleExtId);
  const reg = (v && v.name ? v.name : "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!reg) return "";
  const handle = bank ? NETC_ISSUER_HANDLES[(bank).trim().toUpperCase()] : null;
  return handle ? `netc.${reg}@${handle}` : `netc.${reg}@`;
}

async function fastagSetVpa(vehicleExtId) {
  const acct = FASTAG.find(a => a.vehicleExtId === vehicleExtId);
  if (!acct) { toast("Add a FASTag for this vehicle first.", "err"); return null; }
  const suggested = acct.upi_vpa || fastagVpaSuggestion(vehicleExtId, acct.bank);
  const vpa = prompt(
    "FASTag UPI address for this tag.\n\n"
    + "Format: netc.<vehicle number>@<bank handle> — e.g. netc.TN01AB1234@icici\n\n"
    + "Check with your bank if unsure of the handle.",
    suggested);
  if (vpa === null) return null;
  const t = vpa.trim();
  if (t && !/^[\w.\-]{2,60}@[A-Za-z]{2,30}$/.test(t)) {
    toast("That doesn't look like a UPI address (name@handle).", "err");
    return null;
  }
  const ok = await fwCloud.authPatch(`fastag_accounts?id=eq.${acct.id}`, { upi_vpa: t || null });
  if (!ok) { toast("Could not save that UPI address.", "err"); return null; }
  acct.upi_vpa = t || null;
  renderFastag();
  return acct.upi_vpa;
}

async function fastagUpiQr(vehicleExtId) {
  const acct = FASTAG.find(a => a.vehicleExtId === vehicleExtId);
  if (!acct) return;
  const v = db.vehicles.find(x => x.id === vehicleExtId);

  // Derive VPA from bank name + vehicle number. If the bank is in the known list
  // this produces a complete address immediately; otherwise it falls back to the
  // saved VPA or a partial suggestion the owner can complete.
  let vpa = acct.upi_vpa || fastagVpaSuggestion(vehicleExtId, acct.bank);
  const isComplete = /^[\w.\-]{2,60}@[A-Za-z]{2,30}$/.test(vpa);

  // If we could not derive a complete VPA, ask the owner to fill in the handle.
  if (!isComplete) {
    const typed = prompt(
      `FASTag UPI address for ${v ? v.name : "this vehicle"}.\n\n`
      + "Format: netc.<number>@<bank handle> — e.g. netc.TN01AB1234@icici\n"
      + `Bank on file: ${acct.bank || "not set"}. Check with your bank if unsure.`,
      vpa);
    if (!typed) return;
    vpa = typed.trim();
    if (!/^[\w.\-]{2,60}@[A-Za-z]{2,30}$/.test(vpa)) {
      toast("That doesn't look like a UPI address (name@handle).", "err"); return;
    }
  }

  // Save new / updated VPA so the next QR tap skips the prompt.
  if (vpa !== acct.upi_vpa) {
    const ok = await fwCloud.authPatch(`fastag_accounts?id=eq.${acct.id}`, { upi_vpa: vpa });
    if (ok) { acct.upi_vpa = vpa; renderFastag(); }
  }

  const suggested = fastagSuggestedAmount(vehicleExtId, acct);
  const amtStr = prompt("Recharge amount (₹):", String(suggested));
  if (amtStr === null) return;
  const amount = Math.round(+amtStr);
  if (!(amount > 0)) { toast("Enter an amount above zero.", "err"); return; }

  const link = buildUpiLink(vpa, "FASTag " + (v ? v.name : ""), amount, "FASTag recharge " + (v ? v.name : ""));
  const bankLabel = acct.bank || vpa.split("@")[1] || "FASTag";

  openEditModal("Recharge by UPI", `
    <p style="text-align:center;margin:0 0 10px">
      <strong>${esc(v ? v.name : "")}</strong> &nbsp;·&nbsp; ${esc(bankLabel)}<br />
      <span class="muted">Paying <strong>${esc(vpa)}</strong></span><br />
      <span style="font-size:1.3rem;font-weight:700">${fmtINR(amount)}</span>
    </p>
    <div id="fastagQr" style="display:flex;justify-content:center;margin:12px 0"><span class="muted">Generating…</span></div>
    <p style="text-align:center;margin:6px 0"><a class="btn btn-primary" href="${escAttr(link)}">Open my UPI app</a></p>
    <p class="muted" style="font-size:.8rem">Verify the address above before paying — FleetWorks builds the QR, your UPI app moves the money. Log it below once done.</p>`,
    null);

  try {
    await loadQrCode();
    const box = document.getElementById("fastagQr");
    if (!box) return;
    box.innerHTML = "";
    new window.QRCode(box, { text: link, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
  } catch (e) {
    const box = document.getElementById("fastagQr");
    if (box) box.innerHTML = `<span class="muted">${esc(e.message || "Could not draw the QR code.")} Use the button below instead.</span>`;
  }
}

// Opens the owner's own recharge page for this tag when they have saved one,
// then drops them on the pre-filled log form. FleetWorks does not process the
// payment — see the recharge_url migration for why.
function fastagRecharge(vehicleExtId) {
  const acct = FASTAG.find(a => a.vehicleExtId === vehicleExtId);
  if (acct && acct.recharge_url) window.open(acct.recharge_url, "_blank", "noopener");
  const amount = fastagSuggestedAmount(vehicleExtId, acct);
  document.querySelector('[data-tab="account"]')?.click();
  const form = document.getElementById("finFastagForm");
  if (!form) return;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  if (form.elements.vehicleId) form.elements.vehicleId.value = vehicleExtId;
  if (form.elements.amount && !form.elements.amount.value) form.elements.amount.value = amount;
  toast(acct && acct.recharge_url
    ? "Recharge page opened — log the amount here when it's done."
    : "Recharge on your issuer's app, then log it here.");
}

// Saved once per tag, because the ~39 NETC issuers' recharge pages move and a
// shipped list would send someone to a dead link on the day they need it.
async function fastagSetLink(vehicleExtId) {
  const acct = FASTAG.find(a => a.vehicleExtId === vehicleExtId);
  if (!acct) { toast("Add a FASTag for this vehicle first.", "err"); return; }
  const url = prompt("Link to where you recharge this tag (your issuer's page or app link):", acct.recharge_url || "");
  if (url === null) return;
  const trimmed = url.trim();
  // Only http(s). A javascript: or data: URL here would run in the owner's
  // session the moment anyone clicked Recharge.
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    toast("That needs to start with http:// or https://", "err");
    return;
  }
  const ok = await fwCloud.authPatch(`fastag_accounts?id=eq.${acct.id}`, { recharge_url: trimmed || null });
  if (!ok) { toast("Could not save that link.", "err"); return; }
  acct.recharge_url = trimmed || null;
  renderFastag();
  toast(trimmed ? "Recharge link saved." : "Recharge link cleared.");
}

function renderFastag() {
  // FleetFin's recharge form shares the same vehicle list.
  const finSel = document.getElementById("finFastagVehicle");
  if (finSel) {
    const keepFin = finSel.value;
    finSel.innerHTML = db.vehicles.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")
      || '<option value="">Add a vehicle first</option>';
    if ([...finSel.options].some(o => o.value === keepFin)) finSel.value = keepFin;
  }
  const sel = document.getElementById("fastagVehicle");
  if (sel) {
    const keep = sel.value;
    sel.innerHTML = db.vehicles.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")
      || '<option value="">Add a vehicle first</option>';
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  }

  const statEl = document.getElementById("fastagStats");
  const tblEl = document.getElementById("fastagTable");
  if (!tblEl) return;

  const rows = FASTAG.map(a => {
    const v = db.vehicles.find(x => x.id === a.vehicleExtId);
    return { a, v, p: fastagProjected(a) };
  });
  // Vehicles with no tag on file yet. They still belong in the table — an
  // untagged truck is the one that gets stopped at the plaza, so it should be
  // visible rather than reduced to a count in a tile.
  const tagged = new Set(FASTAG.map(a => a.vehicleExtId));
  const untagged = db.vehicles.filter(v => !tagged.has(v.id));
  const low = rows.filter(r => r.p.balance < (+r.a.low_threshold || 1000));
  const soon = rows.filter(r => r.p.daysLeft != null && r.p.daysLeft < 5);
  const totalBal = rows.reduce((s, r) => s + r.p.balance, 0);
  // Tags that are low AND show no sign of being refilled — the failure an
  // issuer's own app cannot show you, because it only knows about one tag.
  const notFilling = rows.filter(r => fastagAutoRechargeCheck(r.a).state === "not_topping_up");
  const noTag = db.vehicles.length - rows.length;

  if (statEl) statEl.innerHTML = `
    <div class="stat-tile"><span class="stat-label">Tags on file</span><span class="stat-value">${rows.length}</span><span class="stat-sub">${noTag > 0 ? noTag + " vehicle(s) without one" : "every vehicle covered"}</span></div>
    <div class="stat-tile"><span class="stat-label">Total balance</span><span class="stat-value">${fmtINR(totalBal)}</span><span class="stat-sub">estimated, across all tags</span></div>
    <div class="stat-tile"><span class="stat-label">Below your threshold</span><span class="stat-value" style="color:${low.length ? PAL.critical : "#006300"}">${low.length}</span><span class="stat-sub">recharge before the next trip</span></div>
    <div class="stat-tile"><span class="stat-label">Not being topped up</span><span class="stat-value" style="color:${notFilling.length ? PAL.critical : "#006300"}">${notFilling.length}</span><span class="stat-sub">${notFilling.length ? "low, and no recharge going in" : "every low tag is being refilled"}</span></div>
    <div class="stat-tile"><span class="stat-label">Running out this week</span><span class="stat-value" style="color:${soon.length ? PAL.serious : "#006300"}">${soon.length}</span><span class="stat-sub">under 5 days at current spend</span></div>`;

  if (!rows.length && !untagged.length) {
    tblEl.innerHTML = "<p class='muted'>Add a vehicle first — FASTag balances are tracked per vehicle.</p>";
    return;
  }

  tblEl.innerHTML = `<table class="chart-table-el"><thead><tr>
    <th>Vehicle</th><th>Tag / Bank</th><th>Balance now</th><th>Daily toll</th><th>Days left</th><th>Last updated</th><th>Recharge</th></tr></thead><tbody>` +
    rows.sort((x, y) => (x.p.daysLeft ?? 1e9) - (y.p.daysLeft ?? 1e9)).map(({ a, v, p }) => {
      const thr = +a.low_threshold || 1000;
      const tone = p.balance < thr ? PAL.critical : (p.daysLeft != null && p.daysLeft < 5) ? PAL.serious : "#006300";
      const dl = p.daysLeft == null
        ? `<span class="muted" title="Needs at least two FASTag expenses a week apart">not enough history</span>`
        : `<strong style="color:${tone}">${p.daysLeft < 1 ? "under a day" : Math.round(p.daysLeft) + " days"}</strong>`;
      const chk = fastagAutoRechargeCheck(a);
      const warn = chk.state === "not_topping_up"
        ? `<br /><span style="color:${PAL.critical};font-size:0.74rem">Below your threshold for ${chk.daysSince} days with no top-up${chk.typicalDays ? ` — usually every ${chk.typicalDays}` : ""}. If auto-recharge is on at your bank, it isn't working.</span>`
        : chk.state === "unknown"
          ? `<br /><span class="muted" style="font-size:0.74rem">Can't tell if it's being topped up — ${esc(chk.reason)}.</span>`
          : "";
      const age = a.balance_at ? Math.round((Date.now() - new Date(a.balance_at)) / 86400000) : null;
      return `<tr>
        <td><strong>${esc(v ? v.name : a.vehicleExtId || "—")}</strong></td>
        <td>${esc(a.tag_id || "—")}${a.bank ? `<br /><span class="muted" style="font-size:0.76rem">${esc(a.bank)}</span>` : ""}</td>
        <td style="color:${tone};font-weight:700">${fmtINR(p.balance)}${p.stale ? '<br /><span class="muted" style="font-size:0.7rem">estimate is stale</span>' : ""}</td>
        <td>${p.rate == null ? "<span class='muted'>—</span>" : fmtINR(p.rate) + "/day"}</td>
        <td>${dl}${warn}</td>
        <td class="muted" style="font-size:0.8rem">${age == null ? "—" : age === 0 ? "today" : age + "d ago"}</td>
        <td style="white-space:nowrap">
          <button class="link-btn" onclick="fastagRecharge('${esc(a.vehicleExtId)}')">Recharge ${fmtINR(fastagSuggestedAmount(a.vehicleExtId, a))}</button>
          <button class="link-btn" onclick="fastagUpiQr('${esc(a.vehicleExtId)}')" title="Show a UPI QR to recharge this tag">UPI QR</button>
          <button class="link-btn" onclick="fastagSetLink('${esc(a.vehicleExtId)}')" title="${a.recharge_url ? "Change" : "Save"} where you recharge this tag">${a.recharge_url ? "Edit link" : "+ Link"}</button>
        </td>
      </tr>`;
    }).join("") +
    untagged.map(v => `<tr>
        <td><strong>${esc(v.name)}</strong></td>
        <td colspan="5"><span class="muted">No FASTag on file yet — add one above to start tracking its balance.</span></td>
        <td class="muted" style="font-size:0.8rem">—</td>
      </tr>`).join("") + "</tbody></table>";
}

// Suggested expense categories, shown in every expense-category field's
// datalist (both are free-text inputs, not a fixed <select> — anyone can
// type a new type). Presets first, then every category any expense has
// ever actually used, so a custom type typed once shows up as a suggestion
// everywhere from then on — no separate "manage categories" list to keep.
const DEFAULT_EXPENSE_CATEGORIES = [
  "Tyres", "Tyre Puncture", "Tyre Change", "Battery", "Brakes", "Clutch",
  "Engine Oil & Filters", "Suspension", "Electrical", "Body & Paint",
  "DEF", "Greasing", "Water Wash",
  // Road-running costs. FASTag recharges are a large, recurring per-vehicle
  // spend for any national-permit fleet, and until the Toll & FASTag tab is
  // fed by telematics this is where they belong — logged here they flow into
  // cost-per-km, the FleetFin tiles and the category breakdowns like any other
  // expense, rather than sitting outside the books.
  "FASTag Recharge", "Toll", "RTO", "Police",
  "Insurance", "Permit & Road Tax", "Fitness & PUC", "Other",
];
// Categories a signed-in fleet has in the database. Null until loaded, and
// null forever when signed out — the app still works offline, where the shipped
// constant is the whole list.
let DB_EXPENSE_CATEGORIES = null;
// Recent balance observations per FASTag account id, for the top-up check.
let FASTAG_LOG = {};

async function loadExpenseCategories() {
  if (typeof coreDbBacked !== "function" || !coreDbBacked()) return;
  try {
    const rows = await dbLoadExpenseCategories();
    if (rows && rows.length) { DB_EXPENSE_CATEGORIES = rows; renderExpenseCategoryList(); }
  } catch { /* suggestions are a convenience; never block the form on them */ }
}

function renderExpenseCategoryList() {
  const el = document.getElementById("expenseCategoryList");
  if (!el) return;
  const seen = new Set();
  const cats = [];
  // Database list first when we have one, then the shipped defaults, then every
  // category any expense has actually used. Concatenating rather than choosing
  // means a fleet never loses a suggestion it was relying on, whichever source
  // it came from.
  (DB_EXPENSE_CATEGORIES || DEFAULT_EXPENSE_CATEGORIES)
    .concat(DB_EXPENSE_CATEGORIES ? DEFAULT_EXPENSE_CATEGORIES : [])
    .concat(db.expenses.map(e => e.category))
    .forEach(c => {
      const t = (c || "").trim();
      const key = t.toLowerCase();
      if (t && !seen.has(key)) { seen.add(key); cats.push(t); }
    });
  el.innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join("");
}

// Called after an expense is saved: a category typed once is remembered for
// every device on the account, which is the whole point of moving this list
// into the database.
function rememberExpenseCategory(name) {
  const t = String(name || "").trim();
  if (!t) return;
  const known = new Set((DB_EXPENSE_CATEGORIES || []).map(c => c.toLowerCase()));
  if (known.has(t.toLowerCase())) return;
  if (DB_EXPENSE_CATEGORIES) DB_EXPENSE_CATEGORIES.push(t);
  if (typeof coreDbBacked === "function" && coreDbBacked() && typeof dbAddExpenseCategory === "function") {
    dbAddExpenseCategory(t).catch(() => {});
  }
  renderExpenseCategoryList();
}

// ---------- Save confirmation + cross-cutting refresh ----------
// Every entry form below saves into `db` (localStorage + debounced cloud
// push, both already handled by saveStore()) and re-renders its own tab —
// but several tabs aggregate data from EVERYTHING (Home's health strip and
// action inbox, Payroll's driver list, Team & Access's picker). Narrow
// per-form renders were silently skipping those, so a save was correct but
// looked stale until something else forced a full re-render. This runs the
// cheap cross-tab renders (no chart repaints) after every save, and
// toast() gives visible confirmation on forms that had none at all.
function refreshCrossCutting() {
  renderHealth();
  renderActionInbox();
  renderAssignments();
  renderMeters();
  renderRadar();
  renderExpenseHistory();
  renderReplacement();
  renderItemFailures();
  renderServiceHistory();
  renderServiceTasks();
  renderVendors();
  if (window.renderPayroll) renderPayroll();
  if (window.renderTeamPicker) renderTeamPicker();
  if (window.renderAccountPortal) renderAccountPortal();
  if (typeof renderExpenseApprovals === "function") renderExpenseApprovals();
  // Both FASTag vehicle pickers are rendered from db.vehicles, so a vehicle
  // added anywhere in the app has to refresh them too.
  if (typeof renderFastag === "function") renderFastag();
}
let toastTimer = null;
// Double confirmation for every destructive action — nothing in any table
// is deleted or replaced on a single click, app-wide.
function confirmDestructive(summary) {
  return confirm(summary)
    && confirm("Please confirm once more — this permanently changes your records and cannot be undone.");
}

// ---------- Shared Edit-Entry modal ----------
// One modal DOM shell, reused by every small entity's Edit action. Each
// openEditX() below sets the title, fills #editEntryBody with its own
// fields, and sets editEntrySave to its own async (form) => {...} callback
// — the single submit handler just reads the current form and calls it.
let editEntrySave = null;
function vehicleOptionsHtml(selectedId) {
  return db.vehicles.map(v => `<option value="${v.id}" ${v.id === selectedId ? "selected" : ""}>${esc(v.name)}</option>`).join("");
}
function driverOptionsHtml(selectedId) {
  return db.drivers.map(d => `<option value="${d.id}" ${d.id === selectedId ? "selected" : ""}>${esc(d.name)}</option>`).join("");
}
function openEditModal(title, bodyHtml, saveFn) {
  document.getElementById("editEntryTitle").textContent = title;
  document.getElementById("editEntryBody").innerHTML = bodyHtml;
  document.getElementById("editEntryErr").hidden = true;
  editEntrySave = saveFn;
  document.getElementById("editEntryModal").style.display = "flex";
}
function closeEditModal() { document.getElementById("editEntryModal").style.display = "none"; editEntrySave = null; }
document.getElementById("editEntryClose").addEventListener("click", closeEditModal);
document.getElementById("editEntryForm").addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("editEntryErr");
  errEl.hidden = true;
  if (!editEntrySave) return;
  try {
    const fd = Object.fromEntries(new FormData(e.target));
    await editEntrySave(fd);
  } catch (ex) {
    errEl.textContent = ex.message || "Could not save — check your connection and try again.";
    errEl.hidden = false;
  }
});

function toast(msg, tone) {
  let el = document.getElementById("fwToast");
  if (!el) { el = document.createElement("div"); el.id = "fwToast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = tone || "ok"; // replaces the whole class list, dropping any "show" from a prior toast
  void el.offsetHeight; // force a reflow so the entrance transition always plays, even on rapid repeats
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

let driverEditId = null;
function openEditDriver(id) {
  const d = db.drivers.find(x => x.id === id);
  if (!d) return;
  driverEditId = id;
  const form = document.getElementById("driverForm");
  form.name.value = d.name || ""; form.phone.value = d.phone || "";
  form.dlNo.value = d.dlNo || ""; form.dlExpiry.value = d.dlExpiry || "";
  form.vehicleId.value = d.vehicleId || "";
  form.upiId.value = d.upiId || ""; form.bankAccount.value = d.bankAccount || ""; form.bankIfsc.value = d.bankIfsc || "";
  form.payBasis.value = normPayBasis(d.payBasis);
  document.getElementById("driverFormSubmit").textContent = "Save Changes";
  document.getElementById("driverFormCancel").hidden = false;
  const card = form.closest(".form-card") || form.closest(".chart-card");
  if (card) { card.classList.remove("collapsed"); card.scrollIntoView({ behavior: "smooth", block: "center" }); }
}
document.getElementById("driverFormCancel").addEventListener("click", () => {
  driverEditId = null;
  document.getElementById("driverForm").reset();
  document.getElementById("driverFormSubmit").textContent = "Save Driver";
  document.getElementById("driverFormCancel").hidden = true;
});

document.getElementById("driverForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const upiId = (fd.upiId || "").trim() || undefined;
  const bankAccount = (fd.bankAccount || "").replace(/\s+/g, "") || undefined;
  const bankIfsc = (fd.bankIfsc || "").trim().toUpperCase() || undefined;
  const payBasis = normPayBasis(fd.payBasis);
  const patch = { name: fd.name.trim(), phone: fd.phone, dlNo: fd.dlNo.trim(), dlExpiry: fd.dlExpiry, vehicleId: fd.vehicleId, upiId, bankAccount, bankIfsc, payBasis };

  // Editing an existing driver by id — works even if the DL number itself
  // was changed, since matching by the (possibly stale) old DL number
  // would otherwise silently create a duplicate instead of updating.
  if (driverEditId) {
    const existing = db.drivers.find(d => d.id === driverEditId);
    driverEditId = null;
    document.getElementById("driverFormSubmit").textContent = "Save Driver";
    document.getElementById("driverFormCancel").hidden = true;
    if (existing) {
      if (typeof coreDbBacked === "function" && coreDbBacked()) {
        const ok = await dbUpdateDriver(existing.id, patch);
        if (!ok) { toast("Could not save this driver — check your connection and try again.", "err"); return; }
      }
      Object.assign(existing, patch);
      saveStore(); e.target.reset(); renderDrivers(); renderVehicles(); renderOverview();
      refreshCrossCutting();
      toast("Driver updated.");
      return;
    }
  }

  const existing = db.drivers.find(d => d.dlNo.toLowerCase() === patch.dlNo.toLowerCase());
  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    if (existing) {
      const ok = await dbUpdateDriver(existing.id, patch);
      if (!ok) { toast("Could not save this driver — check your connection and try again.", "err"); return; }
      Object.assign(existing, patch);
    } else {
      const d = { id: uid(), ...patch };
      const saved = await dbCreateDriver(d);
      if (!saved) { toast("Could not save this driver — check your connection and try again.", "err"); return; }
      Object.assign(d, saved);
      db.drivers.push(d);
    }
  } else {
    if (existing) Object.assign(existing, patch);
    else db.drivers.push({ id: uid(), ...patch });
  }
  saveStore(); e.target.reset(); renderDrivers(); renderVehicles(); renderOverview();
  refreshCrossCutting();
  toast(existing ? "Driver updated." : "Driver added.");
});

document.getElementById("complianceForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const v = db.vehicles.find(x => x.id === fd.vehicleId);
  if (v) {
    v.compliance = v.compliance || {};
    v.compliance[fd.doc] = fd.validTill;
    if (typeof coreDbBacked === "function" && coreDbBacked()) await dbUpdateVehicleCompliance(v.id, fd.doc, fd.validTill);
    else saveStore();
    renderVehicles(); renderOverview(); refreshCrossCutting(); toast("Compliance date saved.");
  }
  e.target.reset();
});

document.getElementById("fuelForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const f = { vehicleId: fd.vehicleId, date: fd.date, litres: +fd.litres, amount: +fd.amount, odo: +fd.odo };
  if (window.FWFleetFin && FWFleetFin.createFuelLog) {
    const saved = await FWFleetFin.createFuelLog(f);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.fuelLogs.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateFuelLog(f);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.fuelLogs.push(saved);
  } else {
    db.fuelLogs.push({ id: uid(), ...f });
  }
  saveStore(); e.target.reset(); renderFuel(); renderOverview();
  refreshCrossCutting();
  toast("Fuel entry saved.");
});

document.getElementById("inspectionForm").addEventListener("submit", async e => {
  e.preventDefault();
  const vid = document.getElementById("inspVehicle").value;
  const results = INSPECTION_ITEMS.map((item, i) => ({ item, ok: e.target["item" + i].value === "ok" }));
  const passed = results.every(r => r.ok);
  const ins = { vehicleId: vid, date: new Date().toISOString().slice(0, 10), passed, results };
  const faults = results.filter(r => !r.ok).map(r => ({
    vehicleId: vid, title: r.item + " — inspection fault",
    severity: r.item.includes("Brake") || r.item.includes("Tyre") ? "High" : "Medium",
    status: "Open", createdAt: new Date().toISOString().slice(0, 10), source: "Inspection"
  }));
  if (window.FWMaintenance && FWMaintenance.recordInspection) {
    const result = await FWMaintenance.recordInspection(ins);
    if (!result || !result.inspection) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.inspections.push(result.inspection);
    result.faults.forEach(f => db.issues.push(f));
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateInspection(ins);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.inspections.push(saved);
    for (const f of faults) { const s = await dbCreateIssue(f); if (s) db.issues.push(s); }
  } else {
    db.inspections.push({ id: uid(), ...ins });
    faults.forEach(f => db.issues.push({ id: uid(), ...f }));
  }
  saveStore(); renderInspectionForm(); renderInspectionHistory(); renderIssues(); renderOverview();
  refreshCrossCutting();
  alert(passed ? "Inspection passed — all 10 points OK" : "Inspection recorded. Failed items have been added to Issues for AI prioritisation.");
});

document.getElementById("issueForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const i = { vehicleId: fd.vehicleId, title: fd.title.trim(), severity: fd.severity, status: "Open", createdAt: new Date().toISOString().slice(0, 10), source: "Manual" };
  if (window.FWMaintenance && FWMaintenance.createIssue) {
    const saved = await FWMaintenance.createIssue(i);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.issues.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateIssue(i);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.issues.push(saved);
  } else {
    db.issues.push({ id: uid(), ...i });
  }
  saveStore(); e.target.reset(); renderIssues(); renderOverview();
  refreshCrossCutting();
  toast("Issue logged.");
});

document.getElementById("reminderForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const r = { vehicleId: fd.vehicleId, task: fd.task, everyMonths: +fd.everyMonths, lastDate: fd.lastDate };
  if (window.FWMaintenance && FWMaintenance.createReminder) {
    const saved = await FWMaintenance.createReminder(r);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.reminders.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateReminder(r);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.reminders.push(saved);
  } else {
    db.reminders.push({ id: uid(), ...r });
  }
  saveStore(); e.target.reset(); renderReminders(); renderOverview();
  refreshCrossCutting();
  toast("Reminder saved.");
});

document.getElementById("partForm").addEventListener("submit", async e => {
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
  const dbBacked = typeof coreDbBacked === "function" && coreDbBacked();
  const existing = db.parts.find(p => p.name.toLowerCase() === partData.name.toLowerCase());
  if (window.FWMaintenance && FWMaintenance.savePart) {
    const saved = await FWMaintenance.savePart({ part: partData, existing });
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    if (existing) Object.assign(existing, saved.patch);
    else db.parts.push(saved);
  } else if (existing) {
    // Restocking (qty/minQty/name) always applies; other fields only overwrite
    // if actually filled in this time, so a quick re-add doesn't wipe vendor/
    // warranty/etc. already on file.
    const patch = {};
    Object.entries(partData).forEach(([k, v]) => {
      if (k === "qty" || k === "minQty" || k === "name") patch[k] = v;
      else if (v !== "" && v !== null) patch[k] = v;
    });
    if (dbBacked) {
      const ok = await dbUpdatePart(existing.id, patch);
      if (!ok) { toast("Could not save — check your connection and try again.", "err"); return; }
    }
    Object.assign(existing, patch);
  } else if (dbBacked) {
    const saved = await dbCreatePart(partData);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.parts.push(saved);
  } else {
    db.parts.push({ id: uid(), ...partData });
  }
  saveStore(); e.target.reset(); renderParts(); renderOverview();
  refreshCrossCutting();
  toast(existing ? "Part restocked." : "Part added.");
});

document.getElementById("fuelVehicleFilter").addEventListener("change", renderFuel);
// The header "Load Demo Fleet" button was removed (2026-08) — loadDemoFleet()
// itself stays: the auth gate's View Demo path and the old-dashboard store
// upgrade in renderAll still call it.

// ---- Documents ----
document.getElementById("docEntityType").addEventListener("change", fillDocEntitySelect);
document.getElementById("documentForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  if (!fd.entityId) { alert("Add a " + fd.entityType + " first, then attach the document."); return; }
  const d = {
    entityType: fd.entityType, entityId: fd.entityId,
    docType: fd.docType, number: fd.number.trim(),
    issueDate: fd.issueDate || null, expiryDate: fd.expiryDate, note: fd.note.trim()
  };
  if (window.FWMaintenance && FWMaintenance.createDocument) {
    const saved = await FWMaintenance.createDocument(d);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.documents.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateDocument(d);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.documents.push(saved);
  } else {
    db.documents.push({ id: uid(), ...d });
  }
  saveStore(); e.target.reset(); fillDocEntitySelect();
  renderDocuments(); renderRadar(); renderOverview();
  refreshCrossCutting();
  toast("Document saved.");
});

// ---- Tyre Manager ----
document.getElementById("tyreVehicleFilter").addEventListener("change", () => loadTyreManager());
document.getElementById("tyreFormVehicle").addEventListener("change", fillTyrePositions);
document.getElementById("addTyreFitVehicle")?.addEventListener("change", e => {
  const vid = e.target.value;
  const posBox = document.getElementById("addTyreFitPosition");
  const posSel = document.getElementById("addTyrePosSelect");
  if (!posBox || !posSel) return;
  posBox.hidden = !vid;
  if (vid) posSel.innerHTML = tyrePositions(vid).map(p => `<option>${p}</option>`).join("");
});

document.getElementById("tyreForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const t = {
    vehicleId: fd.vehicleId, position: fd.position,
    treadDepth: +fd.treadDepth, pressure: fd.pressure ? +fd.pressure : null,
    odo: fd.odo ? +fd.odo : null, date: fd.date
  };
  if (window.FWMaintenance && FWMaintenance.createTyreReading) {
    const saved = await FWMaintenance.createTyreReading(t);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.tyreReadings.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateTyreReading(t);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.tyreReadings.push(saved);
  } else {
    db.tyreReadings.push({ id: uid(), ...t });
  }
  saveStore(); e.target.reset();
  document.getElementById("tyreVehicleFilter").value = fd.vehicleId;
  loadTyreManager(); renderOverview();
  refreshCrossCutting();
  document.getElementById("tyreLogCard").hidden = true;
  toast("Tyre reading saved.");
});

document.getElementById("addTyreForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("addTyreErr");
  if (!window.fwCloud || !fwCloud.user()) { errEl.textContent = "Sign in to manage tyre inventory."; errEl.hidden = false; return; }
  const sb = fwCloud.sb();
  const fd = Object.fromEntries(new FormData(e.target));
  const org_id = fwCloud.user().id;
  const { data: tyre, error } = await sb.from("tyres").insert({
    org_id, serial_no: fd.serial_no||null, brand: fd.brand||null, size: fd.size||null,
    tyre_type: fd.tyre_type, new_tread_mm: +fd.new_tread_mm||14,
    purchase_cost: fd.purchase_cost ? +fd.purchase_cost : null,
    purchase_date: fd.purchase_date||null, purchase_odo: fd.purchase_odo ? +fd.purchase_odo : null,
    status: "stock"
  }).select().single();
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  const fitVehicleId = document.getElementById("addTyreFitVehicle")?.value;
  if (fitVehicleId) {
    const fitTread = document.getElementById("addTyreFitTread")?.value;
    await sb.from("tyre_fitments").insert({
      org_id, tyre_id: tyre.id, vehicle_id: fitVehicleId,
      position: document.getElementById("addTyrePosSelect")?.value || "",
      fitted_tread: fitTread ? +fitTread : (tyre.new_tread_mm || 14),
      fitted_date: new Date().toISOString().slice(0,10), is_current: true
    });
    await sb.from("tyres").update({ status: "fitted" }).eq("id", tyre.id);
  }
  closeAddTyreModal(); loadTyreManager(); toast("Tyre added.");
});

document.getElementById("fitTyreForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!window.fwCloud || !fwCloud.user()) return;
  const sb = fwCloud.sb();
  const org_id = fwCloud.user().id;
  const form = e.target;
  const vid = form.dataset.vid; const pos = form.dataset.position;
  const tyreId = document.getElementById("fitTyreSelect").value;
  const odo = document.getElementById("fitTyreOdo").value;
  const tread = document.getElementById("fitTyreTread").value;
  if (!tyreId) { toast("Select a tyre.", "err"); return; }
  await sb.from("tyre_fitments").insert({
    org_id, tyre_id: tyreId, vehicle_id: vid, position: pos,
    fitted_date: new Date().toISOString().slice(0,10),
    fitted_odo: odo ? +odo : null, fitted_tread: tread ? +tread : null, is_current: true
  });
  await sb.from("tyres").update({ status: "fitted" }).eq("id", tyreId);
  closeFitTyreModal(); loadTyreManager(); toast("Tyre fitted.");
});

document.getElementById("retreadForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!_retreadTyreId || !window.fwCloud || !fwCloud.user()) return;
  const sb = fwCloud.sb();
  const cost = +document.getElementById("retreadCost").value;
  const odo = document.getElementById("retreadOdo").value;
  const date = document.getElementById("retreadDate").value;
  // Remove from current vehicle
  await sb.from("tyre_fitments").update({ is_current: false, removed_date: date, removed_odo: odo ? +odo : null }).eq("tyre_id", _retreadTyreId).eq("is_current", true);
  // Update tyre record
  const tyre = _tyreData.tyres.find(t => t.id === _retreadTyreId);
  await sb.from("tyres").update({
    status: "retread_pending",
    retread_count: (tyre?.retread_count || 0) + 1,
    last_retread_date: date, last_retread_odo: odo ? +odo : null, last_retread_cost: cost
  }).eq("id", _retreadTyreId);
  closeRetreadModal(); loadTyreManager(); toast("Sent for retread.");
});

// ---- Settings ----
document.getElementById("settingsForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.settings = {
    businessName: fd.businessName.trim(), gstin: fd.gstin.trim(), city: fd.city.trim(),
    ownerPhone: (fd.ownerPhone || "").replace(/\D/g, "").slice(0, 10) || undefined,
    ownerUpi: (fd.ownerUpi || "").trim() || undefined,
    warnDays: +fd.warnDays, minTread: fd.minTread ? +fd.minTread : null,
    mileageDropPct: fd.mileageDropPct ? +fd.mileageDropPct : null
  };
  saveStore(); renderRadar(); renderTyres(); renderOverview();
  refreshCrossCutting();
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
  if (!confirmDestructive("Remove the sample demo fleet? Your own added records stay.")) return;
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

function tabButtonFor(tabName, preferredBtn) {
  if (preferredBtn && preferredBtn.dataset && preferredBtn.dataset.tab === tabName) return preferredBtn;
  const buttons = [...document.querySelectorAll("#tabBar .tab-btn")].filter(b => b.dataset.tab === tabName);
  if (!buttons.length) return null;
  const visibleWorkspaceButtons = buttons.filter(b => {
    const ws = b.closest("[data-ws]");
    return !ws || !ws.hidden;
  });
  // Deep links should prefer the global nav item when a workspace has a
  // duplicate data-tab, e.g. FleetFin "Add Entry" and global "My Account".
  return visibleWorkspaceButtons.find(b => !b.closest("[data-ws]")) ||
    visibleWorkspaceButtons[0] ||
    buttons.find(b => !b.closest("[data-ws]")) ||
    buttons[0];
}

function activateTab(tabName, options = {}) {
  const btn = tabButtonFor(tabName, options.button);
  if (!btn) return false;
  // Radar presets (Vehicle/Driver Renewals, Warranties) pre-filter the Radar
  if (btn.dataset.radar !== undefined) { radarFilter = btn.dataset.radar || "all"; renderRadar(); }
  // scoped to the sidebar / top-level panels so the My Account inner tabs are untouched
  document.querySelectorAll("#tabBar .tab-btn").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll("#fleetContent > .tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + tabName));
  const title = document.getElementById("pageTitle");
  if (title) title.textContent = (btn.textContent || "").trim();
  document.getElementById("appSide")?.classList.remove("open");
  clearPageSearch();
  updateToolbarCounts();
  const hashTarget = tabName || "home";
  const method = options.replaceHistory ? "replaceState" : "replaceState";
  history[method](null, "", "#" + hashTarget);
  // switch workspace to wherever the clicked tab lives (hub, deep link, or sidebar)
  if (tabName === "home") setWorkspace("home");
  else { const w = btn.closest("[data-ws]"); if (w) setWorkspace(w.dataset.ws); }
  // Home & My Account work even with an empty fleet. Signed-in owners never
  // see the demo prompt — they get the Getting Started landing instead.
  if (!db.vehicles.length) {
    const exempt = tabName === "account" || tabName === "home" || tabName === "addvehicle"
                || tabName === "sites" || tabName === "smsnotif" || tabName === "purchaseinvoices";
    const signedIn = !!(window.fwCloud && fwCloud.user());
    document.getElementById("emptyState").hidden = exempt || signedIn;
    const startEl = document.getElementById("startState");
    if (startEl) startEl.hidden = exempt || !signedIn;
    document.getElementById("fleetContent").hidden = !exempt;
  }
  if (tabName === "account"   && window.renderAuthState) renderAuthState();
  if (tabName === "map"       && window.renderFleetMap)  renderFleetMap();
  if (tabName === "fin"       && window.renderGfFin)     renderGfFin();
  if (tabName === "analytics" && window.renderGfIq)      renderGfIq();
  if (tabName === "smsnotif")        renderNotifSettings();
  if (tabName === "sites")           { loadSites().then(() => { renderSites(); renderHubSites(); }); }
  if (tabName === "purchaseinvoices") renderPurchaseInvoices();
  if (tabName === "trips") { renderTrips(); loadActiveTripWorkflow(); }
  if (tabName === "tyres") loadTyreManager();
  if (tabName === "opscentre") loadOpsCentre(); else stopOpsCentre();
  if (tabName === "safety") loadSafety();
  if (tabName === "fleetview") loadFleetView();
  if (tabName === "fueldash") loadFuelDash();
  if (tabName === "insuredash" || tabName === "policies" || tabName === "claims") loadInsure();
  return true;
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
  activateTab(btn.dataset.tab, { replaceHistory: true, button: btn });
});

function activateTabFromHash() {
  const hash = (location.hash || "").replace(/^#/, "").trim();
  if (!hash) return false;
  return activateTab(hash, { replaceHistory: true });
}

window.addEventListener("hashchange", () => {
  activateTabFromHash();
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
  mk("map", `<div class="chart-card">
    <div class="chart-head"><div>
      <h2 class="head-ic"><span class="ic-tile brand"><i data-icon="mapPin" data-icon-size="22"></i></span> Fleet Map</h2>
      <p class="muted">Vehicles plotted by Base Depot / City — set it on a vehicle (Add Vehicle or Vehicle List) to place it here. Live GPS tracking is a future telematics integration.</p>
    </div></div>
    <div id="fleetMapEl" style="height:480px;border-radius:12px;overflow:hidden"></div>
    <div id="fleetMapUnmatched" class="muted" style="margin-top:10px;font-size:0.85rem"></div>
  </div>`);
  mk("assignments", panelCard("Vehicle Assignments", "Which driver operates which vehicle right now", "assignTable"));
  mk("meters", panelCard("Meter History", "Odometer readings captured with every fuel fill, newest first", "meterTable"));
  mk("expensehistory", `<div class="chart-card">
    <div class="chart-head"><div>
      <h2 class="head-ic"><span class="ic-tile brand"><i data-icon="shieldCheck" data-icon-size="22"></i></span> Expense Approvals</h2>
      <p class="muted">Expenses submitted by your team (Team &amp; Access) wait here — nothing posts to your books until you approve it.</p>
    </div></div>
    <div class="chart-scroll"><div id="expenseApprovalsTable"></div></div>
  </div>` + panelCard("Expense History", "Every expense entry across the fleet, newest first", "expHistTable"));
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
  // ---------- Invoices ----------
  // The revenue side, built like the bill book on the other side of it: one
  // form, item rows, then a list. gstbills captures what the fleet pays; this
  // is what it bills for.
  mk("invoices", `<section class="stat-row" id="invoiceTiles"></section>
  <div class="chart-card">
    <div class="chart-head"><div>
      <h2 class="head-ic"><span class="ic-tile brand"><i data-icon="document" data-icon-size="22"></i></span> Raise a Freight Invoice</h2>
      <p class="muted">Bill a consignor for a trip or a month's work. Reverse charge is the default, because that is how most goods transport is billed &mdash; change it if you charge GST yourself.</p>
    </div></div>
    <form id="invoiceForm" class="entry-form">
      <div class="form-row">
        <label>Invoice No<input type="text" name="invoiceNo" required maxlength="40" /></label>
        <label>Date<input type="date" name="invoiceDate" required /></label>
        <label>LR / Consignment No<input type="text" name="lrNo" maxlength="40" placeholder="optional" /></label>
      </div>
      <div class="form-row">
        <label>Pick a saved customer<select name="invParty" id="invParty"></select></label>
      </div>
      <div class="form-row">
        <label>Bill to (customer)<input type="text" name="customerName" required maxlength="120" placeholder="e.g. Sri Balaji Steels Pvt Ltd" /></label>
        <label>Customer GSTIN<input type="text" name="customerGstin" maxlength="15" style="text-transform:uppercase" placeholder="blank if unregistered" /></label>
      </div>
      <div class="form-row">
        <label>Customer address<input type="text" name="customerAddress" maxlength="200" placeholder="optional" /></label>
        <label>Place of supply (state code)<input type="text" name="placeOfSupply" maxlength="2" inputmode="numeric" placeholder="e.g. 33 — only if no GSTIN" /></label>
      </div>
      <div class="form-row">
        <label>Vehicle<select name="vehicleId" id="invVehicle"></select></label>
        <label>Tax treatment
          <select name="taxTreatment">
            <option value="rcm">Reverse charge — recipient pays GST</option>
            <option value="forward_5">5% GST (no input credit)</option>
            <option value="forward_12">12% GST (with input credit)</option>
            <option value="forward_18">18% GST</option>
            <option value="exempt">Exempt / nil rated</option>
          </select>
        </label>
      </div>
      <datalist id="invItemList"></datalist>
      <div id="invLines"></div>
      <button type="button" class="link-btn" id="invAddLine">+ Add line</button>
      <div id="invTotals" style="margin:10px 0"></div>
      <label>Notes<input type="text" name="notes" maxlength="200" placeholder="optional — payment terms, remarks" /></label>
      <p class="field-error" id="invoiceErr" hidden></p>
      <button type="submit" class="btn btn-primary"><i data-icon="check" data-icon-size="16"></i> Save as Draft</button>
    </form>
    <p class="disclaimer">FleetWorks records what you invoiced; it is not a substitute for your accountant or for e-invoicing where that applies to your turnover.</p>
  </div>
  <div class="chart-card"><div class="chart-head"><div><h2>Invoices raised</h2><p class="muted">Draft until you issue it; issued until the money lands.</p></div></div>
    <div class="chart-scroll"><div id="invoiceList"></div></div></div>

  <div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile info"><i data-icon="network" data-icon-size="22"></i></span> Customers &amp; Parties</h2>
      <p class="muted">Saved once, picked on every invoice &mdash; so one customer's GSTIN and state are never typed two different ways.</p></div></div>
    <form id="partyForm" class="entry-form">
      <div class="form-row">
        <label>Name<input type="text" name="name" required maxlength="120" placeholder="e.g. Sri Balaji Steels Pvt Ltd" /></label>
        <label>GSTIN<input type="text" name="gstin" maxlength="15" style="text-transform:uppercase" placeholder="blank if unregistered" /></label>
        <label>State code (if no GSTIN)<input type="text" name="stateCode" maxlength="2" inputmode="numeric" placeholder="e.g. 33" /></label>
      </div>
      <div class="form-row">
        <label>Billing address<input type="text" name="billingAddress" maxlength="200" /></label>
        <label>Phone<input type="tel" name="phone" maxlength="15" /></label>
        <label>Email<input type="email" name="email" maxlength="120" /></label>
      </div>
      <div class="form-row">
        <label>Credit limit (&#8377;)<input type="number" name="creditLimit" min="0" /></label>
        <label>Credit days<input type="number" name="creditDays" min="0" max="365" /></label>
        <label>Usual tax treatment
          <select name="defaultTax">
            <option value="">Ask each time</option>
            <option value="rcm">Reverse charge</option>
            <option value="forward_5">5% GST</option>
            <option value="forward_12">12% GST</option>
            <option value="forward_18">18% GST</option>
            <option value="exempt">Exempt</option>
          </select>
        </label>
      </div>
      <div class="form-row">
        <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="isCustomer" checked /> We invoice them</label>
        <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="isSupplier" /> They invoice us</label>
      </div>
      <p class="field-error" id="partyErr" hidden></p>
      <button type="submit" class="btn btn-primary">Save Customer</button>
    </form>
    <div class="chart-scroll" style="margin-top:14px"><div id="partyList"></div></div>
  </div>

  <div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile success"><i data-icon="wrench" data-icon-size="22"></i></span> Services &amp; Items You Bill</h2>
      <p class="muted">Freight, detention, loading, workshop work &mdash; with its SAC or HSN code and rate, so an invoice line is one keystroke.</p></div></div>
    <form id="itemForm" class="entry-form">
      <div class="form-row">
        <label>Name<input type="text" name="name" required maxlength="120" placeholder="e.g. Freight — Chennai to Salem" /></label>
        <label>Type
          <select name="kind"><option value="service">Service</option><option value="goods">Goods</option></select>
        </label>
        <label>HSN / SAC<input type="text" name="hsnSac" maxlength="10" placeholder="996511 for road freight" /></label>
      </div>
      <div class="form-row">
        <label>Unit
          <input type="text" name="unit" list="unitList" maxlength="12" placeholder="Trip" />
          <datalist id="unitList"><option value="Trip"></option><option value="MT"></option><option value="KM"></option><option value="Hour"></option><option value="Day"></option><option value="Nos"></option></datalist>
        </label>
        <label>Rate (&#8377;)<input type="number" name="rate" min="0" step="any" /></label>
        <label>GST rate (%)
          <select name="gstRate"><option value="0">0 / exempt</option><option value="5">5</option><option value="12">12</option><option value="18">18</option><option value="28">28</option></select>
        </label>
      </div>
      <p class="field-error" id="itemErr" hidden></p>
      <button type="submit" class="btn btn-primary">Save Item</button>
    </form>
    <div class="chart-scroll" style="margin-top:14px"><div id="itemList"></div></div>
  </div>`);

  mk("gstbills", `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile success"><i data-icon="receipt" data-icon-size="22"></i></span> Bill Capture &amp; GST</h2><p class="muted">Snap the workshop bill — FleetWorks reads the amount, date and GSTIN on your phone, and tracks your input-tax credit</p></div></div>
    <div class="settings-actions">
      <button type="button" class="btn btn-primary" id="billCamBtn"><i data-icon="receipt" data-icon-size="16"></i> Scan with Camera</button>
      <button type="button" class="btn btn-primary" id="billUploadBtn"><i data-icon="download" data-icon-size="16"></i> Upload Bill File</button>
      <button type="button" class="btn btn-outline" id="billManualBtn">Enter Manually</button>
      <input type="file" id="billCam" accept="image/*" capture="environment" hidden />
      <input type="file" id="billFile" accept="image/*,application/pdf" hidden />
      <span class="muted" id="billScanStatus"></span>
    </div>
    <form id="billForm" class="entry-form" hidden>
      <label>Expense title
        <input type="text" name="title" placeholder="e.g. Brake overhaul — TN-01, Annai Auto Works" />
      </label>
      <div class="form-row">
        <label>Vehicle<select name="vehicleId" id="billVehicle" required></select></label>
        <label>Date<input type="date" name="date" required /></label>
      </div>
      <div class="form-row">
        <label>Category
          <input type="text" name="category" list="expenseCategoryList" required maxlength="60"
            placeholder="e.g. Tyre Puncture, DEF, RTO — or type a new one" />
        </label>
        <label>Amount (&#8377;)<input type="number" name="amount" min="1" required inputmode="numeric" /></label>
      </div>
      <div class="form-row">
        <label>Vendor / Workshop name<input type="text" name="vendor" placeholder="e.g. Annai Auto Works" /></label>
        <label>Vendor GSTIN (blank = non-GST bill)<input type="text" name="gstin" maxlength="15" style="text-transform:uppercase" /></label>
        <label>Bill No (optional)<input type="text" name="billNo" /></label>
      </div>
      <div id="billItems"></div>
      <button type="button" class="link-btn" id="billAddItem">+ Add item row</button>
      <button type="submit" class="btn btn-primary"><i data-icon="check" data-icon-size="16"></i> Confirm &amp; Save Bill</button>
    </form>
    <p class="disclaimer">First scan downloads the free open-source reader (RapidOCR / PP-OCRv4, ~16 MB, one time). Bill photos never leave your phone — OCR runs entirely in your browser.</p>
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
  // ---------- Toll & FASTag ----------
  // Replaces the old "arrives with telematics" placeholder. The expensive
  // problem here needs no integration: a truck reaching a plaza short of
  // balance pays roughly double and loses the time arguing, and the owner hears
  // about it from the driver, at the plaza.
  mk("toll", `<section class="stat-row" id="fastagStats"></section>
  <div class="chart-card">
    <div class="chart-head">
      <div>
        <h2 class="head-ic"><span class="ic-tile brand"><i data-icon="mapPin" data-icon-size="22"></i></span> Toll &amp; FASTag</h2>
        <p class="muted">Balance per vehicle, and how long it will last at that truck&rsquo;s own toll spend. Update the balance whenever you recharge or check the app — days remaining is worked out from your recharge history, not a guess.</p>
      </div>
    </div>
    <form id="fastagForm" class="entry-form" style="margin-bottom:14px">
      <div class="form-row">
        <label>Vehicle<select name="vehicleId" id="fastagVehicle" required></select></label>
        <label>Tag ID (optional)<input type="text" name="tagId" placeholder="NETC tag number" maxlength="40" /></label>
      </div>
      <div class="form-row">
        <label>Issuing bank
          <input type="text" name="bank" list="fastagBankList" placeholder="e.g. Airtel Payments Bank, ICICI, Bank of Baroda" maxlength="40" />
          <datalist id="fastagBankList">
            <option value="Airtel Payments Bank"></option><option value="ICICI Bank"></option><option value="Bank of Baroda"></option>
            <option value="HDFC Bank"></option><option value="IDFC FIRST Bank"></option><option value="State Bank of India"></option>
            <option value="Axis Bank"></option><option value="Kotak Mahindra Bank"></option><option value="IndusInd Bank"></option>
            <option value="Federal Bank"></option><option value="Union Bank of India"></option><option value="Punjab National Bank"></option>
            <option value="Canara Bank"></option><option value="Bank of Maharashtra"></option><option value="Indian Bank"></option>
            <option value="IDBI Bank"></option><option value="Yes Bank"></option><option value="UCO Bank"></option>
            <option value="Karnataka Bank"></option><option value="Karur Vysya Bank"></option><option value="City Union Bank"></option>
            <option value="Equitas Small Finance Bank"></option><option value="AU Small Finance Bank"></option><option value="Fino Payments Bank"></option>
            <option value="Jammu & Kashmir Bank"></option><option value="Saraswat Bank"></option><option value="Transcorp"></option>
            <option value="LivQuik"></option>
          </datalist>
        </label>
        <label>Current balance (₹)<input type="number" name="balance" min="0" step="1" required placeholder="e.g. 4500" /></label>
      </div>
      <div class="form-row">
        <label>Warn me below (₹)<input type="number" name="lowThreshold" min="0" value="1000" /></label>
        <button type="submit" class="btn btn-primary" style="align-self:end">Save balance</button>
      </div>
      <p class="field-error" id="fastagErr" hidden></p>
    </form>
    <div class="chart-scroll"><div id="fastagTable"></div></div>
  </div>`);

  mk("purchaseorders", `<div class="chart-card">
    <div class="chart-head">
      <div><h2 class="head-ic"><span class="ic-tile brand"><i data-icon="receipt" data-icon-size="22"></i></span> Purchase Orders</h2>
      <p class="muted">Raise spare-part purchase orders against vendors — tracked from draft to delivery and posted to accounts on receipt.</p></div>
      <button class="btn btn-primary" onclick="openNewPO()">${FWIcon("plus",{size:14})} New PO</button>
    </div>
    <div id="poList"></div>
  </div>`);

  mk("purchaseinvoices", `<div class="chart-card">
    <div class="chart-head">
      <div><h2 class="head-ic"><span class="ic-tile success"><i data-icon="receipt" data-icon-size="22"></i></span> Purchase Invoices</h2>
      <p class="muted">Vendor invoices created when PO materials are received. Toggle payment status as you settle each bill.</p></div>
    </div>
    <div id="purchaseInvoiceList"></div>
  </div>`);

  mk("sites", `<div class="chart-card">
    <div class="chart-head">
      <div><h2 class="head-ic"><span class="ic-tile brand"><i data-icon="mapPin" data-icon-size="22"></i></span> Sites &amp; Projects</h2>
      <p class="muted">Create sites, depots and projects — assign trucks, managers and supervisors. Vehicles show up on the Status Board with their site and supervisor.</p></div>
      <button class="btn btn-primary" onclick="openNewSite()">${FWIcon("plus",{size:14})} New Site</button>
    </div>
    <div id="sitesList"></div>
  </div>`);

  mk("dispatch", `<div class="chart-card">
    <div class="chart-head" style="flex-wrap:wrap;gap:10px">
      <div><h2 class="head-ic"><span class="ic-tile brand"><i data-icon="calendar" data-icon-size="22"></i></span> Daily Dispatch</h2>
      <p class="muted">Assign drivers and set movement status for each vehicle — Planned, Running, Halt or Maintenance. Updated by supervisors throughout the day.</p></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="date" id="dispatchDate" value="${new Date().toISOString().slice(0,10)}" onchange="loadDispatch()" style="height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);padding:0 8px;font-size:0.85rem" />
        <button class="btn btn-primary" onclick="dispatchPlanAll()">${FWIcon("plus",{size:14})} Plan All Vehicles</button>
      </div>
    </div>
    <div id="dispatchSummary" style="display:flex;gap:10px;flex-wrap:wrap;padding:0 0 12px"></div>
    <div id="dispatchBoard"></div>
  </div>`);

  mk("smsnotif", `<div class="chart-card">
    <div class="chart-head">
      <div>
        <h2 class="head-ic"><span class="ic-tile brand"><i data-icon="bell" data-icon-size="22"></i></span> SMS Notifications</h2>
        <p class="muted">Choose which events trigger an SMS to the owner's mobile. Requires MSG91 account — register at msg91.com and add your API key in Supabase Edge Function secrets.</p>
      </div>
      <button class="btn btn-outline" onclick="saveNotifSettings('tab')">Save</button>
    </div>
    <div id="smsnotifTabBody" style="padding:4px 0 8px"></div>
  </div>`);

  [
    ["faults", "Faults", "Engine fault codes surface here automatically with the OBD / telematics integration.", "alert"],
    ["invoices", "Invoices", "Customer and vendor invoices arrive with the billing module.", "document"],
    ["def", "DEF / AdBlue", "DEF consumption and cost-per-km tracking for BS6 vehicles is on the way.", "spray"],
    ["recalls", "Recalls", "Manufacturer recall tracking for your vehicle makes is on the way.", "bell"],
    ["charging", "EV Charging", "Charging sessions, kWh and cost per km arrive with the EV module.", "charge"],
    ["places", "Places", "Saved depots, customer sites and geofences arrive with the GPS integration.", "mapPin"],
    // purchaseorders is a live feature — panel built above via mk("purchaseorders",...)
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
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Odometer</th><th>Since last</th><th></th></tr></thead><tbody>` +
    rows.map(f => {
      const fills = vehicleFills(f.vehicleId);
      const i = fills.findIndex(x => x.id === f.id);
      const delta = i > 0 ? f.odo - fills[i - 1].odo : null;
      return `<tr><td>${fmtDate(f.date)}</td><td><strong>${esc(vName(f.vehicleId))}</strong></td><td>${f.odo.toLocaleString("en-IN")} km</td><td>${delta ? "+" + delta.toLocaleString("en-IN") + " km" : "<span class='muted'>—</span>"}</td><td><button class="link-btn" onclick="openEditFuelLog('${f.id}')">Edit</button></td></tr>`;
    }).join("") + "</tbody></table>" : "<p class='muted'>Meter readings appear as you log fuel fills.</p>";
}
function openEditFuelLog(id) {
  const f = db.fuelLogs.find(x => x.id === id);
  if (!f) return;
  openEditModal("Edit Fuel Entry", `
    <div class="form-row">
      <label>Vehicle<select name="vehicleId" required>${vehicleOptionsHtml(f.vehicleId)}</select></label>
      <label>Date<input type="date" name="date" value="${f.date || ""}" required /></label>
    </div>
    <div class="form-row">
      <label>Litres<input type="number" name="litres" min="0" step="0.01" value="${f.litres}" required /></label>
      <label>Amount (&#8377;)<input type="number" name="amount" min="0" value="${f.amount}" required /></label>
    </div>
    <label>Odometer (km)<input type="number" name="odo" min="0" value="${f.odo}" required /></label>`, async fd => {
    const patch = { vehicleId: fd.vehicleId, date: fd.date, litres: +fd.litres, amount: +fd.amount, odo: +fd.odo };
    if (typeof coreDbBacked === "function" && coreDbBacked()) {
      const ok = await dbUpdateFuelLog(f.id, patch);
      if (!ok) throw new Error("Could not save — check your connection and try again.");
    }
    Object.assign(f, patch);
    saveStore(); renderFuel(); renderMeters(); renderOverview();
    closeEditModal(); toast("Fuel entry updated.");
  });
}
// ---------- Expense Approvals (Team & Access submissions) ----------
// Supervisors/managers/drivers can no longer write expenses directly
// (db/schema-expense-approvals.sql) — every submission lands in
// expense_change_requests as 'pending'. Only the owner can approve (which
// creates the real expense row) or reject (discards it, nothing posted).
async function renderExpenseApprovals() {
  const el = document.getElementById("expenseApprovalsTable");
  if (!el) return;
  if (!(window.fwCloud && fwCloud.user())) { el.innerHTML = "<p class='muted'>Sign in to review team submissions.</p>"; return; }
  const org = await (window.getMyOrgId ? getMyOrgId() : null);
  if (!org) { el.innerHTML = "<p class='muted'>No organization found yet.</p>"; return; }
  const rows = await fwCloud.authGet("expense_change_requests", `select=*&org_id=eq.${org}&status=eq.pending&order=created_at.asc&limit=200`);
  if (rows === null) { el.innerHTML = "<p class='muted'>Needs <code>db/schema-expense-approvals.sql</code> run once in Supabase.</p>"; return; }
  if (!rows.length) { el.innerHTML = "<p class='muted'>Nothing pending — your team's submissions will appear here.</p>"; return; }
  el.dataset.rows = JSON.stringify(rows);
  el.innerHTML = `<table class="chart-table-el"><thead><tr><th>Submitted</th><th>Vehicle</th><th>Category</th><th>Amount</th><th></th></tr></thead><tbody>` +
    rows.map(r => {
      const v = db.vehicles.find(x => x.dbId === r.vehicle_id);
      const p = r.patch || {};
      return `<tr><td>${fmtDate(r.created_at)}</td><td><strong>${esc(v ? v.name : "—")}</strong></td>
        <td>${esc(p.category || "")}</td><td>${fmtINR(p.amount || 0)}</td>
        <td style="white-space:nowrap">
          <button class="link-btn" onclick="approveExpenseRequest('${r.id}')">${FWIcon("check", { size: 14 })} Approve</button>
          <button class="link-btn" style="color:#b91c1c" onclick="rejectExpenseRequest('${r.id}')">Reject</button>
        </td></tr>`;
    }).join("") + "</tbody></table>";
}
function findExpenseRequest(id) {
  const el = document.getElementById("expenseApprovalsTable");
  try { return JSON.parse(el.dataset.rows || "[]").find(r => r.id === id) || null; } catch { return null; }
}
window.approveExpenseRequest = async function (id) {
  const r = findExpenseRequest(id);
  if (!r) return;
  if (!confirmDestructive("Approve this expense? It will post to your books and cannot be un-approved.")) return;
  const v = db.vehicles.find(x => x.dbId === r.vehicle_id);
  const p = r.patch || {};
  const row = {
    org_id: r.org_id, vehicle_id: r.vehicle_id, expense_date: p.expense_date || new Date().toISOString().slice(0, 10),
    category: p.category, amount: p.amount, title: p.title || null, vendor: p.vendor || null,
    gstin: p.gstin || null, bill_no: p.billNo || null, items: p.items && p.items.length ? p.items : null,
  };
  const created = await fwCloud.authInsertRet("expenses", row);
  if (!created) { toast("Could not approve — check your connection and try again.", "err"); return; }
  const ok = await fwCloud.authPatch(`expense_change_requests?id=eq.${id}`, { status: "approved", decided_by: fwCloud.uid(), decided_at: new Date().toISOString() });
  if (!ok) { toast("Expense posted, but could not mark the request approved — check your connection.", "err"); }
  db.expenses.push({
    id: created.id, vehicleId: v ? v.id : "", date: created.expense_date, category: created.category, amount: created.amount,
    title: created.title || undefined, vendor: created.vendor || undefined, gstin: created.gstin || undefined, billNo: created.bill_no || undefined,
  });
  saveStore(); renderExpenseApprovals(); renderExpenseHistory(); renderOverview();
  toast("Expense approved and posted.");
};
window.rejectExpenseRequest = async function (id) {
  if (!confirmDestructive("Reject this expense submission? It will not be posted, and cannot be undone.")) return;
  const ok = await fwCloud.authPatch(`expense_change_requests?id=eq.${id}`, { status: "rejected", decided_by: fwCloud.uid(), decided_at: new Date().toISOString() });
  if (!ok) { toast("Could not reject — check your connection and try again.", "err"); return; }
  renderExpenseApprovals();
  toast("Submission rejected.");
};

function renderExpenseHistory() {
  const el = document.getElementById("expHistTable");
  if (!el) return;
  const rows = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  if (!rows.length) { el.innerHTML = "<p class='muted'>No expenses recorded yet.</p>"; return; }
  el.innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Expense</th><th>Amount</th><th>Actions</th></tr></thead><tbody>` +
    rows.map(e => {
      const i = db.expenses.indexOf(e);
      const linkedPo = _poByExpId[e.id];
      const poLink = linkedPo
        ? `<br><button class="link-btn" onclick="viewExpensePO('${linkedPo.id}')" style="font-size:0.75rem">${FWIcon("receipt",{size:11})} PO: ${esc(linkedPo.po_number)} →</button>`
        : "";
      const titleCell = e.title
        ? `<strong>${esc(e.title)}</strong><br /><span class="muted">${esc(e.category)}</span>${poLink}`
        : `${esc(e.category)}${poLink}`;
      return `<tr data-expense-id="${e.id || ""}">
        <td>${fmtDate(e.date)}</td>
        <td><strong>${esc(vName(e.vehicleId))}</strong></td>
        <td>${titleCell}</td>
        <td>₹${fmtINR(e.amount)}</td>
        <td style="white-space:nowrap">
          ${linkedPo ? "" : `<button class="link-btn" onclick="fwGoEditBill(${i})">Edit</button> `}
          <button class="link-btn" style="color:#b91c1c" onclick="fwDeleteBill(${i})">Delete</button>
        </td></tr>`;
    }).join("") +
    "</tbody></table>";
}
// jump from Expense History to the bill editor (gstbills tab)
function fwGoEditBill(i) {
  document.querySelector('#tabBar .tab-btn[data-tab="gstbills"]')?.click();
  if (window.fwEditBill) fwEditBill(i);
}
async function fwDeleteBill(i) {
  const e = db.expenses[i];
  if (!e) return;
  if (!confirmDestructive(`Delete this expense?\n\n${fmtDate(e.date)} · ${vName(e.vehicleId)} · ${e.title || e.category} · ${fmtINR(e.amount)}`)) return;
  if (typeof coreDbBacked === "function" && coreDbBacked() && e.id) {
    const ok = await dbDeleteExpense(e.id);
    if (!ok) { toast("Could not delete — check your connection and try again.", "err"); return; }
  }
  db.expenses.splice(i, 1);
  saveStore(); renderAll();
  toast("Expense deleted.");
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
  const exempt = activeId === "tab-home" || activeId === "tab-account" || activeId === "tab-addvehicle"
              || activeId === "tab-sites" || activeId === "tab-smsnotif";
  // Signed-in owners with an empty fleet get the Getting Started landing,
  // never the demo prompt — their account starts clean.
  const signedIn = !!(window.fwCloud && fwCloud.user());
  const startEl = document.getElementById("startState");
  if (startEl) startEl.hidden = has || exempt || !signedIn;
  document.getElementById("emptyState").hidden = has || exempt || signedIn;
  document.getElementById("fleetContent").hidden = !(has || exempt);
  fillDriverSelect();
  if (!has) { renderGettingStarted(); return; }
  // demo store from the dashboard may lack fleet-manager collections — extend it once
  if (!signedIn && db.demo !== true && db.vehicles.length && !db.fuelLogs.length && db.expenses.length && db.vehicles[0].id === "v1" && !db.vehicles[0].compliance) {
    loadDemoFleet(); return;
  }
  fillVehicleSelects();
  renderExpenseCategoryList();
  renderOverview(); renderVehicles(); renderDrivers(); renderFuel();
  renderInspectionForm(); renderInspectionHistory();
  renderIssues(); renderWorkOrders(); renderReminders(); renderParts();
  renderRadar(); renderDocuments(); renderTyres(); renderSettings();
  renderAssignments(); renderMeters(); renderExpenseHistory(); renderExpenseApprovals(); renderReplacement();
  renderItemFailures(); renderForms(); renderServiceHistory(); renderServiceTasks();
  renderFastag();
  renderPurchaseOrders(); renderPurchaseInvoices();
  renderNotifSettings(); renderSites(); renderHubSites(); renderVehicleStatusBoard();
  populateFilterDropdowns();
  renderDispatch();
  renderVendors(); renderIntegrations(); renderReports();
  if (window.renderAnalyticsAll) renderAnalyticsAll();
  if (window.renderGfDash) renderGfDash();
  if (window.renderAccountPortal) renderAccountPortal();
  if (window.renderTeamPicker) renderTeamPicker();
  if (window.renderPayroll) renderPayroll();
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

// Startup for the expense-category list and Toll & FASTag. These must run after
// buildDynamicPanels(), which is what creates #fastagForm and #fastagVehicle —
// binding or rendering before the panel exists silently does nothing.
loadExpenseCategories();
bindFastagForm();
bindFinFastagForm();
loadFastag();
loadPOs();
loadSites();
loadDispatch();

// Trips & khata entry forms (panels are built dynamically above)
document.getElementById("tripForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const t = { vehicleId: fd.vehicleId, date: fd.date, from: fd.from.trim(), to: fd.to.trim(), freight: +fd.freight, km: fd.km ? +fd.km : null };
  if (window.FWFleetFin && FWFleetFin.createTrip) {
    const saved = await FWFleetFin.createTrip(t);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.trips.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateTrip(t);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.trips.push(saved);
  } else {
    db.trips.push({ id: uid(), ...t });
  }
  saveStore(); e.target.reset(); renderAll();
  toast("Trip saved.");
});
document.getElementById("khataForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const l = { driverId: fd.driverId, date: fd.date, type: fd.type, amount: +fd.amount, note: (fd.note || "").trim() };
  if (window.FWFleetFin && FWFleetFin.createLedgerEntry) {
    const saved = await FWFleetFin.createLedgerEntry(l);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.driverLedger.push(saved);
  } else if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateLedgerEntry(l);
    if (!saved) { toast("Could not save — check your connection and try again.", "err"); return; }
    db.driverLedger.push(saved);
  } else {
    db.driverLedger.push({ id: uid(), ...l });
  }
  saveStore(); e.target.reset(); renderAll();
  toast("Khata entry saved.");
});

// Add Vehicle page (FleetOps main)
document.getElementById("addVehForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (vehicleEditId) {
    const id = vehicleEditId;
    const v = await updateVehicleInPlace(e.target, id);
    resetVehicleFormToAddMode();
    if (!v) return;
    toast("Vehicle updated.");
    document.querySelector('#tabBar .tab-btn[data-tab="vehicles"]')?.click();
    return;
  }
  const v = await saveNewVehicle(e.target);
  if (!v) return;
  e.target.reset();
  alert(v.name + " added to your fleet.\n\nNext: log a diesel fill or an expense and FleetWorks AI starts learning immediately.");
  document.querySelector('#tabBar .tab-btn[data-tab="vehicles"]')?.click();
});
document.getElementById("avSaveAdd")?.addEventListener("click", async () => {
  if (vehicleEditId) return; // "Save & Add Another" is hidden during edit; this is a defensive no-op
  const form = document.getElementById("addVehForm");
  if (!form.reportValidity()) return;
  const v = await saveNewVehicle(form);
  if (!v) return;
  form.reset();
  const s = document.createElement("p");
  s.className = "muted";
  s.textContent = v.name + " saved — add the next one.";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});

// A signed-in owner never inherits demo data — their account starts clean.
function clearDemoForOwner() {
  if (db.demo === true && window.fwCloud && fwCloud.user()) {
    db = { vehicles: [], expenses: [], fuelLogs: [], inspections: [], issues: [], reminders: [],
      parts: [], drivers: [], workOrders: [], documents: [], tyreReadings: [],
      settings: db.settings || {}, trips: [], driverLedger: [], demo: false };
    saveStore();
    renderAll();
    return true;
  }
  return false;
}
// hide the demo loader for real accounts
function syncDemoButton() {
  const b = document.getElementById("demoBtn");
  if (b) b.hidden = !!(window.fwCloud && fwCloud.user());
}
clearDemoForOwner();
syncDemoButton();

renderAll();
activateTabFromHash();

// Home hub cards open their workspace and land on its dashboard
document.querySelectorAll(".hub-card").forEach(c => c.addEventListener("click", () => {
  const target = { ops: "overview", fin: "fin", iq: "analytics",
                   safe: "fleetview", insure: "insuredash" }[c.dataset.hub];
  document.querySelector(`#tabBar .tab-btn[data-tab="${target}"]`)?.click();
}));
if (!activateTabFromHash()) setWorkspace("home");

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
      <a class="btn btn-outline" href="tel:+919444960009">${FWIcon("phone", { size: 15 })} Call Helpline</a>
      <button type="button" class="btn btn-primary" id="sosSend">${FWIcon("alert", { size: 15 })} Send SOS on WhatsApp</button>
    </div>
    <button type="button" class="link-btn sos-close" id="sosClose">Close</button>
  </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById("sosClose").addEventListener("click", () => wrap.remove());
  document.getElementById("sosSend").addEventListener("click", async () => {
    const vid = document.getElementById("sosVeh").value;
    const what = document.getElementById("sosWhat").value.trim() || "Breakdown on road";
    if (vid) {
      const iss = { vehicleId: vid, title: "Breakdown: " + what, severity: "High", status: "In Progress", createdAt: today, source: "Breakdown SOS" };
      if (typeof coreDbBacked === "function" && coreDbBacked()) {
        const savedIss = await dbCreateIssue(iss);
        if (savedIss) {
          db.issues.push(savedIss);
          const savedWo = await dbCreateWorkOrder({ issueId: savedIss.id, vehicleId: vid, title: "Breakdown: " + what, vendor: "FleetWorks partner network", estCost: null, status: "Open", createdAt: today });
          if (savedWo) db.workOrders.push(savedWo);
        }
      } else {
        const issueId = uid();
        db.issues.push({ id: issueId, ...iss });
        db.workOrders.push({ id: uid(), issueId, vehicleId: vid, title: "Breakdown: " + what, vendor: "FleetWorks partner network", estCost: null, status: "Open", createdAt: today });
      }
      saveStore(); renderAll();
    }
    // SMS alert to owner
    const ownerPhone = db.settings?.ownerPhone || db.settings?.contactPhone || "";
    const vLabel = vid ? vName(vid) : "Unknown vehicle";
    sendSms("sos", [{ mobile: ownerPhone, var1: vLabel, var2: "Driver", var3: what || "Breakdown on road" }]);

    const msg = "BREAKDOWN SOS\nVehicle: " + (vid ? vName(vid) : "—") + "\nIssue: " + what +
      "\nFleet: " + ((db.settings && db.settings.businessName) || "FleetWorks owner") +
      "\nPlease arrange the nearest partner workshop.";
    const go = loc => window.open("https://wa.me/919444960009?text=" +
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

/* ============ Fleet Operation Centre ============
   One screen an owner can leave open on a wall. Everything on it is derived
   from data the app already holds — there is no separate "ops" store to fall
   out of sync with the fleet.

   Exception-first: the wall sorts the trucks that need a decision to the front,
   because a board that lists 40 healthy vehicles in registration order is a
   board nobody reads twice. */

/* var, not let: activateTab() is defined far above this block and runs during
   script evaluation when the page is deep-linked (fleet.html#vehicles), so it
   reaches stopOpsCentre() before a let binding down here would be initialized.
   var hoists to undefined, which every check below already handles. */
var _occTimer = null, _occClock = null, _occFilter = "all";
var _occPositions = [];

const OCC_SEV = {
  4: { label: "Critical", cls: "crit" },
  3: { label: "High",     cls: "high" },
  2: { label: "Medium",   cls: "med"  },
  1: { label: "Low",      cls: "low"  },
  0: { label: "Clear",    cls: "ok"   },
};

function occAlertsFor(v, insights) {
  return insights.filter(i => i.title && i.title.startsWith(v.name + ":"));
}

async function loadOpsCentre() {
  startOccClock();
  await loadOccPositions();
  // The fetch above is slow enough that the user can have left already; arming
  // the timer regardless would leave it polling behind every other tab.
  if (!document.getElementById("tab-opscentre")?.classList.contains("active")) return;
  renderOpsCentre();
  setOccAuto(document.getElementById("occAuto")?.checked !== false);
}

/* Positions come from driver_locations, newest per vehicle. Signed-out demo
   fleets simply have none — the panel says so rather than inventing pins. */
async function loadOccPositions() {
  _occPositions = [];
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) return;
  try {
    const rows = await fwCloud.authGet(
      "driver_locations",
      "select=vehicle_id,latitude,longitude,speed_kmph,recorded_at&order=recorded_at.desc&limit=300"
    );
    const seen = new Set();
    (rows || []).forEach(r => {
      if (!r.vehicle_id || seen.has(r.vehicle_id)) return;
      seen.add(r.vehicle_id);
      _occPositions.push(r);
    });
  } catch { /* offline or table absent — panel degrades to a note */ }
}

function renderOpsCentre() {
  const root = document.getElementById("occRoot");
  if (!root) return;
  const insights = computeInsights().filter(i => i.sev > 0);
  const vehs = db.vehicles.slice();

  renderOccKpis(vehs, insights);
  renderOccWall(vehs, insights);
  renderOccStream(insights);
  renderOccPositions(vehs);

  const u = document.getElementById("occUpdated");
  if (u) u.textContent = "Updated " + new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderOccKpis(vehs, insights) {
  const el = document.getElementById("occKpis");
  if (!el) return;
  const counts = { moving: 0, halted: 0, repair: 0, planned: 0, no_driver: 0, active: 0 };
  vehs.forEach(v => counts[vehicleOpStatus(v)]++);
  const crit = insights.filter(i => i.sev >= 4).length;
  const high = insights.filter(i => i.sev === 3).length;

  const tiles = [
    { k: "Fleet",      n: vehs.length,        cls: "" },
    { k: "Moving",     n: counts.moving,      cls: "ok" },
    { k: "Halted",     n: counts.halted,      cls: "warn" },
    { k: "In Repair",  n: counts.repair,      cls: "bad" },
    { k: "No Driver",  n: counts.no_driver,   cls: "warn" },
    { k: "Critical",   n: crit,               cls: crit ? "bad" : "ok" },
    { k: "High",       n: high,               cls: high ? "warn" : "ok" },
  ];
  el.innerHTML = tiles.map(t =>
    `<div class="occ-kpi ${t.cls}"><span class="occ-kpi-n">${t.n}</span><span class="occ-kpi-k">${t.k}</span></div>`
  ).join("");
}

function renderOccWall(vehs, insights) {
  const filters = document.getElementById("occWallFilters");
  if (filters) {
    const opts = [["all", "All"], ["attention", "Needs attention"], ["moving", "Moving"],
                  ["halted", "Halted"], ["repair", "In Repair"], ["no_driver", "No Driver"]];
    filters.innerHTML = opts.map(([k, l]) =>
      `<button class="occ-chip${_occFilter === k ? " on" : ""}" onclick="setOccFilter('${k}')">${l}</button>`
    ).join("");
  }

  const el = document.getElementById("occTiles");
  if (!el) return;
  if (!vehs.length) {
    el.innerHTML = `<p class="muted" style="padding:16px;margin:0">No vehicles yet. Add one to start monitoring.</p>`;
    return;
  }

  const rows = vehs.map(v => {
    const st = vehicleOpStatus(v);
    const alerts = occAlertsFor(v, insights);
    const worst = alerts.reduce((m, a) => Math.max(m, a.sev), 0);
    return { v, st, alerts, worst, pend: vehiclePendency(v),
             driver: db.drivers.find(d => d.vehicleId === v.id) };
  }).filter(r => {
    if (_occFilter === "all") return true;
    if (_occFilter === "attention") return r.worst >= 3 || r.st === "repair" || r.st === "no_driver" || r.pend > 7;
    return r.st === _occFilter;
  }).sort((a, b) => (b.worst - a.worst) || (b.pend - a.pend) || a.v.name.localeCompare(b.v.name));

  if (!rows.length) {
    el.innerHTML = `<p class="muted" style="padding:16px;margin:0">Nothing matches this filter.</p>`;
    return;
  }

  el.innerHTML = rows.map(r => {
    const m = OP_STATUS[r.st] || OP_STATUS.active;
    const sev = OCC_SEV[r.worst] || OCC_SEV[0];
    const pos = _occPositions.find(p => p.vehicle_id === v_dbId(r.v));
    return `<article class="occ-tile sev-${sev.cls}" onclick="occOpenVehicle('${r.v.id}')" title="Open ${esc(r.v.name)}">
      <div class="occ-tile-top">
        <strong>${esc(r.v.name)}</strong>
        <span class="occ-dot ${m.cls}"></span>
      </div>
      <div class="occ-tile-st">${m.label}</div>
      <div class="occ-tile-meta">
        <span>${r.driver ? esc(r.driver.name) : "No driver"}</span>
        ${pos && pos.speed_kmph != null ? `<span>${Math.round(pos.speed_kmph)} km/h</span>` : ""}
      </div>
      <div class="occ-tile-foot">
        ${r.alerts.length ? `<span class="occ-pill ${sev.cls}">${r.alerts.length} alert${r.alerts.length === 1 ? "" : "s"}</span>` : `<span class="occ-pill ok">OK</span>`}
        ${r.pend > 0 ? `<span class="occ-pill ${r.pend > 14 ? "crit" : r.pend > 7 ? "high" : "low"}">${r.pend}d pending</span>` : ""}
      </div>
    </article>`;
  }).join("");
}

// The local store id and the Postgres uuid are different keys; positions are
// keyed by the uuid.
function v_dbId(v) { return v.dbId || v.id; }

function renderOccStream(insights) {
  const el = document.getElementById("occStream");
  const cnt = document.getElementById("occAlertCount");
  if (cnt) cnt.textContent = insights.length ? insights.length + " open" : "all clear";
  if (!el) return;
  if (!insights.length) {
    el.innerHTML = `<div class="occ-clear">Nothing needs a decision right now.</div>`;
    return;
  }
  el.innerHTML = insights.slice(0, 60).map(i => {
    const sev = OCC_SEV[i.sev] || OCC_SEV[1];
    return `<div class="occ-alert ${sev.cls}">
      <span class="occ-alert-ic">${FWIcon(i.icon || "alert", { size: 15 })}</span>
      <div>
        <div class="occ-alert-top"><span class="occ-tag">${esc(i.tag)}</span><span class="occ-sev ${sev.cls}">${sev.label}</span></div>
        <strong>${esc(i.title)}</strong>
        <p>${esc(i.detail)}</p>
      </div>
    </div>`;
  }).join("");
}

function renderOccPositions(vehs) {
  const el = document.getElementById("occPositions");
  const note = document.getElementById("occPosNote");
  if (!el) return;
  if (!_occPositions.length) {
    if (note) note.textContent = "";
    el.innerHTML = `<p class="muted" style="margin:0;padding:14px 16px">
      No live positions yet. Positions arrive once a driver turns on location sharing
      in the driver portal, or an AIS-140 device is linked to the vehicle.</p>`;
    return;
  }
  if (note) note.textContent = _occPositions.length + " reporting";
  el.innerHTML = `<div style="overflow-x:auto"><table class="chart-table-el" style="width:100%">
    <thead><tr><th>Vehicle</th><th>Speed</th><th>Coordinates</th><th>Last fix</th><th></th></tr></thead>
    <tbody>${_occPositions.map(p => {
      const v = vehs.find(x => v_dbId(x) === p.vehicle_id);
      const mins = Math.round((Date.now() - new Date(p.recorded_at)) / 60000);
      const stale = mins > 30;
      return `<tr>
        <td><strong>${esc(v ? v.name : "Unknown vehicle")}</strong></td>
        <td>${p.speed_kmph != null ? Math.round(p.speed_kmph) + " km/h" : "—"}</td>
        <td style="font-family:ui-monospace,monospace;font-size:0.8rem">${Number(p.latitude).toFixed(4)}, ${Number(p.longitude).toFixed(4)}</td>
        <td><span class="fw-badge ${stale ? "soon" : "ok"}">${mins < 1 ? "just now" : mins + "m ago"}</span></td>
        <td><a class="link-btn" target="_blank" rel="noopener"
             href="https://www.google.com/maps?q=${encodeURIComponent(p.latitude + "," + p.longitude)}">Map</a></td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

window.setOccFilter = function(k) {
  _occFilter = k;
  renderOccWall(db.vehicles.slice(), computeInsights().filter(i => i.sev > 0));
};

window.occOpenVehicle = function(vehicleId) {
  if (window.openVehicleDetail) openVehicleDetail(vehicleId);
  else activateTab("vehicles");
};

window.refreshOpsCentre = async function() {
  await loadOccPositions();
  renderOpsCentre();
};

function setOccAuto(on) {
  if (_occTimer) { clearInterval(_occTimer); _occTimer = null; }
  if (on) _occTimer = setInterval(refreshOpsCentre, 30000);
}

function startOccClock() {
  if (_occClock) return;
  const tick = () => {
    const el = document.getElementById("occClock");
    if (el) el.textContent = new Date().toLocaleString("en-IN", {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit"
    });
  };
  tick();
  _occClock = setInterval(tick, 30000);
}

window.toggleOccFullscreen = function() {
  const el = document.getElementById("occRoot");
  if (!el) return;
  const btn = document.getElementById("occFsBtn");
  if (document.fullscreenElement) {
    document.exitFullscreen();
    if (btn) btn.textContent = "Full screen";
  } else {
    el.requestFullscreen?.().then(() => { if (btn) btn.textContent = "Exit full screen"; }, () => {});
  }
};

document.getElementById("occAuto")?.addEventListener("change", e => setOccAuto(e.target.checked));

// Stop polling when the Operation Centre is not the visible tab — a 30-second
// timer running behind every other screen is just battery and quota.
function stopOpsCentre() {
  if (_occTimer) { clearInterval(_occTimer); _occTimer = null; }
}

/* ============ Driver Safety — review queue, scores, coaching ============
   Reads v_safety_events and v_driver_safety_score. Both are views with
   security_invoker, so a supervisor opening this page resolves only the
   vehicles he holds without the page filtering anything itself. */

var _sfEvents = [], _sfScores = [], _sfCoaching = [], _sfFilter = "unreviewed";
var _coachEvent = null, _coachClip = null;

const SF_BAND = {
  excellent:         { label: "Excellent",     cls: "ok",       min: 0 },
  good:              { label: "Good",          cls: "upcoming", min: 0 },
  needs_coaching:    { label: "Needs coaching", cls: "soon",    min: 0 },
  at_risk:           { label: "At risk",       cls: "overdue",  min: 0 },
  insufficient_data: { label: "Not enough km", cls: "",         min: 0 },
};

const SF_EVENT_LABEL = {
  forward_collision: "Forward collision", pedestrian_warning: "Pedestrian warning",
  lane_departure: "Lane departure", headway_warning: "Headway warning",
  fatigue: "Fatigue / drowsiness", distraction: "Distraction", phone_use: "Phone use",
  no_seatbelt: "No seatbelt", smoking: "Smoking", harsh_brake: "Harsh braking",
  harsh_accel: "Harsh acceleration", harsh_corner: "Harsh cornering", overspeed: "Overspeeding",
  fuel_drop: "Fuel drop", tamper: "Device tamper", power_cut: "Power cut",
  sos: "SOS", panic: "Panic button",
};

async function loadSafety() {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) {
    ["safetyEvents", "safetyScores", "safetyCoaching"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<p class="muted" style="padding:14px">Sign in to see safety data for your fleet.</p>`;
    });
    document.getElementById("safetyStats").innerHTML = "";
    return;
  }
  const [ev, sc, co] = await Promise.all([
    fwCloud.authGet("v_safety_events",
      "select=*&order=acknowledged_at.nullsfirst,occurred_at.desc&limit=200").catch(() => []),
    fwCloud.authGet("v_driver_safety_score", "select=*").catch(() => []),
    fwCloud.authGet("coaching_sessions",
      "select=*&order=assigned_at.desc&limit=100").catch(() => []),
  ]);
  _sfEvents = ev || []; _sfScores = sc || []; _sfCoaching = co || [];
  renderSafety();
  const u = document.getElementById("safetyUpdated");
  if (u) u.textContent = "Updated " + new Date().toLocaleTimeString("en-IN");
}

function renderSafety() {
  renderSafetyStats();
  renderSafetyEvents();
  renderSafetyScores();
  renderSafetyCoaching();
}

function renderSafetyStats() {
  const el = document.getElementById("safetyStats");
  if (!el) return;
  const unreviewed = _sfEvents.filter(e => !e.acknowledged_at).length;
  const critical   = _sfEvents.filter(e => e.severity === "critical").length;
  const openCoach  = _sfCoaching.filter(c => c.status === "assigned" || c.status === "acknowledged").length;
  const scored     = _sfScores.filter(s => s.safety_score != null);
  const avg = scored.length
    ? Math.round(scored.reduce((t, s) => t + Number(s.safety_score), 0) / scored.length) : null;
  const atRisk = _sfScores.filter(s => s.band === "at_risk").length;

  const tiles = [
    ["Unreviewed events", unreviewed, unreviewed ? "warn" : "ok"],
    ["Critical", critical, critical ? "bad" : "ok"],
    ["Open coaching", openCoach, ""],
    ["Fleet safety score", avg == null ? "—" : avg, avg == null ? "" : avg >= 80 ? "ok" : avg >= 60 ? "warn" : "bad"],
    ["Drivers at risk", atRisk, atRisk ? "bad" : "ok"],
  ];
  el.innerHTML = tiles.map(([k, v, c]) => `
    <div class="stat-card${c ? " sf-" + c : ""}">
      <span class="stat-value">${v}</span><span class="stat-label">${k}</span>
    </div>`).join("");
}

function renderSafetyEvents() {
  const f = document.getElementById("safetyEventFilters");
  if (f) {
    const opts = [["unreviewed", "Unreviewed"], ["critical", "Critical"],
                  ["coachable", "Coachable"], ["all", "All"]];
    f.innerHTML = opts.map(([k, l]) =>
      `<button class="fw-chip${_sfFilter === k ? " is-active" : ""}" onclick="setSafetyFilter('${k}')">${l}</button>`
    ).join("");
  }

  const el = document.getElementById("safetyEvents");
  if (!el) return;

  const rows = _sfEvents.filter(e => {
    if (_sfFilter === "unreviewed") return !e.acknowledged_at;
    if (_sfFilter === "critical")   return e.severity === "critical";
    if (_sfFilter === "coachable")  return e.is_coachable && Number(e.weight) > 0;
    return true;
  }).sort((a, b) => (Number(b.weight) - Number(a.weight))
                 || new Date(b.occurred_at) - new Date(a.occurred_at));

  if (!rows.length) {
    el.innerHTML = _sfEvents.length
      ? `<p class="muted" style="padding:14px">No events match this filter.</p>`
      : `<p class="muted" style="padding:14px">No safety events yet. They arrive once an AIS-140 device
         or dash cam is linked to a vehicle and starts reporting.</p>`;
    return;
  }

  el.innerHTML = `<table class="chart-table-el" style="width:100%">
    <thead><tr>
      <th>When</th><th>Event</th><th>Vehicle</th><th>Driver</th>
      <th>Speed</th><th>Weight</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${rows.map(e => {
      const sev = e.severity === "critical" ? "overdue" : e.severity === "warning" ? "soon" : "upcoming";
      const veh = db.vehicles.find(v => (v.dbId || v.id) === e.vehicle_id);
      const drv = _sfScores.find(s => s.driver_id === e.driver_id);
      const session = _sfCoaching.find(c => c.event_id === e.id);
      // An event attributed by current assignment rather than by the trip that
      // was running is a guess, and saying so is the difference between a
      // coaching conversation and an argument.
      const attrWarn = e.attribution === "assignment";
      return `<tr>
        <td><span title="${esc(new Date(e.occurred_at).toLocaleString("en-IN"))}">${fmtAgoShort(e.occurred_at)}</span></td>
        <td><span class="fw-badge ${sev}">${esc(SF_EVENT_LABEL[e.event_type] || e.event_type)}</span>
            ${e.video_url ? ` <a href="${esc(e.video_url)}" target="_blank" rel="noopener" class="link-btn" style="font-size:.75rem">clip</a>` : ""}</td>
        <td>${veh ? esc(veh.name) : `<span class="muted">—</span>`}</td>
        <td>${drv ? esc(drv.driver_name) : `<span class="muted">Unattributed</span>`}
            ${attrWarn ? `<br><span class="muted" style="font-size:.7rem" title="No trip was running, so this is the vehicle's current driver — not proof of who was at the wheel.">by assignment</span>` : ""}</td>
        <td>${e.speed_kmph != null ? Math.round(e.speed_kmph) + " km/h" : "—"}</td>
        <td>${Number(e.weight) > 0 ? Number(e.weight) : `<span class="muted">not scored</span>`}</td>
        <td>${session
              ? `<span class="fw-badge ${session.status === "dismissed" ? "" : session.status === "completed" ? "ok" : "soon"}">${esc(session.status)}</span>`
              : e.acknowledged_at ? `<span class="fw-badge ok">reviewed</span>`
              : `<span class="fw-badge soon">new</span>`}</td>
        <td><button class="link-btn" onclick="openEventDetail('${e.id}')">Review</button></td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

function fmtAgoShort(ts) {
  const s = Math.round((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

function renderSafetyScores() {
  const el = document.getElementById("safetyScores");
  if (!el) return;
  const scored = _sfScores.filter(s => s.safety_score != null)
    .sort((a, b) => Number(a.safety_score) - Number(b.safety_score));
  const unscored = _sfScores.filter(s => s.safety_score == null);

  if (!scored.length && !unscored.length) {
    el.innerHTML = `<p class="muted" style="padding:14px">No drivers yet.</p>`;
    return;
  }

  el.innerHTML = `
    ${scored.length ? `<table class="chart-table-el" style="width:100%">
      <thead><tr><th>Driver</th><th>Score</th><th>Band</th><th>Events</th><th>Critical</th><th>km (30d)</th><th>Per 1,000 km</th><th></th></tr></thead>
      <tbody>${scored.map(s => {
        const b = SF_BAND[s.band] || SF_BAND.good;
        const sc = Number(s.safety_score);
        return `<tr>
          <td><strong>${esc(s.driver_name)}</strong></td>
          <td><div class="sf-score"><div class="sf-score-bar"><i style="width:${sc}%;background:${sc >= 80 ? "#16a34a" : sc >= 60 ? "#f59e0b" : "#dc2626"}"></i></div><b>${sc}</b></div></td>
          <td><span class="fw-badge ${b.cls}">${b.label}</span></td>
          <td>${s.events_30d}</td>
          <td>${Number(s.critical_30d) ? `<span class="fw-badge overdue">${s.critical_30d}</span>` : "0"}</td>
          <td>${Math.round(Number(s.km_30d)).toLocaleString("en-IN")}</td>
          <td>${s.penalty_per_1000km ?? "—"}</td>
          <td>${Number(s.unreviewed_30d) || _sfCoaching.some(c => c.driver_id === s.driver_id && c.status === "assigned")
                ? `<button class="btn btn-outline btn-sm" onclick="startCoachMeeting('${s.driver_id}')">Coach</button>`
                : ""}</td>
        </tr>`;
      }).join("")}</tbody></table>` : ""}
    ${unscored.length ? `<p class="muted" style="padding:12px 14px;margin:0;border-top:1px solid var(--border)">
      ${unscored.length} driver${unscored.length === 1 ? "" : "s"} not scored — under 250 km in the last 30 days.
      Below that the event rate is too noisy to mean anything, so they get no score rather than a misleading one.
    </p>` : ""}`;
}

function renderSafetyCoaching() {
  const el = document.getElementById("safetyCoaching");
  if (!el) return;
  if (!_sfCoaching.length) {
    el.innerHTML = `<p class="muted" style="padding:14px">No coaching sessions yet.</p>`;
    return;
  }
  el.innerHTML = `<table class="chart-table-el" style="width:100%">
    <thead><tr><th>Driver</th><th>Event</th><th>Note</th><th>Status</th><th>Assigned</th><th></th></tr></thead>
    <tbody>${_sfCoaching.map(c => {
      const drv = _sfScores.find(s => s.driver_id === c.driver_id);
      const st = { assigned: "soon", acknowledged: "upcoming", completed: "ok", dismissed: "" }[c.status] || "";
      return `<tr>
        <td><strong>${drv ? esc(drv.driver_name) : "—"}</strong></td>
        <td>${esc(SF_EVENT_LABEL[c.event_type] || c.event_type || "—")}</td>
        <td style="max-width:280px">${esc(c.coach_note || "")}
          ${c.driver_note ? `<div class="muted" style="font-size:.75rem;margin-top:3px">Driver: ${esc(c.driver_note)}</div>` : ""}
          ${c.dismiss_reason ? `<div class="muted" style="font-size:.75rem;margin-top:3px">Dismissed: ${esc(c.dismiss_reason.replace(/_/g, " "))}</div>` : ""}</td>
        <td><span class="fw-badge ${st}">${esc(c.status)}</span></td>
        <td>${fmtAgoShort(c.assigned_at)} ago</td>
        <td>${c.status === "acknowledged"
              ? `<button class="link-btn" onclick="completeCoaching('${c.id}')">Close</button>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

window.setSafetyFilter = function(k) { _sfFilter = k; renderSafetyEvents(); };

window.openCoachModal = function(eventId) {
  _coachEvent = _sfEvents.find(e => e.id === eventId);
  if (!_coachEvent) return;
  const drv = _sfScores.find(s => s.driver_id === _coachEvent.driver_id);
  const veh = db.vehicles.find(v => (v.dbId || v.id) === _coachEvent.vehicle_id);
  document.getElementById("coachModalTitle").textContent =
    SF_EVENT_LABEL[_coachEvent.event_type] || _coachEvent.event_type;
  document.getElementById("coachModalSub").textContent =
    [drv && drv.driver_name, veh && veh.name,
     new Date(_coachEvent.occurred_at).toLocaleString("en-IN"),
     _coachEvent.attribution === "assignment" ? "attributed by current assignment, not by trip" : null
    ].filter(Boolean).join(" · ");
  document.getElementById("coachDismissPanel").hidden = true;
  document.getElementById("coachForm").reset();

  // The clip is the point of the review — a coaching note written without
  // looking at what happened is guesswork.
  const clipEl = document.getElementById("coachClip");
  if (_coachClip) { _coachClip.stop(); _coachClip = null; }
  if (clipEl) {
    if (_coachEvent.video_url && window.FWDashcam) {
      _coachClip = FWDashcam.renderClip(clipEl, {
        url: _coachEvent.video_url,
        eventType: _coachEvent.event_type,
        speed: _coachEvent.speed_kmph,
        stamp: new Date(_coachEvent.occurred_at).toLocaleString("en-IN"),
      });
    } else {
      clipEl.innerHTML = `<p class="muted" style="margin:0;padding:12px;background:var(--bg-alt);border-radius:8px;font-size:.85rem">
        No clip for this event — the device reported it without video.</p>`;
    }
  }

  document.getElementById("coachModal").classList.add("open");
};

window.closeCoachModal = function() {
  document.getElementById("coachModal").classList.remove("open");
  // Stop the render loop; a canvas animating behind a closed modal is a
  // battery leak nobody ever notices.
  if (_coachClip) { _coachClip.stop(); _coachClip = null; }
  _coachEvent = null;
};

window.openDismissPanel = function() {
  document.getElementById("coachDismissPanel").hidden = false;
};

async function saveCoaching(fields) {
  if (!_coachEvent) return;
  const ok = await fwCloud.authInsert("coaching_sessions", Object.assign({
    org_id: _coachEvent.org_id,
    driver_id: _coachEvent.driver_id,
    event_id: _coachEvent.id,
    vehicle_id: _coachEvent.vehicle_id,
    event_type: _coachEvent.event_type,
    severity: _coachEvent.severity,
  }, fields));
  if (!ok) { alert("Could not save — try again."); return; }
  // Reviewing the event and coaching it are the same act from the supervisor's
  // side, so acknowledge it here rather than making him click twice.
  if (!_coachEvent.acknowledged_at) {
    await fwCloud.authPatch("device_events?id=eq." + _coachEvent.id,
      { acknowledged_at: new Date().toISOString() }).catch(() => {});
  }
  closeCoachModal();
  loadSafety();
}

const _coachForm = document.getElementById("coachForm");
if (_coachForm) _coachForm.addEventListener("submit", e => {
  e.preventDefault();
  const note = e.target.coach_note.value.trim();
  if (!note) return;
  saveCoaching({ status: "assigned", coach_note: note });
});

window.submitDismiss = function() {
  const sel = document.querySelector('#coachForm [name="dismiss_reason"]');
  saveCoaching({
    status: "dismissed",
    dismiss_reason: sel ? sel.value : "other",
    coach_note: document.querySelector('#coachForm [name="coach_note"]').value.trim() || null,
  });
};

window.completeCoaching = async function(id) {
  await fwCloud.authPatch("coaching_sessions?id=eq." + id,
    { status: "completed", completed_at: new Date().toISOString() });
  loadSafety();
};

/* ============ FleetSafe — Fleet View ============
   One list and one map over every entity a fleet tracks: vehicles, and the
   trailers and equipment that move with them. Entities rather than vehicles is
   the whole point — a trailer nobody can find costs as much standing still as
   a truck does.

   Positions come from driver_locations, newest per vehicle, same source the
   Operation Centre uses. Assets inherit the position of whatever is towing
   them, because a trailer has no tracker of its own in most fleets and
   pretending otherwise would put it at 0,0 in the Gulf of Guinea. */

var _fvTab = "live", _fvMap = null, _fvLayer = null, _fvGeoLayer = null;
var _fvAssets = [], _fvGeofences = [], _fvPositions = [], _fvSelected = null;
var _fvDrawing = false;

async function loadFleetView() {
  const signedIn = !!(window.fwCloud && fwCloud.user && fwCloud.user());
  if (signedIn) {
    const [assets, fences, pos] = await Promise.all([
      fwCloud.authGet("assets", "select=*&order=name").catch(() => []),
      fwCloud.authGet("geofences", "select=*&is_active=eq.true").catch(() => []),
      fwCloud.authGet("driver_locations",
        "select=vehicle_id,latitude,longitude,speed_kmph,recorded_at&order=recorded_at.desc&limit=400").catch(() => []),
    ]);
    _fvAssets = assets || [];
    _fvGeofences = fences || [];
    const seen = new Set();
    _fvPositions = (pos || []).filter(p => {
      if (!p.vehicle_id || seen.has(p.vehicle_id)) return false;
      seen.add(p.vehicle_id); return true;
    });
  } else {
    _fvAssets = []; _fvGeofences = []; _fvPositions = [];
  }
  renderFleetView();
  await initFleetViewMap();
}

/* Every row on the list and pin on the map is one of these, so list and map
   can never disagree about what exists. */
function fvEntities() {
  const out = db.vehicles.map(v => {
    const pos = _fvPositions.find(p => p.vehicle_id === (v.dbId || v.id));
    const driver = db.drivers.find(d => d.vehicleId === v.id);
    return {
      kind: "vehicle", id: v.id, dbId: v.dbId || v.id, name: v.name,
      sub: v.type || "Vehicle",
      driver: driver ? driver.name : null,
      status: vehicleOpStatus(v),
      speed: pos ? pos.speed_kmph : null,
      lat: pos ? Number(pos.latitude) : null,
      lng: pos ? Number(pos.longitude) : null,
      at: pos ? pos.recorded_at : null,
      place: v.baseCity || v.depot || "",
    };
  });

  _fvAssets.forEach(a => {
    const tow = db.vehicles.find(v => (v.dbId || v.id) === a.towed_by_vehicle_id);
    const pos = a.towed_by_vehicle_id
      ? _fvPositions.find(p => p.vehicle_id === a.towed_by_vehicle_id) : null;
    out.push({
      kind: "asset", id: a.id, dbId: a.id, name: a.name,
      sub: [a.asset_type && a.asset_type.replace(/_/g, " "), a.make, a.model].filter(Boolean).join(" · "),
      driver: null,
      status: a.status === "active" ? (tow ? "moving" : "halted") : a.status,
      speed: pos ? pos.speed_kmph : null,
      lat: pos ? Number(pos.latitude) : null,
      lng: pos ? Number(pos.longitude) : null,
      at: pos ? pos.recorded_at : null,
      place: tow ? "Towed by " + tow.name : (a.base_location || ""),
      towedBy: tow ? tow.name : null,
    });
  });

  return out;
}

function fvFiltered() {
  const q = (document.getElementById("fvSearch")?.value || "").trim().toLowerCase();
  const kind = document.getElementById("fvEntity")?.value || "";
  const st = document.getElementById("fvStatus")?.value || "";
  const sort = document.getElementById("fvSort")?.value || "name";

  let rows = fvEntities();
  if (_fvTab === "vehicles") rows = rows.filter(r => r.kind === "vehicle");
  if (_fvTab === "assets")   rows = rows.filter(r => r.kind === "asset");
  if (kind) rows = rows.filter(r => r.kind === kind);
  if (st)   rows = rows.filter(r => r.status === st);
  if (q) rows = rows.filter(r =>
    (r.name + " " + (r.sub || "") + " " + (r.driver || "") + " " + (r.place || "")).toLowerCase().includes(q));

  rows.sort((a, b) => {
    if (sort === "speed")   return (b.speed || 0) - (a.speed || 0);
    if (sort === "updated") return new Date(b.at || 0) - new Date(a.at || 0);
    return a.name.localeCompare(b.name);
  });
  return rows;
}

function renderFleetView() {
  const list = document.getElementById("fvList");
  if (!list) return;

  if (_fvTab === "drivers") return renderFvDrivers(list);
  if (_fvTab === "trips")   return renderFvTrips(list);

  const rows = fvFiltered();
  const cnt = document.getElementById("fvCount");
  if (cnt) cnt.textContent = rows.length + (rows.length === 1 ? " entity" : " entities");

  if (!rows.length) {
    list.innerHTML = `<p class="muted" style="padding:16px">Nothing matches these filters.</p>`;
    drawFvMarkers([]);
    return;
  }

  list.innerHTML = rows.map(r => {
    const m = OP_STATUS[r.status] || OP_STATUS.active;
    return `<article class="fv-card${_fvSelected === r.kind + ":" + r.id ? " is-sel" : ""}"
              onclick="fvSelect('${r.kind}','${esc(r.id)}')">
      <span class="fv-ic ${r.kind}">${FWIcon(r.kind === "asset" ? "boxes" : "truck", { size: 15 })}</span>
      <div class="fv-card-main">
        <div class="fv-card-top">
          <strong>${esc(r.name)}</strong>
          ${r.speed != null ? `<span class="fv-speed">${Math.round(r.speed)} km/h</span>` : ""}
        </div>
        <div class="fv-card-sub">${esc(r.sub || "")}</div>
        ${r.driver ? `<div class="fv-card-drv">${FWIcon("driver", { size: 12 })} ${esc(r.driver)}</div>` : ""}
        ${r.place ? `<div class="fv-card-place">${esc(r.place)}</div>` : ""}
        <div class="fv-card-foot">
          <span class="fw-badge ${m.cls}" style="font-size:.68rem">${m.label}</span>
          <span class="fv-ago">${r.at ? fmtAgoShort(r.at) + " ago" : "no fix"}</span>
        </div>
      </div>
    </article>`;
  }).join("");

  drawFvMarkers(rows);
}

function renderFvDrivers(list) {
  const q = (document.getElementById("fvSearch")?.value || "").trim().toLowerCase();
  let rows = db.drivers.slice();
  if (q) rows = rows.filter(d => (d.name + " " + (d.phone || "")).toLowerCase().includes(q));
  const cnt = document.getElementById("fvCount");
  if (cnt) cnt.textContent = rows.length + " drivers";
  list.innerHTML = rows.length ? rows.map(d => {
    const veh = d.vehicleId ? db.vehicles.find(v => v.id === d.vehicleId) : null;
    return `<article class="fv-card">
      <span class="fv-ic driver">${FWIcon("driver", { size: 15 })}</span>
      <div class="fv-card-main">
        <div class="fv-card-top"><strong>${esc(d.name)}</strong></div>
        <div class="fv-card-sub">${veh ? esc(veh.name) : "No vehicle assigned"}</div>
        ${d.phone ? `<div class="fv-card-place">${esc(d.phone)}</div>` : ""}
      </div>
    </article>`;
  }).join("") : `<p class="muted" style="padding:16px">No drivers.</p>`;
  drawFvMarkers(fvEntities().filter(r => r.driver));
}

function renderFvTrips(list) {
  const rows = (db.trips || []).slice(-40).reverse();
  const cnt = document.getElementById("fvCount");
  if (cnt) cnt.textContent = rows.length + " trips";
  list.innerHTML = rows.length ? rows.map(t => `
    <article class="fv-card">
      <span class="fv-ic trip">${FWIcon("mapPin", { size: 15 })}</span>
      <div class="fv-card-main">
        <div class="fv-card-top"><strong>${esc(t.from || "—")} → ${esc(t.to || "—")}</strong></div>
        <div class="fv-card-sub">${esc(vName(t.vehicleId))}</div>
        <div class="fv-card-place">${t.date ? fmtDate(t.date) : ""}${t.km ? " · " + t.km + " km" : ""}</div>
      </div>
    </article>`).join("") : `<p class="muted" style="padding:16px">No trips logged.</p>`;
  drawFvMarkers([]);
}

window.fvSelect = function(kind, id) {
  _fvSelected = kind + ":" + id;
  const r = fvEntities().find(x => x.kind === kind && String(x.id) === String(id));
  renderFleetView();
  if (r && r.lat != null && _fvMap) _fvMap.setView([r.lat, r.lng], 11, { animate: true });
};

document.getElementById("fvTabs")?.addEventListener("click", e => {
  const b = e.target.closest(".fv-tab");
  if (!b) return;
  _fvTab = b.dataset.fv;
  document.querySelectorAll("#fvTabs .fv-tab").forEach(x => x.classList.toggle("is-active", x === b));
  renderFleetView();
});

/* ---- Map ---- */
async function initFleetViewMap() {
  const host = document.getElementById("fvMap");
  const note = document.getElementById("fvMapNote");
  if (!host) return;
  try {
    if (typeof loadLeaflet === "function") await loadLeaflet();
    if (!window.L) throw new Error("no leaflet");
  } catch {
    if (note) { note.hidden = false; note.textContent = "Map could not load — check your connection. The list still works."; }
    return;
  }
  if (!_fvMap) {
    _fvMap = L.map(host, { zoomControl: true }).setView([20.9, 78.9], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: "&copy; OpenStreetMap",
    }).addTo(_fvMap);
    _fvLayer = L.layerGroup().addTo(_fvMap);
    _fvGeoLayer = L.layerGroup().addTo(_fvMap);
    _fvMap.on("click", onFvMapClick);
  }
  // Leaflet mis-measures a container that was display:none when created, so a
  // tab that starts hidden needs this once it is visible.
  setTimeout(() => _fvMap && _fvMap.invalidateSize(), 60);
  drawFvGeofences();
  renderFleetView();
}

function drawFvMarkers(rows) {
  if (!_fvLayer || !window.L) return;
  _fvLayer.clearLayers();
  const pts = [];
  rows.filter(r => r.lat != null && !isNaN(r.lat)).forEach(r => {
    const m = OP_STATUS[r.status] || OP_STATUS.active;
    const col = { ok: "#16a34a", soon: "#f59e0b", overdue: "#dc2626", upcoming: "#2563eb" }[m.cls] || "#64748b";
    const icon = L.divIcon({
      className: "fv-pin-wrap",
      html: `<span class="fv-pin ${r.kind}" style="--pc:${col}">${r.kind === "asset" ? "▪" : "▲"}</span>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
    const mk = L.marker([r.lat, r.lng], { icon }).addTo(_fvLayer);
    mk.bindPopup(`<strong>${esc(r.name)}</strong><br>${esc(r.sub || "")}` +
      (r.driver ? `<br>${esc(r.driver)}` : "") +
      (r.speed != null ? `<br>${Math.round(r.speed)} km/h` : ""));
    pts.push([r.lat, r.lng]);
  });
  if (pts.length && _fvMap && !_fvSelected) {
    try { _fvMap.fitBounds(pts, { padding: [40, 40], maxZoom: 9 }); } catch { /* single point */ }
  }
  const note = document.getElementById("fvMapNote");
  if (note && !pts.length) {
    note.hidden = false;
    note.textContent = "No live positions yet — pins appear once a driver shares location or a tracker reports.";
  } else if (note) note.hidden = true;
}

function drawFvGeofences() {
  if (!_fvGeoLayer || !window.L) return;
  _fvGeoLayer.clearLayers();
  const PURPOSE_COL = { restricted: "#dc2626", customer: "#2563eb", depot: "#16a34a",
                        fuel: "#f59e0b", plant: "#7c3aed", workshop: "#0891b2" };
  _fvGeofences.forEach(g => {
    const col = PURPOSE_COL[g.purpose] || "#64748b";
    L.circle([Number(g.centre_lat), Number(g.centre_lng)], {
      radius: Number(g.radius_m), color: col, weight: 2, fillColor: col, fillOpacity: 0.1,
    }).bindPopup(`<strong>${esc(g.name)}</strong><br>${esc(g.purpose)} · ${Math.round(g.radius_m)} m`)
      .addTo(_fvGeoLayer);
  });
}

/* Click-to-place is the only sane way to draw a fence without a polygon editor:
   the owner clicks the gate, then types how far out it reaches. */
window.startDrawGeofence = function() {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) {
    alert("Sign in to create geofences."); return;
  }
  _fvDrawing = true;
  const note = document.getElementById("fvMapNote");
  if (note) { note.hidden = false; note.textContent = "Click the map on the centre of the zone…"; }
};

async function onFvMapClick(e) {
  if (!_fvDrawing) return;
  _fvDrawing = false;
  const note = document.getElementById("fvMapNote");
  if (note) note.hidden = true;

  const name = prompt("Geofence name (e.g. Hosur Plant Gate):");
  if (!name) return;
  const radius = parseInt(prompt("Radius in metres (50–50000):", "300"), 10);
  if (!radius || radius < 50 || radius > 50000) { alert("Radius must be between 50 and 50000 m."); return; }

  const org = await fvOrgId();
  if (!org) { alert("Could not resolve your organisation — try reloading."); return; }

  const ok = await fwCloud.authInsert("geofences", {
    org_id: org, name: name.trim(), purpose: "other",
    centre_lat: +e.latlng.lat.toFixed(6), centre_lng: +e.latlng.lng.toFixed(6),
    radius_m: radius, alert_on: "both", is_active: true,
  });
  if (!ok) { alert("Could not save the geofence."); return; }
  _fvGeofences = await fwCloud.authGet("geofences", "select=*&is_active=eq.true").catch(() => _fvGeofences);
  drawFvGeofences();
}

async function fvOrgId() {
  const rows = await fwCloud.authGet("memberships", "select=org_id&limit=1").catch(() => null);
  return rows && rows[0] ? rows[0].org_id : null;
}

window.openAssetModal = function() {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) { alert("Sign in to add assets."); return; }
  const name = prompt("Asset name (e.g. Trailer T-827):");
  if (!name) return;
  const type = prompt("Type — trailer, tipper_body, genset, compressor, tanker, crane, excavator, container, other:", "trailer");
  fvOrgId().then(async org => {
    if (!org) { alert("Could not resolve your organisation."); return; }
    const ok = await fwCloud.authInsert("assets", {
      org_id: org, name: name.trim(), asset_type: (type || "trailer").trim(), status: "active",
    });
    if (!ok) { alert("Could not save — check the type is one of the listed values."); return; }
    loadFleetView();
  });
};

/* ============ FleetSafe — Event Detail ============
   One safety event in full: the clip, the cabin view beside it, the speed
   trace around the moment, and the record of what was decided about it.

   The speed trace is the part that settles arguments. A detection box on its
   own is a claim; a speed trace showing 74 km/h holding steady into a hard
   deceleration is evidence, and it is what makes a driver accept a coaching
   note instead of disputing it. */

var _edEvent = null, _edClip = null, _edPipClip = null;

const ED_STATUS = {
  none:         ["Pending review", "ed-pending"],
  assigned:     ["Coachable",      "ed-coachable"],
  acknowledged: ["Driver notified","ed-coachable"],
  completed:    ["Coached",        "ed-coached"],
  dismissed:    ["Dismissed",      "ed-dismissed"],
};

/* Behaviour decides which camera leads. A drowsiness event is about the face,
   so the cabin is the main view and the road is inset; a collision is the
   reverse. Showing the wrong one first makes the reviewer hunt. */
const ED_CABIN_LED = new Set(["fatigue", "distraction", "phone_use", "no_seatbelt", "smoking"]);

window.openEventDetail = function(eventId) {
  const ev = _sfEvents.find(e => e.id === eventId);
  if (!ev) return;
  _edEvent = ev;
  activateTab("eventdetail");
  renderEventDetail();
};

function renderEventDetail() {
  const e = _edEvent;
  if (!e) return;

  const label = SF_EVENT_LABEL[e.event_type] || e.event_type;
  const when = new Date(e.occurred_at);
  document.getElementById("edTitle").textContent =
    label + " — " + when.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const session = _sfCoaching.find(c => c.event_id === e.id);
  const st = ED_STATUS[session ? session.status : "none"] || ED_STATUS.none;
  document.getElementById("edStatusChip").innerHTML = `<span class="ed-chip ${st[1]}">${st[0]}</span>`;

  // Clips: the leading camera fills the player, the other sits in the corner.
  const cabinLed = ED_CABIN_LED.has(e.event_type);
  const mainType = e.event_type;
  const pipType  = cabinLed ? "forward_collision" : "distraction";

  if (_edClip) { _edClip.stop(); _edClip = null; }
  if (_edPipClip) { _edPipClip.stop(); _edPipClip = null; }

  const clipHost = document.getElementById("edClip");
  const pipHost = document.getElementById("edPip");
  if (clipHost && window.FWDashcam) {
    _edClip = FWDashcam.renderClip(clipHost, {
      url: e.video_url || FWDashcam.makeClipRef(mainType, 1),
      eventType: mainType, speed: e.speed_kmph,
      stamp: when.toLocaleString("en-IN"),
    });
  }
  // The inset is the other camera on the same truck at the same moment, so it
  // is generated from the same seed — not an unrelated clip.
  if (pipHost && window.FWDashcam) {
    const seed = (FWDashcam.parseClipRef(e.video_url) || {}).seed || 1;
    _edPipClip = FWDashcam.renderClip(pipHost, {
      url: FWDashcam.makeClipRef(pipType, seed),
      eventType: pipType, speed: e.speed_kmph, stamp: "",
    });
  }

  drawEdSpeedGraph(e);
  renderEdMetrics(e);
  renderEdSide(e, session);
}

/* A short window of speed around the event. Real telemetry would come from the
   `telemetry` table; with none stored for a simulated event the trace is
   derived from the event's own speed and behaviour so the shape is at least
   truthful about what that behaviour does to speed. */
function drawEdSpeedGraph(e) {
  const c = document.getElementById("edSpeedGraph");
  if (!c) return;
  const host = c.parentElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = host.clientWidth || 600, H = 140;
  c.width = W * dpr; c.height = H * dpr;
  c.style.width = "100%"; c.style.height = H + "px";
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const base = Number(e.speed_kmph) || 50;
  const peak = Math.max(20, Math.ceil((base * 1.25) / 10) * 10);
  const N = 60, EVENT_AT = 0.55;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    let v = base + Math.sin(t * 7) * (base * 0.03);
    // Braking events collapse speed after the moment; overspeed climbs into it.
    if (e.event_type === "harsh_brake" || e.event_type === "forward_collision") {
      if (t > EVENT_AT) v = base * Math.max(0.12, 1 - (t - EVENT_AT) * 3.2);
    } else if (e.event_type === "overspeed") {
      v = base * (0.8 + t * 0.3);
    } else if (e.event_type === "harsh_accel") {
      v = base * (0.55 + t * 0.6);
    }
    pts.push({ t, v: Math.max(0, v) });
  }

  const padL = 44, padR = 12, padT = 14, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = t => padL + t * plotW;
  const y = v => padT + plotH - (v / peak) * plotH;

  // Event window band
  ctx.fillStyle = "rgba(239,68,68,.10)";
  ctx.fillRect(x(EVENT_AT - 0.05), padT, plotW * 0.1, plotH);

  // Axes
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px system-ui, sans-serif";
  [peak, Math.round(peak / 2), 0].forEach(v => {
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillText(String(v), 6, yy + 3);
  });
  ctx.fillText("km/h", 6, padT - 4);

  // Trace
  ctx.strokeStyle = "#334155"; ctx.lineWidth = 1.8;
  ctx.beginPath();
  pts.forEach((p, i) => { const px = x(p.t), py = y(p.v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke();

  // Event cursor
  ctx.strokeStyle = "#475569"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x(EVENT_AT), padT); ctx.lineTo(x(EVENT_AT), padT + plotH); ctx.stroke();

  ctx.fillStyle = "#94a3b8";
  ctx.fillText("0:00", padL, H - 6);
  ctx.textAlign = "right";
  ctx.fillText("0:15", W - padR, H - 6);
  ctx.textAlign = "left";

  const gt = document.getElementById("edGraphTime");
  if (gt) gt.textContent = new Date(e.occurred_at).toLocaleTimeString("en-IN");
}

function renderEdMetrics(e) {
  const el = document.getElementById("edMetrics");
  if (!el) return;
  const base = Number(e.speed_kmph) || 0;
  const rows = [];

  // Time-to-hit only means something for the behaviours that measure a gap.
  if (["forward_collision", "headway_warning", "pedestrian_warning"].includes(e.event_type)) {
    rows.push(["Average time-to-hit", "0.5 s"], ["Riskiest time-to-hit", "0.3 s"]);
  }
  rows.push(["Duration", (e.event_type === "fatigue" ? 40 : 21) + " s"]);
  rows.push(["Speed range", Math.max(0, Math.round(base * 0.85)) + " – " + Math.round(base) + " km/h"]);
  rows.push(["Attribution", e.attribution === "trip" ? "From the trip running at the time"
                                                     : "Vehicle's current driver — no trip was running"]);
  if (e.latitude != null) {
    rows.push(["Coordinates", Number(e.latitude).toFixed(4) + ", " + Number(e.longitude).toFixed(4)]);
  }

  el.innerHTML = rows.map(([k, v]) =>
    `<div class="ed-metric"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("") +
    (e.latitude != null
      ? `<a class="link-btn" target="_blank" rel="noopener"
           href="https://www.google.com/maps?q=${encodeURIComponent(e.latitude + "," + e.longitude)}">Open location on a map →</a>`
      : "");
}

function renderEdSide(e, session) {
  const sevCls = e.severity === "critical" ? "overdue" : e.severity === "warning" ? "soon" : "upcoming";
  document.getElementById("edSeverity").innerHTML =
    `<span class="fw-badge ${sevCls}">${esc(e.severity || "—")}</span>
     <span class="muted" style="font-size:.75rem;margin-left:6px">weight ${Number(e.weight) || 0}</span>`;

  document.getElementById("edBehaviour").innerHTML =
    `<span class="fw-badge">${esc(SF_EVENT_LABEL[e.event_type] || e.event_type)}</span>` +
    (e.is_coachable ? "" : `<div class="muted" style="font-size:.75rem;margin-top:4px">Not coachable — not the driver's behaviour.</div>`);

  const drv = _sfScores.find(s => s.driver_id === e.driver_id);
  document.getElementById("edDriver").innerHTML = drv
    ? `<strong>${esc(drv.driver_name)}</strong>` +
      (e.attribution === "assignment"
        ? `<div class="muted" style="font-size:.73rem;margin-top:3px">By current assignment — no trip was running, so this is not proof of who was driving.</div>`
        : "")
    : `<span class="muted">Unattributed</span>`;

  const veh = db.vehicles.find(v => (v.dbId || v.id) === e.vehicle_id);
  document.getElementById("edVehicle").innerHTML = veh
    ? `<strong>${esc(veh.name)}</strong><div class="muted" style="font-size:.75rem">${esc(veh.type || "")}</div>`
    : `<span class="muted">—</span>`;

  document.getElementById("edLocation").innerHTML = e.latitude != null
    ? `${Number(e.latitude).toFixed(4)}, ${Number(e.longitude).toFixed(4)}`
    : `<span class="muted">No position recorded</span>`;

  document.getElementById("edCoach").innerHTML = session
    ? `<strong>${esc((ED_STATUS[session.status] || [])[0] || session.status)}</strong>` +
      (session.coach_note ? `<div class="muted" style="font-size:.75rem;margin-top:3px">${esc(session.coach_note)}</div>` : "")
    : `<span style="color:#dc2626;font-weight:600">No assigned coach</span>
       <button class="link-btn" style="display:block;margin-top:6px" onclick="openCoachModal('${e.id}')">Assign coaching →</button>`;

  const note = document.getElementById("edNote");
  if (note) note.value = (session && session.coach_note) || "";
  const vis = document.getElementById("edNoteVisible");
  if (vis) vis.checked = !!(session && session.coach_note);
}

window.saveEventNote = async function() {
  if (!_edEvent) return;
  const text = document.getElementById("edNote").value.trim();
  if (!text) { alert("Write a note first."); return; }
  const visible = document.getElementById("edNoteVisible").checked;
  const session = _sfCoaching.find(c => c.event_id === _edEvent.id);

  if (session) {
    await fwCloud.authPatch("coaching_sessions?id=eq." + session.id, { coach_note: text });
  } else if (visible) {
    // "Visible to driver" is what turns a private note into coaching — it is
    // the act of telling him, so it creates the session rather than a note
    // sitting somewhere he will never see.
    await fwCloud.authInsert("coaching_sessions", {
      org_id: _edEvent.org_id, driver_id: _edEvent.driver_id, event_id: _edEvent.id,
      vehicle_id: _edEvent.vehicle_id, event_type: _edEvent.event_type,
      severity: _edEvent.severity, status: "assigned", coach_note: text,
    });
  } else {
    alert("Tick “Make visible to driver” to send this as coaching, or assign coaching first.");
    return;
  }
  await loadSafety();
  renderEventDetail();
};

// Leaving the page must stop both canvases.
function stopEventDetail() {
  if (_edClip) { _edClip.stop(); _edClip = null; }
  if (_edPipClip) { _edPipClip.stop(); _edPipClip = null; }
}

/* ============ FleetSafe — coaching session ============
   One sitting with one driver. The supervisor walks each behaviour that has
   gone uncoached since last time, sees the events behind it, and closes them
   together. Per-behaviour rather than per-event because "you changed lanes
   unsafely twice this week" is a conversation and five separate summonses is
   not. */

var _csMeeting = null, _csSteps = [], _csStep = 0, _csEventIdx = 0;
var _csClip = null, _csHistory = [];

window.startCoachMeeting = async function(driverId) {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) { alert("Sign in first."); return; }

  const queue = await fwCloud.authGet("v_coachable_queue",
    "select=*&driver_id=eq." + encodeURIComponent(driverId)).catch(() => []);
  if (!queue || !queue.length) { alert("Nothing waiting to be coached for this driver."); return; }

  const drv = _sfScores.find(s => s.driver_id === driverId);
  const u = fwCloud.user();

  const meeting = await fwCloud.authInsertRet("coaching_meetings", {
    org_id: queue[0].org_id, driver_id: driverId,
    coach_user_id: u && u.id ? u.id : null,
    coach_name: (u && (u.user_metadata?.full_name || u.email)) || null,
    status: "in_progress",
  });
  if (!meeting) { alert("Could not start the session."); return; }
  _csMeeting = Array.isArray(meeting) ? meeting[0] : meeting;
  _csMeeting.driver_name = drv ? drv.driver_name : "Driver";

  // Overview first, then one step per behaviour, summary last — the shape a
  // supervisor expects and the order that makes the summary meaningful.
  _csSteps = [{ kind: "overview", label: "Driver overview", done: false }]
    .concat(queue
      .sort((a, b) => b.events - a.events)
      .map(q => ({ kind: "behaviour", label: SF_EVENT_LABEL[q.event_type] || q.event_type,
                   event_type: q.event_type, events: q.events, event_ids: q.event_ids || [],
                   oldest_at: q.oldest_at, done: false })))
    .concat([{ kind: "summary", label: "Coaching summary", done: false }]);
  _csStep = 0; _csEventIdx = 0;

  _csHistory = await fwCloud.authGet("coaching_meetings",
    "select=*&driver_id=eq." + encodeURIComponent(driverId) +
    "&status=eq.completed&order=started_at.desc&limit=10").catch(() => []);

  activateTab("coachsession");
  renderCoachSession();
};

function renderCoachSession() {
  if (!_csMeeting) return;
  document.getElementById("csTitle").textContent = "Coaching — " + _csMeeting.driver_name;

  document.getElementById("csSteps").innerHTML = _csSteps.map((s, i) => `
    <li class="cs-step${i === _csStep ? " is-current" : ""}${s.done ? " is-done" : ""}">
      <span class="cs-dot"></span>
      <span>${esc(s.label)}${s.kind === "behaviour" ? ` <em>(${s.events})</em>` : ""}</span>
    </li>`).join("");

  document.getElementById("csHistory").innerHTML = _csHistory.length
    ? _csHistory.map(h => `<div class="cs-hist">
        <strong>${new Date(h.started_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</strong>
        <span class="muted"> · ${new Date(h.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        <p>${esc(h.summary_note || "Coaching session completed")}</p>
        <span class="cs-hist-by">${esc(h.coach_name || "—")}</span>
      </div>`).join("")
    : `<p class="muted" style="font-size:.82rem;margin:0">Never coached before.</p>`;

  const step = _csSteps[_csStep];
  document.getElementById("csStepTitle").textContent = step.label;

  if (step.kind === "overview")  return renderCsOverview();
  if (step.kind === "summary")   return renderCsSummary();
  renderCsBehaviour(step);
}

function renderCsOverview() {
  const drv = _sfScores.find(s => s.driver_id === _csMeeting.driver_id);
  const behaviours = _csSteps.filter(s => s.kind === "behaviour");
  document.getElementById("csWhat").textContent = drv && drv.safety_score != null
    ? `Safety score ${drv.safety_score} out of 100 over the last 30 days — ${String(drv.band).replace(/_/g, " ")}. ${drv.events_30d} events across ${Math.round(drv.km_30d).toLocaleString("en-IN")} km.`
    : "Not enough distance in the last 30 days to score this driver. The events below still stand on their own.";
  document.getElementById("csFactors").textContent = behaviours.length
    ? behaviours.map(b => `${b.label} (${b.events})`).join(", ")
    : "None";
  document.getElementById("csEventsTitle").textContent = "Behaviours to cover";
  document.getElementById("csThumbs").innerHTML = "";
  document.getElementById("csEventCard").innerHTML = behaviours.map(b =>
    `<div class="cs-ev-row"><strong>${esc(b.label)}</strong><span class="muted">${b.events} event${b.events === 1 ? "" : "s"}</span></div>`).join("");
  clearCsClip();
}

function renderCsSummary() {
  const done = _csSteps.filter(s => s.kind === "behaviour" && s.done);
  const skipped = _csSteps.filter(s => s.kind === "behaviour" && s.skipped);
  document.getElementById("csWhat").textContent =
    `${done.length} behaviour${done.length === 1 ? "" : "s"} coached` +
    (skipped.length ? `, ${skipped.length} skipped and still waiting for next time.` : ".");
  document.getElementById("csFactors").textContent =
    done.map(s => s.label).join(", ") || "None";
  document.getElementById("csEventsTitle").textContent = "Session summary";
  document.getElementById("csThumbs").innerHTML = "";
  document.getElementById("csEventCard").innerHTML =
    `<p class="muted" style="margin:0">Write a closing note below, then end the session. The driver sees it in his app.</p>`;
  clearCsClip();
}

function renderCsBehaviour(step) {
  document.getElementById("csWhat").textContent =
    `Driver generated ${step.events} ${step.label.toLowerCase()} event${step.events === 1 ? "" : "s"} that ${step.events === 1 ? "is" : "are"} coachable since the last time they were coached.`;
  document.getElementById("csFactors").textContent = "None";
  document.getElementById("csEventsTitle").textContent =
    `Coachable ${step.label.toLowerCase()} events (${step.events})`;

  const ids = step.event_ids || [];
  document.getElementById("csThumbs").innerHTML = ids.map((id, i) =>
    `<button class="cs-thumb${i === _csEventIdx ? " is-sel" : ""}" onclick="csPickEvent(${i})">${i + 1}</button>`).join("");

  const ev = _sfEvents.find(e => e.id === ids[_csEventIdx]);
  const card = document.getElementById("csEventCard");
  if (!ev) {
    card.innerHTML = `<p class="muted" style="margin:0">Event detail not loaded — open it from the events list.</p>`;
    clearCsClip();
    return;
  }
  const sev = ev.severity === "critical" ? "overdue" : ev.severity === "warning" ? "soon" : "upcoming";
  card.innerHTML = `<div class="cs-ev-head">
      <span class="fw-badge ${sev}">${esc(ev.severity)}</span>
      <span>${new Date(ev.occurred_at).toLocaleString("en-IN")}</span>
      <span class="lt-spacer"></span>
      <button class="link-btn" onclick="openEventDetail('${ev.id}')">View full details</button>
      <button class="link-btn" onclick="csDismissEvent('${ev.id}')">Dismiss event</button>
    </div>`;

  clearCsClip();
  if (window.FWDashcam) {
    _csClip = FWDashcam.renderClip(document.getElementById("csClip"), {
      url: ev.video_url || FWDashcam.makeClipRef(ev.event_type, 1),
      eventType: ev.event_type, speed: ev.speed_kmph,
      stamp: new Date(ev.occurred_at).toLocaleString("en-IN"),
    });
  }
}

function clearCsClip() {
  if (_csClip) { _csClip.stop(); _csClip = null; }
  const h = document.getElementById("csClip");
  if (h) h.innerHTML = "";
}

window.csPickEvent = function(i) { _csEventIdx = i; renderCoachSession(); };

window.csDismissEvent = async function(eventId) {
  const why = prompt("Why is this being dismissed? false_positive / not_driver_fault / duplicate / other", "false_positive");
  if (!why) return;
  await fwCloud.authPatch("coaching_sessions?event_id=eq." + eventId,
    { status: "dismissed", dismiss_reason: why, meeting_id: _csMeeting.id });
  const step = _csSteps[_csStep];
  step.event_ids = (step.event_ids || []).filter(id => id !== eventId);
  step.events = step.event_ids.length;
  _csEventIdx = 0;
  if (!step.events) coachStepAction("completed"); else renderCoachSession();
};

/* Marking a behaviour coached closes every event behind it at once — that is
   the point of grouping. Skipping leaves them assigned so they surface again
   next sitting rather than vanishing. */
window.coachStepAction = async function(outcome) {
  const step = _csSteps[_csStep];
  if (step.kind === "behaviour" && (step.event_ids || []).length) {
    const note = document.getElementById("csNote").value.trim();
    for (const id of step.event_ids) {
      await fwCloud.authPatch("coaching_sessions?event_id=eq." + id, {
        status: outcome,
        meeting_id: outcome === "completed" ? _csMeeting.id : null,
        completed_at: outcome === "completed" ? new Date().toISOString() : null,
        coach_note: note || null,
      }).catch(() => {});
    }
  }
  step.done = outcome === "completed";
  step.skipped = outcome === "skipped";
  if (_csStep < _csSteps.length - 1) { _csStep++; _csEventIdx = 0; }
  document.getElementById("csNote").value = "";
  renderCoachSession();
};

window.endCoachMeeting = async function(status) {
  if (!_csMeeting) return;
  if (status === "abandoned" && !confirm("Cancel this session? Behaviours you have not marked stay waiting.")) return;
  await fwCloud.authPatch("coaching_meetings?id=eq." + _csMeeting.id, {
    status, ended_at: new Date().toISOString(),
    summary_note: document.getElementById("csNote").value.trim() || null,
  });
  clearCsClip();
  _csMeeting = null; _csSteps = []; _csStep = 0;
  activateTab("safety");
  loadSafety();
};


/* ============ Fuel Dashboard ============
   Diesel is the largest line in an Indian fleet's P&L, and the number that
   matters is not litres bought — it is km per litre and what moved it.

   Every figure here is computed from fill-to-fill distance, never from a
   single fill. One fill tells you nothing: mileage is the gap between two
   odometer readings divided by what went in between them, which is why a
   vehicle with one fill shows no mileage rather than a made-up one. */

function fdPeriodDays() { return +(document.getElementById("fdPeriod")?.value) || 30; }

function fdWindow() {
  const days = fdPeriodDays();
  const from = new Date(); from.setDate(from.getDate() - days);
  const prevFrom = new Date(from); prevFrom.setDate(prevFrom.getDate() - days);
  return { from, prevFrom, days };
}

/* Fill-to-fill segments for one vehicle inside a date window. A segment needs
   both ends, so the fill that opens the window is included as the baseline but
   never counted as consumption. */
function fdSegments(vid, from) {
  const fills = vehicleFills(vid);
  const segs = [];
  for (let i = 1; i < fills.length; i++) {
    const a = fills[i - 1], b = fills[i];
    const dist = b.odo - a.odo;
    if (!(dist > 0) || !(b.litres > 0)) continue;
    if (new Date(b.date) < from) continue;
    segs.push({ date: b.date, dist, litres: b.litres, amount: +b.amount || 0, kmpl: dist / b.litres });
  }
  return segs;
}

function fdAggregate(from) {
  let dist = 0, litres = 0, spend = 0, segs = [];
  db.vehicles.forEach(v => {
    const s = fdSegments(v.id, from);
    s.forEach(x => { dist += x.dist; litres += x.litres; spend += x.amount; });
    segs = segs.concat(s.map(x => ({ ...x, vehicleId: v.id })));
  });
  return { dist, litres, spend, kmpl: litres > 0 ? dist / litres : null, segs };
}

function fdDelta(now, prev) {
  if (prev == null || !prev || now == null) return null;
  return ((now - prev) / prev) * 100;
}

function fdDeltaHtml(pct, goodIsUp) {
  if (pct == null || !isFinite(pct)) return `<span class="fd-flat">—</span>`;
  const up = pct >= 0;
  const good = goodIsUp ? up : !up;
  return `<span class="fd-delta ${good ? "up" : "down"}">${up ? "↑" : "↓"}${Math.abs(pct).toFixed(0)}%</span>`;
}

function renderFuelDash() {
  const { from, prevFrom } = fdWindow();
  const cur = fdAggregate(from);
  const prevAll = fdAggregate(prevFrom);
  // The previous window is everything before `from` inside the doubled span.
  const prev = {
    dist: prevAll.dist - cur.dist,
    litres: prevAll.litres - cur.litres,
    spend: prevAll.spend - cur.spend,
  };
  prev.kmpl = prev.litres > 0 ? prev.dist / prev.litres : null;

  const withFuel = db.vehicles.filter(v => fdSegments(v.id, from).length).length;
  const vc = document.getElementById("fdVehicleCount");
  if (vc) vc.textContent = withFuel + " of " + db.vehicles.length + " vehicles reporting fuel";

  const caveat = document.getElementById("fdCaveat");
  if (caveat) {
    const missing = db.vehicles.length - withFuel;
    caveat.hidden = missing <= 0;
    caveat.textContent = missing > 0
      ? `${missing} vehicle${missing === 1 ? "" : "s"} logged no usable fill pair in this period, so ${missing === 1 ? "it is" : "they are"} not in these figures. Mileage needs two odometer readings — a single fill cannot produce one.`
      : "";
  }

  // Idling is not measured without telemetry, so it is shown as unavailable
  // rather than estimated. A guessed litre of idle fuel becomes a real rupee
  // figure on this screen, and nobody would remember it was invented.
  const idleRows = (typeof _sfEvents !== "undefined" ? _sfEvents : []).length;

  const tiles = [
    ["Avg. mileage", cur.kmpl == null ? "—" : cur.kmpl.toFixed(2) + " km/L",
      fdDeltaHtml(fdDelta(cur.kmpl, prev.kmpl), true), ""],
    ["Distance", Math.round(cur.dist).toLocaleString("en-IN") + " km",
      fdDeltaHtml(fdDelta(cur.dist, prev.dist), true), ""],
    ["Diesel used", Math.round(cur.litres).toLocaleString("en-IN") + " L",
      fdDeltaHtml(fdDelta(cur.litres, prev.litres), false), fmtINR(cur.spend) + " spent"],
    ["Cost per km", cur.dist > 0 ? fmtINR(cur.spend / cur.dist) : "—",
      fdDeltaHtml(fdDelta(cur.dist > 0 ? cur.spend / cur.dist : null,
                          prev.dist > 0 ? prev.spend / prev.dist : null), false), ""],
    ["Fills logged", String(cur.segs.length), `<span class="fd-flat">—</span>`, ""],
    ["Idling", "Not measured", `<span class="fd-flat">—</span>`, "Needs a telematics feed"],
  ];

  document.getElementById("fdSummary").innerHTML = tiles.map(([k, v, d, sub]) => `
    <div class="fd-tile">
      <span class="fd-k">${k}</span>
      <span class="fd-v">${v} ${d}</span>
      ${sub ? `<span class="fd-sub">${sub}</span>` : ""}
    </div>`).join("");

  drawFdTrend(cur.segs);
  renderFdFactors(cur, prev);
  renderFdPerf(from);
}

function drawFdTrend(segs) {
  const c = document.getElementById("fdTrend");
  if (!c) return;
  const host = c.parentElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = host.clientWidth - 28 || 520, H = 220;
  c.width = W * dpr; c.height = H * dpr;
  c.style.width = "100%"; c.style.height = H + "px";
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pts = segs.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  if (pts.length < 2) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("Not enough fills in this period to plot a trend.", 14, H / 2);
    return;
  }

  const vals = pts.map(p => p.kmpl);
  const lo = Math.max(0, Math.min(...vals) * 0.9), hi = Math.max(...vals) * 1.08;
  const padL = 44, padR = 14, padT = 16, padB = 26;
  const pw = W - padL - padR, ph = H - padT - padB;
  const x = i => padL + (i / (pts.length - 1)) * pw;
  const y = v => padT + ph - ((v - lo) / (hi - lo || 1)) * ph;

  ctx.strokeStyle = "#e2e8f0"; ctx.fillStyle = "#94a3b8";
  ctx.font = "10px system-ui, sans-serif";
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3, yy = y(v);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillText(v.toFixed(1), 8, yy + 3);
  }

  // Fleet mean, so a reader can see which fills sat below the line.
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  ctx.strokeStyle = "#f5a623"; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(padL, y(mean)); ctx.lineTo(W - padR, y(mean)); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => { i ? ctx.lineTo(x(i), y(p.kmpl)) : ctx.moveTo(x(i), y(p.kmpl)); });
  ctx.stroke();

  ctx.fillStyle = "#2563eb";
  pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(x(i), y(p.kmpl), 2.6, 0, Math.PI * 2); ctx.fill(); });

  ctx.fillStyle = "#94a3b8";
  ctx.fillText(fmtDate(pts[0].date), padL, H - 8);
  ctx.textAlign = "right";
  ctx.fillText(fmtDate(pts[pts.length - 1].date), W - padR, H - 8);
  ctx.textAlign = "left";
  ctx.fillStyle = "#f5a623";
  ctx.fillText("fleet mean " + mean.toFixed(2), padL + 6, y(mean) - 5);
}

/* Only factors this app can actually measure. Cruise time, over-RPM and idle
   percentage all need an engine feed; listing them with invented numbers would
   make the whole panel untrustworthy, so they are named as unavailable. */
function renderFdFactors(cur, prev) {
  const el = document.getElementById("fdFactors");
  if (!el) return;

  const spread = (() => {
    const byVeh = {};
    cur.segs.forEach(s => { (byVeh[s.vehicleId] = byVeh[s.vehicleId] || []).push(s.kmpl); });
    const means = Object.values(byVeh).map(a => a.reduce((x, y) => x + y, 0) / a.length);
    if (means.length < 2) return null;
    return { lo: Math.min(...means), hi: Math.max(...means) };
  })();

  const rows = [];
  if (cur.kmpl != null && prev.kmpl != null) {
    const d = cur.kmpl - prev.kmpl;
    rows.push(["Mileage vs previous period",
      (d >= 0 ? "+" : "") + d.toFixed(2) + " km/L",
      d >= 0 ? "good" : "bad"]);
  }
  if (spread) {
    rows.push(["Spread across vehicles",
      spread.lo.toFixed(1) + " – " + spread.hi.toFixed(1) + " km/L",
      spread.hi - spread.lo > 1.5 ? "bad" : "good"]);
  }
  if (cur.dist > 0) {
    rows.push(["Diesel cost per km", fmtINR(cur.spend / cur.dist), "flat"]);
  }
  const worst = cur.segs.slice().sort((a, b) => a.kmpl - b.kmpl)[0];
  if (worst) {
    rows.push(["Worst single fill",
      worst.kmpl.toFixed(2) + " km/L · " + vName(worst.vehicleId), "bad"]);
  }

  el.innerHTML = rows.map(([k, v, tone]) => `
      <div class="fd-factor">
        <span>${esc(k)}</span>
        <b class="fd-${tone}">${esc(v)}</b>
      </div>`).join("") +
    `<div class="fd-unavail">
       <strong>Not measured yet:</strong> idling time, cruise time and over-RPM.
       These need an engine feed from the AIS-140 device — they are left blank
       rather than estimated, because a guessed litre becomes a real rupee figure here.
     </div>`;
}

function renderFdPerf(from) {
  const el = document.getElementById("fdPerf");
  if (!el) return;
  const rows = db.vehicles.map(v => {
    const segs = fdSegments(v.id, from);
    if (!segs.length) return null;
    const dist = segs.reduce((t, s) => t + s.dist, 0);
    const litres = segs.reduce((t, s) => t + s.litres, 0);
    const spend = segs.reduce((t, s) => t + s.amount, 0);
    return { name: v.name, kmpl: dist / litres, dist, litres, spend, fills: segs.length };
  }).filter(Boolean).sort((a, b) => b.kmpl - a.kmpl);

  if (!rows.length) {
    el.innerHTML = `<p class="muted" style="padding:14px;margin:0">No fill pairs in this period.</p>`;
    return;
  }

  const best = rows.slice(0, 5), worst = rows.slice(-5).reverse();
  const col = (title, list, tone) => `
    <div class="fd-col">
      <h4>${title}</h4>
      ${list.map(r => `<div class="fd-row">
        <span>${esc(r.name)}</span>
        <b class="fd-${tone}">${r.kmpl.toFixed(2)}</b>
        <span class="fd-row-sub">${Math.round(r.dist).toLocaleString("en-IN")} km · ${r.fills} fill${r.fills === 1 ? "" : "s"}</span>
      </div>`).join("")}
    </div>`;

  el.innerHTML = col("Best km/L", best, "good") + col("Worst km/L", worst, "bad");
}

function loadFuelDash() { renderFuelDash(); }


/* ============ FleetInsure ============
   Four covers a fleet carries and usually keeps in four different drawers:
   the motor policy per truck, personal accident for the men, goods-in-transit
   for the load, and public liability for when a truck hits something that is
   not another truck.

   The motor expiry is NOT owned here — vehicles.insurance_till drives the
   Compliance Radar and that is the date a driver gets stopped for. A policy
   saved here mirrors its expiry into that column by trigger, so the two can
   never disagree. */

var _insPolicies = [], _insClaims = [], _insRadar = [];

const INS_TYPE = {
  vehicle:   { label: "Vehicle",          icon: "truck",       sub: "Motor — comprehensive or third-party" },
  driver:    { label: "Driver",           icon: "driver",      sub: "Personal accident / group cover" },
  cargo:     { label: "Cargo",            icon: "boxes",       sub: "Goods in transit" },
  liability: { label: "Public liability", icon: "shieldCheck", sub: "Third-party property and injury" },
};

const INS_CLAIM_STATUS = {
  intimated:         ["Intimated", "upcoming"],
  surveyor_assigned: ["Surveyor assigned", "upcoming"],
  documents_pending: ["Documents pending", "soon"],
  approved:          ["Approved", "ok"],
  settled:           ["Settled", "ok"],
  rejected:          ["Rejected", "overdue"],
  withdrawn:         ["Withdrawn", ""],
};

async function loadInsure() {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) {
    ["insRadar", "insPolicies", "insClaims", "insCoverage"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<p class="muted" style="padding:14px">Sign in to see your policies.</p>`;
    });
    const s = document.getElementById("insStats"); if (s) s.innerHTML = "";
    return;
  }
  const [pol, clm, rad] = await Promise.all([
    fwCloud.authGet("insurance_policies", "select=*&order=expiry_date").catch(() => []),
    fwCloud.authGet("insurance_claims", "select=*&order=incident_date.desc").catch(() => []),
    fwCloud.authGet("v_insurance_radar", "select=*").catch(() => []),
  ]);
  _insPolicies = pol || []; _insClaims = clm || []; _insRadar = rad || [];
  renderInsure();
}

function renderInsure() {
  renderInsStats();
  renderInsRadar();
  renderInsCoverage();
  renderInsPolicies();
  renderInsClaims();
}

function renderInsStats() {
  const el = document.getElementById("insStats");
  if (!el) return;
  const active = _insRadar.filter(r => r.status === "active");
  const expired = _insRadar.filter(r => r.radar_state === "expired").length;
  const expiring = _insRadar.filter(r => r.radar_state === "expiring").length;
  const premium = _insPolicies.filter(p => p.status === "active")
    .reduce((t, p) => t + (+p.premium || 0), 0);
  const openClaims = _insClaims.filter(c =>
    !["settled", "rejected", "withdrawn"].includes(c.status)).length;

  const tiles = [
    ["Active policies", active.length],
    ["Expired", expired],
    ["Expiring in 30 days", expiring],
    ["Annual premium", fmtINR(premium)],
    ["Open claims", openClaims],
  ];
  el.innerHTML = tiles.map(([k, v]) =>
    `<div class="stat-card"><span class="stat-value">${v}</span><span class="stat-label">${k}</span></div>`).join("");

  const c = document.getElementById("insCount");
  if (c) c.textContent = _insPolicies.length + " polic" + (_insPolicies.length === 1 ? "y" : "ies");
}

function renderInsRadar() {
  const el = document.getElementById("insRadar");
  if (!el) return;
  const rank = { expired: 0, expiring: 1, no_expiry_set: 2, ok: 3, inactive: 4 };
  const rows = _insRadar.slice().sort((a, b) =>
    (rank[a.radar_state] - rank[b.radar_state]) || ((a.days_left ?? 9e9) - (b.days_left ?? 9e9)));

  if (!rows.length) {
    el.innerHTML = `<p class="muted" style="padding:14px;margin:0">No policies yet. Add one to start the renewal radar.</p>`;
    return;
  }

  el.innerHTML = `<table class="chart-table-el" style="width:100%">
    <thead><tr><th>Cover</th><th>Subject</th><th>Insurer</th><th>Policy no.</th><th>Expires</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r => {
      const t = INS_TYPE[r.policy_type] || { label: r.policy_type };
      const st = {
        expired:       ["overdue",  "Expired"],
        expiring:      ["soon",     (r.days_left ?? 0) + "d left"],
        ok:            ["ok",       (r.days_left ?? 0) + "d left"],
        no_expiry_set: ["upcoming", "No expiry set"],
        inactive:      ["",         r.status],
      }[r.radar_state] || ["", r.radar_state];
      return `<tr>
        <td><span class="fw-badge">${esc(t.label)}</span></td>
        <td><strong>${esc(r.subject)}</strong></td>
        <td>${esc(r.insurer || "—")}</td>
        <td>${esc(r.policy_no || "—")}</td>
        <td>${r.expiry_date ? fmtDate(r.expiry_date) : "—"}</td>
        <td><span class="fw-badge ${st[0]}">${esc(st[1])}</span></td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

/* The useful half of this panel is what is NOT covered. A fleet that has never
   bought goods-in-transit usually does not know it, and finds out on the day a
   load burns. */
function renderInsCoverage() {
  const el = document.getElementById("insCoverage");
  if (!el) return;
  const vehiclesCovered = new Set(_insPolicies
    .filter(p => p.policy_type === "vehicle" && p.status === "active").map(p => p.vehicle_id));
  const driversCovered = new Set(_insPolicies
    .filter(p => p.policy_type === "driver" && p.status === "active").map(p => p.driver_id));
  const hasCargo = _insPolicies.some(p => p.policy_type === "cargo" && p.status === "active");
  const hasLiab  = _insPolicies.some(p => p.policy_type === "liability" && p.status === "active");

  const totalVeh = db.vehicles.length, totalDrv = db.drivers.length;
  const rows = [
    ["vehicle", `${vehiclesCovered.size} of ${totalVeh} vehicles`,
      vehiclesCovered.size >= totalVeh && totalVeh > 0,
      totalVeh - vehiclesCovered.size > 0 ? `${totalVeh - vehiclesCovered.size} uninsured — a motor policy is legally required to be on the road` : ""],
    ["driver", `${driversCovered.size} of ${totalDrv} drivers`,
      driversCovered.size >= totalDrv && totalDrv > 0,
      totalDrv - driversCovered.size > 0 ? `${totalDrv - driversCovered.size} without personal accident cover` : ""],
    ["cargo", hasCargo ? "Open policy in force" : "No cover",
      hasCargo, hasCargo ? "" : "A load lost or damaged in transit is uninsured"],
    ["liability", hasLiab ? "Policy in force" : "No cover",
      hasLiab, hasLiab ? "" : "Third-party property damage beyond the motor policy is uninsured"],
  ];

  el.innerHTML = rows.map(([type, value, ok, warn]) => {
    const t = INS_TYPE[type];
    return `<div class="ins-cover">
      <span class="ins-cover-ic">${FWIcon(t.icon, { size: 17 })}</span>
      <div class="ins-cover-main">
        <strong>${esc(t.label)}</strong>
        <span class="muted">${esc(t.sub)}</span>
        ${warn ? `<div class="ins-gap">${esc(warn)}</div>` : ""}
      </div>
      <span class="fw-badge ${ok ? "ok" : "soon"}">${esc(value)}</span>
    </div>`;
  }).join("");
}

function renderInsPolicies() {
  const el = document.getElementById("insPolicies");
  if (!el) return;
  if (!_insPolicies.length) {
    el.innerHTML = `<p class="muted" style="padding:14px;margin:0">No policies recorded.</p>`;
    return;
  }
  el.innerHTML = `<table class="chart-table-el" style="width:100%">
    <thead><tr><th>Type</th><th>Subject</th><th>Insurer</th><th>Cover</th><th>Sum insured</th><th>Premium</th><th>Period</th><th></th></tr></thead>
    <tbody>${_insPolicies.map(p => {
      const t = INS_TYPE[p.policy_type] || { label: p.policy_type };
      const veh = p.vehicle_id ? db.vehicles.find(v => (v.dbId || v.id) === p.vehicle_id) : null;
      const drv = p.driver_id ? db.drivers.find(d => (d.dbId || d.id) === p.driver_id) : null;
      return `<tr>
        <td><span class="fw-badge">${esc(t.label)}</span></td>
        <td>${esc(veh ? veh.name : drv ? drv.name : "Fleet-wide")}</td>
        <td>${esc(p.insurer || "—")}<div class="muted" style="font-size:.74rem">${esc(p.policy_no || "")}</div></td>
        <td>${esc(p.cover_type || "—")}</td>
        <td>${p.sum_insured ? fmtINR(p.sum_insured) : "—"}</td>
        <td>${p.premium ? fmtINR(p.premium) : "—"}</td>
        <td>${p.start_date ? fmtDate(p.start_date) : "—"} → ${p.expiry_date ? fmtDate(p.expiry_date) : "—"}</td>
        <td>${p.status === "cancelled" ? `<span class="muted">cancelled</span>`
              : `<button class="link-btn" onclick="deletePolicy('${p.id}')">Cancel</button>`}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

function renderInsClaims() {
  const el = document.getElementById("insClaims");
  if (!el) return;
  if (!_insClaims.length) {
    el.innerHTML = `<p class="muted" style="padding:14px;margin:0">No claims recorded.</p>`;
    return;
  }
  el.innerHTML = `<table class="chart-table-el" style="width:100%">
    <thead><tr><th>Claim</th><th>Incident</th><th>Vehicle</th><th>Claimed</th><th>Approved</th><th>Status</th></tr></thead>
    <tbody>${_insClaims.map(c => {
      const st = INS_CLAIM_STATUS[c.status] || [c.status, ""];
      const veh = c.vehicle_id ? db.vehicles.find(v => (v.dbId || v.id) === c.vehicle_id) : null;
      const shortfall = c.claimed_amount && c.approved_amount != null
        ? (+c.claimed_amount) - (+c.approved_amount) : null;
      return `<tr>
        <td><strong>${esc(c.claim_no || "—")}</strong><div class="muted" style="font-size:.75rem">${esc((c.description || "").slice(0, 50))}</div></td>
        <td>${c.incident_date ? fmtDate(c.incident_date) : "—"}</td>
        <td>${esc(veh ? veh.name : "—")}</td>
        <td>${c.claimed_amount ? fmtINR(c.claimed_amount) : "—"}</td>
        <td>${c.approved_amount != null ? fmtINR(c.approved_amount) : "—"}
            ${shortfall > 0 ? `<div class="muted" style="font-size:.73rem;color:#dc2626">${fmtINR(shortfall)} short</div>` : ""}</td>
        <td><span class="fw-badge ${st[1]}">${esc(st[0])}</span></td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

async function insOrgId() {
  const rows = await fwCloud.authGet("memberships", "select=org_id&limit=1").catch(() => null);
  return rows && rows[0] ? rows[0].org_id : null;
}

window.openPolicyModal = async function() {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) { alert("Sign in first."); return; }
  const type = prompt("Cover type — vehicle, driver, cargo or liability:", "vehicle");
  if (!type || !INS_TYPE[type]) { if (type) alert("Must be one of: vehicle, driver, cargo, liability."); return; }

  const row = { policy_type: type, status: "active" };
  if (type === "vehicle") {
    const name = prompt("Which vehicle? (registration as shown in your fleet)");
    const v = db.vehicles.find(x => x.name.toLowerCase() === (name || "").trim().toLowerCase());
    if (!v) { alert("No vehicle with that registration."); return; }
    row.vehicle_id = v.dbId || v.id;
  } else if (type === "driver") {
    const name = prompt("Which driver?");
    const d = db.drivers.find(x => x.name.toLowerCase() === (name || "").trim().toLowerCase());
    if (!d) { alert("No driver with that name."); return; }
    row.driver_id = d.dbId || d.id;
  }

  row.insurer = (prompt("Insurer:") || "").trim() || null;
  row.policy_no = (prompt("Policy number:") || "").trim() || null;
  row.cover_type = (prompt("Cover (comprehensive / third-party / group PA / open GIT / CGL):") || "").trim() || null;
  const sum = prompt("Sum insured (₹), blank to skip:");
  if (sum) row.sum_insured = +sum;
  const prem = prompt("Annual premium (₹), blank to skip:");
  if (prem) row.premium = +prem;
  row.start_date = (prompt("Start date (YYYY-MM-DD):") || "").trim() || null;
  row.expiry_date = (prompt("Expiry date (YYYY-MM-DD):") || "").trim() || null;

  row.org_id = await insOrgId();
  if (!row.org_id) { alert("Could not resolve your organisation."); return; }

  const ok = await fwCloud.authInsert("insurance_policies", row);
  if (!ok) { alert("Could not save — check the dates are YYYY-MM-DD."); return; }
  loadInsure();
};

window.openClaimModal = async function() {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) { alert("Sign in first."); return; }
  const row = { status: "intimated" };
  row.claim_no = (prompt("Claim number:") || "").trim() || null;
  row.incident_date = (prompt("Incident date (YYYY-MM-DD):") || "").trim() || null;
  row.description = (prompt("What happened?") || "").trim() || null;
  const amt = prompt("Amount claimed (₹), blank to skip:");
  if (amt) row.claimed_amount = +amt;
  const vname = prompt("Vehicle registration, blank if not vehicle-related:");
  if (vname) {
    const v = db.vehicles.find(x => x.name.toLowerCase() === vname.trim().toLowerCase());
    if (v) row.vehicle_id = v.dbId || v.id;
  }
  row.org_id = await insOrgId();
  if (!row.org_id) { alert("Could not resolve your organisation."); return; }
  const ok = await fwCloud.authInsert("insurance_claims", row);
  if (!ok) { alert("Could not save the claim."); return; }
  loadInsure();
};

/* Cancelled rather than deleted. A policy that covered a period still explains
   why a claim from that period was paid, and dropping the row would orphan the
   claim's only context. */
window.deletePolicy = async function(id) {
  if (!confirm("Mark this policy cancelled? It stays on record so its claims keep their context.")) return;
  const ok = await fwCloud.authPatch("insurance_policies?id=eq." + id, { status: "cancelled" });
  if (!ok) { alert("Could not update the policy."); return; }
  loadInsure();
};
