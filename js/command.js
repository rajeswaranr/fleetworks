/* ============ FleetWorks — command.js ============
   Command Center: Grafana-style dark operations dashboard computed
   live from the ff_fleet store (local or cloud-synced). */

"use strict";

// ---------- Dark chart palette (dark-surface steps) ----------
const C = {
  blue: "#3987e5", aqua: "#199e70", yellow: "#c98500", violet: "#9085e9", red: "#e66767",
  good: "#0ca30c", warn: "#fab219", serious: "#ec835a", critical: "#d03b3b",
  ink: "#ffffff", ink2: "#c3c2b7", muted: "#898781",
  grid: "#223047", baseline: "#33415c", surface: "#121c2e"
};

const INDUSTRY_CPK = { "Truck (HCV)": 3.2, "LCV": 1.9, "Bus": 3.6, "Tipper": 4.1, "Trailer": 3.4, "Tanker": 3.3 };
const EXPECTED_KMPL = { "Truck (HCV)": 4.0, "LCV": 8.5, "Bus": 4.5, "Tipper": 3.2, "Trailer": 3.6, "Tanker": 3.8 };
const DOCS = { insurance: "INS", puc: "PUC", fitness: "FC", permit: "PRM", roadtax: "TAX" };

// ---------- Store ----------
function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem("ff_fleet") || "{}");
    return {
      vehicles: d.vehicles || [], expenses: d.expenses || [], fuelLogs: d.fuelLogs || [],
      drivers: d.drivers || [], issues: d.issues || [], workOrders: d.workOrders || [],
      inspections: d.inspections || [], reminders: d.reminders || [], parts: d.parts || []
    };
  } catch { return { vehicles: [], expenses: [], fuelLogs: [], drivers: [], issues: [], workOrders: [], inspections: [], reminders: [], parts: [] }; }
}
let db = loadDB();

// ---------- Utils ----------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtINR = v => v >= 10000000 ? "₹" + (v / 10000000).toFixed(1) + "Cr" : v >= 100000 ? "₹" + (v / 100000).toFixed(1) + "L" : v >= 1000 ? "₹" + (v / 1000).toFixed(1) + "K" : "₹" + Math.round(v);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const monthKey = d => d.slice(0, 7);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const mLabel = k => MONTHS[+k.split("-")[1] - 1] + " '" + k.split("-")[0].slice(2);
function addMonths(k, n) { const [y, m] = k.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
const todayKey = () => new Date().toISOString().slice(0, 7);
const daysUntil = ds => Math.round((new Date(ds) - new Date()) / 86400000);
const vName = id => (db.vehicles.find(v => v.id === id) || { name: "?" }).name;

function rangeMonths() { return +document.getElementById("cmdRange").value; }
function windowExpenses() {
  const cutoff = addMonths(todayKey(), -(rangeMonths() - 1));
  return db.expenses.filter(e => monthKey(e.date) >= cutoff);
}

// ---------- Tooltip ----------
const tip = () => document.getElementById("vizTooltip");
function bindTips(el) {
  el.querySelectorAll("[data-tip]").forEach(n => {
    n.addEventListener("mousemove", ev => {
      const t = tip(); t.innerHTML = n.dataset.tip; t.hidden = false;
      let x = ev.clientX + 14, y = ev.clientY + 14;
      const r = t.getBoundingClientRect();
      if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
      if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
      t.style.left = x + "px"; t.style.top = y + "px";
    });
    n.addEventListener("mouseleave", () => tip().hidden = true);
  });
}

// ---------- Computations ----------
function vehicleStats() {
  const months = rangeMonths();
  const cutoff = addMonths(todayKey(), -(months - 1));
  return db.vehicles.map(v => {
    const spend = db.expenses.filter(e => e.vehicleId === v.id && monthKey(e.date) >= cutoff).reduce((s, e) => s + e.amount, 0);
    const firstK = db.expenses.filter(e => e.vehicleId === v.id).map(e => monthKey(e.date)).sort()[0];
    const activeMonths = Math.max(1, Math.min(months, firstK ? (new Date().getFullYear() * 12 + new Date().getMonth()) - (+firstK.split("-")[0] * 12 + +firstK.split("-")[1] - 1) + 1 : months));
    const fills = db.fuelLogs.filter(f => f.vehicleId === v.id).sort((a, b) => a.odo - b.odo);
    let dist = 0, litres = 0;
    for (let i = 1; i < fills.length; i++) { const dd = fills[i].odo - fills[i - 1].odo; if (dd > 0) { dist += dd; litres += fills[i].litres; } }
    return {
      ...v, spend,
      cpk: spend / (v.kmPerMonth * activeMonths),
      industry: INDUSTRY_CPK[v.type] || 3.0,
      kmpl: litres ? dist / litres : null,
      openIssues: db.issues.filter(i => i.vehicleId === v.id && i.status !== "Resolved").length,
      driver: (db.drivers.find(d => d.vehicleId === v.id) || {}).name
    };
  });
}

function healthScore() {
  let score = 100;
  db.vehicles.forEach(v => Object.values(v.compliance || {}).forEach(t => {
    if (!t) return;
    const d = daysUntil(t);
    if (d < 0) score -= 8; else if (d <= 30) score -= 3;
  }));
  db.issues.filter(i => i.status !== "Resolved").forEach(i => score -= i.severity === "High" ? 6 : i.severity === "Medium" ? 3 : 1);
  db.drivers.forEach(d => { if (d.dlExpiry && daysUntil(d.dlExpiry) < 0) score -= 6; });
  db.reminders.forEach(r => {
    const next = new Date(r.lastDate); next.setMonth(next.getMonth() + (+r.everyMonths || 3));
    if (next < new Date()) score -= 3;
  });
  return Math.max(score, 5);
}

function forecast(totals, horizon) {
  const n = totals.length;
  if (!n) return [];
  if (n < 3) return Array.from({ length: horizon }, (_, i) => ({ key: addMonths(totals[n - 1].key, i + 1), amount: mean(totals.map(t => t.amount)) }));
  const xs = totals.map((_, i) => i), ys = totals.map(t => t.amount);
  const xm = mean(xs), ym = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xm) * (ys[i] - ym); den += (xs[i] - xm) ** 2; }
  const b = den ? num / den : 0, a = ym - b * xm;
  return Array.from({ length: horizon }, (_, i) => ({ key: addMonths(totals[n - 1].key, i + 1), amount: Math.max(a + b * 0.6 * (n + i), ym * 0.3) }));
}

