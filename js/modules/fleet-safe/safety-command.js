/* FleetSafe Command Centre.
   One screen for "is the fleet safe right now, and what do I do next?":
     - a fleet safety score ring and four KPIs with trend against the previous window
     - a live event feed you can filter, search and drive from the keyboard
     - a detail drawer with the clip, the evidence and the next action
     - the drivers who need attention and the hours of the day when risk peaks
   It reads the same views the older Safety & Coaching tab uses (v_safety_events,
   v_driver_safety_score, coaching_sessions) plus the AI detections from the vehicle
   twin, so every number here agrees with the rest of FleetSafe. */
"use strict";

const SC_WINDOWS = { "24h": { label: "24 hours", ms: 864e5, buckets: 24, unit: "h" }, "7d": { label: "7 days", ms: 7 * 864e5, buckets: 7, unit: "d" }, "30d": { label: "30 days", ms: 30 * 864e5, buckets: 30, unit: "d" } };
const SC_SEV = { critical: { c: "#dc2626", rank: 0, label: "Critical" }, warning: { c: "#f59e0b", rank: 1, label: "Warning" }, info: { c: "#64748b", rank: 2, label: "Info" } };
const SC_ICON = {
  forward_collision: "shieldAlert", pedestrian_warning: "shieldAlert", lane_departure: "map", headway_warning: "carFront",
  fatigue: "eye", distraction: "eye", phone_use: "phone", no_seatbelt: "user", smoking: "alert",
  harsh_brake: "gauge", harsh_accel: "gauge", harsh_corner: "gauge", overspeed: "gauge",
  fuel_drop: "fuel", tamper: "alert", power_cut: "battery", sos: "sos", panic: "sos",
  fuel_theft: "fuel", fuel_leak: "droplet", tyre_pressure_loss: "tire", tyre_low_pressure: "tire", engine_overheat: "engine", low_battery: "battery",
};
const SC_AI_LABEL = { fuel_theft: "Fuel theft", fuel_leak: "Fuel leak", tyre_pressure_loss: "Tyre pressure loss", tyre_low_pressure: "Low tyre pressure", engine_overheat: "Engine overheating", low_battery: "Low battery" };

const _sc = {
  win: "7d", filter: "all", type: "", q: "", driver: "", hour: null, sel: null,
  events: [], scores: [], coaching: [], aiEvents: [], devices: [], loaded: false, timer: null, at: 0,
};

const scEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const scLabel = t => (typeof SF_EVENT_LABEL !== "undefined" && SF_EVENT_LABEL[t]) || SC_AI_LABEL[t] || String(t).replace(/_/g, " ");
const scAgo = ts => {
  const s = Math.max(0, Math.round((Date.now() - new Date(ts)) / 1000));
  return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago";
};
const scVehName = id => {
  const v = (window.db && db.vehicles || []).find(x => (x.dbId || x.id) === id);
  return v ? v.name : null;
};
const scIcon = (name, size = 18) => (window.FWIcon ? FWIcon(name || "alert", { size }) : "");

// ── data ─────────────────────────────────────────────────────────────────
async function scLoad() {
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) { _sc.loaded = true; return false; }
  const get = (t, q) => fwCloud.authGet(t, q).catch(() => []);
  const [ev, sc, co, ai, dv] = await Promise.all([
    get("v_safety_events", "select=*&order=occurred_at.desc&limit=500"),
    get("v_driver_safety_score", "select=*"),
    get("coaching_sessions", "select=*&order=assigned_at.desc&limit=100"),
    get("ai_events", "select=*&order=occurred_at.desc&limit=100"),
    get("devices", "select=id,last_seen_at,simulated&limit=500"),
  ]);
  _sc.events = ev || []; _sc.scores = sc || []; _sc.coaching = co || []; _sc.aiEvents = ai || []; _sc.devices = dv || [];
  _sc.loaded = true; _sc.at = Date.now();
  return true;
}

