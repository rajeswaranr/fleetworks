/* ============ FleetWorks — dashboard.js ============
   AI/ML fleet expense analytics:
   - monthly / vehicle-wise / part-wise aggregation
   - fleet-average and industry-average benchmarking
   - expense forecasting (least-squares regression on monthly totals)
   - part-replacement prediction from usage rate + lifespan models
   Data lives in localStorage ("ff_fleet"); nothing leaves the browser. */

"use strict";

// ---------- Chart palette (validated categorical slots + chrome) ----------
const PAL = {
  s1: "#2a78d6",        // series 1 (blue)  — "you / actual"
  s1soft: "#9ec5f4",    // lighter step of the same ramp — forecast
  s2: "#1baf7a",        // series 2 (aqua)  — fleet average
  s3: "#eda100",        // series 3 (yellow)— industry average
  good: "#0ca30c", warn: "#fab219", serious: "#ec835a", critical: "#d03b3b",
  ink: "#0b0b0b", ink2: "#52514e", muted: "#898781",
  grid: "#e1e0d9", baseline: "#c3c2b7", surface: "#ffffff"
};

// ---------- Industry reference data (indicative, India CV market) ----------
const INDUSTRY = {
  // maintenance cost per km (INR) by vehicle class
  costPerKm: {
    "Truck (HCV)": 3.2, "LCV": 1.9, "Bus": 3.6,
    "Tipper": 4.1, "Trailer": 3.4, "Tanker": 3.3
  },
  // wear parts: typical lifespan + typical replacement cost (INR)
  parts: {
    "Tyres":                { km: 70000,  months: 30, cost: 68000, note: "full axle set, HCV" },
    "Battery":              { km: null,   months: 27, cost: 14500, note: "2 x 12V heavy duty" },
    "Brakes":               { km: 45000,  months: 18, cost: 9500,  note: "liners + drums skimming" },
    "Clutch":               { km: 90000,  months: 36, cost: 22000, note: "plate + pressure plate" },
    "Engine Oil & Filters": { km: 15000,  months: 6,  cost: 8500,  note: "oil + oil/fuel/air filters" },
    "Suspension":           { km: 80000,  months: 30, cost: 16000, note: "leaf springs + bushes" },
    "Electrical":           { km: null,   months: 24, cost: 6000,  note: "alternator/starter refurb" }
  }
};

// ---------- Data layer ----------
const STORE_KEY = "ff_fleet";

function loadStore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    // spread first: preserves Fleet Manager collections (fuelLogs, issues, ...)
    return { ...d, vehicles: d.vehicles || [], expenses: d.expenses || [] };
  } catch { return { vehicles: [], expenses: [] }; }
}
function saveStore(d) {
  localStorage.setItem(STORE_KEY, JSON.stringify(d));
  if (window.fwCloud) window.fwCloud.push(d);
}

let db = loadStore();

// ---------- Utilities ----------
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthKey(dateStr) { return dateStr.slice(0, 7); }               // "2026-07"
function monthLabel(key) { const [y, m] = key.split("-"); return MONTHS[+m - 1] + " '" + y.slice(2); }
function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function monthDiff(a, b) { // b - a in months
  const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}
function todayKey() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

function fmtINR(v) {
  if (v >= 10000000) return "₹" + (v / 10000000).toFixed(1) + "Cr";
  if (v >= 100000)   return "₹" + (v / 100000).toFixed(1) + "L";
  if (v >= 1000)     return "₹" + (v / 1000).toFixed(1) + "K";
  return "₹" + Math.round(v);
}
function fmtINRfull(v) { return "₹" + Math.round(v).toLocaleString("en-IN"); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- ML: least-squares linear regression forecast ----------
function forecastMonthly(totals, horizon) {
  // totals: [{key, amount}] chronological. Returns horizon forecast points.
  const n = totals.length;
  if (n === 0) return [];
  if (n < 3) { // not enough signal: flat forecast at mean
    const avg = mean(totals.map(t => t.amount));
    return Array.from({ length: horizon }, (_, i) => ({ key: addMonths(totals[n - 1].key, i + 1), amount: avg }));
  }
  const xs = totals.map((_, i) => i), ys = totals.map(t => t.amount);
  const xm = mean(xs), ym = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xm) * (ys[i] - ym); den += (xs[i] - xm) ** 2; }
  const b = den ? num / den : 0, a = ym - b * xm;
  // damp the slope so a few noisy months don't explode the projection
  const damp = 0.6;
  return Array.from({ length: horizon }, (_, i) => {
    const x = n + i;
    const raw = a + b * damp * x;
    return { key: addMonths(totals[n - 1].key, i + 1), amount: Math.max(raw, ym * 0.3) };
  });
}