// ---------- KPI row ----------
function renderKPIs() {
  const vs = vehicleStats();
  const score = healthScore();
  const scoreColor = score >= 80 ? C.good : score >= 60 ? C.warn : C.critical;
  const cpk = mean(vs.filter(v => v.cpk > 0).map(v => v.cpk));
  const ind = mean(vs.map(v => v.industry));
  const delta = ind ? ((cpk - ind) / ind) * 100 : 0;
  const open = db.issues.filter(i => i.status !== "Resolved");
  const high = open.filter(i => i.severity === "High").length;
  const expiring = db.vehicles.reduce((n, v) => n + Object.values(v.compliance || {}).filter(t => t && daysUntil(t) <= 30).length, 0) +
    db.drivers.filter(d => d.dlExpiry && daysUntil(d.dlExpiry) <= 30).length;
  const kmpls = vs.filter(v => v.kmpl).map(v => v.kmpl);
  const thisMonth = db.expenses.filter(e => monthKey(e.date) === todayKey()).reduce((s, e) => s + e.amount, 0);

  document.getElementById("kpiRow").innerHTML = `
    <div class="kpi"><span class="kpi-label">FLEET HEALTH</span><span class="kpi-value" style="color:${scoreColor}">${score}</span><span class="kpi-sub">/ 100 score</span></div>
    <div class="kpi"><span class="kpi-label">VEHICLES</span><span class="kpi-value">${db.vehicles.length}</span><span class="kpi-sub">${db.drivers.length} drivers</span></div>
    <div class="kpi"><span class="kpi-label">SPEND · THIS MONTH</span><span class="kpi-value">${fmtINR(thisMonth)}</span><span class="kpi-sub">${windowExpenses().length} jobs in range</span></div>
    <div class="kpi"><span class="kpi-label">COST / KM</span><span class="kpi-value">₹${cpk.toFixed(2)}</span><span class="kpi-sub" style="color:${delta <= 0 ? C.good : C.critical}">${delta <= 0 ? "▼" : "▲"} ${Math.abs(delta).toFixed(0)}% vs industry</span></div>
    <div class="kpi"><span class="kpi-label">OPEN ISSUES</span><span class="kpi-value" style="color:${high ? C.critical : C.ink}">${open.length}</span><span class="kpi-sub">${high} high severity</span></div>
    <div class="kpi"><span class="kpi-label">EXPIRING ≤ 30D</span><span class="kpi-value" style="color:${expiring ? C.warn : C.good}">${expiring}</span><span class="kpi-sub">docs &amp; licences</span></div>
    <div class="kpi"><span class="kpi-label">FLEET km/l</span><span class="kpi-value">${kmpls.length ? mean(kmpls).toFixed(1) : "—"}</span><span class="kpi-sub">diesel efficiency</span></div>`;
}