// ── numbers ──────────────────────────────────────────────────────────────
function scWindowEvents(offset = 0) {
  const w = SC_WINDOWS[_sc.win], end = Date.now() - offset * w.ms, start = end - w.ms;
  return _sc.events.filter(e => { const t = +new Date(e.occurred_at); return t >= start && t < end; });
}
function scBuckets(list) {
  const w = SC_WINDOWS[_sc.win], out = new Array(w.buckets).fill(0), start = Date.now() - w.ms, size = w.ms / w.buckets;
  list.forEach(e => { const i = Math.min(w.buckets - 1, Math.floor((+new Date(e.occurred_at) - start) / size)); if (i >= 0) out[i]++; });
  return out;
}
function scSpark(vals, color) {
  const max = Math.max(1, ...vals), w = 88, h = 32, step = w / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function scDelta(now, prev, goodWhenDown = true) {
  if (!prev && !now) return `<span class="d flat">no change</span>`;
  if (!prev) return `<span class="d up">new this period</span>`;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return `<span class="d flat">same as before</span>`;
  const worse = goodWhenDown ? pct > 0 : pct < 0;
  return `<span class="d ${worse ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs previous ${SC_WINDOWS[_sc.win].label}</span>`;
}
const scScoreBand = s => s == null ? { cls: "none", label: "Not enough data" } : s >= 80 ? { cls: "ok", label: "Safe" } : s >= 60 ? { cls: "warn", label: "Needs attention" } : { cls: "bad", label: "At risk" };

// ── render ───────────────────────────────────────────────────────────────
function scRoot() { return document.getElementById("safeCmdRoot"); }

function scRender() {
  const root = scRoot(); if (!root) return;
  const cur = scWindowEvents(0), prev = scWindowEvents(1);
  const crit = cur.filter(e => e.severity === "critical"), critPrev = prev.filter(e => e.severity === "critical");
  const unrev = _sc.events.filter(e => !e.acknowledged_at);
  const scored = _sc.scores.filter(s => s.safety_score != null);
  const fleetScore = scored.length ? Math.round(scored.reduce((t, s) => t + Number(s.safety_score), 0) / scored.length) : null;
  const atRisk = _sc.scores.filter(s => s.band === "at_risk");
  const online = _sc.devices.filter(d => d.last_seen_at && Date.now() - new Date(d.last_seen_at) < 5 * 60000).length;
  const band = scScoreBand(fleetScore);
  const ringColor = fleetScore == null ? "#94a3b8" : fleetScore >= 80 ? "#16a34a" : fleetScore >= 60 ? "#f59e0b" : "#dc2626";
  const R = 78, C = 2 * Math.PI * R;

  root.innerHTML = `
  <div class="sc">
    <div class="sc-head">
      <h2>Safety Command Centre</h2>
      <span class="sc-live" id="scLive" role="status"><span class="sc-dot"></span><span id="scLiveTxt">Live</span></span>
      <span class="sc-spacer"></span>
      <div class="sc-seg" role="group" aria-label="Time window">
        ${Object.entries(SC_WINDOWS).map(([k, w]) => `<button type="button" class="sc-seg-btn" data-win="${k}" aria-pressed="${_sc.win === k}">${w.label}</button>`).join("")}
      </div>
      <button type="button" class="btn btn-sm sc-refresh" id="scRefresh">Refresh</button>
    </div>

    <div class="sc-hero">
      <div class="sc-card sc-ring">
        <h3>Fleet safety score</h3>
        <p class="sc-sub">Average of all scored drivers, last 30 days</p>
        <svg viewBox="0 0 190 190" role="img" aria-label="Fleet safety score ${fleetScore == null ? "not available" : fleetScore + " out of 100"}">
          <circle class="track" cx="95" cy="95" r="${R}" fill="none" stroke-width="14"/>
          <circle class="val" id="scRingVal" cx="95" cy="95" r="${R}" fill="none" stroke="${ringColor}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-target="${fleetScore == null ? C : C * (1 - fleetScore / 100)}"/>
        </svg>
        <div class="sc-ring-num"><b id="scScoreNum" data-to="${fleetScore == null ? "" : fleetScore}">${fleetScore == null ? "—" : 0}</b><span>out of 100</span></div>
        <span class="sc-band ${band.cls}">${band.label}</span>
      </div>

      <div class="sc-kpis">
        <button type="button" class="sc-kpi k-red" data-kpi="critical"><small>Critical events</small><span class="n">${crit.length}</span>${scDelta(crit.length, critPrev.length)}${scSpark(scBuckets(crit), "#dc2626")}</button>
        <button type="button" class="sc-kpi k-amber" data-kpi="unreviewed"><small>Waiting for review</small><span class="n">${unrev.length}</span><span class="d flat">${unrev.filter(e => e.severity === "critical").length} critical</span>${scSpark(scBuckets(unrev), "#f59e0b")}</button>
        <button type="button" class="sc-kpi k-violet" data-kpi="drivers"><small>Drivers at risk</small><span class="n">${atRisk.length}</span><span class="d flat">of ${scored.length} scored</span></button>
        <button type="button" class="sc-kpi k-sky" data-kpi="devices"><small>Cameras &amp; devices online</small><span class="n">${online}<small style="display:inline;font-size:.9rem"> / ${_sc.devices.length}</small></span><span class="d flat">reading in the last 5 min</span></button>
      </div>
    </div>

    <div class="sc-main">
      <div class="sc-card">
        <div class="sc-tools" role="toolbar" aria-label="Event filters">
          ${[["all", "All"], ["critical", "Critical"], ["unreviewed", "Unreviewed"], ["coachable", "Coachable"]].map(([k, l]) => `<button type="button" class="sc-chip" data-filter="${k}" aria-pressed="${_sc.filter === k}">${l}</button>`).join("")}
          <select id="scType" aria-label="Event type"><option value="">All types</option>${[...new Set(_sc.events.map(e => e.event_type))].sort().map(t => `<option value="${t}" ${_sc.type === t ? "selected" : ""}>${scEsc(scLabel(t))}</option>`).join("")}</select>
          <input id="scSearch" type="search" placeholder="Search vehicle or driver" value="${scEsc(_sc.q)}" aria-label="Search events">
        </div>
        <div class="sc-pills" id="scPills"></div>
        <ul class="sc-feed" id="scFeed" role="listbox" aria-label="Safety events"></ul>
        <p class="muted" style="font-size:.76rem;margin:10px 2px 0">Tip: use ↑ ↓ to move through events, Enter to open, Esc to close.</p>
      </div>

      <div class="sc-side">
        <div class="sc-card"><h3>Drivers who need attention</h3><p class="sc-sub">Lowest scores first. Click a driver to filter the feed.</p><div id="scDrivers"></div></div>
        <div class="sc-card"><h3>When risk peaks</h3><p class="sc-sub">Events by hour of day in this window. Click an hour to filter.</p><div class="sc-hours" id="scHours"></div><div class="sc-hours-lbl"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span></div></div>
        <div class="sc-card"><h3>AI detections</h3><p class="sc-sub">Fuel, tyres, engine and battery, from the vehicle twin.</p><div id="scAi"></div></div>
      </div>
    </div>
  </div>
  <div class="sc-scrim" id="scScrim" hidden></div>
  <aside class="sc-drawer" id="scDrawer" role="dialog" aria-modal="true" aria-labelledby="scDrawerTitle" hidden></aside>`;

  scAnimate();
  scRenderFeed(); scRenderDrivers(); scRenderHours(); scRenderAi();
  scWire();
  scTickLive();
}

function scAnimate() {
  const ring = document.getElementById("scRingVal"), num = document.getElementById("scScoreNum");
  if (ring) requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.strokeDashoffset = ring.dataset.target; }));
  const to = num && num.dataset.to !== "" ? +num.dataset.to : null;
  if (to != null) {
    const t0 = performance.now(), dur = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
    const step = t => { const p = dur ? Math.min(1, (t - t0) / dur) : 1; num.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}

function scFilteredEvents() {
  const inWin = new Set(scWindowEvents(0).map(e => e.id));
  const q = _sc.q.trim().toLowerCase();
  return _sc.events.filter(e => {
    if (!inWin.has(e.id)) return false;
    if (_sc.filter === "critical" && e.severity !== "critical") return false;
    if (_sc.filter === "unreviewed" && e.acknowledged_at) return false;
    if (_sc.filter === "coachable" && !(e.is_coachable && Number(e.weight) > 0)) return false;
    if (_sc.type && e.event_type !== _sc.type) return false;
    if (_sc.driver && e.driver_id !== _sc.driver) return false;
    if (_sc.hour != null && new Date(e.occurred_at).getHours() !== _sc.hour) return false;
    if (q) {
      const d = _sc.scores.find(s => s.driver_id === e.driver_id);
      if (!`${scVehName(e.vehicle_id) || ""} ${d ? d.driver_name : ""} ${scLabel(e.event_type)}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (!!a.acknowledged_at - !!b.acknowledged_at) || ((SC_SEV[a.severity] || SC_SEV.info).rank - (SC_SEV[b.severity] || SC_SEV.info).rank) || (new Date(b.occurred_at) - new Date(a.occurred_at)));
}

function scRenderFeed() {
  const feed = document.getElementById("scFeed"); if (!feed) return;
  const pills = [];
  if (_sc.driver) { const d = _sc.scores.find(s => s.driver_id === _sc.driver); pills.push(["driver", "Driver: " + (d ? d.driver_name : "selected")]); }
  if (_sc.hour != null) pills.push(["hour", `Hour: ${String(_sc.hour).padStart(2, "0")}:00`]);
  document.getElementById("scPills").innerHTML = pills.map(([k, t]) => `<span class="sc-pill">${scEsc(t)}<button type="button" class="sc-x" data-clear="${k}" aria-label="Remove filter">×</button></span>`).join("");

  if (!_sc.loaded) { feed.innerHTML = `<li class="sc-skel"></li><li class="sc-skel"></li><li class="sc-skel"></li>`; return; }
  if (!(window.fwCloud && fwCloud.user && fwCloud.user())) { feed.innerHTML = `<li class="sc-empty">Sign in to see the safety picture for your fleet.</li>`; return; }
  const rows = scFilteredEvents();
  if (!rows.length) {
    feed.innerHTML = _sc.events.length
      ? `<li class="sc-empty"><span class="ic-tile success">${scIcon("checkCircle", 22)}</span><b>Nothing matches.</b><br>Try a wider time window or clear a filter.</li>`
      : `<li class="sc-empty"><span class="ic-tile info">${scIcon("camera", 22)}</span><b>No safety events yet.</b><br>They appear once a dashcam or AIS-140 device is linked to a vehicle.<br><button type="button" class="btn btn-primary btn-sm" onclick="activateTab('devices')">Open Devices &amp; Telemetry</button></li>`;
    return;
  }
  feed.innerHTML = rows.slice(0, 60).map((e, i) => {
    const sev = SC_SEV[e.severity] || SC_SEV.info, d = _sc.scores.find(s => s.driver_id === e.driver_id);
    const session = _sc.coaching.find(c => c.event_id === e.id);
    const status = session ? `<span class="sc-tag gray">coaching ${scEsc(session.status)}</span>` : e.acknowledged_at ? `<span class="sc-tag ok">reviewed</span>` : `<span class="sc-tag">${e.severity === "critical" ? "needs review" : "new"}</span>`;
    return `<li class="sc-ev ${e.acknowledged_at ? "is-done" : ""}" style="--sev:${sev.c};animation-delay:${Math.min(i, 10) * 30}ms" role="option" tabindex="${i === 0 ? 0 : -1}" aria-selected="${_sc.sel === e.id}" data-ev="${scEsc(e.id)}">
      <span class="sc-ev-ic">${scIcon(SC_ICON[e.event_type], 20)}</span>
      <div><div class="sc-ev-t">${scEsc(scLabel(e.event_type))}${status}</div>
        <div class="sc-ev-m">${scEsc(scVehName(e.vehicle_id) || "Unknown vehicle")} · ${d ? scEsc(d.driver_name) : "Unattributed driver"}${e.speed_kmph != null ? " · " + Math.round(e.speed_kmph) + " km/h" : ""}${e.video_url ? " · clip" : ""}</div></div>
      <div class="sc-ev-r"><div>${scAgo(e.occurred_at)}</div><div>${sev.label}</div></div>
    </li>`;
  }).join("") + (rows.length > 60 ? `<li class="sc-empty" style="padding:10px">Showing the 60 most urgent of ${rows.length}. Narrow the filters to see the rest.</li>` : "");
}

function scRenderDrivers() {
  const el = document.getElementById("scDrivers"); if (!el) return;
  const list = _sc.scores.filter(s => s.safety_score != null).sort((a, b) => a.safety_score - b.safety_score).slice(0, 5);
  el.innerHTML = list.length ? list.map(s => {
    const sc = Number(s.safety_score), col = sc >= 80 ? "#16a34a" : sc >= 60 ? "#f59e0b" : "#dc2626";
    return `<button type="button" class="sc-drv" data-drv="${scEsc(s.driver_id)}"><b>${scEsc(s.driver_name)}</b><span style="color:${col};font-weight:700">${sc}</span>
      <span class="sc-bar"><i style="width:${sc}%;background:${col}"></i></span></button>`;
  }).join("") : `<p class="muted" style="margin:0">Scores appear once drivers have covered 250 km in the last 30 days.</p>`;
}

function scRenderHours() {
  const el = document.getElementById("scHours"); if (!el) return;
  const counts = new Array(24).fill(0); scWindowEvents(0).forEach(e => counts[new Date(e.occurred_at).getHours()]++);
  const max = Math.max(1, ...counts);
  el.innerHTML = counts.map((n, h) => `<button type="button" class="sc-hour" style="--i:${(n / max).toFixed(2)}" data-hour="${h}" aria-pressed="${_sc.hour === h}" title="${String(h).padStart(2, "0")}:00: ${n} event${n === 1 ? "" : "s"}" aria-label="${h}:00, ${n} events"></button>`).join("");
}

function scRenderAi() {
  const el = document.getElementById("scAi"); if (!el) return;
  const list = _sc.aiEvents.filter(e => !e.acknowledged_at).slice(0, 5);
  el.innerHTML = list.length ? list.map(e => {
    const sev = SC_SEV[e.severity] || SC_SEV.info;
    return `<div class="sc-drv" style="cursor:default"><b>${scEsc(SC_AI_LABEL[e.event_type] || scLabel(e.event_type))} <span class="sc-tag ai">${Math.round((e.confidence || 0) * 100)}%</span></b><span style="color:${sev.c};font-weight:600;font-size:.78rem">${sev.label}</span>
      <span class="muted" style="grid-column:1/-1;font-size:.78rem">${scEsc(scVehName(e.vehicle_id) || "Vehicle")} · ${scEsc(e.summary)} · ${scAgo(e.occurred_at)}</span></div>`;
  }).join("") : `<p class="muted" style="margin:0">No open detections.</p>`;
}

// ── drawer ───────────────────────────────────────────────────────────────
let _scReturnFocus = null;
function scOpenDrawer(id) {
  const e = _sc.events.find(x => x.id === id); if (!e) return;
  _sc.sel = id; _scReturnFocus = document.activeElement;
  const sev = SC_SEV[e.severity] || SC_SEV.info, d = _sc.scores.find(s => s.driver_id === e.driver_id);
  const session = _sc.coaching.find(c => c.event_id === e.id);
  const clip = e.video_url && /^https:\/\//i.test(e.video_url)
    ? `<video controls playsinline preload="metadata" src="${scEsc(e.video_url)}"></video>`
    : e.video_url ? `<span>Simulated clip<br>(no real footage exists for this event)</span>` : `<span>No clip was recorded for this event.<br>Cameras upload a clip when they detect an incident.</span>`;
  const dr = document.getElementById("scDrawer"), sc = document.getElementById("scScrim");
  dr.innerHTML = `
    <div class="sc-dh"><span class="sc-ev-ic" style="--sev:${sev.c}">${scIcon(SC_ICON[e.event_type], 22)}</span>
      <div><h3 id="scDrawerTitle">${scEsc(scLabel(e.event_type))}</h3><div class="sc-ev-m">${sev.label} · ${scEsc(new Date(e.occurred_at).toLocaleString("en-IN"))}</div></div>
      <button type="button" class="sc-dx" id="scClose" aria-label="Close">×</button></div>
    <div class="sc-db">
      <div class="sc-clip">${clip}</div>
      <dl class="sc-kv">
        <dt>Vehicle</dt><dd>${scEsc(scVehName(e.vehicle_id) || "Unknown")}</dd>
        <dt>Driver</dt><dd>${d ? scEsc(d.driver_name) : "Unattributed"}${e.attribution === "assignment" ? " (by current assignment, not proven)" : ""}</dd>
        <dt>Speed</dt><dd>${e.speed_kmph != null ? Math.round(e.speed_kmph) + " km/h" : "not recorded"}</dd>
        <dt>Location</dt><dd>${e.latitude != null ? Number(e.latitude).toFixed(4) + ", " + Number(e.longitude).toFixed(4) : "not recorded"}</dd>
        <dt>Score weight</dt><dd>${Number(e.weight) > 0 ? e.weight : "not scored"}</dd>
      </dl>
      <div><h3 style="margin:0 0 8px;font-size:.9rem">What happened next</h3>
        <ul class="sc-tl">
          <li><b>Detected</b> · ${scAgo(e.occurred_at)}</li>
          <li class="${e.acknowledged_at ? "" : "todo"}"><b>${e.acknowledged_at ? "Reviewed" : "Waiting for review"}</b>${e.acknowledged_at ? " · " + scAgo(e.acknowledged_at) : ""}</li>
          <li class="${session ? "" : "todo"}"><b>${session ? "Coaching " + scEsc(session.status) : "No coaching yet"}</b></li>
        </ul></div>
    </div>
    <div class="sc-df">
      ${e.acknowledged_at ? "" : `<button type="button" class="btn btn-primary btn-sm" id="scAck">Mark reviewed</button>`}
      ${e.driver_id && !session ? `<button type="button" class="btn btn-primary btn-sm" id="scCoach">Coach driver</button>` : ""}
      <button type="button" class="btn btn-outline btn-sm" id="scFull">Full review</button>
    </div>`;
  dr.hidden = false; sc.hidden = false;
  requestAnimationFrame(() => { dr.classList.add("on"); sc.classList.add("on"); document.getElementById("scClose").focus(); });
  document.getElementById("scClose").onclick = scCloseDrawer; sc.onclick = scCloseDrawer;
  const ack = document.getElementById("scAck");
  if (ack) ack.onclick = async () => {
    ack.disabled = true;
    const ok = await fwCloud.authPatchChecked(`device_events?id=eq.${e.id}`, { acknowledged_at: new Date().toISOString(), acknowledged_by: fwCloud.uid() });
    if (ok) { e.acknowledged_at = new Date().toISOString(); if (window.toast) toast("Marked as reviewed."); scCloseDrawer(); scRender(); }
    else { ack.disabled = false; if (window.toast) toast("Could not save. Try again.", "err"); }
  };
  const coach = document.getElementById("scCoach");
  if (coach) coach.onclick = () => { scCloseDrawer(); if (window.startCoachMeeting) startCoachMeeting(e.driver_id); };
  document.getElementById("scFull").onclick = () => { scCloseDrawer(); if (window.openEventDetail) openEventDetail(e.id); };
}
function scCloseDrawer() {
  const dr = document.getElementById("scDrawer"), sc = document.getElementById("scScrim"); if (!dr || dr.hidden) return;
  dr.classList.remove("on"); sc.classList.remove("on");
  setTimeout(() => { dr.hidden = true; sc.hidden = true; dr.innerHTML = ""; }, 250);
  if (_scReturnFocus && document.contains(_scReturnFocus)) _scReturnFocus.focus();
}

// ── wiring ───────────────────────────────────────────────────────────────
function scWire() {
  const root = scRoot();
  root.querySelectorAll("[data-win]").forEach(b => b.onclick = () => { _sc.win = b.dataset.win; scRender(); });
  root.querySelector("#scRefresh").onclick = scOpen;
  root.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { _sc.filter = b.dataset.filter; scRender(); });
  root.querySelector("#scType").onchange = e => { _sc.type = e.target.value; scRenderFeed(); };
  root.querySelector("#scSearch").oninput = e => { _sc.q = e.target.value; scRenderFeed(); scKeyNav(); };
  root.querySelectorAll("[data-kpi]").forEach(b => b.onclick = () => {
    const k = b.dataset.kpi;
    if (k === "critical") _sc.filter = "critical"; else if (k === "unreviewed") _sc.filter = "unreviewed";
    else if (k === "devices") { activateTab("devices"); return; }
    else if (k === "drivers") { const w = _sc.scores.filter(s => s.band === "at_risk")[0]; if (w) _sc.driver = w.driver_id; }
    scRender();
  });
  root.querySelectorAll("[data-drv]").forEach(b => b.onclick = () => { _sc.driver = _sc.driver === b.dataset.drv ? "" : b.dataset.drv; scRender(); });
  root.querySelectorAll("[data-hour]").forEach(b => b.onclick = () => { const h = +b.dataset.hour; _sc.hour = _sc.hour === h ? null : h; scRender(); });
  root.querySelector("#scPills").onclick = e => { const c = e.target.closest("[data-clear]"); if (!c) return; if (c.dataset.clear === "driver") _sc.driver = ""; else _sc.hour = null; scRender(); };
  scKeyNav();
}
function scKeyNav() {
  const feed = document.getElementById("scFeed"); if (!feed) return;
  feed.onclick = e => { const li = e.target.closest("[data-ev]"); if (li) scOpenDrawer(li.dataset.ev); };
  feed.onkeydown = e => {
    const items = [...feed.querySelectorAll("[data-ev]")], i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); const n = items[Math.min(items.length - 1, i + 1)]; if (n) { items.forEach(x => x.tabIndex = -1); n.tabIndex = 0; n.focus(); } }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); const n = items[Math.max(0, i - 1)]; if (n) { items.forEach(x => x.tabIndex = -1); n.tabIndex = 0; n.focus(); } }
    else if ((e.key === "Enter" || e.key === " ") && i >= 0) { e.preventDefault(); scOpenDrawer(items[i].dataset.ev); }
  };
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { const dr = document.getElementById("scDrawer"); if (dr && !dr.hidden) scCloseDrawer(); }
  if (e.key === "Tab") {   // keep focus inside the open drawer
    const dr = document.getElementById("scDrawer"); if (!dr || dr.hidden) return;
    const f = [...dr.querySelectorAll("button:not([disabled]),a[href],video")]; if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});

function scTickLive() {
  const txt = document.getElementById("scLiveTxt"), dot = document.querySelector("#scLive .sc-dot"); if (!txt) return;
  const s = Math.round((Date.now() - _sc.at) / 1000);
  txt.textContent = _sc.at ? `Live · updated ${s < 60 ? s + "s" : Math.round(s / 60) + "m"} ago` : "Loading…";
  if (dot) dot.classList.toggle("is-off", !_sc.at);
}

// ── lifecycle ────────────────────────────────────────────────────────────
async function scOpen() {
  if (!scRoot()) return;
  if (!_sc.loaded) { scRender(); }
  const before = new Set(_sc.events.filter(e => e.severity === "critical").map(e => e.id));
  await scLoad();
  const fresh = _sc.events.filter(e => e.severity === "critical" && !before.has(e.id) && !e.acknowledged_at);
  scRender();
  if (before.size && fresh.length && window.toast) toast(`${fresh.length} new critical event${fresh.length === 1 ? "" : "s"}`, "err");
  clearInterval(_sc.timer);
  _sc.timer = setInterval(() => {
    const p = document.getElementById("tab-safehome");
    if (!p || !p.classList.contains("active")) { clearInterval(_sc.timer); return; }   // stop polling when the tab is not showing
    if (document.hidden) return;
    scOpen();
  }, 60000);
  if (!_sc.tick) _sc.tick = setInterval(scTickLive, 10000);
}
window.SafeCommand = { open: scOpen };