// ---------- Aggregations ----------
function filteredExpenses() {
  const veh = document.getElementById("vehicleFilter").value;
  const months = +document.getElementById("periodFilter").value;
  const cutoff = addMonths(todayKey(), -(months - 1));
  return db.expenses.filter(e =>
    (veh === "all" || e.vehicleId === veh) && monthKey(e.date) >= cutoff
  );
}

function monthlySeries(expenses) {
  const map = {};
  expenses.forEach(e => { const k = monthKey(e.date); map[k] = (map[k] || 0) + e.amount; });
  const keys = Object.keys(map).sort();
  if (!keys.length) return [];
  // fill gaps so the axis is continuous
  const out = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k = addMonths(k, 1)) {
    out.push({ key: k, amount: map[k] || 0 });
  }
  return out;
}

function vehicleStats() {
  // cost/km per vehicle over the filtered window (uses each vehicle's usage rate)
  const months = +document.getElementById("periodFilter").value;
  const cutoff = addMonths(todayKey(), -(months - 1));
  return db.vehicles.map(v => {
    const spend = db.expenses
      .filter(e => e.vehicleId === v.id && monthKey(e.date) >= cutoff)
      .reduce((s, e) => s + e.amount, 0);
    const firstK = db.expenses.filter(e => e.vehicleId === v.id).map(e => monthKey(e.date)).sort()[0];
    const activeMonths = Math.min(months, firstK ? monthDiff(firstK, todayKey()) + 1 : months);
    const km = v.kmPerMonth * Math.max(activeMonths, 1);
    return {
      ...v, spend,
      costPerKm: km ? spend / km : 0,
      industry: INDUSTRY.costPerKm[v.type] || 3.0
    };
  });
}

function partStats(expenses) {
  const map = {};
  expenses.forEach(e => {
    if (!map[e.category]) map[e.category] = { total: 0, count: 0 };
    map[e.category].total += e.amount; map[e.category].count++;
  });
  return Object.entries(map)
    .map(([cat, s]) => ({
      category: cat, total: s.total, count: s.count,
      avg: s.total / s.count,
      industryCost: INDUSTRY.parts[cat] ? INDUSTRY.parts[cat].cost : null
    }))
    .sort((a, b) => b.total - a.total);
}

// ---------- ML: part replacement prediction ----------
function predictParts() {
  const preds = [];
  const now = new Date();
  db.vehicles.forEach(v => {
    Object.entries(INDUSTRY.parts).forEach(([cat, ref]) => {
      const history = db.expenses
        .filter(e => e.vehicleId === v.id && e.category === cat)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!history.length) return;
      const last = history[history.length - 1];

      // Expected lifespan: blend the fleet's observed interval with industry data.
      const fleetGaps = [];
      db.vehicles.forEach(v2 => {
        const h2 = db.expenses
          .filter(e => e.vehicleId === v2.id && e.category === cat)
          .sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 1; i < h2.length; i++) fleetGaps.push(monthDiff(monthKey(h2[i - 1].date), monthKey(h2[i].date)));
      });
      const observed = median(fleetGaps.filter(g => g > 0));
      const industryMonths = ref.km ? Math.min(ref.months, ref.km / v.kmPerMonth) : ref.months;
      const expectedMonths = observed ? 0.6 * observed + 0.4 * industryMonths : industryMonths;

      const elapsed = (now - new Date(last.date)) / (1000 * 3600 * 24 * 30.44);
      const lifeUsed = Math.min(elapsed / expectedMonths, 1.5);
      const monthsLeft = Math.max(expectedMonths - elapsed, 0);
      const dueDate = new Date(now.getTime() + monthsLeft * 30.44 * 24 * 3600 * 1000);

      // Expected cost: fleet's own average for this part, else industry figure.
      const fleetCosts = db.expenses.filter(e => e.category === cat).map(e => e.amount);
      const estCost = fleetCosts.length ? mean(fleetCosts) : ref.cost;

      preds.push({
        vehicle: v, category: cat, lifeUsed,
        kmLeft: Math.round(monthsLeft * v.kmPerMonth),
        dueDate, estCost, monthsLeft,
        basis: observed ? "your fleet history + industry model" : "industry lifespan model"
      });
    });
  });
  return preds.sort((a, b) => a.monthsLeft - b.monthsLeft);
}