// ---------- Panel: monthly spend ----------
function renderSpend() {
  const exp = windowExpenses();
  const map = {};
  exp.forEach(e => map[monthKey(e.date)] = (map[monthKey(e.date)] || 0) + e.amount);
  const keys = Object.keys(map).sort();
  const box = document.getElementById("pnlSpend");
  if (!keys.length) { box.innerHTML = "<p class='cmd-muted'>No spend in range.</p>"; return; }
  const series = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k = addMonths(k, 1)) series.push({ key: k, amount: map[k] || 0 });
  const fc = forecast(series, 3);
  const all = [...series.map(s => ({ ...s, f: false })), ...fc.map(s => ({ ...s, f: true }))];

  const H = 210, padL = 52, padB = 26, padT = 14, padR = 14;
  const W = Math.max(560, padL + padR + all.length * 46);
  const maxV = Math.max(...all.map(d => d.amount)) * 1.12;
  const x = i => padL + (W - padL - padR) * (all.length === 1 ? 0.5 : i / (all.length - 1));
  const y = v => padT + (H - padT - padB) * (1 - v / maxV);

  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${Math.min(W, 900)}px;display:block;font-family:inherit">`;
  [0, maxV / 2, maxV].forEach(t => {
    s += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${t === 0 ? C.baseline : C.grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 7}" y="${y(t) + 4}" text-anchor="end" font-size="10.5" fill="${C.muted}">${fmtINR(t)}</text>`;
  });
  const actN = series.length;
  const actPts = all.slice(0, actN).map((d, i) => x(i) + "," + y(d.amount)).join(" ");
  const fcPts = all.slice(actN - 1).map((d, i) => x(actN - 1 + i) + "," + y(d.amount)).join(" ");
  s += `<polygon points="${x(0)},${y(0)} ${actPts} ${x(actN - 1)},${y(0)}" fill="${C.blue}" opacity="0.10"/>`;
  s += `<polyline points="${actPts}" fill="none" stroke="${C.blue}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<polyline points="${fcPts}" fill="none" stroke="#6ea8ee" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>`;
  all.forEach((d, i) => {
    s += `<circle cx="${x(i)}" cy="${y(d.amount)}" r="4" fill="${d.f ? "#6ea8ee" : C.blue}" stroke="${C.surface}" stroke-width="2" data-tip="${esc(`<strong>${mLabel(d.key)}</strong><br>${d.f ? "Forecast: " : ""}${fmtINR(d.amount)}`)}"/>`;
    if (i % Math.ceil(all.length / 10) === 0 || d.f) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.muted}">${mLabel(d.key)}</text>`;
  });
  const last = all[actN - 1];
  s += `<text x="${x(actN - 1)}" y="${y(last.amount) - 9}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${C.ink2}">${fmtINR(last.amount)}</text>`;
  s += "</svg>";
  box.innerHTML = s;
  document.getElementById("lgSpend").innerHTML =
    `<span class="lg-item" style="color:${C.ink2}"><span class="lg-swatch" style="background:${C.blue}"></span>Actual</span>
     <span class="lg-item" style="color:${C.ink2}"><span class="lg-swatch" style="background:#6ea8ee"></span>Forecast</span>`;
  bindTips(box);
}

// ---------- Panel: category ----------
function renderCategory() {
  const map = {};
  windowExpenses().forEach(e => map[e.category] = (map[e.category] || 0) + e.amount);
  const cats = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const box = document.getElementById("pnlCategory");
  if (!cats.length) { box.innerHTML = "<p class='cmd-muted'>No data.</p>"; return; }
  const max = cats[0][1];
  box.innerHTML = cats.map(([cat, amt]) => `
    <div class="hbar-row" data-tip="${esc(`<strong>${cat}</strong><br>${fmtINR(amt)}`)}">
      <span class="hbar-label">${esc(cat)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(amt / max * 100).toFixed(1)}%;background:${C.blue}"></div></div>
      <span class="hbar-val">${fmtINR(amt)}</span>
    </div>`).join("");
  bindTips(box);
}

