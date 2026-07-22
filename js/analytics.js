/* ============ FleetWorks — analytics.js ============
   AI Analytics tab inside the Fleet Manager shell:
   - monthly / vehicle-wise / part-wise aggregation
   - fleet-average and industry-average benchmarking
   - expense forecasting (least-squares regression on monthly totals)
   - part-replacement prediction from usage rate + lifespan models
   Reads the shared `db` global from fleet.js (same ff_fleet store). */

"use strict";

// ---------- Chart palette (validated categorical slots + chrome) ----------
const DASH_PAL = {
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

function fmtINRfull(v) { return "₹" + Math.round(v).toLocaleString("en-IN"); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

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

// ---------- Render: stat tiles ----------
// FleetFin — the money picture (actuals only)
function renderStats() {
  const el = document.getElementById("finStatRow");
  if (!el) return;
  const nowK = todayKey();
  const thisMonth = db.expenses.filter(e => monthKey(e.date) === nowK).reduce((s, e) => s + e.amount, 0);
  const fuelMonth = (db.fuelLogs || []).filter(f => monthKey(f.date) === nowK).reduce((s, f) => s + f.amount, 0);
  const revMonth = (db.trips || []).filter(t => monthKey(t.date) === nowK).reduce((s, t) => s + t.freight, 0);
  const profMonth = revMonth - thisMonth - fuelMonth;
  const vs = vehicleStats();
  const fleetCpk = mean(vs.filter(v => v.costPerKm > 0).map(v => v.costPerKm));
  const indCpk = mean(vs.map(v => v.industry));
  const deltaPct = indCpk ? ((fleetCpk - indCpk) / indCpk) * 100 : 0;
  const deltaGood = deltaPct <= 0;
  el.innerHTML = `
    <div class="stat-tile"><span class="stat-label">Maintenance this month</span><span class="stat-value">${fmtINR(thisMonth)}</span><span class="stat-sub">${nowK ? monthLabel(nowK) : ""}</span></div>
    <div class="stat-tile"><span class="stat-label">Diesel this month</span><span class="stat-value">${fmtINR(fuelMonth)}</span><span class="stat-sub">from fuel logs</span></div>
    <div class="stat-tile"><span class="stat-label">Fleet cost per km</span><span class="stat-value">₹${fleetCpk.toFixed(2)}</span>
      <span class="stat-sub" style="color:${deltaGood ? "#006300" : DASH_PAL.critical}">${deltaGood ? "▼" : "▲"} ${Math.abs(deltaPct).toFixed(0)}% vs industry ₹${indCpk.toFixed(2)}</span></div>
    <div class="stat-tile"><span class="stat-label">Freight this month</span><span class="stat-value">${fmtINR(revMonth)}</span><span class="stat-sub">from logged trips</span></div>
    <div class="stat-tile"><span class="stat-label">Profit this month</span><span class="stat-value" style="color:${profMonth >= 0 ? "#006300" : DASH_PAL.critical}">${profMonth < 0 ? "−" : ""}${fmtINR(Math.abs(profMonth))}</span><span class="stat-sub">freight − diesel − maintenance</span></div>
    <div class="stat-tile"><span class="stat-label">GST credit, this quarter</span><span class="stat-value" style="color:#006300">${fmtINR(itcQuarter())}</span><span class="stat-sub">ITC from captured GST bills</span></div>`;
}

// FleetIQ — what the AI sees ahead, and what acting on it is worth
function renderIQStats() {
  const el = document.getElementById("iqStatRow");
  if (!el) return;
  const monthly = monthlySeries(db.expenses);
  const fc = forecastMonthly(monthly.slice(-12), 3);
  const fcTotal = fc.reduce((s, f) => s + f.amount, 0);
  const preds = predictParts();
  const due = preds.filter(p => p.lifeUsed >= 0.85);
  const dueCost = due.reduce((s, p) => s + p.estCost, 0);
  // roadside failure runs ~40% over a planned replacement (towing, downtime, distress pricing)
  const avoided = dueCost * 0.4;
  const signals = (typeof computeInsights === "function") ? computeInsights().filter(i => i.sev >= 2).length : 0;
  el.innerHTML = `
    <div class="stat-tile"><span class="stat-label">Forecast, next 3 months</span><span class="stat-value">${fmtINR(fcTotal)}</span><span class="stat-sub">ML regression on your history</span></div>
    <div class="stat-tile"><span class="stat-label">Replacements due soon</span><span class="stat-value" style="color:${due.length ? DASH_PAL.serious : DASH_PAL.good}">${due.length}</span><span class="stat-sub">≈ ${fmtINR(dueCost)} if planned now</span></div>
    <div class="stat-tile"><span class="stat-label">Breakdown cost avoidable</span><span class="stat-value" style="color:#006300">${fmtINR(avoided)}</span><span class="stat-sub">est. 40% roadside premium saved</span></div>
    <div class="stat-tile"><span class="stat-label">AI signals active</span><span class="stat-value">${signals}</span><span class="stat-sub">Foresight watching 24×7</span></div>`;
}

// ---------- Render: monthly chart (prefix-parameterised for Fin & IQ) ----------
function renderMonthlyInto(prefix, expenses, withForecast) {
  const box = document.getElementById(prefix + "Chart");
  if (!box) return;
  const data = monthlySeries(expenses);
  if (!data.length) { box.innerHTML = "<p class='muted'>No expenses in this window.</p>"; return; }
  const fc = withForecast ? forecastMonthly(data.slice(-12), 3) : [];
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
    s += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${t === 0 ? DASH_PAL.baseline : DASH_PAL.grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${DASH_PAL.muted}" style="font-variant-numeric:tabular-nums">${fmtINR(t)}</text>`;
  });
  const bw = Math.min(24, slot - 12);
  const maxIdx = all.reduce((mi, d, i) => d.type === "actual" && d.amount > all[mi].amount ? i : mi, 0);
  all.forEach((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const fill = d.type === "actual" ? DASH_PAL.s1 : DASH_PAL.s1soft;
    const tipTxt = `<strong>${monthLabel(d.key)}</strong><br>${d.type === "forecast" ? "Forecast: " : ""}${fmtINRfull(d.amount)}`;
    s += `<path d="${colPath(x, y(d.amount), bw, base)}" fill="${fill}" data-tip="${esc(tipTxt)}"/>`;
    // selective labels: the max actual + each forecast cap
    if (i === maxIdx || d.type === "forecast") {
      s += `<text x="${x + bw / 2}" y="${y(d.amount) - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${DASH_PAL.ink2}">${fmtINR(d.amount)}</text>`;
    }
    if (i % Math.ceil(all.length / 14) === 0 || d.type === "forecast") {
      s += `<text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${DASH_PAL.muted}">${monthLabel(d.key)}</text>`;
    }
  });
  s += "</svg>";
  box.innerHTML = s;
  const legend = document.getElementById(prefix + "Legend");
  if (legend) legend.innerHTML = legendHTML(withForecast
    ? [{ color: DASH_PAL.s1, label: "Actual" }, { color: DASH_PAL.s1soft, label: "Forecast (ML)" }]
    : [{ color: DASH_PAL.s1, label: "Monthly spend" }]);
  const table = document.getElementById(prefix + "Table");
  if (table) table.innerHTML =
    "<table><thead><tr><th>Month</th><th>Spend</th><th>Type</th></tr></thead><tbody>" +
    all.map(d => `<tr><td>${monthLabel(d.key)}</td><td>${fmtINRfull(d.amount)}</td><td>${d.type}</td></tr>`).join("") +
    "</tbody></table>";
  bindTips(box);
}
function renderMonthly() {
  renderMonthlyInto("monthly", filteredExpenses(), false);     // FleetFin: actuals
  renderMonthlyInto("iqMonthly", db.expenses, true);           // FleetIQ dashboard: + ML forecast
  renderMonthlyInto("fcast", db.expenses, true);               // FleetIQ Forecasting panel
}

// ---------- Render: vehicle chart ----------
function renderAnalyticsVehicles() {
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
    s += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${t === 0 ? DASH_PAL.baseline : DASH_PAL.grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${DASH_PAL.muted}" style="font-variant-numeric:tabular-nums">₹${t.toFixed(t < 3 ? 1 : 0)}</text>`;
  });
  const bw = 20, gap = 2;
  vs.forEach((v, i) => {
    const cx = padL + group * i + group / 2;
    const x0 = cx - (bw * 3 + gap * 2) / 2;
    const bars = [
      { val: v.costPerKm, color: DASH_PAL.s1, name: esc(v.name) },
      { val: fleetAvg, color: DASH_PAL.s2, name: "Fleet average" },
      { val: v.industry, color: DASH_PAL.s3, name: "Industry (" + esc(v.type) + ")" }
    ];
    bars.forEach((b, j) => {
      const x = x0 + j * (bw + gap);
      const tipTxt = `<strong>${b.name}</strong><br>₹${b.val.toFixed(2)} / km`;
      s += `<path d="${colPath(x, y(b.val), bw, base)}" fill="${b.color}" data-tip="${esc(tipTxt)}"/>`;
    });
    // direct label: this vehicle's own value on its cap
    s += `<text x="${x0 + bw / 2}" y="${y(v.costPerKm) - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${DASH_PAL.ink2}">₹${v.costPerKm.toFixed(2)}</text>`;
    s += `<text x="${cx}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${DASH_PAL.ink2}">${esc(v.name.length > 14 ? v.name.slice(0, 13) + "…" : v.name)}</text>`;
  });
  s += "</svg>";
  box.innerHTML = s;
  document.getElementById("vehicleLegend").innerHTML = legendHTML([
    { color: DASH_PAL.s1, label: "This vehicle" }, { color: DASH_PAL.s2, label: "Your fleet avg" }, { color: DASH_PAL.s3, label: "Industry avg" }
  ]);
  document.getElementById("vehicleTable").innerHTML =
    "<table><thead><tr><th>Vehicle</th><th>Type</th><th>Spend</th><th>₹/km</th><th>Fleet avg</th><th>Industry</th></tr></thead><tbody>" +
    vs.map(v => `<tr><td>${esc(v.name)}</td><td>${esc(v.type)}</td><td>${fmtINRfull(v.spend)}</td><td>₹${v.costPerKm.toFixed(2)}</td><td>₹${fleetAvg.toFixed(2)}</td><td>₹${v.industry.toFixed(2)}</td></tr>`).join("") +
    "</tbody></table>";
  bindTips(box);
}