// ---------- SVG chart helpers ----------
function svgEl(w, h) {
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="min-width:${Math.min(w, 900)}px;display:block;font-family:inherit">`;
}
function yTicks(maxV) {
  // clean tick steps: 1/2/5 * 10^n
  const raw = maxV / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) || pow;
  const ticks = [];
  for (let t = 0; t <= maxV * 1.05; t += step) ticks.push(t);
  return ticks;
}
// Column with 4px rounded top (data end), square baseline
function colPath(x, yTop, w, yBase) {
  const r = Math.min(4, w / 2, (yBase - yTop));
  if (yBase - yTop < 1) return "";
  return `M${x},${yBase} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yBase} Z`;
}
// Horizontal bar with 4px rounded right end, square at left baseline
function barPath(x0, y, len, h) {
  const r = Math.min(4, h / 2, len);
  if (len < 1) return "";
  return `M${x0},${y} L${x0 + len - r},${y} Q${x0 + len},${y} ${x0 + len},${y + r} L${x0 + len},${y + h - r} Q${x0 + len},${y + h} ${x0 + len - r},${y + h} L${x0},${y + h} Z`;
}
function legendHTML(items) {
  return items.map(i => `<span class="lg-item"><span class="lg-swatch" style="background:${i.color}"></span>${esc(i.label)}</span>`).join("");
}

// Shared tooltip
const tip = () => document.getElementById("vizTooltip");
function bindTips(container) {
  container.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("mousemove", (ev) => {
      const t = tip();
      t.innerHTML = el.dataset.tip;
      t.hidden = false;
      const pad = 14;
      let x = ev.clientX + pad, y = ev.clientY + pad;
      const r = t.getBoundingClientRect();
      if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
      if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
      t.style.left = x + "px"; t.style.top = y + "px";
    });
    el.addEventListener("mouseleave", () => { tip().hidden = true; });
  });
}

// ---------- Render: stat tiles ----------
function renderStats() {
  const nowK = todayKey();
  const thisMonth = db.expenses.filter(e => monthKey(e.date) === nowK).reduce((s, e) => s + e.amount, 0);
  const vs = vehicleStats();
  const fleetCpk = mean(vs.filter(v => v.costPerKm > 0).map(v => v.costPerKm));
  const indCpk = mean(vs.map(v => v.industry));
  const deltaPct = indCpk ? ((fleetCpk - indCpk) / indCpk) * 100 : 0;
  const monthly = monthlySeries(db.expenses);
  const fc = forecastMonthly(monthly.slice(-12), 3);
  const fcTotal = fc.reduce((s, f) => s + f.amount, 0);

  const deltaGood = deltaPct <= 0;
  document.getElementById("statRow").innerHTML = `
    <div class="stat-tile"><span class="stat-label">Spend this month</span><span class="stat-value">${fmtINR(thisMonth)}</span><span class="stat-sub">${nowK ? monthLabel(nowK) : ""}</span></div>
    <div class="stat-tile"><span class="stat-label">Fleet cost per km</span><span class="stat-value">₹${fleetCpk.toFixed(2)}</span>
      <span class="stat-sub" style="color:${deltaGood ? "#006300" : PAL.critical}">${deltaGood ? "▼" : "▲"} ${Math.abs(deltaPct).toFixed(0)}% vs industry ₹${indCpk.toFixed(2)}</span></div>
    <div class="stat-tile"><span class="stat-label">Forecast, next 3 months</span><span class="stat-value">${fmtINR(fcTotal)}</span><span class="stat-sub">ML regression on your history</span></div>
    <div class="stat-tile"><span class="stat-label">Vehicles tracked</span><span class="stat-value">${db.vehicles.length}</span><span class="stat-sub">${db.expenses.length} expense records</span></div>`;
}

// ---------- Render: monthly chart ----------
function renderMonthly() {
  const data = monthlySeries(filteredExpenses());
  const box = document.getElementById("monthlyChart");
  if (!data.length) { box.innerHTML = "<p class='muted'>No expenses in this window.</p>"; return; }
  const fc = forecastMonthly(data, 3);
  const all = [...data.map(d => ({ ...d, type: "actual" })), ...fc.map(d => ({ ...d, type: "forecast" }))];

  const H = 260, padL = 56, padB = 34, padT = 18, padR = 10;
  const slot = Math.max(34, Math.min(64, 820 / all.length));
  const W = padL + padR + slot * all.length;
  const maxV = Math.max(...all.map(d => d.amount)) * 1.08;
  const ticks = yTicks(maxV);
  const yMax = ticks[ticks.length - 1] || 1;
  const y = v => padT + (H - padT - padB) * (1 - v / yMax);
  const base = y(0);

  let s = svgEl(W, H);
  ticks.forEach(t => {
    s += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${t === 0 ? PAL.baseline : PAL.grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${PAL.muted}" style="font-variant-numeric:tabular-nums">${fmtINR(t)}</text>`;
  });
  const bw = Math.min(24, slot - 12);
  const maxIdx = all.reduce((mi, d, i) => d.type === "actual" && d.amount > all[mi].amount ? i : mi, 0);
  all.forEach((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const fill = d.type === "actual" ? PAL.s1 : PAL.s1soft;
    const tipTxt = `<strong>${monthLabel(d.key)}</strong><br>${d.type === "forecast" ? "Forecast: " : ""}${fmtINRfull(d.amount)}`;
    s += `<path d="${colPath(x, y(d.amount), bw, base)}" fill="${fill}" data-tip="${esc(tipTxt)}"/>`;
    // selective labels: the max actual + each forecast cap
    if (i === maxIdx || d.type === "forecast") {
      s += `<text x="${x + bw / 2}" y="${y(d.amount) - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${PAL.ink2}">${fmtINR(d.amount)}</text>`;
    }
    if (i % Math.ceil(all.length / 14) === 0 || d.type === "forecast") {
      s += `<text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${PAL.muted}">${monthLabel(d.key)}</text>`;
    }
  });
  s += "</svg>";
  box.innerHTML = s;
  document.getElementById("monthlyLegend").innerHTML = legendHTML([
    { color: PAL.s1, label: "Actual" }, { color: PAL.s1soft, label: "Forecast (ML)" }
  ]);
  document.getElementById("monthlyTable").innerHTML =
    "<table><thead><tr><th>Month</th><th>Spend</th><th>Type</th></tr></thead><tbody>" +
    all.map(d => `<tr><td>${monthLabel(d.key)}</td><td>${fmtINRfull(d.amount)}</td><td>${d.type}</td></tr>`).join("") +
    "</tbody></table>";
  bindTips(box);
}

