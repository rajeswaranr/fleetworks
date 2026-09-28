/* Fuel Sensor & Theft (FleetOps → Fuel & Energy → Fuel Sensor & Theft).
   The tank sensor's view of fuel, next to the Fuel Dashboard's view from diesel bills:
     - fuel on board across the fleet, burn rate, idling waste today, open theft/leak alerts
     - one vehicle's fuel-level curve with refuels, theft and leaks marked on it
     - which vehicles idle most and burn most
   Readings come from telemetry (devices fitted with a fuel-level sensor, or the
   simulator on Devices & Telemetry); theft and leak markers are the ai_events the
   ingest function raised, so this chart and the alerts always agree. */
(function () {
  "use strict";

  const WIN = { "24h": { label: "24 hours", ms: 864e5 }, "7d": { label: "7 days", ms: 7 * 864e5 } };
  const DEFAULT_TANK = 300;   // litres, when a vehicle has no tank capacity saved
  const F = { win: "24h", veh: "", devices: [], today: [], series: [], events: [], loaded: false };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n, { size: s }) : "");
  const signedIn = () => !!(window.fwCloud && fwCloud.user && fwCloud.user());
  const vehByUuid = id => ((window.db && db.vehicles) || []).find(v => v.dbId === id);
  const tankOf = vid => { const v = vehByUuid(vid); return (v && Number(v.tankCapacity)) || DEFAULT_TANK; };
  const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
  const fmt = (n, d = 1) => n == null || !isFinite(n) ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

  // ── data ────────────────────────────────────────────────────────────
  async function loadFleet() {
    const get = (t, q) => fwCloud.authGet(t, q).catch(() => null);
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [dev, today, ev] = await Promise.all([
      get("devices", "select=id,vehicle_id,simulated,capabilities&vehicle_id=not.is.null&limit=500"),
      get("telemetry", `select=device_id,recorded_at,speed_kmph,ignition,fuel_rate_lph,fuel_level_pct,odometer_km&recorded_at=gte.${since.toISOString()}&order=recorded_at.asc&limit=10000`),
      get("ai_events", `select=id,device_id,vehicle_id,event_type,severity,occurred_at,summary,evidence,acknowledged_at,simulated&event_type=in.(fuel_theft,fuel_leak)&occurred_at=gte.${new Date(Date.now() - 30 * 864e5).toISOString()}&order=occurred_at.desc&limit=200`),
    ]);
    F.devices = dev || []; F.today = today || []; F.events = ev || [];
    const withData = new Set(F.today.map(r => r.device_id));
    if (!F.veh || !F.devices.some(d => d.vehicle_id === F.veh)) {
      const d = F.devices.find(x => withData.has(x.id)) || F.devices[0];
      F.veh = d ? d.vehicle_id : "";
    }
  }
  async function loadSeries() {
    F.series = [];
    const devIds = F.devices.filter(d => d.vehicle_id === F.veh).map(d => d.id);
    if (!devIds.length) return;
    const from = new Date(Date.now() - WIN[F.win].ms).toISOString();
    F.series = (await fwCloud.authGet("telemetry", `select=recorded_at,fuel_level_pct,speed_kmph,ignition&device_id=in.(${devIds.join(",")})&fuel_level_pct=not.is.null&recorded_at=gte.${from}&order=recorded_at.asc&limit=5000`).catch(() => null)) || [];
  }

  // ── numbers ─────────────────────────────────────────────────────────
  // Per device, walks today's readings in time order: fuel burnt while idling
  // (ignition on, under 3 km/h), fuel burnt while moving and km covered.
  function todayByVehicle() {
    const byDev = {};
    F.today.forEach(r => (byDev[r.device_id] = byDev[r.device_id] || []).push(r));
    const out = {};
    Object.entries(byDev).forEach(([devId, rows]) => {
      const dev = F.devices.find(d => d.id === devId); if (!dev) return;
      const o = out[dev.vehicle_id] = out[dev.vehicle_id] || { idleL: 0, idleMin: 0, moveL: 0, km: 0, lastPct: null };
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1], b = rows[i];
        const h = (Date.parse(b.recorded_at) - Date.parse(a.recorded_at)) / 3600000;
        if (!(h > 0 && h < 0.5)) continue;    // skip gaps: a device that was off tells us nothing
        const rate = num(a.fuel_rate_lph), spd = num(a.speed_kmph) || 0;
        if (a.ignition && spd < 3) { o.idleMin += h * 60; if (rate != null) o.idleL += rate * h; }
        else if (spd >= 3 && rate != null) o.moveL += rate * h;
        const dk = num(b.odometer_km) - num(a.odometer_km);
        if (dk > 0 && dk < 200) o.km += dk;
      }
      const last = [...rows].reverse().find(r => r.fuel_level_pct != null);
      if (last) o.lastPct = Number(last.fuel_level_pct);
    });
    return out;
  }

  // ── render ──────────────────────────────────────────────────────────
  function render() {
    const r = $("fuelSensorRoot"); if (!r) return;
    if (!signedIn()) { r.innerHTML = `<div class="oc"><div class="oc-empty">${icon("fuel", 22)}<br><b>Sign in to see your tank sensors.</b></div></div>`; return; }
    if (!F.loaded) { r.innerHTML = `<div class="oc"><div class="oc-skel"></div><div class="oc-skel"></div><div class="oc-skel" style="height:280px"></div></div>`; return; }
    if (!F.devices.length) {
      r.innerHTML = `<div class="oc"><div class="oc-empty"><span class="ic-tile info">${icon("fuel", 22)}</span><b>No fuel sensor linked yet.</b><br>Link a tracker with a fuel-level sensor to a vehicle, or start the simulator, and the tank curve, idling and theft alerts appear here.<br><button type="button" class="btn btn-primary btn-sm" data-go="devicehub" style="margin-top:12px">Connect a sensor in Device Hub</button></div></div>`;
      r.querySelector("[data-go]").onclick = () => activateTab("devicehub");
      return;
    }
    const tv = todayByVehicle();
    let onboard = 0, withLevel = 0, idleL = 0, idleMin = 0, moveL = 0, km = 0;
    Object.entries(tv).forEach(([vid, o]) => {
      if (o.lastPct != null) { onboard += o.lastPct / 100 * tankOf(vid); withLevel++; }
      idleL += o.idleL; idleMin += o.idleMin; moveL += o.moveL; km += o.km;
    });
    const burn = km > 5 ? (moveL + idleL) / km * 100 : null;
    const openAlerts = F.events.filter(e => !e.acknowledged_at);
    const vehs = [...new Set(F.devices.map(d => d.vehicle_id))];
    const selVeh = vehByUuid(F.veh);

    r.innerHTML = `
    <div class="oc">
      <div class="oc-head">
        <h2>${icon("fuel", 20)} Fuel sensor &amp; theft watch</h2>
        <span class="oc-live">${F.today.length ? "Tank sensors live" : "No readings today"}</span>
        <span class="oc-spacer"></span>
        <label class="muted" for="fsVeh" style="font-size:.8rem">Vehicle</label>
        <select id="fsVeh">${vehs.map(id => { const v = vehByUuid(id), o = tv[id]; return `<option value="${esc(id)}" ${id === F.veh ? "selected" : ""}>${esc(v ? v.name : "Vehicle")}${o && o.lastPct != null ? ` · ${Math.round(o.lastPct / 100 * tankOf(id))} L (${Math.round(o.lastPct)}%)` : ""}</option>`; }).join("")}</select>
        <p class="oc-sub">From the fuel-level sensor in each tank, read every few seconds. Diesel bills and mileage are on the Fuel Dashboard.</p>
      </div>
      <div class="oc-kpis">
        <div class="oc-kpi k-cyan"><small>Fuel on board ${icon("fuel", 16)}</small><b>${fmt(onboard, 0)}<span>litres</span></b><em>across ${withLevel} vehicle${withLevel === 1 ? "" : "s"} reporting today</em></div>
        <div class="oc-kpi k-green"><small>Burn rate today ${icon("gauge", 16)}</small><b>${fmt(burn)}<span>L / 100 km</span></b><em>${km > 5 ? fmt(km, 0) + " km covered" : "not enough driving yet"}</em></div>
        <div class="oc-kpi k-amber"><small>Idling waste today ${icon("clock", 16)}</small><b>${fmt(idleL)}<span>litres</span></b><em>${Math.round(idleMin)} min engine on, standing</em></div>
        <div class="oc-kpi k-red"><small>Theft &amp; leak alerts ${icon("alert", 16)}</small><b>${openAlerts.length}<span>open</span></b><em>${openAlerts.length ? "check Incident Triage" : "none in 30 days"}</em></div>
      </div>
      <div class="oc-cols">
        <div class="oc-card">
          <h3>${icon("chartBar", 14)} Tank level: ${esc(selVeh ? selVeh.name : "vehicle")} <span class="oc-spacer"></span>
            <span class="oc-seg" role="group" aria-label="Time window" style="text-transform:none;letter-spacing:0">${Object.entries(WIN).map(([k, w]) => `<button type="button" class="oc-seg-btn" data-win="${k}" aria-pressed="${F.win === k}">${w.label}</button>`).join("")}</span></h3>
          <div id="fsChart"></div>
          <div class="fs-legend"><span><i class="lv"></i>Fuel level</span><span><i class="off"></i>Engine off</span><span><i class="fill"></i>Refuel</span><span><i class="theft"></i>Theft</span><span><i class="leak"></i>Leak</span></div>
        </div>
        <div class="oc-stack">
          <div class="oc-card">
            <h3>${icon("shieldAlert", 14)} How theft is caught</h3>
            <p class="fs-rule"><b>Theft:</b> the level falls 8% or more while the truck is standing or the engine is off. A normal engine cannot burn that much standing still.</p>
            <p class="fs-rule" style="margin-top:8px"><b>Leak:</b> while driving, the level falls at least 3% at 1% a minute or faster, which is faster than the engine burns.</p>
            <p class="fs-rule" style="margin-top:8px">Each alert carries its before-and-after readings, so you can show the driver or the police exactly what the sensor saw.</p>
            <button type="button" class="btn btn-outline btn-sm" data-go="triage" style="margin-top:12px">${icon("shieldAlert", 14)} Open Incident Triage</button>
          </div>
          <div class="oc-card"><h3>${icon("clock", 14)} Most idling today</h3><ul class="fs-rank" id="fsIdle"></ul></div>
        </div>
      </div>
    </div>`;
    renderChart(); renderRank(tv);
    r.querySelectorAll("[data-win]").forEach(b => b.onclick = async () => { F.win = b.dataset.win; await loadSeries(); render(); });
    $("fsVeh").onchange = async e => { F.veh = e.target.value; await loadSeries(); render(); };
    r.querySelectorAll("[data-go]").forEach(b => b.onclick = () => activateTab(b.dataset.go));
  }

  function renderChart() {
    const el = $("fsChart"); if (!el) return;
    const pts = F.series.map(r => ({ t: Date.parse(r.recorded_at), p: Number(r.fuel_level_pct), ign: r.ignition, spd: num(r.speed_kmph) || 0 })).filter(p => isFinite(p.t) && isFinite(p.p));
    if (pts.length < 2) { el.innerHTML = `<div class="oc-empty">No tank readings for this vehicle in the last ${WIN[F.win].label}.</div>`; return; }
    const tank = tankOf(F.veh);
    const W = 720, H = 300, L = 46, R = 14, Tp = 16, B = 30;
    const t0 = Date.now() - WIN[F.win].ms, t1 = Date.now();
    const x = t => L + (t - t0) / (t1 - t0) * (W - L - R), y = p => Tp + (1 - p / 100) * (H - Tp - B);
    // engine-off bands
    let bands = "", s = null;
    pts.forEach((p, i) => {
      const off = p.ign === false;
      if (off && s === null) s = p.t;
      if ((!off || i === pts.length - 1) && s !== null) { bands += `<rect x="${x(s).toFixed(1)}" y="${Tp}" width="${Math.max(1, x(p.t) - x(s)).toFixed(1)}" height="${H - Tp - B}" fill="rgba(148,163,184,.12)"/>`; s = null; }
    });
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
    const area = `${line}L${x(pts[pts.length - 1].t).toFixed(1)},${H - B}L${x(pts[0].t).toFixed(1)},${H - B}Z`;
    // refuels: a rise of 10% or more between readings
    const marks = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].p - pts[i - 1].p >= 10) marks.push({ t: pts[i].t, p: pts[i].p, c: "#10b981", l: `+${Math.round((pts[i].p - pts[i - 1].p) / 100 * tank)} L` });
    F.events.filter(e => e.vehicle_id === F.veh && Date.parse(e.occurred_at) >= t0).forEach(e => {
      const ev = e.evidence || {}, near = pts.reduce((a, b) => Math.abs(b.t - Date.parse(e.occurred_at)) < Math.abs(a.t - Date.parse(e.occurred_at)) ? b : a);
      const drop = ev.drop_pct != null ? Math.round(ev.drop_pct / 100 * tank) : null;
      marks.push({ t: Date.parse(e.occurred_at), p: near.p, c: e.event_type === "fuel_theft" ? "#ef4444" : "#f59e0b", l: `${e.event_type === "fuel_theft" ? "Theft" : "Leak"}${drop ? " −" + drop + " L" : ""}`, big: true });
    });
    const grid = [0, 25, 50, 75, 100].map(p => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" stroke="#1f2d4a" ${p ? 'stroke-dasharray="3 4"' : ""}/><text x="${L - 6}" y="${y(p) + 3}" text-anchor="end">${p}%</text>`).join("");
    const ticks = 6, lbls = Array.from({ length: ticks + 1 }, (_, i) => { const t = t0 + (t1 - t0) * i / ticks, d = new Date(t); return `<text x="${x(t)}" y="${H - 10}" text-anchor="middle">${F.win === "24h" ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</text>`; }).join("");
    const last = pts[pts.length - 1];
    el.innerHTML = `<svg class="fs-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fuel level over the last ${WIN[F.win].label}, now ${Math.round(last.p)} percent">
      <defs><linearGradient id="fsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity=".35"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>
      ${bands}${grid}${lbls}
      <path d="${area}" fill="url(#fsFill)"/><path d="${line}" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linejoin="round"/>
      ${marks.map(m => `<g><circle cx="${x(m.t).toFixed(1)}" cy="${y(m.p).toFixed(1)}" r="${m.big ? 6 : 4.5}" fill="${m.c}" stroke="#0a1120" stroke-width="2"><title>${esc(m.l)}</title></circle><text x="${x(m.t).toFixed(1)}" y="${(y(m.p) - 11).toFixed(1)}" text-anchor="middle" style="fill:${m.c};font-weight:700">${esc(m.l)}</text></g>`).join("")}
      <circle cx="${x(last.t)}" cy="${y(last.p)}" r="4" fill="#22d3ee"/><text x="${Math.min(W - R - 4, x(last.t) - 6)}" y="${y(last.p) - 10}" text-anchor="end" class="fs-now">${Math.round(last.p / 100 * tank)} L · ${Math.round(last.p)}%</text>
    </svg>`;
  }

  function renderRank(tv) {
    const el = $("fsIdle"); if (!el) return;
    const rows = Object.entries(tv).map(([vid, o]) => ({ vid, ...o })).filter(o => o.idleMin > 0).sort((a, b) => b.idleL - a.idleL || b.idleMin - a.idleMin).slice(0, 5);
    if (!rows.length) { el.innerHTML = `<li class="muted">No idling recorded today.</li>`; return; }
    const max = Math.max(...rows.map(r => r.idleMin));
    el.innerHTML = rows.map(o => { const v = vehByUuid(o.vid); return `<li><div><span>${esc(v ? v.name : "Vehicle")}</span><b>${fmt(o.idleL)} L</b></div><div class="muted" style="font-size:.72rem"><span>${Math.round(o.idleMin)} min standing, engine on</span><span>${o.km > 5 ? fmt((o.moveL + o.idleL) / o.km * 100) + " L/100 km" : ""}</span></div><div class="fs-bar"><i style="width:${(o.idleMin / max * 100).toFixed(0)}%"></i></div></li>`; }).join("");
  }

  async function open() {
    if (!$("fuelSensorRoot")) return;
    render();
    if (!signedIn()) return;
    await loadFleet(); await loadSeries();
    F.loaded = true; render();
  }
  window.FuelSensor = { open };
})();