// ---------- Render: part chart ----------
function renderAnalyticsParts() {
  const ps = partStats(filteredExpenses());
  const box = document.getElementById("partChart");
  if (!ps.length) { box.innerHTML = "<p class='muted'>No expenses in this window.</p>"; return; }

  const rowH = 34, padL = 150, padR = 90, padT = 6;
  const H = padT + rowH * ps.length + 8;
  const W = 860;
  const maxV = Math.max(...ps.map(p => p.total));
  const len = v => (W - padL - padR) * (v / maxV);

  let s = svgEl(W, H);
  s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - 4}" stroke="${DASH_PAL.baseline}" stroke-width="1"/>`;
  ps.forEach((p, i) => {
    const yy = padT + rowH * i + (rowH - 20) / 2;
    const tipTxt = `<strong>${esc(p.category)}</strong><br>Total: ${fmtINRfull(p.total)}<br>${p.count} job${p.count > 1 ? "s" : ""} · avg ${fmtINRfull(p.avg)}` +
      (p.industryCost ? `<br>Industry avg/job: ${fmtINRfull(p.industryCost)}` : "");
    s += `<text x="${padL - 8}" y="${yy + 14}" text-anchor="end" font-size="12" fill="${DASH_PAL.ink2}">${esc(p.category)}</text>`;
    s += `<path d="${barPath(padL, yy, len(p.total), 20)}" fill="${DASH_PAL.s1}" data-tip="${esc(tipTxt)}"/>`;
    s += `<text x="${padL + len(p.total) + 8}" y="${yy + 14}" font-size="11" font-weight="600" fill="${DASH_PAL.ink2}" style="font-variant-numeric:tabular-nums">${fmtINR(p.total)}</text>`;
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
    let status, color;
    if (p.lifeUsed >= 1)        { status = "Overdue";  color = DASH_PAL.critical; }
    else if (p.lifeUsed >= 0.85){ status = "Due soon"; color = DASH_PAL.serious; }
    else if (p.lifeUsed >= 0.6) { status = "Plan ahead"; color = DASH_PAL.warn; }
    else                        { status = "Healthy";  color = DASH_PAL.good; }
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};vertical-align:1px"></span>`;
    const due = p.lifeUsed >= 1 ? "now" :
      "~" + p.dueDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) +
      (p.kmLeft > 0 ? " · " + p.kmLeft.toLocaleString("en-IN") + " km left" : "");
    return `
      <div class="pred-row">
        <div class="pred-main">
          <strong>${esc(p.vehicle.name)}</strong> — ${esc(p.category)}
          <span class="pred-status" style="color:${color}">${dot} ${status}</span>
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

// ---------- Render: FleetFin monthly books ----------
function renderAccounts() {
  const el = document.getElementById("accountsSummary");
  if (!el) return;
  const map = {};
  db.expenses.forEach(e => { const k = monthKey(e.date); (map[k] = map[k] || { m: 0, f: 0 }).m += e.amount; });
  (db.fuelLogs || []).forEach(f => { const k = monthKey(f.date); (map[k] = map[k] || { m: 0, f: 0 }).f += f.amount; });
  const keys = Object.keys(map).sort().reverse().slice(0, 12);
  if (!keys.length) { el.innerHTML = "<p class='muted'>No entries yet — expenses and diesel fills will appear here month by month.</p>"; return; }
  el.innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Month</th><th>Maintenance</th><th>Diesel</th><th>Total</th></tr></thead><tbody>` +
    keys.map(k => `<tr><td><strong>${monthLabel(k)}</strong></td><td>${fmtINRfull(map[k].m)}</td><td>${fmtINRfull(map[k].f)}</td><td><strong>${fmtINRfull(map[k].m + map[k].f)}</strong></td></tr>`).join("") +
    "</tbody></table>";
}