// ---------- Render: vehicle chart ----------
function renderVehicles() {
  const vs = vehicleStats().filter(v => v.spend > 0);
  const box = document.getElementById("vehicleChart");
  if (!vs.length) { box.innerHTML = "<p class='muted'>No vehicle expenses yet.</p>"; return; }
  const fleetAvg = mean(vs.map(v => v.costPerKm));

  const H = 260, padL = 46, padB = 40, padT = 18, padR = 10;
  const group = Math.max(96, Math.min(150, 840 / vs.length));
  const W = padL + padR + group * vs.length;
  const maxV = Math.max(...vs.map(v => Math.max(v.costPerKm, fleetAvg, v.industry))) * 1.15;
  const ticks = yTicks(maxV);
  const yMax = ticks[ticks.length - 1] || 1;
  const y = v => padT + (H - padT - padB) * (1 - v / yMax);
  const base = y(0);

  let s = svgEl(W, H);
  ticks.forEach(t => {
    s += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${t === 0 ? PAL.baseline : PAL.grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${PAL.muted}" style="font-variant-numeric:tabular-nums">₹${t.toFixed(t < 3 ? 1 : 0)}</text>`;
  });
  const bw = 20, gap = 2;
  vs.forEach((v, i) => {
    const cx = padL + group * i + group / 2;
    const x0 = cx - (bw * 3 + gap * 2) / 2;
    const bars = [
      { val: v.costPerKm, color: PAL.s1, name: esc(v.name) },
      { val: fleetAvg, color: PAL.s2, name: "Fleet average" },
      { val: v.industry, color: PAL.s3, name: "Industry (" + esc(v.type) + ")" }
    ];
    bars.forEach((b, j) => {
      const x = x0 + j * (bw + gap);
      const tipTxt = `<strong>${b.name}</strong><br>₹${b.val.toFixed(2)} / km`;
      s += `<path d="${colPath(x, y(b.val), bw, base)}" fill="${b.color}" data-tip="${esc(tipTxt)}"/>`;
    });
    // direct label: this vehicle's own value on its cap
    s += `<text x="${x0 + bw / 2}" y="${y(v.costPerKm) - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${PAL.ink2}">₹${v.costPerKm.toFixed(2)}</text>`;
    s += `<text x="${cx}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${PAL.ink2}">${esc(v.name.length > 14 ? v.name.slice(0, 13) + "…" : v.name)}</text>`;
  });
  s += "</svg>";
  box.innerHTML = s;
  document.getElementById("vehicleLegend").innerHTML = legendHTML([
    { color: PAL.s1, label: "This vehicle" }, { color: PAL.s2, label: "Your fleet avg" }, { color: PAL.s3, label: "Industry avg" }
  ]);
  document.getElementById("vehicleTable").innerHTML =
    "<table><thead><tr><th>Vehicle</th><th>Type</th><th>Spend</th><th>₹/km</th><th>Fleet avg</th><th>Industry</th></tr></thead><tbody>" +
    vs.map(v => `<tr><td>${esc(v.name)}</td><td>${esc(v.type)}</td><td>${fmtINRfull(v.spend)}</td><td>₹${v.costPerKm.toFixed(2)}</td><td>₹${fleetAvg.toFixed(2)}</td><td>₹${v.industry.toFixed(2)}</td></tr>`).join("") +
    "</tbody></table>";
  bindTips(box);
}

// ---------- Render: part chart ----------
function renderParts() {
  const ps = partStats(filteredExpenses());
  const box = document.getElementById("partChart");
  if (!ps.length) { box.innerHTML = "<p class='muted'>No expenses in this window.</p>"; return; }

  const rowH = 34, padL = 150, padR = 90, padT = 6;
  const H = padT + rowH * ps.length + 8;
  const W = 860;
  const maxV = Math.max(...ps.map(p => p.total));
  const len = v => (W - padL - padR) * (v / maxV);

  let s = svgEl(W, H);
  s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - 4}" stroke="${PAL.baseline}" stroke-width="1"/>`;
  ps.forEach((p, i) => {
    const yy = padT + rowH * i + (rowH - 20) / 2;
    const tipTxt = `<strong>${esc(p.category)}</strong><br>Total: ${fmtINRfull(p.total)}<br>${p.count} job${p.count > 1 ? "s" : ""} · avg ${fmtINRfull(p.avg)}` +
      (p.industryCost ? `<br>Industry avg/job: ${fmtINRfull(p.industryCost)}` : "");
    s += `<text x="${padL - 8}" y="${yy + 14}" text-anchor="end" font-size="12" fill="${PAL.ink2}">${esc(p.category)}</text>`;
    s += `<path d="${barPath(padL, yy, len(p.total), 20)}" fill="${PAL.s1}" data-tip="${esc(tipTxt)}"/>`;
    s += `<text x="${padL + len(p.total) + 8}" y="${yy + 14}" font-size="11" font-weight="600" fill="${PAL.ink2}" style="font-variant-numeric:tabular-nums">${fmtINR(p.total)}</text>`;
  });
  s += "</svg>";
  box.innerHTML = s;
  document.getElementById("partTable").innerHTML =
    "<table><thead><tr><th>Part / category</th><th>Total</th><th>Jobs</th><th>Your avg/job</th><th>Industry avg/job</th></tr></thead><tbody>" +
    ps.map(p => `<tr><td>${esc(p.category)}</td><td>${fmtINRfull(p.total)}</td><td>${p.count}</td><td>${fmtINRfull(p.avg)}</td><td>${p.industryCost ? fmtINRfull(p.industryCost) : "—"}</td></tr>`).join("") +
    "</tbody></table>";
  bindTips(box);
}