// ---------- Panel: cost per km ----------
function renderCpk() {
  const vs = vehicleStats().filter(v => v.spend > 0).sort((a, b) => b.cpk - a.cpk);
  const box = document.getElementById("pnlCpk");
  if (!vs.length) { box.innerHTML = "<p class='cmd-muted'>No data.</p>"; return; }
  const max = Math.max(...vs.map(v => Math.max(v.cpk, v.industry))) * 1.1;
  box.innerHTML = vs.map(v => {
    const over = v.cpk > v.industry;
    return `<div class="hbar-row" data-tip="${esc(`<strong>${v.name}</strong><br>₹${v.cpk.toFixed(2)}/km · industry ₹${v.industry.toFixed(2)}`)}">
      <span class="hbar-label">${esc(v.name.slice(-7))}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(v.cpk / max * 100).toFixed(1)}%;background:${over ? C.red : C.aqua}"></div>
        <div class="hbar-mark" style="left:${(v.industry / max * 100).toFixed(1)}%"></div>
      </div>
      <span class="hbar-val" style="color:${over ? C.red : C.aqua}">₹${v.cpk.toFixed(2)}</span>
    </div>`;
  }).join("") + `<p class="cmd-note">│ marker = industry average for the vehicle class</p>`;
  document.getElementById("lgCpk").innerHTML =
    `<span class="lg-item" style="color:${C.ink2}"><span class="lg-swatch" style="background:${C.aqua}"></span>At/under industry</span>
     <span class="lg-item" style="color:${C.ink2}"><span class="lg-swatch" style="background:${C.red}"></span>Over industry</span>`;
  bindTips(box);
}