// ---------- FleetIQ study panels ----------
function renderRecurrent() {
  const el = document.getElementById("recurTable");
  if (!el) return;
  const rows = [];
  db.vehicles.forEach(v => {
    const cats = {};
    db.expenses.filter(e => e.vehicleId === v.id).forEach(e => (cats[e.category] = cats[e.category] || []).push(e));
    Object.entries(cats).filter(([, l]) => l.length >= 2).forEach(([c, l]) =>
      rows.push({ v: v.name, what: c, kind: "Repeat repair", n: l.length, total: l.reduce((s, e) => s + e.amount, 0), last: l.map(e => e.date).sort().pop() }));
    const titles = {};
    db.issues.filter(i => i.vehicleId === v.id).forEach(i => (titles[i.title.trim().toLowerCase()] = titles[i.title.trim().toLowerCase()] || []).push(i));
    Object.values(titles).filter(l => l.length >= 2).forEach(l =>
      rows.push({ v: v.name, what: l[0].title, kind: "Repeat issue", n: l.length, total: 0, last: l.map(i => i.createdAt).sort().pop() }));
  });
  rows.sort((a, b) => b.n - a.n);
  el.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>What keeps recurring</th><th>Type</th><th>Times</th><th>Total spent</th><th>Last seen</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td><strong>${esc(r.v)}</strong></td><td>${esc(r.what)}</td><td>${r.kind}</td><td>${r.n}×</td><td>${r.total ? fmtINRfull(r.total) : "—"}</td><td>${r.last ? fmtDate(r.last) : "—"}</td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No repeats yet — that's a good sign. FleetIQ flags anything that fails twice on the same vehicle.</p>";
}