// ---------- Render: predictions ----------
function renderPredictions() {
  const preds = predictParts().slice(0, 10);
  const box = document.getElementById("predictions");
  if (!preds.length) {
    box.innerHTML = "<p class='muted'>Add part expenses (tyres, battery, brakes…) and the model will start predicting replacements.</p>";
    return;
  }
  box.innerHTML = preds.map(p => {
    const pct = Math.min(p.lifeUsed * 100, 100);
    let status, icon, color;
    if (p.lifeUsed >= 1)        { status = "Overdue";  icon = "🔴"; color = PAL.critical; }
    else if (p.lifeUsed >= 0.85){ status = "Due soon"; icon = "🟠"; color = PAL.serious; }
    else if (p.lifeUsed >= 0.6) { status = "Plan ahead"; icon = "🟡"; color = PAL.warn; }
    else                        { status = "Healthy";  icon = "🟢"; color = PAL.good; }
    const due = p.lifeUsed >= 1 ? "now" :
      "~" + p.dueDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) +
      (p.kmLeft > 0 ? " · " + p.kmLeft.toLocaleString("en-IN") + " km left" : "");
    return `
      <div class="pred-row">
        <div class="pred-main">
          <strong>${esc(p.vehicle.name)}</strong> — ${esc(p.category)}
          <span class="pred-status" style="color:${color}">${icon} ${status}</span>
        </div>
        <div class="pred-meter"><div class="pred-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="pred-detail">
          <span>Replace ${due}</span>
          <span>Est. cost: <strong>${fmtINRfull(p.estCost)}</strong></span>
          <span class="muted">${pct.toFixed(0)}% of expected life used · ${esc(p.basis)}</span>
        </div>
      </div>`;
  }).join("");
}