// ---------- Panel: fuel ----------
function renderFuel() {
  const pts = [];
  db.vehicles.forEach(v => {
    const fills = db.fuelLogs.filter(f => f.vehicleId === v.id).sort((a, b) => a.odo - b.odo);
    for (let i = 1; i < fills.length; i++) {
      const dist = fills[i].odo - fills[i - 1].odo;
      if (dist > 0 && fills[i].litres > 0) pts.push({ date: fills[i].date, kmpl: dist / fills[i].litres });
    }
  });
  pts.sort((a, b) => a.date.localeCompare(b.date));
  const box = document.getElementById("pnlFuel");
  if (pts.length < 3) { box.innerHTML = "<p class='cmd-muted'>Need fuel logs with odometer readings.</p>"; return; }
  const H = 190, padL = 34, padB = 24, padT = 12, padR = 10;
  const W = Math.max(420, padL + padR + pts.length * 18);
  const maxV = Math.max(...pts.map(p => p.kmpl)) * 1.15;
  const x = i => padL + (W - padL - padR) * (i / (pts.length - 1));
  const y = v => padT + (H - padT - padB) * (1 - v / maxV);
  const avg = mean(pts.map(p => p.kmpl));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${Math.min(W, 860)}px;display:block;font-family:inherit">`;
  [0, maxV / 2, maxV].forEach(t => {
    s += `<line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${t === 0 ? C.baseline : C.grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="${C.muted}">${t.toFixed(1)}</text>`;
  });
  s += `<line x1="${padL}" y1="${y(avg)}" x2="${W - padR}" y2="${y(avg)}" stroke="${C.yellow}" stroke-width="1.5" opacity="0.9"/>`;
  s += `<text x="${W - padR}" y="${y(avg) - 5}" text-anchor="end" font-size="10" fill="${C.ink2}">fleet avg ${avg.toFixed(1)}</text>`;
  s += `<polyline points="${pts.map((p, i) => x(i) + "," + y(p.kmpl)).join(" ")}" fill="none" stroke="${C.aqua}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => {
    if (p.kmpl < avg * 0.8) s += `<circle cx="${x(i)}" cy="${y(p.kmpl)}" r="4.5" fill="${C.red}" stroke="${C.surface}" stroke-width="2" data-tip="${esc(`<strong>${p.date}</strong><br>${p.kmpl.toFixed(2)} km/l — anomaly`)}"/>`;
  });
  s += "</svg>";
  box.innerHTML = s;
  bindTips(box);
}

// ---------- Panel: issues ----------
function renderIssues() {
  const sevW = { High: 3, Medium: 2, Low: 1 };
  const open = db.issues.filter(i => i.status !== "Resolved")
    .map(i => ({ ...i, score: sevW[i.severity] * 2 + Math.min((new Date() - new Date(i.createdAt)) / 86400000 / 7, 3) }))
    .sort((a, b) => b.score - a.score).slice(0, 6);
  const box = document.getElementById("pnlIssues");
  if (!open.length) { box.innerHTML = "<p class='cmd-muted'>Queue clear. 🎉</p>"; return; }
  const rc = i => i === 0 ? C.critical : i <= 2 ? C.serious : C.warn;
  box.innerHTML = open.map((i, idx) => `
    <div class="q-row">
      <span class="q-rank" style="background:${rc(idx)}">P${Math.min(idx + 1, 3)}</span>
      <div class="q-main"><strong>${esc(vName(i.vehicleId))}</strong> ${esc(i.title)}</div>
      <span class="q-sev" style="color:${i.severity === "High" ? C.critical : i.severity === "Medium" ? C.serious : C.muted}">${i.severity}</span>
    </div>`).join("");
}

// ---------- Panel: timeline ----------
function renderTimeline() {
  const items = [];
  db.vehicles.forEach(v => Object.entries(v.compliance || {}).forEach(([doc, till]) => {
    if (!till) return;
    const d = daysUntil(till);
    if (d <= 60) items.push({ d, label: `${v.name} · ${DOCS[doc]} renewal`, type: "RTO" });
  }));
  db.drivers.forEach(dr => { if (dr.dlExpiry) { const d = daysUntil(dr.dlExpiry); if (d <= 60) items.push({ d, label: `${dr.name} · DL renewal`, type: "DL" }); } });
  db.reminders.forEach(r => {
    const next = new Date(r.lastDate); next.setMonth(next.getMonth() + (+r.everyMonths || 3));
    const d = Math.round((next - new Date()) / 86400000);
    if (d <= 60) items.push({ d, label: `${vName(r.vehicleId)} · ${r.task}`, type: "PM" });
  });
  items.sort((a, b) => a.d - b.d);
  const box = document.getElementById("pnlTimeline");
  if (!items.length) { box.innerHTML = "<p class='cmd-muted'>Nothing due in the next 60 days.</p>"; return; }
  box.innerHTML = `<div class="tl-wrap">` + items.slice(0, 12).map(i => {
    const color = i.d < 0 ? C.critical : i.d <= 14 ? C.serious : i.d <= 30 ? C.warn : C.aqua;
    return `<div class="tl-item" style="border-top-color:${color}">
      <span class="tl-days" style="color:${color}">${i.d < 0 ? "OVERDUE " + (-i.d) + "d" : i.d === 0 ? "TODAY" : "in " + i.d + "d"}</span>
      <span class="tl-label">${esc(i.label)}</span>
      <span class="tl-type">${i.type}</span>
    </div>`;
  }).join("") + "</div>";
}

// ---------- Panel: vehicle board ----------
function renderBoard() {
  const vs = vehicleStats();
  const box = document.getElementById("pnlBoard");
  if (!vs.length) { box.innerHTML = "<p class='cmd-muted'>No vehicles.</p>"; return; }
  const dot = till => {
    if (!till) return `<span class="dstat" style="background:#3a4a63" title="not set"></span>`;
    const d = daysUntil(till);
    const c = d < 0 ? C.critical : d <= 30 ? C.warn : C.good;
    return `<span class="dstat" style="background:${c}"></span>`;
  };
  box.innerHTML = `<table class="cmd-table"><thead><tr>
      <th>VEHICLE</th><th>DRIVER</th><th>INS·PUC·FC·PRM·TAX</th><th>SPEND (RANGE)</th><th>₹/KM</th><th>KM/L</th><th>ISSUES</th>
    </tr></thead><tbody>` +
    vs.map(v => {
      const c = v.compliance || {};
      return `<tr>
        <td><strong>${esc(v.name)}</strong><br /><span class="cmd-muted">${esc(v.type)}</span></td>
        <td>${v.driver ? esc(v.driver) : "<span class='cmd-muted'>—</span>"}</td>
        <td class="dots">${dot(c.insurance)}${dot(c.puc)}${dot(c.fitness)}${dot(c.permit)}${dot(c.roadtax)}</td>
        <td>${fmtINR(v.spend)}</td>
        <td style="color:${v.cpk > v.industry ? C.red : C.aqua}">₹${v.cpk.toFixed(2)}</td>
        <td>${v.kmpl ? v.kmpl.toFixed(1) : "—"}</td>
        <td>${v.openIssues ? `<span style="color:${C.serious};font-weight:700">${v.openIssues} open</span>` : `<span style="color:${C.good}">clear</span>`}</td>
      </tr>`;
    }).join("") + "</tbody></table>";
}

// ---------- Orchestration ----------
function renderAll() {
  db = loadDB();
  const has = db.vehicles.length > 0;
  document.getElementById("cmdEmpty").hidden = has;
  document.getElementById("cmdContent").hidden = !has;
  if (!has) return;
  renderKPIs(); renderSpend(); renderCategory(); renderCpk();
  renderFuel(); renderIssues(); renderTimeline(); renderBoard();
  document.getElementById("cmdStamp").textContent = "updated " + new Date().toLocaleTimeString("en-IN");
}

document.getElementById("cmdRange").addEventListener("change", renderAll);
document.getElementById("cmdRefresh").addEventListener("click", renderAll);
renderAll();
