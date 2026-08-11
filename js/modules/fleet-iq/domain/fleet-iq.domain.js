/* ============ FleetWorks — fleet-iq/domain ============
   Pure FleetIQ forecasting, prediction, anomaly, and what-if helpers. */

(function () {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const INDUSTRY = {
    costPerKm: {
      "Truck (HCV)": 3.2, "LCV": 1.9, "Bus": 3.6,
      "Tipper": 4.1, "Trailer": 3.4, "Tanker": 3.3,
    },
    parts: {
      "Tyres":                { km: 70000, months: 30, cost: 68000, note: "full axle set, HCV" },
      "Battery":              { km: null,  months: 27, cost: 14500, note: "2 x 12V heavy duty" },
      "Brakes":               { km: 45000, months: 18, cost: 9500,  note: "liners + drums skimming" },
      "Clutch":               { km: 90000, months: 36, cost: 22000, note: "plate + pressure plate" },
      "Engine Oil & Filters": { km: 15000, months: 6,  cost: 8500,  note: "oil + oil/fuel/air filters" },
      "Suspension":           { km: 80000, months: 30, cost: 16000, note: "leaf springs + bushes" },
      "Electrical":           { km: null,  months: 24, cost: 6000,  note: "alternator/starter refurb" },
    },
  };

  const EXPECTED_KMPL = {
    "Truck (HCV)": 4.0, "LCV": 8.5, "Bus": 4.5,
    "Tipper": 3.2, "Trailer": 3.6, "Tanker": 3.8,
  };

  function monthKey(dateStr) {
    return String(dateStr || "").slice(0, 7);
  }

  function monthLabel(key) {
    const [y, m] = String(key || "").split("-");
    return MONTHS[+m - 1] + " '" + String(y || "").slice(2);
  }

  function addMonths(key, n) {
    const [y, m] = String(key || "").split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function monthDiff(a, b) {
    const [ay, am] = String(a || "").split("-").map(Number);
    const [by, bm] = String(b || "").split("-").map(Number);
    return (by - ay) * 12 + (bm - am);
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function mean(a) {
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  }

  function median(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function monthlySeries(expenses) {
    const map = {};
    (expenses || []).forEach(e => {
      const k = monthKey(e.date);
      if (k) map[k] = (map[k] || 0) + Number(e.amount || 0);
    });
    const keys = Object.keys(map).sort();
    if (!keys.length) return [];
    const out = [];
    for (let k = keys[0]; k <= keys[keys.length - 1]; k = addMonths(k, 1)) {
      out.push({ key: k, amount: map[k] || 0 });
    }
    return out;
  }

  function forecastMonthly(totals, horizon) {
    const rows = totals || [];
    const n = rows.length;
    const h = Number(horizon || 0);
    if (n === 0 || h <= 0) return [];
    if (n < 3) {
      const avg = mean(rows.map(t => Number(t.amount || 0)));
      return Array.from({ length: h }, (_, i) => ({ key: addMonths(rows[n - 1].key, i + 1), amount: avg }));
    }
    const xs = rows.map((_, i) => i);
    const ys = rows.map(t => Number(t.amount || 0));
    const xm = mean(xs);
    const ym = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xm) * (ys[i] - ym);
      den += (xs[i] - xm) ** 2;
    }
    const b = den ? num / den : 0;
    const a = ym - b * xm;
    const damp = 0.6;
    return Array.from({ length: h }, (_, i) => {
      const x = n + i;
      const raw = a + b * damp * x;
      return { key: addMonths(rows[n - 1].key, i + 1), amount: Math.max(raw, ym * 0.3) };
    });
  }

  function filteredExpenses(state, filters) {
    const db = state || {};
    const f = filters || {};
    const veh = f.vehicleId || "all";
    const months = Number(f.period || 12);
    const cutoff = addMonths(todayKey(), -(months - 1));
    return (db.expenses || []).filter(e =>
      (veh === "all" || e.vehicleId === veh) && monthKey(e.date) >= cutoff
    );
  }

  function vehicleStats(state, filters) {
    const db = state || {};
    const months = Number(filters && filters.period || 12);
    const cutoff = addMonths(todayKey(), -(months - 1));
    return (db.vehicles || []).map(v => {
      const spend = (db.expenses || [])
        .filter(e => e.vehicleId === v.id && monthKey(e.date) >= cutoff)
        .reduce((s, e) => s + Number(e.amount || 0), 0);
      const firstK = (db.expenses || []).filter(e => e.vehicleId === v.id).map(e => monthKey(e.date)).sort()[0];
      const activeMonths = Math.min(months, firstK ? monthDiff(firstK, todayKey()) + 1 : months);
      const km = Number(v.kmPerMonth || 0) * Math.max(activeMonths, 1);
      return {
        ...v,
        spend,
        costPerKm: km ? spend / km : 0,
        industry: INDUSTRY.costPerKm[v.type] || 3.0,
      };
    });
  }

  function partStats(expenses) {
    const map = {};
    (expenses || []).forEach(e => {
      if (!map[e.category]) map[e.category] = { total: 0, count: 0 };
      map[e.category].total += Number(e.amount || 0);
      map[e.category].count++;
    });
    return Object.entries(map)
      .map(([cat, s]) => ({
        category: cat,
        total: s.total,
        count: s.count,
        avg: s.total / s.count,
        industryCost: INDUSTRY.parts[cat] ? INDUSTRY.parts[cat].cost : null,
      }))
      .sort((a, b) => b.total - a.total);
  }

  function predictParts(state) {
    const db = state || {};
    const preds = [];
    const now = new Date();
    (db.vehicles || []).forEach(v => {
      Object.entries(INDUSTRY.parts).forEach(([cat, ref]) => {
        const history = (db.expenses || [])
          .filter(e => e.vehicleId === v.id && e.category === cat)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (!history.length) return;
        const last = history[history.length - 1];
        const fleetGaps = [];
        (db.vehicles || []).forEach(v2 => {
          const h2 = (db.expenses || [])
            .filter(e => e.vehicleId === v2.id && e.category === cat)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
          for (let i = 1; i < h2.length; i++) fleetGaps.push(monthDiff(monthKey(h2[i - 1].date), monthKey(h2[i].date)));
        });
        const observed = median(fleetGaps.filter(g => g > 0));
        const kmPerMonth = Number(v.kmPerMonth || 0) || 1;
        const industryMonths = ref.km ? Math.min(ref.months, ref.km / kmPerMonth) : ref.months;
        const expectedMonths = observed ? 0.6 * observed + 0.4 * industryMonths : industryMonths;
        const elapsed = (now - new Date(last.date)) / (1000 * 3600 * 24 * 30.44);
        const lifeUsed = Math.min(elapsed / expectedMonths, 1.5);
        const monthsLeft = Math.max(expectedMonths - elapsed, 0);
        const dueDate = new Date(now.getTime() + monthsLeft * 30.44 * 24 * 3600 * 1000);
        const fleetCosts = (db.expenses || []).filter(e => e.category === cat).map(e => Number(e.amount || 0));
        const estCost = fleetCosts.length ? mean(fleetCosts) : ref.cost;
        preds.push({
          vehicle: v,
          category: cat,
          lifeUsed,
          kmLeft: Math.round(monthsLeft * kmPerMonth),
          dueDate,
          estCost,
          monthsLeft,
          basis: observed ? "your fleet history + industry model" : "industry lifespan model",
        });
      });
    });
    return preds.sort((a, b) => a.monthsLeft - b.monthsLeft);
  }

  function iqImpact(state, signals) {
    const monthly = monthlySeries((state && state.expenses) || []);
    const forecast = forecastMonthly(monthly.slice(-12), 3);
    const predictions = predictParts(state);
    const due = predictions.filter(p => p.lifeUsed >= 0.85);
    const dueCost = due.reduce((s, p) => s + Number(p.estCost || 0), 0);
    return {
      forecast,
      forecastTotal: forecast.reduce((s, f) => s + Number(f.amount || 0), 0),
      dueCount: due.length,
      dueCost,
      avoidedCost: dueCost * 0.4,
      activeSignals: Number(signals || 0),
    };
  }

  function vehicleName(state, vehicleId) {
    const v = ((state && state.vehicles) || []).find(x => x.id === vehicleId);
    return v ? v.name : "Unknown";
  }

  function recurrentRows(state) {
    const db = state || {};
    const rows = [];
    (db.vehicles || []).forEach(v => {
      const cats = {};
      (db.expenses || []).filter(e => e.vehicleId === v.id).forEach(e => (cats[e.category] = cats[e.category] || []).push(e));
      Object.entries(cats).filter(([, l]) => l.length >= 2).forEach(([c, l]) =>
        rows.push({ v: v.name, what: c, kind: "Repeat repair", n: l.length, total: l.reduce((s, e) => s + Number(e.amount || 0), 0), last: l.map(e => e.date).sort().pop() }));
      const titles = {};
      (db.issues || []).filter(i => i.vehicleId === v.id).forEach(i => (titles[String(i.title || "").trim().toLowerCase()] = titles[String(i.title || "").trim().toLowerCase()] || []).push(i));
      Object.values(titles).filter(l => l.length >= 2).forEach(l =>
        rows.push({ v: v.name, what: l[0].title, kind: "Repeat issue", n: l.length, total: 0, last: l.map(i => i.createdAt).sort().pop() }));
    });
    return rows.sort((a, b) => b.n - a.n);
  }

  function deviationRows(state, filters) {
    const vs = vehicleStats(state, filters).filter(v => v.costPerKm > 0);
    const avg = mean(vs.map(v => v.costPerKm));
    return vs.map(v => ({ ...v, fleetAvg: avg, deviationPct: avg ? ((v.costPerKm - avg) / avg) * 100 : 0 }));
  }

  function anomalyRows(state) {
    const db = state || {};
    const byCat = {};
    (db.expenses || []).forEach(e => (byCat[e.category] = byCat[e.category] || []).push(Number(e.amount || 0)));
    const rows = [];
    (db.expenses || []).forEach(e => {
      const arr = byCat[e.category];
      if (!arr || arr.length < 3) return;
      const avg = mean(arr);
      if (Number(e.amount || 0) > avg * 1.8) rows.push({ ...e, avg, x: Number(e.amount || 0) / avg, vehicleName: vehicleName(db, e.vehicleId) });
    });
    return rows.sort((a, b) => b.x - a.x);
  }

  function recommendationItems(state, insights, filters) {
    const db = state || {};
    const items = [];
    predictParts(db).filter(p => p.lifeUsed >= 0.85).slice(0, 5).forEach(p =>
      items.push({ ic: "wrench", tone: "warning", t: `Plan ${p.category} for ${p.vehicle.name} now — ~₹${Math.round(p.estCost).toLocaleString("en-IN")} planned beats a roadside failure`, d: p.lifeUsed >= 1 ? "Overdue" : "~" + p.dueDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) }));
    (insights || []).filter(i => i.sev >= 3).slice(0, 5).forEach(i =>
      items.push({ ic: "alert", tone: "danger", t: `${i.title} — ${i.detail}`, d: i.tag }));
    const vs = vehicleStats(db, filters).filter(v => v.costPerKm > 0);
    const avg = mean(vs.map(v => v.costPerKm));
    vs.filter(v => avg && (v.costPerKm - avg) / avg > 0.2).forEach(v =>
      items.push({ ic: "chartBar", tone: "info", t: `Audit ${v.name}: ₹${v.costPerKm.toFixed(2)}/km vs fleet ₹${avg.toFixed(2)} — check driver habits, route or a lingering fault`, d: "Deviation" }));
    return items;
  }

  function fuelTheftFlags(state) {
    const db = state || {};
    const flags = [];
    (db.vehicles || []).forEach(v => {
      const fills = (db.fuelLogs || []).filter(f => f.vehicleId === v.id && f.odo > 0 && f.litres > 0)
        .sort((a, b) => Number(a.odo || 0) - Number(b.odo || 0));
      if (fills.length < 4) return;
      const gaps = [];
      for (let i = 1; i < fills.length; i++) {
        const dist = Number(fills[i].odo || 0) - Number(fills[i - 1].odo || 0);
        if (dist > 0) gaps.push({ fill: fills[i], kmpl: dist / Number(fills[i].litres || 1), dist });
      }
      if (gaps.length < 3) return;
      const base = median(gaps.map(x => x.kmpl));
      gaps.forEach(x => {
        if (!base || x.kmpl >= base * 0.78) return;
        const missing = Number(x.fill.litres || 0) - x.dist / base;
        if (missing < 8) return;
        flags.push({
          vehicle: v.name,
          date: x.fill.date,
          litres: Number(x.fill.litres || 0),
          kmpl: x.kmpl,
          base,
          missing,
          cost: missing * (Number(x.fill.amount || 0) / Number(x.fill.litres || 1)),
        });
      });
    });
    return flags.sort((a, b) => b.missing - a.missing);
  }

  function whatIfBase(state) {
    const db = state || {};
    const cutoff = addMonths(todayKey(), -11);
    return {
      maint: (db.expenses || []).filter(e => monthKey(e.date) >= cutoff).reduce((s, e) => s + Number(e.amount || 0), 0) / 12,
      fuel: (db.fuelLogs || []).filter(f => monthKey(f.date) >= cutoff).reduce((s, f) => s + Number(f.amount || 0), 0) / 12,
      n: (db.vehicles || []).length || 1,
    };
  }

  function projectWhatIf(base, input) {
    const b = base || { maint: 0, fuel: 0, n: 1 };
    const fp = Number(input && input.fuelPct || 0);
    const kp = Number(input && input.kmPct || 0);
    const av = Number(input && input.addedVehicles || 0);
    const scale = 1 + av / b.n;
    const projected = b.fuel * (1 + fp) * (1 + kp) * scale + b.maint * (1 + kp * 0.6) * scale;
    const current = b.fuel + b.maint;
    const delta = projected - current;
    return { current, projected, delta, yearlyDelta: delta * 12, increase: delta >= 0 };
  }

  window.FWFleetIQDomain = window.FWFleetIQDomain || {
    INDUSTRY,
    EXPECTED_KMPL,
    monthKey,
    monthLabel,
    addMonths,
    monthDiff,
    todayKey,
    mean,
    median,
    filteredExpenses,
    monthlySeries,
    forecastMonthly,
    vehicleStats,
    partStats,
    predictParts,
    iqImpact,
    recurrentRows,
    deviationRows,
    anomalyRows,
    recommendationItems,
    fuelTheftFlags,
    whatIfBase,
    projectWhatIf,
  };
})();