// ---------- Demo data (deterministic) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadDemo() {
  const rnd = mulberry32(42);
  const vehicles = [
    { id: "v1", name: "TN-01-AB-1234", type: "Truck (HCV)", kmPerMonth: 9000 },
    { id: "v2", name: "TN-09-CD-5678", type: "Truck (HCV)", kmPerMonth: 7500 },
    { id: "v3", name: "TN-22-EF-3456", type: "Tipper", kmPerMonth: 4200 },
    { id: "v4", name: "KA-05-GH-7890", type: "Bus", kmPerMonth: 11000 },
    { id: "v5", name: "TN-45-JK-2468", type: "LCV", kmPerMonth: 5200 }
  ];
  const expenses = [];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 17, 1);

  const partPlans = {
    "Engine Oil & Filters": { every: 2, cost: [7000, 10500], jitter: 1 },
    "Brakes":               { every: 7, cost: [7500, 12000], jitter: 2 },
    "Tyres":                { every: 9, cost: [52000, 78000], jitter: 3 },
    "Battery":              { every: 13, cost: [11500, 16500], jitter: 3 },
    "Electrical":           { every: 6, cost: [2500, 8000], jitter: 2 },
    "Suspension":           { every: 10, cost: [9000, 19000], jitter: 3 },
    "Clutch":               { every: 15, cost: [18000, 26000], jitter: 3 }
  };

  vehicles.forEach((v, vi) => {
    Object.entries(partPlans).forEach(([cat, plan]) => {
      let m = Math.floor(rnd() * plan.every); // random phase
      while (m < 18) {
        const d = new Date(start.getFullYear(), start.getMonth() + m, 3 + Math.floor(rnd() * 24));
        if (d <= now) {
          const scale = v.type === "LCV" ? 0.55 : v.type === "Tipper" ? 1.15 : 1;
          const amount = Math.round((plan.cost[0] + rnd() * (plan.cost[1] - plan.cost[0])) * scale / 100) * 100;
          expenses.push({
            vehicleId: v.id, date: d.toISOString().slice(0, 10),
            category: cat, amount
          });
        }
        m += plan.every + Math.floor(rnd() * plan.jitter);
      }
    });
    // occasional misc jobs
    for (let m = 0; m < 18; m++) {
      if (rnd() < 0.25) {
        const d = new Date(start.getFullYear(), start.getMonth() + m, 5 + Math.floor(rnd() * 20));
        if (d <= now) expenses.push({
          vehicleId: v.id, date: d.toISOString().slice(0, 10),
          category: "Other", amount: Math.round((1500 + rnd() * 6000) / 100) * 100
        });
      }
    }
  });

  db = { ...db, vehicles, expenses, demo: true };
  saveStore(db);
  renderAll();
}

