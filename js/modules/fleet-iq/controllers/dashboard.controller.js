/* ============ FleetWorks FleetIQ — dashboard controller ============
   FleetWorks — Grafana-style dashboards (FleetOps / FleetFin / FleetIQ)
   ============================================================
   All three module dashboards share one time-range picker so
   switching from 30-day to 7-day updates every panel at once.

   Rendered into #gfOpsGrid, #gfFinGrid, #gfIqGrid injected
   into the three module tab panels in fleet.html.  The rest of
   each tab's existing content (charts, forms, tables) is
   untouched and scrolls below. */

(function () {
  "use strict";

  /* ---- shared time-range state ---- */
  let DASH_DAYS = 30;

  function cutoffDate() {
    if (!DASH_DAYS) return null;
    const d = new Date();
    d.setDate(d.getDate() - DASH_DAYS);
    return d.toISOString().slice(0, 10);
  }

  function inRange(ds) {
    if (!ds) return false;
    const c = cutoffDate();
    return c ? ds.slice(0, 10) >= c : true;
  }

  function prevCutoff() {
    if (!DASH_DAYS) return null;
    const d = new Date();
    d.setDate(d.getDate() - DASH_DAYS * 2);
    return d.toISOString().slice(0, 10);
  }

  function inPrev(ds) {
    if (!ds) return false;
    const c = prevCutoff(), mid = cutoffDate();
    if (!c || !mid) return false;
    const s = ds.slice(0, 10);
    return s >= c && s < mid;
  }

  /* ---- safe db access ---- */
  function fl(key) { return (window.db && window.db[key]) || []; }

  /* ---- formatting helpers ---- */
  const fmt = window.fmtINR ? window.fmtINR : (v) => "₹" + Math.round(v).toLocaleString("en-IN");
  const esc = window.esc ? window.esc
    : (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* ---- colour tokens ---- */
  const G = "#3fb950", R = "#f85149", A = "#d29922", B = "#58a6ff";
  const MU = "#8b949e", BG = "#161b22";

  /* ============================================================
     SVG HELPERS
     ============================================================ */

  function sparkLine(vals, w, h, color) {
    w = w || 280; h = h || 52; color = color || G;
    if (!vals || !vals.length) return empty(w, h);
    const max = Math.max.apply(null, vals.concat([1]));
    const n = vals.length;
    const xs = vals.map(function (_, i) { return n === 1 ? w / 2 : (i / (n - 1)) * w; });
    const ys = vals.map(function (v) { return Math.round(h - 4 - (v / max) * (h - 8)); });
    var pts = xs.map(function (x, i) { return x + "," + ys[i]; }).join(" ");
    var area = "M " + xs[0] + "," + h + " " +
      xs.map(function (x, i) { return "L " + x + "," + ys[i]; }).join(" ") +
      " L " + xs[n - 1] + "," + h + " Z";
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="' + area + '" fill="' + color + '" fill-opacity="0.12"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  function empty(w, h) {
    return '<svg width="' + w + '" height="' + h + '"></svg>';
  }

  function sparkBar(vals, labels, w, h, color) {
    w = w || 320; h = h || 80; color = color || B;
    if (!vals || !vals.length) return empty(w, h);
    const max = Math.max.apply(null, vals.concat([1]));
    const n = vals.length;
    const gap = Math.floor(w / n);
    const bw = Math.max(4, gap - 3);
    var bars = vals.map(function (v, i) {
      const bh = Math.max(2, Math.round((v / max) * (h - 18)));
      const x = i * gap + Math.floor((gap - bw) / 2);
      const y = h - 16 - bh;
      const lbl = labels && labels[i] ? labels[i] : "";
      return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh +
        '" fill="' + color + '" rx="2" fill-opacity="0.85"/>' +
        '<text x="' + (x + bw / 2) + '" y="' + (h - 2) + '" text-anchor="middle"' +
        ' font-size="8" fill="' + MU + '">' + esc(lbl) + "</text>";
    }).join("");
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" xmlns="http://www.w3.org/2000/svg">' + bars + "</svg>";
  }

  function miniDonut(segs, size) {
    size = size || 64;
    const total = segs.reduce(function (s, x) { return s + x.val; }, 0);
    if (!total) {
      return '<svg width="' + size + '" height="' + size + '"><text x="' + (size / 2) +
        '" y="' + (size / 2 + 4) + '" text-anchor="middle" font-size="10" fill="' +
        MU + '">—</text></svg>';
    }
    const r = size / 2 - 3, cx = size / 2, cy = size / 2;
    var a = -Math.PI / 2;
    var paths = segs.map(function (seg) {
      const frac = seg.val / total;
      const a2 = a + frac * 2 * Math.PI;
      const x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const large = frac > 0.5 ? 1 : 0;
      const path = '<path d="M ' + cx + " " + cy + " L " + x1 + " " + y1 +
        " A " + r + " " + r + " 0 " + large + " 1 " + x2 + " " + y2 +
        ' Z" fill="' + seg.color + '"/>';
      a = a2;
      return path;
    });
    const hole = '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.52) + '" fill="' + BG + '"/>';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size +
      '" xmlns="http://www.w3.org/2000/svg">' + paths.join("") + hole + "</svg>";
  }

  function hBars(rows) {
    const max = Math.max.apply(null, rows.map(function (r) { return r.val; }).concat([1]));
    return rows.map(function (r) {
      const pct = Math.round((r.val / max) * 100);
      return '<div class="gf-hrow">' +
        '<span class="gf-hlbl">' + esc(r.label) + "</span>" +
        '<div class="gf-htrack"><div class="gf-hfill" style="width:' + pct +
        '%;background:' + (r.color || B) + '"></div></div>' +
        '<span class="gf-hval">' + (typeof r.val === "number" && r.val > 9999 ? fmt(r.val) : r.val) + "</span>" +
        "</div>";
    }).join("");
  }

  /* ============================================================
     PANEL + METRIC BUILDERS
     ============================================================ */

  function m(val, lbl, color, sub) {
    return '<div class="gf-m">' +
      '<div class="gf-mval" style="color:' + (color || G) + '">' + esc(String(val)) + "</div>" +
      '<div class="gf-mlbl">' + esc(lbl) + "</div>" +
      (sub != null ? '<div class="gf-msub">' + esc(String(sub)) + "</div>" : "") +
      "</div>";
  }

  function trend(curr, prev) {
    if (!prev) return "";
    const pct = Math.round(((curr - prev) / prev) * 100);
    const c = pct > 5 ? R : pct < -5 ? G : A;
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "→";
    return '<span class="gf-badge" style="color:' + c + '">' + arrow + " " + Math.abs(pct) + "% vs prev</span>";
  }

  function panel(title, body, wide) {
    return '<div class="gf-panel' + (wide ? " gf-wide" : "") + '">' +
      '<div class="gf-ptitle">' + esc(title) + "</div>" +
      '<div class="gf-pbody">' + body + "</div>" +
      "</div>";
  }

  function legend(items) {
    return '<div class="gf-leg">' + items.map(function (it) {
      return '<span class="gf-dot" style="background:' + it.c + '"></span>' +
        '<span>' + esc(it.l) + "</span>";
    }).join("") + "</div>";
  }

  /* ============================================================
     TIME PICKER
     ============================================================ */

  const RANGES = [{d:7,l:"7d"},{d:30,l:"30d"},{d:90,l:"90d"},{d:365,l:"1y"},{d:0,l:"All"}];

  function timePicker() {
    return '<div class="gf-tpicker">' +
      RANGES.map(function (r) {
        return '<button class="gf-tp' + (DASH_DAYS === r.d ? " gf-tp-on" : "") +
          '" onclick="gfSetRange(' + r.d + ')">' + r.l + "</button>";
      }).join("") +
      "</div>";
  }

  /* ============================================================
     BUCKET HELPERS
     ============================================================ */

  function getBuckets(n) {
    const nowMs = Date.now();
    const spanMs = (DASH_DAYS || 365) * 86400000;
    const bsize = spanMs / n;
    return Array.from({length: n}, function (_, i) {
      const end   = new Date(nowMs - (n - i - 1) * bsize);
      const start = new Date(nowMs - (n - i)     * bsize);
      return {
        s:   start.toISOString().slice(0, 10),
        e:   end.toISOString().slice(0, 10),
        lbl: end.toLocaleDateString("en-IN", {day:"numeric", month:"short"}),
      };
    });
  }

  function bucketCount(dateField, records, n) {
    const bkts = getBuckets(n);
    return bkts.map(function (b) {
      return records.filter(function (r) {
        const d = (r[dateField] || "").slice(0, 10);
        return d >= b.s && d <= b.e;
      }).length;
    });
  }

  function bucketSum(dateField, amtField, records, n) {
    const bkts = getBuckets(n);
    return bkts.map(function (b) {
      return records.filter(function (r) {
        const d = (r[dateField] || "").slice(0, 10);
        return d >= b.s && d <= b.e;
      }).reduce(function (s, r) { return s + (+r[amtField] || 0); }, 0);
    });
  }

  /* ============================================================
     FLEETOPS DASHBOARD
     ============================================================ */

  function renderGfOps() {
    const el = document.getElementById("gfOpsGrid");
    if (!el) return;

    const vehicles   = fl("vehicles");
    const issues     = fl("issues");
    const workOrders = fl("workOrders");
    const drivers    = fl("drivers");
    const expenses   = fl("expenses");
    const fuelLogs   = fl("fuelLogs");

    const openIss  = issues.filter(function (i) { return i.status !== "Resolved"; });
    const openWO   = workOrders.filter(function (w) { return w.status !== "Completed"; });
    const inShop   = (function () {
      const s = {};
      openWO.forEach(function (w) { s[w.vehicleId] = true; });
      return Object.keys(s).length;
    }());
    const active   = Math.max(vehicles.length - inShop, 0);
    const critIss  = openIss.filter(function (i) { return i.severity === "High"; }).length;
    const medIss   = openIss.filter(function (i) { return i.severity === "Medium"; }).length;
    const lowIss   = openIss.filter(function (i) { return !i.severity || i.severity === "Low"; }).length;

    const rExp  = expenses.filter(function (e) { return inRange(e.date); });
    const rFuel = fuelLogs.filter(function (f) { return inRange(f.date); });
    const rWO   = workOrders.filter(function (w) { return inRange(w.createdAt); });
    const spend  = rExp.concat(rFuel).reduce(function (s, x) { return s + (+x.amount || 0); }, 0);
    const pSpend = expenses.filter(function (e) { return inPrev(e.date); })
      .concat(fuelLogs.filter(function (f) { return inPrev(f.date); }))
      .reduce(function (s, x) { return s + (+x.amount || 0); }, 0);

    const rs = window.reminderStatus ? window.reminderStatus() : [];
    const compliance = rs.length
      ? Math.round(rs.filter(function (r) { return !r.overdue; }).length / rs.length * 100)
      : 100;

    const N = 8, bkts = getBuckets(N);
    const woTrend  = bucketCount("createdAt", workOrders, N);
    const issTrend = bucketCount("createdAt", issues, N);
    const lbls     = bkts.map(function (b) { return b.lbl; });
    const assigned = drivers.filter(function (d) { return d.vehicleId; }).length;
    const doneWO   = rWO.filter(function (w) { return w.status === "Completed"; }).length;

    el.innerHTML = timePicker() + '<div class="gf-grid">' +
      panel("Fleet", m(vehicles.length, "Total Vehicles", B) + m(active, "Active", active ? G : MU, inShop + " in shop")) +
      panel("Open Issues",
        '<div class="gf-flex">' + miniDonut([{val:critIss,color:R},{val:medIss,color:A},{val:lowIss,color:G}]) +
        '<div>' + m(openIss.length, "Open", openIss.length ? A : G) +
        legend([{c:R,l:"Critical "+critIss},{c:A,l:"Med "+medIss},{c:G,l:"Low "+lowIss}]) +
        '</div></div>') +
      panel("Work Orders", m(openWO.length, "In Progress", openWO.length ? A : G) + m(doneWO, "Done (period)", G)) +
      panel("Maintenance", m(compliance + "%", "PM Compliance", compliance >= 90 ? G : compliance >= 70 ? A : R)) +
      panel("Period Spend", m(fmt(spend), "Total Cost", B) + trend(spend, pSpend)) +
      panel("Drivers", m(drivers.length, "Total", B) + m(assigned, "Assigned", G, (drivers.length - assigned) + " unassigned")) +
      panel("Work Order Trend", sparkBar(woTrend, lbls, 320, 72, B), true) +
      panel("Issue Trend", sparkLine(issTrend, 320, 60, A) +
        '<div class="gf-msub" style="margin-top:4px">Issues created per period</div>', true) +
      "</div>";
  }

  /* ============================================================
     FLEETFIN DASHBOARD
     ============================================================ */

  function renderGfFin() {
    const el = document.getElementById("gfFinGrid");
    if (!el) return;

    const expenses = fl("expenses");
    const fuelLogs = fl("fuelLogs");
    const vehicles = fl("vehicles");

    const rExp  = expenses.filter(function (e) { return inRange(e.date); });
    const rFuel = fuelLogs.filter(function (f) { return inRange(f.date); });
    const expTotal  = rExp.reduce(function (s, e) { return s + (+e.amount || 0); }, 0);
    const fuelTotal = rFuel.reduce(function (s, f) { return s + (+f.amount || 0); }, 0);
    const currTotal = expTotal + fuelTotal;
    const prevTotal = expenses.filter(function (e) { return inPrev(e.date); })
      .concat(fuelLogs.filter(function (f) { return inPrev(f.date); }))
      .reduce(function (s, x) { return s + (+x.amount || 0); }, 0);

    // Top spend categories
    const byCat = {};
    rExp.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + (+e.amount || 0); });
    const catRows = Object.keys(byCat)
      .map(function (k) { return {label: k, val: byCat[k], color: B}; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 6);

    // Trends
    const N = 8, bkts = getBuckets(N);
    const expTrend  = bucketSum("date", "amount", expenses, N);
    const fuelTrend = bucketSum("date", "amount", fuelLogs, N);
    const totalTrend = expTrend.map(function (v, i) { return v + fuelTrend[i]; });
    const lbls = bkts.map(function (b) { return b.lbl; });

    // Cost per KM
    var totalKm = 0;
    vehicles.forEach(function (v) {
      const fills = window.vehicleFills ? window.vehicleFills(v.id) : [];
      if (fills.length > 1) totalKm += fills[fills.length - 1].odo - fills[0].odo;
    });
    const allCost = expenses.reduce(function (s, e) { return s + (+e.amount || 0); }, 0) +
                    fuelLogs.reduce(function (s, f) { return s + (+f.amount || 0); }, 0);
    const cpk = totalKm ? (allCost / totalKm).toFixed(2) : null;

    // Avg kmpl
    const kmplVals = fuelLogs
      .filter(function (f) { return f.kmpl && +f.kmpl > 0; })
      .slice(-20).map(function (f) { return +f.kmpl; });
    const avgKmpl = kmplVals.length
      ? (kmplVals.reduce(function (s, x) { return s + x; }, 0) / kmplVals.length).toFixed(1)
      : null;

    el.innerHTML = timePicker() + '<div class="gf-grid">' +
      panel("Total Spend", m(fmt(currTotal), "This Period", B) + trend(currTotal, prevTotal)) +
      panel("Fuel vs. Maintenance",
        '<div class="gf-flex">' + miniDonut([{val:fuelTotal,color:A},{val:expTotal,color:B}]) +
        '<div>' + legend([{c:A,l:"Fuel "+fmt(fuelTotal)},{c:B,l:"Maint. "+fmt(expTotal)}]) + '</div></div>') +
      panel("Cost per KM", m(cpk ? "₹" + cpk : "—", "Lifetime avg", B, "all vehicles")) +
      panel("Fuel Efficiency", m(avgKmpl ? avgKmpl + " kmpl" : "—", "Fleet Average", avgKmpl ? G : MU, "last 20 fills")) +
      panel("Spend Trend",
        sparkLine(totalTrend, 320, 60, B) +
        legend([{c:B,l:"Total spend"}]), true) +
      panel("Top Spending Categories",
        catRows.length ? hBars(catRows) : '<span class="gf-msub">No entries this period</span>', true) +
      panel("Fuel vs. Maintenance Trend",
        sparkBar(fuelTrend.map(function (v, i) { return v + expTrend[i]; }), lbls, 320, 72, A) +
        legend([{c:A,l:"Fuel"},{c:B,l:"Maint."}]), true) +
      "</div>";
  }

  /* ============================================================
     FLEETIQ DASHBOARD
     ============================================================ */

  function renderGfIq() {
    const el = document.getElementById("gfIqGrid");
    if (!el) return;

    const vehicles   = fl("vehicles");
    const fuelLogs   = fl("fuelLogs");
    const expenses   = fl("expenses");
    const workOrders = fl("workOrders");
    const issues     = fl("issues");

    // Foresight risk scoring (uses xgboost.js if loaded)
    var highRisk = 0, watchRisk = 0, lowRisk = 0, scored = 0;
    if (window.fwXgb && window.fwXgb.predict) {
      const hist = window.fwXgb.historyRowCount ? window.fwXgb.historyRowCount() : 0;
      vehicles.forEach(function (v) {
        const feats = window.fwXgb.featuresForVehicle ? window.fwXgb.featuresForVehicle(v.id) : {};
        const r = window.fwXgb.predict(feats, {historyRows: hist});
        if (r.ok) {
          scored++;
          if (r.band === "high") highRisk++;
          else if (r.band === "watch") watchRisk++;
          else lowRisk++;
        }
      });
    }

    // Efficiency trend
    const N = 8, bkts = getBuckets(N);
    const effTrend = bkts.map(function (b) {
      const fills = fuelLogs.filter(function (f) {
        return f.kmpl && +f.kmpl > 0 && f.date >= b.s && f.date <= b.e;
      });
      return fills.length ? fills.reduce(function (s, f) { return s + +f.kmpl; }, 0) / fills.length : 0;
    });
    const lbls = bkts.map(function (b) { return b.lbl; });

    // Anomalies: expenses > 2.5× period average
    const rExp = expenses.filter(function (e) { return inRange(e.date); });
    const avgAmt = rExp.length ? rExp.reduce(function (s, e) { return s + +e.amount; }, 0) / rExp.length : 0;
    const anomalies = rExp.filter(function (e) { return +e.amount > avgAmt * 2.5; }).length;

    // Recurrent issues: same vehicle + title prefix, ≥3 occurrences
    const issMap = {};
    issues.forEach(function (i) {
      const k = i.vehicleId + "|" + (i.title || "").toLowerCase().slice(0, 20);
      issMap[k] = (issMap[k] || 0) + 1;
    });
    const recurrent = Object.keys(issMap).filter(function (k) { return issMap[k] >= 3; }).length;

    // WO completion rate (period)
    const rWO   = workOrders.filter(function (w) { return inRange(w.createdAt); });
    const doneWO = rWO.filter(function (w) { return w.status === "Completed"; });
    const compRate = rWO.length ? Math.round(doneWO.length / rWO.length * 100) : 0;

    // Predicted next-month spend (6-month avg)
    const sixAgo = (function () { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); }());
    const sixMonthExp = expenses.filter(function (e) { return e.date >= sixAgo; });
    const predicted = sixMonthExp.length
      ? Math.round(sixMonthExp.reduce(function (s, e) { return s + +e.amount; }, 0) / 6)
      : 0;

    // Top vehicles by issue count
    const rIss = issues.filter(function (i) { return inRange(i.createdAt); });
    const vMap = {};
    rIss.forEach(function (i) { vMap[i.vehicleId] = (vMap[i.vehicleId] || 0) + 1; });
    const topVeh = Object.keys(vMap)
      .map(function (id) {
        const v = vehicles.find(function (x) { return x.id === id; });
        return {label: v ? v.name : id.slice(0, 8), val: vMap[id], color: R};
      })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 5);

    const modelNote = scored > 0
      ? (highRisk + watchRisk + lowRisk) + " vehicles scored"
      : "Train model to activate";

    el.innerHTML = timePicker() + '<div class="gf-grid">' +
      panel("Foresight Risk",
        '<div class="gf-flex">' + miniDonut([{val:highRisk,color:R},{val:watchRisk,color:A},{val:lowRisk,color:G}]) +
        '<div>' + legend([{c:R,l:"High "+highRisk},{c:A,l:"Watch "+watchRisk},{c:G,l:"Low "+lowRisk}]) +
        '<div class="gf-msub" style="margin-top:6px">' + esc(modelNote) + "</div>" +
        '</div></div>') +
      panel("Expense Anomalies", m(anomalies, "Outliers this period", anomalies ? R : G, "expense ≥ 2.5× avg")) +
      panel("Recurrent Issues", m(recurrent, "Same fault ≥3×", recurrent ? A : G, "per vehicle")) +
      panel("WO Completion", m(compRate + "%", "This Period", compRate >= 80 ? G : A, doneWO.length + " / " + rWO.length + " jobs")) +
      panel("Predicted Monthly", m(predicted ? fmt(predicted) : "—", "Next 30d (estimated)", B, "6-month trend")) +
      panel("Fuel Efficiency Trend",
        sparkLine(effTrend, 320, 60, G) + legend([{c:G,l:"Fleet avg kmpl"}]), true) +
      panel("Top Vehicles by Issues",
        topVeh.length ? hBars(topVeh) : '<span class="gf-msub">No issues this period</span>', true) +
      "</div>";
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  window.gfSetRange = function (days) {
    DASH_DAYS = +days;
    renderGfOps();
    renderGfFin();
    renderGfIq();
  };

  window.renderGfDash = function () {
    renderGfOps();
    renderGfFin();
    renderGfIq();
  };

  window.renderGfOps = renderGfOps;
  window.renderGfFin = renderGfFin;
  window.renderGfIq  = renderGfIq;
})();