function renderDeviation() {
  const el = document.getElementById("devTable");
  if (!el) return;
  const vs = vehicleStats().filter(v => v.costPerKm > 0);
  if (!vs.length) { el.innerHTML = "<p class='muted'>Add expenses and FleetIQ will benchmark every vehicle against your fleet average.</p>"; return; }
  const avg = mean(vs.map(v => v.costPerKm));
  el.innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Type</th><th>₹/km</th><th>Fleet avg</th><th>Deviation</th><th>Verdict</th></tr></thead><tbody>` +
    vs.map(v => {
      const dev = avg ? ((v.costPerKm - avg) / avg) * 100 : 0;
      const badge = dev > 15 ? `<span class="fw-badge overdue">${dev.toFixed(0)}% costlier</span>` :
        dev < -15 ? `<span class="fw-badge ok">${Math.abs(dev).toFixed(0)}% cheaper</span>` :
        `<span class="fw-badge upcoming">Within band</span>`;
      return `<tr><td><strong>${esc(v.name)}</strong></td><td>${esc(v.type)}</td><td>₹${v.costPerKm.toFixed(2)}</td><td>₹${avg.toFixed(2)}</td><td>${dev >= 0 ? "+" : ""}${dev.toFixed(0)}%</td><td>${badge}</td></tr>`;
    }).join("") + "</tbody></table>";
}

function renderAnomaly() {
  const el = document.getElementById("anomTable");
  if (!el) return;
  const byCat = {};
  db.expenses.forEach(e => (byCat[e.category] = byCat[e.category] || []).push(e.amount));
  const rows = [];
  db.expenses.forEach(e => {
    const arr = byCat[e.category];
    if (arr.length < 3) return;
    const avg = mean(arr);
    if (e.amount > avg * 1.8) rows.push({ ...e, avg, x: e.amount / avg });
  });
  rows.sort((a, b) => b.x - a.x);
  el.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Category</th><th>Billed</th><th>Your average</th><th>Factor</th></tr></thead><tbody>` +
    rows.slice(0, 12).map(r => `<tr><td>${fmtDate(r.date)}</td><td><strong>${esc(vName(r.vehicleId))}</strong></td><td>${esc(r.category)}</td><td style="color:${DASH_PAL.critical}"><strong>${fmtINRfull(r.amount)}</strong></td><td>${fmtINRfull(r.avg)}</td><td>${r.x.toFixed(1)}× normal</td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No anomalies right now. Any bill 1.8× above your own average for that part will appear here.</p>";
}

function renderRecommendations() {
  const el = document.getElementById("recoList");
  if (!el) return;
  const items = [];
  predictParts().filter(p => p.lifeUsed >= 0.85).slice(0, 5).forEach(p =>
    items.push({ ic: "wrench", tone: "warning", t: `Plan ${p.category} for ${p.vehicle.name} now — ~${fmtINR(p.estCost)} planned beats a roadside failure`, d: p.lifeUsed >= 1 ? "Overdue" : "~" + p.dueDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) }));
  if (typeof computeInsights === "function")
    computeInsights().filter(i => i.sev >= 3).slice(0, 5).forEach(i =>
      items.push({ ic: "alert", tone: "danger", t: `${i.title} — ${i.detail}`, d: i.tag }));
  const vs = vehicleStats().filter(v => v.costPerKm > 0);
  const avg = mean(vs.map(v => v.costPerKm));
  vs.filter(v => avg && (v.costPerKm - avg) / avg > 0.2).forEach(v =>
    items.push({ ic: "chartBar", tone: "info", t: `Audit ${v.name}: ₹${v.costPerKm.toFixed(2)}/km vs fleet ₹${avg.toFixed(2)} — check driver habits, route or a lingering fault`, d: "Deviation" }));
  el.innerHTML = items.length ?
    items.map(i => `<div class="pred-row" style="padding:12px 16px"><div class="pred-main" style="display:flex;align-items:center;gap:10px;font-size:0.9rem"><span class="ic-tile ${i.tone}" style="width:32px;height:32px;flex:none">${FWIcon(i.ic, { size: 16 })}</span><span style="flex:1;min-width:0">${esc(i.t)}</span><span class="muted" style="flex:none;font-size:0.78rem">${esc(i.d)}</span></div></div>`).join("")
    : "<p class='muted'>All clear. Recommendations appear as predictions come due, anomalies surface or vehicles drift from the fleet average.</p>";
}

// ---------- GST input-tax credit tracker ----------
// Assumes bills are GST-inclusive at 18% (standard for CV parts & service):
// ITC = amount × 18/118. Indian FY starts 1 April.
const itcOf = e => e.gstin ? e.amount * 0.18 / 1.18 : 0;
function fyStart() {
  const d = new Date();
  return (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1) + "-04-01";
}
function fyQuarterStart() {
  const d = new Date();
  const q = Math.floor(((d.getMonth() + 9) % 12) / 3);            // 0=Apr-Jun … 3=Jan-Mar
  const startMonth = [3, 6, 9, 0][q];
  const year = startMonth === 0 ? d.getFullYear() : (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1);
  return year + "-" + String(startMonth + 1).padStart(2, "0") + "-01";
}
function itcQuarter() {
  const from = fyQuarterStart();
  return db.expenses.filter(e => e.date >= from).reduce((s, e) => s + itcOf(e), 0);
}

function renderGST() {
  const tiles = document.getElementById("gstTiles"), tbl = document.getElementById("gstBillsTable");
  if (!tiles || !tbl) return;
  const fy = fyStart();
  const fyExp = db.expenses.filter(e => e.date >= fy);
  const gstBills = fyExp.filter(e => e.gstin);
  const nonGstSpend = fyExp.filter(e => !e.gstin).reduce((s, e) => s + e.amount, 0);
  const itcFY = fyExp.reduce((s, e) => s + itcOf(e), 0);
  tiles.innerHTML = `
    <div class="stat-tile"><span class="stat-label">ITC this quarter</span><span class="stat-value" style="color:#006300">${fmtINR(itcQuarter())}</span><span class="stat-sub">claimable in GSTR-3B</span></div>
    <div class="stat-tile"><span class="stat-label">ITC this FY</span><span class="stat-value" style="color:#006300">${fmtINR(itcFY)}</span><span class="stat-sub">since ${monthLabel(fy.slice(0, 7))}</span></div>
    <div class="stat-tile"><span class="stat-label">GST bills captured</span><span class="stat-value">${gstBills.length}</span><span class="stat-sub">of ${fyExp.length} bills this FY</span></div>
    <div class="stat-tile"><span class="stat-label">Non-GST spend</span><span class="stat-value" style="color:${nonGstSpend ? DASH_PAL.serious : DASH_PAL.good}">${fmtINR(nonGstSpend)}</span><span class="stat-sub">≈${fmtINR(nonGstSpend * 0.18 / 1.18)} credit lost — ask for GST bills</span></div>`;
  const rows = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  tbl.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Date</th><th>Vehicle</th><th>Category</th><th>Amount</th><th>GST</th><th>ITC</th></tr></thead><tbody>` +
    rows.map(e => `<tr><td>${fmtDate(e.date)}</td><td><strong>${esc(vName(e.vehicleId))}</strong></td><td>${esc(e.category)}</td><td>${fmtINRfull(e.amount)}</td>
      <td>${e.gstin ? `<span class="fw-badge ok">${esc(e.gstin)}</span>` : '<span class="fw-badge soon">No GST bill</span>'}</td>
      <td>${e.gstin ? fmtINRfull(itcOf(e)) : "—"}</td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No bills yet — scan or enter your first bill above.</p>";
}

// ---------- OCR bill capture (Tesseract.js, loaded on demand) ----------
let tessLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tessLoading) tessLoading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = res;
    s.onerror = () => { tessLoading = null; rej(new Error("Could not load the bill reader — check internet and retry.")); };
    document.head.appendChild(s);
  });
  return tessLoading;
}
function initBillScan() {
  const btn = document.getElementById("billScanBtn"), file = document.getElementById("billFile");
  const form = document.getElementById("billForm"), st = document.getElementById("billScanStatus");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => file.click());
  document.getElementById("billManualBtn").addEventListener("click", () => {
    form.hidden = false;
    if (!form.date.value) form.date.value = new Date().toISOString().slice(0, 10);
  });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      st.textContent = "Loading reader…";
      await loadTesseract();
      st.textContent = "Reading bill… (first scan is slow)";
      const { data } = await Tesseract.recognize(f, "eng");
      const text = data.text || "";
      form.hidden = false;
      const gstin = (text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/i) || [])[0] || "";
      form.gstin.value = gstin.toUpperCase();
      const nums = [...text.matchAll(/(\d[\d,]{2,9}(?:\.\d{1,2})?)/g)]
        .map(m => +m[1].replace(/,/g, "")).filter(n => n >= 100 && n <= 2000000);
      if (nums.length) form.amount.value = Math.round(Math.max(...nums));
      const dm = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
      if (dm) {
        const yy = dm[3].length === 2 ? "20" + dm[3] : dm[3];
        const dt = new Date(+yy, +dm[2] - 1, +dm[1]);
        if (!isNaN(dt) && dt <= new Date()) form.date.value = dt.toISOString().slice(0, 10);
      }
      if (!form.date.value) form.date.value = new Date().toISOString().slice(0, 10);
      st.textContent = gstin ? "Read ✓ — GSTIN found. Check the fields, pick vehicle & category, save."
        : "Read ✓ — no GSTIN spotted (non-GST bill?). Check the fields and save.";
    } catch (ex) {
      form.hidden = false;
      if (!form.date.value) form.date.value = new Date().toISOString().slice(0, 10);
      st.textContent = (ex && ex.message) || "Couldn't read that photo — enter the bill below.";
    }
    file.value = "";
  });
  form.addEventListener("submit", e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    db.expenses.push({
      vehicleId: fd.vehicleId, date: fd.date, category: fd.category, amount: +fd.amount,
      gstin: (fd.gstin || "").trim().toUpperCase() || undefined,
      billNo: (fd.billNo || "").trim() || undefined
    });
    saveStore(); e.target.reset(); e.target.hidden = true;
    st.textContent = "Saved ✓ — it's in your books, Tally export and ITC tracker.";
    renderAll();
  });
}

// ---------- Peer benchmarking (vs India CV reference data) ----------
function renderBenchmark() {
  const el = document.getElementById("benchTables");
  if (!el) return;
  const vs = vehicleStats().filter(v => v.costPerKm > 0);
  if (!vs.length) { el.innerHTML = "<p class='muted'>Add expenses and fuel logs — FleetIQ will benchmark you against typical Indian CV fleets.</p>"; return; }
  const verdict = (mine, ref, lowerBetter = true) => {
    if (!ref) return "—";
    const dev = (mine - ref) / ref * 100;
    const good = lowerBetter ? dev <= 0 : dev >= 0;
    return `<span class="fw-badge ${good ? "ok" : Math.abs(dev) > 20 ? "overdue" : "soon"}">${good ? (lowerBetter ? "" : "+") : "+"}${dev.toFixed(0)}% vs peers</span>`;
  };
  // cost/km by class
  const byType = {};
  vs.forEach(v => (byType[v.type] = byType[v.type] || []).push(v.costPerKm));
  let html = `<h3 class="bench-h">Maintenance cost per km</h3>
    <div class="chart-scroll"><table class="chart-table-el"><thead><tr><th>Vehicle class</th><th>Your fleet</th><th>Typical fleet</th><th>Verdict</th></tr></thead><tbody>` +
    Object.entries(byType).map(([t, arr]) => {
      const mine = mean(arr), ref = INDUSTRY.costPerKm[t];
      return `<tr><td><strong>${esc(t)}</strong></td><td>₹${mine.toFixed(2)}/km</td><td>${ref ? "₹" + ref.toFixed(2) + "/km" : "—"}</td><td>${verdict(mine, ref)}</td></tr>`;
    }).join("") + "</tbody></table></div>";
  // mileage by class
  const kmplByType = {};
  db.vehicles.forEach(v => {
    const fills = (db.fuelLogs || []).filter(f => f.vehicleId === v.id && f.odo > 0).sort((a, b) => a.odo - b.odo);
    if (fills.length < 2) return;
    const dist = fills[fills.length - 1].odo - fills[0].odo;
    const litres = fills.slice(1).reduce((s, f) => s + f.litres, 0);
    if (dist > 0 && litres > 0) (kmplByType[v.type] = kmplByType[v.type] || []).push(dist / litres);
  });
  if (Object.keys(kmplByType).length) {
    html += `<h3 class="bench-h">Diesel mileage (km/L)</h3>
      <div class="chart-scroll"><table class="chart-table-el"><thead><tr><th>Vehicle class</th><th>Your fleet</th><th>Typical fleet</th><th>Verdict</th></tr></thead><tbody>` +
      Object.entries(kmplByType).map(([t, arr]) => {
        const mine = mean(arr), ref = EXPECTED_KMPL[t];
        return `<tr><td><strong>${esc(t)}</strong></td><td>${mine.toFixed(1)} km/L</td><td>${ref ? ref.toFixed(1) + " km/L" : "—"}</td><td>${verdict(mine, ref, false)}</td></tr>`;
      }).join("") + "</tbody></table></div>";
  }
  // part cost per job
  const ps = partStats(db.expenses).filter(p => p.industryCost);
  if (ps.length) {
    html += `<h3 class="bench-h">Part cost per job</h3>
      <div class="chart-scroll"><table class="chart-table-el"><thead><tr><th>Part</th><th>Your avg/job</th><th>Typical price</th><th>Verdict</th></tr></thead><tbody>` +
      ps.map(p => `<tr><td><strong>${esc(p.category)}</strong></td><td>${fmtINRfull(p.avg)}</td><td>${fmtINRfull(p.industryCost)}</td><td>${verdict(p.avg, p.industryCost)}</td></tr>`).join("") +
      "</tbody></table></div>";
  }
  el.innerHTML = html;
}

// ---------- Diesel Watch (pilferage / mileage-drop detection) ----------
// Baseline = the vehicle's own median km/L across fill-to-fill gaps.
// Flag any fill running well below it with a meaningful litre gap.
function fuelTheftFlags() {
  const flags = [];
  db.vehicles.forEach(v => {
    const fills = (db.fuelLogs || []).filter(f => f.vehicleId === v.id && f.odo > 0 && f.litres > 0)
      .sort((a, b) => a.odo - b.odo);
    if (fills.length < 4) return;
    const gaps = [];
    for (let i = 1; i < fills.length; i++) {
      const dist = fills[i].odo - fills[i - 1].odo;
      if (dist > 0) gaps.push({ fill: fills[i], kmpl: dist / fills[i].litres, dist });
    }
    if (gaps.length < 3) return;
    const base = median(gaps.map(x => x.kmpl));
    gaps.forEach(x => {
      if (!base || x.kmpl >= base * 0.78) return;
      const missing = x.fill.litres - x.dist / base;
      if (missing < 8) return;
      flags.push({
        vehicle: v.name, date: x.fill.date, litres: x.fill.litres,
        kmpl: x.kmpl, base, missing,
        cost: missing * (x.fill.amount / x.fill.litres)
      });
    });
  });
  return flags.sort((a, b) => b.missing - a.missing);
}

function renderFuelWatch() {
  const el = document.getElementById("fuelWatch");
  if (!el) return;
  const flags = fuelTheftFlags();
  el.innerHTML = flags.length ?
    flags.slice(0, 8).map(f => `
      <div class="pred-row" style="padding:12px 16px"><div class="pred-main" style="display:flex;align-items:center;gap:10px;font-size:0.88rem">
        <span class="ic-tile danger" style="width:32px;height:32px;flex:none">${FWIcon("fuel", { size: 16 })}</span>
        <span style="flex:1;min-width:0"><strong>${esc(f.vehicle)}</strong> — ${fmtDate(f.date)}: ran ${f.kmpl.toFixed(1)} km/L vs its normal ${f.base.toFixed(1)} — <strong style="color:${DASH_PAL.critical}">≈${Math.round(f.missing)} L unaccounted (${fmtINR(f.cost)})</strong></span>
        <span class="muted" style="flex:none;font-size:0.78rem">check fill</span>
      </div></div>`).join("")
    : `<p class="muted" style="padding:14px 16px">Mileage steady on every fill — no suspicious diesel gaps. Needs odometer + litres on at least 4 fills per vehicle.</p>`;
}

// ---------- What-if simulator ----------
function whatifBase() {
  const cutoff = addMonths(todayKey(), -11);
  return {
    maint: db.expenses.filter(e => monthKey(e.date) >= cutoff).reduce((s, e) => s + e.amount, 0) / 12,
    fuel: (db.fuelLogs || []).filter(f => monthKey(f.date) >= cutoff).reduce((s, f) => s + f.amount, 0) / 12,
    n: db.vehicles.length || 1
  };
}
function renderWhatIf() {
  const out = document.getElementById("wiOut");
  if (!out) return;
  const fp = +document.getElementById("wiFuel").value / 100;
  const kp = +document.getElementById("wiKm").value / 100;
  const av = +document.getElementById("wiVeh").value;
  document.getElementById("wiFuelV").textContent = (fp >= 0 ? "+" : "") + Math.round(fp * 100) + "%";
  document.getElementById("wiKmV").textContent = (kp >= 0 ? "+" : "") + Math.round(kp * 100) + "%";
  document.getElementById("wiVehV").textContent = "+" + av;
  const b = whatifBase();
  const scale = 1 + av / b.n;
  const proj = b.fuel * (1 + fp) * (1 + kp) * scale + b.maint * (1 + kp * 0.6) * scale;
  const now = b.fuel + b.maint;
  const d = proj - now;
  const up = d >= 0;
  out.innerHTML = `
    <div class="stat-tile"><span class="stat-label">Today / month</span><span class="stat-value">${fmtINR(now)}</span><span class="stat-sub">diesel + maintenance, 12-mo avg</span></div>
    <div class="stat-tile"><span class="stat-label">Projected / month</span><span class="stat-value">${fmtINR(proj)}</span><span class="stat-sub">with your sliders applied</span></div>
    <div class="stat-tile"><span class="stat-label">Monthly change</span><span class="stat-value" style="color:${up ? DASH_PAL.critical : "#006300"}">${up ? "+" : "−"}${fmtINR(Math.abs(d))}</span><span class="stat-sub">${up ? "extra outflow" : "saved"}</span></div>
    <div class="stat-tile"><span class="stat-label">Yearly impact</span><span class="stat-value" style="color:${up ? DASH_PAL.critical : "#006300"}">${up ? "+" : "−"}${fmtINR(Math.abs(d) * 12)}</span><span class="stat-sub">annualised</span></div>`;
}
function initWhatIf() {
  ["wiFuel", "wiKm", "wiVeh"].forEach(id => document.getElementById(id)?.addEventListener("input", renderWhatIf));
  renderWhatIf();
}

// ---------- Filters & orchestration ----------
function renderCharts() { renderMonthly(); renderAnalyticsVehicles(); renderAnalyticsParts(); }

function renderAnalyticsAll() {
  // vehicle filter (preserve selection across refreshes)
  const vf = document.getElementById("vehicleFilter");
  const keep = vf.value;
  vf.innerHTML = '<option value="all">All vehicles</option>' +
    db.vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
  if ([...vf.options].some(o => o.value === keep)) vf.value = keep;

  renderStats();
  renderIQStats();
  renderCharts();
  renderPredictions();
  renderAccounts();
  renderRecurrent();
  renderDeviation();
  renderAnomaly();
  renderRecommendations();
  renderFuelWatch();
  renderWhatIf();
  renderGST();
  renderBenchmark();
}

document.getElementById("vehicleFilter").addEventListener("change", renderCharts);
document.getElementById("periodFilter").addEventListener("change", renderCharts);

renderAnalyticsAll();
initWhatIf();
initBillScan();
// re-score health & inbox now that vehicleStats/predictParts/fuelTheftFlags exist
if (typeof renderHealth === "function") { renderHealth(); renderActionInbox(); }