// ---------- Tally export (GST & accounting) ----------
// Generates Tally-importable XML (Tally Prime / ERP 9): one Payment voucher
// per expense, debiting a "Vehicle Maintenance - <category>" expense ledger
// and crediting Cash. Ledger masters are included so import works on a
// fresh company. Import via Gateway of Tally > Import Data > Vouchers.
function xmlEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function exportTally() {
  if (!db.expenses.length) { alert("No expenses to export yet."); return; }
  const vName = id => { const v = db.vehicles.find(x => x.id === id); return v ? v.name : "Unknown vehicle"; };
  const cats = [...new Set(db.expenses.map(e => e.category))];

  const ledgers = cats.map(c => `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="Vehicle Maintenance - ${xmlEsc(c)}" ACTION="Create">
        <NAME.LIST><NAME>Vehicle Maintenance - ${xmlEsc(c)}</NAME></NAME.LIST>
        <PARENT>Indirect Expenses</PARENT>
      </LEDGER>
    </TALLYMESSAGE>`).join("");

  const vouchers = [...db.expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e, i) => {
      const d = e.date.replace(/-/g, "");
      const amt = e.amount.toFixed(2);
      const narr = `FleetWorks: ${e.category} - ${vName(e.vehicleId)}` + (e.odo ? ` @ ${e.odo} km` : "");
      return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
        <DATE>${d}</DATE>
        <EFFECTIVEDATE>${d}</EFFECTIVEDATE>
        <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
        <VOUCHERNUMBER>FW-${i + 1}</VOUCHERNUMBER>
        <NARRATION>${xmlEsc(narr)}</NARRATION>
        <PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Vehicle Maintenance - ${xmlEsc(e.category)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${amt}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Cash</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${amt}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`;
    }).join("");

  const xml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>Vouchers</REPORTNAME>
      <STATICVARIABLES><IMPORTDUPS>@@DUPCOMBINE</IMPORTDUPS></STATICVARIABLES>
    </REQUESTDESC>
    <REQUESTDATA>${ledgers}${vouchers}
    </REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>`;

  const blob = new Blob([xml], { type: "application/xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fleetworks-tally-vouchers.xml";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Data management ----------
function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fleetworks-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
function clearData() {
  if (!confirm("Delete all fleet data stored in this browser?")) return;
  db = { vehicles: [], expenses: [] };
  localStorage.removeItem(STORE_KEY);
  renderAll();
}

// ---------- Forms & filters ----------
document.getElementById("vehicleForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.vehicles.push({ id: "v" + Date.now(), name: fd.name.trim(), type: fd.type, kmPerMonth: +fd.kmPerMonth });
  saveStore(db); e.target.reset(); renderAll();
});
document.getElementById("expenseForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  db.expenses.push({
    vehicleId: fd.vehicleId, date: fd.date, category: fd.category,
    amount: +fd.amount, odo: fd.odo ? +fd.odo : undefined
  });
  saveStore(db); e.target.reset(); renderAll();
});
document.getElementById("vehicleFilter").addEventListener("change", renderCharts);
document.getElementById("periodFilter").addEventListener("change", renderCharts);
document.getElementById("demoBtn").addEventListener("click", loadDemo);

// ---------- Navbar ----------
const navbar = document.getElementById("navbar");
window.addEventListener("scroll", () => navbar.classList.toggle("scrolled", window.scrollY > 10));
document.getElementById("hamburger").addEventListener("click", () =>
  document.getElementById("navLinks").classList.toggle("open"));

// ---------- Render orchestration ----------
function renderCharts() { renderMonthly(); renderVehicles(); renderParts(); }

function renderAll() {
  const has = db.vehicles.length > 0;
  document.getElementById("emptyState").hidden = has;
  document.getElementById("dashContent").hidden = !has;
  if (!has) return;

  // vehicle selectors
  const vf = document.getElementById("vehicleFilter");
  const keep = vf.value;
  vf.innerHTML = '<option value="all">All vehicles</option>' +
    db.vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
  if ([...vf.options].some(o => o.value === keep)) vf.value = keep;
  document.getElementById("expenseVehicle").innerHTML =
    db.vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("");

  renderStats();
  renderCharts();
  renderPredictions();
}

renderAll();
