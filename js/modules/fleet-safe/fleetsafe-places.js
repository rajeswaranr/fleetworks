/* FleetSafe → Geofences and Assets & Trailers.
   Geofences: every fence with what happened at it (entries, exits, time inside), which
   vehicles are inside right now, and the recent enter/exit log the database trigger
   writes (fs_track_position). Drawing a new fence stays on Fleet View's map.
   Assets: trailers, gensets, containers and the truck each one is hitched to. */
(function () {
  "use strict";
  const PURPOSE = { depot: ["Depot", "info"], customer: ["Customer", "ok"], fuel: ["Fuel station", "info"], plant: ["Plant", "info"],
    workshop: ["Workshop", "info"], parking: ["Parking", "info"], restricted: ["Restricted", "critical"], other: ["Other", "info"] };
  const ATYPE = { trailer: "Trailer", tipper_body: "Tipper body", genset: "Genset", compressor: "Compressor", tanker: "Tanker",
    crane: "Crane", excavator: "Excavator", container: "Container", other: "Other" };
  const G = { fences: [], events: [], assets: [], loaded: false };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n, { size: s }) : "");
  const on = () => !!(window.FSData && FSData.enabled());
  const vehName = id => { const v = ((window.db && db.vehicles) || []).find(x => x.dbId === id || x.id === id); return v ? v.name : "—"; };
  const when = ts => new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const mins = s => s == null ? "" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
  const signInCard = what => `<div class="oc"><div class="oc-empty">${icon("mapPin", 22)}<br><b>Sign in, or open the live demo, to see ${what}.</b></div></div>`;

  async function loadFences() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [f, e] = await Promise.all([
      FSData.get("geofences", "select=*&order=name").catch(() => []),
      FSData.get("geofence_events", `select=*&occurred_at=gte.${since}&order=occurred_at.desc&limit=300`).catch(() => []),
    ]);
    G.fences = f || []; G.events = e || []; G.loaded = true;
  }

  function renderFences() {
    const r = $("geofencesRoot"); if (!r) return;
    if (!on()) { r.innerHTML = signInCard("your geofences"); return; }
    const day = Date.now() - 864e5;
    // who is inside now: the latest event per vehicle and fence
    const last = {};
    [...G.events].reverse().forEach(e => { last[e.geofence_id + "|" + e.vehicle_id] = e; });
    const insideNow = Object.values(last).filter(e => e.direction === "enter");
    const restricted = G.fences.filter(f => f.purpose === "restricted");
    const restrictedHits = G.events.filter(e => e.direction === "enter" && restricted.some(f => f.id === e.geofence_id) && Date.parse(e.occurred_at) >= day);
    r.innerHTML = `<div class="oc">
      <div class="oc-head"><h2>${icon("map", 20)} Geofences</h2><span class="oc-live">${G.fences.length} active</span><span class="oc-spacer"></span>
        <button type="button" class="btn btn-primary btn-sm" id="gfNew">${icon("plus", 14)} Draw a geofence</button>
        <p class="oc-sub">Depots, customer sites, fuel stations and no-go zones. Entries and exits are recorded the moment a tracker or the driver app crosses the line; entering a restricted zone raises a critical alert.</p></div>
      <div class="oc-kpis">
        <div class="oc-kpi k-cyan"><small>Fences ${icon("map", 16)}</small><b>${G.fences.length}</b><em>${restricted.length} restricted</em></div>
        <div class="oc-kpi k-green"><small>Vehicles inside now ${icon("truck", 16)}</small><b>${insideNow.length}</b><em>${[...new Set(insideNow.map(e => e.geofence_id))].length} fence(s)</em></div>
        <div class="oc-kpi k-amber"><small>Crossings today ${icon("clock", 16)}</small><b>${G.events.filter(e => Date.parse(e.occurred_at) >= day).length}</b><em>enters + exits, 24 h</em></div>
        <div class="oc-kpi k-red"><small>Restricted entries ${icon("alert", 16)}</small><b>${restrictedHits.length}</b><em>${restrictedHits.length ? "today · check Incident Triage" : "none today"}</em></div>
      </div>
      <div class="oc-cols">
        <div class="oc-card"><h3>${icon("clock", 14)} Enter / exit log, 7 days</h3>
          ${G.events.length ? `<table class="dh-table"><thead><tr><th>When</th><th>Vehicle</th><th>Fence</th><th>Event</th><th>Time inside</th></tr></thead><tbody>
          ${G.events.slice(0, 80).map(e => { const f = G.fences.find(x => x.id === e.geofence_id) || {}; const bad = f.purpose === "restricted" && e.direction === "enter";
            return `<tr><td>${when(e.occurred_at)}</td><td>${esc(vehName(e.vehicle_id))}</td><td>${esc(f.name || "—")}</td>
              <td><span class="oc-tag ${bad ? "critical" : e.direction === "enter" ? "ok" : "info"}">${e.direction === "enter" ? "entered" : "left"}</span></td><td class="oc-mono">${mins(e.dwell_seconds)}</td></tr>`; }).join("")}
          </tbody></table>` : `<div class="oc-empty">No crossings yet. They appear once a tracker or the driver app reports positions near a fence.</div>`}
        </div>
        <div class="oc-card"><h3>${icon("mapPin", 14)} Fences</h3>
          ${G.fences.length ? `<ul class="dh-list">${G.fences.map(f => { const [pl, cls] = PURPOSE[f.purpose] || [f.purpose, "info"];
            const inside = insideNow.filter(e => e.geofence_id === f.id).map(e => vehName(e.vehicle_id));
            const n = G.events.filter(e => e.geofence_id === f.id && e.direction === "enter").length;
            return `<li><div><b>${esc(f.name)}</b><span class="muted dh-sub">${Math.round(f.radius_m)} m radius · alerts on ${esc(f.alert_on)} · ${n} entr${n === 1 ? "y" : "ies"} in 7 days${inside.length ? " · inside: " + esc(inside.join(", ")) : ""}</span></div><span class="oc-tag ${cls}">${esc(pl)}</span></li>`; }).join("")}</ul>`
            : `<div class="oc-empty">No geofences yet. Draw one on the map.</div>`}
        </div>
      </div></div>`;
    $("gfNew").onclick = () => { activateTab("fleetview"); setTimeout(() => window.startDrawGeofence && startDrawGeofence(), 400); };
  }

  async function loadAssets() {
    G.assets = (await FSData.get("assets", "select=*&order=name").catch(() => [])) || [];
  }
  function renderAssets() {
    const r = $("assetsRoot"); if (!r) return;
    if (!on()) { r.innerHTML = signInCard("your trailers and equipment"); return; }
    const A = G.assets, hitched = A.filter(a => a.towed_by_vehicle_id);
    r.innerHTML = `<div class="oc">
      <div class="oc-head"><h2>${icon("boxes", 20)} Assets &amp; Trailers</h2><span class="oc-live">${A.length} registered</span><span class="oc-spacer"></span>
        <button type="button" class="btn btn-primary btn-sm" id="asNew">${icon("plus", 14)} Add an asset</button>
        <p class="oc-sub">Trailers, reefer gensets, containers and equipment. An asset hitched to a truck shows at the truck's live position on Fleet View.</p></div>
      <div class="oc-kpis">
        <div class="oc-kpi k-cyan"><small>Assets ${icon("boxes", 16)}</small><b>${A.length}</b><em>${[...new Set(A.map(a => a.asset_type))].length} type(s)</em></div>
        <div class="oc-kpi k-green"><small>Hitched to a truck ${icon("truck", 16)}</small><b>${hitched.length}</b><em>moving with it</em></div>
        <div class="oc-kpi k-amber"><small>Idle ${icon("clock", 16)}</small><b>${A.filter(a => a.status === "idle").length}</b><em>parked at a base</em></div>
        <div class="oc-kpi k-red"><small>In maintenance ${icon("wrench", 16)}</small><b>${A.filter(a => a.status === "maintenance").length}</b><em>not available</em></div>
      </div>
      <div class="oc-card">${A.length ? `<table class="dh-table"><thead><tr><th>Asset</th><th>Type</th><th>Make / model</th><th>Hitched to</th><th>Base</th><th>Status</th></tr></thead><tbody>
        ${A.map(a => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(ATYPE[a.asset_type] || a.asset_type)}</td><td>${esc([a.make, a.model].filter(Boolean).join(" · ") || "—")}</td>
          <td>${a.towed_by_vehicle_id ? esc(vehName(a.towed_by_vehicle_id)) : `<span class="muted">—</span>`}</td><td>${esc(a.base_location || "—")}</td>
          <td><span class="oc-tag ${a.status === "active" ? "ok" : a.status === "maintenance" ? "warning" : "info"}">${esc(a.status)}</span></td></tr>`).join("")}
        </tbody></table>` : `<div class="oc-empty">No assets yet. Add trailers and equipment to track them with the truck that pulls them.</div>`}</div>
    </div>`;
    $("asNew").onclick = () => { if (window.openAssetModal) openAssetModal(); else activateTab("fleetview"); };
  }

  window.FleetSafePlaces = {
    async geofences() { renderFences(); if (!on()) return; if (!G.loaded) $("geofencesRoot").innerHTML = `<div class="oc"><div class="oc-skel"></div><div class="oc-skel"></div></div>`; await loadFences(); renderFences(); },
    async assets() { renderAssets(); if (!on()) return; await loadAssets(); renderAssets(); },
  };
})();
